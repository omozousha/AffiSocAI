/**
 * Threads adapter — Meta Threads API (official, verified against
 * developers.facebook.com/documentation/threads, Aug 2026).
 *
 * VERIFIED-EXECUTED-DOCS: every endpoint, parameter and response shape below
 * was read from Meta's live reference — Publishing, Posts, Get Access Tokens,
 * and Long-Lived Tokens. Nothing here is guessed.
 *
 * Auth is OAuth 2.0, no password and no cookie: the operator authorises a Meta
 * app once through Meta's own Authorization Window, and this adapter exchanges
 * the returned code for a short-lived token, then a long-lived token (60 days)
 * that it refreshes automatically. That token is the only credential, it lives
 * in a 0600 file outside the repo, and it never reaches the browser or chat.
 *
 * The previous browser-cookie path (`threads-browser.ts`) is retained but is
 * NOT used by this adapter: Meta's login flow cannot be automated on this
 * headless host, and a captured `sessionid` cookie is not a supported way to
 * publish. Do not reintroduce it while this adapter is live.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  PostAnalytics,
  PostStatus,
  ProviderCapabilities,
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
  VerificationStatus,
} from "../core/types.ts";

const GRAPH = "https://graph.threads.com";
const HOME = process.env.HOME || "/root";
const SECRET_DIR = process.env.THREADS_AUTH_DIR || join(HOME, ".affiliate-tools", "threads");
/** Long-lived token. Mode 0600, never committed, never printed. */
const TOKEN_FILE = join(SECRET_DIR, "token.json");
/** App credentials. Also 0600, from env or this file. */
const APP_FILE = join(SECRET_DIR, "app.json");

interface StoredToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  saved_at: string;
  /** epoch ms — a refresh is attempted this far before expiry */
  refresh_at: number;
  /** cached Threads user id (set at first refresh/exchange) */
  user_id?: string;
}

function readJsonFile(path: string): any {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function appCreds(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const env = {
    clientId: process.env.THREADS_APP_ID || "",
    clientSecret: process.env.THREADS_APP_SECRET || "",
    redirectUri: process.env.THREADS_REDIRECT_URI || "",
  };
  if (env.clientId && env.clientSecret && env.redirectUri) return env;
  const file = readJsonFile(APP_FILE);
  if (file?.client_id && file?.client_secret && file?.redirect_uri) {
    return {
      clientId: String(file.client_id),
      clientSecret: String(file.client_secret),
      redirectUri: String(file.redirect_uri),
    };
  }
  return null;
}

function store(): StoredToken | null {
  const t = readJsonFile(TOKEN_FILE);
  if (!t?.access_token) return null;
  return t as StoredToken;
}

function save(t: StoredToken): void {
  mkdirSync(SECRET_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

async function graphPost(path: string, body: Record<string, string>): Promise<any> {
  const form = new URLSearchParams(body);
  const r = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const text = await r.text();
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    j = { raw: text };
  }
  if (!r.ok || j.error) {
    const m = j.error?.error_message || j.error?.message || j.raw || `HTTP ${r.status}`;
    throw new Error(`${path} failed: ${m}`);
  }
  return j;
}

async function graphGet(path: string, query: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams(query).toString();
  const r = await fetch(`${GRAPH}${path}?${qs}`);
  const j = await r.json().catch(() => ({}) as any);
  if (!r.ok || (j as any).error) {
    const e: any = j;
    const m = e.error?.error_message || e.error?.message || `HTTP ${r.status}`;
    throw new Error(`${path} failed: ${m}`);
  }
  return j;
}

/**
 * Exchanges an authorization code (from the redirect) for a long-lived token.
 * Short-lived tokens last 1 hour; the long-lived exchange must happen before
 * then, so this is called immediately by the OAuth callback handler.
 */
export async function exchangeCode(code: string): Promise<{ ok: boolean; error?: string }> {
  const app = appCreds();
  if (!app) return { ok: false, error: "app credentials not configured (THREADS_APP_ID/SECRET/REDIRECT_URI or app.json)" };
  try {
    const short = await graphPost("/oauth/access_token", {
      client_id: app.clientId,
      client_secret: app.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: app.redirectUri,
      code,
    });
    const long = await graphGet("/access_token", {
      grant_type: "th_exchange_token",
      client_secret: app.clientSecret,
      access_token: String(short.access_token),
    });
    const expiresIn = Number(long.expires_in ?? 0);
    save({
      access_token: String(long.access_token),
      token_type: String(long.token_type || "bearer"),
      expires_in: expiresIn,
      saved_at: new Date().toISOString(),
      // Refresh at 75% of life: safely past the 24-hour minimum age and well
      // before expiry.
      refresh_at: Date.now() + Math.floor(expiresIn * 0.75 * 1000),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Authorization Window URL the operator opens to grant permissions. */
export async function clearThreadsToken(): Promise<boolean> {
  const { rmSync, existsSync } = await import("node:fs");
  if (!existsSync(TOKEN_FILE)) return false;
  rmSync(TOKEN_FILE);
  return true;
}

export function authorizeUrl(): { url: string } | { error: string } {
  const app = appCreds();
  if (!app) return { error: "app credentials not configured" };
  // The Authorization Window is on threads.com; token exchange and every
  // data call are on graph.threads.com.
  const url =
    `https://threads.com/oauth/authorize` +
    `?client_id=${encodeURIComponent(app.clientId)}` +
    `&redirect_uri=${encodeURIComponent(app.redirectUri)}` +
    `&scope=${encodeURIComponent("threads_basic,threads_content_publish,threads_read_replies,threads_manage_replies")}` +
    `&response_type=code`;
  return { url };
}

/** Exported for the reply-management module (threads-replies.ts): same
 * token/refresh discipline, no duplicate secret handling. Injects the access
 * token and the /v1.0 prefix so callers pass bare node paths. */
export async function graphGetForReplies(path: string, q: Record<string, string>) {
  return graphGet(path.startsWith("/v1.0") ? path : `/v1.0${path}`, { ...q, access_token: await accessToken() });
}
export async function graphPostForReplies(path: string, b: Record<string, string>) {
  return graphPost(path.startsWith("/v1.0") ? path : `/v1.0${path}`, { ...b, access_token: await accessToken() });
}
export async function threadsUserId(): Promise<string> {
  const t = store();
  if (t?.user_id) return String(t.user_id);
  const me = await graphGetForReplies("/me", { fields: "id" });
  if (t) save({ ...t, user_id: String(me.id) });
  return String(me.id);
}

async function accessToken(): Promise<string> {
  const t = store();
  if (!t) throw new Error("Threads not connected — open the Authorization Window first");
  if (Date.now() >= t.refresh_at) {
    const app = appCreds();
    if (!app) throw new Error("app credentials missing — cannot refresh");
    try {
      const refreshed = await graphGet("/refresh_access_token", {
        grant_type: "th_refresh_token",
        access_token: t.access_token,
      });
      const expiresIn = Number(refreshed.expires_in ?? 0);
      save({
        access_token: String(refreshed.access_token),
        token_type: "bearer",
        expires_in: expiresIn,
        saved_at: new Date().toISOString(),
        refresh_at: Date.now() + Math.floor(expiresIn * 0.75 * 1000),
      });
      return String(refreshed.access_token);
    } catch (e) {
      if (Date.now() >= t.refresh_at + 7 * 86400 * 1000) {
        throw new Error(`Threads token expired and could not be refreshed: ${e instanceof Error ? e.message : e}`);
      }
      // Still inside its 60-day window — fall through and try the old token.
      return t.access_token;
    }
  }
  return t.access_token;
}

const CAPABILITIES: ProviderCapabilities = {
  textPost: true,
  imagePost: true,
  videoPost: true,
  carouselPost: true,
  scheduledPost: false, // no scheduling endpoint in the Threads API
  postStatus: true,
  analytics: true,
  connect: true,
};

export class ThreadsAdapter implements SocialProvider {
  readonly slug = "threads";
  readonly displayName = "Threads";

  get capabilities() {
    return CAPABILITIES;
  }

  get status(): VerificationStatus {
    return hasToken() ? "VERIFIED-EXECUTED" : "BOUNDARY-DISABLED";
  }

  get blockedReason(): string | undefined {
    if (hasToken()) return undefined;
    return "Threads not connected — Sosmed → Threads → “Hubungkan” opens Meta's Authorization Window. " +
      "No password or cookie is used; only a refreshable OAuth token stored 0600 outside the repo.";
  }

  async connect(): Promise<void> {
    if (!hasToken()) throw new Error("threads not connected — open the Authorization Window");
  }

  async getAccount(): Promise<SocialAccount | null> {
    const token = store();
    if (!token) return null;
    try {
      const me = await graphGet("/v1.0/me", {
        fields: "id,username,name,threads_profile_picture_url,threads_biography",
        access_token: await accessToken(),
      });
      return {
        id: String(me.id),
        username: me.username,
        displayName: me.name || me.username,
        kind: "profile",
      };
    } catch {
      return null;
    }
  }

  validateContent(content: SocialContent): Promise<ValidationResult> {
    const errors: string[] = [];
    const text = content.text ?? "";
    if (!text.trim()) errors.push("Threads posts need text");
    if (text.length > 500) errors.push("Threads text limit is 500 characters");
    if (!hasToken()) errors.push("Threads not connected");
    const media = content.mediaUrls?.length
      ? content.mediaUrls
      : content.mediaUrl
        ? [content.mediaUrl]
        : [];
    for (const u of media) {
      if (!/^https?:\/\//.test(u)) {
        errors.push("Threads must be able to fetch the media URL — use the public BIO_PUBLIC_BASE URL, not a local path");
      }
    }
    return Promise.resolve({ ok: errors.length === 0, errors });
  }

  async publish(content: SocialContent): Promise<PublishResult> {
    const check = await this.validateContent(content);
    if (!check.ok) return { ok: false, error: check.errors.join("; ") };

    const token = await accessToken();
    const userId = await this.resolveUserId();
    const media = content.mediaUrls?.length
      ? content.mediaUrls
      : content.mediaUrl
        ? [content.mediaUrl]
        : [];

    try {
      let containerId: string;

      if (media.length >= 2) {
        // Carousel: child containers, then a CAROUSEL parent. 2–20 items.
        if (media.length > 20) return { ok: false, error: "carousel allows at most 20 items" };
        const childIds: string[] = [];
        for (const url of media) {
          const child = await graphPost(`/v1.0/${userId}/threads`, {
            media_type: /\.(mp4|mov|m4v)(\?|$)/i.test(url) ? "VIDEO" : "IMAGE",
            ...(/\.(mp4|mov|m4v)(\?|$)/i.test(url) ? { video_url: url } : { image_url: url }),
            is_carousel_item: "true",
            access_token: token,
          });
          childIds.push(String(child.id));
        }
        const parent = await graphPost(`/v1.0/${userId}/threads`, {
          media_type: "CAROUSEL",
          children: childIds.join(","),
          text: content.text ?? "",
          ...(content.topicTag ? { topic_tag: content.topicTag } : {}),
          access_token: token,
        });
        containerId = String(parent.id);
      } else {
        const one = media[0];
        const isVideo = one ? /\.(mp4|mov|m4v)(\?|$)/i.test(one) : false;
        containerId = String(
          (
            await graphPost(`/v1.0/${userId}/threads`, {
              media_type: one ? (isVideo ? "VIDEO" : "IMAGE") : "TEXT",
              ...(one ? (isVideo ? { video_url: one } : { image_url: one }) : {}),
              text: content.text ?? "",
              // Max 1 topic_tag per post: routes into the topic feed
              // (official API; the unofficial threads-api bundle has no slot).
              ...(content.topicTag ? { topic_tag: content.topicTag } : {}),
              access_token: token,
            })
          ).id,
        );
      }

      // Meta recommends ~30 s for the container to be processed; poll status
      // instead of sleeping blindly, and bail out on ERROR.
      await this.waitForContainer(containerId, token);

      const pub = await graphPost(`/v1.0/${userId}/threads_publish`, {
        creation_id: containerId,
        access_token: token,
      });
      const permalink = `https://www.threads.com/@${content.authorHandle || "me"}/post/${pub.id}`;
      return { ok: true, postId: String(pub.id), url: permalink, evidence: pub };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async waitForContainer(containerId: string, token: string): Promise<void> {
    for (let i = 0; i < 12; i++) {
      try {
        const s = await graphGet(`/v1.0/${containerId}`, { fields: "status,error_message", access_token: token });
        const code = String(s.status ?? "").toUpperCase();
        if (code === "FINISHED" || code === "PUBLISHED" || code === "IN_PROGRESS" || code === "") {
          if (code === "IN_PROGRESS") {
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }
          return;
        }
        if (code === "ERROR" || code === "EXPIRED") {
          throw new Error(`container ${containerId} ${code}: ${s.error_message ?? "no detail"}`);
        }
        if (code === "NOT_FOUND") return; // already gone — publish will surface any real error
      } catch (e) {
        // A status failure that is not terminal should not abort the publish.
        if (String((e as Error).message).includes("container ")) throw e;
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  /** The user id is only known after authorising; cache it with the token. */
  private async resolveUserId(): Promise<string> {
    const envId = process.env.THREADS_USER_ID;
    if (envId) return envId;
    const cached = readJsonFile(TOKEN_FILE)?.user_id;
    if (cached) return String(cached);
    const me = await graphGet("/v1.0/me", { fields: "id", access_token: await accessToken() });
    const t = store();
    if (t) {
      save({ ...t, user_id: String(me.id) } as StoredToken & { user_id?: string });
    }
    return String(me.id);
  }

  async getAnalytics(postId: string): Promise<PostAnalytics> {
    try {
      const res = await graphGet(`/v1.0/${postId}/insights`, {
        metric: "views,likes,replies,reposts,quotes",
        access_token: await accessToken(),
      });
      const metrics: Record<string, number> = {};
      for (const row of res.data ?? []) {
        const v = row?.values?.[0]?.value;
        if (typeof v === "number") metrics[row.name] = v;
      }
      return { postId, metrics };
    } catch {
      return { postId, metrics: {} };
    }
  }

  async getPostStatus(postId: string): Promise<PostStatus> {
    try {
      const s = await graphGet(`/v1.0/${postId}`, {
        fields: "id,permalink,text,timestamp",
        access_token: await accessToken(),
      });
      return {
        postId,
        state: "published",
        detail: s.permalink ?? s.timestamp,
      };
    } catch (e) {
      return { postId, state: "failed", detail: (e as Error).message };
    }
  }
}

function hasToken(): boolean {
  return Boolean(store());
}

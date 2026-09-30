/**
 * Threads unofficial adapter — threads-api (reverse-engineered, no business portfolio needed).
 *
 * Uses username+password login via threads-api's private GraphQL endpoint.
 * Credentials are read from env/file (0600) at call time, never hardcoded.
 * Token/session is stored 0600 under ~/.affiliate-tools/threads-unofficial/.
 * This adapter coexists with the OAuth one (threads.ts) but takes over the
 * "threads" slot when a stored session exists — so either auth path works.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  ProviderCapabilities,
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
  VerificationStatus,
} from "../core/types.ts";

const HOME = process.env.HOME || "/root";
const STORE_DIR = join(HOME, ".affiliate-tools", "threads-unofficial");
const SESSION_FILE = join(STORE_DIR, "session.json");

export interface UnofficialSession {
  token: string;
  userID?: string;
  username?: string;
  saved_at: string;
}

function envCreds(): { username: string; password: string } | null {
  const u = (process.env.THREADS_USERNAME || "").trim();
  const p = (process.env.THREADS_PASSWORD || "").trim();
  if (u && p) return { username: u, password: p };
  // Also try file-based (user can cat > file outside git)
  const f = join(STORE_DIR, "credentials.json");
  if (existsSync(f)) {
    try {
      const j = JSON.parse(readFileSync(f, "utf8"));
      if (j.username && j.password) return { username: String(j.username), password: String(j.password) };
    } catch { /* ignore */ }
  }
  return null;
}

function readSession(): UnofficialSession | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const j = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    if (j?.token) return j as UnofficialSession;
    return null;
  } catch {
    return null;
  }
}

function writeSession(s: UnofficialSession): void {
  mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

function hasSession(): boolean {
  return Boolean(readSession()?.token);
}

async function getThreadsAPI() {
  // threads-api is commonjs, dynamic import via createRequire
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const mod = req("threads-api");
  return mod.ThreadsAPI as new (opts?: Record<string, unknown>) => {
    login: () => Promise<{ token: string; userID?: string }>;
    publish: (opts: Record<string, unknown>) => Promise<string | undefined>;
    getUserProfile: (userId: string) => Promise<{ username?: string; full_name?: string; follower_count?: number }>;
    getCurrentUserID: () => Promise<string | undefined>;
    userID?: string;
    token?: string;
    username?: string;
  };
}

export async function loginUnofficial(username?: string, password?: string): Promise<{ ok: boolean; token?: string; userID?: string; error?: string }> {
  const creds = username && password ? { username, password } : envCreds();
  if (!creds) return { ok: false, error: "THREADS_USERNAME/THREADS_PASSWORD not set (env or ~/.affiliate-tools/threads-unofficial/credentials.json)" };
  try {
    const ThreadsAPI = await getThreadsAPI();
    const api = new ThreadsAPI({ username: creds.username, password: creds.password, verbose: false });
    const res = await api.login();
    if (!res?.token) return { ok: false, error: "login returned no token" };
    const sess: UnofficialSession = {
      token: res.token,
      userID: res.userID,
      username: creds.username,
      saved_at: new Date().toISOString(),
    };
    writeSession(sess);
    return { ok: true, token: res.token, userID: res.userID };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function clearUnofficialSession(): boolean {
  try {
    if (!existsSync(SESSION_FILE)) return false;
    const { unlinkSync } = require("node:fs") as typeof import("node:fs");
    unlinkSync(SESSION_FILE);
    return true;
  } catch {
    // fallback: overwrite
    try { writeFileSync(SESSION_FILE, "{}", { mode: 0o600 }); } catch { /* */ }
    return true;
  }
}

const CAPS: ProviderCapabilities = {
  textPost: true,
  imagePost: true,
  videoPost: false,
  carouselPost: false,
  scheduledPost: false,
  postStatus: false,
  analytics: false,
  connect: true,
};

export class ThreadsUnofficialAdapter implements SocialProvider {
  readonly slug = "threads";
  readonly displayName = "Threads";

  get capabilities(): ProviderCapabilities { return CAPS; }
  get status(): VerificationStatus { return hasSession() ? "VERIFIED-EXECUTED" : "BOUNDARY-DISABLED"; }
  get blockedReason(): string | undefined {
    if (hasSession()) return undefined;
    return "Threads unoffic. tidak terhubung — set THREADS_USERNAME + THREADS_PASSWORD (env atau ~/.affiliate-tools/threads-unofficial/credentials.json), lalu POST /api/providers/threads/login. Tanpa portofolio bisnis.";
  }

  async connect(): Promise<void> {
    const r = await loginUnofficial();
    if (!r.ok) throw new Error(r.error);
  }

  async getAccount(): Promise<SocialAccount | null> {
    const sess = readSession();
    if (!sess) return null;
    try {
      const ThreadsAPI = await getThreadsAPI();
      const api = new ThreadsAPI({ token: sess.token, fbLSDToken: undefined, verbose: false });
      // Light check: getUserProfile for self
      const uid = sess.userID || await api.getCurrentUserID().catch(() => undefined);
      if (!uid) return { id: sess.token.slice(0, 12), username: sess.username || "threads", displayName: sess.username || "Threads", kind: "profile" };
      const u = await api.getUserProfile(uid).catch(() => null) as { username?: string; full_name?: string } | null;
      return {
        id: uid,
        username: u?.username || sess.username || uid,
        displayName: u?.full_name || u?.username || sess.username || uid,
        kind: "profile",
      };
    } catch {
      return { id: sess.userID || "threads", username: sess.username || "threads", displayName: sess.username || "threads", kind: "profile" };
    }
  }

  async validateContent(content: SocialContent): Promise<ValidationResult> {
    const errors: string[] = [];
    const text = (content.text || "").trim();
    if (!text) errors.push("Threads perlu text");
    if (text.length > 500) errors.push("Threads limit 500 karakter");
    if (!hasSession()) errors.push("Threads belum login — POST /api/providers/threads/login");
    // image optional for threads, but if present must be http(s) or path
    return { ok: errors.length === 0, errors };
  }

  async publish(content: SocialContent): Promise<PublishResult> {
    const v = await this.validateContent(content);
    if (!v.ok) return { ok: false, error: v.errors.join("; ") };
    const sess = readSession();
    if (!sess?.token) return { ok: false, error: "no session" };
    try {
      const ThreadsAPI = await getThreadsAPI();
      const api = new ThreadsAPI({ token: sess.token, verbose: false });
      // Also set userID if we have it
      if (sess.userID) (api as unknown as Record<string, unknown>).userID = sess.userID;

      const pubOpts: Record<string, unknown> = { text: content.text || "" };
      // threads-api expects image as path or url string
      const media = content.mediaUrls?.length ? content.mediaUrls : content.mediaUrl ? [content.mediaUrl] : [];
      if (media.length === 1) {
        // Single image: use attachment.image with the public URL — threads-api will download it
        pubOpts.attachment = { image: media[0] };
      } else if (media.length > 1) {
        pubOpts.attachment = { sidecar: media.slice(0, 10) };
      }
      // url field deprecated, but keep as fallback if text contains link? no, link is in bio
      const postId = await api.publish(pubOpts as Parameters<typeof api.publish>[0]).catch((e: unknown) => { throw e; });
      if (!postId) return { ok: false, error: "publish returned no post id" };
      return { ok: true, postId: String(postId), url: `https://www.threads.net/@${sess.username || "me"}/post/${postId}`, evidence: { postId } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Common: token expired -> surface clearly so caller knows to re-login
      if (/401|403|unauthorized|expired|challenge/i.test(msg)) {
        return { ok: false, error: `auth/expired: ${msg} — re-login via POST /api/providers/threads/login` };
      }
      return { ok: false, error: msg.slice(0, 800) };
    }
  }
}

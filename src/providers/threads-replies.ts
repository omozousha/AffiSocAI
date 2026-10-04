/**
 * Threads official reply management (graph.threads.net) — the stable path.
 * The unofficial library's GraphQL doc_ids expired: getThreads returns NULL
 * for every post (proved 2026-10-04: sweep saw "thread kosong" while public
 * profile clearly had comments). Meta's Reply Management API is the fix.
 *
 * Requires the token granted scopes: threads_basic, threads_content_publish,
 * threads_read_replies, threads_manage_replies (authorizeUrl updated).
 * Until the operator re-consents, tokens lack the reply scopes and every
 * call here fails with code 10 — caller must treat that as "not ready"
 * (dry-skip), never as "no comments".
 */
import { getProvider } from "../core/registry.ts";
import type { ContentRow } from "../core/store.ts";

const FIELDS = "id,text,username,timestamp,is_reply_owned_by_me,replied_to,root_post";

interface OfficialGraph {
  graphGet(path: string, q: Record<string, string>): Promise<any>;
  graphPostForm(path: string, body: Record<string, string>): Promise<any>;
  userId(): Promise<string>;
}

/**
 * Reach the official provider's graph helpers without widening its public
 * surface: it keeps token/refresh logic internal; we call through the same
 * module the OAuth callback uses.
 */
async function graph(): Promise<OfficialGraph | null> {
  try {
    const m = await import("./threads.ts");
    if (!m.graphGetForReplies || !m.graphPostForReplies || !m.threadsUserId) return null;
    return {
      graphGet: (p, q) => m.graphGetForReplies(p, q),
      graphPost: undefined as never,
      graphPostForm: (p, b) => m.graphPostForReplies(p, b),
      userId: () => m.threadsUserId(),
    } as OfficialGraph;
  } catch {
    return null;
  }
}

export interface OfficialComment {
  id: string;         // media id of the comment
  text: string;
  username: string;
  timestamp: string;
  mine: boolean;      // authored by us
  rootPost: string;   // root thread media id
}

export interface ReadyResult { ok: boolean; reason?: string; }

/** true once the stored token actually carries the reply scopes. */
export async function replyScopesReady(): Promise<ReadyResult> {
  const g = await graph();
  if (!g) return { ok: false, reason: "provider graph helpers missing" };
  try {
    const uid = await g.userId();
    await g.graphGet(`/${uid}/replies`, { object_activity: "thread", fields: "id", limit: "1" });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.slice(0, 160) : String(e) };
  }
}

/** Comments (top-level replies) on one of our published threads posts.
 * Per Meta docs the correct node is GET /{media-id}/replies — the thread's
 * own reply list; /{uid}/replies only lists replies the ACCOUNT created. */
export async function fetchComments(postMediaId: string, sinceIso: string): Promise<OfficialComment[]> {
  const g = await graph();
  if (!g) throw new Error("graph unavailable");
  const out: OfficialComment[] = [];
  let url = `/${postMediaId}/replies?fields=${encodeURIComponent(FIELDS)}&reverse=false&limit=50`;
  while (url) {
    const [path, qs] = url.split("?");
    const j = await g.graphGet(path, Object.fromEntries(new URLSearchParams(qs ?? "")));
    for (const d of j.data ?? []) {
      const root = String(d.root_post?.id ?? d.root_post ?? "");
      const ts = String(d.timestamp ?? "");
      if (ts && ts < sinceIso) continue;
      out.push({
        id: String(d.id),
        text: String(d.text ?? ""),
        username: String(d.username ?? ""),
        timestamp: ts,
        mine: Boolean(d.is_reply_owned_by_me),
        rootPost: root,
      });
    }
    url = j.paging?.next ?? null;
    if (!url) break;
    const u = new URL(url);
    url = `${u.pathname}?${u.searchParams.toString()}`;
  }
  return out;
}

/** Publish a reply to a comment. Returns the reply media id. */
export async function publishReply(text: string, replyToId: string): Promise<string | null> {
  const g = await graph();
  if (!g) throw new Error("graph unavailable");
  // reply = media_type TEXT_POST with reply_to_id, then publish the container
  const c = await g.graphPostForm("/me/threads", { media_type: "TEXT_POST", text, reply_to_id: replyToId });
  const id = String(c?.id ?? "");
  if (!id) return null;
  const uid = await g.userId();
  // Meta needs a short settle before publishing text containers
  await new Promise((r) => setTimeout(r, 2000));
  const p = await g.graphPostForm(`/${uid}/threads_publish`, { creation_id: id });
  return String(p?.id ?? id);
}

/** posts published on threads that the official provider could own. */
export function threadsPublished(rows: ContentRow[]): ContentRow[] {
  const p = getProvider("threads");
  const hasTok = Boolean(p);
  return hasTok ? rows.filter((r) => r.platform === "threads" && r.status === "published" && r.post_id) : [];
}

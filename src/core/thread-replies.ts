/**
 * Threads auto-reply — answers comments on our own posts so threads stay alive.
 *
 * No LLM key on this host, so replies are template-based (keyword-matched,
 * product-aware via buildIdentity). When CATEGORY_API_KEY is set the same
 * OpenRouter-compatible chat endpoint drafts the reply instead.
 *
 * Guards:
 * - Only replies to comments on posts WE published (post_id in content table,
 *   platform=threads, status=published). Never touches strangers' threads.
 * - One reply per comment (answered ids in thread_replies table).
 * - Rate cap: REPLY_MAX_PER_RUN (default 5), REPLY_INTERVAL_MS between posts.
 * - Dry-run mode for review: returns candidates without publishing.
 * - Opt-in: THREADS_AUTOREPLY=1. Default off.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildIdentity } from "./product-identity.ts";
import { getLink, type ContentRow } from "./store.ts";

const HOME = process.env.HOME || "/root";
const SESSION_FILE = join(HOME, ".affiliate-tools", "threads-unofficial", "session.json");

const MAX_PER_RUN = Number(process.env.REPLY_MAX_PER_RUN || 5);
const INTERVAL_MS = Number(process.env.REPLY_INTERVAL_MS || 15000);
const ENABLED = (process.env.THREADS_AUTOREPLY || "") === "1";

export interface ReplyCandidate {
  contentId: number;
  postId: string;
  commentId: string;
  commentText: string;
  commentUser: string;
  replyText: string;
}

interface UnofficialSession {
  token: string;
  userID?: string;
  username?: string;
}

function readSession(): UnofficialSession | null {
  try {
    if (!existsSync(SESSION_FILE)) return null;
    const j = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
    return j?.token ? (j as UnofficialSession) : null;
  } catch {
    return null;
  }
}

async function getThreadsAPI(): Promise<new (opts?: Record<string, unknown>) => {
  getThreads: (postID: string) => Promise<{
    containing_thread: { posts: Array<Record<string, unknown>> };
    reply_threads?: Array<{ posts: Array<Record<string, unknown>> }>;
  }>;
  publish: (opts: Record<string, unknown>) => Promise<string | undefined>;
  getPostIDfromURL: (url: string) => string;
  userID?: string;
}> {
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const mod = req("threads-api");
  return mod.ThreadsAPI;
}

/** numeric media id from a stored post_id (`pk_userid` or bare pk). */
function mediaId(postId: string): string {
  return postId.split("_")[0].replace(/\D/g, "");
}

function postText(p: Record<string, unknown>): string {
  const cap = p.caption as { text?: string } | null | undefined;
  return String(cap?.text ?? "");
}

function postUser(p: Record<string, unknown>): string {
  const u = p.user as { username?: string } | undefined;
  return String(u?.username ?? "anon");
}

/** Template reply matched to comment intent. Product name keeps it specific. */
export function templateReply(comment: string, product: string | null): string {
  const c = comment.toLowerCase();
  const name = product ? ` ${product.split(" ").slice(0, 4).join(" ")}` : "";
  if (/harga|berapa|price|murah|mahal/.test(c))
    return `Harganya ramah banget buat spek segini kak 🙏 cek link di bio ya, lagi ada potongan!`;
  if (/link|beli|order|cara|checkout|keranjang/.test(c))
    return `Klik link di bio kak, langsung ke tokonya 👆${name} lagi ready stock!`;
  if (/ori|asli|kw|palsu|original|garansi/.test(c))
    return `Ori kak, garansi toko ✅ kalau ragu bisa chat seller dulu sebelum checkout!`;
  if (/bagus|baguskah|review|testimoni|rekomendasi|worth/.test(c))
    return `Worth it kak! Rating tokonya bagus, yang beli ulang juga banyak ⭐`;
  if (/kapan|sampai|lama|pengiriman|kirim|ekspedisi/.test(c))
    return `Pengiriman dari lokal kak, biasanya 2-4 hari sampai 📦 ada resi trackingnya!`;
  if (/warn|warna|varian|ukuran|size|model/.test(c))
    return `Varian lengkap kak, cek di halaman produknya langsung — pilih yang paling cocok 😊`;
  if (/makasih|thanks|thank|mantap|keren|oke|siap/.test(c))
    return `Sama-sama kak! 🙌 jangan lupa follow biar nggak ketinggalan rekomendasi berikutnya!`;
  return `Betul kak!${name} emang lagi banyak yang cari 🔥 cek link di bio buat detailnya ya!`;
}

async function llmReply(comment: string, product: string | null): Promise<string | null> {
  const key = (process.env.CATEGORY_API_KEY || "").trim();
  if (!key) return null;
  const base = (process.env.CATEGORY_API_BASE || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.CATEGORY_MODEL || "google/gemini-2.0-flash-001";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 80,
        messages: [
          { role: "system", content: `Kamu admin toko ramah balas komentar Threads. Bahasa Indonesia santai, max 200 karakter, 1 emoji. Jangan sebut harga pasti. Akhiri ajakan cek link di bio. Produk: ${product ?? "rekomendasi toko"}.` },
          { role: "user", content: comment.slice(0, 300) },
        ],
      }),
    });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    const raw: string = j.choices?.[0]?.message?.content || "";
    const clean = raw.trim().slice(0, 220);
    return clean || null;
  } catch {
    return null;
  }
}

/**
 * Scan published threads posts for unanswered comments.
 * dryRun=true: collect candidates without publishing (for operator review).
 */
export async function scanReplies(
  published: ContentRow[],
  answered: Set<string>,
  opts: { dryRun?: boolean; limit?: number } = {},
): Promise<{ candidates: ReplyCandidate[]; published: ReplyCandidate[]; skipped: string[] }> {
  const candidates: ReplyCandidate[] = [];
  const sent: ReplyCandidate[] = [];
  const skipped: string[] = [];
  const sess = readSession();
  if (!sess?.token) {
    skipped.push("no unofficial session — login dulu");
    return { candidates, published: sent, skipped };
  }
  const ThreadsAPI = await getThreadsAPI();
  const api = new ThreadsAPI({ token: sess.token, verbose: false });
  if (sess.userID) api.userID = sess.userID;
  const selfId = String(sess.userID ?? "");
  const selfName = String(sess.username ?? "").toLowerCase();
  const cap = opts.limit ?? MAX_PER_RUN;

  for (const row of published) {
    if (sent.length + candidates.length >= cap) break;
    if (!row.post_id) continue;
    const mid = mediaId(row.post_id);
    if (!mid) { skipped.push(`content ${row.id}: bad post_id`); continue; }
    const link = getLink(row.link_id);
    const identity = buildIdentity({
      product: link?.product ?? null,
      kategori: link?.kategori ?? null,
      shop: link?.shop ?? null,
    });
    let thread;
    try {
      thread = await api.getThreads(mid);
    } catch (e) {
      skipped.push(`content ${row.id}: getThreads gagal (${e instanceof Error ? e.message.slice(0, 80) : e})`);
      continue;
    }
    if (!thread) { skipped.push(`content ${row.id}: thread kosong (belum ada komentar)`); continue; }
    const replies = thread.reply_threads ?? [];
    for (const rt of replies) {
      for (const p of rt.posts ?? []) {
        const pk = String((p as { pk?: string }).pk ?? "");
        const user = postUser(p as Record<string, unknown>).toLowerCase();
        if (!pk || answered.has(pk)) continue;
        // skip our own messages + the root post echo
        const uid = String((p as { user?: { pk?: string } }).user?.pk ?? "");
        if ((selfId && uid === selfId) || (selfName && user === selfName)) { answered.add(pk); continue; }
        const text = postText(p as Record<string, unknown>);
        if (!text.trim()) { answered.add(pk); continue; }
        const replyText = (await llmReply(text, identity.shop ? link?.product ?? null : link?.product ?? null))
          ?? templateReply(text, link?.product ?? null);
        const cand: ReplyCandidate = {
          contentId: row.id, postId: row.post_id, commentId: pk,
          commentText: text.slice(0, 200), commentUser: postUser(p as Record<string, unknown>),
          replyText,
        };
        if (opts.dryRun) {
          candidates.push(cand);
        } else {
          try {
            const rid = await api.publish({ text: replyText, parentPostID: pk });
            if (rid) { sent.push(cand); answered.add(pk); }
            else skipped.push(`comment ${pk}: publish kosong`);
          } catch (e) {
            skipped.push(`comment ${pk}: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
          }
          await new Promise((r) => setTimeout(r, INTERVAL_MS));
        }
        if (sent.length + candidates.length >= cap) break;
      }
    }
  }
  return { candidates, published: sent, skipped };
}

export const AUTOREPLY_ENABLED = ENABLED;
export const AUTOREPLY_CAP = MAX_PER_RUN;

/**
 * Threads publishing over the real web app, driven by a zero-dep CDP session.
 *
 * Why browser automation instead of the API: Meta has not opened a public
 * Threads publishing API (threads_basic / threads_content_publish exist only
 * inside the Instagram-owned developer surface), and Composio carries no
 * Threads toolkit. The stable surface that does exist is the website itself.
 *
 * Credentials are never read from source. Order of resolution:
 *   1. THREADS_PASSWORD_FILE  — path to a 0600 file holding the password
 *   2. THREADS_PASSWORD       — env var (use only on a locked-down host)
 * A missing password is a hard error: this module never prompts, never types
 * from chat history, and never writes a credential anywhere.
 *
 * The session cookie lives in the persistent Chromium profile dir, so a
 * successful login survives restarts and publish does not re-authenticate.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Cdp } from "./cdp.ts";
import { loadCookiesForInjection } from "./threads-auth.ts";
import type { PublishResult, SocialContent } from "./types.ts";

const HOME = join(process.env.HOME || "/root", ".affiliate-tools");
export const THREADS_PROFILE_DIR = process.env.THREADS_PROFILE_DIR || join(HOME, "chromium-threads");
const SESSION_MARKER = join(THREADS_PROFILE_DIR, "session.json");

export const THREADS_USERNAME = process.env.THREADS_USERNAME || "karasu_michi";

/** Resolves the password without ever echoing it. */
export function resolveThreadsPassword(): string {
  const file = process.env.THREADS_PASSWORD_FILE;
  if (file) {
    if (!existsSync(file)) throw new Error(`THREADS_PASSWORD_FILE not found: ${file}`);
    return readFileSync(file, "utf8").trim();
  }
  const env = process.env.THREADS_PASSWORD;
  if (env) return env.trim();
  throw new Error(
    "no Threads password: set THREADS_PASSWORD_FILE (0600 file) or THREADS_PASSWORD. " +
      "Credentials are never accepted from chat and never stored in source.",
  );
}

function ensureProfileDir(): void {
  mkdirSync(THREADS_PROFILE_DIR, { recursive: true, mode: 0o700 });
}

/** A session is considered live only if it was captured by a successful login. */
export function hasSession(): boolean {
  return existsSync(SESSION_MARKER);
}

function markSession(username: string): void {
  ensureProfileDir();
  writeFileSync(
    SESSION_MARKER,
    JSON.stringify({ username, loggedInAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
}

/** Waits until the composer is reachable or the session is confirmed dead. */
async function isLoggedIn(cdp: Cdp): Promise<boolean> {
  await cdp.goto("https://www.threads.com/", 3000);
  const url = await cdp.evalJs<string>("location.href");
  if (url.includes("/login")) return false;
  const hasComposer = await cdp.evalJs<boolean>(
    `!!document.querySelector('[data-testid="compose-new-post-button"], a[href="/new-post"], [aria-label*="New post" i], [aria-label*="Create" i]')`,
  );
  return hasComposer || !url.includes("/login");
}

export interface ThreadsLoginResult {
  ok: boolean;
  username?: string;
  error?: string;
  needsManualStep?: boolean;
}

/**
 * Performs the password login. Headless is refused: Meta's login flow runs a
 * device/behaviour check that headless Chromium fails, and a visible window
 * lets the operator clear it. The browser window is left open for the manual
 * step and closed by the caller.
 */
export async function loginThreads(opts: { headless?: boolean; keepOpen?: boolean } = {}): Promise<ThreadsLoginResult> {
  if (opts.headless) {
    return {
      ok: false,
      error:
        "headless login is refused — Meta's login detects headless Chromium and " +
        "the visible window is needed to pass its check. Re-run without headless.",
      needsManualStep: true,
    };
  }

  ensureProfileDir();
  const cdp = await new Cdp({ profileDir: THREADS_PROFILE_DIR, headless: false }).start();

  try {
    await cdp.goto("https://www.threads.com/login", 4000);

    const alreadyIn = await isLoggedIn(cdp);
    if (alreadyIn) {
      markSession(THREADS_USERNAME);
      return { ok: true, username: THREADS_USERNAME };
    }

    const password = resolveThreadsPassword();

    // The form is plain: text username + password + submit, no iframe.
    await cdp.type('input[name="username"], input[type="text"]', THREADS_USERNAME);
    await cdp.type('input[type="password"]', password);
    await cdp.click('button[type="submit"], div[role="button"]:has-text("Log in")');

    // Meta may add a challenge. Give the operator a window to clear it.
    await new Promise((r) => setTimeout(r, 6000));

    const ok = await isLoggedIn(cdp);
    if (ok) {
      markSession(THREADS_USERNAME);
      return { ok: true, username: THREADS_USERNAME };
    }
    return {
      ok: false,
      error:
        "login not confirmed after submit — Meta likely showed a verification step. " +
        "Complete it in the Chromium window, then re-run; the session persists in the profile.",
      needsManualStep: true,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    if (!opts.keepOpen) await cdp.close();
  }
}

/**
 * Publishes a text/image post through the Threads web composer.
 *
 * Identity comes from the cookies the operator captured via /api/threads-auth,
 * injected through CDP before the first navigation. The password never reaches
 * this process.
 *
 * Threads has no image URL posting: media must be a real file, so an image
 * mediaUrl is fetched to disk first and pushed through the file input. Text is
 * set by React-safe value assignment.
 */
export async function publishThreads(content: SocialContent): Promise<PublishResult> {
  const cookies = loadCookiesForInjection();
  if (cookies.length === 0) {
    return { ok: false, error: "no captured Threads session — capture it first (Sosmed → Threads → Buat link auth)" };
  }

  const cdp = await new Cdp({ profileDir: THREADS_PROFILE_DIR, headless: true }).start();
  try {
    // Cookies must be set before any document on the target origin, so land on
    // the origin root first and inject there.
    await cdp.goto("https://www.threads.com/", 1500);
    await cdp.setCookies(cookies as Parameters<Cdp["setCookies"]>[0]);

    const live = await isLoggedIn(cdp);
    if (!live) {
      return { ok: false, error: "Threads session is not live — captured cookie may have expired; capture again" };
    }

    // Open the composer directly; the site routes /new-post to the compose view.
    await cdp.goto("https://www.threads.com/new-post", 3500);

    const composerSel =
      '[data-testid="compose-text-input"], textarea[placeholder*="thread" i], div[contenteditable="true"][role="textbox"]';
    await cdp.waitForSelector(composerSel, 15000);

    const text = (content.text || "").slice(0, 500);
    await cdp.type(composerSel, text);

    if (content.mediaUrl && (content.mediaKind === "image" || !content.mediaKind)) {
      const fileInput =
        'input[type="file"][accept*="image"], input[type="file"]';
      await cdp.waitForSelector(fileInput, 8000);
      const localPath = await fetchMediaToTemp(content.mediaUrl);
      if (localPath) {
        await cdp.setFiles(fileInput, [localPath]);
        await new Promise((r) => setTimeout(r, 3000)); // upload + preview render
      }
    }

    const postBtn =
      '[data-testid="compose-post-button"], div[role="button"]:has-text("Post"), button:has-text("Post")';
    await cdp.waitForSelector(postBtn, 8000);
    await cdp.click(postBtn);
    await new Promise((r) => setTimeout(r, 6000));

    // Confirmation: the app navigates away from the composer on success.
    const url = await cdp.evalJs<string>("location.href");
    const stillComposing = url.includes("/new-post") || (await cdp.evalJs<boolean>(`!!document.querySelector(${JSON.stringify(composerSel)})`));
    if (stillComposing) {
      return { ok: false, error: "post not accepted — composer still open (dialog, size limit or upload failed)" };
    }

    return {
      ok: true,
      url,
      evidence: { postedAt: new Date().toISOString() },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await cdp.close();
  }
}

/** Downloads a media URL into the private temp area. Returns null on failure. */
async function fetchMediaToTemp(mediaUrl: string): Promise<string | null> {
  try {
    const dir = join(HOME, "tmp-media");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const ext = (mediaUrl.split("?")[0].match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || "jpg").toLowerCase();
    const dest = join(dir, `threads-${Date.now()}.${ext}`);
    const r = await fetch(mediaUrl, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1024) return null; // too small: an error page, not an image
    writeFileSync(dest, buf, { mode: 0o600 });
    return dest;
  } catch {
    return null;
  }
}

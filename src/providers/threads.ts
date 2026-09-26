/**
 * Threads adapter — BROWSER-EXECUTED.
 *
 * Composio has no Threads toolkit and Meta exposes no public posting API, so
 * this provider publishes through the real Threads website, driven by the
 * zero-dep CDP session in `threads-browser.ts`. The credential never enters
 * source, chat, or logs; it is resolved from THREADS_PASSWORD_FILE at call
 * time.
 *
 * Until a login has been performed once (Chromium profile + session marker),
 * the adapter stays BOUNDARY-DISABLED so the UI cannot offer a publish that
 * would certainly fail. After login it reports VERIFIED-EXECUTED and enables
 * text + image publishing, which are the two paths the browser composer
 * actually supports.
 */

import { hasSession, publishThreads, THREADS_USERNAME } from "../core/threads-browser.ts";
import type {
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
  VerificationStatus,
} from "../core/types.ts";

const LIVE = hasSession();

const CAPABILITIES = {
  textPost: LIVE,
  imagePost: LIVE,
  videoPost: false, // composer accepts video, but the file-input path is unverified
  carouselPost: false,
  scheduledPost: false, // the web composer has no schedule control
  postStatus: false,
  analytics: false,
  connect: true,
};

const NOT_LOGGED_IN =
  "Threads browser session not established. Run the login once (visible Chromium window) " +
  "so the session cookie is stored in the persistent profile; after that publishing works headless.";

export class ThreadsAdapter implements SocialProvider {
  readonly slug = "threads";
  readonly displayName = "Threads";
  readonly capabilities = CAPABILITIES;

  get status(): VerificationStatus {
    return LIVE ? "VERIFIED-EXECUTED" : "BOUNDARY-DISABLED";
  }

  get blockedReason(): string | undefined {
    return LIVE ? undefined : NOT_LOGGED_IN;
  }

  async connect(): Promise<void> {}

  async getAccount(): Promise<SocialAccount | null> {
    if (!LIVE) return null;
    return {
      id: `threads:${THREADS_USERNAME}`,
      username: THREADS_USERNAME,
      displayName: `@${THREADS_USERNAME}`,
      kind: "profile",
    };
  }

  validateContent(content: SocialContent): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!content.text || !content.text.trim()) errors.push("Threads posts need text");
    if (content.text && content.text.length > 500) errors.push("Threads text limit is 500 characters");
    if (content.mediaKind === "video" || content.mediaKind === "carousel") {
      errors.push("video and carousel are not supported by the Threads browser path");
    }
    if (!LIVE) errors.push(NOT_LOGGED_IN);
    return Promise.resolve({ ok: errors.length === 0, errors });
  }

  async publish(content: SocialContent): Promise<PublishResult> {
    const check = await this.validateContent(content);
    if (!check.ok) return { ok: false, error: check.errors.join("; ") };
    return publishThreads(content);
  }
}

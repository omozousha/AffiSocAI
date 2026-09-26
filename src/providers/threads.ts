/**
 * Threads adapter — BROWSER-EXECUTED.
 *
 * Composio has no Threads toolkit and Meta exposes no public posting API, so
 * this provider publishes through the real Threads website, driven by the
 * zero-dep CDP session in `threads-browser.ts`.
 *
 * Credential path is deliberately indirect: no password is ever held by this
 * server. The operator establishes the session once from their own browser via
 * `/api/threads-auth`, and `hasCapturedSession()` decides whether the adapter
 * is live. The captured cookie names (never their values) are surfaced for
 * diagnosis.
 */

import { publishThreads, THREADS_USERNAME } from "../core/threads-browser.ts";
import {
  capturedCookieNames,
  hasCapturedSession,
  sessionFingerprint,
} from "../core/threads-auth.ts";
import type {
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
  VerificationStatus,
} from "../core/types.ts";

const NO_SESSION =
  "Threads session not captured. In Sosmed → Threads → “Buat link auth”, buka link itu " +
  "di browser yang sudah login Threads, lalu klik “Menangkap sesi Threads”. " +
  "Password tidak pernah dikirim ke server ini.";

export class ThreadsAdapter implements SocialProvider {
  readonly slug = "threads";
  readonly displayName = "Threads";

  get capabilities() {
    const live = hasCapturedSession();
    return {
      textPost: live,
      imagePost: live,
      videoPost: false, // composer accepts video, but the file-input path is unverified
      carouselPost: false,
      scheduledPost: false, // the web composer has no schedule control
      postStatus: false,
      analytics: false,
      connect: true,
    };
  }

  get status(): VerificationStatus {
    return hasCapturedSession() ? "VERIFIED-EXECUTED" : "BOUNDARY-DISABLED";
  }

  get blockedReason(): string | undefined {
    if (hasCapturedSession()) return undefined;
    return NO_SESSION;
  }

  /** Diagnostic breadcrumb — cookie names only, values never leave the store. */
  get sessionInfo() {
    return {
      live: hasCapturedSession(),
      username: THREADS_USERNAME,
      cookieNames: capturedCookieNames(),
      fingerprint: sessionFingerprint(),
    };
  }

  async connect(): Promise<void> {}

  async getAccount(): Promise<SocialAccount | null> {
    if (!hasCapturedSession()) return null;
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
    if (!hasCapturedSession()) errors.push(NO_SESSION);
    return Promise.resolve({ ok: errors.length === 0, errors });
  }

  async publish(content: SocialContent): Promise<PublishResult> {
    const check = await this.validateContent(content);
    if (!check.ok) return { ok: false, error: check.errors.join("; ") };
    return publishThreads(content);
  }
}

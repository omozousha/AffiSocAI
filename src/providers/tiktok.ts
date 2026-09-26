/**
 * TikTok adapter — DEFERRED BY OPERATOR DECISION 2026-09-25.
 *
 * The TikTok toolkit is verified to exist in Composio (9 tools, schema
 * inspected) and supports video publish by URL pull, video file upload, photo
 * posts (1-35 images), and publish-status polling. Publishing has NOT been
 * linked or executed.
 *
 * Constraints discovered during schema inspection, recorded so the eventual
 * implementation does not rediscover them:
 *  - TIKTOK_POST_PHOTO: photo URLs must be from a TikTok-verified domain or
 *    the call returns 403; unaudited apps can only post privacy='SELF_ONLY';
 *    rate limit 6 requests/minute per user access token.
 *  - TIKTOK_PUBLISH_VIDEO pulls from a public URL; TIKTOK_UPLOAD_VIDEO is the
 *    file-upload path (presigned PUT, sequential ranges).
 *  - Publishing is async: poll TIKTOK_FETCH_PUBLISH_STATUS with the returned
 *    publish_id using exponential backoff (5s/10s/20s) against a 30 req/min
 *    per-token limit. Never re-initiate publish for the same publish_id.
 *
 * No account is connected: `composio link tiktok` has not been run.
 */

import type {
  PostStatus,
  ProviderCapabilities,
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
} from "../core/types.ts";

const DEFERRED =
  "TikTok: deferred by operator decision 2026-09-25. Toolkit verified present " +
  "(9 tools) but no account linked — run `composio link tiktok` to enable.";

const CAPABILITIES: ProviderCapabilities = {
  textPost: false, // TikTok has no text-only post type
  imagePost: true,
  videoPost: true,
  carouselPost: false,
  scheduledPost: false,
  postStatus: true, // TIKTOK_FETCH_PUBLISH_STATUS by publish_id
  analytics: true, // TIKTOK_GET_USER_STATS
  connect: false, // not linked
};

export class TikTokAdapter implements SocialProvider {
  readonly slug = "tiktok";
  readonly displayName = "TikTok";
  readonly capabilities = CAPABILITIES;
  readonly status = "BOUNDARY-DISABLED";
  readonly blockedReason = DEFERRED;

  async connect(): Promise<void> {
    throw new Error(DEFERRED);
  }

  async getAccount(): Promise<SocialAccount | null> {
    return null;
  }

  async validateContent(_content: SocialContent): Promise<ValidationResult> {
    return { ok: false, errors: [DEFERRED] };
  }

  async publish(_content: SocialContent): Promise<PublishResult> {
    return { ok: false, error: DEFERRED };
  }

  async getPostStatus(_postId: string): Promise<PostStatus> {
    return { postId: _postId, state: "unknown", detail: DEFERRED };
  }
}

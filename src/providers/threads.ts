/**
 * Threads adapter — BOUNDARY-DISABLED.
 *
 * Facts established 2026-09-25:
 *  - Composio has no `threads` toolkit. `composio tools list threads` returns
 *    0 bytes; six slug variants probed empty.
 *  - The facebook and instagram toolkits contain ZERO Threads actions — Meta
 *    OAuth scopes for Threads (threads_basic, threads_content_publish) are
 *    separate from Instagram/Facebook credentials and are not interchangeable.
 *  - The one available route is the `postpone` toolkit (7 tools), whose platform
 *    enum includes "threads". Postpone is a social-management platform, so the
 *    Threads account must be connected inside Postpone first; Composio then
 *    acts through the Postpone token.
 *
 * Until `composio link postpone` has been completed, every capability is
 * disabled and the UI must not offer Threads publishing. The adapter exists so
 * the application shape is complete and flips on without refactoring.
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

const BLOCKED =
  "Threads: no native Composio toolkit, and Meta OAuth scopes are not shared with " +
  "Instagram/Facebook. Route is the `postpone` toolkit — run `composio link postpone` " +
  "then connect the Threads account inside Postpone.";

const CAPABILITIES: ProviderCapabilities = {
  textPost: false,
  imagePost: false,
  videoPost: false,
  carouselPost: false,
  scheduledPost: false,
  postStatus: false,
  analytics: false,
  connect: false,
};

export class ThreadsAdapter implements SocialProvider {
  readonly slug = "threads";
  readonly displayName = "Threads";
  readonly capabilities = CAPABILITIES;
  readonly status = "BOUNDARY-DISABLED";
  readonly blockedReason = BLOCKED;

  async connect(): Promise<void> {
    throw new Error(BLOCKED);
  }

  async getAccount(): Promise<SocialAccount | null> {
    return null;
  }

  async validateContent(_content: SocialContent): Promise<ValidationResult> {
    return { ok: false, errors: [BLOCKED] };
  }

  async publish(_content: SocialContent): Promise<PublishResult> {
    return { ok: false, error: BLOCKED };
  }

  async getPostStatus(_postId: string): Promise<PostStatus> {
    return { postId: _postId, state: "unknown", detail: BLOCKED };
  }
}

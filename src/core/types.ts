/**
 * Core types — the contract every provider adapter implements.
 * Capabilities are declared per-provider: the UI must not render an
 * option the provider cannot execute.
 */

export type MediaKind = "text" | "image" | "video" | "carousel";

export interface SocialAccount {
  id: string;
  username: string;
  displayName: string;
  kind: string; // "creator" | "page" | "profile"
  followerCount?: number;
}

export interface SocialContent {
  text: string;
  mediaUrl?: string;
  mediaKind?: MediaKind;
  /** Additional media for carousel posts (2-10 items). */
  mediaUrls?: string[];
  /** Unix seconds. When set the provider must support scheduling. */
  scheduledAt?: number;
  link?: string;
}

export type VerificationStatus =
  | "VERIFIED-EXECUTED" // live-executed against the real account
  | "VERIFIED-VIA-SCHEMA" // schema inspected, not executed
  | "BOUNDARY-DISABLED"; // adapter exists, intentionally not usable yet

export interface ProviderCapabilities {
  textPost: boolean;
  imagePost: boolean;
  videoPost: boolean;
  carouselPost: boolean;
  scheduledPost: boolean;
  postStatus: boolean;
  analytics: boolean;
  connect: boolean;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export interface PostStatus {
  postId: string;
  state: "published" | "processing" | "failed" | "unknown";
  detail?: string;
}

export interface PostAnalytics {
  postId: string;
  metrics: Record<string, number>;
}

export interface PublishResult {
  ok: boolean;
  postId?: string;
  url?: string;
  /** Set when the platform accepted the request but processing is async. */
  pending?: boolean;
  error?: string;
  /** Raw provider response, kept for evidence and debugging. */
  evidence?: unknown;
}

export interface SocialProvider {
  readonly slug: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;
  readonly status: VerificationStatus;
  /** Reason the provider is unavailable, when it is. */
  readonly blockedReason?: string;
  connect(): Promise<void>;
  getAccount(): Promise<SocialAccount | null>;
  validateContent(content: SocialContent): Promise<ValidationResult>;
  publish(content: SocialContent): Promise<PublishResult>;
  getPostStatus?(postId: string): Promise<PostStatus>;
  getAnalytics?(postId: string): Promise<PostAnalytics>;
}

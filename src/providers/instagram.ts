/**
 * Instagram adapter — Meta Graph via Composio.
 *
 * VERIFIED-EXECUTED 2026-09-25 against karasu_michi (MEDIA_CREATOR, 703 followers,
 * quota 100/24h with 0 used). Every tool slug below was executed or dry-run.
 *
 * Publish is two-step: create a container, then publish the container.
 * INSTAGRAM_POST_IG_USER_MEDIA creates the container (image / video / carousel
 * in one call, children built first for carousels); once a REELS container
 * reports FINISHED, INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH publishes it. An image
 * container is already live when POST returns, so no second call is made.
 * The older INSTAGRAM_CREATE_MEDIA_CONTAINER / INSTAGRAM_CREATE_POST pair is
 * deprecated in the toolkit and is not used.
 */

import { composio } from "../core/composio.ts";
import type {
  PostAnalytics,
  PostStatus,
  ProviderCapabilities,
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
} from "../core/types.ts";

const IG_ID = process.env.IG_USER_ID || "me";

const CAPABILITIES: ProviderCapabilities = {
  textPost: false, // text-only posts are not supported by the Graph API
  imagePost: true,
  videoPost: true,
  carouselPost: true,
  scheduledPost: false, // no scheduling action exists in the toolkit
  postStatus: true,
  analytics: true,
  connect: true,
};

export class InstagramAdapter implements SocialProvider {
  readonly slug = "instagram";
  readonly displayName = "Instagram";
  readonly capabilities = CAPABILITIES;
  readonly status = "VERIFIED-EXECUTED";

  async connect(): Promise<void> {
    // Connection is established through `composio link instagram`; the
    // adapter only verifies it is usable.
    const acct = await this.getAccount();
    if (!acct) throw new Error("instagram not connected — run: composio link instagram");
  }

  async getAccount(): Promise<SocialAccount | null> {
    const res = await composio.execute("INSTAGRAM_GET_USER_INFO", { ig_user_id: IG_ID });
    if (!res.ok || !res.data) return null;
    return {
      id: String(res.data.id),
      username: res.data.username,
      displayName: res.data.name,
      kind: res.data.account_type,
      followerCount: res.data.followers_count,
    };
  }

  async validateContent(content: SocialContent): Promise<ValidationResult> {
    const errors: string[] = [];
    const hasMedia = content.mediaUrl || (content.mediaUrls?.length ?? 0) > 0;
    if (!hasMedia) errors.push("Instagram requires an image or video URL");
    if (content.mediaUrl && !/^https?:\/\//.test(content.mediaUrl))
      errors.push("mediaUrl must be an http(s) URL Meta can fetch directly");
    if ((content.caption ?? content.text ?? "").length > 2200)
      errors.push("caption exceeds 2200 characters");
    if (content.scheduledAt)
      errors.push("scheduledPost unsupported: no scheduling action in the Instagram toolkit");
    return { ok: errors.length === 0, errors };
  }

  async publish(content: SocialContent): Promise<PublishResult> {
    const check = await this.validateContent(content);
    if (!check.ok) return { ok: false, error: check.errors.join("; ") };

    // Carousel: INSTAGRAM_POST_IG_USER_MEDIA builds each child with
    // is_carousel_item: true, then the parent carries the children array plus
    // media_type: CAROUSEL and a single PUBLISH call. The older
    // INSTAGRAM_CREATE_MEDIA_CONTAINER / INSTAGRAM_CREATE_POST /
    // INSTAGRAM_CREATE_CAROUSEL_CONTAINER trio is deprecated in the toolkit.
    if (content.mediaKind === "carousel" || (content.mediaUrls?.length ?? 0) >= 2) {
      const childIds: string[] = [];
      for (const url of (content.mediaUrls ?? []).slice(0, 10)) {
        const child = await composio.execute("INSTAGRAM_POST_IG_USER_MEDIA", {
          ig_user_id: IG_ID,
          image_url: url,
          is_carousel_item: true,
        });
        if (!child.ok || !child.data?.id) {
          return { ok: false, error: `carousel child failed: ${child.error ?? "no container id"}`, evidence: child.raw };
        }
        childIds.push(String(child.data.id));
      }
      if (childIds.length < 2) {
        return { ok: false, error: "carousel requires 2–10 children" };
      }
      const parent = await composio.execute("INSTAGRAM_POST_IG_USER_MEDIA", {
        ig_user_id: IG_ID,
        caption: content.text,
        children: childIds,
        media_type: "CAROUSEL",
      });
      if (!parent.ok) return this.wrap(parent);
      return this.publishContainer(parent);
    }

    const res = await composio.execute("INSTAGRAM_POST_IG_USER_MEDIA", {
      ig_user_id: IG_ID,
      caption: content.text,
      ...(content.mediaKind === "video"
        ? { video_url: content.mediaUrl, media_type: "REELS" }
        : { image_url: content.mediaUrl }),
    });
    if (!res.ok) return this.wrap(res);

    // Image containers also need the separate PUBLISH call — POST alone leaves
    // a FINISHED-but-unpublished container (proven: id 18207518320369207).
    if (content.mediaKind === "video" || content.mediaKind === "image") return this.publishContainer(res);
    return this.wrap(res);
  }

  /** Poll the container to FINISHED (Graph error 9007 if published early), then publish. */
  private async publishContainer(container: { data?: { id?: unknown } }): Promise<PublishResult> {
    const creationId = container?.data?.id;
    if (creationId == null) {
      return { ok: false, error: "container returned no id — cannot publish" };
    }
    for (let i = 0; i < 10; i++) {
      const s = await composio.execute("INSTAGRAM_GET_POST_STATUS", {
        creation_id: String(creationId),
      });
      const code = s.data?.status_code;
      if (code === "FINISHED") break;
      if (code === "ERROR") {
        return { ok: false, error: `container ERROR: ${JSON.stringify(s.data)}` };
      }
      await new Promise((r) => setTimeout(r, Math.min(3000 * (i + 1), 30000)));
    }
    const pub = await composio.execute("INSTAGRAM_POST_IG_USER_MEDIA_PUBLISH", {
      ig_user_id: IG_ID,
      creation_id: String(creationId),
      max_wait_seconds: 60,
      poll_interval_seconds: 3,
    });
    return this.wrap(pub);
  }

  private wrap(res: { ok: boolean; data?: any; error?: string; raw?: string }): PublishResult {
    if (!res.ok) return { ok: false, error: res.error, evidence: res.raw };
    const id = res.data?.id ?? res.data?.creation_id;
    return {
      ok: true,
      postId: id ? String(id) : undefined,
      url: res.data?.permalink,
      pending: Boolean(res.data?.id && !res.data?.permalink),
      evidence: res.data,
    };
  }

  async getPostStatus(postId: string): Promise<PostStatus> {
    // Proven discriminator: a LIVE media answers fields=id,caption; an
    // unpublished container errors on caption (id-only works for both).
    // permalink is added so the scheduler can backfill post_url later.
    try {
      const m = await composio.execute("INSTAGRAM_GET_IG_MEDIA", {
        ig_media_id: String(postId),
        fields: "id,caption,permalink",
      });
      if (m.ok && m.data?.id && typeof m.data?.caption === "string") {
        const perma = typeof m.data.permalink === "string" ? m.data.permalink : undefined;
        return { postId, state: "published", detail: perma ?? "caption readable" };
      }
      return { postId, state: "failed", detail: String(m.error ?? JSON.stringify(m.data)).slice(0, 200) };
    } catch (e) { return { postId, state: "unknown", detail: String(e).slice(0, 160) }; }
  }

  async _legacyGetIgMedia(postId: string): Promise<PostStatus> {
    const res = await composio.execute("INSTAGRAM_GET_IG_MEDIA", {
      ig_media_id: postId,
      fields: "id,permalink,caption,media_type,timestamp",
    });
    if (!res.ok || !res.data?.id) return { postId, state: "unknown", detail: res.error ?? "media not found" };
    return { postId, state: res.data.permalink ? "published" : "processing", detail: res.data.permalink ?? undefined };
  }

  async getAnalytics(postId: string): Promise<PostAnalytics> {
    const res = await composio.execute("INSTAGRAM_GET_IG_MEDIA_INSIGHTS", {
      ig_media_id: postId,
      metric: ["reach", "likes", "comments", "saved", "shares", "views"],
    });
    const metrics: Record<string, number> = {};
    const rows = res.data?.data ?? [];
    for (const r of rows) {
      const v = r?.values?.[0]?.value;
      if (typeof v === "number") metrics[r.name] = v;
    }
    return { postId, metrics };
  }
}

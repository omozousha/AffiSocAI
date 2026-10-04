/**
 * Facebook adapter — Meta Graph Pages via Composio.
 *
 * VERIFIED-EXECUTED 2026-09-25: FACEBOOK_LIST_MANAGED_PAGES returned
 * "Karasu Michi Store" (601273259729056) with tasks MODERATE, MESSAGING,
 * ANALYZE, ADVERTISE, CREATE_CONTENT, MANAGE, MANAGE_LEADS → publishing is
 * permitted. Page id is resolved dynamically at runtime rather than pinned,
 * so the adapter works for any managed page.
 */

import { composio } from "../core/composio.ts";
import type {
  PostAnalytics,
  ProviderCapabilities,
  PublishResult,
  SocialAccount,
  SocialContent,
  SocialProvider,
  ValidationResult,
} from "../core/types.ts";

const CAPABILITIES: ProviderCapabilities = {
  textPost: true,
  imagePost: true,
  videoPost: true,
  carouselPost: true,
  scheduledPost: true, // scheduled_publish_time, min 10 minutes ahead
  postStatus: true, // FACEBOOK_GET_POST + FACEBOOK_GET_POST_INSIGHTS
  analytics: true,
  connect: true,
};

export class FacebookAdapter implements SocialProvider {
  readonly slug = "facebook";
  readonly displayName = "Facebook";
  readonly capabilities = CAPABILITIES;
  readonly status = "VERIFIED-EXECUTED";

  /** Resolved lazily; the first managed page is the default target. */
  private pageId: string | null = process.env.FB_PAGE_ID || null;

  private async resolvePageId(): Promise<string> {
    if (this.pageId) return this.pageId;
    const res = await composio.execute("FACEBOOK_LIST_MANAGED_PAGES", {});
    const first = res.data?.data?.[0];
    if (!first?.id) throw new Error("no managed Facebook page found — connect an account that manages a page");
    this.pageId = String(first.id);
    return this.pageId;
  }

  async connect(): Promise<void> {
    await this.resolvePageId();
  }

  async getAccount(): Promise<SocialAccount | null> {
    try {
      const id = await this.resolvePageId();
      const res = await composio.execute("FACEBOOK_GET_PAGE_DETAILS", { page_id: id });
      return {
        id,
        username: res.data?.username ?? res.data?.name ?? id,
        displayName: res.data?.name ?? "Facebook Page",
        kind: "page",
        followerCount: res.data?.fan_count,
      };
    } catch {
      return null;
    }
  }

  async validateContent(content: SocialContent): Promise<ValidationResult> {
    const errors: string[] = [];
    if (!(content.text ?? "").trim() && !content.link && !content.mediaUrl)
      errors.push("one of message, link, or media is required");
    if (content.scheduledAt && content.scheduledAt < Date.now() / 1000 + 600)
      errors.push("scheduled_publish_time must be at least 10 minutes in the future");
    return { ok: errors.length === 0, errors };
  }

  async publish(content: SocialContent): Promise<PublishResult> {
    const check = await this.validateContent(content);
    if (!check.ok) return { ok: false, error: check.errors.join("; ") };

    const pageId = await this.resolvePageId();

    // Pick the tool by media shape. Each tool takes a different field name —
    // photo post uses `url`, video uses `file_url`, multi-photo uses
    // `photo_urls` (array, required) — verified against each tool schema.
    let slug = "FACEBOOK_CREATE_POST";
    const body: Record<string, unknown> = { page_id: pageId, message: content.text };
    if ((content.mediaUrls?.length ?? 0) > 1) {
      slug = "FACEBOOK_CREATE_MULTI_PHOTO_POST";
      body.photo_urls = (content.mediaUrls ?? []).slice(0, 10);
    } else if (content.mediaUrl) {
      if (content.mediaKind === "video") {
        slug = "FACEBOOK_CREATE_VIDEO_POST";
        body.file_url = content.mediaUrl;
      } else {
        slug = "FACEBOOK_CREATE_PHOTO_POST";
        body.url = content.mediaUrl;
      }
    } else if (content.link) {
      slug = "FACEBOOK_CREATE_POST";
      body.link = content.link;
    }

    if (content.scheduledAt) {
      body.published = false;
      body.scheduled_publish_time = content.scheduledAt;
    }

    const res = await composio.execute(slug, body);
    if (!res.ok) return { ok: false, error: res.error, evidence: res.raw };
    return {
      ok: true,
      postId: res.data?.id ? String(res.data.id) : undefined,
      url: res.data?.permalink_url,
      pending: Boolean(content.scheduledAt),
      evidence: res.data,
    };
  }

  async getPostStatus(postId: string): Promise<PostStatus> {
    // FACEBOOK_GET_POST demands full format "pageId_postId"; publish() stored
    // the bare media id (proven live: "Invalid post_id format: '1221…'").
    // Complete it here so permalink backfill stops erroring every retry.
    let id = postId;
    if (!id.includes("_")) {
      try {
        id = `${await this.resolvePageId()}_${postId}`;
      } catch { /* keep raw id — the call will fail as before, cooldown parks it */ }
    }
    const res = await composio.execute("FACEBOOK_GET_POST", { post_id: id });
    return {
      postId,
      state: res.ok ? "published" : "unknown",
      detail: res.ok ? undefined : res.error,
    };
  }

  async getAnalytics(postId: string): Promise<PostAnalytics> {
    let id = postId;
    if (!id.includes("_")) {
      try {
        id = `${await this.resolvePageId()}_${postId}`;
      } catch { /* raw id, same graceful failure */ }
    }
    const res = await composio.execute("FACEBOOK_GET_POST_INSIGHTS", { post_id: id });
    const metrics: Record<string, number> = {};
    for (const r of res.data?.data ?? []) {
      const v = r?.values?.[0]?.value;
      if (typeof v === "number") metrics[r.name] = v;
    }
    return { postId, metrics };
  }
}

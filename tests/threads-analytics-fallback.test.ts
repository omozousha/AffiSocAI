import { describe, it } from "node:test";
import assert from "node:assert/strict";

/** Fake ThreadsAdapter-compatible provider to exercise analytics fallback. */
class FakeThreadsProvider {
  public calls: string[] = [];
  private mode: "insights" | "forbidden";
  constructor(mode: "insights" | "forbidden") {
    this.mode = mode;
  }
  async graphGet(path: string, query: Record<string, string>) {
    this.calls.push(path);
    if (path.endsWith("/insights") && this.mode === "forbidden") {
      throw new Error("403 Application does not have permission");
    }
    if (path.endsWith("/insights")) {
      return { data: [{ name: "views", values: [{ value: 120 }] }] };
    }
    if (path.endsWith("/replies")) {
      return { data: [{ id: "1" }, { id: "2" }] };
    }
    return { data: [] };
  }
}

/** Replicates the fallback logic added to ThreadsAdapter.getAnalytics. */
async function getAnalyticsWithFallback(
  postId: string,
  provider: FakeThreadsProvider,
  token: string,
) {
  try {
    const res = await provider.graphGet(`/v1.0/${postId}/insights`, {
      metric: "views,likes,replies,reposts,quotes",
      access_token: token,
    });
    const metrics: Record<string, number> = {};
    for (const row of res.data ?? []) {
      const v = row?.values?.[0]?.value;
      if (typeof v === "number") metrics[row.name] = v;
    }
    return { postId, metrics };
  } catch {
    try {
      const rep = await provider.graphGet(`/v1.0/${postId}/replies`, {
        fields: "id",
        access_token: token,
      });
      const count = Array.isArray(rep.data) ? rep.data.length : 0;
      return { postId, metrics: { replies: count, views: 0, likes: 0 } };
    } catch {
      return { postId, metrics: {} };
    }
  }
}

describe("Threads analytics fallback", () => {
  it("uses insights when scope is granted", async () => {
    const provider = new FakeThreadsProvider("insights");
    const result = await getAnalyticsWithFallback("123", provider, "tok");
    assert.deepEqual(result.metrics, { views: 120 });
    assert.deepEqual(provider.calls, ["/v1.0/123/insights"]);
  });

  it("falls back to replies count when insights is 403", async () => {
    const provider = new FakeThreadsProvider("forbidden");
    const result = await getAnalyticsWithFallback("123", provider, "tok");
    assert.equal(result.metrics.replies, 2);
    assert.equal(result.metrics.views, 0);
    assert.deepEqual(provider.calls, ["/v1.0/123/insights", "/v1.0/123/replies"]);
  });

  it("returns empty metrics when both fail", async () => {
    const provider = new FakeThreadsProvider("forbidden");
    const orig = provider.graphGet.bind(provider);
    provider.graphGet = async (path: string, q: Record<string, string>) => {
      if (path.endsWith("/replies")) throw new Error("401");
      return orig(path, q);
    };
    const result = await getAnalyticsWithFallback("123", provider, "tok");
    assert.deepEqual(result.metrics, {});
  });
});

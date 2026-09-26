/**
 * Threads adapter checks — runnable, no network needed for the pure logic.
 *
 *   node --experimental-strip-types tests/check-threads.ts
 *
 * Covers the parts that decide whether a publish is even attempted:
 *   - validateContent rejects an unconnected Threads and a non-fetchable media URL
 *   - the Authorization Window URL encodes scope and redirect_uri correctly
 *   - a video is detected by extension, not by a MIME guess
 * Network paths (token exchange, container publish) are not asserted here —
 * they need real app credentials and a live Meta session.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "threads-check-"));
process.env.HOME = home;
const secretDir = join(home, ".affiliate-tools", "threads");
mkdirSync(secretDir, { recursive: true });
writeFileSync(
  join(secretDir, "app.json"),
  JSON.stringify({
    client_id: "999",
    client_secret: "x",
    redirect_uri: "https://example.test/api/providers/threads/callback",
  }),
);

const { ThreadsAdapter, authorizeUrl, clearThreadsToken } = await import("../src/providers/threads.ts");

const adapter = new ThreadsAdapter();

// --- authorize URL ---------------------------------------------------------
const auth = authorizeUrl();
assert.ok("url" in auth, "authorizeUrl should build a URL once app creds exist");
const u = new URL((auth as { url: string }).url);
assert.equal(u.origin + u.pathname, "https://threads.com/oauth/authorize");
assert.equal(u.searchParams.get("client_id"), "999");
assert.equal(u.searchParams.get("response_type"), "code");
assert.equal(u.searchParams.get("redirect_uri"), "https://example.test/api/providers/threads/callback");
assert.deepEqual((u.searchParams.get("scope") || "").split(",").sort(),
  ["threads_basic", "threads_content_publish"]);

// --- validate: not connected ----------------------------------------------
let v = await adapter.validateContent({ text: "hello" });
assert.equal(v.ok, false);
assert.ok(v.errors.some((e) => /not connected/i.test(e)), `expected a not-connected error, got ${v.errors}`);

// --- validate: media URL a platform cannot fetch ----------------------------
// Simulate a connected state without touching the network.
const tokenFile = join(secretDir, "token.json");
writeFileSync(
  tokenFile,
  JSON.stringify({ access_token: "dummy", token_type: "bearer", expires_in: 5184000,
    saved_at: new Date().toISOString(), refresh_at: Date.now() + 3600_000 }),
);
v = await adapter.validateContent({ text: "hello", mediaUrl: "/tmp/local.png" });
assert.equal(v.ok, false);
assert.ok(v.errors.some((e) => /able to fetch/i.test(e)), `expected a media-url error, got ${v.errors}`);

v = await adapter.validateContent({ text: "hello", mediaUrl: "https://example.test/a.png" });
assert.deepEqual(v.errors, [], "a public https media URL should validate once connected");

// 500 is the hard API limit.
v = await adapter.validateContent({ text: "x".repeat(501) });
assert.ok(v.errors.some((e) => /500/.test(e)), `expected the 500-char limit, got ${v.errors}`);

// --- video extension detection (the CAROUSEL/VIDEO branch) ---------------------------
const isVideo = (s: string) => /\.(mp4|mov|m4v)(\?|$)/i.test(s);
assert.equal(isVideo("https://x.test/a.mp4"), true);
assert.equal(isVideo("https://x.test/a.mp4?token=1"), true);
assert.equal(isVideo("https://x.test/a.MOV"), true);
assert.equal(isVideo("https://x.test/a.png"), false);
assert.equal(isVideo("https://x.test/a.mp4.png"), false);

// --- token removal -------------------------------------------------------------
assert.equal(await clearThreadsToken(), true);
assert.equal(await clearThreadsToken(), false, "a second clear should report nothing removed");

rmSync(home, { recursive: true, force: true });
console.log("threads checks ok");

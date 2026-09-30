#!/usr/bin/env node
/**
 * Threads Unofficial — login test + one-shot publish
 * Usage:
 *   THREADS_USERNAME=xxx THREADS_PASSWORD=xxx node --experimental-strip-types scripts/threads-login.ts [post]
 *   THREADS_USERNAME=xxx THREADS_PASSWORD=xxx node --experimental-strip-types scripts/threads-login.ts post "test caption" "https://.../img.jpg"
 *
 * Env only — no file is written unless --save is passed.
 * --save  writes session to ~/.affiliate-tools/threads-unofficial/session.json
 * --login  only login (no post)
 */

const { createRequire } = await import("node:module");
const req = createRequire(import.meta.url);

const ThreadsAPI = (req("threads-api") as any).ThreadsAPI;

const username = String(process.env.THREADS_USERNAME || "").trim();
const password = String(process.env.THREADS_PASSWORD || "").trim();
const save = process.argv.includes("--save");
const onlyLogin = process.argv.includes("--login") || process.argv.length === 2;
const caption = process.argv[process.argv.indexOf("post") + 1] || "test from affiliate-tools";
const mediaUrl = process.argv[process.argv.indexOf("post") + 2] || "";

if (!username || !password) {
  console.error("Missing THREADS_USERNAME / THREADS_PASSWORD");
  process.exit(1);
}

async function main() {
  try {
    const api = new ThreadsAPI({ username, password, verbose: false });
    const res = await api.login();
    console.log("login ok:", { token: res.token?.slice(0, 12) + "...", userID: res.userID });

    // Quick profile check
    const uid = res.userID || await api.getCurrentUserID();
    if (uid) {
      try {
        const u = await api.getUserProfile(uid);
        console.log("account:", { username: u.username, name: u.full_name, followers: u.follower_count });
      } catch (e) {
        console.warn("profile check skipped:", e?.message || e);
      }
    }

    if (save && res.token) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      const path = req("path").join(process.env.HOME || "/root", ".affiliate-tools", "threads-unofficial", "session.json");
      mkdirSync(req("path").dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, JSON.stringify({ token: res.token, userID: res.userID, username, saved_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
      console.log("session saved:", path);
    }

    if (!onlyLogin && mediaUrl) {
      const postId = await api.publish({ text: caption, attachment: { image: mediaUrl } });
      console.log("published:", postId);
    } else if (!onlyLogin) {
      console.log("no mediaUrl — skipping post");
    }
  } catch (e: any) {
    console.error("ERROR:", e?.message || e);
    process.exit(1);
  }
}

main();

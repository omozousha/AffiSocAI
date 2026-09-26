/**
 * Composio transport — the only place in the codebase that shells out.
 * Every provider adapter goes through here; nothing else touches the CLI.
 */

import { spawn } from "node:child_process";
import { logActivity } from "./activity-log.ts";

const COMPOSIO_BIN = process.env.COMPOSIO_BIN || `${process.env.HOME}/.local/bin/composio`;
const TIMEOUT_MS = Number(process.env.COMPOSIO_TIMEOUT_MS || 120_000);

export interface ComposioRun {
  ok: boolean;
  data?: any;
  error?: string;
  exitCode: number;
  /** Combined stdout/stderr for evidence capture. */
  raw: string;
  durationMs: number;
}

function run(
  args: string[],
  opts: { input?: string; timeoutMs?: number } = {},
): Promise<ComposioRun> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(COMPOSIO_BIN, args, {
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });
    let out = "";
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill("SIGKILL");
      resolve({
        ok: false,
        error: `timeout after ${opts.timeoutMs || TIMEOUT_MS}ms`,
        exitCode: -1,
        raw: out,
        durationMs: Date.now() - started,
      });
    }, opts.timeoutMs || TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: String(e), exitCode: -1, raw: out, durationMs: Date.now() - started });
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, exitCode: code ?? -1, raw: out, durationMs: Date.now() - started });
    });
    if (opts.input) child.stdin.write(opts.input);
    child.stdin.end();
  });
}

/**
 * Execute a Composio tool. Returns the parsed `data` field on success.
 * Does not throw — callers inspect `ok` and decide.
 */
export async function execute(slug: string, args: Record<string, unknown> = {}): Promise<ComposioRun> {
  const res = await run(["execute", slug, "-d", JSON.stringify(args)]);
  const out = normalize(res);
  // Every CLI call is logged: it is the transport every social action rides on,
  // and a failing slug must be visible in /api/logs without a browser open.
  logActivity({
    level: out.ok ? "info" : out.exitCode === -1 ? "error" : "warn",
    source: "system",
    event: out.ok ? "composio.ok" : out.exitCode === -1 ? "composio.timeout" : "composio.failed",
    path: slug,
    status: out.ok ? 200 : out.exitCode === -1 ? 504 : 502,
    duration_ms: out.durationMs,
    message: out.error ?? (out.ok ? null : out.raw.slice(0, 300)),
    meta: { tool: slug, exitCode: out.exitCode },
  });
  return out;
}

/** Validate a tool call without side effects. */
export async function dryRun(slug: string, args: Record<string, unknown> = {}): Promise<ComposioRun> {
  const res = await run(["execute", slug, "--dry-run", "-d", JSON.stringify(args)]);
  return normalize(res);
}

function normalize(res: ComposioRun): ComposioRun {
  if (!res.ok) return res;
  const text = res.raw.trim();
  // The CLI prints a JSON envelope on success; anything else is opaque output.
  const jsonStart = text.indexOf("{");
  if (jsonStart === -1) {
    return { ...res, ok: false, error: `no JSON in output: ${text.slice(0, 200)}` };
  }
  try {
    const parsed = JSON.parse(text.slice(jsonStart));
    const successful = parsed.successful !== false;
    return {
      ...res,
      ok: successful,
      data: parsed.data,
      error: successful ? undefined : (parsed.error ?? `tool reported failure: ${text.slice(0, 200)}`),
    };
  } catch (e) {
    return { ...res, ok: false, error: `JSON parse failed: ${String(e)}; raw=${text.slice(0, 200)}` };
  }
}

export const composio = { execute, dryRun };

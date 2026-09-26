/**
 * Minimal Chrome DevTools Protocol client — zero dependencies.
 *
 * Node 21+ ships a global `WebSocket` (RFC 6455 over TCP), so driving Chromium
 * needs no playwright and no puppeteer. Only the three surfaces Threads
 * publishing requires are implemented: spawn/wait/eval/click/type/upload and
 * cookie read+write. The module is intentionally narrow — anything else is
 * added when a real call site needs it.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean) as string[];

export interface CdpOptions {
  /** Free port for the devtools endpoint; 0 = auto-pick below 40000. */
  port?: number;
  /** Run with a visible window. Login needs a real user present. */
  headless?: boolean;
  /** Persistent profile dir so the session cookie survives restarts. */
  profileDir?: string;
  windowSize?: string;
}

export class CdpError extends Error {}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Picks a port that is actually free, so two sessions can run at once. */
async function pickPort(): Promise<number> {
  const { createServer } = await import("node:net");
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 9500 + Math.floor(Math.random() * 400);
    const free = await new Promise<boolean>((res) => {
      const srv = createServer();
      srv.once("error", () => res(false));
      srv.listen(port, "127.0.0.1", () => srv.close(() => res(true)));
    });
    if (free) return port;
  }
  throw new CdpError("could not find a free devtools port");
}

export class Cdp {
  private child: ReturnType<typeof spawn> | undefined;
  private ws: WebSocket | undefined;
  private seq = 0;
  private pending = new Map<number, { res: (v: unknown) => void; rej: (e: unknown) => void }>();
  private sessionId = "";
  private ownProfile = false;
  private readonly port: number;
  private readonly opts: Required<Omit<CdpOptions, "port">> & { port?: number };

  constructor(opts: CdpOptions = {}) {
    this.opts = {
      headless: opts.headless ?? false,
      profileDir: opts.profileDir ?? "",
      windowSize: opts.windowSize ?? "1280,900",
      port: opts.port,
    };
    this.port = opts.port ?? 0;
  }

  /** Launches Chromium and attaches to a page target. Resolves when usable. */
  async start(): Promise<this> {
    if (!this.port) this.port = await pickPort();

    const bin = CHROMIUM_CANDIDATES.find((p) => existsSync(p) && statSync(p).isFile());

    const args = [
      `--remote-debugging-port=${this.port}`,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${this.opts.windowSize}`,
      // Keeps a freshly launched profile from speaking to Google's SafeBrowsing
      // or crash reporter when we are driving it headless.
      "--disable-features=Translate,OptimizationHints",
    ];
    if (this.opts.headless) args.unshift("--headless=new");
    if (this.opts.profileDir) {
      args.push(`--user-data-dir=${this.opts.profileDir}`);
    } else {
      this.opts.profileDir = mkdtempSync(join(tmpdir(), "cdp-profile-"));
      this.ownProfile = true;
      args.push(`--user-data-dir=${this.opts.profileDir}`);
    }

    if (!bin) throw new CdpError("no chromium binary found (set CHROMIUM_PATH)");
    this.child = spawn(bin, args, { stdio: "ignore", detached: false });
    this.child.unref();

    const wsUrl = await this.waitForEndpoint();
    await this.connect(wsUrl);
    await this.attach();
    return this;
  }

  private async waitForEndpoint(): Promise<string> {
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (r.ok) {
          const j = (await r.json()) as { webSocketDebuggerUrl?: string };
          if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
        }
      } catch {
        /* not up yet */
      }
      await sleep(300);
    }
    throw new CdpError(`devtools endpoint did not come up on port ${this.port}`);
  }

  private async connect(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    await new Promise<void>((res, rej) => {
      this.ws!.addEventListener("open", () => res(), { once: true });
      this.ws!.addEventListener("error", () => rej(new CdpError("websocket open failed")), { once: true });
    });
    this.ws.addEventListener("message", (ev) => this.onMessage(ev));
  }

  private onMessage(ev: MessageEvent) {
    let msg: { id?: number; result?: unknown; error?: unknown; method?: string; params?: unknown };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { res, rej } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) rej(new CdpError(typeof msg.error === "string" ? msg.error : JSON.stringify(msg.error)));
      else res(msg.result);
    }
  }

  private async attach() {
    const created = (await this.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
    const attached = (await this.send("Target.attachToTarget", { targetId: created.targetId, flatten: true })) as {
      sessionId: string;
    };
    this.sessionId = attached.sessionId;
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("DOM.enable");
  }

  /** Sends a CDP command on the page session and resolves with its result. */
  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((res, rej) => {
      this.pending.set(id, { res: res as (v: unknown) => void, rej });
      this.ws!.send(JSON.stringify({ id, method, params, sessionId: this.sessionId }));
    });
  }

  async goto(url: string, waitMs = 2500): Promise<void> {
    await this.send("Page.navigate", { url });
    await sleep(waitMs);
  }

  /** Evaluates a JS expression in the page, returning its value. */
  async evalJs<T = unknown>(expr: string): Promise<T> {
    const r = (await this.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    })) as { result?: { value?: T }; exceptionDetails?: unknown };
    if (r.exceptionDetails) throw new CdpError(`eval failed: ${JSON.stringify(r.exceptionDetails).slice(0, 200)}`);
    return r.result?.value as T;
  }

  /** Waits for a CSS selector to exist, scrolling-less, polling the DOM. */
  async waitForSelector(selector: string, timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const expr = `!!document.querySelector(${JSON.stringify(selector)})`;
    while (Date.now() < deadline) {
      if (await this.evalJs<boolean>(expr)) return;
      await sleep(250);
    }
    throw new CdpError(`selector not found within ${timeoutMs}ms: ${selector}`);
  }

  /** Clicks a selector, dispatching a real click event (SPA-safe). */
  async click(selector: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('gone');e.scrollIntoView({block:'center'});e.click();})()`);
  }

  /** Types into a field the way React/Meta's controlled inputs expect. */
  async type(selector: string, text: string): Promise<void> {
    await this.waitForSelector(selector);
    await this.evalJs(`(()=>{
      const e=document.querySelector(${JSON.stringify(selector)});
      if(!e)throw new Error('gone');
      e.focus();
      e.value='';
      e.dispatchEvent(new Event('input',{bubbles:true}));
      e.value=${JSON.stringify(text)};
      e.dispatchEvent(new Event('input',{bubbles:true}));
      e.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
  }

  /** Uploads local files through a file input (CDP DOM.setFileInputFiles). */
  async setFiles(selector: string, paths: string[]): Promise<void> {
    await this.waitForSelector(selector);
    const { root } = (await this.send("DOM.getDocument")) as { root: { nodeId: number } };
    const { nodeId } = (await this.send("DOM.querySelector", { nodeId: root.nodeId, selector })) as { nodeId: number };
    if (!nodeId) throw new CdpError(`no DOM node for ${selector}`);
    await this.send("DOM.setFileInputFiles", { nodeId, files: paths });
  }

  /** Reads cookies as a plain array; used for session persistence. */
  async getCookies(): Promise<Array<Record<string, unknown>>> {
    const r = (await this.send("Network.getCookies", {})) as { cookies: Array<Record<string, unknown>> };
    return r.cookies;
  }

  /** Restores cookies from a previously captured array. */
  async setCookies(cookies: Array<Record<string, unknown>>): Promise<void> {
    await this.send("Network.setCookies", { cookies });
  }

  /** All cookies for one URL, as the `Cookie:` header value. */
  async cookieHeader(url: string): Promise<string> {
    const u = new URL(url);
    const all = await this.getCookies();
    return all
      .filter((c) => {
        const domain = String(c.domain || "").replace(/^\./, "");
        const host = u.hostname.replace(/^\./, "");
        return host === domain || host.endsWith("." + domain);
      })
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  async close(): Promise<void> {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      this.child?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    if (this.ownProfile && this.opts.profileDir) {
      try {
        rmSync(this.opts.profileDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

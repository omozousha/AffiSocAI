/**
 * Provider registry — the single seam between the application and providers.
 * The app resolves providers through this registry and nothing else, so adding
 * or enabling a provider never touches application code.
 */
import { FacebookAdapter } from "../providers/facebook.ts";
import { InstagramAdapter } from "../providers/instagram.ts";
import { ThreadsAdapter } from "../providers/threads.ts";
import { ThreadsUnofficialAdapter } from "../providers/threads-unofficial.ts";
import { TikTokAdapter } from "../providers/tiktok.ts";
import type { ProviderCapabilities, SocialProvider } from "./types.ts";

const officialThreads = new ThreadsAdapter();
const unofficialThreads = new ThreadsUnofficialAdapter();

function threadsEffective(): SocialProvider {
  // Official takes the `threads` slot when an OAuth token exists (it supports
  // topic_tag + insights). Unofficial is the fallback for cookie sessions.
  // (no cycle: we read the concrete instances, not via getProvider).
  if (officialThreads.status === "VERIFIED-EXECUTED") return officialThreads;
  if (unofficialThreads.status === "VERIFIED-EXECUTED") return unofficialThreads;
  return officialThreads;
}

const adapters: SocialProvider[] = [
  new InstagramAdapter(),
  new FacebookAdapter(),
  officialThreads,
  // unofficialThreads is NOT listed separately; it is aliased to `threads` below
  new TikTokAdapter(),
];

export function listProviders(): SocialProvider[] {
  // Single `threads` entry, resolved to the effective adapter.
  const out: SocialProvider[] = [];
  for (const a of adapters) {
    if (a.slug === "threads") {
      out.push(threadsEffective());
    } else {
      out.push(a);
    }
  }
  return out;
}

export function getProvider(slug: string): SocialProvider | undefined {
  if (slug === "threads") return threadsEffective();
  if (slug === "threads-unofficial") return unofficialThreads;
  return adapters.find((a) => a.slug === slug);
}

/** Providers currently able to publish. */
export function activeProviders(): SocialProvider[] {
  return listProviders().filter((a) => a.status === "VERIFIED-EXECUTED");
}

export function describeCapabilities(slug: string): ProviderCapabilities | null {
  return getProvider(slug)?.capabilities ?? null;
}

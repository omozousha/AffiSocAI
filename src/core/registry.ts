/**
 * Provider registry — the single seam between the application and providers.
 * The app resolves providers through this registry and nothing else, so adding
 * or enabling a provider never touches application code.
 */

import { FacebookAdapter } from "../providers/facebook.ts";
import { InstagramAdapter } from "../providers/instagram.ts";
import { ThreadsAdapter } from "../providers/threads.ts";
import { TikTokAdapter } from "../providers/tiktok.ts";
import type { ProviderCapabilities, SocialProvider } from "./types.ts";

const adapters: SocialProvider[] = [
  new InstagramAdapter(),
  new FacebookAdapter(),
  new ThreadsAdapter(),
  new TikTokAdapter(),
];

export function listProviders(): SocialProvider[] {
  return adapters;
}

export function getProvider(slug: string): SocialProvider | undefined {
  return adapters.find((a) => a.slug === slug);
}

/** Providers currently able to publish. */
export function activeProviders(): SocialProvider[] {
  return adapters.filter((a) => a.status === "VERIFIED-EXECUTED");
}

export function describeCapabilities(slug: string): ProviderCapabilities | null {
  return getProvider(slug)?.capabilities ?? null;
}

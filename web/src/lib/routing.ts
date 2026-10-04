// Hash routing: URL is the single source of truth for the active route.
// Deep-link, reload and browser-back all work through `#/logs` style hashes.
export const ROUTE_IDS = ["dashboard", "links", "konten", "sosmed", "jadwal", "logs"] as const;
export type RouteId = (typeof ROUTE_IDS)[number];

const VALID = new Set<string>(ROUTE_IDS);

export function parseHash(h: string): RouteId {
  const id = h.replace(/^#\/?/, "").toLowerCase();
  return VALID.has(id) ? (id as RouteId) : "dashboard";
}

export function hashFor(id: RouteId): string {
  return `#${id}`;
}

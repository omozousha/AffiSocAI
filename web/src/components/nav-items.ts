import {
  CalendarDays,
  LayoutDashboard,
  Link2,
  Megaphone,
  ScrollText,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { ROUTE_IDS, type RouteId } from "../lib/routing";

// ROUTE_IDS (lib/routing) is the single source: nav and parse can never drift.
export const NAV: Record<RouteId, { label: string; Icon: LucideIcon }> = {
  dashboard: { label: "Dashboard", Icon: LayoutDashboard },
  wizard: { label: "Pipeline Wizard", Icon: Wand2 },
  links: { label: "Link", Icon: Link2 },
  konten: { label: "Konten", Icon: Sparkles },
  sosmed: { label: "Sosmed", Icon: Megaphone },
  jadwal: { label: "Jadwal", Icon: CalendarDays },
  logs: { label: "Logs", Icon: ScrollText },
};

export const ROUTES = ROUTE_IDS.map((id) => ({ id, ...NAV[id] })) as {
  id: RouteId;
  label: string;
  Icon: LucideIcon;
}[];

import { useEffect, useState } from "react";
import { ROUTE_IDS, hashFor, parseHash, type RouteId } from "./lib/routing";
import {
  CalendarDays,
  ChevronsLeft,
  LayoutDashboard,
  Link2,
  LogOut,
  Megaphone,
  Menu,
  ScrollText,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/skeleton";
import Dashboard from "./routes/Dashboard";
import Login from "./routes/Login";
import Jadwal from "./routes/Jadwal";
import Links from "./routes/Links";
import Konten from "./routes/Konten";
import Sosmed from "./routes/Sosmed";
import Logs from "./routes/Logs";

const NAV: Record<RouteId, { label: string; Icon: typeof Link2 }> = {
  dashboard: { label: "Dashboard", Icon: LayoutDashboard },
  links: { label: "Link", Icon: Link2 },
  konten: { label: "Konten", Icon: Sparkles },
  sosmed: { label: "Sosmed", Icon: Megaphone },
  jadwal: { label: "Jadwal", Icon: CalendarDays },
  logs: { label: "Logs", Icon: ScrollText },
};
// ROUTE_IDS (lib/routing) is the single source: nav and parse can never drift.
const ROUTES = ROUTE_IDS.map((id) => ({ id, ...NAV[id] })) as { id: RouteId; label: string; Icon: typeof Link2 }[];

function AppShell({ user, onLogout }: { user: string; onLogout: () => void }) {
  const [route, setRoute] = useState<string>(() => parseHash(window.location.hash));
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const active = ROUTES.find((r) => r.id === route) ?? ROUTES[0];

  // Hash is the single source of truth: deep-link, reload, browser back/forward.
  useEffect(() => {
    const onHash = () => {
      const r = parseHash(window.location.hash);
      setRoute(r);
      // back/forward can change the route while the mobile drawer is open;
      // the drawer must not stay up over a different page (no-op on mount).
      setDrawer(false);
      // normalize garbage/empty hash so back/forward history stays coherent
      const want = hashFor(r);
      if (window.location.hash !== want) history.replaceState(null, "", want);
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Kunci scroll body saat drawer terbuka + tutup via Escape.
  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [drawer]);

  const go = (id: string) => {
    const r = parseHash(`#${id}`);
    window.location.hash = hashFor(r); // hashchange listener updates route state
    setDrawer(false);
  };

  const nav = (mobile: boolean) => (
    <nav className={mobile ? "flex flex-col gap-1" : "flex flex-1 flex-col gap-1"} aria-label="Navigasi utama">
      {ROUTES.map((r) => (
        <Button
          key={r.id}
          variant={r.id === route ? "default" : "ghost"}
          size="sm"
          title={r.label}
          className={
            collapsed && !mobile
              ? "justify-center px-0"
              : "justify-start"
          }
          onClick={() => go(r.id)}
        >
          <r.Icon size={16} aria-hidden />
          {(!collapsed || mobile) && <span>{r.label}</span>}
        </Button>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Overlay drawer mobile */}
      {drawer && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setDrawer(false)}
          aria-hidden
        />
      )}

      {/* Sidebar desktop — collapsible via trigger */}
      <aside
        className={`sticky top-0 hidden h-screen flex-none flex-col gap-4 border-r border-zinc-800 bg-zinc-950 p-4 transition-all md:flex ${
          collapsed ? "w-16 p-3" : "w-52"
        }`}
      >
        <div className="flex items-center justify-between">
          {!collapsed && (
            <div className="text-sm font-bold">
              AffiSoc<span className="text-accent">AI</span>
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className={collapsed ? "mx-auto px-2" : "px-2"}
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Buka sidebar" : "Tutup sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? <Menu size={16} /> : <ChevronsLeft size={16} />}
          </Button>
        </div>
        {nav(false)}
        {!collapsed && (
          <div className="text-[11px] text-zinc-600">
            {active.label} · React
          </div>
        )}
        <div className="mt-auto flex items-center gap-2">
          {!collapsed && <span className="truncate text-[11px] text-zinc-500">{user}</span>}
          <Button size="sm" variant="ghost" className="px-2 text-zinc-400" onClick={onLogout} title="Keluar">
            <LogOut size={14} />
          </Button>
        </div>
      </aside>

      {/* Drawer mobile — slide-in via hamburger */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-4 border-r border-zinc-800 bg-zinc-950 p-4 transition-transform md:hidden ${
          drawer ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!drawer}
      >
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">
            AffiSoc<span className="text-accent">AI</span>
          </div>
          <Button size="sm" variant="ghost" className="px-2" onClick={() => setDrawer(false)} aria-label="Tutup menu">
            <X size={16} />
          </Button>
        </div>
        {nav(true)}
        <div className="mt-auto flex items-center justify-between text-[11px] text-zinc-500">
          <span className="truncate">{user}</span>
          <Button size="sm" variant="ghost" className="px-2 text-zinc-400" onClick={onLogout}>
            <LogOut size={14} /> Keluar
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar mobile dengan hamburger trigger */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur md:hidden">
          <Button size="sm" variant="ghost" className="px-2" onClick={() => setDrawer(true)} aria-label="Buka menu">
            <Menu size={18} />
          </Button>
          <div className="text-sm font-bold">
            AffiSoc<span className="text-accent">AI</span>
          </div>
          <span className="ml-auto text-xs text-zinc-500">{active.label}</span>
        </header>

        <main className="min-w-0 flex-1 p-6 max-md:p-4">
          <div className="mx-auto max-w-5xl">
            {route === "dashboard" ? (
              <Dashboard go={go} />
            ) : route === "jadwal" ? (
              <Jadwal />
            ) : route === "links" ? (
              <Links go={go} />
            ) : route === "konten" ? (
              <Konten />
            ) : route === "sosmed" ? (
              <Sosmed />
            ) : (
              <Logs />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Cookie session is HttpOnly (the client cannot read it) — ask the server.
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((b) => setUser(b.logged_in ? String(b.user) : null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  const logout = async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  if (checking)
    return (
      // Reviewer/operator must never see a black screen while /api/session answers.
      <div className="flex min-h-screen bg-zinc-950 text-zinc-100" aria-busy="true" aria-label="Memuat">
        <div className="hidden w-52 shrink-0 flex-col gap-2 border-r border-zinc-800 p-4 md:flex">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-9/12" />
        </div>
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  return <AppShell user={user} onLogout={logout} />;
}

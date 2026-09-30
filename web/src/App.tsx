import { useEffect, useState } from "react";
import {
  CalendarDays,
  ChevronsLeft,
  LayoutDashboard,
  Link2,
  Megaphone,
  Menu,
  ScrollText,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "./components/ui/button";
import Dashboard from "./routes/Dashboard";
import Jadwal from "./routes/Jadwal";
import Links from "./routes/Links";
import Konten from "./routes/Konten";
import Sosmed from "./routes/Sosmed";
import Logs from "./routes/Logs";

const ROUTES = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "links", label: "Link", Icon: Link2 },
  { id: "konten", label: "Konten", Icon: Sparkles },
  { id: "sosmed", label: "Sosmed", Icon: Megaphone },
  { id: "jadwal", label: "Jadwal", Icon: CalendarDays },
  { id: "logs", label: "Logs", Icon: ScrollText },
] as const;

export default function App() {
  const [route, setRoute] = useState<string>("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const active = ROUTES.find((r) => r.id === route) ?? ROUTES[0];

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
    setRoute(id);
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
              affiliate<span className="text-emerald-200">-tools</span>
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
            affiliate<span className="text-emerald-200">-tools</span>
          </div>
          <Button size="sm" variant="ghost" className="px-2" onClick={() => setDrawer(false)} aria-label="Tutup menu">
            <X size={16} />
          </Button>
        </div>
        {nav(true)}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar mobile dengan hamburger trigger */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-zinc-800 bg-zinc-950/95 p-3 backdrop-blur md:hidden">
          <Button size="sm" variant="ghost" className="px-2" onClick={() => setDrawer(true)} aria-label="Buka menu">
            <Menu size={18} />
          </Button>
          <div className="text-sm font-bold">
            affiliate<span className="text-emerald-200">-tools</span>
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

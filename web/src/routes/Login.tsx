import { useState } from "react";
import { Button } from "../components/ui/button";

/** Operator login. Session cookie is HttpOnly (set by server), never stored client-side. */
export default function Login({ onLogin }: { onLogin: (user: string) => void }) {
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (busy || !user || !pass) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const b = await r.json().catch(() => ({}));
      if (r.ok && b.ok) onLogin(String(b.user || user));
      else setErr(String(b.error || `gagal (HTTP ${r.status})`));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <form
        className="w-full max-w-sm space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="text-lg font-bold">
          AffiSoc<span className="text-accent">AI</span>
          <div className="text-xs font-normal text-zinc-500">Masuk operator</div>
        </div>
        <label htmlFor="login-user" className="block text-sm font-medium text-zinc-300">
          Nama pengguna
          <input
            id="login-user"
            name="username"
            className="mt-1 min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </label>
        <label htmlFor="login-pass" className="block text-sm font-medium text-zinc-300">
          Kata sandi
          <input
            id="login-pass"
            name="password"
            type="password"
            className="mt-1 min-h-[44px] w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent"
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        {/* live region always mounted: SR announces CONTENT change reliably;
            role=alert is assertive by itself — no redundant aria-live attr. */}
        <div role="alert" className={err ? "rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300" : "h-0 overflow-hidden"}>
          {err}
        </div>
        <Button type="submit" size="sm" className="min-h-[44px] w-full text-sm" disabled={busy || !user || !pass}>
          {busy ? "Memeriksa…" : "Masuk"}
        </Button>
      </form>
    </div>
  );
}

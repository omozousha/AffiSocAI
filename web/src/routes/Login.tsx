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
          AffiSoc<span className="text-emerald-300">AI</span>
          <div className="text-xs font-normal text-zinc-500">Login operator</div>
        </div>
        <input
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect="off"
          value={user}
          onChange={(e) => setUser(e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          placeholder="Password"
          type="password"
          autoCapitalize="none"
          autoCorrect="off"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        {err && <div className="rounded-lg bg-red-950 px-3 py-2 text-xs text-red-300">{err}</div>}
        <Button type="submit" size="sm" className="w-full" disabled={busy || !user || !pass}>
          {busy ? "Memeriksa…" : "Masuk"}
        </Button>
      </form>
    </div>
  );
}

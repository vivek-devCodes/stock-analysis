"use client";

import { Activity, Loader2, LogIn, Lock, ShieldCheck, User } from "lucide-react";
import { FormEvent, useState } from "react";

function safeNext(): string {
  const next = new URLSearchParams(window.location.search).get("next") ?? "/";
  // Only same-site relative paths, so the login page can't be used as an open redirect.
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Login failed");
      // Full navigation so the proxy sees the new cookie.
      window.location.replace(safeNext());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setPassword("");
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="panel w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Activity className="h-6 w-6" />
          </span>
          <div>
            <p className="text-sm font-semibold">Apex Desk</p>
            <p className="text-[11px] text-muted">Stock Analysis CRM</p>
          </div>
        </div>
        <div>
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="flex items-center gap-1 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5 text-up" /> Admin access only.
          </p>
        </div>

        <label className="block space-y-1 text-xs text-muted">
          Username
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded-xl border border-line bg-card px-9 py-2 text-sm text-foreground outline-none ring-accent/40 focus:ring-2"
            />
          </div>
        </label>

        <label className="block space-y-1 text-xs text-muted">
          Password
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full rounded-xl border border-line bg-card px-9 py-2 text-sm text-foreground outline-none ring-accent/40 focus:ring-2"
            />
          </div>
        </label>

        {error && <p className="rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
          Sign in
        </button>
      </form>
    </main>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const fromParam = params.get("from") ?? "/dashboard";
  const safeFrom = fromParam.startsWith("/") && !fromParam.startsWith("//") ? fromParam : "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        setError(err.message);
        return;
      }
      router.replace(safeFrom);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="email">Correo</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mt-1"
          placeholder="tu@clinica.pe"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mt-1"
          placeholder="••••••••"
        />
      </div>
      {error ? (
        <div className="rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">{error}</div>
      ) : null}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Entrando…" : "Iniciar sesión"}
      </button>
    </form>
  );
}

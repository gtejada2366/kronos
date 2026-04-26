"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const DEMO_EMAIL = "demo@obrascope.pe";
const DEMO_PASSWORD = "demo1234";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const fromParam = params.get("from") ?? "/dashboard";
  const safeFrom = fromParam.startsWith("/") && !fromParam.startsWith("//") ? fromParam : "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent, overrides?: { email?: string; password?: string }) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const supabase = createSupabaseBrowserClient();
      const { error: err } = await supabase.auth.signInWithPassword({
        email: overrides?.email ?? email,
        password: overrides?.password ?? password
      });
      if (err) {
        setError(err.message);
        return;
      }
      router.replace(safeFrom);
      router.refresh();
    });
  }

  function loginAsDemo(e: React.MouseEvent) {
    e.preventDefault();
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    submit(e as unknown as React.FormEvent, { email: DEMO_EMAIL, password: DEMO_PASSWORD });
  }

  useEffect(() => {
    if (params.get("demo") === "1") {
      setEmail(DEMO_EMAIL);
      setPassword(DEMO_PASSWORD);
    }
  }, [params]);

  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="email">
          Correo
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mt-1"
          placeholder="usuario@municipalidad.gob.pe"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Contraseña
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mt-1"
          placeholder="••••••••"
        />
      </div>

      {error ? (
        <div className="rounded-sm border border-sema-red/40 bg-sema-red/10 px-3 py-2 text-xs text-sema-red">
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Entrando…" : "Iniciar sesión"}
      </button>

      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center">
          <div className="h-px w-full bg-bg-border" />
        </div>
        <div className="relative flex justify-center text-[10px] uppercase tracking-wider text-ink-dim">
          <span className="bg-bg px-2">o</span>
        </div>
      </div>

      <button type="button" onClick={loginAsDemo} disabled={pending} className="btn-ghost">
        Entrar como demo
      </button>

      <p className="text-center text-xs text-ink-dim">
        Demo: <span className="font-mono">{DEMO_EMAIL}</span> /{" "}
        <span className="font-mono">{DEMO_PASSWORD}</span>
      </p>
    </form>
  );
}

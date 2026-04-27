import Link from "next/link";
import { Suspense } from "react";
import { BRAND } from "@/lib/constants";
import { LoginForm } from "./login-form";

export const metadata = { title: "Acceso · Citaya" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="hidden flex-col justify-between border-r border-bg-border bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-white text-brand">
            <span className="font-mono text-sm font-bold">C</span>
          </div>
          <span className="font-semibold tracking-tight">{BRAND.name}</span>
        </div>
        <div className="max-w-md">
          <p className="font-mono text-xs uppercase tracking-[0.25em] opacity-80">Para clínicas peruanas</p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight">
            Cada lead capturado en 30 segundos. Cada cita confirmada con Yape.
          </h1>
          <p className="mt-4 text-sm text-white/80">
            {BRAND.name} es tu asistente que nunca duerme: responde, agenda y cobra mientras tú
            atiendes a tus pacientes.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4 text-xs">
          <Stat k="< 30s" v="respuesta" />
          <Stat k="−60%" v="no-shows" />
          <Stat k="24/7" v="disponible" />
        </div>
      </aside>

      <section className="flex items-center justify-center bg-bg p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-ink-mute">Entra con tu correo para ver tu panel.</p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-center text-xs text-ink-dim">
            ¿Tu clínica aún no está registrada?{" "}
            <Link href="/signup" className="font-medium text-brand hover:underline">
              Crear cuenta
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-white/20 bg-white/5 p-3 text-white">
      <p className="num text-base font-semibold">{k}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider opacity-70">{v}</p>
    </div>
  );
}

import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Acceso · ObraScope" };

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="hidden flex-col justify-between border-r border-bg-border bg-bg-elev p-12 lg:flex">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-sm bg-accent text-black">
            <span className="font-mono text-sm font-bold">O</span>
          </div>
          <span className="font-mono text-xs font-semibold tracking-[0.25em]">OBRASCOPE</span>
        </div>

        <div className="max-w-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent">
            Monitoreo de inversión pública
          </p>
          <h1 className="mt-4 text-3xl font-semibold leading-tight">
            Toda la cartera de obras de tu entidad — semáforo, KPIs y alertas.
          </h1>
          <p className="mt-4 text-sm text-ink-mute">
            ObraScope se conecta a las APIs públicas del MEF (Consulta Amigable e Invierte.pe)
            y emite un digest semanal por Telegram con los proyectos en zona crítica.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4 text-xs text-ink-mute">
          <Stat k="1,874+" v="entidades" />
          <Stat k="MEF / SIAF" v="fuente oficial" />
          <Stat k="< 8 UIT" v="sin licitación" />
        </div>
      </section>

      <section className="flex items-center justify-center bg-bg p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-semibold">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-ink-mute">
            Usa tus credenciales o entra como demo para explorar la plataforma.
          </p>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-sm border border-bg-border bg-bg p-3">
      <p className="num text-base font-semibold text-ink">{k}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-ink-dim">{v}</p>
    </div>
  );
}

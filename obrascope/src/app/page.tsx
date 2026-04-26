import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-16">
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost">
            Iniciar sesión
          </Link>
          <Link href="/login?demo=1" className="btn-primary">
            Ver demo
          </Link>
        </nav>
      </header>

      <section className="mt-24 flex max-w-3xl flex-col gap-6">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent">
          SaaS para gobiernos sub-nacionales · Perú
        </p>
        <h1 className="text-4xl font-semibold leading-tight md:text-6xl">
          Toda tu cartera de obras públicas en una sola pantalla.
        </h1>
        <p className="text-lg text-ink-mute">
          ObraScope conecta al MEF (Consulta Amigable e Invierte.pe), aplica un semáforo de
          ejecución sobre cada proyecto y notifica a tu equipo por Telegram cuando algo se
          atrasa. Hecho para alcaldes, gerentes de infraestructura y especialistas de
          presupuesto.
        </p>
        <div className="flex items-center gap-3">
          <Link href="/login?demo=1" className="btn-primary">
            Entrar a la demo →
          </Link>
          <span className="text-sm text-ink-dim">demo@obrascope.pe / demo1234</span>
        </div>
      </section>

      <section className="mt-20 grid gap-4 md:grid-cols-3">
        <Card title="Semáforo automático">
          Verde / amarillo / rojo por proyecto, comparando % devengado contra % de año fiscal
          transcurrido (factor 0.9).
        </Card>
        <Card title="Alertas por Telegram">
          Digest semanal cada lunes con los proyectos en zona roja. Sin pasar por correos que
          nadie abre.
        </Card>
        <Card title="Multi-tenant + RLS">
          Cada entidad ve sólo sus datos. Aislamiento a nivel de base de datos vía Supabase Row
          Level Security.
        </Card>
      </section>

      <footer className="mt-auto pt-24 text-xs text-ink-dim">
        © {new Date().getFullYear()} ObraScope · Licencia anual · Por debajo del umbral de 8 UIT
      </footer>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-2 text-sm text-ink-mute">{children}</p>
    </div>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-sm bg-accent text-black">
        <span className="font-mono text-sm font-bold">O</span>
      </div>
      <span className="font-mono text-sm font-semibold tracking-wider">OBRASCOPE</span>
    </div>
  );
}

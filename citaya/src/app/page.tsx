import Link from "next/link";
import { BRAND } from "@/lib/constants";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost">Iniciar sesión</Link>
          <Link href="/signup" className="btn-primary">Probar 14 días gratis</Link>
        </nav>
      </header>

      <section className="mt-24 grid items-center gap-12 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-brand">
            Para clínicas dentales y estéticas en Perú
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            Cada lead de WhatsApp, agendado y pagado en menos de 1 minuto.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-mute">
            {BRAND.name} responde a tus pacientes 24/7, propone horarios desde tu calendario, cobra
            la señal por Yape y bloquea el slot. Tu secretaria se libera para lo importante; tú
            dejas de perder pacientes mientras duermes.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/signup" className="btn-primary">Empezar ahora →</Link>
            <Link href="/login" className="btn-ghost">Ya tengo cuenta</Link>
          </div>
          <p className="mt-3 text-xs text-ink-dim">
            Setup en 30 minutos · Sin permanencia · Pagas sólo por cita agendada y cobrada
          </p>
        </div>

        <ChatMockup />
      </section>

      <section className="mt-32 grid gap-4 md:grid-cols-3">
        <Card title="Captura instantánea">
          Bot conversacional con IA que responde leads de Instagram y WhatsApp en menos de 30
          segundos. No más "te respondo en un rato" que termina en silencio.
        </Card>
        <Card title="Cobra la señal por Yape">
          Genera link de cobro Yape automático con el monto que tú decidas. El paciente que paga
          es el paciente que viene — no más sillas vacías por no-show.
        </Card>
        <Card title="Atribución honesta">
          Tu dashboard te muestra cada lunes cuántos leads capturaste, cuántos agendaron y cuánto
          revenue generó {BRAND.name} esa semana. Si no vale la pena, lo cancelas.
        </Card>
      </section>

      <section className="mt-24 panel p-8">
        <h2 className="text-2xl font-semibold">Cómo funciona</h2>
        <ol className="mt-6 grid gap-6 md:grid-cols-4">
          <Step n="1" t="Conecta WhatsApp">
            En 10 minutos enlazamos tu número Cloud API y tu calendario de Google.
          </Step>
          <Step n="2" t="Configura tus servicios">
            Agregas tratamientos con duración y precio. El bot solo ofrece lo que existe.
          </Step>
          <Step n="3" t="El paciente escribe">
            Bot conversa, propone 3 horarios, agenda, manda link Yape de señal.
          </Step>
          <Step n="4" t="Cita confirmada">
            Cuando paga, bloqueamos el slot en tu Google Calendar. Tu secretaria solo atiende.
          </Step>
        </ol>
      </section>

      <footer className="mt-auto pt-24 text-xs text-ink-dim">
        © {new Date().getFullYear()} {BRAND.name} · Hecho en Lima · {BRAND.domain}
      </footer>
    </main>
  );
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white">
        <span className="font-mono text-sm font-bold">C</span>
      </div>
      <span className="font-semibold tracking-tight">{BRAND.name}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-mute">{children}</p>
    </div>
  );
}

function Step({ n, t, children }: { n: string; t: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand">{n}</span>
        <span className="text-sm font-semibold">{t}</span>
      </div>
      <p className="mt-2 text-sm text-ink-mute">{children}</p>
    </div>
  );
}

function ChatMockup() {
  return (
    <div className="panel max-w-md self-start p-5">
      <div className="flex items-center gap-3 border-b border-bg-border pb-4">
        <div className="grid h-9 w-9 place-items-center rounded-full bg-brand text-white">
          <span className="font-mono text-xs font-bold">C</span>
        </div>
        <div>
          <p className="text-sm font-semibold">Clínica Dental Sonríe</p>
          <p className="text-xs text-ok">en línea</p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 text-sm">
        <Bubble side="them">¡Hola! Me operé los molares y necesito una limpieza profunda</Bubble>
        <Bubble side="us">Hola 👋 Soy el asistente de la clínica. Tenemos disponibilidad esta semana para profilaxis con curetaje. ¿Te van bien estos horarios?</Bubble>
        <Bubble side="us">• Martes 5pm<br />• Miércoles 10am<br />• Jueves 6:30pm</Bubble>
        <Bubble side="them">Miércoles 10am</Bubble>
        <Bubble side="us">Listo. Para reservar te dejo el link de la señal de S/. 50 (descontable del tratamiento) → yape.com.pe/cobrar/...</Bubble>
        <Bubble side="them">Pagado ✅</Bubble>
        <Bubble side="us">Perfecto. Te esperamos el miércoles 10am. ✨</Bubble>
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "us" | "them"; children: React.ReactNode }) {
  if (side === "us") {
    return (
      <div className="self-start max-w-[85%] rounded-2xl rounded-bl-sm bg-brand-soft px-3.5 py-2 text-ink">{children}</div>
    );
  }
  return (
    <div className="self-end max-w-[85%] rounded-2xl rounded-br-sm bg-bg-elev px-3.5 py-2 text-ink-mute border border-bg-border">{children}</div>
  );
}

import Link from "next/link";
import { BRAND } from "@/lib/constants";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Crear cuenta · Citaya" };

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-brand text-white">
            <span className="font-mono text-sm font-bold">C</span>
          </div>
          <span className="font-semibold tracking-tight">{BRAND.name}</span>
        </Link>
        <Link href="/login" className="text-xs text-ink-mute hover:text-ink">
          ¿Ya tienes cuenta? Iniciar sesión →
        </Link>
      </header>

      <section className="panel p-7">
        <h1 className="text-2xl font-semibold">Crea tu cuenta</h1>
        <p className="mt-1 text-sm text-ink-mute">
          14 días gratis. No te pedimos tarjeta. Configuramos tu WhatsApp y tu calendario contigo
          en una llamada de 30 minutos.
        </p>
        <SignupForm />
      </section>

      <p className="mt-4 text-xs text-ink-dim">
        Al registrarte aceptas que {BRAND.name} procese mensajes de WhatsApp en tu nombre y
        almacene los datos operativos de tu clínica conforme a la Ley 29733.
      </p>
    </main>
  );
}

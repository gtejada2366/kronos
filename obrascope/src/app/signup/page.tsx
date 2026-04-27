import { Suspense } from "react";
import Link from "next/link";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Registrar entidad · ObraScope" };

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-12">
      <header className="mb-8 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-sm bg-accent text-black">
            <span className="font-mono text-sm font-bold">O</span>
          </div>
          <span className="font-mono text-xs font-semibold tracking-[0.25em]">OBRASCOPE</span>
        </Link>
        <Link href="/login" className="text-xs text-ink-mute hover:text-ink">
          ¿Ya tienes cuenta? Iniciar sesión →
        </Link>
      </header>

      <section className="panel p-6">
        <h1 className="text-2xl font-semibold">Registrar entidad</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Crea la primera cuenta <span className="font-mono">owner</span> de tu municipalidad o
          gobierno regional. Si tu entidad ya está registrada, pide a tu owner que te invite.
        </p>
        <Suspense fallback={null}>
          <SignupForm />
        </Suspense>
      </section>

      <p className="mt-4 text-xs text-ink-dim">
        Al registrarte aceptas que ObraScope opere bajo la modalidad de licencia anual por
        debajo del umbral de 8 UIT.
      </p>
    </main>
  );
}

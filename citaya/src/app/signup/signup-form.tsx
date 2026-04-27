"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerClinicAction, type SignupResult } from "./actions";

export function SignupForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: HTMLFormElement) {
    setError(null);
    const fd = new FormData(form);
    start(async () => {
      const r: SignupResult = await registerClinicAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.replace(r.redirect);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="mt-6 grid gap-4"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="full_name" label="Tu nombre" type="text" autoComplete="name" required />
        <Field name="clinic_name" label="Nombre de la clínica" type="text" required placeholder="Clínica Dental Sonríe" />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="email" label="Correo" type="email" autoComplete="email" required />
        <Field name="password" label="Contraseña" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      {error ? (
        <div className="rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">{error}</div>
      ) : null}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Creando cuenta…" : "Crear cuenta y continuar"}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  type,
  required,
  placeholder,
  autoComplete,
  minLength
}: {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  minLength?: number;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        className="input mt-1"
      />
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { registerEntityAction, type SignupResult } from "./actions";

export function SignupForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(form: HTMLFormElement) {
    setError(null);
    const fd = new FormData(form);
    start(async () => {
      const r: SignupResult = await registerEntityAction(fd);
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
      className="mt-5 grid gap-4"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="email" label="Correo institucional" type="email" required autoComplete="email" />
        <Field name="password" label="Contraseña" type="password" required autoComplete="new-password" minLength={8} />
      </div>

      <Field name="nombre" label="Nombre oficial de la entidad" type="text" required placeholder="Municipalidad Distrital de …" />

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          name="ubigeo"
          label="UBIGEO (6 dígitos)"
          type="text"
          required
          inputMode="numeric"
          pattern="\d{6}"
          placeholder="080101"
          mono
        />
        <div>
          <label className="label" htmlFor="tipo">
            Tipo
          </label>
          <select id="tipo" name="tipo" required className="input mt-1">
            <option value="MUNICIPALIDAD_DISTRITAL">Municipalidad distrital</option>
            <option value="MUNICIPALIDAD_PROVINCIAL">Municipalidad provincial</option>
            <option value="GOBIERNO_REGIONAL">Gobierno regional</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="rounded-sm border border-sema-red/40 bg-sema-red/10 px-3 py-2 text-xs text-sema-red">
          {error}
        </div>
      ) : null}

      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Creando entidad…" : "Crear entidad y continuar"}
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
  inputMode,
  pattern,
  minLength,
  mono
}: {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "numeric" | "text";
  pattern?: string;
  minLength?: number;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        minLength={minLength}
        className={`input mt-1 ${mono ? "num" : ""}`}
      />
    </div>
  );
}

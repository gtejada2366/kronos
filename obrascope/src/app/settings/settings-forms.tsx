"use client";

import { useState, useTransition } from "react";
import type { Entity } from "@/lib/types";
import {
  sendTelegramTestAction,
  updateEntityNameAction,
  updatePasswordAction,
  updateTelegramChatIdAction,
  type ActionResult
} from "./actions";

export function SettingsForms({
  entity,
  email,
  role
}: {
  entity: Entity;
  email: string | null;
  role: "owner" | "viewer";
}) {
  const isOwner = role === "owner";
  return (
    <div className="mt-6 grid gap-4">
      <Section title="Entidad">
        <p className="text-xs text-ink-dim">
          UBIGEO <span className="font-mono">{entity.ubigeo}</span> · Tipo{" "}
          <span className="font-mono">{entity.tipo}</span>
        </p>
        <Form
          action={updateEntityNameAction}
          submitLabel="Guardar"
          disabled={!isOwner}
          fields={[
            {
              name: "nombre",
              label: "Nombre oficial",
              defaultValue: entity.nombre,
              type: "text",
              required: true
            }
          ]}
        />
      </Section>

      <Section title="Telegram">
        <p className="text-xs text-ink-dim">
          Crea un bot con <span className="font-mono">@BotFather</span>, agrega el bot a tu grupo
          o canal y pega aquí el <span className="font-mono">chat_id</span>. ObraScope enviará el
          digest semanal y alertas de proyectos en zona crítica.
        </p>
        <Form
          action={updateTelegramChatIdAction}
          submitLabel={entity.telegram_chat_id ? "Actualizar" : "Conectar"}
          disabled={!isOwner}
          fields={[
            {
              name: "telegram_chat_id",
              label: "chat_id",
              defaultValue: entity.telegram_chat_id ?? "",
              placeholder: "-1001234567890",
              type: "text",
              required: false,
              mono: true
            }
          ]}
        />
        {entity.telegram_chat_id ? (
          <TestSendButton disabled={!isOwner} />
        ) : (
          <p className="text-xs text-ink-dim">Sin chat configurado.</p>
        )}
      </Section>

      <Section title="Seguridad">
        <p className="text-xs text-ink-dim">
          Sesión activa: <span className="font-mono">{email ?? "—"}</span>
        </p>
        <Form
          action={updatePasswordAction}
          submitLabel="Cambiar contraseña"
          fields={[
            { name: "password", label: "Nueva contraseña", type: "password", required: true },
            { name: "confirm", label: "Repetir contraseña", type: "password", required: true }
          ]}
        />
      </Section>

      {!isOwner ? (
        <p className="text-xs text-ink-dim">
          Tu rol es <span className="font-mono">viewer</span>. Pide a un owner que actualice los
          ajustes de la entidad.
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

interface FieldDef {
  name: string;
  label: string;
  type: "text" | "password";
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  mono?: boolean;
}

function Form({
  action,
  fields,
  submitLabel,
  disabled
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  fields: FieldDef[];
  submitLabel: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function submit(form: HTMLFormElement) {
    start(async () => {
      const fd = new FormData(form);
      const r = await action(fd);
      setResult(r);
      if (r.ok) form.reset();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="flex flex-col gap-3"
    >
      {fields.map((f) => (
        <div key={f.name}>
          <label className="label" htmlFor={f.name}>
            {f.label}
          </label>
          <input
            id={f.name}
            name={f.name}
            type={f.type}
            required={f.required}
            defaultValue={f.defaultValue}
            placeholder={f.placeholder}
            className={`input mt-1 ${f.mono ? "num" : ""}`}
          />
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending || disabled} className="btn-primary">
          {pending ? "Guardando…" : submitLabel}
        </button>
        {result ? <ResultPill result={result} /> : null}
      </div>
    </form>
  );
}

function TestSendButton({ disabled }: { disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);

  function send() {
    start(async () => {
      const r = await sendTelegramTestAction();
      setResult(r);
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={send} disabled={pending || disabled} className="btn-ghost text-xs">
        {pending ? "Enviando…" : "Enviar mensaje de prueba"}
      </button>
      {result ? <ResultPill result={result} /> : null}
    </div>
  );
}

function ResultPill({ result }: { result: ActionResult }) {
  return result.ok ? (
    <span className="rounded-sm border border-sema-green/40 bg-sema-green/10 px-2 py-0.5 text-xs text-sema-green">
      {result.message}
    </span>
  ) : (
    <span className="rounded-sm border border-sema-red/40 bg-sema-red/10 px-2 py-0.5 text-xs text-sema-red">
      {result.error}
    </span>
  );
}

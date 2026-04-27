"use client";

import { useState, useTransition } from "react";
import type { Clinic } from "@/lib/types";
import {
  sendWhatsAppTestAction,
  updateClinicAction,
  updateIntegrationsAction,
  updatePasswordAction
} from "./actions";

type Result = { ok: boolean; text: string };

export function SettingsForms({
  clinic,
  email,
  role
}: {
  clinic: Clinic;
  email: string | null;
  role: "owner" | "staff";
}) {
  const isOwner = role === "owner";

  return (
    <div className="grid gap-4">
      <Section title="Clínica">
        <ClinicForm clinic={clinic} disabled={!isOwner} />
      </Section>

      <Section title="Integraciones">
        <IntegrationsForm clinic={clinic} disabled={!isOwner} />
      </Section>

      <Section title="Seguridad">
        <PasswordForm email={email} />
      </Section>

      {!isOwner ? (
        <p className="text-xs text-ink-dim">
          Tu rol es <span className="font-mono">staff</span>. Pide a un owner que actualice los
          datos de la clínica e integraciones.
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ClinicForm({ clinic, disabled }: { clinic: Clinic; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<Result | null>(null);
  function submit(form: HTMLFormElement) {
    setFeedback(null);
    const fd = new FormData(form);
    start(async () => {
      const r = await updateClinicAction(fd);
      setFeedback({ ok: r.ok, text: r.ok ? r.message ?? "Guardado." : r.error });
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="grid gap-4"
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="name" label="Nombre" defaultValue={clinic.name} required />
        <Field
          name="signal_amount"
          label={`Señal Yape (${clinic.currency})`}
          type="number"
          defaultValue={String(clinic.signal_amount)}
          required
          mono
        />
      </div>
      <Field name="bot_persona" label="Persona del bot" defaultValue={clinic.bot_persona ?? ""} />
      <Textarea
        name="bot_extra_instructions"
        label="Instrucciones extra al bot"
        defaultValue={clinic.bot_extra_instructions ?? ""}
        rows={4}
      />
      <Submit pending={pending} disabled={disabled} feedback={feedback} label="Guardar clínica" />
    </form>
  );
}

function IntegrationsForm({ clinic, disabled }: { clinic: Clinic; disabled: boolean }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<Result | null>(null);
  const [testPhone, setTestPhone] = useState("");

  function save(form: HTMLFormElement) {
    setFeedback(null);
    const fd = new FormData(form);
    start(async () => {
      const r = await updateIntegrationsAction(fd);
      setFeedback({ ok: r.ok, text: r.ok ? r.message ?? "Guardado." : r.error });
    });
  }
  function test() {
    setFeedback(null);
    start(async () => {
      const r = await sendWhatsAppTestAction(testPhone);
      setFeedback({ ok: r.ok, text: r.ok ? r.message ?? "Enviado." : r.error });
    });
  }

  return (
    <div className="grid gap-5">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(e.currentTarget);
        }}
        className="grid gap-4"
      >
        <Field name="yape_handle" label="Handle Yape Empresas" defaultValue={clinic.yape_handle ?? ""} mono placeholder="@miClinica" />
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            name="whatsapp_phone_number_id"
            label="WhatsApp Phone Number ID"
            defaultValue={clinic.whatsapp_phone_number_id ?? ""}
            mono
          />
          <Field
            name="whatsapp_business_account_id"
            label="WhatsApp Business Account ID"
            defaultValue={clinic.whatsapp_business_account_id ?? ""}
            mono
          />
        </div>
        <Field
          name="whatsapp_access_token"
          label="WhatsApp Access Token"
          defaultValue=""
          placeholder={clinic.whatsapp_access_token ? "(token configurado — déjalo vacío para conservarlo)" : "EAAB…"}
          type="password"
        />
        <Submit pending={pending} disabled={disabled} feedback={feedback} label="Guardar integraciones" />
      </form>

      <div className="grid gap-2 border-t border-bg-border pt-4">
        <p className="label">Probar conexión WhatsApp</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="51999888777"
            className="input num max-w-xs"
          />
          <button onClick={test} disabled={pending || disabled || !clinic.whatsapp_phone_number_id} className="btn-ghost text-xs">
            Enviar prueba
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordForm({ email }: { email: string | null }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<Result | null>(null);
  function submit(form: HTMLFormElement) {
    setFeedback(null);
    const fd = new FormData(form);
    start(async () => {
      const r = await updatePasswordAction(fd);
      setFeedback({ ok: r.ok, text: r.ok ? r.message ?? "Actualizada." : r.error });
      if (r.ok) form.reset();
    });
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit(e.currentTarget);
      }}
      className="grid gap-4"
    >
      <p className="text-xs text-ink-dim">Sesión: <span className="font-mono">{email ?? "—"}</span></p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="password" label="Nueva contraseña" type="password" required />
        <Field name="confirm" label="Repetir contraseña" type="password" required />
      </div>
      <Submit pending={pending} feedback={feedback} label="Cambiar contraseña" />
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  required,
  placeholder,
  mono
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className={`input mt-1 ${mono ? "num" : ""}`}
      />
    </div>
  );
}

function Textarea({
  name,
  label,
  defaultValue,
  rows
}: {
  name: string;
  label: string;
  defaultValue?: string;
  rows?: number;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <textarea id={name} name={name} rows={rows ?? 3} defaultValue={defaultValue} className="input mt-1" />
    </div>
  );
}

function Submit({
  pending,
  disabled,
  feedback,
  label
}: {
  pending: boolean;
  disabled?: boolean;
  feedback: Result | null;
  label: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      {feedback ? (
        <span className={`text-xs ${feedback.ok ? "text-ok" : "text-err"}`}>{feedback.text}</span>
      ) : null}
      <button type="submit" disabled={pending || disabled} className="btn-primary">
        {pending ? "Guardando…" : label}
      </button>
    </div>
  );
}

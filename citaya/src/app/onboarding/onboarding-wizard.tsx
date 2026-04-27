"use client";

import { useMemo, useState, useTransition } from "react";
import type { AvailabilityRule, Clinic, Service } from "@/lib/types";
import { dayName, minutesToLabel } from "@/lib/format";
import { saveOnboardingStep } from "./actions";

type Step = 1 | 2 | 3 | 4;

interface ServiceForm {
  id?: string;
  name: string;
  duration_minutes: number;
  price: number;
  description: string;
}

interface ScheduleForm {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

const DEFAULT_SCHEDULE: ScheduleForm[] = [
  { day: 1, enabled: true, start: "09:00", end: "19:00" },
  { day: 2, enabled: true, start: "09:00", end: "19:00" },
  { day: 3, enabled: true, start: "09:00", end: "19:00" },
  { day: 4, enabled: true, start: "09:00", end: "19:00" },
  { day: 5, enabled: true, start: "09:00", end: "19:00" },
  { day: 6, enabled: true, start: "09:00", end: "14:00" },
  { day: 0, enabled: false, start: "10:00", end: "13:00" }
];

export function OnboardingWizard({
  clinic,
  services,
  rules
}: {
  clinic: Clinic;
  services: Service[];
  rules: AvailabilityRule[];
}) {
  const [step, setStep] = useState<Step>(1);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Step 1: clinic basics
  const [signal, setSignal] = useState(clinic.signal_amount);
  const [persona, setPersona] = useState(clinic.bot_persona ?? "");
  const [extra, setExtra] = useState(clinic.bot_extra_instructions ?? "");

  // Step 2: services
  const initialServices: ServiceForm[] = useMemo(
    () =>
      services.length > 0
        ? services.map((s) => ({
            id: s.id,
            name: s.name,
            duration_minutes: s.duration_minutes,
            price: Number(s.price),
            description: s.description ?? ""
          }))
        : [
            { name: "Consulta inicial", duration_minutes: 30, price: 100, description: "" },
            { name: "Limpieza dental", duration_minutes: 45, price: 180, description: "" }
          ],
    [services]
  );
  const [serviceList, setServiceList] = useState<ServiceForm[]>(initialServices);

  // Step 3: schedule
  const initialSchedule: ScheduleForm[] = useMemo(() => {
    if (rules.length === 0) return DEFAULT_SCHEDULE;
    const byDay = new Map<number, AvailabilityRule>();
    for (const r of rules) byDay.set(r.day_of_week, r);
    return DEFAULT_SCHEDULE.map((d) => {
      const r = byDay.get(d.day);
      if (!r) return { ...d, enabled: false };
      return {
        day: d.day,
        enabled: true,
        start: minutesToLabel(r.start_minute),
        end: minutesToLabel(r.end_minute)
      };
    });
  }, [rules]);
  const [schedule, setSchedule] = useState<ScheduleForm[]>(initialSchedule);

  // Step 4: integrations
  const [yapeHandle, setYapeHandle] = useState(clinic.yape_handle ?? "");
  const [waPhoneId, setWaPhoneId] = useState(clinic.whatsapp_phone_number_id ?? "");
  const [waBizId, setWaBizId] = useState(clinic.whatsapp_business_account_id ?? "");
  const [waToken, setWaToken] = useState(clinic.whatsapp_access_token ?? "");

  function next() {
    setError(null);
    start(async () => {
      let result;
      if (step === 1) {
        result = await saveOnboardingStep({
          step: "clinic",
          signal_amount: signal,
          bot_persona: persona,
          bot_extra_instructions: extra
        });
      } else if (step === 2) {
        result = await saveOnboardingStep({
          step: "services",
          services: serviceList.map((s) => ({
            name: s.name,
            duration_minutes: s.duration_minutes,
            price: s.price,
            description: s.description
          }))
        });
      } else if (step === 3) {
        result = await saveOnboardingStep({ step: "schedule", schedule });
      } else if (step === 4) {
        result = await saveOnboardingStep({
          step: "integrations",
          yape_handle: yapeHandle,
          whatsapp_phone_number_id: waPhoneId,
          whatsapp_business_account_id: waBizId,
          whatsapp_access_token: waToken
        });
        if (result.ok) {
          await saveOnboardingStep({ step: "finish" });
        }
      }
      if (!result || !result.ok) {
        setError(result && !result.ok ? result.error : "Error desconocido.");
        return;
      }
      if (step < 4) setStep((step + 1) as Step);
    });
  }

  function back() {
    if (step > 1) setStep((step - 1) as Step);
  }

  return (
    <div className="mt-8">
      <Stepper current={step} />
      <div className="mt-8 panel p-6">
        {step === 1 ? (
          <ClinicBasics
            signal={signal}
            setSignal={setSignal}
            persona={persona}
            setPersona={setPersona}
            extra={extra}
            setExtra={setExtra}
          />
        ) : null}
        {step === 2 ? (
          <ServicesEditor list={serviceList} setList={setServiceList} />
        ) : null}
        {step === 3 ? <ScheduleEditor schedule={schedule} setSchedule={setSchedule} /> : null}
        {step === 4 ? (
          <Integrations
            yapeHandle={yapeHandle}
            setYapeHandle={setYapeHandle}
            waPhoneId={waPhoneId}
            setWaPhoneId={setWaPhoneId}
            waBizId={waBizId}
            setWaBizId={setWaBizId}
            waToken={waToken}
            setWaToken={setWaToken}
          />
        ) : null}

        {error ? (
          <div className="mt-4 rounded-md border border-err/40 bg-err/5 px-3 py-2 text-xs text-err">{error}</div>
        ) : null}

        <div className="mt-6 flex items-center justify-between border-t border-bg-border pt-5">
          <button
            type="button"
            onClick={back}
            disabled={pending || step === 1}
            className="btn-ghost disabled:opacity-40"
          >
            ← Atrás
          </button>
          <button type="button" onClick={next} disabled={pending} className="btn-primary">
            {pending ? "Guardando…" : step === 4 ? "Finalizar y entrar al panel" : "Siguiente →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: Step }) {
  const labels = ["Clínica", "Servicios", "Horarios", "Integraciones"];
  return (
    <ol className="flex items-center gap-3 text-xs">
      {labels.map((l, i) => {
        const n = (i + 1) as Step;
        const active = n === current;
        const done = n < current;
        return (
          <li key={l} className="flex items-center gap-3">
            <span
              className={`grid h-6 w-6 place-items-center rounded-full text-xs font-semibold ${
                done ? "bg-brand text-white" : active ? "bg-brand-soft text-brand" : "bg-bg-elev text-ink-dim border border-bg-border"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={active ? "font-semibold text-ink" : "text-ink-mute"}>{l}</span>
            {n < 4 ? <span className="text-ink-dim">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function ClinicBasics({
  signal,
  setSignal,
  persona,
  setPersona,
  extra,
  setExtra
}: {
  signal: number;
  setSignal: (n: number) => void;
  persona: string;
  setPersona: (s: string) => void;
  extra: string;
  setExtra: (s: string) => void;
}) {
  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg font-semibold">Datos básicos</h2>
        <p className="mt-1 text-sm text-ink-mute">Cómo se presenta el bot y cuánto cobra de señal.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label" htmlFor="signal">Señal Yape (S/.)</label>
          <input
            id="signal"
            type="number"
            min={0}
            step={5}
            value={signal}
            onChange={(e) => setSignal(Number(e.target.value))}
            className="input mt-1 num"
          />
          <p className="mt-1 text-xs text-ink-dim">
            Monto descontable del total. Recomendado: 20-30% del ticket promedio.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="persona">Persona del bot</label>
          <input
            id="persona"
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="asistente cordial y profesional, tutea al paciente"
            className="input mt-1"
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="extra">Instrucciones extra para el bot</label>
        <textarea
          id="extra"
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          rows={4}
          className="input mt-1"
          placeholder="Ej: si el paciente pregunta por ortodoncia, ofrece cita gratis de evaluación. No agendamos los martes en la mañana porque el doctor opera. Etc."
        />
      </div>
    </div>
  );
}

function ServicesEditor({
  list,
  setList
}: {
  list: ServiceForm[];
  setList: (l: ServiceForm[]) => void;
}) {
  function update(i: number, key: keyof ServiceForm, value: string | number) {
    const next = [...list];
    (next[i] as Record<keyof ServiceForm, string | number | undefined>)[key] = value;
    setList(next);
  }
  function add() {
    setList([...list, { name: "", duration_minutes: 30, price: 0, description: "" }]);
  }
  function remove(i: number) {
    setList(list.filter((_, idx) => idx !== i));
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg font-semibold">Catálogo de servicios</h2>
        <p className="mt-1 text-sm text-ink-mute">
          El bot solo ofrece servicios listados acá. Puedes editarlos después.
        </p>
      </div>
      <div className="grid gap-3">
        {list.map((s, i) => (
          <div key={i} className="grid gap-2 rounded-md border border-bg-border bg-bg p-3 md:grid-cols-[1.5fr_0.7fr_0.7fr_2fr_auto]">
            <input
              value={s.name}
              onChange={(e) => update(i, "name", e.target.value)}
              placeholder="Nombre del servicio"
              className="input"
            />
            <input
              type="number"
              min={5}
              step={5}
              value={s.duration_minutes}
              onChange={(e) => update(i, "duration_minutes", Number(e.target.value))}
              placeholder="Min"
              className="input num"
            />
            <input
              type="number"
              min={0}
              step={10}
              value={s.price}
              onChange={(e) => update(i, "price", Number(e.target.value))}
              placeholder="Precio"
              className="input num"
            />
            <input
              value={s.description}
              onChange={(e) => update(i, "description", e.target.value)}
              placeholder="Breve descripción (opcional)"
              className="input"
            />
            <button type="button" onClick={() => remove(i)} className="btn-ghost text-xs">
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="btn-ghost self-start">
        + Agregar servicio
      </button>
    </div>
  );
}

function ScheduleEditor({
  schedule,
  setSchedule
}: {
  schedule: ScheduleForm[];
  setSchedule: (s: ScheduleForm[]) => void;
}) {
  function update(i: number, patch: Partial<ScheduleForm>) {
    const next = [...schedule];
    next[i] = { ...next[i], ...patch };
    setSchedule(next);
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-lg font-semibold">Horarios de atención</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Marca los días y rangos en los que tu clínica atiende. El bot solo agendará dentro de
          estos horarios.
        </p>
      </div>
      <div className="grid gap-2">
        {schedule.map((d, i) => (
          <div key={d.day} className="grid items-center gap-3 rounded-md border border-bg-border bg-bg p-3 md:grid-cols-[1fr_auto_auto_1fr]">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={d.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                className="h-4 w-4 rounded border-bg-border text-brand"
              />
              <span className="font-medium">{dayName(d.day)}</span>
            </label>
            <input
              type="time"
              value={d.start}
              disabled={!d.enabled}
              onChange={(e) => update(i, { start: e.target.value })}
              className="input num w-32"
            />
            <span className="text-ink-dim">→</span>
            <input
              type="time"
              value={d.end}
              disabled={!d.enabled}
              onChange={(e) => update(i, { end: e.target.value })}
              className="input num w-32"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Integrations({
  yapeHandle,
  setYapeHandle,
  waPhoneId,
  setWaPhoneId,
  waBizId,
  setWaBizId,
  waToken,
  setWaToken
}: {
  yapeHandle: string;
  setYapeHandle: (s: string) => void;
  waPhoneId: string;
  setWaPhoneId: (s: string) => void;
  waBizId: string;
  setWaBizId: (s: string) => void;
  waToken: string;
  setWaToken: (s: string) => void;
}) {
  return (
    <div className="grid gap-6">
      <div>
        <h2 className="text-lg font-semibold">Integraciones</h2>
        <p className="mt-1 text-sm text-ink-mute">
          Estos datos se necesitan para que el bot reciba mensajes y cobre. Te ayudamos a
          obtenerlos en una llamada de 30 min si lo prefieres — puedes saltarte esto y
          completarlo desde Configuración.
        </p>
      </div>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">Yape</h3>
        <div>
          <label className="label" htmlFor="yape">Handle Yape Empresas</label>
          <input
            id="yape"
            value={yapeHandle}
            onChange={(e) => setYapeHandle(e.target.value)}
            placeholder="@tuClinica"
            className="input mt-1 num"
          />
          <p className="mt-1 text-xs text-ink-dim">
            Si no tienes Yape Empresas, déjalo en blanco — generamos un link manual y la clínica
            confirma el pago desde el panel.
          </p>
        </div>
      </section>

      <section className="grid gap-3">
        <h3 className="text-sm font-semibold">WhatsApp Cloud API</h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="phone_id">Phone Number ID</label>
            <input
              id="phone_id"
              value={waPhoneId}
              onChange={(e) => setWaPhoneId(e.target.value)}
              placeholder="123456789012345"
              className="input mt-1 num"
            />
          </div>
          <div>
            <label className="label" htmlFor="biz_id">Business Account ID</label>
            <input
              id="biz_id"
              value={waBizId}
              onChange={(e) => setWaBizId(e.target.value)}
              placeholder="987654321098765"
              className="input mt-1 num"
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="token">Access Token (System User)</label>
          <input
            id="token"
            value={waToken}
            onChange={(e) => setWaToken(e.target.value)}
            placeholder="EAAB…"
            type="password"
            className="input mt-1"
          />
          <p className="mt-1 text-xs text-ink-dim">
            Token del System User en Meta Business Suite con scopes de WhatsApp messaging.
          </p>
        </div>
      </section>
    </div>
  );
}

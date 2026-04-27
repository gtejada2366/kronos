"use client";

import { useState, useTransition } from "react";
import type { AvailabilityOverride, AvailabilityRule } from "@/lib/types";
import { dayName, fmtDate, minutesToLabel } from "@/lib/format";
import {
  addOverrideAction,
  deleteOverrideAction,
  saveScheduleAction
} from "./actions";

interface DayRow {
  day: number;
  enabled: boolean;
  start: string;
  end: string;
}

const ORDER = [1, 2, 3, 4, 5, 6, 0];

function buildInitial(rules: AvailabilityRule[]): DayRow[] {
  const byDay = new Map<number, AvailabilityRule>();
  for (const r of rules) byDay.set(r.day_of_week, r);
  return ORDER.map((day) => {
    const r = byDay.get(day);
    return r
      ? { day, enabled: true, start: minutesToLabel(r.start_minute), end: minutesToLabel(r.end_minute) }
      : { day, enabled: false, start: "09:00", end: "19:00" };
  });
}

export function AvailabilityForm({
  rules,
  overrides
}: {
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
}) {
  const [days, setDays] = useState<DayRow[]>(buildInitial(rules));
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [overrideDate, setOverrideDate] = useState("");
  const [overrideClosed, setOverrideClosed] = useState(true);
  const [overrideStart, setOverrideStart] = useState("");
  const [overrideEnd, setOverrideEnd] = useState("");
  const [overrideNote, setOverrideNote] = useState("");

  function update(i: number, patch: Partial<DayRow>) {
    const next = [...days];
    next[i] = { ...next[i], ...patch };
    setDays(next);
  }

  function saveSchedule() {
    setFeedback(null);
    start(async () => {
      const r = await saveScheduleAction(days);
      if (!r.ok) setFeedback({ ok: false, text: r.error });
      else setFeedback({ ok: true, text: r.message ?? "Guardado." });
    });
  }

  function addOverride() {
    setFeedback(null);
    if (!overrideDate) {
      setFeedback({ ok: false, text: "Elige una fecha." });
      return;
    }
    start(async () => {
      const r = await addOverrideAction({
        date: overrideDate,
        closed: overrideClosed,
        custom_start: overrideClosed ? undefined : overrideStart,
        custom_end: overrideClosed ? undefined : overrideEnd,
        note: overrideNote
      });
      if (!r.ok) setFeedback({ ok: false, text: r.error });
      else {
        setFeedback({ ok: true, text: "Excepción guardada." });
        setOverrideDate("");
        setOverrideNote("");
      }
    });
  }

  function removeOverride(id: string) {
    start(async () => {
      const r = await deleteOverrideAction(id);
      if (!r.ok) setFeedback({ ok: false, text: r.error });
    });
  }

  return (
    <div className="grid gap-6">
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Horario semanal</h2>
        <div className="mt-4 grid gap-2">
          {days.map((d, i) => (
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
                disabled={!d.enabled}
                value={d.start}
                onChange={(e) => update(i, { start: e.target.value })}
                className="input num w-32"
              />
              <span className="text-ink-dim">→</span>
              <input
                type="time"
                disabled={!d.enabled}
                value={d.end}
                onChange={(e) => update(i, { end: e.target.value })}
                className="input num w-32"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {feedback ? (
            <span className={`text-xs ${feedback.ok ? "text-ok" : "text-err"}`}>{feedback.text}</span>
          ) : null}
          <button onClick={saveSchedule} disabled={pending} className="btn-primary">
            {pending ? "Guardando…" : "Guardar horario"}
          </button>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Excepciones (feriados, días especiales)</h2>
        <div className="mt-4 grid items-end gap-3 md:grid-cols-[auto_auto_auto_auto_1fr_auto]">
          <div>
            <label className="label">Fecha</label>
            <input
              type="date"
              value={overrideDate}
              onChange={(e) => setOverrideDate(e.target.value)}
              className="input mt-1 num w-40"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={overrideClosed}
              onChange={(e) => setOverrideClosed(e.target.checked)}
              className="h-4 w-4 rounded border-bg-border text-brand"
            />
            Cerrado
          </label>
          <input
            type="time"
            disabled={overrideClosed}
            value={overrideStart}
            onChange={(e) => setOverrideStart(e.target.value)}
            className="input num w-32"
          />
          <input
            type="time"
            disabled={overrideClosed}
            value={overrideEnd}
            onChange={(e) => setOverrideEnd(e.target.value)}
            className="input num w-32"
          />
          <input
            value={overrideNote}
            onChange={(e) => setOverrideNote(e.target.value)}
            placeholder="Nota (ej: Feriado, Capacitación)"
            className="input"
          />
          <button onClick={addOverride} disabled={pending} className="btn-primary">
            Agregar
          </button>
        </div>

        <ul className="mt-5 divide-y divide-bg-border">
          {overrides.length === 0 ? (
            <li className="py-3 text-sm text-ink-dim">Sin excepciones configuradas.</li>
          ) : (
            overrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium">{fmtDate(o.date)}</p>
                  <p className="text-xs text-ink-mute">
                    {o.closed
                      ? "Cerrado"
                      : `${o.custom_start_minute != null ? minutesToLabel(o.custom_start_minute) : "—"} → ${
                          o.custom_end_minute != null ? minutesToLabel(o.custom_end_minute) : "—"
                        }`}
                    {o.note ? ` · ${o.note}` : ""}
                  </p>
                </div>
                <button onClick={() => removeOverride(o.id)} className="btn-ghost text-xs">
                  ✕
                </button>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}

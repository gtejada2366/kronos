"use client";

import { useState, useTransition } from "react";
import type { Service } from "@/lib/types";
import { saveServicesAction } from "./actions";

interface Row {
  id?: string;
  name: string;
  description: string;
  duration_minutes: number;
  price: number;
  active: boolean;
}

export function ServicesEditor({ initial }: { initial: Service[] }) {
  const [rows, setRows] = useState<Row[]>(
    initial.length > 0
      ? initial.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description ?? "",
          duration_minutes: s.duration_minutes,
          price: Number(s.price),
          active: s.active
        }))
      : [{ name: "", description: "", duration_minutes: 30, price: 0, active: true }]
  );
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  function update(i: number, patch: Partial<Row>) {
    const next = [...rows];
    next[i] = { ...next[i], ...patch };
    setRows(next);
  }
  function add() {
    setRows([...rows, { name: "", description: "", duration_minutes: 30, price: 0, active: true }]);
  }
  function remove(i: number) {
    setRows(rows.filter((_, idx) => idx !== i));
  }
  function save() {
    setFeedback(null);
    start(async () => {
      const r = await saveServicesAction(rows);
      if (!r.ok) setFeedback({ ok: false, text: r.error });
      else setFeedback({ ok: true, text: r.message ?? "Guardado." });
    });
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3">
        {rows.map((s, i) => (
          <div key={s.id ?? `tmp-${i}`} className="panel grid items-center gap-2 p-3 md:grid-cols-[1.5fr_0.7fr_0.7fr_2fr_auto_auto]">
            <input
              value={s.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Nombre"
              className="input"
            />
            <input
              type="number"
              min={5}
              step={5}
              value={s.duration_minutes}
              onChange={(e) => update(i, { duration_minutes: Number(e.target.value) })}
              className="input num"
            />
            <input
              type="number"
              min={0}
              step={10}
              value={s.price}
              onChange={(e) => update(i, { price: Number(e.target.value) })}
              className="input num"
            />
            <input
              value={s.description}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="Descripción"
              className="input"
            />
            <label className="flex items-center gap-1 text-xs text-ink-mute">
              <input
                type="checkbox"
                checked={s.active}
                onChange={(e) => update(i, { active: e.target.checked })}
                className="h-4 w-4 rounded border-bg-border text-brand"
              />
              Activo
            </label>
            <button onClick={() => remove(i)} className="btn-ghost text-xs">✕</button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button onClick={add} className="btn-ghost">+ Agregar servicio</button>
        <div className="flex items-center gap-3">
          {feedback ? (
            <span className={`text-xs ${feedback.ok ? "text-ok" : "text-err"}`}>{feedback.text}</span>
          ) : null}
          <button onClick={save} disabled={pending} className="btn-primary">
            {pending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}

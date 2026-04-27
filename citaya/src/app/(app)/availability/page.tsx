import { redirect } from "next/navigation";
import { getAvailabilityOverrides, getAvailabilityRules, getCurrentContext } from "@/lib/data";
import { AvailabilityForm } from "./availability-form";

export const metadata = { title: "Horarios · Citaya" };
export const dynamic = "force-dynamic";

export default async function AvailabilityPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const [rules, overrides] = await Promise.all([
    getAvailabilityRules(ctx.clinic.id),
    getAvailabilityOverrides(ctx.clinic.id)
  ]);

  return (
    <div>
      <header>
        <h1 className="text-2xl font-semibold">Horarios y excepciones</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Configura los días y horas en los que tu bot puede agendar. Las excepciones cubren
          feriados o días puntuales con horario distinto.
        </p>
      </header>
      <div className="mt-6">
        <AvailabilityForm rules={rules} overrides={overrides} />
      </div>
    </div>
  );
}

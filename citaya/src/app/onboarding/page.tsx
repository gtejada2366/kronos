import { redirect } from "next/navigation";
import { getCurrentContext, getServices, getAvailabilityRules } from "@/lib/data";
import { OnboardingWizard } from "./onboarding-wizard";

export const metadata = { title: "Onboarding · Citaya" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const [services, rules] = await Promise.all([
    getServices(ctx.clinic.id),
    getAvailabilityRules(ctx.clinic.id)
  ]);

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Configura tu clínica</h1>
      <p className="mt-1 text-sm text-ink-mute">
        4 pasos. Te toma 10 minutos. Puedes editar todo después en Configuración.
      </p>
      <OnboardingWizard clinic={ctx.clinic} services={services} rules={rules} />
    </main>
  );
}

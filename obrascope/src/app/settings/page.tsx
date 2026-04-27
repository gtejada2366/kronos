import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { getCurrentContext } from "@/lib/data";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Configuración · ObraScope" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  return (
    <div className="min-h-screen">
      <Topbar entity={ctx.entity} email={ctx.user.email} />
      <main className="mx-auto max-w-3xl px-6 py-6">
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Datos de la entidad, integración con Telegram y seguridad de tu cuenta. Solo el rol{" "}
          <span className="font-mono">owner</span> puede modificar la entidad.
        </p>
        <SettingsForms entity={ctx.entity} email={ctx.user.email} role={ctx.profile.role} />
      </main>
    </div>
  );
}

import { redirect } from "next/navigation";
import { getCurrentContext } from "@/lib/data";
import { SettingsForms } from "./settings-forms";

export const metadata = { title: "Configuración · Citaya" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  return (
    <div>
      <header>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="mt-1 text-sm text-ink-mute">
          Datos de la clínica, integraciones (WhatsApp + Yape) y seguridad de tu cuenta.
        </p>
      </header>
      <div className="mt-6">
        <SettingsForms clinic={ctx.clinic} email={ctx.user.email} role={ctx.profile.role} />
      </div>
    </div>
  );
}

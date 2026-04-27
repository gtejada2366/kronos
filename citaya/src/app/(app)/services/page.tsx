import { redirect } from "next/navigation";
import { getCurrentContext, getServices } from "@/lib/data";
import { ServicesEditor } from "./services-editor";

export const metadata = { title: "Servicios · Citaya" };
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");

  const services = await getServices(ctx.clinic.id);

  return (
    <div>
      <header>
        <h1 className="text-2xl font-semibold">Catálogo de servicios</h1>
        <p className="mt-1 text-sm text-ink-mute">
          El bot solo ofrece servicios listados aquí. Desactiva uno para que el bot deje de
          ofrecerlo sin tener que borrarlo.
        </p>
      </header>
      <div className="mt-6">
        <ServicesEditor initial={services} />
      </div>
    </div>
  );
}

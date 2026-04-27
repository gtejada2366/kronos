import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { Sidebar } from "@/components/Sidebar";
import { getCurrentContext } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCurrentContext();
  if (!ctx) redirect("/login");
  if (!ctx.clinic.onboarded) redirect("/onboarding");

  return (
    <div className="min-h-screen">
      <Topbar clinic={ctx.clinic} email={ctx.user.email} />
      <div className="mx-auto flex max-w-[1400px]">
        <Sidebar />
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  function logout() {
    start(async () => {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <button onClick={logout} disabled={pending} className="btn-ghost text-xs">
      {pending ? "Saliendo…" : "Cerrar sesión"}
    </button>
  );
}

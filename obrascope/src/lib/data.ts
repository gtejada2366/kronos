import { createSupabaseServerClient } from "./supabase/server";
import { enrichProject } from "./semaforo";
import type { Alert, Entity, Execution, Profile, Project, ProjectWithSemaforo } from "./types";

export async function getCurrentContext(): Promise<{
  user: { id: string; email: string | null };
  profile: Profile;
  entity: Entity;
} | null> {
  const supabase = createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .single<Profile>();

  if (!profile) return null;

  const { data: entity } = await supabase
    .from("entities")
    .select("*")
    .eq("id", profile.entity_id)
    .single<Entity>();

  if (!entity) return null;

  return {
    user: { id: auth.user.id, email: auth.user.email ?? null },
    profile,
    entity
  };
}

export async function getProjectsForEntity(entityId: string): Promise<ProjectWithSemaforo[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("entity_id", entityId)
    .order("codigo", { ascending: true });
  const rows = (data ?? []) as Project[];
  return rows.map((p) => enrichProject(p));
}

export async function getProject(projectId: string): Promise<ProjectWithSemaforo | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle<Project>();
  if (!data) return null;
  return enrichProject(data);
}

export async function getExecutions(projectId: string): Promise<Execution[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("executions")
    .select("*")
    .eq("project_id", projectId)
    .order("anio", { ascending: true })
    .order("mes", { ascending: true });
  return (data ?? []) as Execution[];
}

export async function getAlertsForProject(projectId: string): Promise<Alert[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from("alerts")
    .select("*")
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false })
    .limit(20);
  return (data ?? []) as Alert[];
}

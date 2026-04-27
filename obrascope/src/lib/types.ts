export type EntityTipo = "MUNICIPALIDAD_PROVINCIAL" | "MUNICIPALIDAD_DISTRITAL" | "GOBIERNO_REGIONAL";

export type ProjectEstado = "EN_EJECUCION" | "PARALIZADO" | "CONCLUIDO" | "EN_LIQUIDACION";

export type AlertTipo = "SEMAFORO_ROJO" | "DEVENGADO_BAJO" | "PARALIZADO" | "DIGEST_SEMANAL";

export type Semaforo = "verde" | "amarillo" | "rojo";

export interface Entity {
  id: string;
  nombre: string;
  ubigeo: string;
  tipo: EntityTipo;
  telegram_chat_id: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  entity_id: string;
  codigo: string;
  nombre: string;
  pia: number;
  pim: number;
  devengado: number;
  avance_fisico: number;
  estado: ProjectEstado;
  fecha_inicio: string;
  fecha_fin: string;
  updated_at: string;
}

export interface Execution {
  id: string;
  project_id: string;
  mes: number;
  anio: number;
  devengado: number;
  pim: number;
  created_at: string;
}

export interface Alert {
  id: string;
  project_id: string | null;
  entity_id: string;
  tipo: AlertTipo;
  mensaje: string;
  sent_at: string;
}

export interface Profile {
  id: string;
  entity_id: string;
  role: "owner" | "viewer";
  created_at: string;
}

export interface ProjectHistory {
  id: string;
  project_id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface ProjectWithSemaforo extends Project {
  pct_devengado: number;
  pct_anio_transcurrido: number;
  pct_esperado: number;
  semaforo: Semaforo;
}

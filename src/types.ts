// Espejo de los tipos serde del backend (src-tauri/src/discovery.rs).

export type Transport =
  | { kind: "direct_pretty"; origin: string }
  | { kind: "direct_plain"; origin: string }
  | { kind: "wpcom"; site: string };

export interface Attempt {
  target: string;
  outcome: string;
  ok: boolean;
}

export interface TaxonomyInfo {
  slug: string;
  name: string;
  rest_base: string;
  hierarchical: boolean;
  types: string[];
}

export interface PostTypeInfo {
  slug: string;
  name: string;
  rest_base: string;
  taxonomies: string[];
}

export interface Capabilities {
  anonymous_read: boolean;
  read_status: number;
  total_posts: number | null;
  has_total_header: boolean;
  supports_fields: boolean;
  supports_date_filter: boolean;
  supports_terms_exclude: boolean;
  oldest_date: string | null;
  newest_date: string | null;
  oldest_date_valid: boolean;
  post_types: PostTypeInfo[];
  taxonomies: TaxonomyInfo[];
  notes: string[];
}

export interface Discovery {
  input: string;
  transport: Transport;
  transport_label: string;
  resolved_origin: string;
  site_name: string | null;
  site_description: string | null;
  namespaces: string[];
  auth_methods: string[];
  app_password_endpoint: string | null;
  capabilities: Capabilities;
  attempts: Attempt[];
}

export interface ConnectionRow {
  id: number;
  label: string;
  resolved_origin: string;
  transport_label: string;
  site_name: string | null;
  total_posts: number | null;
  auth_method: string;
  created_at: string;
  last_used_at: string;
}

// ── Censo y perfil (core/src/perfil.rs, core/src/census.rs) ──────────────

export interface AnioFila { anio: number; n: number }

export interface SeccionFila {
  term_id: number;
  nombre: string;
  slug: string;
  parent: number;
  n: number;
}

export interface Sondeo {
  n: number;
  palabras_p50: number;
  palabras_p90: number;
  pct_bloques: number;
  pct_cortas: number;
  pct_roto: number;
  shortcodes: [string, number][];
}

export interface PerfilArchivo {
  censado: number;
  anio_min: number | null;
  anio_max: number | null;
  por_anio: AnioFila[];
  taxonomia: string | null;
  secciones: SeccionFila[];
  anomalias: [string, number][];
  taxonomias_usables: [string, number][];
  sondeo: Sondeo | null;
  sin_fecha: number;
}

export interface Hallazgo {
  clave: string;
  titulo: string;
  conteo: number;
  estimado: boolean;
  bloquea: boolean;
  detalle: string;
  consecuencia: string | null;
  ejemplos: [string, string][];
  opciones: string[];
}

export interface ProgresoCenso {
  fase: "terminos" | "censo" | "sondeo" | "descarga";
  ventana: string;
  hechos: number;
  total: number;
}

export interface FinCenso {
  ok: boolean;
  cancelado: boolean;
  error: string | null;
  filas: number;
}

// ── Muestreo (core/src/muestreo.rs) ─────────────────────────────────────

export interface Epoca { etiqueta: string; desde: number; hasta: number }

export interface Diseno {
  n: number;
  semilla: string;
  epocas: Epoca[];
  excluir_terminos: number[];
  excluir_sin_fecha: boolean;
  taxonomia: string | null;
  equilibrar_epocas: boolean;
}

export interface Celda {
  epoca: string;
  seccion: string;
  seccion_id: number;
  universo: number;
  asignado: number;
}

export interface Sesgo { etiqueta: string; archivo_pct: number; muestra_pct: number }

export interface Plan {
  celdas: Celda[];
  universo: number;
  asignado: number;
  avisos: string[];
  sesgo_epoca: Sesgo[];
  sesgo_seccion: Sesgo[];
}

export interface FilaAnotable {
  wp_id: number;
  epoca: string | null;
  seccion: string | null;
  titulo: string | null;
  fecha: string | null;
  link: string | null;
  texto: string | null;
  html: string | null;
  palabras: number | null;
}

export interface Mencion {
  mid: string;
  pi: number;
  ini: number;
  fin: number;
  texto: string;
  tipo: string;
  /** La propuso la propagación, no la persona. */
  auto: boolean;
  /** Menciones con el mismo grupo nombran la misma entidad. */
  grupo?: string | null;
}

export interface EntradaLexico {
  texto: string;
  tipo: string;
  articulos: number;
  ambigua: boolean;
}

export interface RelacionFila {
  rid: string;
  a_mid: string;
  b_mid: string;
  predicado: string;
}

// ── Resolución y reporte ─────────────────────────────────────────────────

export interface Candidata { nombre: string; tipo: string; menciones: number; articulos: number }

export interface Caso {
  clave: string;
  tipo: string;
  confianza: number;
  motivo: string;
  a: Candidata;
  b: Candidata;
}

export interface Tiempos {
  articulos: number;
  mediana_seg: number;
  p90_seg: number;
  primeros_seg: number | null;
  ultimos_seg: number | null;
}

export interface Proyeccion {
  min_por_100: number;
  min_por_100_maduro: number | null;
  universo: number;
  horas_totales: number;
  horas_totales_maduro: number | null;
}

export interface DensidadTipo { tipo: string; menciones: number; por_articulo: number }
export interface TramoFrecuencia { etiqueta: string; entidades: number; pct: number }

export interface Reporte {
  anotados: number;
  muestra: number;
  universo: number;
  tiempos: Tiempos | null;
  proyeccion: Proyeccion | null;
  entidades_por_articulo: number;
  densidad: DensidadTipo[];
  curva: TramoFrecuencia[];
  entidades_distintas: number;
  resueltos: number;
  pospuestos: number;
}

export interface Puerta {
  horas_necesarias: number;
  horas_disponibles: number;
  cabe: boolean;
  alcance_viable: number;
  pct_archivo: number;
}

// ── Extracción y evaluación ──────────────────────────────────────────────

export interface ProgresoExtraccion {
  fase: "arrancando" | "cargando" | "cargado" | "extrayendo";
  hechos: number;
  total: number;
  wp_id: number;
  entidades: number;
  ms: number;
  detalle: string;
}

export interface Marcador {
  aciertos: number;
  falsos_positivos: number;
  falsos_negativos: number;
  precision: number;
  cobertura: number;
  f1: number;
}

export interface MarcadorTipo {
  tipo: string;
  estricto: Marcador;
  laxo: Marcador;
  anotadas: number;
  extraidas: number;
}

export interface Evaluacion {
  articulos: number;
  global_estricto: Marcador;
  global_laxo: Marcador;
  por_tipo: MarcadorTipo[];
  ejemplos_fp: [string, string][];
  ejemplos_fn: [string, string][];
}

export interface SesionRecuperada {
  connection_id: number | null;
  paso: string;
  progreso: number;
  taxonomia: string | null;
  design_id: number | null;
  etiqueta: string | null;
  sitio: Discovery | null;
}

export type Paso =
  | "conexion" | "perfil" | "sanidad" | "muestreo"
  | "anotacion" | "extraccion" | "resolucion" | "reporte" | "fundamentos";

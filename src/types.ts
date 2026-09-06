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


export interface Sesgo { etiqueta: string; archivo_pct: number; muestra_pct: number }


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



export interface DensidadTipo { tipo: string; menciones: number; por_articulo: number }
export interface TramoFrecuencia { etiqueta: string; entidades: number; pct: number }



// ── Extracción y evaluación ──────────────────────────────────────────────

export interface ProgresoExtraccion {
  fase: "descargando" | "arrancando" | "cargando" | "cargado" | "extrayendo";
  hechos: number;
  total: number;
  wp_id: number;
  entidades: number;
  relaciones: number;
  ms: number;
  detalle: string;
}




export interface SesionRecuperada {
  connection_id: number | null;
  paso: string;
  progreso: number;
  taxonomia: string | null;
  lote_id: number | null;
  etiqueta: string | null;
  sitio: Discovery | null;
}

export type Paso =
  | "conexion" | "perfil" | "sanidad" | "alcance"
  | "calibracion" | "revision" | "extraccion" | "grafo" | "fundamentos";


// ── Alcance y lotes (core/src/alcance.rs) ────────────────────────────────

export interface NodoCategoria {
  term_id: number;
  nombre: string;
  slug: string;
  parent: number;
  /** Artículos con este término exacto. */
  propios: number;
  /** Distintos en todo el subárbol: lo que se procesaría al elegirlo. */
  total: number;
  hijos: NodoCategoria[];
}

export interface ArbolCategorias {
  taxonomia: string;
  raices: NodoCategoria[];
  censado: number;
  sin_fecha: number;
  anio_min: number | null;
  anio_max: number | null;
}

export interface Alcance {
  taxonomia: string;
  terminos: number[];
  desde_anio: number | null;
  hasta_anio: number | null;
  incluir_sin_fecha: boolean;
}

export interface Estimacion {
  articulos: number;
  terminos_expandidos: number[];
  segundos_cpu: number;
  por_descargar: number;
}

export interface LoteRow {
  id: number;
  etiqueta: string;
  taxonomia: string | null;
  creado: string;
  articulos: number;
  calibrar: number;
  extraidos: number;
  calibrado: boolean;
}

export interface Modelos {
  gliner: string;
  spacy: string;
  glirel: string | null;
  relaciones: boolean;
}

export interface OpcionModelo { id: string; nombre: string; nota: string }
export interface CatalogoModelos {
  gliner: OpcionModelo[];
  spacy: OpcionModelo[];
  glirel: OpcionModelo[];
}

// ── Calibración (core/src/calibracion.rs) ────────────────────────────────

export interface Calibracion {
  umbrales: Record<string, number>;
  bloqueadas: string[];
  diccionario: [string, string][];
}

export interface MarcadorCalibracion {
  tipo: string;
  umbral: number;
  antes_f1: number;
  despues_f1: number;
  propuestas: number;
  aceptadas: number;
  rechazadas: number;
  anadidas: number;
}

export interface ResultadoCalibracion {
  articulos: number;
  calibracion: Calibracion;
  por_tipo: MarcadorCalibracion[];
  antes_f1: number;
  despues_f1: number;
  rechazos_frecuentes: [string, string, number][];
}

// ── Grafo ────────────────────────────────────────────────────────────────

export interface NodoGrafo {
  tipo: string;
  texto: string;
  menciones: number;
  articulos: number;
  /** La confirmó una persona; el resto lo propuso el modelo. */
  revisada: boolean;
}

export interface AristaGrafo {
  a: string;
  b: string;
  predicado: string;
  articulos: number;
  revisada: boolean;
}

export interface ResumenGrafo {
  articulos: number;
  procesados: number;
  revisados: number;
  entidades_distintas: number;
  entidades_una_vez: number;
  relaciones: number;
}

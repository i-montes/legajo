import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ConnectionRow, Diseno, Discovery, Epoca, FilaAnotable, FinCenso, Hallazgo,
  Caso, EntradaLexico, Evaluacion, Mencion, PerfilArchivo, Plan, ProgresoCenso,
  ProgresoExtraccion, Puerta, RelacionFila, Reporte as ReporteT, SesionRecuperada,
} from "../types";

export const discoverSite = (input: string) =>
  invoke<Discovery>("discover_site", { input });

export const saveConnection = (resolvedOrigin: string, label: string) =>
  invoke<number>("save_connection", { resolvedOrigin, label });

export const listConnections = () => invoke<ConnectionRow[]>("list_connections");

export const deleteConnection = (id: number) =>
  invoke<void>("delete_connection", { id });

// ── Censo ────────────────────────────────────────────────────────────────

export const iniciarCenso = (connectionId: number, taxonomias: string[], reiniciar = false) =>
  invoke<void>("iniciar_censo", { connectionId, taxonomias, reiniciar });

export const cancelarCenso = () => invoke<void>("cancelar_censo");

export const censoCorriendo = () => invoke<boolean>("censo_corriendo");

export const perfilArchivo = (connectionId: number, taxonomia: string | null) =>
  invoke<PerfilArchivo>("perfil_archivo", { connectionId, taxonomia });

export const hallazgosArchivo = (connectionId: number) =>
  invoke<Hallazgo[]>("hallazgos_archivo", { connectionId });

/** El censo dura minutos; el avance llega por eventos, no por el retorno. */
export const alProgresoCenso = (cb: (p: ProgresoCenso) => void): Promise<UnlistenFn> =>
  listen<ProgresoCenso>("censo:progreso", (e) => cb(e.payload));

export const alFinCenso = (cb: (f: FinCenso) => void): Promise<UnlistenFn> =>
  listen<FinCenso>("censo:fin", (e) => cb(e.payload));

// ── Muestra ──────────────────────────────────────────────────────────────

export const proponerEpocas = (connectionId: number, cuantas: number) =>
  invoke<{ epocas: Epoca[] }>("proponer_epocas", { connectionId, cuantas });

export const planMuestra = (connectionId: number, diseno: Diseno) =>
  invoke<Plan>("plan_muestra", { connectionId, diseno });

export const sortearMuestra = (connectionId: number, diseno: Diseno, etiqueta: string) =>
  invoke<{ design_id: number; n: number }>("sortear_muestra", { connectionId, diseno, etiqueta });

export const muestraActual = (connectionId: number) =>
  invoke<[number, number] | null>("muestra_actual", { connectionId });

export const muestra = (designId: number) =>
  invoke<FilaAnotable[]>("muestra", { designId });

export const descargarMuestra = (connectionId: number, designId: number) =>
  invoke<void>("descargar_muestra", { connectionId, designId });

export const alProgresoMuestra = (cb: (p: ProgresoCenso) => void): Promise<UnlistenFn> =>
  listen<ProgresoCenso>("muestra:progreso", (e) => cb(e.payload));

export const alFinMuestra = (cb: (f: FinCenso) => void): Promise<UnlistenFn> =>
  listen<FinCenso>("muestra:fin", (e) => cb(e.payload));

// ── Anotación ────────────────────────────────────────────────────────────

export const guardarAnotacion = (
  designId: number, wpId: number, menciones: Mencion[], relaciones: RelacionFila[]
) => invoke<void>("guardar_anotacion", { designId, wpId, menciones, relaciones });

export const cargarAnotacion = (designId: number, wpId: number) =>
  invoke<[Mencion[], RelacionFila[]]>("anotacion", { designId, wpId });

export const cerrarArticulo = (designId: number, wpId: number, segundos: number, menciones: number) =>
  invoke<void>("cerrar_articulo", { designId, wpId, segundos, menciones });

export const avanceAnotacion = (designId: number) =>
  invoke<[number, number]>("avance_anotacion", { designId });

// ── Resolución y reporte ─────────────────────────────────────────────────

export const casosResolucion = (designId: number) =>
  invoke<Caso[]>("casos_resolucion", { designId });

export const decidirResolucion = (
  designId: number, clave: string, a: string, b: string,
  tipo: string, decision: string, confianza: number
) => invoke<void>("decidir_resolucion", { designId, clave, a, b, tipo, decision, confianza });

export const avanceResolucion = (designId: number) =>
  invoke<[number, number]>("avance_resolucion", { designId });

export const reporte = (designId: number, universo: number) =>
  invoke<ReporteT>("reporte", { designId, universo });

export const puerta = (
  horasNecesarias: number, personas: number, horasSemana: number, semanas: number, universo: number
) => invoke<Puerta>("puerta", { horasNecesarias, personas, horasSemana, semanas, universo });

// ── Extracción ───────────────────────────────────────────────────────────

export const iniciarExtraccion = (designId: number, modelo: string | null, umbral: number) =>
  invoke<void>("iniciar_extraccion", { designId, modelo, umbral });

export const cancelarExtraccion = () => invoke<void>("cancelar_extraccion");
export const extrayendo = () => invoke<boolean>("extrayendo");

export const avanceExtraccion = (designId: number) =>
  invoke<[number, number]>("avance_extraccion", { designId });

export const evaluacion = (designId: number) =>
  invoke<Evaluacion>("evaluacion", { designId });

export const alProgresoExtraccion = (cb: (p: ProgresoExtraccion) => void): Promise<UnlistenFn> =>
  listen<ProgresoExtraccion>("extraccion:progreso", (e) => cb(e.payload));

export const alFinExtraccion = (cb: (f: FinCenso) => void): Promise<UnlistenFn> =>
  listen<FinCenso>("extraccion:fin", (e) => cb(e.payload));

export const alAvisoCenso = (cb: (m: string) => void): Promise<UnlistenFn> =>
  listen<string>("censo:aviso", (e) => cb(e.payload));

// ── Sesión ───────────────────────────────────────────────────────────────

export const guardarSesion = (
  connectionId: number | null, paso: string, progreso: number,
  taxonomia: string | null, designId: number | null
) => invoke<void>("guardar_sesion", { connectionId, paso, progreso, taxonomia, designId });

export const cargarSesion = () => invoke<SesionRecuperada | null>("cargar_sesion");
export const olvidarSesion = () => invoke<void>("olvidar_sesion");

export const reanudarAnotacion = (designId: number) =>
  invoke<number | null>("reanudar_anotacion", { designId });

export const apuntarTiempo = (designId: number, wpId: number, segundos: number, menciones: number) =>
  invoke<void>("apuntar_tiempo", { designId, wpId, segundos, menciones });

export const tiempoArticulo = (designId: number, wpId: number) =>
  invoke<number>("tiempo_articulo", { designId, wpId });

export const lexico = (designId: number) =>
  invoke<EntradaLexico[]>("lexico", { designId });

export const descartarTiempo = (designId: number, wpId: number) =>
  invoke<void>("descartar_tiempo", { designId, wpId });

/** Mediciones no creíbles: muy cortas (se pasó de largo) o muy largas (ventana abierta). */
export const tiemposDudosos = (designId: number) =>
  invoke<[number, number, number, string][]>("tiempos_dudosos", { designId });

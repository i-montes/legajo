import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Alcance, ArbolCategorias, AristaGrafo, Calibracion, Caso, CatalogoModelos,
  ConnectionRow, Discovery, EntradaLexico, Estimacion, FilaAnotable, FinCenso,
  Hallazgo, LoteRow, Mencion, Modelos, NodoGrafo, PerfilArchivo, ProgresoCenso,
  ProgresoExtraccion, RelacionFila, ResultadoCalibracion, ResumenGrafo,
  SesionRecuperada,
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

export const muestra = (loteId: number) =>
  invoke<FilaAnotable[]>("muestra", { loteId });

// ── Anotación ────────────────────────────────────────────────────────────

export const guardarAnotacion = (
  loteId: number, wpId: number, menciones: Mencion[], relaciones: RelacionFila[]
) => invoke<void>("guardar_anotacion", { loteId, wpId, menciones, relaciones });

export const cargarAnotacion = (loteId: number, wpId: number) =>
  invoke<[Mencion[], RelacionFila[]]>("anotacion", { loteId, wpId });

export const cerrarArticulo = (loteId: number, wpId: number, segundos: number, menciones: number) =>
  invoke<void>("cerrar_articulo", { loteId, wpId, segundos, menciones });

export const avanceAnotacion = (loteId: number) =>
  invoke<[number, number]>("avance_anotacion", { loteId });

// ── Extracción ───────────────────────────────────────────────────────────

export const iniciarExtraccion = (
  loteId: number, modelos: Modelos | null, soloCalibracion: boolean
) => invoke<void>("iniciar_extraccion", { loteId, modelos, soloCalibracion });

export const cancelarExtraccion = () => invoke<void>("cancelar_extraccion");
export const extrayendo = () => invoke<boolean>("extrayendo");

export const avanceExtraccion = (loteId: number) =>
  invoke<[number, number]>("avance_extraccion", { loteId });

export const alProgresoExtraccion = (cb: (p: ProgresoExtraccion) => void): Promise<UnlistenFn> =>
  listen<ProgresoExtraccion>("extraccion:progreso", (e) => cb(e.payload));

export const alFinExtraccion = (cb: (f: FinCenso) => void): Promise<UnlistenFn> =>
  listen<FinCenso>("extraccion:fin", (e) => cb(e.payload));

export const alAvisoCenso = (cb: (m: string) => void): Promise<UnlistenFn> =>
  listen<string>("censo:aviso", (e) => cb(e.payload));

// ── Sesión ───────────────────────────────────────────────────────────────

export const guardarSesion = (
  connectionId: number | null, paso: string, progreso: number,
  taxonomia: string | null, loteId: number | null
) => invoke<void>("guardar_sesion", { connectionId, paso, progreso, taxonomia, loteId });

export const cargarSesion = () => invoke<SesionRecuperada | null>("cargar_sesion");
export const olvidarSesion = () => invoke<void>("olvidar_sesion");

export const reanudarAnotacion = (loteId: number) =>
  invoke<number | null>("reanudar_anotacion", { loteId });

export const apuntarTiempo = (loteId: number, wpId: number, segundos: number, menciones: number) =>
  invoke<void>("apuntar_tiempo", { loteId, wpId, segundos, menciones });

export const tiempoArticulo = (loteId: number, wpId: number) =>
  invoke<number>("tiempo_articulo", { loteId, wpId });

export const lexico = (loteId: number) =>
  invoke<EntradaLexico[]>("lexico", { loteId });

export const descartarTiempo = (loteId: number, wpId: number) =>
  invoke<void>("descartar_tiempo", { loteId, wpId });

/** Mediciones no creíbles: muy cortas (se pasó de largo) o muy largas (ventana abierta). */
export const tiemposDudosos = (loteId: number) =>
  invoke<[number, number, number, string][]>("tiempos_dudosos", { loteId });

// ── Alcance ──────────────────────────────────────────────────────────────

export const arbolCategorias = (connectionId: number, taxonomia: string) =>
  invoke<ArbolCategorias>("arbol_categorias", { connectionId, taxonomia });

export const estimarAlcance = (connectionId: number, alcanceSel: Alcance) =>
  invoke<Estimacion>("estimar_alcance", { connectionId, alcanceSel });

export const crearLote = (
  connectionId: number, etiqueta: string, alcanceSel: Alcance, nCalibrar: number
) => invoke<number>("crear_lote", { connectionId, etiqueta, alcanceSel, nCalibrar });

export const lotes = (connectionId: number) => invoke<LoteRow[]>("lotes", { connectionId });

export const catalogoModelos = () => invoke<CatalogoModelos>("catalogo_modelos");

// ── Calibración ──────────────────────────────────────────────────────────

export const calibrar = (loteId: number) =>
  invoke<ResultadoCalibracion>("calibrar", { loteId });

export const aplicarCalibracion = (loteId: number, cal: Calibracion) =>
  invoke<void>("aplicar_calibracion", { loteId, cal });

export const calibracionGuardada = (loteId: number) =>
  invoke<Calibracion | null>("calibracion_guardada", { loteId });

// ── Grafo ────────────────────────────────────────────────────────────────

export const grafoResumen = (loteId: number) =>
  invoke<ResumenGrafo>("grafo_resumen", { loteId });

export const grafoEntidades = (loteId: number, limite = 200) =>
  invoke<NodoGrafo[]>("grafo_entidades", { loteId, limite });

export const grafoDuplicados = (loteId: number) =>
  invoke<Caso[]>("grafo_duplicados", { loteId });

export const grafoRelaciones = (loteId: number, limite = 200) =>
  invoke<AristaGrafo[]>("grafo_relaciones", { loteId, limite });

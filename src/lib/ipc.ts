import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { baseUrlRemota, leerConexionRemota, leerModo, type ConexionRemota } from "./conexionRemota";
import { leerIdentidad } from "./presencia";
import { desenvolverOk } from "./protocolo";
import type {
  Alcance, ArbolCategorias, AristaGrafo, Calibracion, Capabilities, Caso, CatalogoModelos,
  ColaCategorias, ConexionGuardada,
  Discovery, EntradaLexico, EstadoEntorno, EstadoServidor, Estimacion, FilaAnotable, FinCenso,
  Hallazgo, Identidad, LoteRow, Mencion, NodoGrafo, PasoAutorizacion,
  PerfilArchivo, ProgresoCenso, ProgresoEntorno,
  ProgresoExtraccion, ProgresoModelo, RelacionFila, ResultadoCalibracion, ResumenGrafo,
  SesionRecuperada, SinNombrar, Resolucion, Evidencia,
} from "../types";

/* ── La costura ────────────────────────────────────────────────────────────
 *
 * Todo lo que este fichero le pide a Rust pasa por `llamar`, y no por
 * `invoke` directamente. En modo local es `invoke` sin más: nada cambia. En
 * modo remoto —trabajando contra la base de otra máquina, por red local—
 * cada llamada se convierte en un `POST` a esa máquina, con los mismos
 * nombres de comando y los mismos argumentos.
 *
 * Que la costura esté aquí y en ningún otro sitio es la idea entera: las 55
 * pantallas y funciones que ya llamaban a `iniciarCenso`, `guardarAnotacion`,
 * etc. no se enteran de en qué máquina corre la base. Si el día de mañana
 * hace falta un tercer modo, se añade aquí una vez.
 */

const TIEMPO_ESPERA_MS = 10_000;

/** Da la vuelta a un `POST /api/<comando>` contra la máquina remota.
 *  Aislado de `llamar` para poder probarlo con una conexión fabricada, sin
 *  tener que pasar por `localStorage`. */
export async function llamarRemoto<T>(
  conexion: ConexionRemota, comando: string, args?: unknown
): Promise<T> {
  const url = `${baseUrlRemota(conexion)}/api/${comando}`;
  // Se manda la sesión de presencia de esta ventana, si ya se conoce, para
  // que el servidor pueda avisar por `cambiado` (WebSocket) a todas las
  // sesiones MENOS a quien provocó el cambio. Sin identidad —sin servidor de
  // presencia, o su WebSocket aún no conectado— se manda sin esta cabecera,
  // y el servidor lo trata como "avisar a todos": el lado seguro.
  const identidad = leerIdentidad();
  let respuesta: Response;
  try {
    respuesta = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${conexion.token}`,
        ...(identidad ? { "X-Legajo-Sesion": identidad.sesion } : {}),
      },
      body: JSON.stringify(args ?? {}),
      signal: AbortSignal.timeout(TIEMPO_ESPERA_MS),
    });
  } catch (e) {
    /* Una máquina apagada, fuera de la red, o un cortafuegos, dan aquí el
     *  mismo `TypeError: Failed to fetch` —o un `TimeoutError` del propio
     *  `AbortSignal.timeout`—. Ninguno de los dos le dice nada a quien no
     *  programó esto, así que se traduce a algo que sí explica qué hacer. */
    const porTiempo = e instanceof DOMException && e.name === "TimeoutError";
    throw new Error(
      porTiempo
        ? `No se pudo contactar ${conexion.direccion}:${conexion.puerto}: no respondió a tiempo. Comprueba que esté encendida y en la misma red.`
        : `No se pudo contactar ${conexion.direccion}:${conexion.puerto}. Comprueba que esa máquina esté encendida, sirviendo Legajo, y en la misma red que esta.`
    );
  }

  // Los comandos que Rust no expone por red —credenciales, censo, modelos,
  // extracción— responden 400 pelado. Se convierte en un mensaje que dice
  // qué pasó y no un código sin explicación.
  if (respuesta.status === 400) {
    let detalle = "";
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo && typeof cuerpo === "object" && typeof (cuerpo as Record<string, unknown>).error === "string") {
        detalle = ` (${(cuerpo as Record<string, unknown>).error as string})`;
      }
    } catch {
      // Sin cuerpo entendible: se informa igual, solo que sin el detalle.
    }
    throw new Error(
      `«${comando}» solo se puede hacer en la máquina que tiene la base, no por red${detalle}.`
    );
  }

  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new Error(
      `La máquina respondió (HTTP ${respuesta.status}) con algo que no es JSON. ¿La dirección es la de Legajo y no la de otro servicio?`
    );
  }

  const desenvuelto = desenvolverOk(cuerpo);
  if (!desenvuelto.ok) {
    if (desenvuelto.error !== undefined) {
      throw new Error(desenvuelto.error);
    }
    throw new Error(
      `La máquina respondió (HTTP ${respuesta.status}) con un formato que Legajo no reconoce.`
    );
  }
  return desenvuelto.valor as T;
}

/** El único punto de la app que decide si algo se ejecuta en esta máquina o
 *  en otra. Todas las envolturas de más abajo pasan por aquí. */
export function llamar<T>(comando: string, args?: unknown): Promise<T> {
  if (leerModo() === "remoto") {
    const conexion = leerConexionRemota();
    if (!conexion) {
      // No debería pasar —entrar en modo remoto sin conexión guardada es un
      // estado inconsistente que `conexionRemota.ts` ya evita al leer del
      // almacenamiento—, pero si ocurre, más vale decirlo que intentar un
      // `fetch` a ninguna parte.
      return Promise.reject(new Error("No hay ninguna máquina remota configurada."));
    }
    return llamarRemoto<T>(conexion, comando, args);
  }
  return invoke<T>(comando, args as Record<string, unknown> | undefined);
}

export const discoverSite = (input: string) =>
  llamar<Discovery>("discover_site", { input });

export const saveConnection = (resolvedOrigin: string, label: string) =>
  llamar<number>("save_connection", { resolvedOrigin, label });

/** El medio conectado, o `null`. Legajo trabaja con un archivo a la vez. */
export const conexionGuardada = () =>
  llamar<ConexionGuardada | null>("conexion_guardada");

// ── Pertenencia al sitio ─────────────────────────────────────────────────

export const pasoAutorizacion = (resolvedOrigin: string) =>
  llamar<PasoAutorizacion>("paso_autorizacion", { resolvedOrigin });

export const probarCredencial = (resolvedOrigin: string, usuario: string, secreto: string) =>
  llamar<Identidad>("probar_credencial", { resolvedOrigin, usuario, secreto });

export const duenio = (connectionId: number) =>
  llamar<[string, string] | null>("duenio", { connectionId });

export const olvidarCredencial = (connectionId: number) =>
  llamar<void>("olvidar_credencial", { connectionId });

export const sondearArchivo = (connectionId: number) =>
  llamar<Capabilities>("sondear_archivo", { connectionId });

export const deleteConnection = (id: number) =>
  llamar<void>("delete_connection", { id });

// ── Censo ────────────────────────────────────────────────────────────────

export const iniciarCenso = (connectionId: number, taxonomias: string[], reiniciar = false) =>
  llamar<void>("iniciar_censo", { connectionId, taxonomias, reiniciar });

export const cancelarCenso = () => llamar<void>("cancelar_censo");

export const censoCorriendo = () => llamar<boolean>("censo_corriendo");

export const perfilArchivo = (connectionId: number, taxonomia: string | null) =>
  llamar<PerfilArchivo>("perfil_archivo", { connectionId, taxonomia });

export const hallazgosArchivo = (connectionId: number) =>
  llamar<Hallazgo[]>("hallazgos_archivo", { connectionId });

/** El censo dura minutos; el avance llega por eventos, no por el retorno. */
/** Fases del descubrimiento, según se van intentando. */
export const alFaseConexion = (cb: (f: string) => void): Promise<UnlistenFn> =>
  listen<string>("conexion:fase", (e) => cb(e.payload));

export const alProgresoCenso = (cb: (p: ProgresoCenso) => void): Promise<UnlistenFn> =>
  listen<ProgresoCenso>("censo:progreso", (e) => cb(e.payload));

export const alFinCenso = (cb: (f: FinCenso) => void): Promise<UnlistenFn> =>
  listen<FinCenso>("censo:fin", (e) => cb(e.payload));

// ── Muestra ──────────────────────────────────────────────────────────────

export const muestra = (loteId: number) =>
  llamar<FilaAnotable[]>("muestra", { loteId });

// ── Anotación ────────────────────────────────────────────────────────────

export const guardarAnotacion = (
  loteId: number, wpId: number, menciones: Mencion[], relaciones: RelacionFila[]
) => llamar<void>("guardar_anotacion", { loteId, wpId, menciones, relaciones });

export const cargarAnotacion = (loteId: number, wpId: number) =>
  llamar<[Mencion[], RelacionFila[]]>("anotacion", { loteId, wpId });

export const cerrarArticulo = (loteId: number, wpId: number, segundos: number, menciones: number) =>
  llamar<void>("cerrar_articulo", { loteId, wpId, segundos, menciones });

export const avanceAnotacion = (loteId: number) =>
  llamar<[number, number]>("avance_anotacion", { loteId });

// ── Extracción ───────────────────────────────────────────────────────────

export const iniciarExtraccion = (
  loteId: number, soloCalibracion: boolean, categoria?: number | null
) => llamar<void>("iniciar_extraccion", { loteId, soloCalibracion, categoria: categoria ?? null });

/** Borra las propuestas del modelo sobre esos artículos y los devuelve a la
 *  cola, para extraerlos otra vez. Las marcas de la persona se quedan.
 *  Devuelve cuántos artículos vuelven. */
export const deshacerExtraccion = (
  loteId: number, soloCalibracion: boolean, categoria?: number | null
) => llamar<number>("deshacer_extraccion", { loteId, soloCalibracion, categoria: categoria ?? null });

export const cancelarExtraccion = () => llamar<void>("cancelar_extraccion");
export const extrayendo = () => llamar<boolean>("extrayendo");

export const avanceExtraccion = (
  loteId: number, soloCalibracion: boolean, categoria: number | null = null
) => llamar<[number, number]>("avance_extraccion", { loteId, soloCalibracion, categoria });

/** La cola del paso 7: qué categorías tiene el lote y cuánto falta en cada una. */
export const categoriasDelLote = (loteId: number) =>
  llamar<ColaCategorias>("categorias_del_lote", { loteId });

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
) => llamar<void>("guardar_sesion", { connectionId, paso, progreso, taxonomia, loteId });

export const cargarSesion = () => llamar<SesionRecuperada | null>("cargar_sesion");
export const olvidarSesion = () => llamar<void>("olvidar_sesion");

export const reanudarAnotacion = (loteId: number) =>
  llamar<number | null>("reanudar_anotacion", { loteId });

export const apuntarTiempo = (loteId: number, wpId: number, segundos: number, menciones: number) =>
  llamar<void>("apuntar_tiempo", { loteId, wpId, segundos, menciones });

export const tiempoArticulo = (loteId: number, wpId: number) =>
  llamar<number>("tiempo_articulo", { loteId, wpId });

export const lexico = (loteId: number) =>
  llamar<EntradaLexico[]>("lexico", { loteId });

export const descartarTiempo = (loteId: number, wpId: number) =>
  llamar<void>("descartar_tiempo", { loteId, wpId });

/** Mediciones no creíbles: muy cortas (se pasó de largo) o muy largas (ventana abierta). */
export const tiemposDudosos = (loteId: number) =>
  llamar<[number, number, number, string][]>("tiempos_dudosos", { loteId });

// ── Alcance ──────────────────────────────────────────────────────────────

export const arbolCategorias = (connectionId: number, taxonomia: string) =>
  llamar<ArbolCategorias>("arbol_categorias", { connectionId, taxonomia });

export const estimarAlcance = (connectionId: number, alcanceSel: Alcance) =>
  llamar<Estimacion>("estimar_alcance", { connectionId, alcanceSel });

export const crearLote = (
  connectionId: number, etiqueta: string, alcanceSel: Alcance, nCalibrar: number
) => llamar<number>("crear_lote", { connectionId, etiqueta, alcanceSel, nCalibrar });

export const lotes = (connectionId: number) => llamar<LoteRow[]>("lotes", { connectionId });

export const catalogoModelos = () => llamar<CatalogoModelos>("catalogo_modelos");

/** Qué falta por bajar del modelo y de spaCy. El modelo es uno: no se elige. */
export const modelosPendientes = () => llamar<string[]>("modelos_pendientes");

export const prepararModelos = () => llamar<number>("preparar_modelos");

export const alProgresoModelo = (cb: (p: ProgresoModelo) => void): Promise<UnlistenFn> =>
  listen<ProgresoModelo>("modelos:progreso", (e) => cb(e.payload));

// ── La capa de ejecución del extractor ───────────────────────────────────

/** Si el extractor está instalado en esta máquina, y cuánto costaría si no. */
export const entornoEstado = () => llamar<EstadoEntorno>("entorno_estado");

/** Instala intérprete y librerías. Idempotente: si ya está, vuelve enseguida. */
export const instalarEntorno = () => llamar<string>("instalar_entorno");

export const alProgresoEntorno = (cb: (p: ProgresoEntorno) => void): Promise<UnlistenFn> =>
  listen<ProgresoEntorno>("entorno:progreso", (e) => cb(e.payload));

// ── Calibración ──────────────────────────────────────────────────────────

export const calibrar = (loteId: number) =>
  llamar<ResultadoCalibracion>("calibrar", { loteId });

export const aplicarCalibracion = (loteId: number, cal: Calibracion) =>
  llamar<void>("aplicar_calibracion", { loteId, cal });

export const calibracionGuardada = (loteId: number) =>
  llamar<Calibracion | null>("calibracion_guardada", { loteId });

// ── Grafo ────────────────────────────────────────────────────────────────

export const grafoResumen = (loteId: number) =>
  llamar<ResumenGrafo>("grafo_resumen", { loteId });

export const grafoEntidades = (loteId: number, limite = 200) =>
  llamar<NodoGrafo[]>("grafo_entidades", { loteId, limite });

export const grafoSinNombrar = (loteId: number) =>
  llamar<SinNombrar[]>("grafo_sin_nombrar", { loteId });

export const grafoEvidencia = (loteId: number, r: AristaGrafo) =>
  llamar<Evidencia[]>("grafo_evidencia", { loteId, a: r.a, b: r.b, predicado: r.predicado });
export const resolucionesDelLote = (loteId: number) =>
  llamar<Resolucion[]>("resoluciones_del_lote", { loteId });
export const deshacerResolucion = (loteId: number, clave: string) =>
  llamar<void>("deshacer_resolucion", { loteId, clave });
export const decidirPar = (loteId: number, c: Caso, misma: boolean) =>
  llamar<void>("decidir_par", { loteId, clave: c.clave, a: c.a.nombre, b: c.b.nombre, tipo: c.tipo, misma });
export const grafoDuplicados = (loteId: number) =>
  llamar<Caso[]>("grafo_duplicados", { loteId });

export const grafoRelaciones = (loteId: number, limite = 200) =>
  llamar<AristaGrafo[]>("grafo_relaciones", { loteId, limite });

// ── Servir la base a otra máquina ──────────────────────────────────────────
/* Estos tres, al revés que los de arriba, van con `invoke` y no con `llamar`:
 * encender o apagar el servidor solo tiene sentido en la máquina que tiene la
 * base. Un cliente remoto nunca los llama —su pantalla de servir ni se
 * muestra—, así que enrutarlos según el modo activo sería una vía muerta:
 * en modo remoto no hay ninguna base local que servir.
 *
 * `core/src-tauri` todavía no los implementa (los está haciendo otro agente
 * en paralelo); de momento el contrato es este. */
export const servirEstado = () => invoke<EstadoServidor>("servir_estado");
export const servirIniciar = (puerto: number) => invoke<EstadoServidor>("servir_iniciar", { puerto });
export const servirDetener = () => invoke<EstadoServidor>("servir_detener");

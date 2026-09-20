/* Trabajar desde otra máquina.
 *
 * Legajo anota sobre un SQLite que vive en una sola máquina. Este módulo
 * guarda con qué máquina remota se trabaja —si se trabaja con alguna— y
 * ofrece la comprobación de salud que valida esos datos antes de guardarlos.
 *
 * El modo y la dirección son configuración del cliente, no anotación: por
 * eso viven en `localStorage` y no pasan por `ipc.ts`. Se leen una vez al
 * cargar el módulo y se mantienen en variables de memoria a partir de ahí,
 * para que `useSyncExternalStore` pueda devolver siempre la misma referencia
 * mientras no cambien —si `getSnapshot` devolviera un objeto nuevo en cada
 * llamada, React lo entendería como un cambio permanente y entraría en un
 * ciclo de renderizados—.
 *
 * Aparte de la conexión activa, se guarda una lista corta de conexiones
 * usadas (ver `ConexionGuardada` más abajo), para que volver a una máquina
 * ya visitada sea un clic y no teclear otra vez dirección, puerto y token.
 *
 * El token se guarda en claro en `localStorage`, sin cifrar. Es una decisión,
 * no un descuido: es lo que hace posible el acceso de un clic que pide esta
 * función, y ese `localStorage` vive solo en esta máquina —no viaja a
 * ninguna parte salvo en la cabecera `Authorization` de las peticiones a la
 * máquina remota—. Lo que ese token protege son anotaciones de trabajo, no
 * credenciales: las de WordPress quedan fuera del servidor de Legajo a
 * propósito (ver `ipc.ts`), así que lo peor que permite un token filtrado es
 * leer o corregir el mismo trabajo que ya comparten quienes anotan, no
 * publicar nada. Si el cálculo alguna vez cambia —por ejemplo, si el
 * servidor llega a exponer algo más sensible—, este es el sitio para
 * reconsiderar guardarlo en claro, no un lugar para "arreglarlo" sin más.
 */
import { useSyncExternalStore } from "react";
import { desenvolverOk } from "./protocolo";

export interface ConexionRemota {
  direccion: string;
  puerto: number;
  token: string;
}

export type Modo = "local" | "remoto";

/** Una conexión que ya se usó con éxito, para el acceso rápido de la
 *  pantalla de conexión remota. `id` es estable mientras la entrada exista
 *  —se usa para borrarla sin ambigüedad y como `key` de React—, aunque
 *  cambien la dirección, el puerto o el token con el tiempo. */
export interface ConexionGuardada extends ConexionRemota {
  id: string;
  /** epoch ms de la última vez que se entró con esta conexión. Determina el
   *  orden de la lista y cuál se descarta al pasar el tope. */
  ultimoUso: number;
  /** Nombre opcional que la persona le puede poner para distinguirla de
   *  otras —«la del periódico», «la de casa»—. Sin nombre, la pantalla
   *  muestra dirección y puerto, que ya identifican la máquina. */
  nombre?: string;
}

/** Recorta espacios/saltos de línea y sube a mayúsculas.
 *
 *  El token lo genera el servidor en mayúsculas (alfabeto sin `0`/`O` ni
 *  `1`/`l`), pero aquí se teclea o se pega a mano en otro computador, y
 *  copiar/pegar arrastra minúsculas o espacios con la misma facilidad. El
 *  servidor ya normaliza al comparar (ver `tokens_iguales`/`normalizar_token`
 *  en `servidor.rs`), pero conviene que lo que se guarda aquí también quede
 *  limpio: así lo que se ve en pantalla es lo que de verdad se manda, sin
 *  espacios invisibles ni una mezcla de mayúsculas y minúsculas que no
 *  coincide con lo que muestra el panel de «servir». Como el alfabeto del
 *  token es solo mayúsculas y dígitos, esto no reduce la seguridad ni amplía
 *  qué token vale: solo tolera cómo se haya tecleado. No «arreglar» esto de
 *  vuelta a un valor sin normalizar. */
export function normalizarToken(s: string): string {
  return s.trim().toUpperCase();
}

const CLAVE_MODO = "legajo.modo";
// Clave vieja, de cuando solo existía una conexión activa (sin lista). Sigue
// escribiéndose tal cual —es lo que lee `leerConexionInicial`, y de ahí sale
// la restauración automática al arrancar en modo remoto, que no conviene
// tocar aparte— y además es la fuente de la migración de abajo la primera
// vez que se arranca con la lista todavía sin crear.
const CLAVE_CONEXION = "legajo.conexionRemota";
const CLAVE_CONEXIONES = "legajo.conexionesRemotas";

/** Cuántas conexiones guardadas se conservan como mucho. Quien anota desde
 *  dos o tres máquinas distintas ya cabe de sobra; pasado esto se descarta
 *  la usada hace más tiempo —no la guardada hace más tiempo—, así que una
 *  máquina que se sigue usando nunca se cae de la lista por vieja. */
const MAX_CONEXIONES_GUARDADAS = 5;

function esConexionValida(v: unknown): v is ConexionRemota {
  return (
    !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>).direccion === "string" &&
    typeof (v as Record<string, unknown>).puerto === "number" &&
    typeof (v as Record<string, unknown>).token === "string"
  );
}

function esConexionGuardadaValida(v: unknown): v is ConexionGuardada {
  if (!esConexionValida(v)) return false;
  const o = v as unknown as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.ultimoUso === "number" &&
    (o.nombre === undefined || typeof o.nombre === "string")
  );
}

function leerConexionInicial(): ConexionRemota | null {
  try {
    const bruto = localStorage.getItem(CLAVE_CONEXION);
    if (!bruto) return null;
    const v = JSON.parse(bruto);
    return esConexionValida(v) ? v : null;
  } catch {
    return null;
  }
}

function leerModoInicial(conexionInicial: ConexionRemota | null): Modo {
  try {
    // El modo remoto sin conexión guardada no tiene sentido: si algo dejó el
    // almacenamiento a medias, se cae al modo local en vez de a una pantalla
    // remota sin dirección a la que hablarle.
    return localStorage.getItem(CLAVE_MODO) === "remoto" && conexionInicial ? "remoto" : "local";
  } catch {
    return "local";
  }
}

function ordenarPorUsoReciente(lista: ConexionGuardada[]): ConexionGuardada[] {
  return [...lista].sort((a, b) => b.ultimoUso - a.ultimoUso);
}

/** Lee la lista guardada, o la migra desde el formato viejo (una sola
 *  conexión, `CLAVE_CONEXION`) si la lista todavía no existe.
 *
 *  Por qué hace falta la migración: `CLAVE_CONEXION` es anterior a esta
 *  lista, así que quien ya tenía una conexión guardada con ese formato debe
 *  encontrarla aquí al actualizar Legajo, no perderla solo porque ahora se
 *  guardan varias. Se trata como si fuera la más reciente —es lo único que
 *  había—, y con un `id` nuevo, porque el formato viejo nunca tuvo uno.
 *
 *  El token, tanto el migrado como el que ya viniera en la lista, pasa por
 *  `normalizarToken`: `CLAVE_CONEXION` y esta misma lista pueden tener
 *  entradas guardadas antes de que esa función existiera. */
function leerConexionesGuardadasInicial(conexionInicial: ConexionRemota | null): ConexionGuardada[] {
  try {
    const bruto = localStorage.getItem(CLAVE_CONEXIONES);
    if (bruto !== null) {
      const v: unknown = JSON.parse(bruto);
      const lista = Array.isArray(v)
        ? v.filter(esConexionGuardadaValida).map((c) => ({ ...c, token: normalizarToken(c.token) }))
        : [];
      return ordenarPorUsoReciente(lista).slice(0, MAX_CONEXIONES_GUARDADAS);
    }
  } catch {
    // JSON corrupto: se trata como si la lista no existiera todavía y se
    // sigue abajo, a la migración o a una lista vacía.
  }
  if (conexionInicial) {
    return [{
      ...conexionInicial,
      token: normalizarToken(conexionInicial.token),
      id: crypto.randomUUID(),
      ultimoUso: Date.now(),
    }];
  }
  return [];
}

let conexion: ConexionRemota | null = leerConexionInicial();
let modo: Modo = leerModoInicial(conexion);
let conexionesGuardadas: ConexionGuardada[] = leerConexionesGuardadasInicial(conexion);

function persistirConexionesGuardadas(): void {
  try {
    localStorage.setItem(CLAVE_CONEXIONES, JSON.stringify(conexionesGuardadas));
  } catch {
    // ver nota en activarModoRemoto: sin almacenamiento persistente la
    // sesión actual sigue funcionando igual, solo no sobrevive a un reinicio.
  }
}

const suscriptores = new Set<() => void>();
function notificar() {
  suscriptores.forEach((cb) => cb());
}
function suscribir(cb: () => void) {
  suscriptores.add(cb);
  return () => suscriptores.delete(cb);
}

/** El modo activo ahora mismo. Para lógica fuera de React (`ipc.ts`). */
export function leerModo(): Modo {
  return modo;
}

/** La conexión remota guardada, o `null` si no hay ninguna. */
export function leerConexionRemota(): ConexionRemota | null {
  return conexion;
}

/** Valida y guarda, y pasa a modo remoto. Se llama solo después de que
 *  `comprobarSalud` haya confirmado que al otro lado hay un Legajo que
 *  responde con ese token — nunca antes.
 *
 *  También registra el uso en la lista de conexiones guardadas (abajo): es
 *  el único sitio por el que se entra de verdad a una conexión —tanto si el
 *  formulario se tecleó como si vino de un clic en una guardada—, así que es
 *  el único sitio que necesita acordarse de la lista. */
export function activarModoRemoto(c: ConexionRemota, nombre?: string): void {
  conexion = c;
  modo = "remoto";
  try {
    localStorage.setItem(CLAVE_CONEXION, JSON.stringify(c));
    localStorage.setItem(CLAVE_MODO, "remoto");
  } catch {
    // Sin almacenamiento persistente el modo no sobrevive a un reinicio, pero
    // la sesión actual sigue funcionando: no es motivo para fallar aquí.
  }
  guardarConexionUsada(c, nombre);
  notificar();
}

/** Vuelve a trabajar en esta máquina. La conexión remota queda guardada, para
 *  no tener que volver a teclearla si se reconecta luego: solo «olvidar»
 *  (abajo) la borra de verdad. */
export function volverAModoLocal(): void {
  modo = "local";
  try {
    localStorage.setItem(CLAVE_MODO, "local");
  } catch {
    // ver nota en activarModoRemoto
  }
  notificar();
}

/** Vuelve a local y borra la dirección, el puerto y el token guardados. */
export function olvidarConexionRemota(): void {
  conexion = null;
  modo = "local";
  try {
    localStorage.removeItem(CLAVE_CONEXION);
    localStorage.setItem(CLAVE_MODO, "local");
  } catch {
    // ver nota en activarModoRemoto
  }
  notificar();
}

/** Envoltura mínima de la suscripción interna, para quien necesite
 *  reaccionar a cambios de modo/conexión sin ser un componente React (por
 *  ejemplo, el cliente de presencia por WebSocket). */
export function suscribirConexionRemota(cb: () => void): () => void {
  return suscribir(cb);
}

export function useModoRemoto(): boolean {
  return useSyncExternalStore(suscribir, () => modo === "remoto");
}

export function useConexionRemotaGuardada(): ConexionRemota | null {
  return useSyncExternalStore(suscribir, () => conexion);
}

// ── Lista de conexiones guardadas ───────────────────────────────────────────
/* El acceso rápido de la pantalla de conexión remota: varias máquinas, no
 * solo la que está activa ahora mismo, para no tener que teclear otra vez
 * dirección, puerto y token de una que ya se usó antes. */

/** Las conexiones guardadas, más reciente primero. */
export function leerConexionesGuardadas(): ConexionGuardada[] {
  return conexionesGuardadas;
}

/** Añade esta conexión a la lista, o la actualiza si ya estaba —se
 *  reconoce por dirección y puerto, no por token: es la misma máquina
 *  aunque le hayan rotado el token—, con "ahora" como su último uso y por
 *  tanto primera en la lista. Si supera el tope ([`MAX_CONEXIONES_GUARDADAS`]),
 *  se descarta la que se usó hace más tiempo.
 *
 *  No es lo mismo que `activarModoRemoto`: esa activa el modo remoto de
 *  verdad y la llama a esta para llevar la cuenta; se exporta aparte para
 *  que se pueda ejercitar y llamar sin pasar por todo lo demás que hace
 *  `activarModoRemoto`. */
export function guardarConexionUsada(c: ConexionRemota, nombre?: string): ConexionGuardada[] {
  const direccion = c.direccion.trim();
  const token = normalizarToken(c.token);
  const existente = conexionesGuardadas.find((g) => g.direccion === direccion && g.puerto === c.puerto);
  const actualizada: ConexionGuardada = {
    id: existente?.id ?? crypto.randomUUID(),
    direccion,
    puerto: c.puerto,
    token,
    ultimoUso: Date.now(),
    nombre: nombre ?? existente?.nombre,
  };
  const resto = conexionesGuardadas.filter((g) => g.id !== actualizada.id);
  conexionesGuardadas = ordenarPorUsoReciente([actualizada, ...resto]).slice(0, MAX_CONEXIONES_GUARDADAS);
  persistirConexionesGuardadas();
  notificar();
  return conexionesGuardadas;
}

/** Borra una conexión guardada por su `id`. No toca las demás ni la
 *  conexión activa —si era la que está en uso ahora mismo, se sigue
 *  trabajando contra ella; solo desaparece del acceso rápido—. */
export function eliminarConexionGuardada(id: string): void {
  conexionesGuardadas = conexionesGuardadas.filter((g) => g.id !== id);
  persistirConexionesGuardadas();
  notificar();
}

export function useConexionesGuardadas(): ConexionGuardada[] {
  return useSyncExternalStore(suscribir, () => conexionesGuardadas);
}

// ── Dirección del servidor remoto ───────────────────────────────────────────

/** Si `direccion` ya trae `http://` o `https://`, se respeta ese esquema —
 *  por si alguna vez hace falta hablarle por TLS a través de un túnel—; si
 *  no, se asume `http://`, que es lo normal en una red local. */
export function baseUrlRemota(c: ConexionRemota): string {
  const limpio = c.direccion.trim().replace(/\/+$/, "");
  const m = /^(https?):\/\/(.+)$/i.exec(limpio);
  const esquema = m ? m[1].toLowerCase() : "http";
  const host = m ? m[2] : limpio;
  return `${esquema}://${host}:${c.puerto}`;
}

// ── Cadena de conexión ───────────────────────────────────────────────────────
/* Lo que el panel de «servir» ofrece copiar de una vez, y lo que la pantalla
 * de conexión remota sabe leer para autocompletarse. Un `URL` normal, con un
 * esquema inventado: así el análisis lo hace el propio navegador —anfitrión,
 * puerto y ruta ya separados— en vez de partir la cadena a mano y arriesgarse
 * a que una dirección con dos puntos (IPv6) la rompa. */
const ESQUEMA_CADENA = "legajo:";

export function generarCadenaConexion(c: ConexionRemota): string {
  return `${ESQUEMA_CADENA}//${c.direccion}:${c.puerto}/${encodeURIComponent(c.token)}`;
}

export function parsearCadenaConexion(cadena: string): ConexionRemota | null {
  try {
    const u = new URL(cadena.trim());
    if (u.protocol !== ESQUEMA_CADENA) return null;
    const token = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!u.hostname || !u.port || !token) return null;
    return { direccion: u.hostname, puerto: Number(u.port), token };
  } catch {
    return null;
  }
}

// ── Salud del servidor remoto ────────────────────────────────────────────────

export interface SaludRemota {
  version: string;
  lotes: number;
}

export type ResultadoSalud =
  | { ok: true; salud: SaludRemota }
  | { ok: false; motivo: "sin-contacto" | "token" | "no-es-legajo"; mensaje: string };

const TIEMPO_ESPERA_SALUD_MS = 6000;

/** La versión del protocolo HTTP que este cliente sabe hablar. Es la firma
 *  que de verdad distingue a un Legajo de cualquier otra cosa que conteste
 *  JSON en ese puerto —a diferencia de `version` o `lotes`, que otro
 *  servicio podría tener por casualidad—. */
const PROTOCOLO_SALUD = 1;

/** `GET {base}/api/salud`, con el token. Se llama antes de guardar nada: la
 *  pantalla de conexión remota no persiste una máquina que no contestó bien. */
export async function comprobarSalud(c: ConexionRemota): Promise<ResultadoSalud> {
  const base = baseUrlRemota(c);
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}/api/salud`, {
      headers: { Authorization: `Bearer ${c.token}` },
      signal: AbortSignal.timeout(TIEMPO_ESPERA_SALUD_MS),
    });
  } catch {
    return {
      ok: false,
      motivo: "sin-contacto",
      mensaje: `No se pudo contactar ${c.direccion}:${c.puerto}. Comprueba que esa máquina esté encendida, que Legajo esté sirviendo allí, y que las dos estén en la misma red.`,
    };
  }
  if (respuesta.status === 401 || respuesta.status === 403) {
    return {
      ok: false,
      motivo: "token",
      mensaje: "La máquina respondió, pero el token no es el correcto. Cópialo de nuevo desde el panel de «servir» en esa máquina.",
    };
  }
  if (!respuesta.ok) {
    return {
      ok: false,
      motivo: "no-es-legajo",
      mensaje: `La máquina respondió con un error (HTTP ${respuesta.status}). Comprueba la dirección y el puerto.`,
    };
  }
  let cuerpo: unknown;
  try {
    cuerpo = await respuesta.json();
  } catch {
    return {
      ok: false,
      motivo: "no-es-legajo",
      mensaje: "Algo respondió en esa dirección, pero no algo que reconozcamos como Legajo.",
    };
  }
  // El servidor envuelve toda respuesta en `{"ok": ...}` —igual que
  // `POST /api/<comando>`—, y aquí se desenvuelve con el mismo criterio que
  // usa `llamarRemoto` en `ipc.ts`, para que las dos formas de hablarle al
  // servidor no puedan volver a divergir en qué reconocen como Legajo.
  const desenvuelto = desenvolverOk(cuerpo);
  const salud = desenvuelto.ok ? desenvuelto.valor : undefined;
  if (
    !salud || typeof salud !== "object" ||
    // `protocolo` es la firma de verdad: cualquier JSON con forma parecida
    // puede tener por casualidad una `version` de tipo string y un `lotes`
    // numérico, pero solo Legajo manda `protocolo: 1`.
    (salud as Record<string, unknown>).protocolo !== PROTOCOLO_SALUD ||
    typeof (salud as Record<string, unknown>).version !== "string" ||
    typeof (salud as Record<string, unknown>).lotes !== "number"
  ) {
    return {
      ok: false,
      motivo: "no-es-legajo",
      mensaje: "Algo respondió en esa dirección, pero no algo que reconozcamos como Legajo.",
    };
  }
  return {
    ok: true,
    salud: {
      version: (salud as Record<string, unknown>).version as string,
      lotes: (salud as Record<string, unknown>).lotes as number,
    },
  };
}

/** Un clic en una conexión guardada, desde la pantalla de conexión remota.
 *
 *  Pasa siempre por `comprobarSalud` antes de dar la conexión por buena: la
 *  máquina pudo apagarse, cambiar de puerto o rotar el token desde la
 *  última vez, y entrar a ciegas es como se llega a un error confuso tres
 *  pantallas más adelante, en vez de aquí, con el motivo delante. Si
 *  responde bien, activa el modo remoto —lo que también refresca su
 *  `ultimoUso` y la deja primera en la lista—; si no, la entrada guardada
 *  se queda tal cual, sin borrarse sola: decidir si se corrige o se quita
 *  es de quien mira la pantalla, no de esta función. */
export async function entrarConexionGuardada(g: ConexionGuardada): Promise<ResultadoSalud> {
  // `normalizarToken` de nuevo aquí, aunque `guardarConexionUsada` y la
  // lectura inicial ya normalizan al guardar: una entrada pudo quedar
  // grabada antes de que esa normalización existiera, y esta es la última
  // parada antes de mandar el token de verdad por HTTP.
  const c: ConexionRemota = { direccion: g.direccion.trim(), puerto: g.puerto, token: normalizarToken(g.token) };
  const r = await comprobarSalud(c);
  if (r.ok) activarModoRemoto(c, g.nombre);
  return r;
}

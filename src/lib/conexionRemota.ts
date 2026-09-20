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
 */
import { useSyncExternalStore } from "react";
import { desenvolverOk } from "./protocolo";

export interface ConexionRemota {
  direccion: string;
  puerto: number;
  token: string;
}

export type Modo = "local" | "remoto";

const CLAVE_MODO = "legajo.modo";
const CLAVE_CONEXION = "legajo.conexionRemota";

function esConexionValida(v: unknown): v is ConexionRemota {
  return (
    !!v && typeof v === "object" &&
    typeof (v as Record<string, unknown>).direccion === "string" &&
    typeof (v as Record<string, unknown>).puerto === "number" &&
    typeof (v as Record<string, unknown>).token === "string"
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

let conexion: ConexionRemota | null = leerConexionInicial();
let modo: Modo = leerModoInicial(conexion);

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
 *  responde con ese token — nunca antes. */
export function activarModoRemoto(c: ConexionRemota): void {
  conexion = c;
  modo = "remoto";
  try {
    localStorage.setItem(CLAVE_CONEXION, JSON.stringify(c));
    localStorage.setItem(CLAVE_MODO, "remoto");
  } catch {
    // Sin almacenamiento persistente el modo no sobrevive a un reinicio, pero
    // la sesión actual sigue funcionando: no es motivo para fallar aquí.
  }
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

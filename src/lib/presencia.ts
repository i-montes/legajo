/* Bloqueo por artículo, vía WebSocket.
 *
 * Antes, servir y anotar eran excluyentes: mientras esta máquina servía la
 * base por red, la ventana local entera dejaba de escribir (`lib/servidor.ts`,
 * ya borrado). Eso era más ancho de lo necesario —bloqueaba los 200 artículos
 * de la muestra por trabajar en uno solo— y no servía de nada si la propia
 * máquina servidora quería corregir el mismo artículo que la remota: no había
 * forma de saberlo.
 *
 * Ahora el bloqueo es por artículo: quien abre un artículo lo ocupa para las
 * dos máquinas; nadie más lo edita mientras tanto, pero sí puede seguir
 * viéndolo en modo lectura. El servidor (Rust, en paralelo) es el árbitro:
 * este módulo solo habla su protocolo y expone el resultado.
 *
 * Es un singleton a nivel de módulo, igual que `conexionRemota.ts`, y
 * arranca a intentar conectar EN CUANTO EL MÓDULO SE CARGA —no cuando una
 * pantalla monta un hook—, para que el bloqueo exista sin depender de qué
 * pantalla esté abierta en cada momento. Con un único usuario local, sin
 * ningún servidor de por medio, no hay ninguna URL a la que conectar: no se
 * abre ningún socket y todo se puede escribir siempre, sin preguntar nada —
 * es el caso normal, y el módulo no le añade ni un milisegundo de latencia.
 */
import { useEffect, useSyncExternalStore } from "react";
import {
  baseUrlRemota, leerConexionRemota, leerModo, suscribirConexionRemota,
} from "./conexionRemota";
import {
  mensajeForzar, mensajeHola, mensajeLatido, mensajeSoltar, mensajeTomar,
} from "./protocoloPresencia";
import type { EstadoServidor } from "../types";

// ── Estado de bloqueo de un artículo ────────────────────────────────────────

export type EstadoBloqueo =
  | { tipo: "sin-servidor" }
  | { tipo: "desconectado" }
  | { tipo: "pendiente" }
  | { tipo: "propio" }
  | { tipo: "ocupado"; por: { nombre: string; emoji: string } }
  | { tipo: "perdido"; por: { nombre: string; emoji: string } };

/** Si esta ventana puede escribir sobre el artículo que tiene ese estado.
 *  Única fuente de verdad: nadie más recalcula esto a mano. */
export function puedeEditar(e: EstadoBloqueo): boolean {
  return e.tipo === "sin-servidor" || e.tipo === "propio";
}

// Objetos estables para los dos estados sin datos propios: `useSyncExternalStore`
// necesita que la referencia no cambie mientras el valor no cambie, o entra en
// un bucle de renderizados (ver la misma nota en `conexionRemota.ts`).
const SIN_SERVIDOR: EstadoBloqueo = { tipo: "sin-servidor" };
const DESCONECTADO: EstadoBloqueo = { tipo: "desconectado" };
const PENDIENTE: EstadoBloqueo = { tipo: "pendiente" };
const PROPIO: EstadoBloqueo = { tipo: "propio" };

export interface SesionPresencia {
  sesion: string;
  nombre: string;
  emoji: string;
  loteId: number | null;
  wpId: number | null;
}

// ── Estado del módulo ───────────────────────────────────────────────────────

let estadoServidorLocal: EstadoServidor | null = null;
let objetivoUrl: string | null = null;

let socket: WebSocket | null = null;
let latidoId: ReturnType<typeof setInterval> | null = null;
let reconexionId: ReturnType<typeof setTimeout> | null = null;
let intentosReconexion = 0;

/** `true` desde que llega `bienvenida` hasta que el socket se cae. Antes de
 *  eso no tiene sentido mandar `tomar`: el servidor todavía no sabe quién es
 *  esta sesión. */
let conectado = false;
let identidadActual: { sesion: string; nombre: string; emoji: string } | null = null;
let sesionesActuales: SesionPresencia[] = [];
/** El último `{"tipo":"error", ...}` que mandó el servidor —un mensaje suyo
 *  que no se pudo interpretar—, o `null` si no hay ninguno pendiente de
 *  mostrar. Ver el caso `"error"` en `manejarMensaje` y `useUltimoError`. */
let ultimoError: string | null = null;

/** Solo hay un artículo «deseado» a la vez: el que tiene abierto la pantalla
 *  de revisión ahora mismo. Se conserva aunque el socket se caiga o el
 *  servidor se apague, precisamente para poder volver a pedirlo en cuanto
 *  haya con quién hablar otra vez (ver el caso `bienvenida` más abajo). */
let articuloDeseado: { loteId: number; wpId: number } | null = null;
/** El resultado del último `tomar` para `articuloDeseado`: pendiente hasta
 *  que llega `tomado`, `ocupado` o `perdido`. Fuera de eso —sin servidor, sin
 *  conexión, sin artículo pedido— el estado se deriva en `leerBloqueoArticulo`
 *  y esta variable ni se consulta. */
let resultadoTomar: EstadoBloqueo = PENDIENTE;

/** La función que de verdad guarda lo pendiente del artículo deseado, si hay
 *  una pantalla de revisión montada. La registra `useBloqueoArticulo` y se
 *  usa una sola vez, cuando llega `perdido` (ver más abajo el porqué del
 *  orden). */
let flushPendienteRegistrado: (() => Promise<void>) | null = null;

const suscriptores = new Set<() => void>();
function notificar() {
  suscriptores.forEach((cb) => cb());
}
function suscribir(cb: () => void) {
  suscriptores.add(cb);
  return () => suscriptores.delete(cb);
}

/** El aviso `cambiado` (ver más abajo, en `manejarMensaje`) no es estado
 *  persistente como sesiones/identidad/bloqueo —no hay un "valor actual" que
 *  leer en cualquier momento, solo el instante en que ocurre—, así que no
 *  encaja en `useSyncExternalStore` y lleva su propio conjunto de oyentes,
 *  aparte de `suscriptores`. */
type OyenteCambio = (loteId: number, wpId: number) => void;
const oyentesCambio = new Set<OyenteCambio>();

// ── Id de cliente persistente ────────────────────────────────────────────

const CLAVE_CLIENTE = "legajo.presencia.cliente";
let clienteIdCache: string | null = null;

/** Un id estable por instalación, para que el servidor pueda reconocer a la
 *  misma persona entre reconexiones. Si `localStorage` no está disponible
 *  (ventana privada, almacenamiento bloqueado…) se usa uno de usar-y-tirar
 *  para esta sesión del módulo: no hay razón para que eso rompa la conexión. */
function idCliente(): string {
  if (clienteIdCache) return clienteIdCache;
  try {
    const existente = localStorage.getItem(CLAVE_CLIENTE);
    if (existente) {
      clienteIdCache = existente;
      return existente;
    }
    const nuevo = crypto.randomUUID();
    localStorage.setItem(CLAVE_CLIENTE, nuevo);
    clienteIdCache = nuevo;
    return nuevo;
  } catch {
    clienteIdCache = crypto.randomUUID();
    return clienteIdCache;
  }
}

// ── A qué servidor hablarle ──────────────────────────────────────────────

/** `http://` → `ws://`, `https://` → `wss://`. Solo cambia el esquema; el
 *  resto de la URL de base (`host:puerto`) es igual para HTTP y WebSocket:
 *  el mismo servidor atiende los dos. */
function comoWebSocket(baseHttp: string): string {
  return baseHttp.replace(/^http/i, "ws");
}

function calcularObjetivoUrl(): string | null {
  if (leerModo() === "remoto") {
    const c = leerConexionRemota();
    if (!c) return null;
    return `${comoWebSocket(baseUrlRemota(c))}/ws?token=${encodeURIComponent(c.token)}`;
  }
  // Modo local: solo hay servidor si esta misma máquina lo encendió, y solo
  // se sabe por lo último que `notificarEstadoServidor` haya recibido.
  if (estadoServidorLocal?.activo) {
    return `ws://127.0.0.1:${estadoServidorLocal.puerto}/ws?token=${encodeURIComponent(estadoServidorLocal.token)}`;
  }
  return null;
}

/** Se llama al montar el módulo, al cambiar de modo/conexión remota y cada
 *  vez que `notificarEstadoServidor` trae un estado nuevo. Si la URL objetivo
 *  no cambió, no hace nada — cambiar de socket sin necesidad cortaría una
 *  conexión sana. */
function recomputarObjetivo(): void {
  const nuevo = calcularObjetivoUrl();
  if (nuevo === objetivoUrl) return;
  objetivoUrl = nuevo;
  cerrarSocket();
  intentosReconexion = 0;
  if (objetivoUrl) abrirSocket();
  notificar();
}

/** Lo llama `Servir.tsx` con el `EstadoServidor` fresco: al montar, y después
 *  de encender o apagar. En modo remoto se guarda igual —por si se vuelve a
 *  local después— pero no se activa: aquí no hay ninguna base local que
 *  servir mientras se trabaja contra otra máquina. */
export function notificarEstadoServidor(estado: EstadoServidor | null): void {
  estadoServidorLocal = estado;
  if (leerModo() !== "remoto") recomputarObjetivo();
}

// ── Ciclo de vida del socket ─────────────────────────────────────────────

function limpiarTemporizadores(): void {
  if (latidoId != null) { clearInterval(latidoId); latidoId = null; }
  if (reconexionId != null) { clearTimeout(reconexionId); reconexionId = null; }
}

/** Cierre intencional: al cambiar de objetivo (incluida la transición «había
 *  URL» → «no hay URL»). Se desconectan los manejadores ANTES de cerrar, para
 *  que el `onclose` del propio cierre no se confunda con una caída real y
 *  dispare una reconexión que nadie pidió. */
function cerrarSocket(): void {
  limpiarTemporizadores();
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try { socket.close(); } catch { /* ya se estaba cayendo solo */ }
    socket = null;
  }
  conectado = false;
  identidadActual = null;
  sesionesActuales = [];
}

function enviar(msg: unknown): void {
  if (!socket) return;
  try { socket.send(JSON.stringify(msg)); } catch { /* el próximo latido lo nota */ }
}

function abrirSocket(): void {
  if (!objetivoUrl) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(objetivoUrl);
  } catch {
    // Entorno sin `WebSocket`, o URL que el constructor rechaza: se trata
    // igual que una conexión caída, con el mismo backoff.
    programarReconexion();
    return;
  }
  socket = ws;
  ws.onopen = () => {
    enviar(mensajeHola(idCliente()));
    // Mientras el socket esté abierto, un latido cada 20 s exactos — ni antes
    // de la bienvenida ni condicionado a nada más: es lo que evita que el
    // servidor caduque un socket sano por simple silencio.
    latidoId = setInterval(() => enviar(mensajeLatido()), 20_000);
  };
  ws.onmessage = (ev) => manejarMensaje(ev.data);
  ws.onclose = () => alCerrarOFallar(ws);
  ws.onerror = () => alCerrarOFallar(ws);
}

/** Backoff sin jitter —a propósito, para que las pruebas con temporizadores
 *  falsos sean deterministas—: 1 s, 2 s, 4 s, 8 s, 16 s, tope en 30 s. */
function programarReconexion(): void {
  if (reconexionId != null) return;
  const espera = Math.min(30_000, 1000 * 2 ** intentosReconexion);
  intentosReconexion += 1;
  reconexionId = setTimeout(() => {
    reconexionId = null;
    abrirSocket();
  }, espera);
}

/** `onclose` u `onerror` de una caída real —no de un cierre que este mismo
 *  módulo pidió—. El chequeo `ws !== socket` hace esto idempotente: si los
 *  dos eventos llegan para el mismo socket, solo el primero hace algo. */
function alCerrarOFallar(ws: WebSocket): void {
  if (ws !== socket) return;
  ws.onopen = null;
  ws.onmessage = null;
  ws.onclose = null;
  ws.onerror = null;
  limpiarTemporizadores();
  socket = null;
  conectado = false;
  identidadActual = null;
  sesionesActuales = [];
  notificar();
  // Si el servidor se apagó de verdad, `objetivoUrl` ya se puso a `null`
  // desde `recomputarObjetivo` y este `if` no reintenta nada: no hay a quién
  // volver a llamar. Si solo se cayó la conexión, sigue habiendo URL y toca
  // reintentar con espera creciente.
  if (objetivoUrl) programarReconexion();
}

function manejarMensaje(data: unknown): void {
  let msg: unknown;
  try {
    msg = JSON.parse(typeof data === "string" ? data : String(data));
  } catch {
    return; // JSON malformado: se ignora, no se rompe la conexión por esto.
  }
  if (!msg || typeof msg !== "object" || !("tipo" in msg)) return;
  const m = msg as Record<string, unknown>;

  switch (m.tipo) {
    case "bienvenida": {
      identidadActual = {
        sesion: String(m.sesion), nombre: String(m.nombre), emoji: String(m.emoji),
      };
      conectado = true;
      // Una bienvenida con éxito es la señal de que la reconexión funcionó:
      // el próximo corte vuelve a empezar el backoff desde 1 s.
      intentosReconexion = 0;
      if (articuloDeseado) {
        // La reconexión vuelve a pedir el bloqueo del artículo que seguía
        // abierto: sin esto, una caída de red silenciosa dejaría el artículo
        // en modo lectura para siempre aunque el servidor ya esté disponible.
        resultadoTomar = PENDIENTE;
        enviar(mensajeTomar(articuloDeseado.loteId, articuloDeseado.wpId));
      }
      notificar();
      break;
    }
    case "presencia": {
      sesionesActuales = Array.isArray(m.sesiones) ? (m.sesiones as SesionPresencia[]) : [];
      notificar();
      break;
    }
    case "tomado": {
      if (articuloDeseado) resultadoTomar = PROPIO;
      notificar();
      break;
    }
    case "ocupado": {
      if (articuloDeseado) resultadoTomar = { tipo: "ocupado", por: m.por as { nombre: string; emoji: string } };
      notificar();
      break;
    }
    case "cambiado": {
      const loteId = Number(m.loteId);
      const wpId = Number(m.wpId);
      oyentesCambio.forEach((cb) => cb(loteId, wpId));
      break;
    }
    case "perdido": {
      const por = m.por as { nombre: string; emoji: string };
      // El mismo orden que gobernaba la exclusividad servir/anotar de antes,
      // aplicado ahora a este evento: se vacía lo pendiente y SOLO ENTONCES se
      // pasa a solo lectura. Al revés, la última marca se perdería justo en el
      // instante en que ya no se puede volver a intentar.
      const flush = flushPendienteRegistrado;
      const terminar = () => {
        if (articuloDeseado) resultadoTomar = { tipo: "perdido", por };
        notificar();
      };
      if (flush) {
        // `Promise.resolve().then(flush)` en vez de `flush()` directo: así,
        // si `flush` lanzara de forma síncrona en vez de rechazar su
        // promesa, el `.catch` de abajo lo atrapa igual.
        Promise.resolve().then(flush)
          .catch(() => { /* falla o no, de todos modos se pasa a solo lectura */ })
          .then(terminar);
      } else {
        terminar();
      }
      break;
    }
    case "error": {
      // El servidor no pudo interpretar el último mensaje que le mandamos
      // (JSON roto, `tipo` desconocido, o campos que faltan — ver el
      // docstring de `procesar_mensaje_cliente` en `servidor.rs`). Antes esto
      // no existía y un mensaje mal formado se perdía en silencio: el
      // usuario pulsaba un botón y no pasaba nada, indistinguible de que la
      // acción no tuviera efecto. Ahora se hace visible (ver `useUltimoError`
      // en `Revision.tsx`) en vez de tragárselo.
      ultimoError = typeof m.mensaje === "string" ? m.mensaje : "el servidor no entendió el último mensaje";
      notificar();
      break;
    }
    default:
      break; // Tipo desconocido: se ignora sin lanzar.
  }
}

// ── API para quien anota (pura, sin React) ──────────────────────────────

/** Registra la función que vacía lo pendiente del artículo abierto ahora
 *  mismo, o `null` para retirarla. La llama `useBloqueoArticulo`. */
export function fijarFlushPendiente(fn: (() => Promise<void>) | null): void {
  flushPendienteRegistrado = fn;
}

/** Marca un artículo como el que se quiere editar. Si ya hay conexión (con
 *  bienvenida recibida), pide el bloqueo ya mismo; si no, queda anotado para
 *  pedirse solo en cuanto (re)conecte. */
export function pedirArticulo(loteId: number, wpId: number): void {
  articuloDeseado = { loteId, wpId };
  resultadoTomar = PENDIENTE;
  if (conectado) enviar(mensajeTomar(loteId, wpId));
  notificar();
}

/** Suelta el artículo deseado: si había conexión, avisa al servidor —con su
 *  `loteId`/`wpId`, igual que `tomar` y `forzar`: el servidor no adivina de
 *  qué artículo se habla por la sesión sola— ; en cualquier caso deja de
 *  haber un artículo que volver a pedir al reconectar. */
export function soltarArticulo(): void {
  if (articuloDeseado && conectado) {
    enviar(mensajeSoltar(articuloDeseado.loteId, articuloDeseado.wpId));
  }
  articuloDeseado = null;
  notificar();
}

/** Arrebata el artículo que esta pantalla tiene abierto (`articuloDeseado`):
 *  manda `forzar` con su `loteId`/`wpId`, igual que `tomar` y `soltar`. Sin
 *  confirmar nada aquí —eso es cosa de la pantalla, antes de llamar esto—.
 *  Si no hay ningún artículo deseado (no debería pasar: solo se ofrece este
 *  botón cuando `bloqueo.tipo === "ocupado"`, que implica que sí lo hay), no
 *  manda nada: no hay qué arrebatar. */
export function arrebatar(): void {
  if (articuloDeseado) enviar(mensajeForzar(articuloDeseado.loteId, articuloDeseado.wpId));
}

/** El estado de bloqueo para un artículo concreto. `null`/`null` (todavía sin
 *  artículo, pantallas de carga…) y «sin servidor configurado» dan lo mismo:
 *  nada que bloquear, se escribe libre. Si el artículo pedido no es el mismo
 *  que `articuloDeseado` —no debería pasar con una sola pantalla de revisión
 *  montada a la vez, pero por seguridad no se finge saber nada de él—, se
 *  trata igual que si no hubiera nada pedido. */
export function leerBloqueoArticulo(loteId: number | null, wpId: number | null): EstadoBloqueo {
  if (loteId == null || wpId == null) return SIN_SERVIDOR;
  if (!objetivoUrl) return SIN_SERVIDOR;
  if (!articuloDeseado || articuloDeseado.loteId !== loteId || articuloDeseado.wpId !== wpId) {
    return SIN_SERVIDOR;
  }
  if (!conectado) return DESCONECTADO;
  return resultadoTomar;
}

/** Se suscribe al aviso `cambiado` del servidor para un artículo concreto.
 *  Solo invoca `cb` cuando el aviso es para ESE artículo Y esta ventana NO
 *  tiene su bloqueo. Si lo tiene, recargar le pisaría el trabajo en curso —
 *  eso solo puede pasar si alguien se lo arrebató, y para eso ya está
 *  `perdido`, que no depende de esto. Un artículo distinto al indicado se
 *  ignora sin más. */
export function suscribirCambio(loteId: number, wpId: number, cb: () => void): () => void {
  const oyente: OyenteCambio = (l, w) => {
    if (l !== loteId || w !== wpId) return;
    if (leerBloqueoArticulo(loteId, wpId).tipo === "propio") return;
    cb();
  };
  oyentesCambio.add(oyente);
  return () => oyentesCambio.delete(oyente);
}

export function leerSesiones(): SesionPresencia[] {
  return sesionesActuales;
}

export function leerIdentidad(): { sesion: string; nombre: string; emoji: string } | null {
  return identidadActual;
}

export function leerUltimoError(): string | null {
  return ultimoError;
}

/** Descarta el último error de protocolo mostrado, para que la pantalla
 *  pueda ofrecer cerrarlo. No hace falta que el error se resuelva solo. */
export function descartarError(): void {
  ultimoError = null;
  notificar();
}

// ── Vistas React ─────────────────────────────────────────────────────────

export function useSesiones(): SesionPresencia[] {
  return useSyncExternalStore(suscribir, leerSesiones);
}

export function useIdentidad(): { sesion: string; nombre: string; emoji: string } | null {
  return useSyncExternalStore(suscribir, leerIdentidad);
}

export function useUltimoError(): string | null {
  return useSyncExternalStore(suscribir, leerUltimoError);
}

export function useBloqueoArticulo(
  loteId: number | null,
  wpId: number | null,
  flushPendiente: () => Promise<void>,
): { estado: EstadoBloqueo; arrebatar: () => void } {
  // Se re-registra en cada cambio de `flushPendiente` —lo mismo que hacía
  // `fijarFlushPendiente` en el `servidor.ts` viejo—, para que un
  // `perdido` que llegue mientras este artículo sigue abierto vacíe siempre
  // las marcas más recientes, no las que había al montar.
  useEffect(() => {
    fijarFlushPendiente(flushPendiente);
    return () => fijarFlushPendiente(null);
  }, [flushPendiente]);

  useEffect(() => {
    if (loteId == null || wpId == null) return;
    pedirArticulo(loteId, wpId);
    return () => soltarArticulo();
  }, [loteId, wpId]);

  const estado = useSyncExternalStore(suscribir, () => leerBloqueoArticulo(loteId, wpId));

  return { estado, arrebatar };
}

// El módulo empieza a intentar hablar con un servidor desde que se carga —no
// desde que una pantalla monta un hook—, y se mantiene al día con cualquier
// cambio de modo o de conexión remota mientras la app siga abierta.
suscribirConexionRemota(recomputarObjetivo);
recomputarObjetivo();

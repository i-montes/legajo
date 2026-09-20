/* Los cinco mensajes salientes del protocolo de presencia (ver
 * `servidor.rs`, el enum `MensajeCliente`), en un módulo aparte y sin más
 * dependencias que sus propios tipos: así se puede ejecutar con
 * `node --experimental-strip-types` sin arrastrar nada de navegador
 * (`WebSocket`, `localStorage`, `crypto.randomUUID`…), que es justo lo que
 * `presencia.ts` sí necesita para todo lo demás.
 *
 * La prueba de contrato en `src-tauri/src/servidor.rs`
 * (`contrato_mensajes_cliente_coincide_con_el_deserializador`) invoca estos
 * mismos constructores —vía `tests/mensajes_cliente_presencia.ts`— para
 * comprobar que lo que el cliente manda de verdad es lo que el servidor de
 * verdad entiende. `presencia.ts` los usa para construir cada mensaje que
 * manda, así que no hay una segunda copia de la forma del protocolo que
 * pueda desincronizarse de esta.
 */

export interface MensajeHola { tipo: "hola"; cliente: string }
export interface MensajeTomar { tipo: "tomar"; loteId: number; wpId: number }
export interface MensajeSoltar { tipo: "soltar"; loteId: number; wpId: number }
export interface MensajeForzar { tipo: "forzar"; loteId: number; wpId: number }
export interface MensajeLatido { tipo: "latido" }

export function mensajeHola(cliente: string): MensajeHola {
  return { tipo: "hola", cliente };
}

export function mensajeTomar(loteId: number, wpId: number): MensajeTomar {
  return { tipo: "tomar", loteId, wpId };
}

export function mensajeSoltar(loteId: number, wpId: number): MensajeSoltar {
  return { tipo: "soltar", loteId, wpId };
}

export function mensajeForzar(loteId: number, wpId: number): MensajeForzar {
  return { tipo: "forzar", loteId, wpId };
}

export function mensajeLatido(): MensajeLatido {
  return { tipo: "latido" };
}

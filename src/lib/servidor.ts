/* Servir y anotar son excluyentes.
 *
 * `guardar_anotacion` no fusiona: borra las filas del artículo en
 * `anotaciones` y `relaciones` y reinserta lo que le manda el cliente (ver
 * `core/src/db.rs`). Si la ventana local siguiera autoguardando mientras
 * otra máquina corrige contra la misma base, la última en escribir gana y
 * la otra se pierde sin aviso.
 *
 * Por eso, mientras esta máquina sirve la base por red, la ventana local deja
 * de ser escritora: `Revision.tsx` consulta `useSirviendo()` y, si es cierto,
 * no autoguarda, no escribe en `beforeunload` y muestra una pausa en vez del
 * editor.
 *
 * El apagado del servidor y el encendido pasan por aquí y no por un simple
 * `setState` en la pantalla de servir, por dos razones:
 *   - Encender tiene que **vaciar primero** lo que hubiera pendiente de
 *     guardar —el debounce de 600 ms de Revisión— y solo **después** soltar
 *     la escritura. Al revés se perdería la última marca.
 *   - Apagar tiene que forzar a Revisión a **releer de la base** el artículo
 *     abierto, no a confiar en lo que tenía en memoria: pudo quedar viejo
 *     mientras la otra máquina anotaba.
 */
import { useSyncExternalStore } from "react";

let sirviendo = false;
/** Cambia en cada activación y cada desactivación. Revisión la mete en las
 *  dependencias del efecto que carga la anotación del artículo abierto, así
 *  que apagar el servidor dispara una recarga desde la base. */
let epoca = 0;

/** La función que de verdad guarda lo pendiente ahora mismo, si hay una
 *  pantalla de revisión montada. La registra `Revision.tsx` en cada cambio
 *  de artículo o de marcas, y la retira al desmontarse. */
let flushPendiente: (() => Promise<void>) | null = null;

const suscriptores = new Set<() => void>();
function notificar() {
  suscriptores.forEach((cb) => cb());
}
function suscribir(cb: () => void) {
  suscriptores.add(cb);
  return () => suscriptores.delete(cb);
}

export function registrarFlushPendiente(fn: (() => Promise<void>) | null): void {
  flushPendiente = fn;
}

export function estaSirviendo(): boolean {
  return sirviendo;
}

export function epocaServidor(): number {
  return epoca;
}

/** Vacía lo pendiente y, solo entonces, marca la ventana como no escritora.
 *  Se llama tras un `servir_iniciar` con éxito. */
export async function activarExclusividad(): Promise<void> {
  if (flushPendiente) {
    await flushPendiente().catch(() => {
      // Si el guardado falla no hay nada más que intentar aquí: seguir
      // sirviendo con el guardado bloqueado es más seguro que reintentar a
      // ciegas y demorar el corte de escritura local.
    });
  }
  sirviendo = true;
  epoca += 1;
  notificar();
}

/** Se llama tras un `servir_detener` con éxito. Vuelve a dejar la ventana
 *  como escritora; el cambio de época obliga a releer de la base. */
export function desactivarExclusividad(): void {
  sirviendo = false;
  epoca += 1;
  notificar();
}

export function useSirviendo(): boolean {
  return useSyncExternalStore(suscribir, estaSirviendo);
}

export function useEpocaServidor(): number {
  return useSyncExternalStore(suscribir, epocaServidor);
}

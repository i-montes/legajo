/* El progreso mínimo garantizado.
 *
 * `progreso` es lo que la barra lateral usa para decidir qué pasos están
 * bloqueados (`App.tsx`, `bloqueado = p.indice > progreso`). Hasta ahora era
 * un número que se guardaba y se leía tal cual: si «Conectar otro archivo»
 * lo ponía a cero —o si la fila de sesión se corrompía, o simplemente no
 * existía—, la barra se cerraba entera aunque la base tuviera un lote de
 * verdad, con censo, alcance, calibración y cientos de anotaciones. Un
 * contador así no puede tener la última palabra sobre lo que hay en disco.
 *
 * Este módulo calcula, a partir de lo que la base puede demostrar —no de lo
 * que alguien recuerde haber guardado—, el progreso más bajo que es seguro
 * dar por hecho. `App.tsx` lo combina con `combinarProgreso`: nunca resta,
 * solo puede subir lo que ya había.
 */
import { conexionGuardada, grafoResumen, lotes, perfilArchivo } from "./ipc";
import { pasoDe } from "../contenido/pasos";
import type { Discovery, LoteRow } from "../types";

const INDICE = {
  perfil: pasoDe("perfil")!.indice,
  alcance: pasoDe("alcance")!.indice,
  calibracion: pasoDe("calibracion")!.indice,
  revision: pasoDe("revision")!.indice,
  grafo: pasoDe("grafo")!.indice,
};

export interface ProgresoDeducido {
  /** El progreso que la base puede demostrar, sin depender de ninguna fila
   *  de sesión ni de ningún contador guardado. */
  progreso: number;
  /** Con qué lote se llega a ese progreso, si alguno lo demuestra. `null`
   *  cuando la conexión no tiene ningún lote todavía. */
  loteId: number | null;
  /** La conexión con la que se dedujo, o `null` si tampoco hay conexión
   *  guardada: en ese caso todo lo demás se queda en su valor inicial. */
  connectionId: number | null;
  /** El sitio de esa conexión, solo cuando hubo que buscarla aparte de la
   *  sesión (`connectionIdSesion` venía en `null`). `undefined` cuando la
   *  sesión ya traía su propio `sitio` y no hacía falta pedirlo de nuevo:
   *  quien llama no debe pisar lo que ya tenía con esto. */
  sitio: Discovery | null | undefined;
}

/** El progreso que da un lote por sí solo, sin mirar el resto de la base.
 *
 * `articulos`, `calibrado` y `extraidos` ya vienen en `LoteRow` —`lotes()`
 * los trae gratis—, así que solo hace falta una llamada más, y solo cuando
 * hace falta: si el lote no está marcado como calibrado, se comprueba si de
 * todos modos tiene anotaciones guardadas. Es el caso real que motivó esto:
 * se puede llevar corregidos cientos de artículos de calibración sin haber
 * llegado todavía a pulsar «Calcular la calibración». */
async function progresoDelLote(l: LoteRow): Promise<number> {
  let p = 0;
  if (l.articulos > 0) p = Math.max(p, INDICE.calibracion);

  let anotado = l.calibrado;
  if (!anotado) {
    try {
      const resumen = await grafoResumen(l.id);
      anotado = resumen.revisados > 0;
    } catch {
      // Sin poder confirmarlo, no se asume nada: mejor quedarse corto que
      // inventar un progreso que la base no puede respaldar.
    }
  }
  if (anotado) p = Math.max(p, INDICE.revision);

  if (l.extraidos > 0) p = Math.max(p, INDICE.grafo);
  return p;
}

/** El progreso mínimo que la base de `connectionId` puede demostrar.
 *
 * No toca `localStorage` ni ninguna fila de sesión: solo lee lo que ya
 * existe. Si algo falla a mitad de camino, se devuelve lo que se alcanzó a
 * confirmar hasta ahí, nunca un error que bloquee el arranque.
 *
 * `loteIdSesion` es una preferencia, no un requisito: si ese lote ya no
 * existe o quedó en null, se elige entre todos los de la conexión el que dé
 * más progreso —y, en empate, el más reciente—, así que un `lote_id`
 * borrado por error no esconde un lote que sí tiene trabajo.
 */
export async function progresoDeDatos(
  connectionId: number,
  loteIdSesion: number | null,
  taxonomia: string | null,
): Promise<{ progreso: number; loteId: number | null }> {
  let progreso = INDICE.perfil; // hay conexión: el paso 2 (lectura) es alcanzable.

  try {
    const perfil = await perfilArchivo(connectionId, taxonomia);
    const censoTerminado = perfil.censado > 0
      && perfil.tramos_totales > 0
      && perfil.tramos_hechos >= perfil.tramos_totales;
    if (censoTerminado) progreso = Math.max(progreso, INDICE.alcance);
  } catch {
    // Sin censo confirmado, se queda en lo que ya se sabe seguro.
  }

  let loteId: number | null = null;
  try {
    const filas = await lotes(connectionId);
    if (filas.length > 0) {
      // Se prueban todos: uno solo —el de la sesión, o el más reciente— podría
      // no ser el que tiene el trabajo, y esconderlo sería repetir el mismo
      // error de raíz que esto viene a corregir.
      let mejorProgreso = progreso;
      let mejorLote: number | null = filas[0].id; // el más reciente, por defecto.
      for (const l of filas) {
        const p = Math.max(progreso, await progresoDelLote(l));
        const mejora = p > mejorProgreso
          || (p === mejorProgreso && l.id === loteIdSesion);
        if (mejora) {
          mejorProgreso = p;
          mejorLote = l.id;
        }
      }
      progreso = mejorProgreso;
      loteId = mejorLote;
    }
  } catch {
    // Sin lotes que consultar, se queda en el progreso ya deducido.
  }

  return { progreso, loteId };
}

/** Punto de entrada del arranque: primero decide con qué conexión trabajar
 *  —la de la sesión guardada si la trae, y si no la que sigue en
 *  `conexion_guardada` aunque la sesión se haya olvidado entera—, y sobre
 *  esa conexión deduce el progreso. */
export async function progresoDeducido(
  connectionIdSesion: number | null,
  loteIdSesion: number | null,
  taxonomia: string | null,
): Promise<ProgresoDeducido> {
  let connectionId = connectionIdSesion;
  let sitio: Discovery | null | undefined;
  if (connectionId == null) {
    try {
      const cg = await conexionGuardada();
      if (cg) { connectionId = cg.conexion.id; sitio = cg.sitio; }
    } catch {
      // Ni sesión ni conexión legible: no hay nada que deducir.
    }
  }
  if (connectionId == null) return { progreso: 0, loteId: loteIdSesion, connectionId: null, sitio };

  const { progreso, loteId } = await progresoDeDatos(connectionId, loteIdSesion, taxonomia);
  return { progreso, loteId: loteId ?? loteIdSesion, connectionId, sitio };
}

/** El progreso final nunca es menor que el guardado: solo lo que la base
 *  demuestra puede subirlo, nada puede bajarlo por debajo de lo que ya había. */
export const combinarProgreso = (guardado: number, deducido: number): number =>
  Math.max(guardado, deducido);

import { describe, expect, it, vi } from "vitest";
import { cargarMuestraDelLote } from "./Revision";
import type { DepsCargaMuestra } from "./Revision";
import type { FilaAnotable } from "../types";

/* Antes, un fallo de `cargarMuestra` o de `avanceAnotacion` dejaba `filas` en
 * `null` para siempre: sin `.catch` en el `Promise.all`, la pantalla de
 * «Cargando la muestra…» se quedaba puesta sin ninguna pista de que algo
 * había reventado. `cargarMuestraDelLote` es la función que antes vivía
 * dentro del efecto, separada para poder probar justo eso: que un fallo se
 * ve, y que `reanudarAnotacion` —«no hay nada que reanudar»— no es uno. */

function fila(wp_id: number): FilaAnotable {
  return {
    wp_id, seccion: "Política", titulo: `Artículo ${wp_id}`, fecha: "2024-01-01",
    link: null, texto: "Texto de prueba.", html: null, palabras: 3,
  };
}

function deps(over: Partial<DepsCargaMuestra> = {}): DepsCargaMuestra {
  return {
    cargarMuestra: vi.fn().mockResolvedValue([fila(1), fila(2)]),
    avanceAnotacion: vi.fn().mockResolvedValue([0, 2]),
    reanudarAnotacion: vi.fn().mockResolvedValue(null),
    cargarLexico: vi.fn().mockResolvedValue([]),
    setFilas: vi.fn(),
    setHechos: vi.fn(),
    setLexico: vi.fn(),
    setI: vi.fn(),
    setFrontera: vi.fn(),
    ...over,
  };
}

describe("cargarMuestraDelLote", () => {
  it("si falla cargarMuestra, rechaza mencionando la causa y no llama a setFilas", async () => {
    const d = deps({
      cargarMuestra: vi.fn().mockRejectedValue(new Error("timeout de red")),
    });

    await expect(cargarMuestraDelLote(7, d)).rejects.toThrow(/muestra: timeout de red/);
    expect(d.setFilas).not.toHaveBeenCalled();
  });

  it("si falla avanceAnotacion, rechaza mencionando avance_anotacion y no llama a setFilas", async () => {
    const d = deps({
      avanceAnotacion: vi.fn().mockRejectedValue(new Error("el servidor no respondió")),
    });

    await expect(cargarMuestraDelLote(7, d)).rejects.toThrow(/avance_anotacion: el servidor no respondió/);
    expect(d.setFilas).not.toHaveBeenCalled();
  });

  it("un reanudarAnotacion que rechaza no es un fallo: la muestra carga igual", async () => {
    const d = deps({
      reanudarAnotacion: vi.fn().mockRejectedValue(new Error("no hay sesión que reanudar")),
    });

    await expect(cargarMuestraDelLote(7, d)).resolves.toBeUndefined();
    expect(d.setFilas).toHaveBeenCalledWith([fila(1), fila(2)]);
    expect(d.setHechos).toHaveBeenCalledWith(0);
  });

  it("un reanudarAnotacion que resuelve null (nada que reanudar) tampoco es un fallo", async () => {
    const d = deps({ reanudarAnotacion: vi.fn().mockResolvedValue(null) });

    await cargarMuestraDelLote(7, d);

    expect(d.setFilas).toHaveBeenCalledWith([fila(1), fila(2)]);
    expect(d.setHechos).toHaveBeenCalledWith(0);
    // Nada que reanudar y la lista no está vacía: se manda a la pantalla
    // final, no al primer artículo.
    expect(d.setI).toHaveBeenCalledWith(2);
    expect(d.setFrontera).toHaveBeenCalledWith(2);
  });

  it("con un siguiente artículo, el cursor y la frontera caen en su índice", async () => {
    const d = deps({ reanudarAnotacion: vi.fn().mockResolvedValue(2) });

    await cargarMuestraDelLote(7, d);

    expect(d.setFilas).toHaveBeenCalledWith([fila(1), fila(2)]);
    // wp_id 2 está en el índice 1 de la lista.
    expect(d.setI).toHaveBeenCalledWith(1);
    expect(d.setFrontera).toHaveBeenCalledWith(1);
  });

  it("si el siguiente wp_id no aparece en la lista, cae al índice 0", async () => {
    const d = deps({ reanudarAnotacion: vi.fn().mockResolvedValue(999) });

    await cargarMuestraDelLote(7, d);

    expect(d.setI).toHaveBeenCalledWith(0);
    expect(d.setFrontera).toHaveBeenCalledWith(0);
  });

  it("carga el léxico y llama a setLexico, sin bloquear ni reventar si falla", async () => {
    const setLexico = vi.fn();
    const entrada = { texto: "Pepito", tipo: "persona", articulos: 1, ambigua: false };
    const d = deps({ cargarLexico: vi.fn().mockResolvedValue([entrada]), setLexico });

    await cargarMuestraDelLote(7, d);
    // cargarLexico es fire-and-forget: se espera a que el microtask corra.
    await Promise.resolve();

    expect(setLexico).toHaveBeenCalledWith([entrada]);
  });

  it("una lista vacía sin nada que reanudar no mueve el cursor ni la frontera", async () => {
    const d = deps({
      cargarMuestra: vi.fn().mockResolvedValue([]),
      reanudarAnotacion: vi.fn().mockResolvedValue(null),
    });

    await cargarMuestraDelLote(7, d);

    expect(d.setFilas).toHaveBeenCalledWith([]);
    expect(d.setI).not.toHaveBeenCalled();
    expect(d.setFrontera).not.toHaveBeenCalled();
  });
});

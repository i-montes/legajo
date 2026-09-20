import { describe, expect, it } from "vitest";
import { puedeSeguirSanidad } from "./Sanidad";

/* Los hallazgos no se guardan: volver a Sanidad después de haber creado el
 * lote, calibrado o incluso anotado los encuentra sin decidir otra vez. Antes
 * eso bastaba para bloquear «Elegir el alcance» con hallazgos ya superados
 * hace tiempo. `puedeSeguirSanidad` es la regla que evita repetir el
 * trámite cuando el progreso ya demuestra que se hizo. */
describe("puedeSeguirSanidad", () => {
  const bloqueante = { clave: "fechas-danadas", bloquea: true };
  const noBloqueante = { clave: "titulares-repetidos", bloquea: false };

  it("exige decidir los bloqueantes en la primera pasada", () => {
    expect(puedeSeguirSanidad([bloqueante], {}, false)).toBe(false);
    expect(puedeSeguirSanidad([bloqueante], { "fechas-danadas": "excluir" }, false)).toBe(true);
  });

  it("los no bloqueantes nunca impiden seguir", () => {
    expect(puedeSeguirSanidad([noBloqueante], {}, false)).toBe(true);
  });

  it("una vez superado el paso, no hace falta redecidir nada", () => {
    expect(puedeSeguirSanidad([bloqueante], {}, true)).toBe(true);
  });

  it("sin hallazgos que decidir, no hay nada que bloquee", () => {
    expect(puedeSeguirSanidad([], {}, false)).toBe(true);
  });
});

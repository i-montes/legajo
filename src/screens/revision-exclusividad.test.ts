import { describe, expect, it } from "vitest";
import { puedeEscribirLocalmente } from "./Revision";

/* Servir y anotar son excluyentes (ver `lib/servidor.ts`): `guardar_
 * anotacion` no fusiona, borra e inserta el artículo entero, así que si esta
 * ventana siguiera guardando por su cuenta mientras otra máquina corrige
 * contra la misma base, la última en escribir gana y la otra se pierde sin
 * aviso. `puedeEscribirLocalmente` es la función que gobierna el
 * autoguardado (el debounce de 600 ms), el guardado periódico del cronómetro
 * y el de `beforeunload`: los tres la consultan antes de programar nada. */
describe("puedeEscribirLocalmente", () => {
  it("deja escribir cuando esta máquina no está sirviendo la base", () => {
    expect(puedeEscribirLocalmente(false)).toBe(true);
  });

  it("bloquea la escritura local en cuanto esta máquina sirve la base por red", () => {
    expect(puedeEscribirLocalmente(true)).toBe(false);
  });
});

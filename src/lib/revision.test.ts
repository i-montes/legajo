import { describe, expect, it } from "vitest";
import { destinoArticulo, siguienteMencion } from "./revision";
import type { Mencion } from "../types";

/* Una mención en el párrafo `pi`, empezando en `ini`. Lo demás da igual para
   el recorrido: lo único que ordena es dónde cae en el documento. */
const m = (mid: string, pi: number, ini: number): Mencion =>
  ({ mid, pi, ini, fin: ini + 5, texto: "Santos", tipo: "persona", auto: false });

describe("siguienteMencion", () => {
  it("no lleva a ninguna parte cuando la fila se quedó sin menciones", () => {
    expect(siguienteMencion([], null)).toBe(null);
  });

  it("empieza por la primera del documento, no por la primera del arreglo", () => {
    /* `menciones` está en el orden en que se fueron marcando, que no es el
       orden en que se leen. Saltar a la tercera del artículo en el primer clic
       desorientaría. */
    const desordenadas = [m("c", 2, 0), m("a", 0, 10), m("b", 0, 40)];
    expect(siguienteMencion(desordenadas, null)).toBe("a");
  });

  it("avanza a la siguiente aparición", () => {
    expect(siguienteMencion([m("a", 0, 10), m("b", 0, 40)], "a")).toBe("b");
  });

  it("vuelve a la primera después de la última", () => {
    expect(siguienteMencion([m("a", 0, 10), m("b", 0, 40)], "b")).toBe("a");
  });

  it("ordena dentro del párrafo, no solo entre párrafos", () => {
    const enElMismoParrafo = [m("b", 3, 90), m("a", 3, 12)];
    expect(siguienteMencion(enElMismoParrafo, "a")).toBe("b");
  });

  it("empieza de cero cuando lo enfocado era de otra entidad", () => {
    // Clic en «Petro» viniendo de «Santos»: se va a la primera de Petro.
    expect(siguienteMencion([m("a", 1, 0), m("b", 4, 0)], "de-otra-fila")).toBe("a");
  });

  it("empieza de cero cuando lo enfocado ya se borró", () => {
    /* Entre clic y clic se puede borrar la marca con ⌫. Buscar «la siguiente a
       una que ya no está» no tiene respuesta: se vuelve al principio. */
    expect(siguienteMencion([m("b", 0, 40)], "a")).toBe("b");
  });
});

describe("destinoArticulo", () => {
  it("retrocede sobre lo ya recorrido", () => {
    expect(destinoArticulo(4, -1, 5)).toBe(3);
  });

  it("avanza dentro de lo ya recorrido", () => {
    expect(destinoArticulo(2, 1, 5)).toBe(3);
  });

  it("se queda en el primero al retroceder desde el principio", () => {
    expect(destinoArticulo(0, -1, 5)).toBe(0);
  });

  it("no abre material nunca visto", () => {
    /* La frontera es el primer artículo sin cerrar: el sitio donde de verdad
       está el trabajo. «Siguiente» llega hasta ahí y para. Entrar en un
       artículo nuevo es lo que hace «Cerrar y seguir», y solo eso. */
    expect(destinoArticulo(5, 1, 5)).toBe(5);
  });

  it("deja alcanzar la pantalla final cuando ya está todo cerrado", () => {
    // Con los 12 cerrados la frontera vale 12, que es el índice de la pantalla
    // de «Revisión terminada»: volver al primero y avanzar tiene que devolver.
    expect(destinoArticulo(11, 1, 12)).toBe(12);
  });

  it("no se sale del lote aunque la frontera lo desborde", () => {
    expect(destinoArticulo(12, 1, 12)).toBe(12);
  });
});

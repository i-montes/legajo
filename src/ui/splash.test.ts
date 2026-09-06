import { describe, expect, it } from "vitest";
import { CLIPS, CUES, FIN, SILLAS, clamp01, easeInOutCubic, easeOutBack, easeOutQuad, tramo } from "./Splash";

describe("la animación de arranque", () => {
  it("interpola dentro del tramo y se queda quieta fuera", () => {
    const f = (T: number) => tramo(T, 0, 100, 1, 2, easeOutQuad);
    expect(f(0)).toBe(0);
    expect(f(0.5)).toBe(0);
    expect(f(3)).toBe(100);
    expect(f(1.5)).toBeGreaterThan(0);
    expect(f(1.5)).toBeLessThan(100);
  });

  it("un tramo de duración cero no produce NaN", () => {
    // Pasa si dos escenas caen en el mismo instante, y un NaN en un `transform`
    // hace desaparecer la pieza sin ningún error a la vista.
    expect(Number.isFinite(tramo(1, 0, 1, 1, 1, easeOutQuad))).toBe(true);
  });

  it("las curvas empiezan en 0 y acaban en 1", () => {
    for (const ease of [easeOutQuad, easeInOutCubic, easeOutBack]) {
      expect(ease(0)).toBeCloseTo(0, 5);
      expect(ease(1)).toBeCloseTo(1, 5);
    }
  });

  it("easeOutBack se pasa de 1 y vuelve: es lo que da el rebote al aterrizar", () => {
    const maximo = Math.max(...Array.from({ length: 101 }, (_, i) => easeOutBack(i / 100)));
    expect(maximo).toBeGreaterThan(1);
  });

  it("clamp01 acota por los dos lados", () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(9)).toBe(1);
  });

  it("toda pieza termina de armarse antes de que acabe la animación", () => {
    // Si una silla entrara tarde, el último fotograma la dejaría a medias y el
    // logotipo aparecería roto justo al ceder el sitio a la app.
    for (const silla of SILLAS) {
      for (const p of silla.pieces) {
        const fin = CUES.Primera + silla.delay + p.t + 0.55;
        expect(fin).toBeLessThanOrEqual(FIN);
      }
    }
  });

  it("cada pieza recorta por un polígono que existe", () => {
    for (const silla of SILLAS) {
      for (const p of silla.pieces) {
        expect(CLIPS[p.clip], `falta el recorte ${p.clip}`).toBeTruthy();
      }
    }
  });

  it("el nombre y el crédito llegan enteros antes de que se vaya la pantalla", () => {
    /* Aparecían todavía subiendo cuando el fondo empezaba a desvanecerse, así
       que el crédito se leía a medias o no se leía. */
    const nombre = tramo(FIN, 0, 1, CUES.Silencio + 0.1, CUES.Silencio + 0.6, easeOutQuad);
    const credito = tramo(FIN, 0, 1, CUES.Silencio + 0.45, CUES.Silencio + 0.95, easeOutQuad);
    expect(nombre).toBe(1);
    expect(credito).toBe(1);
    // Y con un respiro de quietud antes del final, no justo en el último cuadro.
    expect(CUES.Silencio + 0.95).toBeLessThan(FIN - 0.2);
    // Ese respiro es lo único que se alarga cuando se quiere una marca más
    // larga: la coreografía no se toca, así que estirar `FIN` no puede dejar
    // ninguna pieza a medias.
    expect(FIN - (CUES.Silencio + 0.95)).toBeGreaterThan(1.5);
  });

  it("las tres sillas se juntan antes del silencio", () => {
    // El desplazamiento tiene que haber llegado a cero cuando la escena queda
    // quieta; si no, las sillas seguirían deslizándose sobre el fotograma final.
    for (const silla of SILLAS) {
      const base = CUES.Primera + silla.delay;
      const junta = tramo(FIN, 1, 0, base + 0.5, CUES.Silencio + 0.3, easeInOutCubic);
      expect(junta).toBe(0);
    }
  });
});

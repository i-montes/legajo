import { beforeEach, describe, expect, it } from "vitest";
import {
  activarExclusividad, desactivarExclusividad, epocaServidor,
  estaSirviendo, registrarFlushPendiente,
} from "./servidor";

beforeEach(() => {
  // El módulo es un singleton compartido entre pruebas: se deja en el estado
  // de reposo antes de cada una.
  registrarFlushPendiente(null);
  if (estaSirviendo()) desactivarExclusividad();
});

describe("activarExclusividad", () => {
  it("vacía lo pendiente antes de marcar la ventana como no escritora", async () => {
    const orden: string[] = [];
    registrarFlushPendiente(async () => {
      orden.push("guardado");
    });
    // Si `activarExclusividad` marcara `sirviendo` antes de esperar el
    // guardado, esta comprobación —hecha desde dentro del propio flush—
    // vería el servidor ya activo mientras el guardado todavía no ha
    // ocurrido, que es justo el orden que pierde datos.
    let sirviendoDuranteElFlush: boolean | null = null;
    registrarFlushPendiente(async () => {
      sirviendoDuranteElFlush = estaSirviendo();
      orden.push("guardado");
    });

    await activarExclusividad();

    expect(orden).toEqual(["guardado"]);
    expect(sirviendoDuranteElFlush).toBe(false);
    expect(estaSirviendo()).toBe(true);
  });

  it("sin nada pendiente registrado, activa igual sin fallar", async () => {
    await expect(activarExclusividad()).resolves.toBeUndefined();
    expect(estaSirviendo()).toBe(true);
  });

  it("si el guardado pendiente falla, igual se activa: no se queda colgado", async () => {
    registrarFlushPendiente(async () => { throw new Error("disco lleno"); });
    await expect(activarExclusividad()).resolves.toBeUndefined();
    expect(estaSirviendo()).toBe(true);
  });

  it("cambia de época al activarse", async () => {
    const antes = epocaServidor();
    await activarExclusividad();
    expect(epocaServidor()).not.toBe(antes);
  });
});

describe("desactivarExclusividad", () => {
  it("vuelve a dejar la ventana como escritora", async () => {
    await activarExclusividad();
    desactivarExclusividad();
    expect(estaSirviendo()).toBe(false);
  });

  it("cambia de época al desactivarse, para forzar una recarga desde la base", async () => {
    await activarExclusividad();
    const antes = epocaServidor();
    desactivarExclusividad();
    expect(epocaServidor()).not.toBe(antes);
  });
});

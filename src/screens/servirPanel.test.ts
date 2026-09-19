import { describe, expect, it, vi } from "vitest";
import { apagarServidor, encenderServidor } from "./servirPanel";
import type { EstadoServidor } from "../types";

/* `servir_iniciar` y `servir_detener` todavía no existen en Rust —los está
 * haciendo otro agente en paralelo—, así que aquí se prueban con dobles: la
 * orquesta (`encenderServidor` / `apagarServidor`) es la misma sea cual sea
 * la implementación real de esos dos comandos. */

const ESTADO_ACTIVO: EstadoServidor = { activo: true, puerto: 4177, token: "t", direcciones: ["192.168.1.9"] };
const ESTADO_APAGADO: EstadoServidor = { activo: false, puerto: 0, token: "", direcciones: [] };

describe("encenderServidor", () => {
  it("vacía lo pendiente (activarExclusividad) después de confirmar el encendido, y antes de devolver", async () => {
    const orden: string[] = [];
    const dep = {
      servirIniciar: vi.fn(async () => { orden.push("servir_iniciar"); return ESTADO_ACTIVO; }),
      servirDetener: vi.fn(async () => ESTADO_APAGADO),
      activarExclusividad: vi.fn(async () => { orden.push("activarExclusividad"); }),
      desactivarExclusividad: vi.fn(),
    };
    const r = await encenderServidor(dep);
    expect(orden).toEqual(["servir_iniciar", "activarExclusividad"]);
    expect(dep.servirIniciar).toHaveBeenCalledWith(0);
    expect(dep.desactivarExclusividad).not.toHaveBeenCalled();
    expect(r).toBe(ESTADO_ACTIVO);
  });

  it("si servir_iniciar falla, no llega a tocar la exclusividad", async () => {
    const dep = {
      servirIniciar: vi.fn(async () => { throw new Error("puerto ocupado"); }),
      servirDetener: vi.fn(async () => ESTADO_APAGADO),
      activarExclusividad: vi.fn(async () => {}),
      desactivarExclusividad: vi.fn(),
    };
    await expect(encenderServidor(dep)).rejects.toThrow("puerto ocupado");
    expect(dep.activarExclusividad).not.toHaveBeenCalled();
  });
});

describe("apagarServidor", () => {
  it("desactiva la exclusividad después de confirmar el apagado", async () => {
    const orden: string[] = [];
    const dep = {
      servirIniciar: vi.fn(async () => ESTADO_ACTIVO),
      servirDetener: vi.fn(async () => { orden.push("servir_detener"); return ESTADO_APAGADO; }),
      activarExclusividad: vi.fn(async () => {}),
      desactivarExclusividad: vi.fn(() => { orden.push("desactivarExclusividad"); }),
    };
    const r = await apagarServidor(dep);
    expect(orden).toEqual(["servir_detener", "desactivarExclusividad"]);
    expect(r).toBe(ESTADO_APAGADO);
  });

  it("si servir_detener falla, la ventana se queda en modo servidor y no se desactiva por error", async () => {
    const dep = {
      servirIniciar: vi.fn(async () => ESTADO_ACTIVO),
      servirDetener: vi.fn(async () => { throw new Error("no se pudo apagar"); }),
      activarExclusividad: vi.fn(async () => {}),
      desactivarExclusividad: vi.fn(),
    };
    await expect(apagarServidor(dep)).rejects.toThrow("no se pudo apagar");
    expect(dep.desactivarExclusividad).not.toHaveBeenCalled();
  });
});

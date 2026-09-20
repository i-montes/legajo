import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { activarModoRemoto, olvidarConexionRemota } from "./conexionRemota";
import { llamar } from "./ipc";

const invokeFalso = vi.mocked(invoke);

function fakeLocalStorage(): Storage {
  const datos = new Map<string, string>();
  return {
    getItem: (k: string) => (datos.has(k) ? datos.get(k)! : null),
    setItem: (k: string, v: string) => void datos.set(k, String(v)),
    removeItem: (k: string) => void datos.delete(k),
    clear: () => datos.clear(),
    key: (i: number) => Array.from(datos.keys())[i] ?? null,
    get length() { return datos.size; },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeLocalStorage());
  invokeFalso.mockReset();
});

afterEach(() => {
  // La conexión remota vive en un módulo compartido entre pruebas: sin esto,
  // activar el modo remoto en una prueba se filtraría a la siguiente.
  olvidarConexionRemota();
  vi.unstubAllGlobals();
});

describe("llamar en modo local", () => {
  it("delega en invoke con el mismo comando y los mismos argumentos", async () => {
    invokeFalso.mockResolvedValue(42);
    const r = await llamar<number>("mi_comando", { loteId: 7, etiqueta: "x" });
    expect(r).toBe(42);
    expect(invokeFalso).toHaveBeenCalledWith("mi_comando", { loteId: 7, etiqueta: "x" });
  });

  it("pasa sin argumentos cuando no hay ninguno", async () => {
    invokeFalso.mockResolvedValue(undefined);
    await llamar("censo_corriendo");
    expect(invokeFalso).toHaveBeenCalledWith("censo_corriendo", undefined);
  });
});

describe("llamar en modo remoto", () => {
  const CONEXION = { direccion: "192.168.1.9", puerto: 4177, token: "el-token" };

  beforeEach(() => {
    activarModoRemoto(CONEXION);
  });

  it("construye la URL, la cabecera y el cuerpo, y nunca toca invoke", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: { hola: "mundo" } }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchFalso);

    const r = await llamar<{ hola: string }>("mi_comando", { loteId: 7, etiqueta: "x" });

    expect(r).toEqual({ hola: "mundo" });
    expect(invokeFalso).not.toHaveBeenCalled();
    expect(fetchFalso).toHaveBeenCalledTimes(1);
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe("http://192.168.1.9:4177/api/mi_comando");
    expect(opciones.method).toBe("POST");
    expect(opciones.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer el-token",
    });
    expect(JSON.parse(opciones.body as string)).toEqual({ loteId: 7, etiqueta: "x" });
  });

  it("manda un cuerpo vacío cuando no hay argumentos", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: null })));
    vi.stubGlobal("fetch", fetchFalso);
    await llamar("censo_corriendo");
    const [, opciones] = fetchFalso.mock.calls[0];
    expect(JSON.parse(opciones.body as string)).toEqual({});
  });

  it("desenvuelve {ok: v} y devuelve v", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: [1, 2, 3] }))));
    expect(await llamar("lotes", { connectionId: 1 })).toEqual([1, 2, 3]);
  });

  it("desenvuelve {ok: v} incluso cuando v es null o false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: null }))));
    expect(await llamar("olvidar_sesion")).toBeNull();
  });

  it("convierte {error: m} en un Error con el mensaje m", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "el lote no existe" }), { status: 500 })
    ));
    await expect(llamar("lotes", {})).rejects.toThrow("el lote no existe");
  });

  it("la red caída da un mensaje entendible y no un TypeError crudo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    let error: unknown;
    try {
      await llamar("lotes", {});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const mensaje = (error as Error).message;
    expect(mensaje).not.toMatch(/Failed to fetch/);
    expect(mensaje).not.toMatch(/TypeError/);
    expect(mensaje).toMatch(/192\.168\.1\.9/);
    expect(mensaje).toMatch(/4177/);
  });

  it("un tiempo de espera agotado también da un mensaje claro, distinto del de red caída", async () => {
    const abortError = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));
    await expect(llamar("lotes", {})).rejects.toThrow(/no respondió a tiempo/);
  });

  it("una respuesta que no es JSON da un mensaje claro y no revienta con un error de parseo crudo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>no soy Legajo</html>", { status: 200 })));
    await expect(llamar("lotes", {})).rejects.toThrow(/no es JSON|no reconoce/);
  });

  it("un 400 dice que la acción solo vale en la máquina local, no un código pelado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "censo no expuesto" }), { status: 400 })));
    await expect(llamar("iniciar_censo", {})).rejects.toThrow(/máquina que tiene la base/);
  });

  it("un 400 sin cuerpo entendible también da el mensaje claro, sin reventar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no soy json", { status: 400 })));
    await expect(llamar("preparar_modelos", {})).rejects.toThrow(/máquina que tiene la base/);
  });

  describe("registro de fallos remotos", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("una llamada remota fallida se registra una sola vez, con el comando y la URL", async () => {
      const consoleErrorFalso = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      try {
        await expect(llamar("lotes", {})).rejects.toBeInstanceOf(Error);
        expect(consoleErrorFalso).toHaveBeenCalledTimes(1);
        const [mensaje, error] = consoleErrorFalso.mock.calls[0];
        expect(mensaje).toContain("lotes");
        expect(mensaje).toContain("http://192.168.1.9:4177/api/lotes");
        expect(error).toBeInstanceOf(Error);
      } finally {
        consoleErrorFalso.mockRestore();
      }
    });
  });
});

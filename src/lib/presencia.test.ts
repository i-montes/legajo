import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EstadoServidor } from "../types";

/* Mismo motivo que en `conexionRemota.test.ts`: el módulo abre su conexión y
 * fija su id de cliente en cuanto se carga, y se queda con todo en variables
 * de memoria. Cada prueba necesita su propio `localStorage` fabricado y su
 * propia copia fresca del módulo. */

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

/** Un WebSocket de mentira: nada de red, solo los cuatro manejadores y un
 *  registro de lo que se mandó, más dos métodos de prueba (`abrir`, `romper`)
 *  para simular lo que en un navegador real dispara el propio socket. */
class FakeWebSocket {
  static instancias: FakeWebSocket[] = [];
  url: string;
  enviados: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instancias.push(this);
  }
  send(data: string) { this.enviados.push(data); }
  close() { this.onclose?.(); }
  /** Simula que el navegador ya completó el handshake. */
  abrir() { this.onopen?.(); }
  /** Simula un mensaje entrante ya serializado a JSON por el servidor. */
  recibir(msg: unknown) { this.onmessage?.({ data: JSON.stringify(msg) }); }
  /** Simula una caída de red: el socket se cierra sin que este módulo lo pidiera. */
  romper() { this.onclose?.(); }
}

function ultimoEnviado(ws: FakeWebSocket): unknown {
  return JSON.parse(ws.enviados[ws.enviados.length - 1]);
}

async function moduloFresco() {
  vi.resetModules();
  FakeWebSocket.instancias = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  return import("./presencia");
}

const ESTADO_ACTIVO: EstadoServidor = { activo: true, puerto: 4177, token: "tok", direcciones: ["127.0.0.1"] };

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("puedeEditar", () => {
  it("solo deja escribir sin servidor o con el bloqueo propio", async () => {
    const { puedeEditar } = await moduloFresco();
    const por = { nombre: "Ana", emoji: "🦊" };
    expect(puedeEditar({ tipo: "sin-servidor" })).toBe(true);
    expect(puedeEditar({ tipo: "propio" })).toBe(true);
    expect(puedeEditar({ tipo: "desconectado" })).toBe(false);
    expect(puedeEditar({ tipo: "pendiente" })).toBe(false);
    expect(puedeEditar({ tipo: "ocupado", por })).toBe(false);
    expect(puedeEditar({ tipo: "perdido", por })).toBe(false);
  });
});

describe("sin ningún servidor configurado", () => {
  it("no construye ningún WebSocket y cualquier artículo queda sin-servidor", async () => {
    const m = await moduloFresco();
    expect(FakeWebSocket.instancias.length).toBe(0);
    expect(m.leerBloqueoArticulo(1, 2)).toEqual({ tipo: "sin-servidor" });
  });

  it("notificarEstadoServidor(null) tampoco abre nada", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(null);
    expect(FakeWebSocket.instancias.length).toBe(0);
    expect(m.leerBloqueoArticulo(1, 2)).toEqual({ tipo: "sin-servidor" });
  });
});

describe("servidor local activo", () => {
  it("pide tomar tras hola+bienvenida, pasa a propio con tomado, y suelta al cerrar el artículo", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);

    expect(FakeWebSocket.instancias.length).toBe(1);
    const ws = FakeWebSocket.instancias[0];
    expect(ws.url).toBe("ws://127.0.0.1:4177/ws?token=tok");

    ws.abrir();
    expect(ultimoEnviado(ws)).toEqual({ tipo: "hola", cliente: expect.any(String) });

    // El artículo se pide antes de que llegue la bienvenida: queda anotado
    // como deseado y se manda en cuanto el servidor se presenta.
    m.pedirArticulo(10, 20);
    expect(m.leerBloqueoArticulo(10, 20)).toEqual({ tipo: "desconectado" });

    ws.recibir({ tipo: "bienvenida", sesion: "s1", nombre: "Ana", emoji: "🦊" });
    expect(ultimoEnviado(ws)).toEqual({ tipo: "tomar", loteId: 10, wpId: 20 });
    expect(m.leerBloqueoArticulo(10, 20)).toEqual({ tipo: "pendiente" });

    ws.recibir({ tipo: "tomado" });
    expect(m.leerBloqueoArticulo(10, 20)).toEqual({ tipo: "propio" });

    m.soltarArticulo();
    expect(ultimoEnviado(ws)).toEqual({ tipo: "soltar" });
    expect(m.leerBloqueoArticulo(10, 20)).toEqual({ tipo: "sin-servidor" });
  });
});

describe("ocupado", () => {
  it("marca ocupado con el «por» recibido, y ya no se puede editar", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws = FakeWebSocket.instancias[0];
    ws.abrir();
    m.pedirArticulo(1, 2);
    ws.recibir({ tipo: "bienvenida", sesion: "s1", nombre: "Ana", emoji: "🦊" });

    ws.recibir({ tipo: "ocupado", por: { nombre: "Beto", emoji: "🐻" } });
    const estado = m.leerBloqueoArticulo(1, 2);
    expect(estado).toEqual({ tipo: "ocupado", por: { nombre: "Beto", emoji: "🐻" } });
    expect(m.puedeEditar(estado)).toBe(false);
  });
});

describe("perdido", () => {
  it("vacía lo pendiente y SOLO ENTONCES pasa a perdido", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws = FakeWebSocket.instancias[0];
    ws.abrir();
    m.pedirArticulo(1, 2);
    ws.recibir({ tipo: "bienvenida", sesion: "s1", nombre: "Ana", emoji: "🦊" });
    ws.recibir({ tipo: "tomado" });
    expect(m.leerBloqueoArticulo(1, 2)).toEqual({ tipo: "propio" });

    const orden: string[] = [];
    let resolverFlush!: () => void;
    m.fijarFlushPendiente(
      () => new Promise<void>((resolve) => {
        resolverFlush = () => { orden.push("flush"); resolve(); };
      })
    );

    ws.recibir({ tipo: "perdido", por: { nombre: "Caro", emoji: "🐱" } });
    // `flush` se invoca en una microtarea (`Promise.resolve().then(flush)`),
    // así que hace falta ceder el turno una vez antes de que su promesa
    // exista de verdad.
    await Promise.resolve();
    // El flush todavía no se resolvió: el estado sigue siendo "propio".
    expect(m.leerBloqueoArticulo(1, 2)).toEqual({ tipo: "propio" });
    expect(orden).toEqual([]);

    resolverFlush();
    // Deja correr la cadena de microtareas/macrotareas encadenada tras el flush.
    await new Promise((r) => setTimeout(r, 0));

    orden.push("estado-perdido");
    expect(orden).toEqual(["flush", "estado-perdido"]);
    expect(m.leerBloqueoArticulo(1, 2)).toEqual({ tipo: "perdido", por: { nombre: "Caro", emoji: "🐱" } });
    expect(m.puedeEditar(m.leerBloqueoArticulo(1, 2))).toBe(false);
  });
});

describe("reconexión", () => {
  it("reintenta con espera creciente y vuelve a pedir el artículo deseado al reconectar", async () => {
    vi.useFakeTimers();
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws1 = FakeWebSocket.instancias[0];
    ws1.abrir();
    m.pedirArticulo(5, 6);
    ws1.recibir({ tipo: "bienvenida", sesion: "s1", nombre: "Ana", emoji: "🦊" });
    ws1.recibir({ tipo: "tomado" });
    expect(m.leerBloqueoArticulo(5, 6)).toEqual({ tipo: "propio" });

    ws1.romper();
    expect(m.leerBloqueoArticulo(5, 6)).toEqual({ tipo: "desconectado" });
    expect(FakeWebSocket.instancias.length).toBe(1);

    // Primer backoff: 1 s exacto.
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instancias.length).toBe(2);

    const ws2 = FakeWebSocket.instancias[1];
    ws2.abrir();
    ws2.recibir({ tipo: "bienvenida", sesion: "s2", nombre: "Ana", emoji: "🦊" });
    // El artículo seguía deseado: la nueva conexión vuelve a pedirlo sola.
    expect(ultimoEnviado(ws2)).toEqual({ tipo: "tomar", loteId: 5, wpId: 6 });
  });
});

describe("id de cliente", () => {
  it("persiste entre módulos frescos, con el mismo localStorage", async () => {
    const m1 = await moduloFresco();
    m1.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws1 = FakeWebSocket.instancias[0];
    ws1.abrir();
    const cliente1 = (ultimoEnviado(ws1) as { cliente: string }).cliente;
    expect(typeof cliente1).toBe("string");

    // Simula reabrir la app: un módulo nuevo, mismo localStorage (no se
    // vuelve a llamar a `vi.stubGlobal("localStorage", ...)` entre medias).
    const m2 = await moduloFresco();
    m2.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws2 = FakeWebSocket.instancias[0];
    ws2.abrir();
    const cliente2 = (ultimoEnviado(ws2) as { cliente: string }).cliente;

    expect(cliente2).toBe(cliente1);
  });
});

describe("modo remoto", () => {
  it("también dispara la conexión, a la dirección/puerto/token remotos", async () => {
    vi.resetModules();
    FakeWebSocket.instancias = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const conexionRemota = await import("./conexionRemota");
    const presencia = await import("./presencia");

    // Al cargarse, en modo local y sin servidor, no había nada que abrir.
    expect(FakeWebSocket.instancias.length).toBe(0);

    conexionRemota.activarModoRemoto({ direccion: "192.168.1.9", puerto: 4177, token: "abc123" });

    expect(FakeWebSocket.instancias.length).toBe(1);
    expect(FakeWebSocket.instancias[0].url).toBe("ws://192.168.1.9:4177/ws?token=abc123");
    // Y sirve igual para que el resto de la prueba no quede con un import sin usar.
    expect(presencia.leerBloqueoArticulo(1, 1)).toEqual({ tipo: "sin-servidor" });
  });
});

describe("cambiado", () => {
  it("sin bloqueo propio del artículo, recarga", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws = FakeWebSocket.instancias[0];
    ws.abrir();
    // Sin haber pedido este artículo (o habiéndolo pedido pero sin
    // `tomado` todavía, o tras un `perdido`): en ninguno de esos casos hay
    // bloqueo propio, así que el aviso debe disparar la recarga.
    const cb = vi.fn();
    m.suscribirCambio(10, 20, cb);

    ws.recibir({ tipo: "cambiado", loteId: 10, wpId: 20 });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("con bloqueo propio del artículo, NO recarga", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws = FakeWebSocket.instancias[0];
    ws.abrir();
    m.pedirArticulo(10, 20);
    ws.recibir({ tipo: "bienvenida", sesion: "s1", nombre: "Ana", emoji: "🦊" });
    ws.recibir({ tipo: "tomado" });
    expect(m.leerBloqueoArticulo(10, 20)).toEqual({ tipo: "propio" });

    // Recargar aquí le pisaría a esta misma ventana el trabajo en curso:
    // si alguien se lo arrebató de verdad, eso llega por `perdido`, no por
    // aquí.
    const cb = vi.fn();
    m.suscribirCambio(10, 20, cb);
    ws.recibir({ tipo: "cambiado", loteId: 10, wpId: 20 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("de otro artículo, se ignora", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws = FakeWebSocket.instancias[0];
    ws.abrir();
    const cb = vi.fn();
    m.suscribirCambio(1, 2, cb);

    ws.recibir({ tipo: "cambiado", loteId: 3, wpId: 4 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("un tipo desconocido no rompe nada ni llama a ningún oyente", async () => {
    const m = await moduloFresco();
    m.notificarEstadoServidor(ESTADO_ACTIVO);
    const ws = FakeWebSocket.instancias[0];
    ws.abrir();
    const cb = vi.fn();
    m.suscribirCambio(1, 2, cb);

    expect(() => ws.recibir({ tipo: "algo-que-no-existe" })).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });
});

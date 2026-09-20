import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* `conexionRemota.ts` lee `localStorage` una sola vez, al cargar el módulo,
 * y se queda con lo leído en variables de memoria (ver el comentario del
 * fichero: es lo que le permite a `useSyncExternalStore` devolver siempre la
 * misma referencia). Por eso cada prueba necesita su propio `localStorage`
 * fabricado y su propia copia fresca del módulo — `vi.resetModules` más un
 * `import` dinámico, en vez de un único `import` estático arriba del
 * fichero. */

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

async function moduloFresco() {
  vi.resetModules();
  return import("./conexionRemota");
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("el modo y la conexión remota persisten", () => {
  it("empieza en local sin nada guardado", async () => {
    const m = await moduloFresco();
    expect(m.leerModo()).toBe("local");
    expect(m.leerConexionRemota()).toBeNull();
  });

  it("activar el modo remoto guarda la conexión y el modo, y una copia fresca del módulo los lee", async () => {
    const m = await moduloFresco();
    m.activarModoRemoto({ direccion: "192.168.1.9", puerto: 4177, token: "abc123" });
    expect(m.leerModo()).toBe("remoto");
    expect(m.leerConexionRemota()).toEqual({ direccion: "192.168.1.9", puerto: 4177, token: "abc123" });

    // Simula reabrir la app: un módulo nuevo, mismo localStorage.
    const m2 = await moduloFresco();
    expect(m2.leerModo()).toBe("remoto");
    expect(m2.leerConexionRemota()).toEqual({ direccion: "192.168.1.9", puerto: 4177, token: "abc123" });
  });

  it("volver a modo local no borra la conexión guardada", async () => {
    const m = await moduloFresco();
    m.activarModoRemoto({ direccion: "10.0.0.5", puerto: 8080, token: "t" });
    m.volverAModoLocal();
    expect(m.leerModo()).toBe("local");
    expect(m.leerConexionRemota()).toEqual({ direccion: "10.0.0.5", puerto: 8080, token: "t" });
  });

  it("olvidar la conexión la borra y vuelve a local, y sobrevive a reabrir", async () => {
    const m = await moduloFresco();
    m.activarModoRemoto({ direccion: "10.0.0.5", puerto: 8080, token: "t" });
    m.olvidarConexionRemota();
    expect(m.leerModo()).toBe("local");
    expect(m.leerConexionRemota()).toBeNull();

    const m2 = await moduloFresco();
    expect(m2.leerModo()).toBe("local");
    expect(m2.leerConexionRemota()).toBeNull();
  });

  it("un modo remoto guardado sin conexión (almacenamiento a medias) cae a local", async () => {
    localStorage.setItem("legajo.modo", "remoto");
    // Nunca se guardó legajo.conexionRemota.
    const m = await moduloFresco();
    expect(m.leerModo()).toBe("local");
  });

  it("si localStorage falla, activar el modo remoto no revienta y la sesión sigue funcionando", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => { throw new Error("bloqueado"); },
      setItem: () => { throw new Error("bloqueado"); },
      removeItem: () => { throw new Error("bloqueado"); },
    } as unknown as Storage);
    const m = await moduloFresco();
    expect(() => m.activarModoRemoto({ direccion: "x", puerto: 1, token: "t" })).not.toThrow();
    expect(m.leerModo()).toBe("remoto");
  });
});

describe("normalizarToken", () => {
  it("sube a mayúsculas", async () => {
    const { normalizarToken } = await moduloFresco();
    expect(normalizarToken("abcd-1234-efgh-5678")).toBe("ABCD-1234-EFGH-5678");
  });

  it("recorta espacios y saltos de línea alrededor", async () => {
    const { normalizarToken } = await moduloFresco();
    expect(normalizarToken("  ABCD-1234-EFGH-5678  ")).toBe("ABCD-1234-EFGH-5678");
    expect(normalizarToken("\nABCD-1234-EFGH-5678\t")).toBe("ABCD-1234-EFGH-5678");
  });

  it("mayúsculas, minúsculas, mezcla y con espacios dan el mismo resultado", async () => {
    const { normalizarToken } = await moduloFresco();
    const esperado = "ABCD-1234-EFGH-5678";
    for (const variante of [
      "ABCD-1234-EFGH-5678", "abcd-1234-efgh-5678", "AbCd-1234-eFgH-5678", "  abcd-1234-efgh-5678  ",
    ]) {
      expect(normalizarToken(variante)).toBe(esperado);
    }
  });
});

describe("la dirección base de la máquina remota", () => {
  it("antepone http:// cuando la dirección no trae esquema", async () => {
    const { baseUrlRemota } = await moduloFresco();
    expect(baseUrlRemota({ direccion: "192.168.1.9", puerto: 4177, token: "t" })).toBe("http://192.168.1.9:4177");
  });

  it("respeta un esquema explícito", async () => {
    const { baseUrlRemota } = await moduloFresco();
    expect(baseUrlRemota({ direccion: "https://tumedio.co", puerto: 4177, token: "t" })).toBe("https://tumedio.co:4177");
  });
});

describe("la cadena de conexión copiable", () => {
  it("se genera y se vuelve a leer entera", async () => {
    const { generarCadenaConexion, parsearCadenaConexion } = await moduloFresco();
    const c = { direccion: "192.168.1.9", puerto: 4177, token: "abc-123-DEF" };
    const cadena = generarCadenaConexion(c);
    expect(parsearCadenaConexion(cadena)).toEqual(c);
  });

  it("tolera un token con caracteres que necesitan escape", async () => {
    const { generarCadenaConexion, parsearCadenaConexion } = await moduloFresco();
    const c = { direccion: "10.0.0.2", puerto: 9, token: "a/b c+d" };
    expect(parsearCadenaConexion(generarCadenaConexion(c))).toEqual(c);
  });

  it("rechaza cualquier cosa que no sea la cadena esperada", async () => {
    const { parsearCadenaConexion } = await moduloFresco();
    expect(parsearCadenaConexion("no es una cadena de conexión")).toBeNull();
    expect(parsearCadenaConexion("http://192.168.1.9:4177/abc")).toBeNull();
    expect(parsearCadenaConexion("")).toBeNull();
  });
});

describe("comprobarSalud", () => {
  const CONEXION = { direccion: "192.168.1.9", puerto: 4177, token: "abc" };

  it("distingue una máquina que no responde", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe("sin-contacto");
      expect(r.mensaje).not.toMatch(/Failed to fetch/);
    }
  });

  it("distingue un token incorrecto", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("token");
  });

  it("distingue algo que no es Legajo respondiendo en esa dirección (no es JSON)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>hola</html>", { status: 200 })));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("no-es-legajo");
  });

  it("distingue algo que no es Legajo respondiendo en esa dirección (JSON cualquiera)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ estado: "arriba", uptime: 12 }), { status: 200 })
    ));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("no-es-legajo");
  });

  it("da la versión y el número de lotes con el cuerpo real que manda el servidor, envuelto en `ok`", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: { lotes: 1, protocolo: 1, version: "0.1.0" } }), { status: 200 })
    ));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r).toEqual({ ok: true, salud: { version: "0.1.0", lotes: 1 } });
  });

  it("rechaza un cuerpo sin envolver en `ok` — ya no es lo que el servidor manda", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: "0.1.0", lotes: 1 }), { status: 200 })
    ));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("no-es-legajo");
  });

  it("rechaza un `protocolo` distinto de 1, aunque version y lotes tengan la forma correcta", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: { lotes: 1, protocolo: 2, version: "0.1.0" } }), { status: 200 })
    ));
    const { comprobarSalud } = await moduloFresco();
    const r = await comprobarSalud(CONEXION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe("no-es-legajo");
  });

  it("manda el token en la cabecera Authorization", async () => {
    const fetchFalso = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: { lotes: 0, protocolo: 1, version: "1" } }))
    );
    vi.stubGlobal("fetch", fetchFalso);
    const { comprobarSalud } = await moduloFresco();
    await comprobarSalud(CONEXION);
    const [url, opciones] = fetchFalso.mock.calls[0];
    expect(url).toBe("http://192.168.1.9:4177/api/salud");
    expect((opciones.headers as Record<string, string>).Authorization).toBe("Bearer abc");
  });
});

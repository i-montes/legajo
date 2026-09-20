import { beforeEach, describe, expect, it, vi } from "vitest";
import { pasoDe } from "../contenido/pasos";
import type { ConexionGuardada, LoteRow, PerfilArchivo, ResumenGrafo } from "../types";

vi.mock("./ipc", () => ({
  conexionGuardada: vi.fn(),
  grafoResumen: vi.fn(),
  lotes: vi.fn(),
  perfilArchivo: vi.fn(),
}));

import { conexionGuardada, grafoResumen, lotes, perfilArchivo } from "./ipc";
import { combinarProgreso, progresoDeDatos, progresoDeducido } from "./progreso";

const conexionGuardadaFalsa = vi.mocked(conexionGuardada);
const grafoResumenFalso = vi.mocked(grafoResumen);
const lotesFalso = vi.mocked(lotes);
const perfilArchivoFalso = vi.mocked(perfilArchivo);

const INDICE = {
  perfil: pasoDe("perfil")!.indice,
  alcance: pasoDe("alcance")!.indice,
  calibracion: pasoDe("calibracion")!.indice,
  revision: pasoDe("revision")!.indice,
  grafo: pasoDe("grafo")!.indice,
};

/** Un `PerfilArchivo` con censo terminado, salvo lo que se sobrescriba. */
const perfilCensado = (extra: Partial<PerfilArchivo> = {}): PerfilArchivo => ({
  censado: 500, anio_min: 2001, anio_max: 2024, por_anio: [], taxonomia: null,
  secciones: [], anomalias: [], taxonomias_usables: [], sondeo: null, sin_fecha: 0,
  tramos_hechos: 10, tramos_totales: 10,
  ...extra,
});

/** Un `LoteRow` con lo mínimo, salvo lo que se sobrescriba. */
const lote = (extra: Partial<LoteRow> = {}): LoteRow => ({
  id: 1, etiqueta: "Un lote", taxonomia: null, creado: "2024-01-01",
  articulos: 100, calibrar: 12, extraidos: 0, calibrado: false,
  ...extra,
});

const resumen = (extra: Partial<ResumenGrafo> = {}): ResumenGrafo => ({
  articulos: 12, procesados: 0, revisados: 0, entidades_distintas: 0,
  entidades_una_vez: 0, relaciones: 0,
  ...extra,
});

beforeEach(() => {
  conexionGuardadaFalsa.mockReset();
  grafoResumenFalso.mockReset();
  lotesFalso.mockReset();
  perfilArchivoFalso.mockReset();
});

describe("combinarProgreso", () => {
  it("nunca es menor que el guardado", () => {
    expect(combinarProgreso(7, 3)).toBe(7);
    expect(combinarProgreso(0, 5)).toBe(5);
    expect(combinarProgreso(5, 5)).toBe(5);
    expect(combinarProgreso(0, 0)).toBe(0);
  });

  it("nunca es menor que ninguno de los dos, para cualquier par", () => {
    for (let guardado = 0; guardado <= 8; guardado++) {
      for (let deducido = 0; deducido <= 8; deducido++) {
        const r = combinarProgreso(guardado, deducido);
        expect(r).toBeGreaterThanOrEqual(guardado);
        expect(r).toBeGreaterThanOrEqual(deducido);
      }
    }
  });
});

describe("progresoDeDatos: el caso real que bloqueó al usuario", () => {
  it("progreso=0, lote_id=null, sin fila de sesión, pero con un lote con anotaciones: llega a revisión", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    // El lote no está marcado como calibrado —no se llegó a pulsar «Calcular
    // la calibración»— pero sí tiene anotaciones guardadas: es justo el
    // estado real de la sesión que se reparó a mano.
    lotesFalso.mockResolvedValue([lote({ id: 1, calibrado: false })]);
    grafoResumenFalso.mockResolvedValue(resumen({ revisados: 5, relaciones: 225 }));

    const r = await progresoDeDatos(9, /* loteIdSesion */ null, null);

    expect(r.progreso).toBeGreaterThanOrEqual(INDICE.revision);
    expect(r.loteId).toBe(1);
  });
});

describe("progresoDeducido: el punto de entrada completo", () => {
  it("sin sesión y sin conexión guardada, se queda en cero", async () => {
    conexionGuardadaFalsa.mockResolvedValue(null);
    const r = await progresoDeducido(null, null, null);
    expect(r).toEqual({ progreso: 0, loteId: null, connectionId: null, sitio: undefined });
    expect(perfilArchivoFalso).not.toHaveBeenCalled();
    expect(lotesFalso).not.toHaveBeenCalled();
  });

  it("sin fila de sesión, busca la conexión guardada y deduce igual sobre ella", async () => {
    const cg: ConexionGuardada = {
      conexion: {
        id: 7, label: "Mi medio", resolved_origin: "https://x.co", transport_label: "REST",
        site_name: "X", total_posts: 900, auth_method: "application_password",
        created_at: "", last_used_at: "",
      },
      sitio: null,
      autorizado: true,
    };
    conexionGuardadaFalsa.mockResolvedValue(cg);
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([lote({ id: 3, calibrado: true })]);

    const r = await progresoDeducido(null, null, null);

    expect(r.connectionId).toBe(7);
    expect(r.loteId).toBe(3);
    expect(r.progreso).toBeGreaterThanOrEqual(INDICE.revision);
    expect(grafoResumenFalso).not.toHaveBeenCalled(); // ya calibrado: no hace falta.
  });

  it("con conexión de sesión, no vuelve a buscar la conexión guardada", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado({ censado: 0, tramos_hechos: 0, tramos_totales: 0 }));
    lotesFalso.mockResolvedValue([]);

    const r = await progresoDeducido(9, null, null);

    expect(conexionGuardadaFalsa).not.toHaveBeenCalled();
    expect(r.connectionId).toBe(9);
    expect(r.sitio).toBeUndefined(); // no se pisa lo que ya traía la sesión.
  });

  it("un fallo al leer la conexión guardada no revienta: se queda en cero", async () => {
    conexionGuardadaFalsa.mockRejectedValue(new Error("la base no responde"));
    const r = await progresoDeducido(null, null, null);
    expect(r).toEqual({ progreso: 0, loteId: null, connectionId: null, sitio: undefined });
  });
});

describe("progresoDeDatos: los demás niveles", () => {
  it("con conexión y sin nada más, el perfil (paso 2) es alcanzable", async () => {
    perfilArchivoFalso.mockRejectedValue(new Error("sin censo"));
    lotesFalso.mockResolvedValue([]);
    const r = await progresoDeDatos(1, null, null);
    expect(r.progreso).toBe(INDICE.perfil);
    expect(r.loteId).toBeNull();
  });

  it("con el censo terminado, el alcance es alcanzable aunque no haya lotes", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([]);
    const r = await progresoDeDatos(1, null, null);
    expect(r.progreso).toBe(INDICE.alcance);
  });

  it("un lote creado sin nada más deja la calibración alcanzable", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([lote({ articulos: 200, calibrado: false })]);
    grafoResumenFalso.mockResolvedValue(resumen({ revisados: 0 }));
    const r = await progresoDeDatos(1, null, null);
    expect(r.progreso).toBe(INDICE.calibracion);
  });

  it("un lote con extracción hecha deja el grafo alcanzable", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([lote({ calibrado: true, extraidos: 400 })]);
    const r = await progresoDeDatos(1, null, null);
    expect(r.progreso).toBe(INDICE.grafo);
  });

  it("entre varios lotes, se queda con el que da más progreso, no con el más reciente", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([
      lote({ id: 9, creado: "2024-06-01", articulos: 50, calibrado: false }), // el más reciente, sin nada más
      lote({ id: 2, creado: "2023-01-01", calibrado: true, extraidos: 10 }),  // el viejo, con trabajo real
    ]);
    grafoResumenFalso.mockResolvedValue(resumen({ revisados: 0 }));
    const r = await progresoDeDatos(1, null, null);
    expect(r.loteId).toBe(2);
    expect(r.progreso).toBe(INDICE.grafo);
  });

  it("en empate de progreso, prefiere el lote de la sesión sobre el más reciente", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([
      lote({ id: 9, creado: "2024-06-01", calibrado: true }), // el más reciente
      lote({ id: 2, creado: "2023-01-01", calibrado: true }), // el de la sesión, mismo progreso
    ]);
    const r = await progresoDeDatos(1, /* loteIdSesion */ 2, null);
    expect(r.loteId).toBe(2);
  });

  it("un lote ya calibrado no necesita consultar grafoResumen", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([lote({ calibrado: true })]);
    await progresoDeDatos(1, null, null);
    expect(grafoResumenFalso).not.toHaveBeenCalled();
  });

  it("si grafoResumen falla, no se asume que hay anotaciones", async () => {
    perfilArchivoFalso.mockResolvedValue(perfilCensado());
    lotesFalso.mockResolvedValue([lote({ calibrado: false, articulos: 50 })]);
    grafoResumenFalso.mockRejectedValue(new Error("lote no encontrado"));
    const r = await progresoDeDatos(1, null, null);
    expect(r.progreso).toBe(INDICE.calibracion); // no llega a revisión sin confirmarlo.
  });
});

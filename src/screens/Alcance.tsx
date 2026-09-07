import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Boton, Encabezado, Lienzo, Razon, Rotulo } from "../ui";
import { arbolCategorias, crearLote, estimarAlcance } from "../lib/ipc";
import type { Alcance as AlcanceT, ArbolCategorias, Estimacion, NodoCategoria } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");

function duracion(seg: number) {
  if (seg < 90) return `${Math.round(seg)} s`;
  if (seg < 5400) return `${Math.round(seg / 60)} min`;
  const h = seg / 3600;
  return h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : `${(h / 24).toFixed(1)} días`;
}

/** Todos los descendientes de un nodo, para poder marcar el subárbol de una vez. */
function subarbol(n: NodoCategoria): number[] {
  return [n.term_id, ...n.hijos.flatMap(subarbol)];
}

export default function Alcance({ estado }: { estado: EstadoApp }) {
  const { conexionId, taxonomia } = estado;
  const [arbol, setArbol] = useState<ArbolCategorias | null>(null);
  const [elegidos, setElegidos] = useState<number[]>([]);
  const [abiertos, setAbiertos] = useState<Record<number, boolean>>({});
  const [desde, setDesde] = useState<number | null>(null);
  const [hasta, setHasta] = useState<number | null>(null);
  const [est, setEst] = useState<Estimacion | null>(null);
  const [nCalibrar, setNCalibrar] = useState(12);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (conexionId == null) return;
    arbolCategorias(conexionId, taxonomia ?? "categories")
      .then((a) => {
        setArbol(a);
        setDesde(a.anio_min);
        setHasta(a.anio_max);
      })
      .catch((e) => setError(String(e)));
  }, [conexionId, taxonomia]);

  const alcance: AlcanceT = useMemo(() => ({
    taxonomia: arbol?.taxonomia ?? "categories",
    terminos: elegidos,
    desde_anio: desde,
    hasta_anio: hasta,
    incluir_sin_fecha: false,
  }), [arbol?.taxonomia, elegidos, desde, hasta]);

  const recalcular = useCallback(() => {
    if (conexionId == null || !arbol) return;
    estimarAlcance(conexionId, alcance).then(setEst).catch(() => {});
  }, [conexionId, arbol, alcance]);

  useEffect(() => {
    const t = setTimeout(recalcular, 250);
    return () => clearTimeout(t);
  }, [recalcular]);

  function alternar(n: NodoCategoria) {
    const rama = subarbol(n);
    setElegidos((prev) =>
      prev.includes(n.term_id)
        // Al soltar un padre se sueltan sus hijos: si no, quedarían elegidos
        // sin que el árbol lo muestre.
        ? prev.filter((x) => !rama.includes(x))
        : [...new Set([...prev, ...rama])]
    );
  }

  async function crear() {
    if (conexionId == null || !est) return;
    setCreando(true);
    setError(null);
    try {
      const nombre = elegidos.length === 0
        ? `Todo el archivo · ${num(est.articulos)}`
        : `${etiquetaSeleccion(arbol, elegidos)} · ${num(est.articulos)}`;
      const id = await crearLote(conexionId, nombre, alcance, nCalibrar);
      estado.setLoteId(id);
      estado.avanzar(4, "calibracion");
    } catch (e) {
      setError(String(e));
    } finally {
      setCreando(false);
    }
  }

  if (!arbol) {
    return (
      <Lienzo>
        <Encabezado paso="alcance" frase={error ?? "Leyendo las secciones del archivo…"} compacto />
      </Lienzo>
    );
  }

  const anios = arbol.anio_min && arbol.anio_max
    ? Array.from({ length: arbol.anio_max - arbol.anio_min + 1 }, (_, i) => arbol.anio_min! + i)
    : [];

  return (
    <Lienzo ancho={900}>
      <Encabezado
        paso="alcance"
        frase="Marca secciones y acota años. Sin elegir nada, entra todo el archivo."
        detalle={
          <>
            <Razon>Se elige por secciones, como está organizado el medio, para que el avance sea trazable: se sabe qué está hecho y qué falta en términos que la redacción reconoce.</Razon>
            <Razon>Marcar una sección arrastra sus subsecciones: en WordPress un artículo regional no siempre lleva también la categoría madre.</Razon>
            <Razon>No es una muestra estadística: es un alcance de trabajo. El cómputo estimado es tiempo de máquina, desatendido, que se puede detener y retomar.</Razon>
          </>
        }
      />

      {error && <Aviso estado="error">{error}</Aviso>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr minmax(240px, 280px)", gap: "var(--esp-11)", alignItems: "start" }}>
        <div>
          <Rotulo style={{ marginBottom: 12 }}>Secciones</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {arbol.raices.map((n) => (
              <Rama
                key={n.term_id} n={n} prof={0}
                elegidos={elegidos} abiertos={abiertos}
                onAlternar={alternar}
                onAbrir={(id) => setAbiertos((a) => ({ ...a, [id]: !a[id] }))}
              />
            ))}
          </div>
          {elegidos.length > 0 && (
            <Boton variante="enlace" onClick={() => setElegidos([])} style={{ marginTop: 14 }}>
              quitar la selección
            </Boton>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-8)", position: "sticky", top: 0 }}>
          <div>
            <Rotulo style={{ marginBottom: 10 }}>Años</Rotulo>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <SelectorAnio v={desde} onChange={setDesde} anios={anios} />
              <span className="t-menor" style={{ color: "var(--t3)" }}>—</span>
              <SelectorAnio v={hasta} onChange={setHasta} anios={anios} />
            </div>
            {arbol.sin_fecha > 0 && (
              <p className="t-menor" style={{ color: "var(--t3)", margin: "10px 0 0", lineHeight: 1.6 }}>
                {num(arbol.sin_fecha)} artículos tienen la fecha dañada y quedan fuera de cualquier
                rango de años.
              </p>
            )}
          </div>

          <div style={{ padding: "var(--esp-4)", background: "var(--superficie)", border: "1px solid var(--borde)", borderRadius: 10 }}>
            <Rotulo style={{ marginBottom: 10 }}>Lo que entra</Rotulo>
            <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 30, lineHeight: 1.05, fontVariationSettings: "var(--fraunces-titulo)" }}>
              {est ? num(est.articulos) : "—"}
            </div>
            <div className="t-menor" style={{ color: "var(--t3)", marginTop: 4 }}>
              de {num(arbol.censado)} censados
            </div>
            {est && est.articulos > 0 && (
              <div style={{ marginTop: "var(--esp-4)", paddingTop: "var(--esp-3)", borderTop: "1px solid var(--borde)" }}>
                <div className="t-menor" style={{ color: "var(--t2)", lineHeight: 1.7 }}>
                  ≈ <strong style={{ fontWeight: 500, color: "var(--t1)" }}>{duracion(est.segundos_cpu)}</strong> de cómputo
                </div>
                <div className="t-menor" style={{ color: "var(--t3)", marginTop: 6, lineHeight: 1.6 }}>
                  Tiempo de máquina, desatendido. Se puede detener y retomar.
                </div>
              </div>
            )}
          </div>

          <div>
            <Rotulo style={{ marginBottom: 10 }}>Artículos para calibrar</Rotulo>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 22, fontVariantNumeric: "tabular-nums" }}>{nCalibrar}</span>
              <span className="t-menor" style={{ color: "var(--t3)" }}>de {est ? num(est.articulos) : "—"}</span>
            </div>
            <input type="range" min={5} max={40} step={1} value={nCalibrar}
              aria-label="Cuántos artículos revisar para calibrar"
              onChange={(e) => setNCalibrar(+e.target.value)}
              style={{ width: "100%", accentColor: "var(--acento)" }} />
            <p className="t-menor" style={{ color: "var(--t3)", margin: "10px 0 0", lineHeight: 1.65 }}>
              Los revisas antes de soltar el extractor sobre el resto. Se reparten entre secciones,
              no se toman en bloque.
            </p>
          </div>

          <Boton onClick={crear} disabled={creando || !est || est.articulos === 0}>
            {creando ? "Creando…" : "Crear el lote y calibrar"}
          </Boton>
          <p className="t-menor" style={{ color: "var(--t3)", margin: "-14px 0 0", lineHeight: 1.6 }}>
            Después: el extractor corre sobre los {nCalibrar} de calibración y tú lo corriges.
          </p>
        </div>
      </div>
    </Lienzo>
  );
}

function Rama({ n, prof, elegidos, abiertos, onAlternar, onAbrir }: {
  n: NodoCategoria; prof: number;
  elegidos: number[]; abiertos: Record<number, boolean>;
  onAlternar: (n: NodoCategoria) => void; onAbrir: (id: number) => void;
}) {
  const marcado = elegidos.includes(n.term_id);
  // Un padre con solo algunos hijos elegidos: ni marcado ni vacío.
  const parcial = !marcado && n.hijos.some((h) => elegidos.includes(h.term_id));
  const abierto = !!abiertos[n.term_id];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: prof * 20 }}>
        <button
          onClick={() => n.hijos.length && onAbrir(n.term_id)}
          style={{ appearance: "none", background: "transparent", border: 0, width: 14, color: "var(--t3)", cursor: n.hijos.length ? "pointer" : "default", fontSize: 10, padding: 0 }}
        >
          {n.hijos.length ? (abierto ? "▾" : "▸") : ""}
        </button>
        <button
          onClick={() => onAlternar(n)}
          style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, appearance: "none", background: "transparent", border: 0, borderRadius: 6, padding: "6px 8px", cursor: "pointer", textAlign: "left", color: "var(--t1)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hundida)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <span style={{
            width: 15, height: 15, borderRadius: 4, display: "grid", placeItems: "center",
            background: marcado ? "var(--acento)" : "transparent",
            border: `1px solid ${marcado || parcial ? "var(--acento)" : "var(--borde-fuerte)"}`,
            color: "var(--bg)", fontSize: 10, flex: "0 0 auto",
          }}>
            {marcado ? "✓" : parcial ? <span style={{ width: 7, height: 2, background: "var(--acento)", display: "block" }} /> : ""}
          </span>
          <span style={{ flex: 1, fontSize: prof === 0 ? 14 : 13, fontWeight: prof === 0 ? 500 : 400 }}>
            {n.nombre}
          </span>
          <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11.5 }}>
            {n.total.toLocaleString("es-CO")}
          </span>
        </button>
      </div>
      {abierto && n.hijos.map((h) => (
        <Rama key={h.term_id} n={h} prof={prof + 1} elegidos={elegidos} abiertos={abiertos}
              onAlternar={onAlternar} onAbrir={onAbrir} />
      ))}
    </>
  );
}

function SelectorAnio({ v, onChange, anios }: {
  v: number | null; onChange: (n: number | null) => void; anios: number[];
}) {
  return (
    <select
      value={v ?? ""}
      onChange={(e) => onChange(e.target.value ? +e.target.value : null)}
      style={{ flex: 1, padding: "7px 9px", background: "var(--hundida)", border: "1px solid var(--borde)", borderRadius: 6, color: "var(--t1)", fontFamily: "var(--font-sans)", fontSize: 13 }}
    >
      <option value="">—</option>
      {anios.map((a) => <option key={a} value={a}>{a}</option>)}
    </select>
  );
}

function etiquetaSeleccion(arbol: ArbolCategorias | null, elegidos: number[]): string {
  if (!arbol) return "Selección";
  const nombres: string[] = [];
  const visitar = (ns: NodoCategoria[]) => {
    for (const n of ns) {
      if (elegidos.includes(n.term_id)) nombres.push(n.nombre);
      else visitar(n.hijos);
    }
  };
  visitar(arbol.raices);
  if (nombres.length === 0) return "Selección";
  return nombres.length <= 2 ? nombres.join(" y ") : `${nombres[0]} y ${nombres.length - 1} más`;
}

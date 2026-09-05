import { useCallback, useEffect, useState } from "react";
import { Barra, Boton, Glifo, Latido, Lienzo, Rotulo } from "../ui";
import {
  alFinMuestra, alProgresoMuestra, descargarMuestra, perfilArchivo,
  planMuestra, proponerEpocas, sortearMuestra,
} from "../lib/ipc";
import type { Diseno, Epoca, PerfilArchivo, Plan, ProgresoCenso, SeccionFila } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
const pct = (n: number) => `${n.toFixed(n < 10 ? 1 : 0).replace(".", ",")} %`;

const nuevaSemilla = () =>
  `legajo-${new Date().getFullYear()}-${Math.random().toString(16).slice(2, 6)}`;

export default function Muestreo({ estado }: { estado: EstadoApp }) {
  const { conexionId, taxonomia } = estado;

  const [epocas, setEpocas] = useState<Epoca[]>([]);
  const [nEpocas, setNEpocas] = useState(4);
  const [n, setN] = useState(400);
  const [semilla, setSemilla] = useState(nuevaSemilla);
  const [equilibrar, setEquilibrar] = useState(true);
  const [excluirSinFecha, setExcluirSinFecha] = useState(true);
  const [excluidos, setExcluidos] = useState<number[]>([]);
  const [perfil, setPerfil] = useState<PerfilArchivo | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bajando, setBajando] = useState<ProgresoCenso | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    if (conexionId == null) return;
    perfilArchivo(conexionId, taxonomia).then(setPerfil).catch(() => {});
    proponerEpocas(conexionId, nEpocas).then((r) => setEpocas(r.epocas)).catch(() => {});
  }, [conexionId, taxonomia, nEpocas]);

  const diseno: Diseno = {
    n, semilla, epocas,
    excluir_terminos: excluidos,
    excluir_sin_fecha: excluirSinFecha,
    taxonomia,
    equilibrar_epocas: equilibrar,
  };

  const recalcular = useCallback(() => {
    if (conexionId == null || epocas.length === 0) return;
    planMuestra(conexionId, diseno).then(setPlan).catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conexionId, n, semilla, JSON.stringify(epocas), JSON.stringify(excluidos), excluirSinFecha, equilibrar, taxonomia]);

  useEffect(() => {
    // Medio segundo, no 120 ms: arrastrar el deslizador encadenaba una consulta
    // por cada paso y la interfaz se quedaba detrás de sí misma.
    const t = setTimeout(recalcular, 500);
    return () => clearTimeout(t);
  }, [recalcular]);

  useEffect(() => {
    const un1 = alProgresoMuestra(setBajando);
    const un2 = alFinMuestra((f) => {
      setBajando(null);
      setError(f.error);
      if (f.ok) setListo(true);
    });
    return () => { un1.then((u) => u()); un2.then((u) => u()); };
  }, []);

  async function sortear() {
    if (conexionId == null) return;
    setError(null);
    try {
      const r = await sortearMuestra(conexionId, diseno, `${n} · ${semilla}`);
      setBajando({ fase: "descarga", ventana: "", hechos: 0, total: r.n });
      await descargarMuestra(conexionId, r.design_id);
    } catch (e) {
      setError(String(e));
      setBajando(null);
    }
  }

  if (!perfil || perfil.censado === 0) {
    return (
      <Lienzo>
        <Rotulo>Paso 4 · Muestreo</Rotulo>
        <p className="t-cuerpo" style={{ color: "var(--t2)", marginTop: 20 }}>
          Hace falta leer el archivo antes de poder muestrear. Vuelve al paso de perfil.
        </p>
      </Lienzo>
    );
  }

  const cuota = plan && plan.universo > 0 ? (plan.asignado / plan.universo) * 100 : 0;
  const grandes: SeccionFila[] = perfil.secciones.slice(0, 14);

  return (
    <Lienzo ancho={940}>
      <Rotulo style={{ marginBottom: 12 }}>Paso 4 · Muestreo</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 14px" }}>
        {plan ? num(plan.asignado) : n} artículos que se parezcan al archivo
      </h1>
      <p className="t-cuerpo" style={{ margin: "0 0 var(--esp-11)", color: "var(--t2)", maxWidth: "58ch" }}>
        La muestra es lo que vas a anotar a mano. Tiene que parecerse al archivo en lo que importa,
        y cualquiera debe poder reconstruirla exactamente a partir de la semilla.
      </p>

      {error && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "12px 15px", background: "var(--error-fondo)", borderRadius: 8, marginBottom: "var(--esp-8)" }}>
          <Glifo estado="error" size={11} />
          <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.6 }}>{error}</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 330px) 1fr", gap: "var(--esp-11)", alignItems: "start" }}>
        {/* ── Controles ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-8)" }}>
          <div>
            <Rotulo style={{ marginBottom: 10 }}>Tamaño de la muestra</Rotulo>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
              <span style={{ fontFamily: "var(--font-serif-display)", fontSize: 32, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n}</span>
              <span className="t-menor" style={{ color: "var(--t3)" }}>
                de {num(plan?.universo ?? perfil.censado)} · {pct(cuota)}
              </span>
            </div>
            <input type="range" min={100} max={1500} step={25} value={n}
              onChange={(e) => setN(+e.target.value)}
              style={{ width: "100%", accentColor: "var(--acento)" }} />
          </div>

          <div>
            <Rotulo style={{ marginBottom: 10 }}>Épocas</Rotulo>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              {[2, 3, 4, 5].map((k) => (
                <button key={k} onClick={() => setNEpocas(k)}
                  style={{ flex: 1, appearance: "none", cursor: "pointer", borderRadius: 6, padding: "6px 0", fontSize: 13, fontFamily: "var(--font-sans)",
                    background: nEpocas === k ? "var(--acento-suave)" : "transparent",
                    border: `1px solid ${nEpocas === k ? "var(--acento)" : "var(--borde)"}`,
                    color: nEpocas === k ? "var(--t1)" : "var(--t2)" }}>
                  {k}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {epocas.map((e) => (
                <span key={e.etiqueta} className="t-mono" style={{ color: "var(--t2)", background: "var(--hundida)", padding: "3px 8px", borderRadius: 5 }}>
                  {e.etiqueta}
                </span>
              ))}
            </div>
            <p className="t-menor" style={{ color: "var(--t3)", margin: "10px 0 0", lineHeight: 1.6 }}>
              Cortadas por volumen, no por década: un archivo que cuadruplica su producción dejaría
              la época fundacional sin muestra utilizable.
            </p>
          </div>

          <Casilla on={equilibrar} onClick={() => setEquilibrar(!equilibrar)}
            nota="Reparte igual entre épocas en vez de proporcional. Es lo que permite comparar si el método se degrada con el material viejo.">
            Equilibrar entre épocas
          </Casilla>

          {perfil.sin_fecha > 0 && (
            <Casilla on={excluirSinFecha} onClick={() => setExcluirSinFecha(!excluirSinFecha)}
              nota={`${num(perfil.sin_fecha)} artículos con fecha dañada no caen en ninguna época.`}>
              Excluir los que no tienen fecha
            </Casilla>
          )}

          <div>
            <Rotulo style={{ marginBottom: 10 }}>Semilla reproducible</Rotulo>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="t-mono" style={{ color: "var(--t1)", background: "var(--hundida)", padding: "6px 10px", borderRadius: 6 }}>{semilla}</span>
              <Boton variante="enlace" onClick={() => setSemilla(nuevaSemilla())}>otra</Boton>
            </div>
            <p className="t-menor" style={{ color: "var(--t3)", margin: "10px 0 0", lineHeight: 1.6 }}>
              Guárdala. Sin ella el sorteo no es reproducible y el diagnóstico deja de valer como
              evidencia frente a un tercero.
            </p>
          </div>
        </div>

        {/* ── Plan ── */}
        <div>
          {perfil.secciones.length > 0 && (
            <div style={{ marginBottom: "var(--esp-8)" }}>
              <Rotulo style={{ marginBottom: 10 }}>Secciones del universo</Rotulo>
              <p className="t-menor" style={{ color: "var(--t3)", margin: "0 0 12px", lineHeight: 1.6 }}>
                Pulsa para excluir una del muestreo.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {grandes.map((s) => {
                  const fuera = excluidos.includes(s.term_id);
                  return (
                    <button key={s.term_id}
                      onClick={() => setExcluidos(fuera ? excluidos.filter((x) => x !== s.term_id) : [...excluidos, s.term_id])}
                      style={{ appearance: "none", cursor: "pointer", borderRadius: 999, padding: "4px 11px", fontSize: 12, fontFamily: "var(--font-sans)",
                        background: "transparent", border: `1px solid ${fuera ? "var(--borde)" : "var(--borde-fuerte)"}`,
                        color: fuera ? "var(--t3)" : "var(--t1)",
                        textDecoration: fuera ? "line-through" : "none" }}>
                      {s.nombre} <span style={{ color: "var(--t3)" }}>{num(s.n)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {plan && (
            <>
              <div style={{ display: "flex", gap: 18, marginBottom: "var(--esp-6)" }}>
                <Leyenda color="var(--borde-fuerte)">Archivo</Leyenda>
                <Leyenda color="var(--acento)">Muestra</Leyenda>
              </div>
              <TablaSesgo titulo="Por época" filas={plan.sesgo_epoca} />
              <TablaSesgo titulo="Por sección" filas={plan.sesgo_seccion.slice(0, 10)} />

              {plan.avisos.length > 0 && (
                <ul style={{ listStyle: "none", padding: 0, margin: "var(--esp-6) 0 0", display: "flex", flexDirection: "column", gap: 9 }}>
                  {plan.avisos.map((a) => (
                    <li key={a} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <Glifo estado="advertencia" size={11} />
                      <span className="t-menor" style={{ color: "var(--t2)", lineHeight: 1.65 }}>{a}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="t-menor" style={{ color: "var(--t3)", marginTop: "var(--esp-6)", lineHeight: 1.7, maxWidth: "56ch" }}>
                {plan.celdas.length} celdas de época × sección. Con esta muestra hay potencia para
                estimar por época y por sección por separado, pero no para afirmar nada sobre una
                celda concreta.
              </p>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: "var(--esp-11)", paddingTop: "var(--esp-6)", borderTop: "1px solid var(--borde)" }}>
        {bajando ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Latido />
              <span className="t-ui">Descargando el cuerpo de los artículos sorteados</span>
              <div style={{ flex: 1 }} />
              <span className="t-mono" style={{ color: "var(--t3)" }}>{bajando.hechos}/{bajando.total}</span>
            </div>
            <Barra pct={bajando.total ? (bajando.hechos / bajando.total) * 100 : 0} alto={4} />
            <p className="t-menor" style={{ color: "var(--t3)", marginTop: 12, maxWidth: "56ch", lineHeight: 1.7 }}>
              Es el único momento en que Legajo baja artículos completos, y solo los de la muestra.
              El archivo entero se recorrió leyendo metadatos.
            </p>
          </>
        ) : listo ? (
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Boton onClick={() => estado.avanzar(4, "anotacion")}>Empezar a anotar</Boton>
            <span className="t-menor" style={{ color: "var(--exito)" }}>✓ Muestra sorteada y descargada</span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Boton onClick={sortear} disabled={!plan || plan.asignado === 0}>
              Sortear y descargar
            </Boton>
            <span className="t-menor" style={{ color: "var(--t3)" }}>
              El sorteo queda guardado con su semilla y su diseño.
            </span>
          </div>
        )}
      </div>
    </Lienzo>
  );
}

function TablaSesgo({ titulo, filas }: { titulo: string; filas: { etiqueta: string; archivo_pct: number; muestra_pct: number }[] }) {
  if (filas.length === 0) return null;
  const max = Math.max(...filas.flatMap((f) => [f.archivo_pct, f.muestra_pct]), 1);
  return (
    <div style={{ marginBottom: "var(--esp-8)" }}>
      <Rotulo style={{ marginBottom: 12 }}>{titulo}</Rotulo>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filas.map((f) => {
          const d = f.muestra_pct - f.archivo_pct;
          const alerta = Math.abs(d) >= 5;
          return (
            <div key={f.etiqueta} style={{ display: "grid", gridTemplateColumns: "minmax(90px,150px) 1fr 56px", alignItems: "center", gap: 12 }}>
              <span className="t-menor" style={{ color: "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.etiqueta}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ height: 5, width: `${(f.archivo_pct / max) * 100}%`, background: "var(--borde-fuerte)", borderRadius: 999 }} />
                <div style={{ height: 5, width: `${(f.muestra_pct / max) * 100}%`, background: "var(--acento)", borderRadius: 999 }} />
              </div>
              <span className="t-mono" style={{ textAlign: "right", color: alerta ? "var(--advertencia)" : "var(--t3)" }}>
                {d > 0 ? "+" : d < 0 ? "−" : ""}{Math.abs(d).toFixed(0)} pt
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Casilla({ on, onClick, nota, children }: { on: boolean; onClick: () => void; nota: string; children: React.ReactNode }) {
  return (
    <div>
      <button onClick={onClick}
        style={{ display: "flex", alignItems: "center", gap: 10, appearance: "none", background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", fontSize: 13.5, color: on ? "var(--t1)" : "var(--t2)" }}>
        <span style={{ width: 15, height: 15, borderRadius: 4, display: "grid", placeItems: "center", background: on ? "var(--acento)" : "transparent", border: `1px solid ${on ? "var(--acento)" : "var(--borde-fuerte)"}`, color: "var(--bg)", fontSize: 10, flex: "0 0 auto" }}>
          {on ? "✓" : ""}
        </span>
        {children}
      </button>
      <p className="t-menor" style={{ color: "var(--t3)", margin: "8px 0 0 25px", lineHeight: 1.6 }}>{nota}</p>
    </div>
  );
}

function Leyenda({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--t3)" }}>
      <span style={{ width: 14, height: 4, borderRadius: 999, background: color, display: "block" }} />
      {children}
    </span>
  );
}

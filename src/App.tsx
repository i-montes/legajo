import { useCallback, useEffect, useMemo, useState } from "react";
import { AYUDA, type Paso } from "./contenido/ayuda";
import Conexion from "./screens/Conexion";
import Perfil from "./screens/Perfil";
import Sanidad from "./screens/Sanidad";
import Muestreo from "./screens/Muestreo";
import Anotacion from "./screens/Anotacion";
import Extraccion from "./screens/Extraccion";
import Resolucion from "./screens/Resolucion";
import Reporte from "./screens/Reporte";
import Fundamentos from "./screens/Fundamentos";
import { cargarSesion, guardarSesion, olvidarSesion } from "./lib/ipc";
import type { Discovery, SesionRecuperada } from "./types";

const PASOS: [Paso, string, string][] = [
  ["conexion", "01", "Conexión"],
  ["perfil", "02", "Perfil"],
  ["sanidad", "03", "Sanidad"],
  ["muestreo", "04", "Muestreo"],
  ["anotacion", "05", "Anotación"],
  ["extraccion", "06", "Extracción"],
  ["resolucion", "07", "Resolución"],
  ["reporte", "08", "Reporte"],
];

/* Durante los tres primeros pasos la app se presenta sin cromo: son pantallas
   de entrada, y una barra de navegación con seis pasos bloqueados desanima
   antes de empezar. El cromo aparece cuando ya hay un archivo conectado. */
const SIN_CROMO: Paso[] = ["conexion", "perfil", "sanidad"];

export interface EstadoApp {
  sitio: Discovery | null;
  conexionId: number | null;
  taxonomia: string | null;
  progreso: number;
  avanzar: (hasta: number, siguiente: Paso) => void;
  setTaxonomia: (t: string) => void;
}

export default function App() {
  const [tema, setTema] = useState<"claro" | "oscuro">("claro");
  const [paso, setPaso] = useState<Paso>("conexion");
  const [progreso, setProgreso] = useState(0);
  const [sitio, setSitio] = useState<Discovery | null>(null);
  const [conexionId, setConexionId] = useState<number | null>(null);
  const [taxonomia, setTaxonomia] = useState<string | null>(null);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(true);
  const [sesionPrevia, setSesionPrevia] = useState<SesionRecuperada | null>(null);

  /* Se recupera dónde quedó la sesión anterior. El trabajo ya estaba a salvo en
     la base; lo que faltaba era volver a él sin repetir la conexión, el censo y
     la navegación cada vez que se cierra la ventana. */
  useEffect(() => {
    cargarSesion()
      .then((s) => {
        if (s && s.sitio && s.connection_id != null) {
          setSesionPrevia(s);
          setSitio(s.sitio);
          setConexionId(s.connection_id);
          setTaxonomia(s.taxonomia);
          setProgreso(s.progreso);
          setPaso(s.paso as Paso);
        }
      })
      .catch(() => {})
      .finally(() => setRestaurando(false));
  }, []);

  // Cada movimiento se anota. Es una fila; no hace falta esperar a nada.
  useEffect(() => {
    if (restaurando) return;
    guardarSesion(conexionId, paso, progreso, taxonomia, null).catch(() => {});
  }, [restaurando, conexionId, paso, progreso, taxonomia]);

  useEffect(() => {
    document.documentElement.setAttribute("data-tema", tema);
  }, [tema]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAyudaAbierta(false);
      if (e.key === "?" && !(e.target as HTMLElement)?.closest("input,textarea")) {
        setAyudaAbierta((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const avanzar = useCallback((hasta: number, siguiente: Paso) => {
    setProgreso((p) => Math.max(p, hasta));
    setPaso(siguiente);
    setAviso(null);
  }, []);

  const estado: EstadoApp = useMemo(
    () => ({ sitio, conexionId, taxonomia, progreso, avanzar, setTaxonomia }),
    [sitio, conexionId, taxonomia, progreso, avanzar]
  );

  const conCromo = !SIN_CROMO.includes(paso);
  const ayuda = paso === "fundamentos" ? null : AYUDA[paso];

  const nombreSitio = sitio
    ? `${sitio.resolved_origin.replace(/^https?:\/\//, "")}${sitio.site_name ? " — " + sitio.site_name : ""}`
    : "sin archivo conectado";

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--t1)", overflow: "hidden" }}>
      {conCromo && (
        <header style={{ flex: "0 0 auto", height: 38, display: "flex", alignItems: "center", gap: 16, padding: "0 14px", background: "var(--superficie)", borderBottom: "1px solid var(--borde)", userSelect: "none" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontFamily: "var(--font-serif-display)", fontSize: 16, letterSpacing: ".2px" }}>Legajo</span>
            <span style={{ fontSize: 12, color: "var(--t3)" }}>{nombreSitio}</span>
          </div>
          <div style={{ flex: 1 }} />
          <div
            title="Todo el procesamiento ocurre en este computador. Legajo no envía texto del archivo a ningún servidor."
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--t2)", letterSpacing: ".2px" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--exito)", display: "block" }} />
            Procesamiento local
          </div>
          <BotonTema tema={tema} onClick={() => setTema(tema === "claro" ? "oscuro" : "claro")} borde />
        </header>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {conCromo && (
          <nav style={{ flex: "0 0 232px", display: "flex", flexDirection: "column", padding: "26px 14px 16px", background: "var(--superficie)", borderRight: "1px solid var(--borde)", minHeight: 0 }}>
            <div className="t-rotulo" style={{ padding: "0 10px 14px" }}>Diagnóstico</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {PASOS.map(([k, num, etiqueta], i) => {
                const estadoPaso = i < progreso ? "completo" : i === progreso ? "curso" : "pendiente";
                const bloqueado = i > progreso;
                const activo = paso === k;
                return (
                  <button
                    key={k}
                    onClick={() =>
                      bloqueado
                        ? setAviso(`El paso ${num} se abre cuando completes «${PASOS[progreso][2]}».`)
                        : (setPaso(k), setAviso(null))
                    }
                    style={{
                      display: "grid", gridTemplateColumns: "14px 16px 1fr", alignItems: "center", gap: 9,
                      textAlign: "left", appearance: "none", border: 0, borderRadius: 6, cursor: "pointer",
                      padding: "8px 10px", fontSize: 13.5,
                      background: activo ? "var(--hundida)" : "transparent",
                      color: bloqueado ? "var(--t3)" : activo ? "var(--t1)" : "var(--t2)",
                      fontWeight: activo ? 500 : 400,
                    }}
                    onMouseEnter={(e) => { if (!activo) e.currentTarget.style.background = "var(--hundida)"; }}
                    onMouseLeave={(e) => { if (!activo) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span aria-hidden style={{ fontSize: 10, textAlign: "center", color: estadoPaso === "completo" ? "var(--exito)" : estadoPaso === "curso" ? "var(--acento)" : "var(--t3)" }}>
                      {estadoPaso === "completo" ? "✓" : estadoPaso === "curso" ? "●" : "○"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{num}</span>
                    <span>{etiqueta}</span>
                  </button>
                );
              })}
            </div>
            {aviso && (
              <div style={{ margin: "14px 10px 0", fontSize: 12, lineHeight: 1.55, color: "var(--t3)" }}>{aviso}</div>
            )}
            {sesionPrevia && sesionPrevia.paso !== paso && (
              <button
                onClick={() => { setPaso(sesionPrevia.paso as Paso); setAviso(null); }}
                style={{ margin: "16px 6px 0", appearance: "none", background: "var(--acento-suave)", border: "1px solid var(--acento)", borderRadius: 8, padding: "9px 11px", textAlign: "left", cursor: "pointer", color: "var(--t1)" }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Volver donde ibas</div>
                <div style={{ fontSize: 11.5, color: "var(--t2)", marginTop: 3 }}>
                  {nombrePaso(sesionPrevia.paso)}
                </div>
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setPaso("fundamentos")}
              style={{ appearance: "none", border: 0, background: "transparent", textAlign: "left", padding: "8px 10px", fontSize: 12.5, color: "var(--t3)", cursor: "pointer", borderTop: "1px solid var(--borde)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t1)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t3)")}
            >
              Fundamentos del sistema
            </button>
            <button
              onClick={() => {
                // Solo se olvida por dónde ibas: el censo, la muestra, las
                // anotaciones y los tiempos siguen donde estaban.
                olvidarSesion().catch(() => {});
                setSitio(null); setConexionId(null); setTaxonomia(null);
                setProgreso(0); setPaso("conexion"); setAviso(null);
              }}
              style={{ appearance: "none", border: 0, background: "transparent", textAlign: "left", padding: "8px 10px", fontSize: 12.5, color: "var(--t3)", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t1)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t3)")}
            >
              Conectar otro archivo
            </button>
          </nav>
        )}

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
          {!conCromo && (
            <div style={{ position: "absolute", top: 16, right: 20, zIndex: 30, display: "flex", gap: 8, alignItems: "center" }}>
              <BotonTema tema={tema} onClick={() => setTema(tema === "claro" ? "oscuro" : "claro")} />
              <button
                onClick={() => setAyudaAbierta(true)}
                title="Qué es este paso"
                style={{ appearance: "none", background: "transparent", border: "1px solid var(--borde)", borderRadius: 999, width: 28, height: 28, fontSize: 13, color: "var(--t2)", cursor: "pointer" }}
              >
                ?
              </button>
            </div>
          )}

          {ayudaAbierta && ayuda && (
            <div
              onClick={() => setAyudaAbierta(false)}
              style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,.12)" }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ width: 400, maxWidth: "88%", height: "100%", overflow: "auto", background: "var(--elevada)", borderLeft: "1px solid var(--borde)", padding: "28px 28px 40px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginBottom: 22 }}>
                  <span className="t-rotulo">{ayuda.paso}</span>
                  <button onClick={() => setAyudaAbierta(false)} style={{ appearance: "none", background: "transparent", border: 0, padding: 0, fontSize: 13, color: "var(--t3)", cursor: "pointer" }}>
                    cerrar
                  </button>
                </div>
                <h2 style={{ fontFamily: "var(--font-serif-display)", fontWeight: 600, fontVariationSettings: "var(--fraunces-titulo)", fontSize: 26, lineHeight: 1.2, margin: "0 0 26px" }}>{ayuda.titulo}</h2>
                <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                  <Seccion titulo="Qué es"><p style={parrafo}>{ayuda.que}</p></Seccion>
                  <Seccion titulo="Qué se espera conseguir"><p style={parrafo}>{ayuda.meta}</p></Seccion>
                  <Seccion titulo="Cómo hacerlo">
                    <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 10 }}>
                      {ayuda.como.map((c) => (
                        <li key={c} style={{ fontSize: 14, lineHeight: 1.7 }}>{c}</li>
                      ))}
                    </ol>
                  </Seccion>
                  {ayuda.reglas && (
                    <Seccion titulo="Reglas de marcado">
                      <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.7, color: "var(--t2)" }}>
                        Salieron de anotar artículos reales. Están escritas porque la doble
                        anotación solo mide criterio si las dos personas siguen las mismas.
                      </p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                        {ayuda.reglas.map((r) => (
                          <div key={r.titulo}>
                            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{r.titulo}</div>
                            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: "var(--t2)" }}>{r.texto}</p>
                          </div>
                        ))}
                      </div>
                    </Seccion>
                  )}
                </div>
              </div>
            </div>
          )}

          {paso === "conexion" && (
            <Conexion
              estado={estado}
              onConectado={(d, id) => {
                setSitio(d);
                setConexionId(id);
                // Se elige de entrada la taxonomía jerárquica más poblada: es la
                // que en un medio hace de secciones. El usuario puede cambiarla.
                const jer = d.capabilities.taxonomies.filter((t) => t.hierarchical);
                setTaxonomia((jer[0] ?? d.capabilities.taxonomies[0])?.rest_base ?? null);
              }}
              onAyuda={() => setAyudaAbierta(true)}
            />
          )}
          {paso === "perfil" && <Perfil estado={estado} />}
          {paso === "sanidad" && <Sanidad estado={estado} />}
          {paso === "muestreo" && <Muestreo estado={estado} />}
          {paso === "anotacion" && <Anotacion estado={estado} />}
          {paso === "extraccion" && <Extraccion estado={estado} />}
          {paso === "resolucion" && <Resolucion estado={estado} />}
          {paso === "reporte" && <Reporte estado={estado} />}
          {paso === "fundamentos" && <Fundamentos />}
        </main>
      </div>
    </div>
  );
}

const parrafo = { margin: 0, fontSize: 15, lineHeight: 1.75, color: "var(--t1)" } as const;

const nombrePaso = (k: string) => {
  const p = PASOS.find(([clave]) => clave === k);
  return p ? `Paso ${p[1]} · ${p[2]}` : k;
};

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-rotulo" style={{ letterSpacing: "1.2px", marginBottom: 9 }}>{titulo}</div>
      {children}
    </div>
  );
}

function BotonTema({ tema, onClick, borde }: { tema: string; onClick: () => void; borde?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: "none", background: "transparent",
        border: borde ? "1px solid var(--borde)" : 0,
        borderRadius: 6, color: borde ? "var(--t2)" : "var(--t3)",
        fontSize: borde ? 11.5 : 12, padding: borde ? "4px 10px" : "6px 10px", cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t1)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = borde ? "var(--t2)" : "var(--t3)")}
    >
      {tema === "claro" ? "Modo oscuro" : "Modo claro"}
    </button>
  );
}

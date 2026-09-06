import { useCallback, useEffect, useState } from "react";
import { Barra, Boton, Glifo, Latido, Lienzo, Rotulo } from "../ui";
import { TIPOS, colorTipo } from "../contenido/tipos";
import {
  alFinExtraccion, alProgresoExtraccion, aplicarCalibracion, avanceExtraccion,
  calibrar, cancelarExtraccion, catalogoModelos, iniciarExtraccion,
} from "../lib/ipc";
import type { CatalogoModelos, Modelos, ProgresoExtraccion, ResultadoCalibracion } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
const dec = (n: number, d = 2) => n.toFixed(d).replace(".", ",");
const etiquetaTipo = (k: string) => TIPOS.find((t) => t.k === k)?.etiqueta ?? k;

type Fase = "elegir" | "extrayendo" | "revisar" | "resultado";

export default function Calibracion({ estado }: { estado: EstadoApp }) {
  const { loteId } = estado;
  const [fase, setFase] = useState<Fase>("elegir");
  const [catalogo, setCatalogo] = useState<CatalogoModelos | null>(null);
  const [modelos, setModelos] = useState<Modelos>({
    gliner: "urchade/gliner_multi-v2.1",
    spacy: "es_core_news_sm",
    glirel: "jackboyla/glirel-large-v0",
    relaciones: true,
  });
  const [prog, setProg] = useState<ProgresoExtraccion | null>(null);
  const [hechos, setHechos] = useState(0);
  const [res, setRes] = useState<ResultadoCalibracion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aplicada, setAplicada] = useState(false);

  useEffect(() => { catalogoModelos().then(setCatalogo).catch(() => {}); }, []);

  useEffect(() => {
    if (loteId == null) return;
    avanceExtraccion(loteId).then(([h]) => {
      setHechos(h);
      if (h > 0) setFase("revisar");
    }).catch(() => {});
  }, [loteId]);

  useEffect(() => {
    const un1 = alProgresoExtraccion((p) => {
      setProg(p);
      if (p.fase === "extrayendo") setHechos(p.hechos);
    });
    const un2 = alFinExtraccion((f) => {
      setProg(null);
      setError(f.error);
      if (f.ok) setFase("revisar");
      else setFase("elegir");
    });
    return () => { un1.then((u) => u()); un2.then((u) => u()); };
  }, []);

  async function extraer() {
    if (loteId == null) return;
    setError(null);
    setFase("extrayendo");
    try {
      await iniciarExtraccion(loteId, modelos, true);
    } catch (e) {
      setError(String(e));
      setFase("elegir");
    }
  }

  const calcular = useCallback(async () => {
    if (loteId == null) return;
    try {
      setRes(await calibrar(loteId));
      setFase("resultado");
    } catch (e) {
      setError(String(e));
    }
  }, [loteId]);

  async function aplicar() {
    if (loteId == null || !res) return;
    await aplicarCalibracion(loteId, res.calibracion).catch((e) => setError(String(e)));
    setAplicada(true);
  }

  if (loteId == null) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 5 · Calibración</Rotulo>
        <h1 className="t-display" style={{ margin: "0 0 14px" }}>Falta elegir el alcance</h1>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-8)", maxWidth: "50ch" }}>
          La calibración corre sobre un lote. Vuelve al paso anterior y crea uno.
        </p>
        <Boton onClick={() => estado.avanzar(3, "alcance")}>Ir al alcance</Boton>
      </Lienzo>
    );
  }

  return (
    <Lienzo ancho={880}>
      <Rotulo style={{ marginBottom: 12 }}>Paso 5 · Calibración</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 14px" }}>
        Enseñarle al extractor qué está haciendo mal
      </h1>
      <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-11)", maxWidth: "60ch" }}>
        Antes de soltarlo sobre miles de artículos, corre sobre un puñado y tú corriges. Con esas
        correcciones se recalcula el corte de confianza de cada tipo y se aprende qué no debe
        proponer. Es aritmética sobre las puntuaciones ya guardadas, así que el efecto se ve al
        instante y sin volver a pasar el modelo.
      </p>

      {error && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "12px 15px", background: "var(--error-fondo)", borderRadius: 8, marginBottom: "var(--esp-8)" }}>
          <Glifo estado="error" size={11} />
          <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{error}</span>
        </div>
      )}

      {fase === "elegir" && catalogo && (
        <>
          <Rotulo style={{ marginBottom: 14 }}>Modelos</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-6)", marginBottom: "var(--esp-11)" }}>
            <Familia titulo="Entidades · GLiNER" opciones={catalogo.gliner}
              valor={modelos.gliner} onChange={(v) => setModelos({ ...modelos, gliner: v })} />
            <Familia titulo="Segmentación · spaCy" opciones={catalogo.spacy}
              valor={modelos.spacy} onChange={(v) => setModelos({ ...modelos, spacy: v })}
              nota="Parte el texto en oraciones antes de pasárselo a GLiNER, y alinea las entidades a límites de token para que GLiREL pueda leerlas." />
            <div>
              <button
                onClick={() => setModelos({ ...modelos, relaciones: !modelos.relaciones })}
                style={{ display: "flex", alignItems: "center", gap: 10, appearance: "none", background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: "var(--t1)" }}
              >
                <span style={{ width: 15, height: 15, borderRadius: 4, display: "grid", placeItems: "center", background: modelos.relaciones ? "var(--acento)" : "transparent", border: `1px solid ${modelos.relaciones ? "var(--acento)" : "var(--borde-fuerte)"}`, color: "var(--bg)", fontSize: 10 }}>
                  {modelos.relaciones ? "✓" : ""}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Extraer también relaciones · GLiREL</span>
              </button>
              <p className="t-menor" style={{ color: "var(--t3)", margin: "8px 0 0 25px", lineHeight: 1.65, maxWidth: "56ch" }}>
                Casi duplica el tiempo por artículo. Sin esto tendrás entidades pero no un grafo:
                solo un índice de nombres.
              </p>
            </div>
          </div>
          <Boton onClick={extraer}>Extraer sobre los artículos de calibración</Boton>
        </>
      )}

      {fase === "extrayendo" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <Latido />
            <div>
              <div className="t-ui">
                {prog?.fase === "descargando" && "Descargando el cuerpo de los artículos"}
                {prog?.fase === "arrancando" && "Arrancando el extractor"}
                {prog?.fase === "cargando" && "Cargando los modelos"}
                {prog?.fase === "cargado" && "Modelos listos"}
                {prog?.fase === "extrayendo" && `Extrayendo · artículo #${prog.wp_id}`}
                {!prog && "Preparando"}
              </div>
              {prog?.fase === "cargando" && (
                <div className="t-menor" style={{ color: "var(--t3)", marginTop: 4, maxWidth: "52ch", lineHeight: 1.6 }}>
                  La primera vez se descargan (unos 500 MB entre los tres). Después quedan en caché.
                </div>
              )}
              {prog?.detalle && prog.fase === "cargado" && (
                <div className="t-menor" style={{ color: "var(--advertencia)", marginTop: 4 }}>{prog.detalle}</div>
              )}
            </div>
            <div style={{ flex: 1 }} />
            {prog && prog.total > 0 && (
              <span className="t-mono" style={{ color: "var(--t3)" }}>{prog.hechos}/{prog.total}</span>
            )}
          </div>
          <Barra pct={prog && prog.total ? (prog.hechos / prog.total) * 100 : 0} alto={4} />
          <div style={{ marginTop: 16 }}>
            <Boton variante="secundario" onClick={() => cancelarExtraccion()}>Detener</Boton>
          </div>
        </div>
      )}

      {fase === "revisar" && (
        <div>
          <div style={{ padding: "var(--esp-6)", background: "var(--acento-suave)", border: "1px solid var(--acento)", borderRadius: 10, marginBottom: "var(--esp-8)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
              <Glifo estado="exito" size={11} />
              <span style={{ fontSize: 15, fontWeight: 500 }}>
                {num(hechos)} artículos extraídos. Ahora te toca a ti.
              </span>
            </div>
            <p className="t-cuerpo" style={{ color: "var(--t2)", margin: 0, maxWidth: "58ch" }}>
              Ve al paso de revisión, corrige lo que el extractor propuso —borra lo que sobra, añade
              lo que falta— y vuelve aquí. Con quince artículos revisados ya hay señal suficiente.
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Boton onClick={() => estado.avanzar(5, "revision")}>Ir a revisar</Boton>
            <Boton variante="secundario" onClick={calcular}>Ya revisé · calcular la calibración</Boton>
          </div>
        </div>
      )}

      {fase === "resultado" && res && (
        <div>
          {res.articulos === 0 ? (
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "13px 16px", background: "var(--advertencia-fondo)", borderRadius: 10 }}>
              <Glifo estado="advertencia" size={11} />
              <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65, maxWidth: "58ch" }}>
                No hay artículos revisados todavía. La calibración necesita que cierres al menos unos
                cuantos en el paso de revisión: sin correcciones no hay nada de lo que aprender.
              </span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "var(--esp-11)", flexWrap: "wrap", marginBottom: "var(--esp-8)" }}>
                <Cifra v={dec(res.antes_f1)} pie="F1 antes" />
                <Cifra v={dec(res.despues_f1)} pie="F1 con la calibración" destacada />
                <Cifra v={String(res.articulos)} pie="artículos revisados" />
              </div>

              <Rotulo style={{ marginBottom: 12 }}>Qué cambia en cada tipo</Rotulo>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "var(--esp-8)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 54px 54px 60px", gap: 12 }}>
                  {["", "", "antes", "después", "corte"].map((h, i) => (
                    <span key={i} className="t-menor" style={{ color: "var(--t3)", textAlign: i > 1 ? "right" : "left" }}>{h}</span>
                  ))}
                </div>
                {res.por_tipo.map((t) => {
                  const mejora = t.despues_f1 - t.antes_f1;
                  return (
                    <div key={t.tipo} style={{ display: "grid", gridTemplateColumns: "140px 1fr 54px 54px 60px", alignItems: "center", gap: 12 }}>
                      <span className="t-menor" style={{ color: "var(--t2)" }}>{etiquetaTipo(t.tipo)}</span>
                      <div style={{ height: 6, background: "var(--hundida)", borderRadius: 999, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", inset: 0, width: `${t.despues_f1 * 100}%`, background: colorTipo(t.tipo), opacity: 0.35, borderRadius: 999 }} />
                        <div style={{ position: "absolute", inset: 0, width: `${t.antes_f1 * 100}%`, background: colorTipo(t.tipo), borderRadius: 999 }} />
                      </div>
                      <span className="t-mono" style={{ textAlign: "right", color: "var(--t3)" }}>{dec(t.antes_f1)}</span>
                      <span className="t-mono" style={{ textAlign: "right", color: mejora > 0.01 ? "var(--exito)" : "var(--t2)" }}>{dec(t.despues_f1)}</span>
                      <span className="t-mono" style={{ textAlign: "right", color: "var(--t3)" }}>{dec(t.umbral, 2)}</span>
                    </div>
                  );
                })}
              </div>

              {res.rechazos_frecuentes.length > 0 && (
                <div style={{ marginBottom: "var(--esp-8)" }}>
                  <Rotulo style={{ marginBottom: 10 }}>
                    Dejará de proponer esto ({res.calibracion.bloqueadas.length})
                  </Rotulo>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {res.rechazos_frecuentes.slice(0, 16).map(([tipo, texto, n], i) => (
                      <span key={i} className="t-menor" style={{ border: "1px solid var(--borde)", borderRadius: 999, padding: "3px 10px", color: "var(--t2)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(tipo), display: "inline-block", marginRight: 6 }} />
                        {texto} <span style={{ color: "var(--t3)" }}>×{n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {res.calibracion.diccionario.length > 0 && (
                <p className="t-menor" style={{ color: "var(--t3)", marginBottom: "var(--esp-8)", lineHeight: 1.7, maxWidth: "60ch" }}>
                  Y {res.calibracion.diccionario.length} entidades que marcaste y el modelo no vio
                  pasan al diccionario: se marcarán siempre que aparezcan. Es la parte de tu trabajo
                  que sobrevive al modelo que acabes usando.
                </p>
              )}

              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <Boton onClick={aplicar} disabled={aplicada}>
                  {aplicada ? "Calibración aplicada" : "Aplicar al lote"}
                </Boton>
                {aplicada && (
                  <Boton variante="secundario" onClick={() => estado.avanzar(6, "extraccion")}>
                    Extraer sobre el resto del lote
                  </Boton>
                )}
                <Boton variante="enlace" onClick={() => setFase("revisar")}>revisar más artículos</Boton>
              </div>
            </>
          )}
        </div>
      )}
    </Lienzo>
  );
}

function Cifra({ v, pie, destacada }: { v: string; pie: string; destacada?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 36, lineHeight: 1.05, fontVariationSettings: "var(--fraunces-titulo)", color: destacada ? "var(--exito)" : "var(--t1)" }}>{v}</div>
      <div className="t-menor" style={{ color: "var(--t3)", marginTop: 5, maxWidth: "18ch" }}>{pie}</div>
    </div>
  );
}

function Familia({ titulo, opciones, valor, onChange, nota }: {
  titulo: string;
  opciones: { id: string; nombre: string; nota: string }[];
  valor: string; onChange: (v: string) => void; nota?: string;
}) {
  return (
    <div>
      <Rotulo style={{ marginBottom: 8 }}>{titulo}</Rotulo>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {opciones.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              display: "flex", gap: 10, alignItems: "baseline", appearance: "none",
              background: valor === o.id ? "var(--acento-suave)" : "transparent",
              border: `1px solid ${valor === o.id ? "var(--acento)" : "transparent"}`,
              borderRadius: 8, padding: "9px 11px", cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 999, border: `1px solid ${valor === o.id ? "var(--acento)" : "var(--borde-fuerte)"}`, background: valor === o.id ? "var(--acento)" : "transparent", flex: "0 0 auto", marginTop: 3 }} />
            <span style={{ flex: 1 }}>
              <span style={{ fontSize: 13.5, color: "var(--t1)", display: "block" }}>{o.nombre}</span>
              <span className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.55 }}>{o.nota}</span>
            </span>
          </button>
        ))}
      </div>
      {nota && (
        <p className="t-menor" style={{ color: "var(--t3)", margin: "8px 0 0 11px", lineHeight: 1.6, maxWidth: "56ch" }}>{nota}</p>
      )}
    </div>
  );
}

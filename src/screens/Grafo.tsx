import { useEffect, useState } from "react";
import { Boton, Encabezado, Glifo, Lienzo, Rotulo } from "../ui";
import { TIPOS, colorTipo } from "../contenido/tipos";
import { decidirPar, deshacerResolucion, grafoDuplicados, grafoEntidades, grafoEvidencia, grafoRelaciones, grafoResumen, grafoSinNombrar, resolucionesDelLote } from "../lib/ipc";
import type { AristaGrafo, Caso, Evidencia, NodoGrafo, Resolucion, ResumenGrafo, SinNombrar } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export default function Grafo({ estado }: { estado: EstadoApp }) {
  const { loteId } = estado;
  const [res, setRes] = useState<ResumenGrafo | null>(null);
  const [ents, setEnts] = useState<NodoGrafo[]>([]);
  const [rels, setRels] = useState<AristaGrafo[]>([]);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [dobles, setDobles] = useState<Caso[]>([]);
  const [anonimas, setAnonimas] = useState<SinNombrar[]>([]);
  /* Lo decidido sobre pares de nombres, por quien sea: se enseña porque el
     grafo lo funde, y lo que se funde sin que se vea es un error escondido. */
  const [decididas, setDecididas] = useState<Resolucion[]>([]);
  const [verDecididas, setVerDecididas] = useState(false);

  const recargar = (lote: number) => {
    grafoResumen(lote).then(setRes).catch(() => {});
    grafoEntidades(lote, 300).then(setEnts).catch(() => {});
    grafoRelaciones(lote, 200).then(setRels).catch(() => {});
    grafoDuplicados(lote).then(setDobles).catch(() => {});
    grafoSinNombrar(lote).then(setAnonimas).catch(() => {});
    resolucionesDelLote(lote).then(setDecididas).catch(() => {});
  };

  useEffect(() => {
    if (loteId == null) return;
    recargar(loteId);
  }, [loteId]);

  const decidir = async (c: Caso, misma: boolean) => {
    if (loteId == null) return;
    await decidirPar(loteId, c, misma).catch(() => {});
    recargar(loteId);
  };
  const deshacer = async (r: Resolucion) => {
    if (loteId == null) return;
    await deshacerResolucion(loteId, r.clave).catch(() => {});
    recargar(loteId);
  };

  /* La relación abierta y de dónde sale: se pide al pulsar, no antes, porque
     son doscientas aristas y cada una arrastra sus párrafos. */
  const [abierta, setAbierta] = useState<number | null>(null);
  const [evidencia, setEvidencia] = useState<Evidencia[] | null>(null);
  const [evidenciaError, setEvidenciaError] = useState<string | null>(null);
  const abrir = async (i: number, r: AristaGrafo) => {
    if (abierta === i) { setAbierta(null); return; }
    setAbierta(i); setEvidencia(null); setEvidenciaError(null);
    if (loteId != null) grafoEvidencia(loteId, r).then(setEvidencia).catch((e) => setEvidenciaError(String(e)));
  };

  const fundidas = decididas.filter((r) => r.decision === "misma");
  const separadas = decididas.filter((r) => r.decision === "distinta");
  const dudasJuez = decididas.filter((r) => r.decision === "posponer" && r.fuente.startsWith("juez"));
  const quien = (f: string) =>
    f === "persona" ? "tú" : f === "regla" ? "la grafía" : f === "quien-ai" ? "Quién-AI" : `el juez (${f.replace(/^juez:/, "")})`;

  if (loteId == null || !res) {
    return (
      <Lienzo>
        <Encabezado paso="grafo" frase={loteId == null ? "Falta elegir el alcance y procesar un lote." : "Cargando…"} compacto />
      </Lienzo>
    );
  }

  if (res.procesados === 0) {
    return (
      <Lienzo>
        <Encabezado
          paso="grafo"
          titulo="Todavía no hay nada extraído"
          frase="El grafo se construye con lo que el extractor encuentra y tú confirmas. Corre la extracción sobre el lote y vuelve."
          compacto
        />
        <Boton onClick={() => estado.avanzar(6, "extraccion")}>Ir a la extracción</Boton>
      </Lienzo>
    );
  }

  const visibles = filtro ? ents.filter((e) => e.tipo === filtro) : ents;
  const porTipo = TIPOS.map((t) => ({
    t, n: ents.filter((e) => e.tipo === t.k).length,
  })).filter((x) => x.n > 0);
  const maxArts = Math.max(...ents.map((e) => e.articulos), 1);

  return (
    <Lienzo ancho={900}>
      <Encabezado
        paso="grafo"
        titulo={`${num(res.entidades_distintas)} entidades del archivo`}
        frase={
          <span className="t-menor" style={{ color: "var(--t3)" }}>
            {num(res.procesados)} de {num(res.articulos)} artículos procesados ·{" "}
            {num(res.revisados)} revisados a mano · {num(res.relaciones)} relaciones
            {res.procesados < res.articulos && " · el grafo crece con la extracción"}
          </span>
        }
      />

      {/* ── Lo que hay que mirar primero ── */}
      <div style={{ display: "flex", gap: "var(--esp-11)", flexWrap: "wrap", marginBottom: "var(--esp-11)", paddingBottom: "var(--esp-8)", borderBottom: "1px solid var(--borde)" }}>
        <Cifra v={num(res.entidades_distintas)} pie="entidades distintas" />
        <Cifra v={`${pct(res.entidades_una_vez, res.entidades_distintas)} %`} pie="aparecen en un solo artículo" />
        <Cifra v={num(res.relaciones)} pie="relaciones propuestas" />
      </div>

      {res.entidades_una_vez / Math.max(res.entidades_distintas, 1) > 0.55 && (
        <div style={{ display: "flex", gap: 11, alignItems: "baseline", padding: "13px 16px", background: "var(--advertencia-fondo)", borderRadius: 10, marginBottom: "var(--esp-11)" }}>
          <Glifo estado="advertencia" size={11} />
          <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "62ch" }}>
            La mayoría de las entidades aparece una sola vez. Es lo normal en un archivo grande, y
            significa que por ahora esto sirve como índice de nombres más que para seguir
            trayectorias: las que sostienen el grafo son las pocas que se repiten.
          </span>
        </div>
      )}

      {anonimas.length > 0 && (
        <div style={{ padding: "13px 16px", background: "var(--hundida)", borderRadius: 10, marginBottom: "var(--esp-11)" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "baseline", marginBottom: 11 }}>
            <Glifo estado="neutro" size={11} />
            <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "62ch" }}>
              {anonimas.length === 1
                ? "Una descripción señala a alguien que el texto nunca nombra"
                : `${num(anonimas.length)} descripciones señalan a alguien que el texto nunca nombra`}
              . Al lado va quién ocupaba esa plaza según el resto del lote, con los años de
              distancia: un cargo lo ocupa gente distinta en momentos distintos, y esa
              distancia es lo que dice si es la misma persona o no.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingLeft: 22 }}>
            {anonimas.slice(0, 8).map((a, i) => (
              <div key={`${a.wp_id}-${a.texto}-${i}`}>
                <div style={{ fontSize: 13, color: "var(--t1)", display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(a.tipo), display: "block" }} />
                  {a.texto}
                  {a.anio && <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{a.anio}</span>}
                </div>
                {a.candidatos.length === 0 ? (
                  <div className="t-menor" style={{ color: "var(--t3)", marginLeft: 14, fontStyle: "italic" }}>
                    Nadie ocupa esa plaza en lo revisado todavía.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 1, marginLeft: 14, marginTop: 3 }}>
                    {a.candidatos.slice(0, 3).map((c, k) => (
                      <div key={k} style={{ fontSize: 12.5, color: "var(--t2)", display: "flex", alignItems: "baseline", gap: 7 }}>
                        <span style={{ color: "var(--t3)" }}>↳</span>
                        <span style={{ color: "var(--t1)" }}>{c.nombre}</span>
                        {c.anio && <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{c.anio}</span>}
                        {c.distancia != null && (
                          <span className="t-mono" style={{ fontSize: 11, color: c.distancia <= 2 ? "var(--exito)" : "var(--t3)" }}>
                            {c.distancia === 0 ? "mismo año" : `${c.distancia} ${c.distancia === 1 ? "año" : "años"}`}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {anonimas.length > 8 && (
              <span style={{ fontSize: 12, color: "var(--t3)" }}>y {num(anonimas.length - 8)} más</span>
            )}
          </div>
        </div>
      )}

      {dobles.length > 0 && (
        <div style={{ padding: "13px 16px", background: "var(--hundida)", borderRadius: 10, marginBottom: "var(--esp-11)" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "baseline", marginBottom: 9 }}>
            <Glifo estado="advertencia" size={11} />
            <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "62ch" }}>
              {dobles.length === 1
                ? "Un par de nombres podría ser la misma entidad"
                : `${num(dobles.length)} pares de nombres podrían ser la misma entidad`}
              , y el grafo los cuenta por separado hasta que alguien lo decida. Funde lo que
              marcaste con <span className="t-mono" style={{ margin: "0 3px" }}>=</span> al revisar,
              lo que el diccionario de Quién-AI tiene curado y lo que el juez decidió con los párrafos;
              lo demás queda aquí para que lo digas tú.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 22 }}>
            {dobles.slice(0, 8).map((c) => (
              <div key={c.clave} style={{ fontSize: 12.5, color: "var(--t2)", display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(c.tipo), display: "block" }} />
                <span style={{ color: "var(--t1)" }}>{c.a.nombre}</span>
                <span style={{ color: "var(--t3)" }}>·</span>
                <span style={{ color: "var(--t1)" }}>{c.b.nombre}</span>
                <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{c.motivo}</span>
                <span style={{ flex: 1 }} />
                <Accion onClick={() => decidir(c, true)} titulo="Son la misma entidad">= misma</Accion>
                <Accion onClick={() => decidir(c, false)} titulo="Son entidades distintas">≠ distintas</Accion>
              </div>
            ))}
            {dobles.length > 8 && (
              <span style={{ fontSize: 12, color: "var(--t3)" }}>y {num(dobles.length - 8)} más</span>
            )}
          </div>
        </div>
      )}

      {decididas.length > 0 && (
        <div style={{ padding: "13px 16px", background: "var(--hundida)", borderRadius: 10, marginBottom: "var(--esp-11)" }}>
          <div style={{ display: "flex", gap: 11, alignItems: "baseline" }}>
            <Glifo estado="neutro" size={11} />
            <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "62ch" }}>
              {num(fundidas.length)} {fundidas.length === 1 ? "par fundido" : "pares fundidos"} y {num(separadas.length)} {separadas.length === 1 ? "separado" : "separados"}
              {dudasJuez.length > 0 && <> · el juez dejó {num(dudasJuez.length)} en duda</>}
              . Cada decisión dice quién la tomó y por qué; se puede deshacer.
            </span>
            <span style={{ flex: 1 }} />
            <Accion onClick={() => setVerDecididas((v) => !v)} titulo="Ver las decisiones">{verDecididas ? "ocultar" : "ver"}</Accion>
          </div>
          {verDecididas && (
            <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 22, marginTop: 9 }}>
              {decididas.filter((r) => r.decision !== "posponer" || r.fuente.startsWith("juez")).slice(0, 40).map((r) => (
                <div key={r.clave} style={{ fontSize: 12.5, color: "var(--t2)", display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(r.tipo), display: "block" }} />
                  <span style={{ color: "var(--t1)" }}>{r.a}</span>
                  <span className="t-mono" style={{ color: r.decision === "misma" ? "var(--exito)" : "var(--t3)", fontSize: 11 }}>
                    {r.decision === "misma" ? "=" : r.decision === "distinta" ? "≠" : "?"}
                  </span>
                  <span style={{ color: "var(--t1)" }}>{r.b}</span>
                  <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }} title={r.motivo ?? ""}>
                    {quien(r.fuente)}{r.motivo ? ` · ${r.motivo.length > 70 ? r.motivo.slice(0, 70) + "…" : r.motivo}` : ""}
                  </span>
                  <span style={{ flex: 1 }} />
                  {r.fuente !== "persona" && <Accion onClick={() => deshacer(r)} titulo="Devolver a la cola de dudas">deshacer</Accion>}
                </div>
              ))}
              {decididas.length > 40 && (
                <span style={{ fontSize: 12, color: "var(--t3)" }}>y {num(decididas.length - 40)} más</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Entidades ── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <Rotulo>Las más presentes</Rotulo>
        <div style={{ flex: 1 }} />
        <button onClick={() => setFiltro(null)}
          style={{ appearance: "none", background: "transparent", border: 0, cursor: "pointer", fontSize: 12, color: filtro === null ? "var(--t1)" : "var(--t3)", fontFamily: "var(--font-sans)" }}>
          todas
        </button>
        {porTipo.map(({ t, n }) => (
          <button key={t.k} onClick={() => setFiltro(t.k)}
            style={{ appearance: "none", background: "transparent", border: 0, cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: filtro === t.k ? "var(--t1)" : "var(--t3)", fontFamily: "var(--font-sans)" }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(t.k), display: "block" }} />
            {t.etiqueta} <span style={{ color: "var(--t3)" }}>{n}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: "var(--esp-11)" }}>
        {visibles.slice(0, 40).map((e, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 130px 62px", alignItems: "center", gap: 12 }}>
            <span style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(e.tipo), display: "block", flex: "0 0 auto" }} />
              <span style={{ fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.texto}</span>
              {/* Lo confirmado por una persona se distingue de lo que solo
                  propuso el modelo: no tienen el mismo valor como dato. */}
              {e.revisada && <span title="Confirmada al revisar" style={{ color: "var(--exito)", fontSize: 10 }}>✓</span>}
            </span>
            <div style={{ height: 5, background: "var(--hundida)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${(e.articulos / maxArts) * 100}%`, height: "100%", background: colorTipo(e.tipo), opacity: e.revisada ? 1 : 0.5, borderRadius: 999 }} />
            </div>
            <span className="t-mono" style={{ textAlign: "right", color: "var(--t3)", fontSize: 11.5 }}>
              {num(e.articulos)} art
            </span>
          </div>
        ))}
        {visibles.length === 0 && (
          <span className="t-menor" style={{ color: "var(--t3)", fontStyle: "italic" }}>
            Ninguna de ese tipo.
          </span>
        )}
      </div>

      {/* ── Relaciones ── */}
      {rels.length > 0 && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Rotulo style={{ marginBottom: 14 }}>Relaciones más frecuentes</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {rels.slice(0, 40).map((r, i) => (
              <div key={i} style={{ borderRadius: 6, background: i % 2 ? "transparent" : "var(--superficie)" }}>
                <div
                  onClick={() => void abrir(i, r)}
                  title="Ver de qué artículos sale"
                  style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "5px 8px", cursor: "pointer" }}
                >
                  <span style={{ fontSize: 13, color: "var(--t1)" }}>{r.a}</span>
                  <span className="t-menor" style={{ color: "var(--acento)" }}>{r.predicado}</span>
                  <span style={{ fontSize: 13, color: "var(--t1)" }}>{r.b}</span>
                  {r.revisada && <span title="Confirmada al revisar" style={{ color: "var(--exito)", fontSize: 10 }}>✓</span>}
                  {r.cuando !== "vigente" && <span className="t-mono" style={{ color: "var(--t3)", fontSize: 10 }}>{r.cuando}</span>}
                  <div style={{ flex: 1 }} />
                  {/* El periodo: según notas de qué años. No es la fecha del hecho, es
                      cuándo el archivo lo afirmó, y eso es lo que se puede decir con verdad. */}
                  <span className="t-mono" title={r.por_anio.map(([y, n]) => `${y}: ${n} ${n === 1 ? "artículo" : "artículos"}`).join("\n")}
                        style={{ color: "var(--t2)", fontSize: 11 }}>
                    {rangoAnios(r)}
                  </span>
                  <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11, minWidth: 24, textAlign: "right" }}>{r.articulos}</span>
                </div>
                {abierta === i && (
                  <div style={{ padding: "2px 8px 10px 22px", display: "flex", flexDirection: "column", gap: 7 }}>
                    {r.por_anio.length > 1 && (
                      <div className="t-mono" style={{ fontSize: 11, color: "var(--t3)" }}>
                        {r.por_anio.map(([y, n]) => `${y} (${n})`).join(" · ")}
                      </div>
                    )}
                    {/* Un fallo se dice; antes se quedaba en «Buscando…» para siempre. */}
                    {evidenciaError && <span className="t-menor" style={{ color: "var(--error)" }}>No se pudo buscar: {evidenciaError}</span>}
                    {!evidenciaError && evidencia === null && <span className="t-menor" style={{ color: "var(--t3)" }}>Buscando los párrafos…</span>}
                    {evidencia && evidencia.length === 0 && <span className="t-menor" style={{ color: "var(--t3)" }}>Ningún párrafo la afirma tal cual: viene de nombres fundidos o de una marca ya corregida.</span>}
                    {(evidencia ?? []).map((e) => (
                      <div key={`${e.wp_id}-${e.pi}`} style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                          {e.enlace
                            ? <a href={e.enlace} target="_blank" rel="noreferrer" style={{ color: "var(--t1)", textDecoration: "none", fontWeight: 500 }}>{e.titulo ?? `Artículo ${e.wp_id}`}</a>
                            : <span style={{ color: "var(--t1)", fontWeight: 500 }}>{e.titulo ?? `Artículo ${e.wp_id}`}</span>}
                          <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{e.fecha?.slice(0, 10)}</span>
                          {e.revisada && <span title="Confirmada al revisar" style={{ color: "var(--exito)", fontSize: 10 }}>✓</span>}
                        </div>
                        <div style={{ color: "var(--t2)" }}>{resaltar(e.parrafo, [r.a, r.b])}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 11, alignItems: "baseline", padding: "13px 16px", background: "var(--exito-fondo)", borderRadius: 10 }}>
        <Glifo estado="exito" size={11} />
        <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "62ch" }}>
          Todo esto salió de tu archivo y se calculó en este computador. El ✓ marca lo que una
          persona confirmó al revisar; el resto lo propuso el modelo y vale menos como dato.
        </span>
      </div>
    </Lienzo>
  );
}

function Cifra({ v, pie }: { v: string; pie: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 36, lineHeight: 1.05, fontVariationSettings: "var(--fraunces-titulo)" }}>{v}</div>
      <div className="t-menor" style={{ color: "var(--t3)", marginTop: 5, maxWidth: "20ch" }}>{pie}</div>
    </div>
  );
}

/* Un botón pequeño de texto, para decidir o deshacer sin salir de la lista. */
function Accion({ onClick, titulo, children }: { onClick: () => void; titulo: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      style={{ appearance: "none", background: "transparent", border: "1px solid var(--borde)", borderRadius: 5, padding: "1px 7px", cursor: "pointer", fontSize: 11, color: "var(--t2)", fontFamily: "var(--font-sans)" }}
    >
      {children}
    </button>
  );
}

/** «2022–2025», «2019» o nada, según lo que el archivo date. */
function rangoAnios(r: AristaGrafo): string {
  if (r.desde_anio == null) return "";
  return r.hasta_anio != null && r.hasta_anio !== r.desde_anio ? `${r.desde_anio}–${r.hasta_anio}` : String(r.desde_anio);
}

/** El párrafo con los dos nombres en negrita, para encontrar la frase de un vistazo. */
function resaltar(texto: string, nombres: string[]): React.ReactNode {
  const claves = nombres.filter((n) => n.length > 1);
  if (claves.length === 0) return texto;
  const partes = texto.split(new RegExp(`(${claves.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g"));
  return partes.map((p, i) => (claves.includes(p) ? <strong key={i} style={{ color: "var(--t1)", fontWeight: 600 }}>{p}</strong> : p));
}

import { useEffect, useState } from "react";
import { Boton, Glifo, Lienzo, Rotulo } from "../ui";
import { TIPOS, colorTipo } from "../contenido/tipos";
import { grafoDuplicados, grafoEntidades, grafoRelaciones, grafoResumen, grafoSinNombrar } from "../lib/ipc";
import type { AristaGrafo, Caso, NodoGrafo, ResumenGrafo, SinNombrar } from "../types";
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

  useEffect(() => {
    if (loteId == null) return;
    grafoResumen(loteId).then(setRes).catch(() => {});
    grafoEntidades(loteId, 300).then(setEnts).catch(() => {});
    grafoRelaciones(loteId, 200).then(setRels).catch(() => {});
    grafoDuplicados(loteId).then(setDobles).catch(() => {});
    grafoSinNombrar(loteId).then(setAnonimas).catch(() => {});
  }, [loteId]);

  if (loteId == null || !res) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 8 · Grafo</Rotulo>
        <p className="t-cuerpo" style={{ color: "var(--t3)" }}>
          {loteId == null ? "Falta elegir el alcance y procesar un lote." : "Cargando…"}
        </p>
      </Lienzo>
    );
  }

  if (res.procesados === 0) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 8 · Grafo</Rotulo>
        <h1 className="t-display" style={{ margin: "0 0 14px" }}>Todavía no hay nada extraído</h1>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-8)", maxWidth: "52ch" }}>
          El grafo se construye con lo que el extractor encuentra y tú confirmas. Corre la
          extracción sobre el lote y vuelve.
        </p>
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
      <Rotulo style={{ marginBottom: 12 }}>Paso 8 · Grafo</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 10px" }}>
        {num(res.entidades_distintas)} entidades del archivo
      </h1>
      <p className="t-menor" style={{ color: "var(--t3)", margin: "0 0 var(--esp-11)" }}>
        {num(res.procesados)} de {num(res.articulos)} artículos procesados ·{" "}
        {num(res.revisados)} revisados a mano · {num(res.relaciones)} relaciones
      </p>

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
                ? "Un par de nombres parece ser la misma entidad"
                : `${num(dobles.length)} pares de nombres parecen ser la misma entidad`}
              , y el grafo los cuenta por separado. Solo funde lo que marcaste con
              <span className="t-mono" style={{ margin: "0 3px" }}>=</span>
              al revisar: no adivina, para no inventarse identidades que nadie confirmó.
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 22 }}>
            {dobles.slice(0, 6).map((c) => (
              <div key={c.clave} style={{ fontSize: 12.5, color: "var(--t2)", display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(c.tipo), display: "block" }} />
                <span style={{ color: "var(--t1)" }}>{c.a.nombre}</span>
                <span style={{ color: "var(--t3)" }}>·</span>
                <span style={{ color: "var(--t1)" }}>{c.b.nombre}</span>
                <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{c.motivo}</span>
              </div>
            ))}
            {dobles.length > 6 && (
              <span style={{ fontSize: 12, color: "var(--t3)" }}>y {num(dobles.length - 6)} más</span>
            )}
          </div>
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
            {rels.slice(0, 24).map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "5px 8px", borderRadius: 6, background: i % 2 ? "transparent" : "var(--superficie)" }}>
                <span style={{ fontSize: 13, color: "var(--t1)" }}>{r.a}</span>
                <span className="t-menor" style={{ color: "var(--acento)" }}>{r.predicado}</span>
                <span style={{ fontSize: 13, color: "var(--t1)" }}>{r.b}</span>
                {r.revisada && <span title="Confirmada al revisar" style={{ color: "var(--exito)", fontSize: 10 }}>✓</span>}
                <div style={{ flex: 1 }} />
                <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{r.articulos}</span>
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

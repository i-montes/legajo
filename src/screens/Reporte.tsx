import { useEffect, useState } from "react";
import { Boton, Glifo, Lienzo, Rotulo } from "../ui";
import {
  evaluacion as cargarEvaluacion, muestraActual, puerta as calcPuerta,
  reporte as cargarReporte,
} from "../lib/ipc";
import { colorTipo, TIPOS } from "../contenido/tipos";
import type { Evaluacion, Puerta, Reporte as ReporteT } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
const dec = (n: number, d = 1) => n.toFixed(d).replace(".", ",");
const etiquetaTipo = (k: string) => TIPOS.find((t) => t.k === k)?.etiqueta ?? k;

function horasLegibles(h: number) {
  if (h < 1) return `${Math.round(h * 60)} minutos`;
  if (h < 80) return `${dec(h, 0)} horas`;
  const jornadas = h / 8;
  if (jornadas < 60) return `${dec(h, 0)} horas · ${dec(jornadas, 0)} jornadas`;
  return `${num(Math.round(h))} horas · ${dec(h / 1600, 1)} años-persona`;
}

export default function Reporte({ estado }: { estado: EstadoApp }) {
  const { conexionId, sitio } = estado;
  const [rep, setRep] = useState<ReporteT | null>(null);
  const [ev, setEv] = useState<Evaluacion | null>(null);
  const [personas, setPersonas] = useState(1);
  const [horasSemana, setHorasSemana] = useState(20);
  const [semanas, setSemanas] = useState(12);
  const [pu, setPu] = useState<Puerta | null>(null);

  const universo = sitio?.capabilities.total_posts ?? 0;

  useEffect(() => {
    if (conexionId == null) return;
    muestraActual(conexionId).then((m) => {
      if (!m) return;
      cargarReporte(m[0], universo).then(setRep).catch(() => {});
      cargarEvaluacion(m[0]).then(setEv).catch(() => setEv(null));
    });
  }, [conexionId, universo]);

  useEffect(() => {
    const horas = rep?.proyeccion?.horas_totales_maduro ?? rep?.proyeccion?.horas_totales;
    if (horas == null) { setPu(null); return; }
    calcPuerta(horas, personas, horasSemana, semanas, universo).then(setPu).catch(() => {});
  }, [rep, personas, horasSemana, semanas, universo]);

  if (!rep) {
    return <Lienzo><p className="t-cuerpo" style={{ color: "var(--t3)" }}>Calculando…</p></Lienzo>;
  }

  const t = rep.tiempos;
  const p = rep.proyeccion;
  const hoy = new Date().toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

  if (!t || rep.anotados === 0) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 8 · Reporte de viabilidad</Rotulo>
        <h1 className="t-display" style={{ margin: "0 0 14px" }}>Todavía no hay nada que medir</h1>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-8)", maxWidth: "52ch" }}>
          El reporte se construye con los tiempos reales de anotación. Cierra unos cuantos artículos
          en el paso 5 y vuelve: con doce ya se puede ver la curva de aprendizaje.
        </p>
        <Boton onClick={() => estado.avanzar(4, "anotacion")}>Ir a anotar</Boton>
      </Lienzo>
    );
  }

  const mejora = t.primeros_seg && t.ultimos_seg
    ? (1 - t.ultimos_seg / t.primeros_seg) * 100
    : null;

  return (
    <Lienzo ancho={880}>
      <Rotulo style={{ marginBottom: 12 }}>Paso 8 · Reporte de viabilidad</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 10px" }}>
        {sitio?.site_name ?? "Diagnóstico del archivo"}
      </h1>
      <p className="t-menor" style={{ color: "var(--t3)", margin: "0 0 var(--esp-11)" }}>
        {num(universo)} artículos · muestra de {num(rep.muestra)} · {num(rep.anotados)} anotados · {hoy}
      </p>

      {/* ── La cifra que importa ── */}
      <div style={{ padding: "var(--esp-6)", background: "var(--superficie)", border: "1px solid var(--borde)", borderRadius: 12, marginBottom: "var(--esp-11)" }}>
        <Rotulo style={{ marginBottom: 14 }}>Coste real de la curación</Rotulo>
        <div style={{ display: "flex", gap: "var(--esp-11)", flexWrap: "wrap", marginBottom: "var(--esp-6)" }}>
          <Destacado v={`${dec(p?.min_por_100_maduro ?? p?.min_por_100 ?? 0, 0)} min`} pie="por cada 100 artículos" />
          <Destacado v={dec(rep.entidades_por_articulo, 1)} pie="entidades por artículo" />
          <Destacado v={`${Math.floor(t.mediana_seg / 60)}:${String(t.mediana_seg % 60).padStart(2, "0")}`} pie="mediana por artículo" />
        </div>

        {mejora != null && Math.abs(mejora) > 5 && (
          <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: "var(--esp-4)" }}>
            <Glifo estado="exito" size={11} />
            <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "62ch" }}>
              Curva de aprendizaje: los últimos artículos costaron un {dec(Math.abs(mejora), 0)} %{" "}
              {mejora > 0 ? "menos" : "más"} que los primeros ({t.primeros_seg}s → {t.ultimos_seg}s).
              La proyección usa los últimos, no el promedio: proyectar desde el arranque sobreestima
              el coste, a veces al doble.
            </span>
          </div>
        )}

        <p className="t-menor" style={{ color: "var(--t3)", margin: 0, lineHeight: 1.7, maxWidth: "62ch" }}>
          Mediana y percentil 90, nunca la media: la distribución tiene cola larga y un solo artículo
          con muchas entidades ambiguas ({Math.floor(t.p90_seg / 60)}:{String(t.p90_seg % 60).padStart(2, "0")}) desplazaría el promedio.
        </p>
      </div>

      {/* ── La puerta de salida ── */}
      {p && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Rotulo style={{ marginBottom: 14 }}>La puerta de salida</Rotulo>
          <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-6)", maxWidth: "60ch" }}>
            Curar los {num(universo)} artículos del archivo a este ritmo cuesta{" "}
            <strong style={{ color: "var(--t1)", fontWeight: 500 }}>
              {horasLegibles(p.horas_totales_maduro ?? p.horas_totales)}
            </strong>. La pregunta es si la redacción puede poner eso.
          </p>

          <div style={{ display: "flex", gap: "var(--esp-6)", flexWrap: "wrap", marginBottom: "var(--esp-6)" }}>
            <Dial etiqueta="personas" v={personas} set={setPersonas} min={0.5} max={6} paso={0.5} />
            <Dial etiqueta="horas/semana" v={horasSemana} set={setHorasSemana} min={2} max={40} paso={2} />
            <Dial etiqueta="semanas" v={semanas} set={setSemanas} min={2} max={52} paso={2} />
          </div>

          {pu && (
            <div style={{ padding: "var(--esp-4) var(--esp-6)", borderRadius: 10, background: pu.cabe ? "var(--exito-fondo)" : "var(--advertencia-fondo)" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
                <Glifo estado={pu.cabe ? "exito" : "advertencia"} size={11} />
                <span style={{ fontSize: 15, fontWeight: 500 }}>
                  {pu.cabe
                    ? "El archivo completo cabe en esa capacidad."
                    : `Con esa capacidad caben ${num(pu.alcance_viable)} artículos: el ${dec(pu.pct_archivo, 0)} % del archivo.`}
                </span>
              </div>
              <p className="t-menor" style={{ color: "var(--t2)", margin: 0, lineHeight: 1.7, maxWidth: "62ch" }}>
                {dec(pu.horas_disponibles, 0)} horas disponibles frente a {dec(pu.horas_necesarias, 0)} necesarias.
                {!pu.cabe && " Recortar el alcance no es un fracaso del diagnóstico: es exactamente lo que el diagnóstico existe para decidir, y a tiempo."}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Precisión del modelo ── */}
      {ev && ev.articulos > 0 && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Rotulo style={{ marginBottom: 8 }}>
            Precisión de la extracción · {ev.articulos} artículos con anotación y extracción
          </Rotulo>
          <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-6)", maxWidth: "62ch" }}>
            Dos varas a la vez, porque cada una responde a una pregunta distinta.{" "}
            <strong style={{ fontWeight: 500, color: "var(--t1)" }}>Estricta</strong> exige los mismos
            límites exactos: importa si el grafo va a guardar la cadena tal cual.{" "}
            <strong style={{ fontWeight: 500, color: "var(--t1)" }}>Laxa</strong> se conforma con que
            se solapen: importa si después hay normalización de nombres. Dar solo una de las dos infla
            o hunde el resultado según convenga.
          </p>

          <div style={{ display: "flex", gap: "var(--esp-11)", flexWrap: "wrap", marginBottom: "var(--esp-6)" }}>
            <Destacado v={dec(ev.global_laxo.f1, 2)} pie="F1 global, vara laxa" />
            <Destacado v={dec(ev.global_estricto.f1, 2)} pie="F1 global, vara estricta" />
            <Destacado v={dec(ev.global_laxo.cobertura, 2)} pie="cobertura laxa" />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginBottom: "var(--esp-6)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 54px 54px", gap: 14 }}>
              <span />
              <span />
              <span className="t-menor" style={{ color: "var(--t3)", textAlign: "right" }}>laxa</span>
              <span className="t-menor" style={{ color: "var(--t3)", textAlign: "right" }}>estricta</span>
            </div>
            {ev.por_tipo.map((t) => (
              <div key={t.tipo} style={{ display: "grid", gridTemplateColumns: "150px 1fr 54px 54px", alignItems: "center", gap: 14 }}>
                <span className="t-menor" style={{ color: "var(--t2)" }}>{etiquetaTipo(t.tipo)}</span>
                <div style={{ height: 6, background: "var(--hundida)", borderRadius: 999, position: "relative", overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${t.laxo.f1 * 100}%`, background: colorTipo(t.tipo), opacity: 0.35, borderRadius: 999 }} />
                  <div style={{ position: "absolute", inset: 0, width: `${t.estricto.f1 * 100}%`, background: colorTipo(t.tipo), borderRadius: 999 }} />
                </div>
                <span className="t-mono" style={{ textAlign: "right", color: "var(--t2)" }}>{dec(t.laxo.f1, 2)}</span>
                <span className="t-mono" style={{ textAlign: "right", color: "var(--t3)" }}>{dec(t.estricto.f1, 2)}</span>
              </div>
            ))}
          </div>

          {(ev.ejemplos_fp.length > 0 || ev.ejemplos_fn.length > 0) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--esp-6)", marginTop: "var(--esp-6)" }}>
              <ListaErrores titulo="Propuso y tú no marcaste" items={ev.ejemplos_fp} />
              <ListaErrores titulo="Marcaste y no encontró" items={ev.ejemplos_fn} />
            </div>
          )}

          <p className="t-menor" style={{ color: "var(--t3)", marginTop: "var(--esp-6)", lineHeight: 1.7, maxWidth: "62ch" }}>
            El techo de cualquier modelo es el acuerdo entre anotadores humanos. Si un tipo saca 0,55
            aquí, no le pidas 0,80: primero hay que comprobar si dos personas coinciden al marcarlo, y
            si no coinciden, ese tipo sobra de la ontología.
          </p>
        </div>
      )}

      {/* ── Densidad ── */}
      {rep.densidad.length > 0 && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Rotulo style={{ marginBottom: 14 }}>Entidades anotadas por tipo</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {rep.densidad.map((d) => {
              const max = Math.max(...rep.densidad.map((x) => x.menciones), 1);
              return (
                <div key={d.tipo} style={{ display: "grid", gridTemplateColumns: "150px 1fr 92px", alignItems: "center", gap: 14 }}>
                  <span className="t-menor" style={{ color: "var(--t2)" }}>{etiquetaTipo(d.tipo)}</span>
                  <div style={{ height: 6, background: "var(--hundida)", borderRadius: 999, overflow: "hidden" }}>
                    <div style={{ width: `${(d.menciones / max) * 100}%`, height: "100%", background: colorTipo(d.tipo), borderRadius: 999 }} />
                  </div>
                  <span className="t-mono" style={{ textAlign: "right", color: "var(--t2)" }}>
                    {num(d.menciones)} · {dec(d.por_articulo)}/art
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Curva de frecuencia ── */}
      {rep.entidades_distintas > 0 && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Rotulo style={{ marginBottom: 16 }}>
            En cuántos artículos aparece cada entidad · {num(rep.entidades_distintas)} distintas
          </Rotulo>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 20, height: 120, marginBottom: 14 }}>
            {rep.curva.map((c) => {
              const max = Math.max(...rep.curva.map((x) => x.pct), 1);
              return (
                <div key={c.etiqueta} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, height: "100%", justifyContent: "flex-end" }}>
                  <span className="t-mono" style={{ color: "var(--t2)" }}>{dec(c.pct, 0)} %</span>
                  <div style={{ width: "100%", height: `${(c.pct / max) * 100}%`, minHeight: 2, background: "var(--acento)", opacity: 0.75, borderRadius: "4px 4px 0 0" }} />
                  <span className="t-menor" style={{ color: "var(--t3)", whiteSpace: "nowrap" }}>{c.etiqueta}</span>
                </div>
              );
            })}
          </div>
          {rep.curva[0] && rep.curva[0].pct > 55 && (
            <p className="t-cuerpo" style={{ color: "var(--t2)", margin: 0, maxWidth: "60ch" }}>
              El {dec(rep.curva[0].pct, 0)} % de las entidades aparece una sola vez: por ahora el archivo
              sirve para construir un índice de nombres, no todavía para seguir trayectorias.
            </p>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 11, alignItems: "baseline", padding: "13px 16px", background: "var(--exito-fondo)", borderRadius: 10, marginBottom: "var(--esp-8)" }}>
        <Glifo estado="exito" size={11} />
        <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65, maxWidth: "62ch" }}>
          Todo lo de esta pantalla se calculó en este computador a partir de tu propia anotación.
          Un reporte con solo estas métricas agregadas puede compartirse sin exponer nada del archivo.
        </span>
      </div>

      {(!ev || ev.articulos === 0) && (
        <p className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.7, maxWidth: "62ch" }}>
          Todavía falta la comparación contra la extracción automática: hace falta que un mismo
          artículo tenga anotación cerrada y extracción. Corre el paso 6 sobre lo que ya anotaste.
        </p>
      )}
    </Lienzo>
  );
}

function Destacado({ v, pie }: { v: string; pie: string }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 36, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-.4px", fontVariationSettings: "var(--fraunces-titulo)" }}>{v}</div>
      <div className="t-menor" style={{ color: "var(--t3)", marginTop: 5, maxWidth: "20ch" }}>{pie}</div>
    </div>
  );
}

function Dial({ etiqueta, v, set, min, max, paso }: {
  etiqueta: string; v: number; set: (n: number) => void; min: number; max: number; paso: number;
}) {
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 7 }}>
        <span style={{ fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{v}</span>
        <span className="t-menor" style={{ color: "var(--t3)" }}>{etiqueta}</span>
      </div>
      <input type="range" min={min} max={max} step={paso} value={v}
        onChange={(e) => set(+e.target.value)}
        style={{ width: "100%", accentColor: "var(--acento)" }} />
    </div>
  );
}

function ListaErrores({ titulo, items }: { titulo: string; items: [string, string][] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <Rotulo style={{ marginBottom: 10 }}>{titulo}</Rotulo>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {items.slice(0, 6).map(([texto, tipo], i) => (
          <div key={i} style={{ display: "flex", gap: 9, alignItems: "baseline", padding: "5px 10px", background: "var(--hundida)", borderRadius: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(tipo), display: "block", flex: "0 0 auto" }} />
            <span className="t-menor" style={{ color: "var(--t1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{texto}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

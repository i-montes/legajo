import { useCallback, useEffect, useRef, useState } from "react";
import { Barra, Boton, Glifo, Latido, Lienzo, Rotulo } from "../ui";
import {
  alFinCenso, alProgresoCenso, cancelarCenso, censoCorriendo,
  iniciarCenso, perfilArchivo,
} from "../lib/ipc";
import type { PerfilArchivo, ProgresoCenso } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
const pct1 = (n: number) => n.toFixed(n < 10 ? 1 : 0).replace(".", ",");

export default function Perfil({ estado }: { estado: EstadoApp }) {
  const { sitio, conexionId, taxonomia } = estado;
  const [perfil, setPerfil] = useState<PerfilArchivo | null>(null);
  const [progreso, setProgreso] = useState<ProgresoCenso | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const desmontado = useRef(false);

  const cargar = useCallback(() => {
    if (conexionId == null) return;
    perfilArchivo(conexionId, taxonomia)
      .then((p) => {
        setPerfil(p);
        // El eje de secciones tiene que ser una taxonomía con nombres bajados.
        // Las que tienen miles de términos se omiten a propósito, y elegir una
        // de esas dejaría el reparto vacío sin decir por qué.
        const usables = p.taxonomias_usables.map(([t]) => t);
        if (usables.length > 0 && (!taxonomia || !usables.includes(taxonomia))) {
          estado.setTaxonomia(usables[0]);
        }
      })
      .catch(() => setPerfil(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conexionId, taxonomia]);

  useEffect(() => {
    desmontado.current = false;
    cargar();
    censoCorriendo().then(setCorriendo);
    const un1 = alProgresoCenso((p) => !desmontado.current && setProgreso(p));
    const un2 = alFinCenso((f) => {
      if (desmontado.current) return;
      setCorriendo(false);
      setProgreso(null);
      setError(f.error);
      cargar();
    });
    return () => {
      desmontado.current = true;
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [cargar]);

  if (!sitio || conexionId == null) return null;

  const cap = sitio.capabilities;
  const totalRemoto = cap.total_posts ?? 0;
  const censado = perfil?.censado ?? 0;
  const completo = censado > 0 && totalRemoto > 0 && censado >= totalRemoto * 0.995;

  async function censar(reiniciar: boolean) {
    if (conexionId == null) return;
    setError(null);
    setCorriendo(true);
    setProgreso({ fase: "terminos", ventana: "", hechos: 0, total: 0 });
    const taxs = cap.taxonomies.map((t) => t.rest_base);
    try {
      await iniciarCenso(conexionId, taxs, reiniciar);
    } catch (e) {
      setError(String(e));
      setCorriendo(false);
    }
  }

  return (
    <Lienzo>
      <Rotulo style={{ marginBottom: 12 }}>
        Paso 2 · {sitio.resolved_origin.replace(/^https?:\/\//, "")}
      </Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 14px" }}>
        {completo ? "Esto es lo que hay dentro de tu archivo." : "Leer el archivo entero"}
      </h1>
      <p className="t-cuerpo" style={{ margin: "0 0 var(--esp-11)", color: "var(--t2)", maxWidth: "54ch" }}>
        {completo
          ? "Legajo lo leyó preguntándole a tu propio WordPress. Nada de esto salió de tu computador."
          : `Legajo recorre las ${num(totalRemoto)} piezas leyendo solo sus metadatos —fecha, sección, titular—, nunca el cuerpo. Es lo que hace posible muestrear con criterio.`}
      </p>

      {error && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "12px 15px", background: "var(--error-fondo)", borderRadius: 8, marginBottom: "var(--esp-8)" }}>
          <Glifo estado="error" size={11} />
          <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.6 }}>{error}</span>
        </div>
      )}

      {corriendo && progreso && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Latido />
            <span className="t-ui">
              {progreso.fase === "terminos" && "Trayendo los nombres de las secciones"}
              {progreso.fase === "censo" && `Recorriendo el archivo · ${progreso.ventana}`}
              {progreso.fase === "sondeo" && "Sondeando el contenido de una submuestra"}
            </span>
            <div style={{ flex: 1 }} />
            <span className="t-mono" style={{ color: "var(--t3)" }}>
              {progreso.total > 0 ? `${progreso.hechos}/${progreso.total}` : ""}
            </span>
          </div>
          <Barra pct={progreso.total > 0 ? (progreso.hechos / progreso.total) * 100 : 0} alto={4} />
          <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 14 }}>
            <Boton variante="secundario" onClick={() => cancelarCenso()}>Detener</Boton>
            <span className="t-menor" style={{ color: "var(--t3)" }}>
              Se guarda cada tramo al terminarlo: detener no pierde lo recorrido.
            </span>
          </div>
        </div>
      )}

      {!corriendo && !completo && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Boton onClick={() => censar(censado === 0)}>
            {censado > 0 ? `Continuar (${num(censado)} de ${num(totalRemoto)})` : "Leer el archivo"}
          </Boton>
          <p className="t-menor" style={{ color: "var(--t3)", margin: "14px 0 0", maxWidth: "54ch", lineHeight: 1.7 }}>
            Va por tramos mensuales y con pausas de cortesía entre peticiones, así que tarda unos
            minutos. Puedes detenerlo y retomarlo donde iba.
          </p>
        </div>
      )}

      {perfil && censado > 0 && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-8)" }}>
            <Acto cifra={num(perfil.censado)} titulo={
              perfil.anio_min && perfil.anio_max
                ? `artículos, de ${perfil.anio_min} a ${perfil.anio_max}`
                : "artículos censados"
            }>
              {completo
                ? "Es el universo del que saldrá la muestra."
                : `Todavía faltan ${num(Math.max(0, totalRemoto - censado))} por recorrer.`}
              {perfil.sin_fecha > 0 &&
                ` ${num(perfil.sin_fecha)} llevan una fecha imposible y quedan fuera del eje temporal hasta que lo decidas.`}
            </Acto>

            {perfil.secciones.length > 0 && (
              <Acto cifra={String(perfil.secciones.length)} titulo={
                perfil.secciones.length === 1 ? "sección en uso" : "secciones en uso"
              }>
                {(() => {
                  const top = perfil.secciones[0];
                  const cuota = (top.n / perfil.censado) * 100;
                  const unaVez = perfil.secciones.filter((s) => s.n <= 1).length;
                  return cuota > 35
                    ? `«${top.nombre}» concentra el ${pct1(cuota)} % del archivo: conviene revisar si es una sección editorial o un cajón de sastre antes de estratificar por aquí.`
                    : `La mayor es «${top.nombre}» con el ${pct1(cuota)} %. ${unaVez > 0 ? `${unaVez} términos aparecen una sola vez y no sirven para estratificar.` : "El reparto es utilizable para estratificar."}`;
                })()}
              </Acto>
            )}

            {perfil.sondeo && (
              <>
                <Acto cifra={`${pct1(perfil.sondeo.pct_bloques)} %`} titulo="escrito con el editor de bloques" estimado>
                  El resto es HTML plano heredado, donde el destaque y el pie de foto no se
                  distinguen del cuerpo y necesitan más revisión humana por artículo.
                </Acto>
                <Acto cifra={num(perfil.sondeo.palabras_p50)} titulo="palabras en el artículo mediano" estimado>
                  Nueve de cada diez quedan por debajo de {num(perfil.sondeo.palabras_p90)}.
                  {perfil.sondeo.pct_cortas > 0 &&
                    ` El ${pct1(perfil.sondeo.pct_cortas)} % baja de 120 palabras: rinden pocas entidades y encarecen la curación.`}
                </Acto>
              </>
            )}
          </div>

          {perfil.por_anio.length > 1 && (
            <div style={{ marginTop: "var(--esp-11)" }}>
              <Rotulo style={{ marginBottom: 16 }}>Artículos por año</Rotulo>
              <Histograma filas={perfil.por_anio} />
            </div>
          )}

          {perfil.sondeo && (
            <p className="t-menor" style={{ color: "var(--t3)", marginTop: "var(--esp-8)", maxWidth: "58ch", lineHeight: 1.7 }}>
              Lo marcado como estimación sale de un sondeo sobre {perfil.sondeo.n} artículos
              elegidos al azar de forma reproducible. Lo que depende del cuerpo del artículo no
              cabe en el censo: bajar {num(perfil.censado)} cuerpos para calcularlo costaría horas
              y no cambiaría la decisión.
            </p>
          )}

          <div style={{ marginTop: "var(--esp-11)", paddingTop: "var(--esp-6)", borderTop: "1px solid var(--borde)", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <Boton onClick={() => estado.avanzar(2, "sanidad")} disabled={corriendo}>
              Continuar a la sanidad del archivo
            </Boton>
            {!corriendo && (
              <Boton variante="enlace" onClick={() => censar(true)}>volver a leer el archivo desde cero</Boton>
            )}
          </div>
        </>
      )}
    </Lienzo>
  );
}

function Acto({ cifra, titulo, estimado, children }: {
  cifra: string; titulo: string; estimado?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 150px) 1fr", gap: "var(--esp-6)", alignItems: "baseline" }}>
      <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 38, fontWeight: 600, lineHeight: 1.1, letterSpacing: "-.4px", fontVariationSettings: "var(--fraunces-titulo)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {cifra}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 5, display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
          {titulo}
          {estimado && (
            <span className="t-menor" style={{ color: "var(--t3)", fontWeight: 400, border: "1px solid var(--borde)", borderRadius: 999, padding: "1px 8px" }}>
              estimado
            </span>
          )}
        </div>
        <p className="t-cuerpo" style={{ margin: 0, color: "var(--t2)", maxWidth: "54ch" }}>{children}</p>
      </div>
    </div>
  );
}

/* El reparto por año es lo primero que revela una migración mal hecha: un pico
   imposible en un año concreto, o un hueco donde el medio sí publicaba. */
function Histograma({ filas }: { filas: { anio: number; n: number }[] }) {
  const max = Math.max(...filas.map((f) => f.n), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
      {filas.map((f) => (
        <div key={f.anio} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }} title={`${f.anio}: ${num(f.n)} artículos`}>
          <div style={{ width: "100%", height: `${(f.n / max) * 100}%`, minHeight: 2, background: "var(--acento)", opacity: 0.7, borderRadius: "3px 3px 0 0" }} />
          <span style={{ fontSize: 9.5, color: "var(--t3)", fontVariantNumeric: "tabular-nums", writingMode: filas.length > 20 ? "vertical-rl" : undefined }}>
            {filas.length > 14 ? String(f.anio).slice(2) : f.anio}
          </span>
        </div>
      ))}
    </div>
  );
}

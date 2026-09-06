import { useEffect, useRef, useState } from "react";
import { Barra, Boton, Glifo, Latido, Lienzo, Rotulo } from "../ui";
import {
  alFinExtraccion, alProgresoExtraccion, avanceExtraccion, cancelarExtraccion,
  extrayendo as consultarExtrayendo, iniciarExtraccion,
} from "../lib/ipc";
import type { ProgresoExtraccion } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
const seg = (ms: number) => (ms / 1000).toFixed(1).replace(".", ",");

const duracion = (s: number) => {
  if (s < 90) return `${Math.round(s)} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
};

interface Linea { hora: string; texto: string }

export default function Extraccion({ estado }: { estado: EstadoApp }) {
  const { loteId } = estado;
  const [hechos, setHechos] = useState(0);
  const [total, setTotal] = useState(0);
  const [prog, setProg] = useState<ProgresoExtraccion | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Linea[]>([]);
  const [entidades, setEntidades] = useState(0);
  const tiempos = useRef<number[]>([]);

  const anotar = (texto: string) =>
    setLog((l) => [{ hora: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }), texto }, ...l].slice(0, 12));

  useEffect(() => {
    if (loteId == null) return;
    avanceExtraccion(loteId).then(([h, t]) => { setHechos(h); setTotal(t); });
    consultarExtrayendo().then(setCorriendo);
  }, [loteId]);

  useEffect(() => {
    const un1 = alProgresoExtraccion((p) => {
      setProg(p);
      if (p.fase === "extrayendo") {
        setHechos(p.hechos);
        setTotal(p.total);
        setEntidades((e) => e + p.entidades);
        if (p.ms > 0) tiempos.current.push(p.ms);
        if (p.detalle) anotar(`el artículo #${p.wp_id} falló: ${p.detalle}`);
      }
      if (p.fase === "cargando") anotar(`cargando el modelo ${p.detalle}`);
      if (p.fase === "cargado") anotar(`modelo listo en ${seg(p.ms)} s`);
      if (p.fase === "arrancando") anotar("arrancando el extractor");
    });
    const un2 = alFinExtraccion((f) => {
      setCorriendo(false);
      setProg(null);
      setError(f.error);
      anotar(f.cancelado ? "detenido por el usuario" : f.error ? `error: ${f.error}` : "extracción terminada");
      if (loteId != null) avanceExtraccion(loteId).then(([h, t]) => { setHechos(h); setTotal(t); });
    });
    return () => { un1.then((u) => u()); un2.then((u) => u()); };
  }, [loteId]);

  async function arrancar() {
    if (loteId == null) return;
    setError(null);
    setCorriendo(true);
    tiempos.current = [];
    try {
      await iniciarExtraccion(loteId, null, false);
    } catch (e) {
      setError(String(e));
      setCorriendo(false);
    }
  }

  const pct = total > 0 ? (hechos / total) * 100 : 0;
  const listo = total > 0 && hechos >= total;
  const medio = tiempos.current.length
    ? tiempos.current.reduce((a, b) => a + b, 0) / tiempos.current.length
    : 0;
  const universo = total;
  const horasArchivo = medio > 0 && universo > 0 ? (universo * medio) / 1000 / 3600 : null;

  /* Lo que falta, en tiempo y no en porcentaje. Mirar una barra sin saber si
     son dos minutos o dos horas es lo que hace que la gente cierre la ventana
     a medias, y esto se guarda artículo a artículo justo para que no pase. */
  const restante = corriendo && medio > 0 && total > hechos
    ? ((total - hechos) * medio) / 1000
    : null;

  if (total === 0 && hechos === 0) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 6 · Extracción automática</Rotulo>
        <h1 className="t-display" style={{ margin: "0 0 14px" }}>No hay nada que extraer todavía</h1>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-8)", maxWidth: "52ch" }}>
          La extracción corre sobre los artículos de la muestra que ya tienen el cuerpo descargado.
          Vuelve al muestreo y termina la descarga.
        </p>
        <Boton onClick={() => estado.avanzar(3, "alcance")}>Ir al muestreo</Boton>
      </Lienzo>
    );
  }

  return (
    <Lienzo>
      <Rotulo style={{ marginBottom: 12 }}>Paso 6 · Extracción automática</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 14px" }}>
        {listo ? "Extracción terminada" : corriendo ? "Extrayendo entidades" : "Pasar el modelo por la muestra"}
      </h1>
      <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-11)", maxWidth: "58ch" }}>
        El modelo recorre los {num(total)} artículos de la muestra y propone entidades. Corre sobre la
        muestra y no sobre el archivo entero a propósito: lo que hay que medir es cómo se porta frente
        a lo que anotaste tú, y eso solo puede medirse donde hay anotación.
      </p>

      {error && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "12px 15px", background: "var(--error-fondo)", borderRadius: 8, marginBottom: "var(--esp-8)" }}>
          <Glifo estado="error" size={11} />
          <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{error}</span>
        </div>
      )}

      {prog?.fase === "cargando" && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "var(--esp-8)" }}>
          <Latido />
          <div>
            <div className="t-ui">Cargando el modelo</div>
            <div className="t-menor" style={{ color: "var(--t3)", marginTop: 4, maxWidth: "52ch", lineHeight: 1.6 }}>
              La primera vez se descarga (unos 500 MB) y puede tardar varios minutos. Después queda en
              caché y arranca en segundos.
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--font-serif-display)", fontSize: 30, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
          {pct.toFixed(0)} %
        </span>
        <span className="t-menor" style={{ color: "var(--t3)" }}>
          {num(hechos)} de {num(total)} artículos · {num(entidades)} entidades propuestas
        </span>
      </div>
      <Barra pct={pct} alto={4} />

      <div style={{ display: "flex", gap: "var(--esp-11)", marginTop: "var(--esp-8)", flexWrap: "wrap" }}>
        <Metrica k="Velocidad medida" v={medio > 0 ? `${seg(medio)} s por artículo` : "—"} />
        {restante != null && <Metrica k="Falta" v={duracion(restante)} />}
        <Metrica
          k="Archivo completo, a este ritmo"
          v={horasArchivo != null ? `${horasArchivo.toFixed(horasArchivo < 10 ? 1 : 0)} h de cómputo` : "—"}
        />
        <Metrica k="Modelo" v="GLiNER multilingüe · CPU" />
      </div>

      {/* Reanudar un trabajo se nombra por el trabajo y por lo que queda, no
          con un «continuar» que se confunde con avanzar de paso. */}
      <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: "var(--esp-8)", flexWrap: "wrap" }}>
        {listo ? (
          <Boton onClick={() => estado.avanzar(6, "grafo")}>Resolver entidades duplicadas</Boton>
        ) : corriendo ? (
          <Boton variante="secundario" onClick={() => cancelarExtraccion()}>Detener</Boton>
        ) : (
          <Boton onClick={arrancar}>
            {hechos > 0
              ? `Seguir extrayendo — faltan ${num(Math.max(0, total - hechos))}`
              : "Extraer entidades"}
          </Boton>
        )}
        {!corriendo && hechos > 0 && !listo && (
          <span className="t-menor" style={{ color: "var(--t3)" }}>
            Retoma donde quedó: cada artículo se guarda al terminarlo.
          </span>
        )}
      </div>

      {horasArchivo != null && (
        <p className="t-menor" style={{ color: "var(--t3)", marginTop: "var(--esp-6)", maxWidth: "58ch", lineHeight: 1.7 }}>
          A {seg(medio)} s por artículo en CPU, pasar el modelo por las {num(universo)} piezas del
          archivo costaría unas {horasArchivo.toFixed(0)} horas de cómputo. Es tiempo de máquina, no
          de persona: se deja corriendo. El coste que decide la viabilidad sigue siendo el humano.
        </p>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: "var(--esp-11)", paddingTop: "var(--esp-6)", borderTop: "1px solid var(--borde)" }}>
          <Rotulo style={{ marginBottom: 12 }}>Registro</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {log.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 14 }}>
                <span className="t-mono" style={{ color: "var(--t3)" }}>{l.hora}</span>
                <span className="t-menor" style={{ color: "var(--t2)" }}>{l.texto}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: "var(--esp-8)" }}>
        <Glifo estado="exito" size={11} />
        <span className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.65, maxWidth: "58ch" }}>
          El modelo corre en un proceso hijo de este computador, sin abrir puertos ni enviar nada a
          ningún servidor. El texto del archivo no sale de aquí.
        </span>
      </div>
    </Lienzo>
  );
}

function Metrica({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="t-rotulo" style={{ marginBottom: 5 }}>{k}</div>
      <div style={{ fontSize: 15, color: "var(--t1)" }}>{v}</div>
    </div>
  );
}

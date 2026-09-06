import { useEffect, useState } from "react";
import { Barra, Boton, Cargando, Glifo, Lienzo, Rotulo } from "../ui";
import { hallazgosArchivo } from "../lib/ipc";
import type { Hallazgo } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");

export default function Sanidad({ estado }: { estado: EstadoApp }) {
  const { conexionId } = estado;
  const [hallazgos, setHallazgos] = useState<Hallazgo[] | null>(null);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [decisiones, setDecisiones] = useState<Record<string, string>>({});

  useEffect(() => {
    if (conexionId == null) return;
    hallazgosArchivo(conexionId).then(setHallazgos).catch(() => setHallazgos([]));
  }, [conexionId]);

  if (hallazgos === null) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 3 · Sanidad del archivo</Rotulo>
        <Cargando
          titulo="Revisando lo que se leyó"
          pasos={[
            { texto: "Buscar fechas imposibles" },
            { texto: "Buscar titulares repetidos" },
            { texto: "Buscar artículos sin sección" },
          ]}
          actual={0}
          nota="Se calcula sobre el censo que ya está en este computador: no vuelve a preguntarle a tu sitio."
        />
      </Lienzo>
    );
  }

  const resueltos = hallazgos.filter((h) => decisiones[h.clave]).length;
  const bloqueantes = hallazgos.filter((h) => h.bloquea);
  const bloqueantesResueltos = bloqueantes.every((h) => decisiones[h.clave]);
  const completo = resueltos === hallazgos.length;

  if (hallazgos.length === 0) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 3 · Sanidad del archivo</Rotulo>
        <h1 className="t-display" style={{ margin: "0 0 14px" }}>Sin hallazgos que decidir</h1>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-11)", maxWidth: "54ch" }}>
          El censo no encontró fechas dañadas, titulares repetidos ni artículos sin sección. Es un
          archivo inusualmente limpio: la muestra puede construirse sin reglas de exclusión.
        </p>
        <Boton onClick={() => estado.avanzar(3, "alcance")}>Elegir el alcance</Boton>
      </Lienzo>
    );
  }

  return (
    <Lienzo>
      <Rotulo style={{ marginBottom: 12 }}>Paso 3 · Sanidad del archivo</Rotulo>
      <h1 className="t-display" style={{ margin: "0 0 14px" }}>
        {hallazgos.length === 1 ? "Una decisión antes de muestrear" : `${escrito(hallazgos.length)} decisiones antes de muestrear`}
      </h1>
      <p className="t-cuerpo" style={{ margin: "0 0 var(--esp-8)", color: "var(--t2)", maxWidth: "56ch" }}>
        Son características del archivo, no errores del medio. Cada hallazgo abre ejemplos reales de
        tu instalación y pide una decisión.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: "var(--esp-8)" }}>
        <div style={{ flex: 1 }}><Barra pct={(resueltos / hallazgos.length) * 100} /></div>
        <span className="t-menor" style={{ color: "var(--t3)", whiteSpace: "nowrap" }}>
          {resueltos} de {hallazgos.length} resueltos
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {hallazgos.map((h) => {
          const abierto = !!abiertos[h.clave];
          const decidido = decisiones[h.clave];
          return (
            <div key={h.clave} style={{ borderBottom: "1px solid var(--borde)" }}>
              <button
                onClick={() => setAbiertos({ ...abiertos, [h.clave]: !abierto })}
                style={{ width: "100%", display: "grid", gridTemplateColumns: "16px 1fr auto 18px", alignItems: "baseline", gap: 12, appearance: "none", background: "transparent", border: 0, padding: "16px 4px", cursor: "pointer", textAlign: "left", color: "var(--t1)" }}
              >
                <Glifo estado={decidido ? "exito" : h.bloquea ? "advertencia" : "neutro"} />
                <span style={{ fontSize: 14.5 }}>{h.titulo}</span>
                <span className="t-menor" style={{ color: decidido ? "var(--t2)" : "var(--t3)" }}>
                  {decidido ?? `${num(h.conteo)}${h.estimado ? " aprox." : ""} · sin decidir`}
                </span>
                <span aria-hidden style={{ color: "var(--t3)", textAlign: "center" }}>{abierto ? "−" : "+"}</span>
              </button>

              {abierto && (
                <div style={{ padding: "0 4px 22px 28px" }}>
                  <p className="t-cuerpo" style={{ margin: "0 0 var(--esp-6)", color: "var(--t2)", maxWidth: "58ch" }}>
                    {h.detalle}
                    {h.estimado && (
                      <span style={{ color: "var(--t3)" }}>
                        {" "}El recuento es una estimación a partir del sondeo de contenido, no un
                        conteo exacto: depende del cuerpo del artículo, que el censo no descarga.
                      </span>
                    )}
                  </p>

                  {h.ejemplos.length > 0 && (
                    <>
                      <Rotulo style={{ marginBottom: 10 }}>Ejemplos de tu archivo</Rotulo>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: "var(--esp-6)" }}>
                        {h.ejemplos.map(([titulo, nota], i) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "7px 12px", background: "var(--hundida)", borderRadius: 6 }}>
                            <span className="t-menor" style={{ color: "var(--t1)" }}>{titulo}</span>
                            <span className="t-mono" style={{ color: "var(--t3)", whiteSpace: "nowrap" }}>{nota}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {h.consecuencia && (
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "11px 14px", background: "var(--advertencia-fondo)", borderRadius: 8, marginBottom: "var(--esp-6)" }}>
                      <Glifo estado="advertencia" size={11} />
                      <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65 }}>{h.consecuencia}</span>
                    </div>
                  )}

                  <Rotulo style={{ marginBottom: 10 }}>Tu decisión</Rotulo>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {h.opciones.map((o) => {
                      const elegida = decidido === o;
                      return (
                        <button
                          key={o}
                          onClick={() => { setDecisiones({ ...decisiones, [h.clave]: o }); setAbiertos({ ...abiertos, [h.clave]: false }); }}
                          style={{ appearance: "none", cursor: "pointer", borderRadius: 8, padding: "8px 14px", fontSize: 13, fontFamily: "var(--font-sans)", background: elegida ? "var(--acento-suave)" : "transparent", border: `1px solid ${elegida ? "var(--acento)" : "var(--borde)"}`, color: elegida ? "var(--t1)" : "var(--t2)" }}
                        >
                          {o}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: "var(--esp-11)", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <Boton onClick={() => estado.avanzar(3, "alcance")} disabled={!bloqueantesResueltos}>
          Elegir el alcance
        </Boton>
        <span className="t-menor" style={{ color: "var(--t3)", maxWidth: "44ch", lineHeight: 1.6 }}>
          {!bloqueantesResueltos
            ? "Los hallazgos marcados con ▲ impiden estratificar mientras no se decidan."
            : completo
            ? "Listo: la muestra puede construirse con estas reglas."
            : `Puedes seguir: los ${hallazgos.length - resueltos} sin decidir no bloquean, pero quedan registrados como pendientes.`}
        </span>
      </div>
    </Lienzo>
  );
}

const ESCRITO = ["cero", "Una", "Dos", "Tres", "Cuatro", "Cinco", "Seis", "Siete", "Ocho", "Nueve"];
const escrito = (n: number) => ESCRITO[n] ?? String(n);

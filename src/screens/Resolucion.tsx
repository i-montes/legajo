import { useCallback, useEffect, useState } from "react";
import { Boton, Glifo, Lienzo, Rotulo } from "../ui";
import { avanceResolucion, casosResolucion, decidirResolucion, muestraActual } from "../lib/ipc";
import { colorTipo, TIPOS } from "../contenido/tipos";
import type { Candidata, Caso } from "../types";
import type { EstadoApp } from "../App";

const ACCIONES = [
  { k: "fusionar", etiqueta: "Fusionar", tecla: "F", primaria: true },
  { k: "separar", etiqueta: "Separar", tecla: "S", primaria: false },
  { k: "posponer", etiqueta: "No decidir", tecla: "D", primaria: false },
];

const etiquetaTipo = (k: string) => TIPOS.find((t) => t.k === k)?.etiqueta ?? k;

export default function Resolucion({ estado }: { estado: EstadoApp }) {
  const { conexionId } = estado;
  const [designId, setDesignId] = useState<number | null>(null);
  const [casos, setCasos] = useState<Caso[] | null>(null);
  const [i, setI] = useState(0);
  const [hechos, setHechos] = useState(0);
  const [pospuestos, setPospuestos] = useState(0);

  useEffect(() => {
    if (conexionId == null) return;
    muestraActual(conexionId).then((m) => {
      if (!m) { setCasos([]); return; }
      setDesignId(m[0]);
      casosResolucion(m[0]).then(setCasos).catch(() => setCasos([]));
      avanceResolucion(m[0]).then(([d, p]) => { setHechos(d); setPospuestos(p); });
    });
  }, [conexionId]);

  const caso = casos?.[i];

  const decidir = useCallback(async (accion: string) => {
    if (designId == null || !caso) return;
    await decidirResolucion(
      designId, caso.clave, caso.a.nombre, caso.b.nombre, caso.tipo, accion, caso.confianza
    ).catch(() => {});
    if (accion === "posponer") setPospuestos((p) => p + 1);
    else setHechos((h) => h + 1);
    setI((v) => v + 1);
  }, [designId, caso]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const k = e.key.toLowerCase();
      if (k === "f") void decidir("fusionar");
      if (k === "s") void decidir("separar");
      if (k === "d") void decidir("posponer");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [decidir]);

  if (casos === null) {
    return <Lienzo><p className="t-cuerpo" style={{ color: "var(--t3)" }}>Buscando casos dudosos…</p></Lienzo>;
  }

  if (casos.length === 0) {
    return (
      <Lienzo>
        <Rotulo style={{ marginBottom: 12 }}>Paso 7 · Resolución de entidades</Rotulo>
        <h1 className="t-display" style={{ margin: "0 0 14px" }}>Nada que desambiguar</h1>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-8)", maxWidth: "52ch" }}>
          Ninguna pareja de entidades anotadas se parece lo bastante como para dudar. Si acabas de
          empezar a anotar, la cola se llenará según avances: los casos salen de lo que marcas.
        </p>
        <Boton onClick={() => estado.avanzar(7, "reporte")}>Ver el reporte</Boton>
      </Lienzo>
    );
  }

  if (!caso) {
    return (
      <Lienzo>
        <div style={{ textAlign: "center", paddingTop: "var(--esp-16)" }}>
          <h2 className="t-display" style={{ fontSize: 28, margin: "0 0 12px" }}>Cola resuelta</h2>
          <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 auto var(--esp-8)", maxWidth: "46ch" }}>
            {pospuestos > 0
              ? `Decidiste ${hechos} casos y dejaste ${pospuestos} pendientes. Vuelven a la cola cuando haya más menciones que los desempaten.`
              : `Decidiste los ${hechos} casos de la cola.`}
          </p>
          <Boton onClick={() => estado.avanzar(7, "reporte")}>Ver el reporte</Boton>
        </div>
      </Lienzo>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 20, padding: "12px 24px", borderBottom: "1px solid var(--borde)" }}>
        <span className="t-menor" style={{ color: "var(--t2)" }}>Caso {i + 1} de {casos.length}</span>
        <div style={{ flex: 1 }} />
        <span className="t-menor" style={{ color: "var(--t3)" }}>
          {hechos} decididos{pospuestos > 0 ? ` · ${pospuestos} pendientes` : ""}
        </span>
      </div>

      <Lienzo ancho={900}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: colorTipo(caso.tipo), display: "block" }} />
            <span className="t-rotulo">{etiquetaTipo(caso.tipo)}</span>
          </span>
          <span className="t-menor" style={{ color: "var(--t3)" }}>
            confianza {caso.confianza.toFixed(2).replace(".", ",")} · {caso.motivo}
          </span>
        </div>

        <h1 className="t-display" style={{ margin: "0 0 var(--esp-8)" }}>¿Son la misma entidad?</h1>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--esp-6)" }}>
          <Tarjeta c={caso.a} rotulo="Candidato A" />
          <Tarjeta c={caso.b} rotulo="Candidato B" />
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: "var(--esp-8)", flexWrap: "wrap" }}>
          {ACCIONES.map((a) => (
            <button
              key={a.k}
              onClick={() => void decidir(a.k)}
              style={{
                appearance: "none", cursor: "pointer", borderRadius: 8, padding: "10px 18px",
                fontFamily: "var(--font-sans)", fontSize: 14, display: "flex", alignItems: "center", gap: 10,
                background: a.primaria ? "var(--acento)" : "transparent",
                color: a.primaria ? "var(--bg)" : "var(--t1)",
                border: `1px solid ${a.primaria ? "var(--acento)" : "var(--borde)"}`,
              }}
            >
              {a.etiqueta}
              <span className="t-mono" style={{ fontSize: 11, opacity: 0.7 }}>{a.tecla}</span>
            </button>
          ))}
        </div>

        <p className="t-menor" style={{ color: "var(--t3)", marginTop: "var(--esp-6)", maxWidth: "56ch", lineHeight: 1.7 }}>
          Todo el caso se resuelve con una tecla. «No decidir» lo devuelve a la cola sin penalizarlo:
          con más menciones puede quedar claro lo que ahora no lo está.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginTop: "var(--esp-8)", paddingTop: "var(--esp-4)", borderTop: "1px solid var(--borde)" }}>
          <Glifo estado="neutro" size={11} />
          <span className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.65, maxWidth: "58ch" }}>
            Los casos salen de las entidades que anotaste a mano y van del más dudoso al más claro:
            es donde tu juicio rinde más. Uno con confianza 0,95 casi se decide solo.
          </span>
        </div>
      </Lienzo>
    </div>
  );
}

function Tarjeta({ c, rotulo }: { c: Candidata; rotulo: string }) {
  return (
    <div style={{ border: "1px solid var(--borde)", borderRadius: 10, padding: "var(--esp-4)", background: "var(--superficie)" }}>
      <Rotulo style={{ marginBottom: 8 }}>{rotulo}</Rotulo>
      <div style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.35, marginBottom: 8 }}>{c.nombre}</div>
      <div className="t-menor" style={{ color: "var(--t3)" }}>
        {c.menciones} {c.menciones === 1 ? "mención" : "menciones"} en {c.articulos}{" "}
        {c.articulos === 1 ? "artículo" : "artículos"} de la muestra
      </div>
    </div>
  );
}

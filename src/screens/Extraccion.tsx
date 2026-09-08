import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Acciones, Aviso, Barra, Boton, Encabezado, Glifo, Latido, Lienzo, Razon, Rotulo, Rehacer } from "../ui";
import {
  alFinExtraccion, alProgresoExtraccion, avanceExtraccion, cancelarExtraccion,
  categoriasDelLote, deshacerExtraccion, extrayendo as consultarExtrayendo, iniciarExtraccion,
} from "../lib/ipc";
import type { CategoriaLote, ColaCategorias, ProgresoExtraccion } from "../types";
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

/** Una categoría con sus hijas colgando, para poder leer el árbol del medio. */
interface Rama extends CategoriaLote { hijas: CategoriaLote[] }

/* La cola llega plana con el padre de cada término. Se agrupa en dos niveles
   —madre y sus hijas— porque es como está organizada una redacción y como se
   eligió el alcance; más profundidad no aporta y estorba para elegir. Una hija
   cuya madre no está en el lote sube a la raíz en vez de desaparecer. */
function agrupar(cats: CategoriaLote[]): Rama[] {
  const porId = new Map(cats.map((c) => [c.term_id, c]));
  const ramas = new Map<number, Rama>();
  const raiz = (c: CategoriaLote) => {
    if (!ramas.has(c.term_id)) ramas.set(c.term_id, { ...c, hijas: [] });
    return ramas.get(c.term_id)!;
  };
  for (const c of cats) if (c.parent === 0 || !porId.has(c.parent)) raiz(c);
  for (const c of cats) {
    if (c.parent !== 0 && porId.has(c.parent)) raiz(porId.get(c.parent)!).hijas.push(c);
  }
  const pend = (r: Rama) => r.pendientes + r.hijas.reduce((a, h) => a + h.pendientes, 0);
  return [...ramas.values()]
    .map((r) => ({ ...r, hijas: r.hijas.sort((a, b) => b.pendientes - a.pendientes) }))
    .sort((a, b) => pend(b) - pend(a) || a.nombre.localeCompare(b.nombre, "es"));
}

export default function Extraccion({ estado }: { estado: EstadoApp }) {
  const { loteId } = estado;
  const [cola, setCola] = useState<ColaCategorias | null>(null);
  const [categoria, setCategoria] = useState<number | null>(null);
  const [hechos, setHechos] = useState(0);
  const [total, setTotal] = useState(0);
  const [prog, setProg] = useState<ProgresoExtraccion | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<Linea[]>([]);
  const [entidades, setEntidades] = useState(0);
  /* Con qué se está extrayendo, dicho por el extractor al cargar: el modelo y
     el dispositivo. Antes era un texto fijo que decía «CPU» aunque corriera en
     el GPU. */
  const [motor, setMotor] = useState<string | null>(null);
  const tiempos = useRef<number[]>([]);

  const anotar = (texto: string) =>
    setLog((l) => [{ hora: new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }), texto }, ...l].slice(0, 12));

  const refrescarCola = useCallback(() => {
    if (loteId == null) return;
    categoriasDelLote(loteId).then(setCola).catch((e) => setError(String(e)));
  }, [loteId]);

  const refrescarAvance = useCallback(() => {
    if (loteId == null) return;
    avanceExtraccion(loteId, false, categoria).then(([h, t]) => { setHechos(h); setTotal(t); });
  }, [loteId, categoria]);

  useEffect(() => { refrescarCola(); }, [refrescarCola]);
  useEffect(() => { refrescarAvance(); }, [refrescarAvance]);
  useEffect(() => { consultarExtrayendo().then(setCorriendo); }, [loteId]);

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
      /* Descargar aquí es la excepción: el texto llegó con el censo. Solo pasa
         con archivos leídos por una versión anterior, o con piezas cuyo cuerpo
         llegó vacío. Se anuncia porque una pausa de red sin explicación se lee
         como un cuelgue, y porque avisa de que el censo quedó a medias. */
      if (p.fase === "descargando" && p.detalle !== "0") {
        anotar(`faltaban ${p.detalle} cuerpos por bajar: los trae ahora`);
      }
      if (p.fase === "cargando") anotar(`cargando el modelo ${p.detalle}`);
      if (p.fase === "cargado") { anotar(`modelo listo en ${seg(p.ms)} s · ${p.detalle}`); setMotor(p.detalle); }
      if (p.fase === "arrancando") anotar("arrancando el extractor");
    });
    const un2 = alFinExtraccion((f) => {
      setCorriendo(false);
      setProg(null);
      setError(f.error);
      anotar(f.cancelado ? "detenido por el usuario" : f.error ? `error: ${f.error}` : "categoría terminada");
      refrescarCola();
      refrescarAvance();
    });
    return () => { un1.then((u) => u()); un2.then((u) => u()); };
  }, [refrescarCola, refrescarAvance]);

  const ramas = useMemo(() => agrupar(cola?.categorias ?? []), [cola]);
  const elegida = useMemo(
    () => cola?.categorias.find((c) => c.term_id === categoria) ?? null,
    [cola, categoria],
  );
  const pendientesEnCola = (cola?.categorias ?? []).filter((c) => c.pendientes > 0);
  const sueltosPendientes = (cola?.sueltos ?? 0) - (cola?.sueltos_hechos ?? 0);

  /* La siguiente sin extraer, para no tener que volver al árbol a buscarla. La
     cola llega ordenada por lo que falta, así que la primera es la más grande. */
  const siguiente = pendientesEnCola.find((c) => c.term_id !== categoria) ?? null;

  async function arrancar(term: number | null) {
    if (loteId == null) return;
    setError(null);
    setCategoria(term);
    setCorriendo(true);
    tiempos.current = [];
    setEntidades(0);
    try {
      await iniciarExtraccion(loteId, false, term);
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
  const restante = corriendo && medio > 0 && total > hechos
    ? ((total - hechos) * medio) / 1000
    : null;

  if (cola && cola.categorias.length === 0 && cola.sueltos === 0) {
    return (
      <Lienzo>
        <Encabezado
          paso="extraccion"
          titulo="No hay nada que extraer todavía"
          frase="Este lote no tiene artículos. Vuelve al alcance y elige un trozo del archivo."
          compacto
        />
        <Boton onClick={() => estado.avanzar(3, "alcance")}>Ir al alcance</Boton>
      </Lienzo>
    );
  }

  const todoHecho = cola != null && pendientesEnCola.length === 0 && sueltosPendientes === 0;

  return (
    <Lienzo>
      <Encabezado
        paso="extraccion"
        titulo={todoHecho
          ? "Extracción terminada"
          : corriendo
            ? `Extrayendo ${elegida ? elegida.nombre : "lo que queda"}`
            : "Elige la categoría que se extrae"}
        frase={todoHecho
          ? "Todo el lote está procesado. El grafo ya recoge lo extraído."
          : corriendo
            ? "Es tiempo de máquina: puedes dejarlo correr. Detener no pierde lo hecho."
            : "Una categoría por corrida, con los cortes y el diccionario que salieron de tu revisión."}
        detalle={
          <>
            <Razon>El texto ya está en tu disco desde que se leyó el archivo, así que esto no le pide nada al servidor del medio: es cómputo puro y va a la velocidad de tu máquina.</Razon>
            <Razon>Cada artículo se guarda al terminarlo. Detener no pierde lo hecho y reanudar no lo repite.</Razon>
            <Razon>El modelo corre en un proceso hijo de este computador, sin abrir puertos ni enviar nada a ningún servidor.</Razon>
          </>
        }
      />

      {error && <Aviso estado="error">{error}</Aviso>}

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

      {/* La cola. Se oculta mientras corre: en mitad de una extracción lo que
          importa es cómo va, y una lista de botones que no se pueden pulsar
          solo compite por la atención. */}
      {!corriendo && !todoHecho && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Rotulo style={{ marginBottom: 12 }}>Cola de trabajo</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {ramas.map((r) => (
              <div key={r.term_id}>
                <FilaCategoria c={r} elegida={categoria === r.term_id} onElegir={setCategoria} />
                {r.hijas.map((h) => (
                  <FilaCategoria key={h.term_id} c={h} sangria elegida={categoria === h.term_id} onElegir={setCategoria} />
                ))}
              </div>
            ))}
          </div>
          <p className="t-menor" style={{ color: "var(--t3)", marginTop: "var(--esp-6)", maxWidth: "58ch", lineHeight: 1.7 }}>
            Elegir una categoría madre arrastra sus hijas. Un artículo que lleva las dos —lo normal
            en WordPress— se extrae una sola vez, y al hacerlo baja el pendiente de ambas.
            {sueltosPendientes > 0 && (
              <>
                {" "}Quedan {num(sueltosPendientes)} artículos sin ninguna categoría: no salen en esta
                lista y solo los recoge «extraer lo que quede».
              </>
            )}
          </p>
        </div>
      )}

      {(corriendo || hechos > 0 || categoria != null) && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--font-serif-display)", fontSize: 30, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
              {pct.toFixed(0)} %
            </span>
            <span className="t-menor" style={{ color: "var(--t3)" }}>
              {/* Las entidades se cuentan desde que arrancó esta corrida, no
                  desde el principio del lote: decir «0 propuestas» sobre una
                  extracción que ya guardó miles, solo porque la ventana se
                  acaba de abrir, parece que no hubiera funcionado. */}
              {elegida ? `${elegida.nombre} · ` : corriendo ? "" : "todo el lote · "}{num(hechos)} de {num(total)} artículos
              {entidades > 0 ? ` · ${num(entidades)} entidades en esta corrida` : ""}
            </span>
          </div>
          <Barra pct={pct} alto={4} />

          <div style={{ display: "flex", gap: "var(--esp-11)", marginTop: "var(--esp-8)", flexWrap: "wrap" }}>
            <Metrica k="Velocidad medida" v={medio > 0 ? `${seg(medio)} s por artículo` : "—"} />
            {restante != null && <Metrica k="Falta" v={duracion(restante)} />}
            <Metrica k="Origen del texto" v="Tu disco · sin red" />
            <Metrica k="Modelo" v={motor ?? "GLiNER relex"} />
          </div>
        </>
      )}

      {/* Reanudar un trabajo se nombra por el trabajo y por lo que queda, no
          con un «continuar» que se confunde con avanzar de paso. */}
      <Acciones
        raya={false}
        nota={!corriendo && hechos > 0 && !listo ? "Retoma donde quedó: cada artículo se guarda al terminarlo." : undefined}
      >
        {corriendo ? (
          <Boton variante="secundario" onClick={() => cancelarExtraccion()}>Detener</Boton>
        ) : todoHecho ? (
          <>
            <Boton onClick={() => estado.avanzar(7, "grafo")}>Ver el grafo</Boton>
            <Rehacer
              enlace="volver a extraer todo el lote"
              accion="Borrar las propuestas y extraer el lote otra vez"
              costo="Borra lo que el modelo propuso sobre todo el lote y lo pone otra vez en la cola, categoría por categoría. Las marcas hechas a mano se quedan."
              onConfirmar={async () => {
                if (loteId == null) return;
                try {
                  const n = await deshacerExtraccion(loteId, false);
                  anotar(`${num(n)} artículos vuelven a la cola`);
                  refrescarCola(); refrescarAvance();
                } catch (e) { setError(String(e)); }
              }}
            />
          </>
        ) : (
          <>
            <Boton
              onClick={() => arrancar(categoria)}
              disabled={categoria == null}
            >
              {categoria == null
                ? "Elige una categoría"
                : listo
                  ? `${elegida?.nombre} ya está lista`
                  : hechos > 0
                    ? `Seguir con ${elegida?.nombre} — faltan ${num(Math.max(0, total - hechos))}`
                    : `Extraer ${elegida?.nombre} — ${num(total)} artículos`}
            </Boton>
            {siguiente && (
              <Boton variante="secundario" onClick={() => arrancar(siguiente.term_id)}>
                Siguiente: {siguiente.nombre} ({num(siguiente.pendientes)})
              </Boton>
            )}
            {/* Los artículos sin ninguna categoría no salen en la cola, así
                que su botón es el único sitio desde donde se los alcanza. */}
            {sueltosPendientes > 0 && (
              <Boton variante="secundario" onClick={() => arrancar(null)}>
                Extraer lo que quede ({num(sueltosPendientes)})
              </Boton>
            )}
            {/* Volver a extraer una categoría ya hecha —porque cambió el
                modelo, las reglas o la calibración— es una operación normal.
                Sin esto la única salida era crear otro lote. */}
            {categoria != null && elegida && elegida.extraidos > 0 && (
              <Rehacer
                enlace={`volver a extraer ${elegida.nombre}`}
                accion={`Borrar y extraer ${elegida.nombre} otra vez`}
                costo={<>Borra lo que el modelo propuso sobre los {num(elegida.extraidos)} artículos ya
                  extraídos de «{elegida.nombre}» y los pone otra vez en la cola. Las marcas hechas a mano
                  se quedan.</>}
                onConfirmar={async () => {
                  if (loteId == null) return;
                  try {
                    const n = await deshacerExtraccion(loteId, false, categoria);
                    anotar(`${num(n)} artículos vuelven a la cola`);
                    refrescarCola();
                    await arrancar(categoria);
                  } catch (e) { setError(String(e)); }
                }}
              />
            )}
            {/* El grafo se puede mirar con lo que ya haya: no hace falta
                terminar el lote entero para ver qué va saliendo. */}
            {!todoHecho && (cola?.categorias.some((c) => c.extraidos > 0) || (cola?.sueltos_hechos ?? 0) > 0) && (
              <Boton variante="enlace" onClick={() => estado.avanzar(7, "grafo")}>ver el grafo con lo extraído hasta ahora</Boton>
            )}
          </>
        )}
      </Acciones>

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

    </Lienzo>
  );
}

function FilaCategoria(
  { c, sangria, elegida, onElegir }:
  { c: CategoriaLote; sangria?: boolean; elegida: boolean; onElegir: (id: number) => void },
) {
  const hecha = c.pendientes === 0;
  const pct = c.total > 0 ? (c.extraidos / c.total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={() => onElegir(c.term_id)}
      style={{
        display: "flex", alignItems: "baseline", gap: 12, width: "100%",
        padding: "9px 12px", paddingLeft: sangria ? 30 : 12,
        background: elegida ? "var(--acento-suave)" : "transparent",
        border: "none", borderRadius: 6, cursor: "pointer", textAlign: "left",
        opacity: hecha && !elegida ? 0.5 : 1,
      }}
    >
      <span style={{ width: 11, flexShrink: 0 }}>
        {hecha && <Glifo estado="exito" size={11} />}
      </span>
      <span className="t-ui" style={{ flex: 1, color: "var(--t1)" }}>{c.nombre}</span>
      <span className="t-mono" style={{ color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>
        {hecha ? `${num(c.total)} hechos` : `${num(c.pendientes)} de ${num(c.total)}`}
      </span>
      <span style={{ width: 54, flexShrink: 0 }}>
        <Barra pct={pct} alto={3} />
      </span>
    </button>
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

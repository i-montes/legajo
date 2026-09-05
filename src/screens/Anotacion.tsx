import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Barra, Boton, Glifo, Latido, Lienzo, Rotulo } from "../ui";
import { TIPOS, colorTipo, predicadosPara } from "../contenido/tipos";
import {
  apuntarTiempo, avanceAnotacion, cargarAnotacion, cerrarArticulo, descartarTiempo, guardarAnotacion,
  lexico as cargarLexico, muestra as cargarMuestra, muestraActual,
  reanudarAnotacion, tiempoArticulo,
} from "../lib/ipc";
import {
  aplicarLexico, arbolDeParrafo, cabeAnidada, gruposDeAlias, nuevoId,
  propagarEnDocumento, sePropaga, soltarAlias, unirAlias,
} from "../lib/propagacion";
import type { Nodo } from "../lib/propagacion";
import { ETIQUETA_RELOJ, mmss, useCronometro } from "../lib/cronometro";
import { revisar } from "../lib/revision";
import type { EntradaLexico, FilaAnotable, Mencion, RelacionFila } from "../types";
import type { EstadoApp } from "../App";

interface Punto { x: number; y: number }
interface Pendiente { pi: number; ini: number; fin: number; texto: string }


export default function Anotacion({ estado }: { estado: EstadoApp }) {
  const { conexionId } = estado;

  const [designId, setDesignId] = useState<number | null>(null);
  const [filas, setFilas] = useState<FilaAnotable[] | null>(null);
  const [i, setI] = useState(0);
  const [menciones, setMenciones] = useState<Mencion[]>([]);
  const [relaciones, setRelaciones] = useState<RelacionFila[]>([]);
  const [relSel, setRelSel] = useState<string[]>([]);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [punto, setPunto] = useState<Punto | null>(null);
  const [relPicker, setRelPicker] = useState(false);
  const [panel, setPanel] = useState(true);
  const reloj = useCronometro();
  const crono = reloj.segundos;
  const [crudo, setCrudo] = useState(false);
  const [lexico, setLexico] = useState<EntradaLexico[]>([]);
  const [ultimaPropagacion, setUltimaPropagacion] = useState<{ texto: string; n: number } | null>(null);
  const [preMarcadas, setPreMarcadas] = useState(0);
  /* Al pasar el ratón por una relación se iluminan sus dos marcas en el texto.
     Es la única forma de saber cuál de los dos «50 mil millones» es: en el
     panel las dos filas se leen igual. */
  const [relResaltada, setRelResaltada] = useState<string[]>([]);
  const [hechos, setHechos] = useState(0);
  const lienzo = useRef<HTMLDivElement>(null);

  const fila = filas?.[i];
  const parrafos = useMemo(
    () => (fila?.texto ?? "").split("\n\n").filter((p) => p.trim().length > 0),
    [fila?.texto]
  );

  // ── carga de la muestra ────────────────────────────────────────────────
  /* Al abrir se reanuda en el primer artículo sin cerrar, no en el primero de
     la muestra. Volver al índice cero obligaría a repasar lo ya anotado y, peor,
     el cronómetro contaría de nuevo tiempo sobre artículos ya medidos: la cifra
     de minutos por artículo es justo lo que la fase existe para producir. */
  useEffect(() => {
    if (conexionId == null) return;
    muestraActual(conexionId).then(async (m) => {
      if (!m) { setFilas([]); return; }
      const design = m[0];
      setDesignId(design);
      const [lista, avance, siguiente] = await Promise.all([
        cargarMuestra(design),
        avanceAnotacion(design),
        reanudarAnotacion(design).catch(() => null),
      ]);
      setFilas(lista);
      setHechos(avance[0]);
      cargarLexico(design).then(setLexico).catch(() => {});
      if (siguiente != null) {
        const idx = lista.findIndex((f) => f.wp_id === siguiente);
        if (idx >= 0) setI(idx);
      } else if (lista.length > 0) {
        // Todo cerrado: se muestra la pantalla final, no el primer artículo.
        setI(lista.length);
      }
    });
  }, [conexionId]);

  // Al cambiar de artículo se recuperan sus anotaciones y arranca el reloj.
  useEffect(() => {
    if (designId == null || !fila) return;
    const wp = fila.wp_id;
    setRelSel([]); setPendiente(null); setPunto(null); setRelPicker(false); setCrudo(false);
    setUltimaPropagacion(null);
    Promise.all([cargarAnotacion(designId, wp), tiempoArticulo(designId, wp).catch(() => 0)])
      .then(([[ms, rs], segundos]) => {
        setRelaciones(rs);
        // El cronómetro continúa desde lo ya invertido, no desde cero.
        reloj.reiniciar(segundos);

        /* Un artículo virgen se pre-marca con lo aprendido en los anteriores.
           Nunca sobre uno ya trabajado: pisar el criterio de la persona con
           propuestas de la máquina sería peor que no proponer nada. */
        if (ms.length > 0) {
          setMenciones(ms);
          setPreMarcadas(0);
          return;
        }
        const previas = aplicarLexico(parrafos, lexico);
        setMenciones(previas);
        setPreMarcadas(previas.length);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designId, fila?.wp_id, lexico]);


  // El guardado es automático: perder media hora de anotación por olvidar
  // pulsar un botón es inaceptable en un trabajo que se mide en horas.
  useEffect(() => {
    if (designId == null || !fila) return;
    const t = setTimeout(() => {
      guardarAnotacion(designId, fila.wp_id, menciones, relaciones).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [designId, fila?.wp_id, menciones, relaciones]);

  /* El cronómetro también se persiste cada diez segundos, sin marcar el
     artículo como terminado. Cerrar la ventana a mitad no debe borrar los
     minutos ya puestos: son parte del coste real que la fase mide. */
  useEffect(() => {
    if (designId == null || !fila || reloj.estado !== "corriendo") return;
    const t = setInterval(() => {
      apuntarTiempo(designId, fila.wp_id, crono, menciones.length).catch(() => {});
    }, 10_000);
    return () => clearInterval(t);
  }, [designId, fila?.wp_id, reloj.estado, crono, menciones.length]);

  // Y una última vez al cerrar la ventana, para no perder los segundos sueltos.
  useEffect(() => {
    const alSalir = () => {
      if (designId == null || !fila) return;
      apuntarTiempo(designId, fila.wp_id, crono, menciones.length).catch(() => {});
      guardarAnotacion(designId, fila.wp_id, menciones, relaciones).catch(() => {});
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [designId, fila?.wp_id, crono, menciones, relaciones]);

  /* Moverse entre artículos guarda lo anotado pero NO registra un cierre.
     Antes, pasar de largo con J/K dejaba una medición de un segundo que entraba
     en la mediana: la mitad del ruido de los primeros veinte artículos venía
     de ahí. Solo «Cerrar y seguir» da un artículo por terminado. */
  const irArticulo = useCallback(async (d: number) => {
    if (designId == null || !filas) return;
    const actual = filas[i];
    if (actual) {
      await guardarAnotacion(designId, actual.wp_id, menciones, relaciones).catch(() => {});
      await apuntarTiempo(designId, actual.wp_id, crono, menciones.length).catch(() => {});
    }
    setI((v) => Math.max(0, Math.min(filas.length, v + d)));
  }, [designId, filas, i, menciones, relaciones, crono]);

  const cerrarYSeguir = useCallback(async () => {
    if (designId == null || !filas) return;
    const actual = filas[i];
    if (actual) {
      await guardarAnotacion(designId, actual.wp_id, menciones, relaciones).catch(() => {});
      await cerrarArticulo(designId, actual.wp_id, crono, menciones.length).catch(() => {});
      avanceAnotacion(designId).then(([h]) => setHechos(h));
    }
    setI((v) => Math.min(filas.length, v + 1));
  }, [designId, filas, i, menciones, relaciones, crono]);

  const descartarMedicion = useCallback(async () => {
    if (designId == null || !fila) return;
    await descartarTiempo(designId, fila.wp_id).catch(() => {});
    reloj.reiniciar(0);
    avanceAnotacion(designId).then(([h]) => setHechos(h));
  }, [designId, fila?.wp_id]);

  /* Nada de efectos dentro de un actualizador de estado: React los invoca dos
     veces en modo estricto para detectar actualizadores impuros, y eso añadía
     la marca por duplicado. Dos marcas con el mismo tramo hacían que el pintado
     escribiera el texto dos veces. */
  /* Marcar una entidad marca de paso todas sus demás apariciones en el mismo
     artículo. Es lo que baja de verdad los minutos por artículo: en una nota
     larga, un nombre propio aparece cinco o seis veces y marcarlas a mano una
     por una es trabajo mecánico que no aporta juicio. */
  const marcar = useCallback((tipo: string) => {
    if (!pendiente) return;
    const nueva: Mencion = {
      mid: nuevoId(), pi: pendiente.pi, ini: pendiente.ini,
      fin: pendiente.fin, texto: pendiente.texto, tipo, auto: false,
    };
    setMenciones((ms) => {
      if (!cabeAnidada(nueva, ms)) return ms;
      const conNueva = [...ms, nueva];
      const gemelas = propagarEnDocumento(parrafos, pendiente.texto, tipo, conNueva);
      if (gemelas.length > 0) {
        setUltimaPropagacion({ texto: pendiente.texto, n: gemelas.length });
      }
      return [...conNueva, ...gemelas];
    });
    setPendiente(null);
    setPunto(null);
    window.getSelection()?.removeAllRanges();
  }, [pendiente, parrafos]);

  const crearRelacion = useCallback((pred: string) => {
    if (relSel.length !== 2) return;
    const [a, b] = relSel;
    setRelaciones((rs) =>
      rs.some((r) => r.a_mid === a && r.b_mid === b && r.predicado === pred)
        ? rs
        : [...rs, { rid: nuevoId(), a_mid: a, b_mid: b, predicado: pred }]
    );
    setRelSel([]);
    setRelPicker(false);
  }, [relSel]);

  /* Declarar que dos menciones nombran la misma entidad.
     No es una relación: «Ómar Yepes» y «Yepes» son la misma persona, mientras
     que «presupuesto de inversión» y «presupuesto» son cosas distintas unidas
     por «parte de». Confundirlas dejaría una entidad con dos cifras
     contradictorias atribuidas a la vez. */
  const enlazarAlias = useCallback(() => {
    if (relSel.length !== 2) return;
    setMenciones((ms) => unirAlias(ms, relSel[0], relSel[1]));
    setRelSel([]);
    setRelPicker(false);
    setPunto(null);
  }, [relSel]);

  /* Los predicados que tienen sentido entre las dos marcas elegidas. Filtrar
     por tipo evita tanto la lista de trece opciones como afirmar que un monto
     ocupa un cargo. */
  const predicadosDisponibles = useCallback(() => {
    const a = menciones.find((m) => m.mid === relSel[0]);
    const b = menciones.find((m) => m.mid === relSel[1]);
    return predicadosPara(a?.tipo ?? "", b?.tipo ?? "");
  }, [menciones, relSel]);

  const invertirRelacion = useCallback(() => {
    setRelSel((sel) => (sel.length === 2 ? [sel[1], sel[0]] : sel));
  }, []);

  const abrirRelacion = useCallback(() => {
    if (relSel.length !== 2 || !lienzo.current) return;
    const el = lienzo.current.querySelector(`[data-mid="${relSel[1]}"]`);
    if (el) {
      const wr = lienzo.current.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setPunto({
        x: Math.max(12, Math.min(r.left - wr.left, lienzo.current.clientWidth - 260)),
        y: r.bottom - wr.top + lienzo.current.scrollTop + 10,
      });
    }
    setRelPicker(true);
    setPendiente(null);
  }, [relSel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") { setPendiente(null); setPunto(null); setRelPicker(false); setRelSel([]); return; }
      if (pendiente && /^[1-8]$/.test(e.key)) { e.preventDefault(); return marcar(TIPOS[+e.key - 1].k); }
      if (relPicker && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const opciones = predicadosDisponibles();
        const p = opciones[+e.key - 1];
        return p ? crearRelacion(p.etiqueta) : undefined;
      }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); return abrirRelacion(); }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); return enlazarAlias(); }
      if ((e.key === "Backspace" || e.key === "Delete") && relSel.length) {
        e.preventDefault();
        setMenciones((ms) => ms.filter((m) => !relSel.includes(m.mid)));
        setRelaciones((rs) => rs.filter((r) => !relSel.includes(r.a_mid) && !relSel.includes(r.b_mid)));
        return setRelSel([]);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); return setPanel((p) => !p); }
      if (e.key === "j" || e.key === "J") { e.preventDefault(); void irArticulo(1); return; }
      if (e.key === "k" || e.key === "K") { e.preventDefault(); void irArticulo(-1); return; }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendiente, relPicker, relSel, marcar, crearRelacion, abrirRelacion, enlazarAlias,
      irArticulo, predicadosDisponibles]);

  function alSoltar() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const nodo = range.startContainer;
    const anchor = nodo.nodeType === 3 ? nodo.parentElement : (nodo as HTMLElement);
    const el = anchor?.closest("[data-p]") as HTMLElement | null;
    if (!el || !lienzo.current) return;

    const pi = Number(el.getAttribute("data-p"));
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    let ini = pre.toString().length;
    let texto = range.toString();
    ini += texto.length - texto.replace(/^\s+/, "").length;
    texto = texto.trim();
    if (texto.length < 2) return;
    const fin = ini + texto.length;
    // Se admite marcar dentro de otra marca, o alrededor de ella. Lo único que
    // se rechaza es el cruce a medias, que no se puede representar.
    if (!cabeAnidada({ pi, ini, fin }, menciones)) { sel.removeAllRanges(); return; }

    const r = range.getBoundingClientRect();
    const wr = lienzo.current.getBoundingClientRect();
    setPendiente({ pi, ini, fin, texto });
    setPunto({
      x: Math.max(12, Math.min(r.left - wr.left, lienzo.current.clientWidth - 240)),
      y: r.bottom - wr.top + lienzo.current.scrollTop + 10,
    });
    setRelPicker(false);
    setRelSel([]);
  }

  /* El panel agrupa por texto solo donde repetirse significa referirse a lo
     mismo. En los montos no: «50 mil millones» para la universidad y «50 mil
     millones» para el seguro de salud son dinero distinto, y colapsarlos en una
     fila esconde una de las dos y deja una sola × para borrar ambas. */
  const grupos = useMemo(
    () =>
      TIPOS.map((t) => {
        const items = menciones.filter((m) => m.tipo === t.k);
        if (!items.length) return null;
        const filas = sePropaga(t.k)
          ? Array.from(new Set(items.map((m) => m.texto))).map((texto) => ({
              texto,
              mids: items.filter((m) => m.texto === texto).map((m) => m.mid),
            }))
          : items.map((m) => ({ texto: m.texto, mids: [m.mid] }));
        return { tipo: t, n: items.length, formas: filas.length, filas };
      }).filter(Boolean) as {
        tipo: (typeof TIPOS)[number];
        n: number;
        formas: number;
        filas: { texto: string; mids: string[] }[];
      }[],
    [menciones]
  );

  /* Pinta un párrafo con sus marcas, incluidas las anidadas.
     El subrayado de cada nivel se separa un poco del de dentro, para que
     «Antioquia» dentro de «Gobernador de Antioquia» se distingan a la vista. */
  function pintar(nodos: Nodo[], hondura = 0): React.ReactNode[] {
    return nodos.map((n, k) => {
      if (n.clase === "texto") return <span key={"t" + k}>{n.texto}</span>;
      const m = n.m;
      const c = colorTipo(m.tipo);
      const activa = relSel.includes(m.mid);
      const enRelacion = relResaltada.includes(m.mid);
      return (
        <span
          key={m.mid}
          data-mid={m.mid}
          onClick={(e) => {
            // Sin esto, pulsar la marca de dentro seleccionaría también la de
            // fuera y no habría forma de relacionar la interior con nada.
            e.stopPropagation();
            setMenciones((ms) => ms.map((x) => (x.mid === m.mid && x.auto ? { ...x, auto: false } : x)));
            setRelSel((cur) => (cur.includes(m.mid) ? cur.filter((x) => x !== m.mid) : [...cur, m.mid].slice(-2)));
          }}
          style={{
            // Punteado si la propuso la máquina: se ve de un vistazo qué falta
            // por revisar sin tener que leer.
            borderBottom: `1.5px ${m.auto ? "dotted" : "solid"} ${c}`,
            paddingBottom: hondura * 3,
            background: `color-mix(in srgb, ${c} var(--marca-alfa), transparent)`,
            boxShadow: activa ? `0 0 0 2px ${c}` : enRelacion ? "0 0 0 2px var(--acento)" : "none",
            borderRadius: activa || enRelacion ? 2 : 0,
            cursor: "pointer",
          }}
        >
          {pintar(n.hijos, hondura + 1)}
        </span>
      );
    });
  }


  // ── estados vacíos ─────────────────────────────────────────────────────
  if (filas === null) {
    return <Lienzo><p className="t-cuerpo" style={{ color: "var(--t3)" }}>Cargando la muestra…</p></Lienzo>;
  }
  if (filas.length === 0) {
    return (
      <Lienzo>
        <h2 className="t-display" style={{ fontSize: 26, margin: "0 0 12px" }}>No hay muestra todavía</h2>
        <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 0 var(--esp-8)", maxWidth: "46ch" }}>
          Vuelve al paso de muestreo, sortea una muestra y descárgala.
        </p>
        <Boton onClick={() => estado.avanzar(3, "muestreo")}>Ir al muestreo</Boton>
      </Lienzo>
    );
  }
  if (!fila) {
    const seg = Math.max(1, hechos);
    return (
      <Lienzo>
        <div style={{ textAlign: "center", paddingTop: "var(--esp-16)" }}>
          <h2 className="t-display" style={{ fontSize: 28, margin: "0 0 12px" }}>Muestra anotada</h2>
          <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 auto var(--esp-8)", maxWidth: "46ch" }}>
            Cerraste los {seg} artículos de la muestra. El tiempo de cada uno quedó guardado en este
            computador: es lo que convierte el diagnóstico en una cifra de coste real.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
            <Boton onClick={() => estado.avanzar(5, "extraccion")}>Continuar a la extracción</Boton>
            <Boton variante="enlace" onClick={() => setI(0)}>volver al primero</Boton>
          </div>
        </div>
      </Lienzo>
    );
  }

  const total = filas.length;
  const sinCuerpo = !fila.texto;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 16, padding: "12px 24px", borderBottom: "1px solid var(--borde)" }}>
        <span className="t-menor" style={{ color: "var(--t2)", whiteSpace: "nowrap" }}>
          Artículo {i + 1} de {total}
        </span>
        <div style={{ width: 150 }}><Barra pct={(hechos / total) * 100} /></div>
        <span className="t-menor" style={{ color: "var(--t3)" }}>{hechos} cerrados</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={reloj.alternar}
          title={`Medimos minutos por artículo para estimar cuánto cuesta curar el archivo completo. Se detiene solo al cambiar de ventana o tras un minuto sin actividad. Estado: ${ETIQUETA_RELOJ[reloj.estado]}.`}
          style={{
            appearance: "none", background: "transparent",
            border: `1px solid ${reloj.estado === "corriendo" ? "var(--borde)" : "var(--advertencia)"}`,
            borderRadius: 6, padding: "5px 11px", display: "flex", alignItems: "center",
            gap: 8, cursor: "pointer",
            color: reloj.estado === "corriendo" ? "var(--t2)" : "var(--advertencia)",
            fontSize: 12.5,
          }}
        >
          <span aria-hidden style={{ fontSize: 9 }}>{reloj.estado === "corriendo" ? "❙❙" : "▶"}</span>
          <span className="t-mono" style={{ fontVariantNumeric: "tabular-nums" }}>{mmss(crono)}</span>
          {reloj.estado !== "corriendo" && reloj.estado !== "detenido" && (
            <span style={{ fontSize: 11 }}>en pausa</span>
          )}
        </button>
        {relSel.length === 2 && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span className="t-menor" style={{ color: "var(--t3)" }}>
              {(() => {
                const a = menciones.find((m) => m.mid === relSel[0]);
                const b = menciones.find((m) => m.mid === relSel[1]);
                return a && b ? `${recorta(a.texto)} → ${recorta(b.texto)}:` : "dos marcas:";
              })()}
            </span>
            <Boton variante="secundario" onClick={enlazarAlias}
                   title="Las dos formas nombran la misma cosa del mundo: «Ómar Yepes» y «Yepes».">
              Son la misma <span className="t-mono" style={{ fontSize: 11, opacity: .6 }}>=</span>
            </Boton>
            <Boton variante="secundario" onClick={abrirRelacion}
                   title="Son cosas distintas unidas por algo: «Comisión Tercera» parte de «Congreso».">
              Relacionar <span className="t-mono" style={{ fontSize: 11, opacity: .6 }}>R</span>
            </Boton>
            <span className="t-menor" style={{ color: "var(--t3)" }}>
              ¿misma cosa o una dentro de otra?
            </span>
          </div>
        )}
        {ultimaPropagacion && (
          <span className="t-menor" style={{ color: "var(--t3)", whiteSpace: "nowrap" }}>
            +{ultimaPropagacion.n} «{ultimaPropagacion.texto.length > 22 ? ultimaPropagacion.texto.slice(0, 22) + "…" : ultimaPropagacion.texto}»
          </span>
        )}
        {crono > 0 && (
          <Boton
            variante="texto"
            onClick={() => void descartarMedicion()}
            title="Borra el tiempo de este artículo. Úsalo si la ventana quedó abierta haciendo otra cosa: una medición contaminada desplaza la mediana de toda la muestra."
          >
            descartar tiempo
          </Boton>
        )}
        <Boton variante="secundario" onClick={() => void cerrarYSeguir()}>Cerrar y seguir</Boton>
        <Boton variante="texto" onClick={() => setPanel(!panel)}>{panel ? "Ocultar panel" : "Mostrar panel"}</Boton>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div ref={lienzo} onMouseUp={alSoltar} style={{ flex: 1, minWidth: 0, overflow: "auto", position: "relative", padding: "var(--esp-16) var(--esp-8)" }}>
          <div style={{ maxWidth: "68ch", margin: "0 auto" }}>
            <div className="t-menor" style={{ color: "var(--t3)", marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span>{fila.seccion ?? "sin sección"}</span>
              <span>·</span>
              <span>{fila.fecha?.slice(0, 10) ?? "sin fecha"}</span>
              {fila.palabras != null && <><span>·</span><span>{fila.palabras.toLocaleString("es-CO")} palabras</span></>}
              <span>·</span>
              <span className="t-mono">#{fila.wp_id}</span>
            </div>
            <h1 className="t-titular" style={{ margin: "0 0 var(--esp-8)" }}>
              {fila.titulo ?? "(sin título)"}
            </h1>

            {sinCuerpo ? (
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "12px 15px", background: "var(--advertencia-fondo)", borderRadius: 8 }}>
                <Glifo estado="advertencia" size={11} />
                <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65 }}>
                  Este artículo no tiene cuerpo descargado. Vuelve al muestreo y termina la descarga.
                </span>
              </div>
            ) : crudo ? (
              <pre className="t-mono" style={{ whiteSpace: "pre-wrap", background: "var(--hundida)", padding: "var(--esp-4)", borderRadius: 8, color: "var(--t2)", overflowX: "auto" }}>
                {fila.html}
              </pre>
            ) : (
              <div className="t-lectura">
                {parrafos.map((texto, pi) => (
                  <p key={pi} data-p={pi} style={{ margin: "0 0 1.1em" }}>
                    {pintar(arbolDeParrafo(texto, menciones, pi))}
                  </p>
                ))}
              </div>
            )}

            {fila.html && !sinCuerpo && (
              <div style={{ marginTop: "var(--esp-8)", paddingTop: "var(--esp-4)", borderTop: "1px solid var(--borde)", display: "flex", gap: 18, flexWrap: "wrap" }}>
                <Boton variante="enlace" onClick={() => setCrudo(!crudo)}>
                  {crudo ? "ver el texto limpio" : "ver el HTML crudo"}
                </Boton>
                {fila.link && (
                  <a href={fila.link} target="_blank" rel="noreferrer" className="t-menor" style={{ border: 0 }}>
                    abrir en el sitio
                  </a>
                )}
              </div>
            )}
          </div>

          {punto && pendiente && !relPicker && (() => {
            /* Los avisos se muestran antes de elegir tipo, que es cuando
               todavía cuesta un clic corregir. El 13 % del primer lote fueron
               genéricos que hubo que borrar después uno a uno. */
            const avisos = revisar(pendiente.texto, "");
            return (
              <Flotante x={punto.x} y={punto.y} titulo={`Marcar «${recorta(pendiente.texto)}»`}>
                {avisos.map((a, k) => (
                  <div key={k} style={{ padding: "5px 8px 7px", borderBottom: "1px solid var(--borde)", marginBottom: 4 }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                      <Glifo estado="advertencia" size={10} />
                      <span className="t-menor" style={{ color: "var(--t2)", lineHeight: 1.5 }}>{a.texto}</span>
                    </div>
                    {a.arreglo && (
                      <button
                        onClick={() => setPendiente((p) => {
                          if (!p) return p;
                          const desp = p.texto.indexOf(a.arreglo!);
                          return desp < 0 ? p : { ...p, ini: p.ini + desp, fin: p.ini + desp + a.arreglo!.length, texto: a.arreglo! };
                        })}
                        style={{ appearance: "none", background: "transparent", border: 0, padding: "4px 0 0 17px", color: "var(--acento)", cursor: "pointer", fontSize: 12, fontFamily: "var(--font-sans)" }}
                      >
                        {a.etiquetaArreglo}
                      </button>
                    )}
                  </div>
                ))}
                {TIPOS.map((t) => (
                  <Opcion key={t.k} color={colorTipo(t.k)} tecla={t.tecla} onClick={() => marcar(t.k)}>
                    {t.etiqueta}
                  </Opcion>
                ))}
              </Flotante>
            );
          })()}
          {punto && relPicker && (() => {
            const a = menciones.find((m) => m.mid === relSel[0]);
            const b = menciones.find((m) => m.mid === relSel[1]);
            const opciones = predicadosDisponibles();
            return (
              <Flotante
                x={punto.x}
                y={punto.y}
                titulo={
                  /* La dirección importa y antes no se veía: «A opositor de B»
                     no dice lo mismo si se invierte el orden de selección. */
                  a && b ? `${recorta(a.texto)} → ${recorta(b.texto)}` : "Selecciona dos marcas"
                }
              >
                {opciones.map((p, k) => (
                  <Opcion key={p.etiqueta} tecla={String(k + 1)} onClick={() => crearRelacion(p.etiqueta)} nota={p.nota}>
                    {p.etiqueta}
                  </Opcion>
                ))}
                {a && b && (
                  <button
                    onClick={invertirRelacion}
                    style={{ appearance: "none", background: "transparent", border: 0, borderTop: "1px solid var(--borde)", marginTop: 5, paddingTop: 7, textAlign: "left", cursor: "pointer", color: "var(--t3)", fontSize: 12, fontFamily: "var(--font-sans)" }}
                  >
                    ⇄ invertir el sentido
                  </button>
                )}
              </Flotante>
            );
          })()}
        </div>

        {panel && (
          <aside style={{ flex: "0 0 280px", borderLeft: "1px solid var(--borde)", background: "var(--superficie)", overflow: "auto", padding: "var(--esp-6) var(--esp-4)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <Rotulo>Entidades</Rotulo>
              <span className="t-mono" style={{ color: "var(--t3)" }}>{menciones.length}</span>
            </div>

            {(() => {
              const auto = menciones.filter((m) => m.auto).length;
              if (auto === 0) return null;
              return (
                <div style={{ marginBottom: "var(--esp-4)", padding: "8px 10px", borderRadius: 6, background: "var(--hundida)" }}>
                  <div style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.55 }}>
                    {auto} {auto === 1 ? "marcada sola" : "marcadas solas"}
                    {preMarcadas > 0 && menciones.length === preMarcadas
                      ? " a partir de artículos anteriores"
                      : " al propagar dentro del artículo"}
                    . Revísalas: borrar con ⌫ cuesta menos que arrastrar un error.
                  </div>
                </div>
              );
            })()}
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-4)" }}>
              {grupos.map((g) => (
                <div key={g.tipo.k}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: colorTipo(g.tipo.k), display: "block" }} />
                    <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{g.tipo.etiqueta}</span>
                    <span className="t-mono" style={{ color: "var(--t3)", marginLeft: "auto" }}>
                      {/* Menciones y formas distintas: el número a secas hacía
                          creer que faltaban filas de la lista. */}
                      {g.n !== g.formas ? `${g.formas} · ${g.n} menc.` : g.n}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {g.filas.map((f, k) => (
                      <div key={f.mids[0] ?? k} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", padding: "3px 6px" }}>
                        <span style={{ fontSize: 12.5 }}>
                          {f.texto}
                          {f.mids.length > 1 && (
                            <span className="t-mono" style={{ color: "var(--t3)", fontSize: 10.5, marginLeft: 6 }}>
                              ×{f.mids.length}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => {
                            // Una relación que apunta a una marca borrada es
                            // basura que se guardaría igual: se va con ella.
                            setRelaciones((rs) =>
                              rs.filter((r) => !f.mids.includes(r.a_mid) && !f.mids.includes(r.b_mid))
                            );
                            setMenciones((ms) => ms.filter((m) => !f.mids.includes(m.mid)));
                            setRelSel((sel) => sel.filter((x) => !f.mids.includes(x)));
                          }}
                          style={{ appearance: "none", background: "transparent", border: 0, color: "var(--t3)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
                        >×</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {grupos.length === 0 && (
                <span className="t-menor" style={{ color: "var(--t3)", fontStyle: "italic" }}>
                  Selecciona texto para marcar la primera entidad.
                </span>
              )}
            </div>

            {(() => {
              const grupos = gruposDeAlias(menciones);
              if (grupos.length === 0) return null;
              return (
                <div style={{ marginTop: "var(--esp-8)", paddingTop: "var(--esp-4)", borderTop: "1px solid var(--borde)" }}>
                  <Rotulo style={{ marginBottom: 10 }}>Mismas entidades</Rotulo>
                  <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                    {grupos.map((g) => (
                      <div key={g.grupo}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(g.tipo), display: "block", flex: "0 0 auto" }} />
                          <span style={{ fontSize: 12.5, color: "var(--t1)" }}>{g.canonica}</span>
                        </div>
                        <div style={{ marginLeft: 14, marginTop: 3, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {g.formas.filter((f) => f !== g.canonica).map((f) => (
                            <span key={f} className="t-menor" style={{ color: "var(--t3)" }}>
                              = {f}
                              <button
                                onClick={() => setMenciones((ms) => {
                                  const suelta = ms.find((m) => m.grupo === g.grupo && m.texto === f);
                                  return suelta ? soltarAlias(ms, suelta.mid) : ms;
                                })}
                                style={{ appearance: "none", background: "transparent", border: 0, color: "var(--t3)", cursor: "pointer", fontSize: 12, padding: "0 0 0 4px" }}
                              >×</button>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {relaciones.length > 0 && (
              <div style={{ marginTop: "var(--esp-8)", paddingTop: "var(--esp-4)", borderTop: "1px solid var(--borde)" }}>
                <Rotulo style={{ marginBottom: 10 }}>Relaciones</Rotulo>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {relaciones.map((r) => {
                    const ma = menciones.find((m) => m.mid === r.a_mid);
                    const mb = menciones.find((m) => m.mid === r.b_mid);
                    // Si una de las dos marcas ya no existe, la relación está
                    // rota y hay que verlo, no descubrirlo en el reporte.
                    const rota = !ma || !mb;
                    return (
                      <div
                        key={r.rid}
                        onMouseEnter={() => setRelResaltada([r.a_mid, r.b_mid])}
                        onMouseLeave={() => setRelResaltada([])}
                        style={{
                          display: "flex", gap: 8, alignItems: "baseline",
                          padding: "4px 6px", borderRadius: 5,
                          background: relResaltada.includes(r.a_mid) ? "var(--hundida)" : "transparent",
                        }}
                      >
                        <span style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: rota ? "var(--error)" : "var(--t1)" }}>
                          {ma?.texto ?? "(marca borrada)"}{" "}
                          <span style={{ color: "var(--t3)" }}>{r.predicado}</span>{" "}
                          {mb?.texto ?? "(marca borrada)"}
                        </span>
                        <button
                          onClick={() => setRelaciones((rs) => rs.filter((x) => x.rid !== r.rid))}
                          title="Borrar esta relación"
                          style={{ appearance: "none", background: "transparent", border: 0, color: "var(--t3)", cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1 }}
                        >×</button>
                      </div>
                    );
                  })}
                </div>
                <div className="t-menor" style={{ color: "var(--t3)", marginTop: 8, lineHeight: 1.55 }}>
                  Pasa el ratón por una para ver sus dos marcas en el texto.
                </div>
              </div>
            )}

            <div style={{ marginTop: "var(--esp-8)", paddingTop: "var(--esp-4)", borderTop: "1px solid var(--borde)" }}>
              <Rotulo style={{ marginBottom: 10 }}>Atajos</Rotulo>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {[["1—8", "marcar selección y todas sus repeticiones"],
                  ["J / K", "moverse sin cerrar el artículo"],
                  ["=", "las dos marcas son la misma entidad"],
                  ["R", "relacionar dos marcas"],
                  ["⌫", "borrar marca activa"], ["clic", "dar por buena una punteada"],
                  ["⌘\\", "ocultar este panel"]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--t3)" }}>
                    <span className="t-mono" style={{ minWidth: 42, color: "var(--t2)" }}>{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "var(--esp-6)", display: "flex", gap: 8, alignItems: "center" }}>
              <Latido color="var(--exito)" />
              <span className="t-menor" style={{ color: "var(--t3)" }}>Se guarda solo</span>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

const recorta = (t: string) => (t.length > 28 ? t.slice(0, 28) + "…" : t);

function Flotante({ x, y, titulo, children }: { x: number; y: number; titulo: string; children: React.ReactNode }) {
  return (
    <div
      onMouseUp={(e) => e.stopPropagation()}
      style={{ position: "absolute", left: x, top: y, zIndex: 20, background: "var(--elevada)", border: "1px solid var(--borde)", borderRadius: 10, boxShadow: "0 8px 24px rgba(20,20,19,.12)", padding: 7, minWidth: 216 }}
    >
      <div className="t-menor" style={{ color: "var(--t3)", padding: "3px 8px 8px" }}>{titulo}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>{children}</div>
    </div>
  );
}

function Opcion({ color, tecla, onClick, nota, children }: {
  color?: string; tecla: string; onClick: () => void; nota?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={nota}
      style={{ display: "flex", alignItems: "center", gap: 9, appearance: "none", background: "transparent", border: 0, borderRadius: 6, padding: "6px 8px", cursor: "pointer", textAlign: "left", fontSize: 13, color: "var(--t1)" }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hundida)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {color && <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: "block", flex: "0 0 auto" }} />}
      <span style={{ flex: 1 }}>{children}</span>
      {nota && <span style={{ color: "var(--t3)", fontSize: 11 }} aria-hidden>?</span>}
      <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11 }}>{tecla}</span>
    </button>
  );
}

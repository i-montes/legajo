import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Barra, Boton, Encabezado, Glifo, Latido, Lienzo, Rotulo } from "../ui";
import { FAMILIAS, TIPOS, colorTipo, predicadosPara } from "../contenido/tipos";
import type { Predicado } from "../contenido/tipos";
import {
  apuntarTiempo, avanceAnotacion, cargarAnotacion, cerrarArticulo, descartarTiempo, guardarAnotacion,
  lexico as cargarLexico, muestra as cargarMuestra,
  reanudarAnotacion, tiempoArticulo,
} from "../lib/ipc";
import {
  aplicarLexico, arbolDeParrafo, cabeAnidada, gruposDeAlias, nuevoId,
  propagarEnDocumento, sePropaga, soltarAlias, unirAlias,
} from "../lib/propagacion";
import type { Nodo } from "../lib/propagacion";
import { ETIQUETA_RELOJ, mmss, useCronometro } from "../lib/cronometro";
import { pareceDescripcion, revisar, vigenciaSugerida } from "../lib/revision";
import type { EntradaLexico, FilaAnotable, Mencion, RelacionFila, Vigencia } from "../types";
import type { EstadoApp } from "../App";

interface Punto { x: number; y: number }
interface Pendiente { pi: number; ini: number; fin: number; texto: string }


/* Tres estados y no más. Añadir «alegada» o «en disputa» mezclaría el eje
   temporal con el de la certeza, que es otra pregunta: quien está siendo
   investigado lo está de verdad, aunque el delito esté por probar. */
const VIGENCIAS: Record<Vigencia, { glifo: string; ayuda: string }> = {
  vigente: { glifo: "◷", ayuda: "Vigente a la fecha del artículo. Clic para cambiar." },
  pasada: { glifo: "◶", ayuda: "El texto la sitúa antes del artículo: «fue», «ex». Clic para cambiar." },
  futura: { glifo: "◵", ayuda: "Anunciada para después: «asumirá», «será». Clic para cambiar." },
};

export default function Revision({ estado }: { estado: EstadoApp }) {
  const { loteId } = estado;
  const [filas, setFilas] = useState<FilaAnotable[] | null>(null);
  const [i, setI] = useState(0);
  const [menciones, setMenciones] = useState<Mencion[]>([]);
  const [relaciones, setRelaciones] = useState<RelacionFila[]>([]);
  const [relSel, setRelSel] = useState<string[]>([]);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [punto, setPunto] = useState<Punto | null>(null);
  const [relPicker, setRelPicker] = useState(false);
  /* Con 35 predicados, entre dos personas encajan dieciocho: no caben en las
     teclas 1—9. Cuando pasan de nueve, el menú pide primero la familia
     (Familia, Trabajo, Política…) y después el predicado; esto guarda la
     familia elegida. */
  const [familiaSel, setFamiliaSel] = useState<string | null>(null);
  const [panel, setPanel] = useState(true);
  const reloj = useCronometro();
  const crono = reloj.segundos;
  const [crudo, setCrudo] = useState(false);
  const [lexico, setLexico] = useState<EntradaLexico[]>([]);
  const [ultimaPropagacion, setUltimaPropagacion] = useState<{ texto: string; n: number } | null>(null);
  const [preMarcadas, setPreMarcadas] = useState(0);
  /* De dónde salió lo que ya estaba marcado al abrir. Las tres procedencias se
     corrigen igual pero no merecen la misma confianza, y decirlo evita que se
     revise el trabajo del modelo con el mismo ojo que una propagación literal. */
  const [origen, setOrigen] = useState<"modelo" | "lexico" | null>(null);
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
    if (loteId == null) { setFilas([]); return; }
    void (async () => {
      const design = loteId;
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
    })();
  }, [loteId]);

  // Al cambiar de artículo se recuperan sus anotaciones y arranca el reloj.
  useEffect(() => {
    if (loteId == null || !fila) return;
    const wp = fila.wp_id;
    setRelSel([]); setPendiente(null); setPunto(null); setRelPicker(false); setCrudo(false);
    setUltimaPropagacion(null); setOrigen(null);
    Promise.all([cargarAnotacion(loteId, wp), tiempoArticulo(loteId, wp).catch(() => 0)])
      .then(([[ms, rs], segundos]) => {
        setRelaciones(rs);
        // El cronómetro continúa desde lo ya invertido, no desde cero.
        reloj.reiniciar(segundos);

        /* Un artículo virgen se pre-marca con lo aprendido en los anteriores.
           Nunca sobre uno ya trabajado: pisar el criterio de la persona con
           propuestas de la máquina sería peor que no proponer nada. */
        if (ms.length > 0) {
          setMenciones(ms);
          /* El backend sirve lo que propuso el modelo cuando la persona todavía
             no ha tocado el artículo, y lo entrega entero como `auto`. Que no
             quede ni una marca propia es lo que distingue una propuesta sin
             abrir del trabajo ya hecho. */
          const virgen = ms.every((m) => m.auto);
          setPreMarcadas(virgen ? ms.length : 0);
          setOrigen(virgen ? "modelo" : null);
          return;
        }
        const previas = aplicarLexico(parrafos, lexico);
        setMenciones(previas);
        setPreMarcadas(previas.length);
        setOrigen(previas.length > 0 ? "lexico" : null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loteId, fila?.wp_id, lexico]);


  // El guardado es automático: perder media hora de anotación por olvidar
  // pulsar un botón es inaceptable en un trabajo que se mide en horas.
  useEffect(() => {
    if (loteId == null || !fila) return;
    const t = setTimeout(() => {
      guardarAnotacion(loteId, fila.wp_id, menciones, relaciones).catch(() => {});
    }, 600);
    return () => clearTimeout(t);
  }, [loteId, fila?.wp_id, menciones, relaciones]);

  /* El cronómetro también se persiste cada diez segundos, sin marcar el
     artículo como terminado. Cerrar la ventana a mitad no debe borrar los
     minutos ya puestos: son parte del coste real que la fase mide. */
  useEffect(() => {
    if (loteId == null || !fila || reloj.estado !== "corriendo") return;
    const t = setInterval(() => {
      apuntarTiempo(loteId, fila.wp_id, crono, menciones.length).catch(() => {});
    }, 10_000);
    return () => clearInterval(t);
  }, [loteId, fila?.wp_id, reloj.estado, crono, menciones.length]);

  // Y una última vez al cerrar la ventana, para no perder los segundos sueltos.
  useEffect(() => {
    const alSalir = () => {
      if (loteId == null || !fila) return;
      apuntarTiempo(loteId, fila.wp_id, crono, menciones.length).catch(() => {});
      guardarAnotacion(loteId, fila.wp_id, menciones, relaciones).catch(() => {});
    };
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [loteId, fila?.wp_id, crono, menciones, relaciones]);

  /* Moverse entre artículos guarda lo anotado pero NO registra un cierre.
     Antes, pasar de largo con J/K dejaba una medición de un segundo que entraba
     en la mediana: la mitad del ruido de los primeros veinte artículos venía
     de ahí. Solo «Cerrar y seguir» da un artículo por terminado. */
  useEffect(() => {
    if (!ultimaPropagacion) return;
    const t = setTimeout(() => setUltimaPropagacion(null), 4000);
    return () => clearTimeout(t);
  }, [ultimaPropagacion]);

  const irArticulo = useCallback(async (d: number) => {
    if (loteId == null || !filas) return;
    const actual = filas[i];
    if (actual) {
      await guardarAnotacion(loteId, actual.wp_id, menciones, relaciones).catch(() => {});
      await apuntarTiempo(loteId, actual.wp_id, crono, menciones.length).catch(() => {});
    }
    setI((v) => Math.max(0, Math.min(filas.length, v + d)));
  }, [loteId, filas, i, menciones, relaciones, crono]);

  const cerrarYSeguir = useCallback(async () => {
    if (loteId == null || !filas) return;
    const actual = filas[i];
    if (actual) {
      await guardarAnotacion(loteId, actual.wp_id, menciones, relaciones).catch(() => {});
      await cerrarArticulo(loteId, actual.wp_id, crono, menciones.length).catch(() => {});
      avanceAnotacion(loteId).then(([h]) => setHechos(h));
    }
    setI((v) => Math.min(filas.length, v + 1));
  }, [loteId, filas, i, menciones, relaciones, crono]);

  const descartarMedicion = useCallback(async () => {
    if (loteId == null || !fila) return;
    await descartarTiempo(loteId, fila.wp_id).catch(() => {});
    reloj.reiniciar(0);
    avanceAnotacion(loteId).then(([h]) => setHechos(h));
  }, [loteId, fila?.wp_id]);

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
    const ma = menciones.find((m) => m.mid === a);
    setRelaciones((rs) =>
      rs.some((r) => r.a_mid === a && r.b_mid === b && r.predicado === pred)
        ? rs
        /* Por defecto vigente: es lo que el texto afirma cuando habla en
           presente, que es la mayoría de las veces. Cambiarlo cuesta un clic;
           el revés obligaría a corregir casi todas. */
        : [...rs, {
            rid: nuevoId(), a_mid: a, b_mid: b, predicado: pred,
            /* Se mira el párrafo donde caen las dos marcas: «el entonces
               ministro» y «el exgobernador» dicen por sí solos que la relación
               ya no está vigente, y hacérselo teclear a la persona cuando el
               texto lo grita sería trabajo regalado. Sigue siendo una
               sugerencia: un clic la cambia. */
            cuando: vigenciaSugerida(parrafos[ma?.pi ?? 0] ?? "") ?? "vigente",
          }]
    );
    setRelSel([]);
    setRelPicker(false);
  }, [relSel, menciones, parrafos]);

  /* Declarar que una marca señala a alguien concreto al que el texto no
     nombra: «el Gobernador de Antioquia», «la cooperativa». No le cambia el
     tipo —sigue siendo un cargo— porque convertirla en persona le enseñaría al
     modelo que esa cadena es un nombre propio, y no lo es. Lo que añade es que
     el grafo sepa que ahí hay una identidad ausente en vez de contar la
     descripción como si fuera la entidad. */
  const marcarDesigna = useCallback(() => {
    const objetivo = relSel.length === 1 ? relSel[0] : null;
    if (!objetivo) return;
    setMenciones((ms) =>
      ms.map((m) => (m.mid === objetivo ? { ...m, designa: !m.designa, auto: false } : m))
    );
  }, [relSel]);

  const cambiarVigencia = useCallback((rid: string) => {
    const orden: Vigencia[] = ["vigente", "pasada", "futura"];
    setRelaciones((rs) =>
      rs.map((r) =>
        r.rid === rid
          ? { ...r, cuando: orden[(orden.indexOf(r.cuando) + 1) % orden.length] }
          : r
      )
    );
  }, []);

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
    setFamiliaSel(null);
    setPendiente(null);
  }, [relSel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === "Escape") {
        // Dentro de una familia, Escape vuelve a la lista de familias; fuera, cierra.
        if (relPicker && familiaSel) { setFamiliaSel(null); return; }
        setPendiente(null); setPunto(null); setRelPicker(false); setRelSel([]); return;
      }
      if (pendiente && /^[1-7]$/.test(e.key)) { e.preventDefault(); return marcar(TIPOS[+e.key - 1].k); }
      if (relPicker && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const opciones = predicadosDisponibles();
        const { directo, familias, dentro } = menuPredicados(opciones, familiaSel);
        if (e.key === "0") { setFamiliaSel(null); return; }
        if (directo) {
          const p = opciones[+e.key - 1];
          return p ? crearRelacion(p.etiqueta) : undefined;
        }
        if (familiaSel === null) {
          const f = familias[+e.key - 1];
          if (f) setFamiliaSel(f.k);
          return;
        }
        const p = dentro[+e.key - 1];
        return p ? crearRelacion(p.etiqueta) : undefined;
      }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); return abrirRelacion(); }
      if (e.key === "=" || e.key === "+") { e.preventDefault(); return enlazarAlias(); }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); return marcarDesigna(); }
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
  }, [pendiente, relPicker, relSel, familiaSel, marcar, crearRelacion, abrirRelacion, enlazarAlias,
      marcarDesigna, irArticulo, predicadosDisponibles]);

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
          ? Array.from(new Set(items.map((m) => m.texto))).map((texto) => {
              const iguales = items.filter((m) => m.texto === texto);
              return {
                texto,
                mids: iguales.map((m) => m.mid),
                // Basta con que una lo esté: son la misma cadena y el
                // interruptor las mueve todas a la vez.
                designa: iguales.some((m) => m.designa),
              };
            })
          : items.map((m) => ({ texto: m.texto, mids: [m.mid], designa: !!m.designa }));
        return { tipo: t, n: items.length, formas: filas.length, filas };
      }).filter(Boolean) as {
        tipo: (typeof TIPOS)[number];
        n: number;
        formas: number;
        filas: { texto: string; mids: string[]; designa: boolean }[];
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
        <Encabezado
          paso="revision"
          titulo="No hay nada que revisar todavía"
          frase="La revisión corre sobre los artículos de calibración de un lote. Vuelve al alcance, crea el lote y deja que el extractor pase por ellos."
          compacto
        />
        <Boton onClick={() => estado.avanzar(3, "alcance")}>Ir al alcance</Boton>
      </Lienzo>
    );
  }
  if (!fila) {
    const seg = Math.max(1, hechos);
    /* El cierre del último artículo devuelve a la calibración, que es adonde
       van las correcciones: allí se calcula sola. Antes este botón saltaba a la
       extracción y la calibración quedaba sin calcular ni aplicar, con la
       revisión hecha y el extractor corriendo igual que antes de hacerla. */
    return (
      <Lienzo>
        <div style={{ textAlign: "center", paddingTop: "var(--esp-16)" }}>
          <div className="t-rotulo" style={{ marginBottom: 12 }}>Paso 6 de 8 · Revisión</div>
          <h2 className="t-display" style={{ fontSize: 28, margin: "0 0 12px" }}>Revisión terminada</h2>
          <p className="t-cuerpo" style={{ color: "var(--t2)", margin: "0 auto var(--esp-8)", maxWidth: "46ch" }}>
            Cerraste los {seg} artículos de calibración. Con tus correcciones se recalcula cómo se
            usa el extractor, y el tiempo de cada uno quedó guardado: es lo que convierte el
            diagnóstico en una cifra de coste real.
          </p>
          <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", alignItems: "center" }}>
            <Boton onClick={() => estado.avanzar(4, "calibracion")}>Calcular la calibración</Boton>
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
      {/* Cabecera en dos alturas.
          Todo en una fila se rompía en columnas de una palabra: la barra
          permanente y las acciones que solo salen con dos marcas elegidas
          competían por el mismo espacio. */}
      <div style={{ flex: "0 0 auto", borderBottom: "1px solid var(--borde)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "11px 24px" }}>
          <span className="t-menor" style={{ color: "var(--t2)", whiteSpace: "nowrap" }}>
            Artículo {i + 1} de {total}
          </span>
          <div style={{ width: 120, flex: "0 0 auto" }}><Barra pct={(hechos / total) * 100} /></div>
          <span className="t-menor" style={{ color: "var(--t3)", whiteSpace: "nowrap" }}>
            {hechos} cerrados
          </span>

          <div style={{ flex: 1, minWidth: 12 }} />

          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
            <button
              onClick={reloj.alternar}
              title={`Medimos minutos por artículo para estimar cuánto cuesta curar el archivo completo. Se detiene solo al cambiar de ventana o tras un minuto sin actividad. Estado: ${ETIQUETA_RELOJ[reloj.estado]}.`}
              style={{
                appearance: "none", background: "transparent",
                border: `1px solid ${reloj.estado === "corriendo" ? "var(--borde)" : "var(--advertencia)"}`,
                borderRadius: 6, padding: "5px 10px", display: "flex", alignItems: "center",
                gap: 7, cursor: "pointer", whiteSpace: "nowrap",
                color: reloj.estado === "corriendo" ? "var(--t2)" : "var(--advertencia)",
                fontSize: 12.5,
              }}
            >
              <span aria-hidden style={{ fontSize: 9 }}>{reloj.estado === "corriendo" ? "❙❙" : "▶"}</span>
              <span className="t-mono" style={{ fontVariantNumeric: "tabular-nums" }}>{mmss(crono)}</span>
            </button>
            {crono > 20 && (
              <button
                onClick={() => void descartarMedicion()}
                title="Borra el tiempo de este artículo. Úsalo si la ventana quedó abierta haciendo otra cosa: una medición contaminada desplaza la mediana de toda la muestra."
                aria-label="Descartar la medición de este artículo"
                style={{ appearance: "none", background: "transparent", border: 0, color: "var(--t3)", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1 }}
              >
                ⟲
              </button>
            )}
          </div>

          <Boton variante="secundario" onClick={() => void cerrarYSeguir()} style={{ whiteSpace: "nowrap" }}>
            Cerrar y seguir
          </Boton>
          <button
            onClick={() => setPanel(!panel)}
            title={panel ? "Ocultar el panel" : "Mostrar el panel"}
            style={{ appearance: "none", background: "transparent", border: 0, color: "var(--t3)", cursor: "pointer", fontSize: 15, padding: "2px 4px", lineHeight: 1, flex: "0 0 auto" }}
          >
            {panel ? "⇥" : "⇤"}
          </button>
        </div>

        {/* Segunda altura, solo con dos marcas elegidas. Aquí sí cabe explicar
            la única decisión que hay que tomar. */}
        {relSel.length === 2 && (() => {
          const a = menciones.find((m) => m.mid === relSel[0]);
          const b = menciones.find((m) => m.mid === relSel[1]);
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "9px 24px", background: "var(--acento-suave)", borderTop: "1px solid var(--borde)", flexWrap: "wrap" }}>
              <span className="t-menor" style={{ color: "var(--t1)", whiteSpace: "nowrap" }}>
                {a && b ? `${recorta(a.texto)} → ${recorta(b.texto)}` : "dos marcas"}
              </span>
              <span className="t-menor" style={{ color: "var(--t2)" }}>
                ¿nombran la misma cosa, o una está dentro de otra?
              </span>
              <div style={{ flex: 1, minWidth: 8 }} />
              <Boton variante="secundario" onClick={enlazarAlias} style={{ whiteSpace: "nowrap" }}
                     title="Las dos formas nombran la misma cosa del mundo: «Ómar Yepes» y «Yepes».">
                Son la misma <span className="t-mono" style={{ fontSize: 11, opacity: .6 }}>=</span>
              </Boton>
              <Boton variante="secundario" onClick={abrirRelacion} style={{ whiteSpace: "nowrap" }}
                     title="Son cosas distintas unidas por algo: «Comisión Tercera» parte de «Congreso».">
                Relacionar <span className="t-mono" style={{ fontSize: 11, opacity: .6 }}>R</span>
              </Boton>
            </div>
          );
        })()}
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
              /* Ya no debería pasar: la revisión solo recorre el conjunto de
                 calibración, y la extracción descarga su cuerpo antes de
                 empezar. Si pasa, es que la descarga de este artículo falló, y
                 lo que hay que hacer es repetir la extracción — no volver a un
                 paso que ya no existe, que es lo que decía este aviso. */
              <div style={{ padding: "12px 15px", background: "var(--advertencia-fondo)", borderRadius: 8 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 10 }}>
                  <Glifo estado="advertencia" size={11} />
                  <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65 }}>
                    El cuerpo de este artículo no llegó a descargarse. Vuelve a la calibración
                    y lanza la extracción otra vez: recoge lo que faltó sin repetir lo hecho.
                  </span>
                </div>
                <div style={{ paddingLeft: 21 }}>
                  <Boton variante="secundario" onClick={() => estado.avanzar(4, "calibracion")}>
                    Ir a la calibración
                  </Boton>
                </div>
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
            const alReves = opciones.length === 0 && a && b
              ? predicadosPara(b.tipo, a.tipo)
              : [];
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
                {(() => {
                  const { directo, familias, dentro } = menuPredicados(opciones, familiaSel);
                  if (directo) {
                    return opciones.map((p, k) => (
                      <Opcion key={p.etiqueta} tecla={String(k + 1)} onClick={() => crearRelacion(p.etiqueta)} nota={p.nota}>
                        {p.etiqueta}
                      </Opcion>
                    ));
                  }
                  if (familiaSel === null) {
                    return familias.map((f, k) => (
                      <Opcion key={f.k} tecla={String(k + 1)} onClick={() => setFamiliaSel(f.k)}
                              nota={opciones.filter((p) => p.familia === f.k).map((p) => p.etiqueta).join(" · ")}>
                        {f.etiqueta} <span style={{ color: "var(--t3)" }}>({opciones.filter((p) => p.familia === f.k).length})</span>
                      </Opcion>
                    ));
                  }
                  return (
                    <>
                      <Opcion tecla="0" onClick={() => setFamiliaSel(null)}>
                        <span style={{ color: "var(--t3)" }}>← {FAMILIAS.find((f) => f.k === familiaSel)?.etiqueta}</span>
                      </Opcion>
                      {dentro.map((p, k) => (
                        <Opcion key={p.etiqueta} tecla={String(k + 1)} onClick={() => crearRelacion(p.etiqueta)} nota={p.nota}>
                          {p.etiqueta}
                        </Opcion>
                      ))}
                    </>
                  );
                })()}
                {/* Que no haya nada no siempre es un hueco del vocabulario:
                    casi siempre es que la relación existe al revés. No hay nada
                    que una un lugar con una persona porque lo que hay es
                    «persona ubicado en lugar». */}
                {opciones.length === 0 && a && b && (
                  <div style={{ padding: "5px 8px 8px" }}>
                    <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
                      <Glifo estado="neutro" size={10} />
                      <span className="t-menor" style={{ color: "var(--t2)", lineHeight: 1.55 }}>
                        {alReves.length > 0
                          ? `Nada une ${a.tipo} con ${b.tipo}, pero al revés sí: ${alReves.map((p) => `«${p.etiqueta}»`).join(", ")}.`
                          : `El vocabulario no tiene ninguna relación entre ${a.tipo} y ${b.tipo}, en ningún sentido.`}
                      </span>
                    </div>
                  </div>
                )}
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

            {/* El aviso de propagación vive donde están las entidades, no en la
                cabecera: allí competía por espacio con todo lo demás. */}
            {ultimaPropagacion && (
              <div style={{ marginBottom: 10, padding: "6px 9px", borderRadius: 5, background: "var(--acento-suave)" }}>
                <span className="t-menor" style={{ color: "var(--t1)" }}>
                  +{ultimaPropagacion.n} «{recorta(ultimaPropagacion.texto)}» en el resto del artículo
                </span>
              </div>
            )}

            {(() => {
              const auto = menciones.filter((m) => m.auto).length;
              if (auto === 0) return null;
              return (
                <div style={{ marginBottom: "var(--esp-4)", padding: "8px 10px", borderRadius: 6, background: "var(--hundida)" }}>
                  <div style={{ fontSize: 11.5, color: "var(--t2)", lineHeight: 1.55 }}>
                    {auto} {auto === 1 ? "marcada sola" : "marcadas solas"}
                    {preMarcadas > 0 && menciones.length === preMarcadas
                      ? origen === "modelo"
                        ? " por el extractor"
                        : " a partir de artículos anteriores"
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
                        <span style={{ fontSize: 12.5, display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.texto}</span>
                          {f.mids.length > 1 && (
                            <span className="t-mono" style={{ color: "var(--t3)", fontSize: 10.5 }}>
                              ×{f.mids.length}
                            </span>
                          )}
                          {/* Un cargo o una organización sin nombre propio suele
                              describir a alguien concreto. Marcarlo no le cambia
                              el tipo: lo que hace es que el grafo sepa que ahí
                              falta una identidad, en vez de contar la
                              descripción como si fuera la entidad. */}
                          {(f.designa || pareceDescripcion(f.texto, g.tipo.k)) && (
                            <button
                              onClick={() => setMenciones((ms) => ms.map((m) =>
                                f.mids.includes(m.mid) ? { ...m, designa: !f.designa, auto: false } : m))}
                              title={f.designa
                                ? "Señala a alguien concreto sin nombrarlo. Clic para quitarlo."
                                : "¿Señala a alguien concreto al que el texto no nombra? Clic para marcarlo."}
                              style={{
                                appearance: "none", borderRadius: 4, cursor: "pointer",
                                padding: "0 4px", fontSize: 10, lineHeight: "15px", fontFamily: "var(--font-mono)",
                                background: f.designa ? "var(--acento-suave)" : "transparent",
                                color: f.designa ? "var(--acento)" : "var(--t3)",
                                border: `1px solid ${f.designa ? "var(--acento)" : "var(--borde)"}`,
                              }}
                            >sin nombre</button>
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
                          {/* La vigencia solo se dice cuando no es la de por
                              defecto: marcar todas las líneas con «vigente»
                              sería ruido en el 90 % de los casos. */}
                          {r.cuando !== "vigente" && (
                            <span className="t-mono" style={{ marginLeft: 6, fontSize: 10.5, color: "var(--t3)" }}>
                              {r.cuando}
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => cambiarVigencia(r.rid)}
                          title={VIGENCIAS[r.cuando].ayuda}
                          style={{ appearance: "none", background: "transparent", border: 0, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1, color: r.cuando === "vigente" ? "var(--t3)" : "var(--t1)" }}
                        >{VIGENCIAS[r.cuando].glifo}</button>
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
                  Pasa el ratón por una para ver sus dos marcas en el texto. El reloj cambia
                  cuándo fue cierta: la fecha del artículo dice cuándo se afirmó, no cuándo
                  fue verdad.
                </div>
              </div>
            )}

            <div style={{ marginTop: "var(--esp-8)", paddingTop: "var(--esp-4)", borderTop: "1px solid var(--borde)" }}>
              <Rotulo style={{ marginBottom: 10 }}>Atajos</Rotulo>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {[["1—8", "marcar selección y todas sus repeticiones"],
                  ["J / K", "moverse sin cerrar el artículo"],
                  ["=", "las dos marcas son la misma entidad"],
                  ["D", "la marca señala a alguien sin nombrarlo"],
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

/** Cómo se presenta la lista de predicados que encajan entre dos marcas.
 *
 *  Hasta nueve, directa: una tecla por predicado. Más de nueve, por familias:
 *  primero se elige la familia (solo las que tienen algo que ofrecer) y después
 *  el predicado dentro de ella, que sí cabe en 1—9. */
export function menuPredicados(opciones: Predicado[], familiaSel: string | null) {
  const directo = opciones.length <= 9;
  const familias = FAMILIAS.filter((f) => opciones.some((p) => p.familia === f.k));
  const dentro = familiaSel ? opciones.filter((p) => p.familia === familiaSel) : [];
  return { directo, familias, dentro };
}

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

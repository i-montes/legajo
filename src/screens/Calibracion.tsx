import { useCallback, useEffect, useState } from "react";
import { Acciones, Aviso, Barra, Boton, Encabezado, Glifo, Latido, Lienzo, Razon, Rotulo } from "../ui";
import { TIPOS, colorTipo } from "../contenido/tipos";
import {
  alFinExtraccion, alProgresoExtraccion, aplicarCalibracion, avanceAnotacion, avanceExtraccion,
  alProgresoModelo, calibracionGuardada, calibrar, cancelarExtraccion, catalogoModelos,
  iniciarExtraccion, modelosPendientes, prepararModelos,
} from "../lib/ipc";
import type { CatalogoModelos, Modelos, OpcionModelo, ProgresoExtraccion, ProgresoModelo, ResultadoCalibracion } from "../types";
import type { EstadoApp } from "../App";

/** Los gigas se leen; los cuatro dígitos de megas, no. */
const peso = (mb?: number) =>
  mb == null ? "descargar" : mb >= 1000 ? `${(mb / 1000).toFixed(1).replace(".", ",")} GB` : `${mb} MB`;

const num = (n: number) => n.toLocaleString("es-CO");
const dec = (n: number, d = 2) => n.toFixed(d).replace(".", ",");
const etiquetaTipo = (k: string) => TIPOS.find((t) => t.k === k)?.etiqueta ?? k;

type Fase = "elegir" | "extrayendo" | "revisar" | "resultado";

/* Las cuatro etapas del paso, a la vista. La calibración es un ida y vuelta
   —se extrae aquí, se corrige en el paso 6, se vuelve aquí a calcular— y sin
   un mapa la gente no sabía si le faltaba algo o ya había terminado. */
const ETAPAS: [Fase, string][] = [
  ["elegir", "Modelos"],
  ["extrayendo", "Extraer"],
  ["revisar", "Revisar"],
  ["resultado", "Ajustar"],
];

export default function Calibracion({ estado }: { estado: EstadoApp }) {
  const { loteId } = estado;
  const [fase, setFase] = useState<Fase>("elegir");
  const [catalogo, setCatalogo] = useState<CatalogoModelos | null>(null);

  /* Lo que le falta a la combinación elegida. Se consulta antes de dejar
     extraer: descubrirlo a mitad de la corrida, después de esperar la carga,
     es lo que le pasó a alguien de verdad y lo que esto existe para evitar. */
  const [faltan, setFaltan] = useState<string[]>([]);
  const [bajando, setBajando] = useState<ProgresoModelo | null>(null);
  const [modelos, setModelos] = useState<Modelos>({
    gliner: "urchade/gliner_multi-v2.1",
    spacy: "es_core_news_sm",
    glirel: "jackboyla/glirel-large-v0",
    relaciones: true,
  });
  const [prog, setProg] = useState<ProgresoExtraccion | null>(null);
  const [hechos, setHechos] = useState(0);
  const [res, setRes] = useState<ResultadoCalibracion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aplicada, setAplicada] = useState(false);
  /* Cuántos artículos de calibración cerró la persona en el paso 6. Decide qué
     se ofrece al volver: con cero, ir a revisar; con alguno, calcular. */
  const [revisados, setRevisados] = useState(0);

  const mirarCatalogo = useCallback(() => {
    catalogoModelos().then(setCatalogo).catch(() => {});
  }, []);
  useEffect(mirarCatalogo, [mirarCatalogo]);

  // Al cambiar de modelo se vuelve a mirar qué falta, no al pulsar «extraer».
  useEffect(() => {
    modelosPendientes(modelos).then(setFaltan).catch(() => setFaltan([]));
  }, [modelos]);

  useEffect(() => {
    const off = alProgresoModelo(setBajando);
    return () => { void off.then((f) => f()); };
  }, []);

  /* `faltan` llega como «spacy:es_core_news_lg»; el tamaño está en el catálogo,
     que es donde vive el dato. */
  const megasDe = useCallback((clave: string) => {
    const id = clave.slice(clave.indexOf(":") + 1);
    for (const familia of [catalogo?.gliner, catalogo?.spacy, catalogo?.glirel]) {
      const o = familia?.find((x) => x.id === id);
      if (o?.mb) return o.mb;
    }
    return 0;
  }, [catalogo]);

  const totalFalta = faltan.reduce((n, f) => n + megasDe(f), 0);

  const bajarModelos = useCallback(async () => {
    setError(null);
    try {
      await prepararModelos(modelos);
      setFaltan(await modelosPendientes(modelos));
      mirarCatalogo();
    } catch (e) {
      setError(String(e));
    } finally {
      setBajando(null);
    }
  }, [modelos, mirarCatalogo]);

  const calcular = useCallback(async (): Promise<ResultadoCalibracion | null> => {
    if (loteId == null) return null;
    try {
      const r = await calibrar(loteId);
      setRes(r);
      setFase("resultado");
      /* Lo que se ve acaba de calcularse; hasta que se pulse «aplicar», el lote
         sigue con lo de antes. Se corrige más abajo cuando coincide con lo
         guardado. */
      setAplicada(false);
      return r;
    } catch (e) {
      setError(String(e));
      return null;
    }
  }, [loteId]);

  /* Al llegar se mira en qué punto del ida y vuelta está el lote. Si ya hay
     artículos revisados, la calibración se calcula sola: es aritmética sobre
     lo guardado y no hay nada que decidir antes de verla. Antes había que
     encontrar un botón secundario que decía «Ya revisé». */
  useEffect(() => {
    if (loteId == null) return;
    const lote = loteId;
    void (async () => {
      const [[h], [rev], guardada] = await Promise.all([
        avanceExtraccion(lote, true),
        avanceAnotacion(lote).catch(() => [0, 0] as [number, number]),
        calibracionGuardada(lote).catch(() => null),
      ]);
      setHechos(h);
      setRevisados(rev);
      if (h > 0 && rev > 0) {
        const r = await calcular();
        // Si lo recién calculado es lo que ya usa el lote, no hay nada que aplicar.
        if (r && guardada && JSON.stringify(r.calibracion) === JSON.stringify(guardada)) setAplicada(true);
      } else if (h > 0) {
        setFase("revisar");
      }
    })().catch(() => {});
  }, [loteId, calcular]);

  useEffect(() => {
    const un1 = alProgresoExtraccion((p) => {
      setProg(p);
      if (p.fase === "extrayendo") setHechos(p.hechos);
    });
    const un2 = alFinExtraccion((f) => {
      setProg(null);
      setError(f.error);
      if (f.ok) setFase("revisar");
      else setFase("elegir");
    });
    return () => { un1.then((u) => u()); un2.then((u) => u()); };
  }, []);

  async function extraer() {
    if (loteId == null) return;
    setError(null);
    setFase("extrayendo");
    try {
      await iniciarExtraccion(loteId, modelos, true);
    } catch (e) {
      setError(String(e));
      setFase("elegir");
    }
  }

  async function aplicar() {
    if (loteId == null || !res) return;
    await aplicarCalibracion(loteId, res.calibracion).catch((e) => setError(String(e)));
    setAplicada(true);
  }

  if (loteId == null) {
    return (
      <Lienzo>
        <Encabezado
          paso="calibracion"
          titulo="Falta elegir el alcance"
          frase="La calibración corre sobre un lote. Vuelve al paso anterior y crea uno."
          compacto
        />
        <Boton onClick={() => estado.avanzar(3, "alcance")}>Ir al alcance</Boton>
      </Lienzo>
    );
  }

  return (
    <Lienzo ancho={880}>
      <Encabezado
        paso="calibracion"
        titulo={
          fase === "extrayendo" ? "Extrayendo sobre los artículos de calibración"
          : fase === "revisar" ? "Ahora te toca a ti"
          : fase === "resultado" ? "Qué cambia con tus correcciones"
          : undefined
        }
        frase={
          fase === "elegir" ? "Elige los modelos y suelta el extractor sobre los artículos de calibración. Con los que vienen por defecto se empieza bien."
          : fase === "extrayendo" ? "Son pocos artículos; lo que tarda es cargar los modelos la primera vez."
          : fase === "revisar" ? "Corrige lo que propuso el extractor en el paso de revisión. Al cerrar el último artículo, vuelves aquí y la calibración se calcula sola."
          : "El corte de confianza de cada tipo y lo que dejará de proponer, calculados sobre tus correcciones."
        }
        detalle={
          <>
            <Razon>Antes de soltar el extractor sobre miles de artículos, corre sobre un puñado y tú corriges. Con esas correcciones se recalcula el corte de confianza de cada tipo y se aprende qué no debe proponer nunca.</Razon>
            <Razon>Es aritmética sobre las puntuaciones ya guardadas: el efecto se ve al instante y sin volver a pasar el modelo.</Razon>
          </>
        }
      />

      <Etapas actual={fase} />

      {error && <Aviso estado="error">{error}</Aviso>}

      {fase === "elegir" && catalogo && (
        <>
          <Rotulo style={{ marginBottom: 14 }}>Modelos</Rotulo>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--esp-6)", marginBottom: "var(--esp-11)" }}>
            <Familia titulo="Entidades · GLiNER" opciones={catalogo.gliner}
              valor={modelos.gliner} onChange={(v) => setModelos({ ...modelos, gliner: v })} />
            <Familia titulo="Segmentación · spaCy" opciones={catalogo.spacy}
              valor={modelos.spacy} onChange={(v) => setModelos({ ...modelos, spacy: v })}
              nota="Parte el texto en oraciones antes de pasárselo a GLiNER, y alinea las entidades a límites de token para que GLiREL pueda leerlas." />
            <div>
              <button
                onClick={() => setModelos({ ...modelos, relaciones: !modelos.relaciones })}
                style={{ display: "flex", alignItems: "center", gap: 10, appearance: "none", background: "transparent", border: 0, padding: 0, cursor: "pointer", textAlign: "left", color: "var(--t1)" }}
              >
                <span style={{ width: 15, height: 15, borderRadius: 4, display: "grid", placeItems: "center", background: modelos.relaciones ? "var(--acento)" : "transparent", border: `1px solid ${modelos.relaciones ? "var(--acento)" : "var(--borde-fuerte)"}`, color: "var(--bg)", fontSize: 10 }}>
                  {modelos.relaciones ? "✓" : ""}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Extraer también relaciones · GLiREL</span>
              </button>
              <p className="t-menor" style={{ color: "var(--t3)", margin: "8px 0 0 25px", lineHeight: 1.65, maxWidth: "56ch" }}>
                <strong style={{ fontWeight: 600 }}>Casi cuadruplica</strong> el tiempo por
                artículo: medido sobre un perfil de 39 párrafos, 8 s sin relaciones y 32 s con
                ellas. Es el 73 % del cómputo de toda la extracción. Sin esto tendrás entidades
                pero no un grafo: solo un índice de nombres. Se puede dejar para una segunda
                pasada, que retoma sin repetir lo hecho.
              </p>
            </div>
          </div>
          {faltan.length > 0 ? (

            <div style={{ padding: "14px 16px", background: "var(--hundida)", borderRadius: 10 }}>
              <div style={{ display: "flex", gap: 11, alignItems: "baseline", marginBottom: 11 }}>
                <Glifo estado="advertencia" size={11} />
                <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.7, maxWidth: "60ch" }}>
                  {faltan.length === 1
                    ? "Falta un modelo de los que elegiste"
                    : `Faltan ${faltan.length} de los modelos que elegiste`}
                  {totalFalta > 0 ? `: ${peso(totalFalta)} de descarga` : ""}. Se bajan una vez
                  y quedan en este computador. Es lo único de la app que sale a la red: trae los
                  pesos desde el repositorio público de cada modelo, y ningún texto de tu archivo
                  se envía a ninguna parte.
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 22, marginBottom: 13 }}>
                {faltan.map((f) => (
                  <span key={f} className="t-mono" style={{ fontSize: 11.5, color: "var(--t2)" }}>
                    {f.replace(":", " · ")}
                    {megasDe(f) ? `  ${peso(megasDe(f))}` : ""}
                  </span>
                ))}
              </div>
              {bajando ? (
                <div style={{ display: "flex", alignItems: "center", gap: 11, paddingLeft: 22 }}>
                  <Latido />
                  <span className="t-menor" style={{ color: "var(--t2)" }}>
                    Bajando {bajando.modelo}
                    {bajando.tamano && bajando.tamano !== "?" ? ` · ${bajando.tamano}` : ""}…
                  </span>
                </div>
              ) : (
                <div style={{ paddingLeft: 22 }}>
                  <Boton onClick={bajarModelos}>Bajar lo que falta</Boton>
                </div>
              )}
            </div>
          ) : (
            <Boton onClick={extraer}>Extraer sobre los artículos de calibración</Boton>
          )}
        </>
      )}

      {fase === "extrayendo" && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <Latido />
            <div>
              <div className="t-ui">
                {prog?.fase === "descargando" && "Descargando el cuerpo de los artículos"}
                {prog?.fase === "arrancando" && "Arrancando el extractor"}
                {prog?.fase === "cargando" && "Cargando los modelos"}
                {prog?.fase === "cargado" && "Modelos listos"}
                {prog?.fase === "extrayendo" && `Extrayendo · artículo #${prog.wp_id}`}
                {!prog && "Preparando"}
              </div>
              {prog?.fase === "cargando" && (
                <div className="t-menor" style={{ color: "var(--t3)", marginTop: 4, maxWidth: "52ch", lineHeight: 1.6 }}>
                  La primera vez se descargan (unos 500 MB entre los tres). Después quedan en caché.
                </div>
              )}
              {prog?.detalle && prog.fase === "cargado" && (
                <div className="t-menor" style={{ color: "var(--advertencia)", marginTop: 4 }}>{prog.detalle}</div>
              )}
            </div>
            <div style={{ flex: 1 }} />
            {prog && prog.total > 0 && (
              <span className="t-mono" style={{ color: "var(--t3)" }}>{prog.hechos}/{prog.total}</span>
            )}
          </div>
          <Barra pct={prog && prog.total ? (prog.hechos / prog.total) * 100 : 0} alto={4} />
          <div style={{ marginTop: 16 }}>
            <Boton variante="secundario" onClick={() => cancelarExtraccion()}>Detener</Boton>
          </div>
        </div>
      )}

      {fase === "revisar" && (
        <div>
          <div style={{ padding: "var(--esp-6)", background: "var(--acento-suave)", border: "1px solid var(--acento)", borderRadius: 10, marginBottom: "var(--esp-8)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8 }}>
              <Glifo estado="exito" size={11} />
              <span style={{ fontSize: 15, fontWeight: 500 }}>
                {revisados > 0
                  ? `${num(revisados)} de ${num(hechos)} artículos revisados.`
                  : `${num(hechos)} artículos extraídos, ninguno revisado todavía.`}
              </span>
            </div>
            <p className="t-cuerpo" style={{ color: "var(--t2)", margin: 0, maxWidth: "58ch" }}>
              {revisados > 0
                ? "Ya hay señal para calcular. Cuantos más revises, más fiable sale el corte de los tipos raros —montos, leyes, eventos—."
                : "Borra lo que sobra, añade lo que falta, arregla los tipos. Con quince artículos revisados ya hay señal suficiente."}
            </p>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
            {revisados > 0 ? (
              <>
                <Boton onClick={calcular}>Calcular la calibración</Boton>
                <Boton variante="secundario" onClick={() => estado.avanzar(5, "revision")}>Seguir revisando</Boton>
              </>
            ) : (
              <Boton onClick={() => estado.avanzar(5, "revision")}>Ir a revisar</Boton>
            )}
          </div>
        </div>
      )}

      {fase === "resultado" && res && (
        <div>
          {res.articulos === 0 ? (
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "13px 16px", background: "var(--advertencia-fondo)", borderRadius: 10 }}>
              <Glifo estado="advertencia" size={11} />
              <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.65, maxWidth: "58ch" }}>
                No hay artículos revisados todavía. La calibración necesita que cierres al menos unos
                cuantos en el paso de revisión: sin correcciones no hay nada de lo que aprender.
              </span>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: "var(--esp-11)", flexWrap: "wrap", marginBottom: "var(--esp-8)" }}>
                <Cifra v={dec(res.antes_f1)} pie="F1 antes" />
                <Cifra v={dec(res.despues_f1)} pie="F1 con la calibración" destacada />
                <Cifra v={String(res.articulos)} pie="artículos revisados" />
              </div>

              <Rotulo style={{ marginBottom: 12 }}>Qué cambia en cada tipo</Rotulo>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "var(--esp-8)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "140px 1fr 54px 54px 60px", gap: 12 }}>
                  {["", "", "antes", "después", "corte"].map((h, i) => (
                    <span key={i} className="t-menor" style={{ color: "var(--t3)", textAlign: i > 1 ? "right" : "left" }}>{h}</span>
                  ))}
                </div>
                {res.por_tipo.map((t) => {
                  const mejora = t.despues_f1 - t.antes_f1;
                  return (
                    <div key={t.tipo} style={{ display: "grid", gridTemplateColumns: "140px 1fr 54px 54px 60px", alignItems: "center", gap: 12 }}>
                      <span className="t-menor" style={{ color: "var(--t2)" }}>{etiquetaTipo(t.tipo)}</span>
                      <div style={{ height: 6, background: "var(--hundida)", borderRadius: 999, position: "relative", overflow: "hidden" }}>
                        <div style={{ position: "absolute", inset: 0, width: `${t.despues_f1 * 100}%`, background: colorTipo(t.tipo), opacity: 0.35, borderRadius: 999 }} />
                        <div style={{ position: "absolute", inset: 0, width: `${t.antes_f1 * 100}%`, background: colorTipo(t.tipo), borderRadius: 999 }} />
                      </div>
                      <span className="t-mono" style={{ textAlign: "right", color: "var(--t3)" }}>{dec(t.antes_f1)}</span>
                      <span className="t-mono" style={{ textAlign: "right", color: mejora > 0.01 ? "var(--exito)" : "var(--t2)" }}>{dec(t.despues_f1)}</span>
                      <span className="t-mono" style={{ textAlign: "right", color: "var(--t3)" }}>{dec(t.umbral, 2)}</span>
                    </div>
                  );
                })}
              </div>

              {res.rechazos_frecuentes.length > 0 && (
                <div style={{ marginBottom: "var(--esp-8)" }}>
                  <Rotulo style={{ marginBottom: 10 }}>
                    Dejará de proponer esto ({res.calibracion.bloqueadas.length})
                  </Rotulo>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {res.rechazos_frecuentes.slice(0, 16).map(([tipo, texto, n], i) => (
                      <span key={i} className="t-menor" style={{ border: "1px solid var(--borde)", borderRadius: 999, padding: "3px 10px", color: "var(--t2)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 2, background: colorTipo(tipo), display: "inline-block", marginRight: 6 }} />
                        {texto} <span style={{ color: "var(--t3)" }}>×{n}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {res.calibracion.diccionario.length > 0 && (
                <p className="t-menor" style={{ color: "var(--t3)", marginBottom: "var(--esp-8)", lineHeight: 1.7, maxWidth: "60ch" }}>
                  Y {res.calibracion.diccionario.length} entidades que marcaste y el modelo no vio
                  pasan al diccionario: se marcarán siempre que aparezcan. Es la parte de tu trabajo
                  que sobrevive al modelo que acabes usando.
                </p>
              )}

              <Acciones nota={aplicada ? "El lote ya usa estos cortes y este diccionario." : "Hasta que la apliques, el lote sigue con los cortes por defecto."}>
                {aplicada ? (
                  <Boton onClick={() => estado.avanzar(6, "extraccion")}>
                    Extraer sobre el resto del lote
                  </Boton>
                ) : (
                  <Boton onClick={aplicar}>Aplicar al lote</Boton>
                )}
                <Boton variante="enlace" onClick={() => estado.avanzar(5, "revision")}>revisar más artículos</Boton>
              </Acciones>
            </>
          )}
        </div>
      )}
    </Lienzo>
  );
}

function Etapas({ actual }: { actual: Fase }) {
  const idx = ETAPAS.findIndex(([f]) => f === actual);
  return (
    <ol aria-label="Etapas de la calibración" style={{ listStyle: "none", margin: "0 0 var(--esp-8)", padding: 0, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {ETAPAS.map(([f, nombre], i) => {
        const hecha = i < idx;
        const ahora = i === idx;
        return (
          <li key={f} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, padding: "4px 10px", borderRadius: 999, fontSize: 12.5, background: ahora ? "var(--hundida)" : "transparent", color: ahora ? "var(--t1)" : hecha ? "var(--t2)" : "var(--t3)", fontWeight: ahora ? 500 : 400 }}>
              <span aria-hidden style={{ fontSize: 10, color: hecha ? "var(--exito)" : ahora ? "var(--acento)" : "var(--t3)" }}>
                {hecha ? "✓" : ahora ? "●" : "○"}
              </span>
              {nombre}
            </span>
            {i < ETAPAS.length - 1 && <span aria-hidden style={{ color: "var(--borde-fuerte)", fontSize: 11 }}>›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Cifra({ v, pie, destacada }: { v: string; pie: string; destacada?: boolean }) {
  return (
    <div>
      <div style={{ fontFamily: "var(--font-serif-display)", fontSize: 36, lineHeight: 1.05, fontVariationSettings: "var(--fraunces-titulo)", color: destacada ? "var(--exito)" : "var(--t1)" }}>{v}</div>
      <div className="t-menor" style={{ color: "var(--t3)", marginTop: 5, maxWidth: "18ch" }}>{pie}</div>
    </div>
  );
}

function Familia({ titulo, opciones, valor, onChange, nota }: {
  titulo: string;
  opciones: OpcionModelo[];
  valor: string; onChange: (v: string) => void; nota?: string;
}) {
  return (
    <div>
      <Rotulo style={{ marginBottom: 8 }}>{titulo}</Rotulo>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {opciones.map((o) => (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            style={{
              display: "flex", gap: 10, alignItems: "baseline", appearance: "none",
              background: valor === o.id ? "var(--acento-suave)" : "transparent",
              border: `1px solid ${valor === o.id ? "var(--acento)" : "transparent"}`,
              borderRadius: 8, padding: "9px 11px", cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: 999, border: `1px solid ${valor === o.id ? "var(--acento)" : "var(--borde-fuerte)"}`, background: valor === o.id ? "var(--acento)" : "transparent", flex: "0 0 auto", marginTop: 3 }} />
            <span style={{ flex: 1 }}>
              <span style={{ fontSize: 13.5, color: "var(--t1)", display: "flex", alignItems: "baseline", gap: 7 }}>
                {o.nombre}
                {/* Un modelo que no está en la máquina se puede elegir igual;
                    lo que no se puede es empezar a extraer sin avisar. El
                    tamaño va en la etiqueta porque es lo que decide: bajar 892
                    MB y bajar 2,3 GB no son la misma respuesta. */}
                {o.instalado === false && (
                  <span
                    className="t-mono"
                    title="No está en este computador. Se baja una vez, desde el repositorio público del modelo, y queda guardado."
                    style={{ fontSize: 10, color: "var(--t3)", border: "1px solid var(--borde)", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}
                  >
                    ↓ {peso(o.mb)}
                  </span>
                )}
                {o.instalado === true && (
                  <span title="Ya está en este computador" style={{ fontSize: 10, color: "var(--exito)" }}>✓</span>
                )}
              </span>
              <span className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.55 }}>{o.nota}</span>
            </span>
          </button>
        ))}
      </div>
      {nota && (
        <p className="t-menor" style={{ color: "var(--t3)", margin: "8px 0 0 11px", lineHeight: 1.6, maxWidth: "56ch" }}>{nota}</p>
      )}
    </div>
  );
}

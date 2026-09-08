import { useCallback, useEffect, useRef, useState } from "react";
import { Acciones, Aviso, Barra, Boton, Cargando, Encabezado, Latido, Lienzo, Razon, Rotulo } from "../ui";
import {
  alFinCenso, alProgresoCenso, cancelarCenso, censoCorriendo,
  iniciarCenso, perfilArchivo, sondearArchivo,
} from "../lib/ipc";
import type { PerfilArchivo, ProgresoCenso } from "../types";
import type { EstadoApp } from "../App";

const num = (n: number) => n.toLocaleString("es-CO");
/** «2 min», «1 h 12 min». Los segundos sueltos no ayudan a nadie a decidir si
 *  esperar o irse a por un café. */
const duracion = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "—";
  if (s < 90) return `${Math.round(s)} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
};

const pct1 = (n: number) => n.toFixed(n < 10 ? 1 : 0).replace(".", ",");

export default function Perfil({ estado }: { estado: EstadoApp }) {
  const { sitio, conexionId, taxonomia } = estado;
  const [perfil, setPerfil] = useState<PerfilArchivo | null>(null);
  const [progreso, setProgreso] = useState<ProgresoCenso | null>(null);
  const [corriendo, setCorriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sondeando, setSondeando] = useState(false);
  /* Muestras de (instante, artículos censados) para estimar cuánto falta.
     Se mide sobre artículos y no sobre tramos porque los tramos no son
     comparables entre sí: un mes de 2013 trae 120 piezas y uno de 2020 trae
     800, así que «142 de 217 tramos» no dice nada sobre el tiempo. */
  const muestras = useRef<[number, number][]>([]);
  const [sinPermiso, setSinPermiso] = useState<string | null>(null);
  const desmontado = useRef(false);
  /* El sondeo se intenta una sola vez por visita: el efecto se vuelve a correr
     cuando cambia la taxonomía elegida, y sin esto pediría el sondeo otra vez
     por cada cambio. */
  const sondeoIntentado = useRef(false);
  const censoArrancado = useRef(false);
  /* Solo se atraviesa este paso la primera vez. Quien vuelva luego desde la
     barra lateral —a mirar el reparto por años, o a releer el archivo— se queda
     aquí: pasar de largo le quitaría la pantalla que vino a ver. */
  const deVuelta = useRef(estado.progreso >= 2);

  const cargar = useCallback(() => {
    if (conexionId == null) return;
    perfilArchivo(conexionId, taxonomia)
      .then((p) => {
        setPerfil(p);
        // Solo se guardan las que avanzan: repetir la misma cifra al reanudar
        // metería un tramo de velocidad cero y hundiría la estimación.
        const ultima = muestras.current[muestras.current.length - 1];
        if (!ultima || p.censado > ultima[1]) {
          muestras.current.push([Date.now(), p.censado]);
          // Un minuto de ventana: suficiente para no dar tumbos con cada 429,
          // corto para reaccionar cuando el sitio afloja.
          const desde = Date.now() - 60_000;
          while (muestras.current.length > 2 && muestras.current[0][0] < desde) {
            muestras.current.shift();
          }
        }
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

    /* Si se llega aquí sin haber sondeado el archivo —al volver a una sesión
       guardada de antes de que el sondeo pidiera credencial—, se sondea ahora.
       Sin esto la pantalla enseñaba ceros y el censo salía sin taxonomías. */
    if (!sondeoIntentado.current && estado.sitio
        && estado.sitio.capabilities.total_posts == null && conexionId != null) {
      sondeoIntentado.current = true;
      setSondeando(true);
      sondearArchivo(conexionId)
        .then((caps) => {
          if (desmontado.current || !estado.sitio) return;
          estado.setSitio({ ...estado.sitio, capabilities: caps });
        })
        .catch((e) => !desmontado.current && setSinPermiso(String(e).replace(/^Error:\s*/, "")))
        .finally(() => !desmontado.current && setSondeando(false));
    }
    /* El reparto por años se recalcula mientras el censo avanza, no solo al
       terminar. Ver crecer las barras año por año es lo que convierte una
       espera de cinco minutos en algo que se puede mirar; y de paso enseña algo
       cierto del archivo antes de que acabe.

       Se refresca como mucho cada dos segundos: la consulta del perfil recorre
       el censo entero y lanzarla en cada ventana la pondría a competir con las
       escrituras del propio censo. */
    let ultimoRefresco = 0;
    const un1 = alProgresoCenso((p) => {
      if (desmontado.current) return;
      setProgreso(p);
      const ahora = Date.now();
      if (p.fase === "censo" && ahora - ultimoRefresco > 2000) {
        ultimoRefresco = ahora;
        cargar();
      }
    });
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

  const cap = sitio?.capabilities;
  /* Se sabe cuántas piezas hay solo después de sondear el archivo, y sondear
     exige credencial. Al volver a una sesión guardada de antes de ese cambio,
     aquí no había nada y la pantalla afirmaba «recorre las 0 piezas», que no es
     un cero: es un dato que todavía no tenemos. */
  const totalRemoto = cap?.total_posts ?? null;
  const censado = perfil?.censado ?? 0;
  /* Terminado es haber recorrido todos los tramos, no alcanzar el total que
     anuncia el sitio. Ese total es un blanco móvil —La Silla publica unas 25
     piezas al día— y además incluye las de fecha dañada, que ninguna ventana de
     fecha alcanza. Comparado contra él, el censo nunca se daba por terminado y
     el botón de «seguir leyendo» no se iba por muchas veces que se pulsara. */
  const completo = censado > 0 && (perfil?.tramos_totales ?? 0) > 0
    && (perfil?.tramos_hechos ?? 0) >= (perfil?.tramos_totales ?? 0);
  /* Lo que el archivo creció desde que se leyó. No es trabajo pendiente: es una
     noticia sobre el archivo, y merece otra palabra. */
  const nuevos = completo && totalRemoto != null ? Math.max(0, totalRemoto - censado) : 0;
  /* Un archivo censado por una versión anterior tiene medido solo un puñado de
     cuerpos, y ahí las cifras que dependen del texto siguen siendo estimaciones.
     Desde que el censo baja el cuerpo con los metadatos, están todas contadas. */
  const parcial = perfil?.sondeo != null && perfil.sondeo.n < censado;

  /* Cuánto falta, en tiempo. Se calcula sobre el ritmo del último minuto y no
     sobre el promedio desde el principio: si el sitio empieza a frenar, un
     promedio global tardaría lo que dura el censo en enterarse. */
  const estimacion = (() => {
    const m = muestras.current;
    if (m.length < 2 || totalRemoto == null) return null;
    const [t0, c0] = m[0];
    const [t1, c1] = m[m.length - 1];
    const seg = (t1 - t0) / 1000;
    if (seg < 5 || c1 <= c0) return null;
    const ritmo = (c1 - c0) / seg;
    const faltan = Math.max(0, totalRemoto - c1);
    return { ritmo, seg: faltan / ritmo };
  })();

  async function censar(reiniciar: boolean) {
    if (conexionId == null) return;
    setError(null);
    setCorriendo(true);
    setProgreso({ fase: "terminos", ventana: "", hechos: 0, total: 0, cortesia_ms: 0, carriles: 0 });
    const taxs = (cap?.taxonomies ?? []).map((t) => t.rest_base);
    try {
      await iniciarCenso(conexionId, taxs, reiniciar);
    } catch (e) {
      setError(String(e));
      setCorriendo(false);
    }
  }


  /* La ventana se creía en marcha aunque en Rust no corriera nada.
     `corriendo` solo se apagaba al recibir `censo:fin`, así que una tarea que
     muriera sin emitirlo dejaba el latido girando para siempre: «Detener» no
     servía —cancelar solo levanta un aviso que ninguna tarea iba a leer— y el
     rearranque automático estaba bloqueado por `censoArrancado`. Preguntarle a
     Rust cada pocos segundos cura cualquier desajuste, venga de donde venga. */
  useEffect(() => {
    if (!corriendo) return;
    const t = setInterval(() => {
      censoCorriendo().then((vivo) => {
        if (vivo || desmontado.current) return;
        setCorriendo(false);
        setProgreso(null);
        // Y se permite volver a intentarlo: si nadie está leyendo el archivo,
        // el arranque automático tiene que poder ocurrir otra vez.
        censoArrancado.current = false;
        cargar();
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corriendo]);

  /* Leer el archivo no es una decisión que valga la pena poner a votación: se
     acaba de dar permiso para ello, y no hay nada que elegir. Arranca solo.

     «De vuelta» solo cuenta si hay algo a lo que volver. Tras «borrar y
     conectar otro» la sesión conservaba el progreso del medio anterior, así
     que la app se creía de vuelta en un archivo que ya no existía: no
     arrancaba el censo y enseñaba «Empezando a leer» sin empezar nada. */
  useEffect(() => {
    if ((deVuelta.current && censado > 0) || censoArrancado.current) return;
    if (sondeando || sinPermiso || corriendo) return;
    if (!perfil || totalRemoto == null) return;
    const listo = perfil.tramos_totales > 0 && perfil.tramos_hechos >= perfil.tramos_totales;
    if (listo) return; // ya está leído: el otro efecto se encarga de pasar
    censoArrancado.current = true;
    void censar(perfil.censado === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil, sondeando, sinPermiso, corriendo, totalRemoto, censado]);

  /* Y cuando termina, lleva a los hallazgos sin pedir un clic más: es el
     siguiente paso y no hay otra cosa que hacer aquí. */
  useEffect(() => {
    if (deVuelta.current || corriendo || !perfil) return;
    const listo = perfil.censado > 0 && perfil.tramos_totales > 0
      && perfil.tramos_hechos >= perfil.tramos_totales;
    if (listo) estado.avanzar(2, "sanidad");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil, corriendo]);

  if (!sitio || conexionId == null) return null;

  if (sondeando) {
    return (
      <Lienzo>
        <Encabezado paso="perfil" titulo="Antes de leer, preguntar" frase={null} compacto />
        <Cargando
          titulo="Preguntándole a tu WordPress qué hay dentro"
          pasos={[
            { texto: "Cuántas piezas hay publicadas" },
            { texto: "Cuál es la más vieja y cuál la más nueva" },
            { texto: "Qué filtros respeta la instalación", detalle: "fechas, campos, categorías" },
          ]}
          actual={1}
          nota="Son unas pocas peticiones a tu sitio, con pausas de cortesía entre ellas."
        />
      </Lienzo>
    );
  }

  if (sinPermiso && totalRemoto == null) {
    return (
      <Lienzo>
        <Encabezado paso="perfil" titulo="Falta el permiso del sitio" frase={sinPermiso} compacto />
        <Boton onClick={estado.retroceder}>Volver a la conexión</Boton>
      </Lienzo>
    );
  }

  return (
    <Lienzo>
      <Encabezado
        paso="perfil"
        titulo={completo ? "Esto es lo que hay dentro de tu archivo" : corriendo ? "Leyendo el archivo" : undefined}
        frase={completo
          ? "Legajo lo leyó preguntándole a tu propio WordPress. Nada de esto salió de tu computador."
          : totalRemoto != null
            ? `${num(totalRemoto)} piezas, a tu disco, con su texto. Es la única vez que se le pide el archivo al sitio.`
            : undefined}
        detalle={
          <>
            <Razon>Va por tramos mensuales y con pausas de cortesía entre peticiones, al ritmo que el sitio aguanta. Como se trae el texto y no solo los metadatos, tarda más y ocupa disco.</Razon>
            <Razon>De aquí en adelante todo se lee de tu disco: los pasos siguientes no vuelven a la red. Detener no pierde lo recorrido, y al volver retoma donde iba.</Razon>
          </>
        }
      />

      {error && <Aviso estado="error">{error}</Aviso>}

      {corriendo && progreso && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Latido />
            <span className="t-ui">
              {progreso.fase === "terminos" && (progreso.ventana
                ? `Trayendo los nombres de «${progreso.ventana}»`
                : "Trayendo los nombres de las secciones")}
              {progreso.fase === "rango" && "Preguntando desde cuándo hay archivo"}
              {progreso.fase === "censo" && `Descargando el archivo · ${progreso.ventana}`}
            </span>
            <div style={{ flex: 1 }} />
            <span className="t-mono" style={{ color: "var(--t3)" }}>
              {progreso.total > 0 ? `${progreso.hechos}/${progreso.total}` : ""}
            </span>
          </div>
          <Barra pct={progreso.total > 0 ? (progreso.hechos / progreso.total) * 100 : 0} alto={4} />

          {/* Lo que de verdad calma: cuánto falta, a qué ritmo, y por qué ese
              ritmo y no otro. Una barra sin tiempo obliga a adivinar si son dos
              minutos o media hora. */}
          <div style={{ display: "flex", gap: 20, alignItems: "baseline", marginTop: 12, flexWrap: "wrap" }}>
            {estimacion ? (
              <>
                <span style={{ fontSize: 15, color: "var(--t1)", fontVariantNumeric: "tabular-nums" }}>
                  faltan {duracion(estimacion.seg)}
                </span>
                <span className="t-mono" style={{ color: "var(--t3)", fontSize: 11.5 }}>
                  {Math.round(estimacion.ritmo)} artículos/s
                </span>
              </>
            ) : (
              <span className="t-menor" style={{ color: "var(--t3)" }}>midiendo el ritmo…</span>
            )}
            {/* El ritmo que el recorrido encontró para *este* sitio. No es una
                constante nuestra: sube sola mientras el servidor aguanta y baja
                a la mitad en cuanto se queja. */}
            {progreso.carriles > 0 && (
              <span className="t-menor" style={{ color: "var(--t3)" }}>
                · {progreso.carriles} {progreso.carriles === 1 ? "petición" : "peticiones"} a la vez
                {progreso.cortesia_ms > 400
                  ? `, y tu sitio nos pide esperar ${(progreso.cortesia_ms / 1000).toFixed(1).replace(".", ",")} s entre ellas`
                  : ""}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 18, alignItems: "center", marginTop: 14 }}>
            <Boton variante="secundario" onClick={() => cancelarCenso()}>Detener</Boton>
            <span className="t-menor" style={{ color: "var(--t3)" }}>
              Se guarda cada tramo al terminarlo: detener no pierde lo recorrido.
            </span>
          </div>
        </div>
      )}

      {/* Ya no hay botón para empezar a leer: el censo arranca solo al llegar,
          porque el permiso se acaba de dar y no queda nada que decidir. Lo que
          sí hace falta es poder pararlo, y eso vive en el bloque de progreso. */}
      {!corriendo && !completo && censado === 0 && (
        <div style={{ marginBottom: "var(--esp-11)" }}>
          <Cargando
            titulo="Empezando a leer el archivo"
            pasos={[
              { texto: "Traer los nombres de las secciones" },
              { texto: "Averiguar desde cuándo hay publicaciones" },
              { texto: "Recorrer el archivo mes a mes" },
            ]}
            actual={0}
          />
        </div>
      )}

      {/* Terminado, pero el archivo siguió creciendo. Eso no es trabajo a
          medias y no debe leerse como tal: quien quiera lo nuevo lo pide, y
          quien no, sigue adelante sin que nada le insista. */}
      {!corriendo && completo && nuevos > 0 && (
        <div style={{ marginBottom: "var(--esp-11)", display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
          <span className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.7, maxWidth: "48ch" }}>
            Tu archivo publicó {num(nuevos)} piezas más desde que lo leíste.
          </span>
          <button
            onClick={() => censar(false)}
            style={{ appearance: "none", background: "transparent", border: 0, padding: 0, color: "var(--acento)", cursor: "pointer", fontSize: 12.5, fontFamily: "var(--font-sans)" }}
          >
            traer lo nuevo
          </button>
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
                ? "Es el universo del que saldrá el lote."
                : `Van ${num(perfil.tramos_hechos)} de ${num(perfil.tramos_totales)} tramos. Puedes seguir al paso siguiente sin esperar.`}
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
                    ? `«${top.nombre}» concentra el ${pct1(cuota)} % del archivo: conviene mirar si es una sección editorial o un cajón de sastre antes de elegir el alcance por aquí.`
                    : `La mayor es «${top.nombre}» con el ${pct1(cuota)} %. ${unaVez > 0 ? `${unaVez} términos aparecen una sola vez y no sirven para acotar nada.` : "El reparto sirve para elegir el alcance por secciones."}`;
                })()}
              </Acto>
            )}

            {perfil.sondeo && (
              <>
                <Acto cifra={`${pct1(perfil.sondeo.pct_bloques)} %`} titulo="escrito con el editor de bloques" estimado={parcial}>
                  El resto es HTML plano heredado, donde el destaque y el pie de foto no se
                  distinguen del cuerpo y necesitan más revisión humana por artículo.
                </Acto>
                <Acto cifra={num(perfil.sondeo.palabras_p50)} titulo="palabras en el artículo mediano" estimado={parcial}>
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
              {parcial
                ? `Lo marcado como estimación sale de un sondeo sobre ${perfil.sondeo.n} artículos
                   elegidos al azar de forma reproducible: este archivo se censó con una versión
                   que no bajaba los cuerpos. Vuelve a lanzar la lectura para medirlos todos.`
                : `Todo esto está contado sobre las ${num(perfil.sondeo.n)} piezas del archivo, no
                   estimado sobre una muestra: el texto llegó con los metadatos en la misma
                   petición, así que medirlo entero no costó nada.`}
            </p>
          )}

          {/* Mientras se lee no hay nada que continuar: los hallazgos se
              calculan sobre el censo terminado. Un botón apagado ocupa el sitio
              de una acción y no es ninguna —invita a pulsarlo y no explica por
              qué no responde—, así que no se enseña hasta que sirve. */}
          {/* Un censo a medias —la app se cerró, se cortó la red— retoma por
              tramo: `ventanas_hechas` sabe cuáles ya están. Pero aquí la única
              acción de lectura que se ofrecía era «desde cero», así que quien
              volvía tras un corte pulsaba lo único que había y tiraba lo
              recorrido. Pasó de verdad: quince minutos de archivo, otra vez. */}
          {!corriendo && (
            <Acciones nota={completo ? undefined : "Retoma por el tramo donde se quedó; no repite lo ya leído."}>
              {!completo && <Boton onClick={() => censar(false)}>Seguir leyendo el archivo</Boton>}
              <Boton variante={completo ? "primario" : "secundario"} onClick={() => estado.avanzar(2, "sanidad")}>
                Ver los hallazgos
              </Boton>
              <Boton variante="enlace" onClick={() => censar(true)}>
                {completo ? "volver a leer el archivo desde cero" : "descartar lo leído y empezar desde cero"}
              </Boton>
            </Acciones>
          )}
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

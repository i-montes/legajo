import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AYUDA } from "./contenido/ayuda";
import {
  FASES, PASOS, anteriorDe, pasoDe, rotuloPaso,
  type Paso, type PasoNav,
} from "./contenido/pasos";
import Splash from "./ui/Splash";
import Actualizacion from "./ui/Actualizacion";
import Conexion from "./screens/Conexion";
import Perfil from "./screens/Perfil";
import Sanidad from "./screens/Sanidad";
import Alcance from "./screens/Alcance";
import Calibracion from "./screens/Calibracion";
import Revision from "./screens/Revision";
import Extraccion from "./screens/Extraccion";
import Grafo from "./screens/Grafo";
import Fundamentos from "./screens/Fundamentos";
import Servir from "./screens/Servir";
import { Aviso, Boton } from "./ui";
import { cargarSesion, guardarSesion, olvidarSesion } from "./lib/ipc";
import { combinarProgreso, progresoDeducido } from "./lib/progreso";
import {
  olvidarConexionRemota, useConexionRemotaGuardada, useModoRemoto, volverAModoLocal,
} from "./lib/conexionRemota";
import type { ConexionRemota } from "./lib/conexionRemota";
import { useIdentidad, useSesiones } from "./lib/presencia";
import type { Discovery, SesionRecuperada } from "./types";

/* Durante los tres primeros pasos la app se presenta sin cromo: son pantallas
   de entrada, y una barra de navegación con seis pasos bloqueados desanima
   antes de empezar.

   Pero solo la primera vez. Quien ya llegó al alcance y vuelve a la conexión a
   mirar algo se quedaba encerrado: la barra desaparecía y con ella la única
   forma de regresar al paso 5. Un adorno de bienvenida no puede convertirse en
   una trampa en cuanto la app se usa de verdad. */
const SIN_CROMO: Paso[] = ["conexion", "perfil", "sanidad"];

export interface EstadoApp {
  sitio: Discovery | null;
  conexionId: number | null;
  taxonomia: string | null;
  /** El lote de extracción activo: define sobre qué trabajan los pasos 5 a 8. */
  loteId: number | null;
  progreso: number;
  avanzar: (hasta: number, siguiente: Paso) => void;
  /** Vuelve al paso anterior sin deshacer nada de lo hecho. */
  retroceder: () => void;
  /** Abre el panel de ayuda del paso actual. */
  ayuda: () => void;
  /** Refresca lo que se sabe del sitio. Lo usa el paso 2 cuando llega sin
   *  sondeo, que pasa al volver a una sesión guardada de antes. */
  setSitio: (d: Discovery) => void;
  setTaxonomia: (t: string) => void;
  setLoteId: (id: number) => void;
}

export default function App() {
  const [tema, setTema] = useState<"claro" | "oscuro">("claro");
  const [paso, setPaso] = useState<Paso>("conexion");
  const [progreso, setProgreso] = useState(0);
  const [sitio, setSitio] = useState<Discovery | null>(null);
  const [conexionId, setConexionId] = useState<number | null>(null);
  const [taxonomia, setTaxonomia] = useState<string | null>(null);
  const [loteId, setLoteId] = useState<number | null>(null);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(true);
  /* La marca armándose, una vez por arranque. Corre en paralelo a recuperar la
     sesión, así que no cuesta tiempo: para cuando termina, lo que había que
     leer de la base ya está leído. */
  const [splash, setSplash] = useState(true);
  const [sesionPrevia, setSesionPrevia] = useState<SesionRecuperada | null>(null);
  const [servirAbierto, setServirAbierto] = useState(false);
  /* «Conectar otro archivo» borra por dónde ibas sin avisar —así fue como se
     bloqueó el usuario que motivó todo esto—. Ahora pide un segundo clic, con
     el mismo patrón que ya usa «olvidar» en `PantallaRemota` más abajo. */
  const [confirmarOtroArchivo, setConfirmarOtroArchivo] = useState(false);
  /* Trabajar contra la base de otra máquina, en vez de un archivo conectado
     aquí. `useModoRemoto` es reactivo: cuando `ConexionRemota.tsx` activa el
     modo, esta pantalla se entera sola y cambia de aspecto sin que nadie más
     tenga que avisarle. */
  const modoRemoto = useModoRemoto();
  const conexionRemota = useConexionRemotaGuardada();

  /* Se recupera dónde quedó la sesión anterior. El trabajo ya estaba a salvo en
     la base; lo que faltaba era volver a él sin repetir la conexión, el censo y
     la navegación cada vez que se cierra la ventana.

     Pero la fila de sesión —`paso`, `progreso`, `lote_id`— es un recuerdo, no
     la fuente de verdad: se escribe en cada cambio de pantalla y un clic de
     más («Conectar otro archivo» sin querer, o cualquier fallo que la deje a
     medias) la pone en cero sin tocar un solo dato real. `progresoDeducido`
     mira la base —conexión, censo, lotes, anotaciones— y dice el progreso
     mínimo que ESO puede demostrar; `combinarProgreso` se queda con el mayor
     entre lo guardado y lo deducido, así que un contador roto nunca puede
     esconder un lote que sí tiene trabajo. Corre incluso sin fila de sesión:
     si `cargarSesion` no trae nada, se busca la conexión guardada de todos
     modos.

     En modo remoto esto se salta entero: `llamar` mandaría esta consulta a la
     máquina remota, y guardar aquí su respuesta —su `connectionId`, su
     `loteId`— dejaría el estado de esta ventana apuntando a los identificadores
     de OTRA base. Si más tarde se «vuelve a esta máquina», ese estado se
     usaría con `invoke` local, contra una base donde esos números pueden no
     significar nada o, peor, significar otra cosa. `PantallaRemota` hace su
     propia lectura de la sesión, aparte, mientras dura el modo remoto. */
  useEffect(() => {
    if (modoRemoto) { setRestaurando(false); return; }
    let cancelado = false;
    (async () => {
      let s: SesionRecuperada | null = null;
      try { s = await cargarSesion(); } catch { /* se sigue igual: se deduce de la base */ }
      if (cancelado) return;
      if (s && s.sitio && s.connection_id != null) setSesionPrevia(s);

      const deducido = await progresoDeducido(
        s?.connection_id ?? null, s?.lote_id ?? null, s?.taxonomia ?? null
      ).catch(() => null);
      if (cancelado) return;

      const connectionId = deducido?.connectionId ?? s?.connection_id ?? null;
      if (connectionId == null) return; // ni sesión ni conexión guardada: sigue en el paso 1.

      setConexionId(connectionId);
      setTaxonomia(s?.taxonomia ?? null);
      setLoteId(deducido?.loteId ?? s?.lote_id ?? null);
      // `deducido.sitio` viene definido solo cuando hubo que ir a buscarlo
      // porque la sesión no traía el suyo; si la sesión sí lo traía, no se pisa.
      if (deducido && deducido.sitio !== undefined) setSitio(deducido.sitio);
      else if (s?.sitio) setSitio(s.sitio);
      setPaso((s?.paso as Paso) ?? "conexion");
      setProgreso(combinarProgreso(s?.progreso ?? 0, deducido?.progreso ?? 0));
    })().finally(() => { if (!cancelado) setRestaurando(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Cada movimiento se anota. Es una fila; no hace falta esperar a nada.

     Si falla, se dice. Un `catch` mudo aquí escondió durante toda una versión
     que la tabla se había quedado con el nombre viejo de una columna: no había
     ningún error a la vista, solo una app que volvía siempre al paso 1 como si
     nunca se hubiera usado. Se avisa una sola vez, no en cada tecla. */
  const falloSesion = useRef(false);
  useEffect(() => {
    // `paso` y `progreso` son el recorrido de ocho pasos de ESTA ventana, no
    // de la base: en modo remoto no tienen ningún significado que valga la
    // pena guardar, y escribirlos pisaría el «por dónde iba» que la máquina
    // que sí tiene el archivo guardó allí para sí misma.
    if (restaurando || modoRemoto) return;
    guardarSesion(conexionId, paso, progreso, taxonomia, loteId).catch((e) => {
      if (falloSesion.current) return;
      falloSesion.current = true;
      setAviso(`No se pudo guardar por dónde vas, así que al reabrir empezarás de nuevo: ${e}`);
    });
  }, [restaurando, conexionId, paso, progreso, taxonomia, loteId, modoRemoto]);

  useEffect(() => {
    document.documentElement.setAttribute("data-tema", tema);
  }, [tema]);

  const avanzar = useCallback((hasta: number, siguiente: Paso) => {
    setProgreso((p) => Math.max(p, hasta));
    setPaso(siguiente);
    setAviso(null);
    setAyudaAbierta(false);
  }, []);

  /* Volver al paso anterior. `progreso` no se toca: retroceder a revisar el
     alcance no deshace la calibración ni la extracción, solo mueve la vista. */
  const retroceder = useCallback(() => {
    setPaso((actual) => (actual === "fundamentos" ? actual : anteriorDe(actual)?.clave ?? actual));
    setAviso(null);
  }, []);

  const abrirAyuda = useCallback(() => setAyudaAbierta(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAyudaAbierta(false);
      const enCampo = !!(e.target as HTMLElement)?.closest("input,textarea");
      /* ⌥← para volver, como en un navegador. Se ignora dentro de un campo de
         texto, donde esa combinación mueve el cursor por palabras. */
      if (e.altKey && e.key === "ArrowLeft" && !enCampo) {
        e.preventDefault();
        retroceder();
      }
      if (e.key === "?" && !enCampo) setAyudaAbierta((v) => !v);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [retroceder]);

  const estado: EstadoApp = useMemo(
    () => ({ sitio, conexionId, taxonomia, loteId, progreso, avanzar, retroceder, ayuda: abrirAyuda,
             setSitio, setTaxonomia, setLoteId }),
    [sitio, conexionId, taxonomia, loteId, progreso, avanzar, retroceder, abrirAyuda]
  );

  /* Trabajando contra otra máquina, la app entera cambia de aspecto: nada del
     cromo de ocho pasos —conexión, censo, modelos, alcance, calibración,
     extracción— tiene sentido cuando el archivo, el censo y el extractor son
     de otra máquina. Se reemplaza el árbol entero por `PantallaRemota` en vez
     de intentar que las ocho pantallas se den cuenta cada una por su cuenta
     de que no aplican. */
  if (modoRemoto && conexionRemota) {
    return (
      <PantallaRemota
        estado={estado}
        conexion={conexionRemota}
        tema={tema}
        setTema={setTema}
        setConexionId={setConexionId}
        setTaxonomia={setTaxonomia}
        setLoteId={setLoteId}
        setSitio={setSitio}
      />
    );
  }

  const conCromo = !SIN_CROMO.includes(paso) || progreso >= 3;
  const ayuda = paso === "fundamentos" ? null : AYUDA[paso];

  const nombreSitio = sitio
    ? `${sitio.resolved_origin.replace(/^https?:\/\//, "")}${sitio.site_name ? " — " + sitio.site_name : ""}`
    : "sin archivo conectado";

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--t1)", overflow: "hidden" }}>
      {splash && <Splash onFin={() => setSplash(false)} />}
      {/* Fuera de la cabecera y de las pantallas: la cabecera no existe en los
          tres primeros pasos y el aviso tiene que poder verse en los ocho. */}
      {!splash && <Actualizacion />}
      {servirAbierto && <Servir onCerrar={() => setServirAbierto(false)} />}
      {conCromo && (
        <header style={{ flex: "0 0 auto", height: 38, display: "flex", alignItems: "center", gap: 16, padding: "0 14px", background: "var(--superficie)", borderBottom: "1px solid var(--borde)", userSelect: "none" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BotonVolver paso={paso} onClick={retroceder} />
            <span style={{ fontFamily: "var(--font-serif-display)", fontSize: 16, letterSpacing: ".2px" }}>Legajo</span>
            <span style={{ fontSize: 12, color: "var(--t3)" }}>{nombreSitio}</span>
          </div>
          <div style={{ flex: 1 }} />
          <div
            title="Todo el procesamiento ocurre en este computador. Legajo no envía texto del archivo a ningún servidor."
            style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--t2)", letterSpacing: ".2px" }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--exito)", display: "block" }} />
            Procesamiento local
          </div>
          <IndicadorPresencia />
          <BotonTema tema={tema} onClick={() => setTema(tema === "claro" ? "oscuro" : "claro")} borde />
          {/* La ayuda existía en los ocho pasos pero solo se veía en los tres
              primeros; en el resto había que saber que «?» la abría. */}
          {ayuda && <BotonAyuda onClick={abrirAyuda} />}
        </header>
      )}

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {conCromo && (
          <nav style={{ flex: "0 0 236px", display: "flex", flexDirection: "column", padding: "22px 14px 16px", background: "var(--superficie)", borderRight: "1px solid var(--borde)", minHeight: 0, overflow: "auto" }}>
            {/* Ocho pasos en fila no se recuerdan; tres tramos sí. Cada fase
                lleva su nombre y, cuando está en curso, lo que se consigue al
                terminarla: así la barra dice adónde se va y no solo dónde se
                está. */}
            {FASES.map((f) => {
              const pasosFase = PASOS.filter((p) => p.fase === f.clave);
              const primera = pasosFase[0].indice;
              const ultima = pasosFase[pasosFase.length - 1].indice;
              const estadoFase = progreso > ultima ? "completa" : progreso >= primera ? "curso" : "pendiente";
              return (
                <div key={f.clave} style={{ marginBottom: 18 }}>
                  <div className="t-rotulo" style={{ padding: "0 10px 6px", color: estadoFase === "pendiente" ? "var(--t3)" : "var(--t2)", display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span>{f.nombre}</span>
                    {estadoFase === "completa" && <span aria-hidden style={{ color: "var(--exito)", letterSpacing: 0 }}>✓</span>}
                  </div>
                  {estadoFase === "curso" && (
                    <div className="t-menor" style={{ padding: "0 10px 10px", color: "var(--t3)", lineHeight: 1.5 }}>
                      {f.logro}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {pasosFase.map((p) => {
                      const estadoPaso = p.indice < progreso ? "completo" : p.indice === progreso ? "curso" : "pendiente";
                      const bloqueado = p.indice > progreso;
                      const activo = paso === p.clave;
                      return (
                        <button
                          key={p.clave}
                          title={p.frase}
                          onClick={() =>
                            bloqueado
                              ? setAviso(`«${p.etiqueta}» se abre cuando completes «${PASOS[progreso].etiqueta}».`)
                              : (setPaso(p.clave), setAviso(null))
                          }
                          style={{
                            display: "grid", gridTemplateColumns: "14px 16px 1fr", alignItems: "center", gap: 9,
                            textAlign: "left", appearance: "none", border: 0, borderRadius: 6, cursor: "pointer",
                            padding: "7px 10px", fontSize: 13.5,
                            background: activo ? "var(--hundida)" : "transparent",
                            color: bloqueado ? "var(--t3)" : activo ? "var(--t1)" : "var(--t2)",
                            fontWeight: activo ? 500 : 400,
                          }}
                          onMouseEnter={(e) => { if (!activo) e.currentTarget.style.background = "var(--hundida)"; }}
                          onMouseLeave={(e) => { if (!activo) e.currentTarget.style.background = "transparent"; }}
                        >
                          <span aria-hidden style={{ fontSize: 10, textAlign: "center", color: estadoPaso === "completo" ? "var(--exito)" : estadoPaso === "curso" ? "var(--acento)" : "var(--t3)" }}>
                            {estadoPaso === "completo" ? "✓" : estadoPaso === "curso" ? "●" : "○"}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--t3)", fontVariantNumeric: "tabular-nums" }}>{p.num}</span>
                          <span>{p.etiqueta}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {aviso && (
              <div style={{ margin: "0 10px 14px", fontSize: 12, lineHeight: 1.55, color: "var(--t3)" }}>{aviso}</div>
            )}
            {sesionPrevia && sesionPrevia.paso !== paso && (
              <button
                onClick={() => { setPaso(sesionPrevia.paso as Paso); setAviso(null); }}
                style={{ margin: "0 6px 16px", appearance: "none", background: "var(--acento-suave)", border: "1px solid var(--acento)", borderRadius: 8, padding: "9px 11px", textAlign: "left", cursor: "pointer", color: "var(--t1)" }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>Volver donde ibas</div>
                <div style={{ fontSize: 11.5, color: "var(--t2)", marginTop: 3 }}>
                  {nombrePaso(sesionPrevia.paso)}
                </div>
              </button>
            )}
            <div style={{ flex: 1 }} />
            <button
              onClick={() => setPaso("fundamentos")}
              style={{ appearance: "none", border: 0, background: "transparent", textAlign: "left", padding: "8px 10px", fontSize: 12.5, color: "var(--t3)", cursor: "pointer", borderTop: "1px solid var(--borde)" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t1)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t3)")}
            >
              Fundamentos del sistema
            </button>
            <button
              onClick={() => setServirAbierto(true)}
              title="Enciende un servidor en esta máquina para que otra corrija por red contra esta misma base."
              style={{ appearance: "none", border: 0, background: "transparent", textAlign: "left", padding: "8px 10px", fontSize: 12.5, color: "var(--t3)", cursor: "pointer" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t1)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t3)")}
            >
              Servir a otro computador
            </button>

            {/* Separada de las dos anteriores a propósito: aquellas cambian de
                pantalla, esta borra por dónde ibas. Antes las tres eran la
                misma línea de texto gris y esa semejanza fue justo lo que
                llevó a pulsarla sin querer y quedar sin poder volver. Un
                margen, un trazo y un color de aviso bastan para que no se
                confunda con un botón cualquiera del pie. */}
            {!confirmarOtroArchivo ? (
              <button
                onClick={() => setConfirmarOtroArchivo(true)}
                title="Olvida por dónde ibas y a qué archivo estás conectado. No borra ninguna anotación."
                style={{
                  appearance: "none", border: 0, borderTop: "1px solid var(--borde)", background: "transparent",
                  textAlign: "left", padding: "12px 10px 8px", marginTop: 6, fontSize: 12.5,
                  color: "var(--error)", cursor: "pointer", opacity: 0.85,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.85")}
              >
                Conectar otro archivo…
              </button>
            ) : (
              <div style={{ borderTop: "1px solid var(--borde)", marginTop: 6, padding: "12px 10px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: "var(--t2)" }}>
                  Olvidas por dónde ibas y a qué archivo estabas conectado. <strong style={{ color: "var(--t1)" }}>
                  Las anotaciones, el censo, la muestra y los tiempos se quedan donde están:</strong> nada de eso se borra.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <Boton
                    variante="secundario"
                    onClick={() => {
                      setConfirmarOtroArchivo(false);
                      ejecutarOlvidoDeArchivo({
                        olvidarSesion, setSitio, setConexionId, setTaxonomia, setLoteId, setProgreso, setPaso, setAviso,
                      });
                    }}
                  >
                    Olvidar y conectar otro
                  </Boton>
                  <Boton variante="texto" onClick={() => setConfirmarOtroArchivo(false)}>cancelar</Boton>
                </div>
              </div>
            )}
          </nav>
        )}

        <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
          {!conCromo && paso !== "conexion" && (
            <div style={{ position: "absolute", top: 16, left: 20, zIndex: 30 }}>
              <BotonVolver paso={paso} onClick={retroceder} />
            </div>
          )}
          {!conCromo && (
            <div style={{ position: "absolute", top: 16, right: 20, zIndex: 30, display: "flex", gap: 8, alignItems: "center" }}>
              <BotonTema tema={tema} onClick={() => setTema(tema === "claro" ? "oscuro" : "claro")} />
              {ayuda && <BotonAyuda onClick={abrirAyuda} />}
            </div>
          )}

          {ayudaAbierta && ayuda && paso !== "fundamentos" && (
            <PanelAyuda paso={paso} ayuda={ayuda} onCerrar={() => setAyudaAbierta(false)} />
          )}

          {paso === "conexion" && (
            <Conexion
              estado={estado}
              onConectado={(d, id) => {
                setSitio(d);
                setConexionId(id);
                // Se elige de entrada la taxonomía jerárquica más poblada: es la
                // que en un medio hace de secciones. El usuario puede cambiarla.
                const jer = d.capabilities.taxonomies.filter((t) => t.hierarchical);
                setTaxonomia((jer[0] ?? d.capabilities.taxonomies[0])?.rest_base ?? null);
              }}
            />
          )}
          {paso === "perfil" && <Perfil estado={estado} />}
          {paso === "sanidad" && <Sanidad estado={estado} />}
          {paso === "alcance" && <Alcance estado={estado} />}
          {paso === "calibracion" && <Calibracion estado={estado} />}
          {paso === "revision" && <Revision estado={estado} />}
          {paso === "extraccion" && <Extraccion estado={estado} />}
          {paso === "grafo" && <Grafo estado={estado} />}
          {paso === "fundamentos" && <Fundamentos />}
        </main>
      </div>
    </div>
  );
}

const nombrePaso = (k: string) => {
  const p = pasoDe(k);
  return p ? `Paso ${p.indice + 1} · ${p.etiqueta}` : k;
};

/** Lo que hace de verdad «Conectar otro archivo» al confirmarse: olvida por
 *  dónde iba esta ventana y la deja lista para conectar desde cero. No toca
 *  el censo, la muestra, las anotaciones ni los tiempos —viven en otras
 *  tablas, atadas a la conexión y al lote, no a esta fila de sesión—.
 *
 *  Aparte de la pantalla y con sus dependencias inyectadas para poder
 *  probar, sin ambigüedad, que esto solo corre cuando se llama de verdad: el
 *  primer clic en el botón nunca debe ejecutar esto, solo mostrar la
 *  confirmación. */
export function ejecutarOlvidoDeArchivo(deps: {
  olvidarSesion: () => Promise<void>;
  setSitio: (d: Discovery | null) => void;
  setConexionId: (id: number | null) => void;
  setTaxonomia: (t: string | null) => void;
  setLoteId: (id: number | null) => void;
  setProgreso: (p: number) => void;
  setPaso: (p: Paso) => void;
  setAviso: (a: string | null) => void;
}): void {
  deps.olvidarSesion().catch(() => {});
  deps.setSitio(null);
  deps.setConexionId(null);
  deps.setTaxonomia(null);
  deps.setLoteId(null);
  deps.setProgreso(0);
  deps.setPaso("conexion");
  deps.setAviso(null);
}

/* ── Panel de ayuda ────────────────────────────────────────────────────────
   El mismo orden en los ocho pasos: qué es, qué consigues, qué haces, qué
   pasa después. Las razones van al final y plegadas: son para quien
   desconfía o tiene curiosidad, no para quien quiere terminar. */
function PanelAyuda({ paso, ayuda, onCerrar }: {
  paso: PasoNav; ayuda: (typeof AYUDA)[PasoNav]; onCerrar: () => void;
}) {
  const [razones, setRazones] = useState(false);
  const def = pasoDe(paso)!;
  return (
    <div
      onClick={onCerrar}
      style={{ position: "absolute", inset: 0, zIndex: 40, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,.12)" }}
    >
      <div
        role="dialog"
        aria-label={`Ayuda: ${def.titulo}`}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 420, maxWidth: "88%", height: "100%", overflow: "auto", background: "var(--elevada)", borderLeft: "1px solid var(--borde)", padding: "28px 28px 40px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, marginBottom: 18 }}>
          <span className="t-rotulo">{rotuloPaso(paso)}</span>
          <button onClick={onCerrar} style={{ appearance: "none", background: "transparent", border: 0, padding: 0, fontSize: 13, color: "var(--t3)", cursor: "pointer" }}>
            cerrar <span className="t-mono" style={{ fontSize: 11 }}>esc</span>
          </button>
        </div>
        <h2 style={{ fontFamily: "var(--font-serif-display)", fontWeight: 600, fontVariationSettings: "var(--fraunces-titulo)", fontSize: 26, lineHeight: 1.2, margin: "0 0 10px" }}>{def.titulo}</h2>
        <p style={{ margin: "0 0 28px", fontSize: 14.5, lineHeight: 1.65, color: "var(--t2)" }}>{ayuda.que}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <Seccion titulo="Qué haces aquí">
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 9 }}>
              {ayuda.como.map((c) => (
                <li key={c} style={{ fontSize: 14, lineHeight: 1.65 }}>{c}</li>
              ))}
            </ol>
          </Seccion>
          <Seccion titulo="Qué consigues"><p style={parrafo}>{ayuda.meta}</p></Seccion>
          <Seccion titulo="Y después"><p style={parrafo}>{ayuda.despues}</p></Seccion>

          {ayuda.porque && (
            <div>
              <button
                onClick={() => setRazones((v) => !v)}
                aria-expanded={razones}
                className="t-rotulo"
                style={{ appearance: "none", background: "transparent", border: 0, padding: 0, cursor: "pointer", letterSpacing: "1.2px", display: "flex", gap: 8, alignItems: "baseline" }}
              >
                <span aria-hidden style={{ letterSpacing: 0 }}>{razones ? "−" : "+"}</span> Por qué así
              </button>
              {razones && (
                <ul style={{ margin: "12px 0 0", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 9 }}>
                  {ayuda.porque.map((r) => (
                    <li key={r} style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--t2)" }}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {ayuda.reglas && (
            <Seccion titulo="Reglas de marcado">
              <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.7, color: "var(--t2)" }}>
                Salieron de anotar artículos reales. Están escritas porque la doble
                anotación solo mide criterio si las dos personas siguen las mismas.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {ayuda.reglas.map((r) => (
                  <div key={r.titulo}>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>{r.titulo}</div>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: "var(--t2)" }}>{r.texto}</p>
                  </div>
                ))}
              </div>
            </Seccion>
          )}
        </div>
      </div>
    </div>
  );
}

const parrafo = { margin: 0, fontSize: 14.5, lineHeight: 1.7, color: "var(--t1)" } as const;

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="t-rotulo" style={{ letterSpacing: "1.2px", marginBottom: 9 }}>{titulo}</div>
      {children}
    </div>
  );
}

/** Vuelve al paso anterior. No aparece en el primero, donde no hay atrás.
 *
 *  Va en la cabecera y no dentro de cada pantalla: así existe en las ocho sin
 *  depender de que cada una se acuerde de ponerlo, que es justo como se perdió.
 */
function BotonVolver({ paso, onClick }: { paso: Paso; onClick: () => void }) {
  if (paso === "fundamentos") return null;
  const anterior = anteriorDe(paso);
  if (!anterior) return null;
  return (
    <button
      onClick={onClick}
      title={`Volver a «${anterior.etiqueta}» (⌥←). No deshace nada de lo hecho.`}
      aria-label={`Volver a ${anterior.etiqueta}`}
      style={{
        appearance: "none", background: "transparent", border: "1px solid var(--borde)",
        borderRadius: 999, width: 24, height: 24, lineHeight: 1, fontSize: 13,
        color: "var(--t2)", cursor: "pointer", display: "grid", placeItems: "center",
        flex: "0 0 auto",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t1)"; e.currentTarget.style.borderColor = "var(--borde-fuerte)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t2)"; e.currentTarget.style.borderColor = "var(--borde)"; }}
    >
      ←
    </button>
  );
}

function BotonAyuda({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Qué es este paso y qué haces aquí (?)"
      aria-label="Ayuda de este paso"
      style={{ appearance: "none", background: "transparent", border: "1px solid var(--borde)", borderRadius: 999, width: 26, height: 26, fontSize: 13, color: "var(--t2)", cursor: "pointer", display: "grid", placeItems: "center", flex: "0 0 auto" }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t1)"; e.currentTarget.style.borderColor = "var(--borde-fuerte)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t2)"; e.currentTarget.style.borderColor = "var(--borde)"; }}
    >
      ?
    </button>
  );
}

function BotonTema({ tema, onClick, borde }: { tema: string; onClick: () => void; borde?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: "none", background: "transparent",
        border: borde ? "1px solid var(--borde)" : 0,
        borderRadius: 6, color: borde ? "var(--t2)" : "var(--t3)",
        fontSize: borde ? 11.5 : 12, padding: borde ? "4px 10px" : "6px 10px", cursor: "pointer",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t1)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = borde ? "var(--t2)" : "var(--t3)")}
    >
      {tema === "claro" ? "Modo oscuro" : "Modo claro"}
    </button>
  );
}

/** Quién más está anotando ahora mismo, cuando hay más de una sesión
 *  conectada al servidor de presencia (`lib/presencia.ts`). Con una sola
 *  sesión —el caso normal, un solo usuario local— no hay nada que mostrar:
 *  el indicador desaparece en vez de anunciar una compañía que no existe.
 *  Cada chip lleva su `title` con el artículo que esa sesión tiene abierto,
 *  para no tener que adivinarlo del emoji y el nombre solos. */
function IndicadorPresencia() {
  const sesiones = useSesiones();
  const yo = useIdentidad();
  if (sesiones.length <= 1) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, flexWrap: "wrap" }}>
      {sesiones.map((s) => {
        const esYo = s.sesion === yo?.sesion;
        const donde = s.loteId != null && s.wpId != null
          ? `en el artículo #${s.wpId} del lote ${s.loteId}`
          : "sin ningún artículo abierto";
        return (
          <span
            key={s.sesion}
            title={`${s.nombre}${esYo ? " (tú)" : ""} · ${donde}`}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "2px 8px",
              borderRadius: 999, border: `1px solid ${esYo ? "var(--acento)" : "var(--borde)"}`,
              color: esYo ? "var(--t1)" : "var(--t2)", fontWeight: esYo ? 600 : 400,
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden style={{ width: 5, height: 5, borderRadius: 999, background: esYo ? "var(--acento)" : "var(--t3)", display: "block" }} />
            <span aria-hidden>{s.emoji}</span>
            <span>{s.nombre}</span>
          </span>
        );
      })}
    </div>
  );
}

/* ── Modo remoto ───────────────────────────────────────────────────────────
   Trabajando contra la base de otra máquina no hay archivo que conectar, ni
   censo, ni modelos, ni extracción que configurar: todo eso ya lo hizo la
   máquina que tiene el archivo. Lo único que tiene sentido aquí es corregir
   —Revisión— y mirar el resultado —Grafo—, así que la app deja de ser un
   recorrido de ocho pasos y pasa a ser estas dos pantallas nada más.

   El indicador de arriba a la derecha no es decorativo: confundir esta
   ventana con la máquina local sería anotar creyendo que se escribe en la
   base remota cuando en realidad no hay ninguna escritura local posible —eso
   ya lo impide `lib/servidor.ts`—, pero el reverso también es un desastre:
   creer que se está en modo local y no encontrar los cambios porque en
   realidad se estaba corrigiendo la base de otra persona. */
function PantallaRemota({
  estado, conexion, tema, setTema, setConexionId, setTaxonomia, setLoteId, setSitio,
}: {
  estado: EstadoApp;
  conexion: ConexionRemota;
  tema: "claro" | "oscuro";
  setTema: (t: "claro" | "oscuro") => void;
  setConexionId: (id: number | null) => void;
  setTaxonomia: (t: string | null) => void;
  setLoteId: (id: number | null) => void;
  setSitio: (d: Discovery | null) => void;
}) {
  const [pestana, setPestana] = useState<"revision" | "grafo">("revision");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [confirmarOlvido, setConfirmarOlvido] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setCargando(true);
    setError(null);
    cargarSesion()
      .then((s) => {
        if (cancelado) return;
        if (s) {
          setConexionId(s.connection_id);
          setTaxonomia(s.taxonomia);
          setLoteId(s.lote_id);
          if (s.sitio) setSitio(s.sitio);
        }
      })
      .catch((e) => { if (!cancelado) setError(String(e).replace(/^Error:\s*/, "")); })
      .finally(() => { if (!cancelado) setCargando(false); });
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conexion, intento]);

  return (
    <div style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--t1)", overflow: "hidden" }}>
      <header style={{ flex: "0 0 auto", height: 38, display: "flex", alignItems: "center", gap: 16, padding: "0 14px", background: "var(--superficie)", borderBottom: "1px solid var(--borde)", userSelect: "none" }}>
        <span style={{ fontFamily: "var(--font-serif-display)", fontSize: 16, letterSpacing: ".2px" }}>Legajo</span>
        <nav style={{ display: "flex", gap: 4 }}>
          {(["revision", "grafo"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPestana(p)}
              style={{
                appearance: "none", border: 0, borderRadius: 6, cursor: "pointer",
                padding: "5px 11px", fontSize: 12.5,
                background: pestana === p ? "var(--hundida)" : "transparent",
                color: pestana === p ? "var(--t1)" : "var(--t3)",
              }}
            >
              {p === "revision" ? "Revisión" : "Grafo"}
            </button>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        {/* El indicador permanente: dirección y puerto, siempre a la vista,
            con un color que no se confunde con el verde de «todo corre en
            este computador» que usa la ventana local. */}
        <div
          title={`Trabajando por red contra ${conexion.direccion}:${conexion.puerto}. Nada se anota en este computador.`}
          style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--advertencia)", letterSpacing: ".2px" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--advertencia)", display: "block" }} />
          Remoto · {conexion.direccion}:{conexion.puerto}
        </div>
        <IndicadorPresencia />
        <BotonTema tema={tema} onClick={() => setTema(tema === "claro" ? "oscuro" : "claro")} borde />
        <Boton variante="texto" onClick={() => volverAModoLocal()}>trabajar en esta máquina</Boton>
        {!confirmarOlvido ? (
          <Boton variante="texto" onClick={() => setConfirmarOlvido(true)}>olvidar</Boton>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11.5, color: "var(--t3)" }}>¿Olvidar dirección y token?</span>
            <Boton variante="secundario" onClick={() => olvidarConexionRemota()}>Olvidar</Boton>
            <Boton variante="texto" onClick={() => setConfirmarOlvido(false)}>cancelar</Boton>
          </span>
        )}
      </header>

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {cargando && (
          <div style={{ padding: 32 }}>
            <p className="t-cuerpo" style={{ color: "var(--t3)" }}>Conectando con la base remota…</p>
          </div>
        )}
        {!cargando && error && (
          <div style={{ padding: 32, maxWidth: 520 }}>
            <Aviso estado="error">{error}</Aviso>
            <Boton variante="secundario" onClick={() => setIntento((i) => i + 1)}>Reintentar</Boton>
          </div>
        )}
        {!cargando && !error && pestana === "revision" && <Revision estado={estado} />}
        {!cargando && !error && pestana === "grafo" && <Grafo estado={estado} />}
      </main>
    </div>
  );
}

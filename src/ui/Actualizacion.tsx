import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { censoCorriendo, extrayendo } from "../lib/ipc";

/* El aviso de que hay una versión nueva.
   ─────────────────────────────────────────────────────────────────────────────
   Aparece abajo a la derecha y no en la cabecera porque la cabecera solo existe
   desde el paso 4: un aviso que solo se ve a mitad del recorrido no es un
   aviso. Y aparece como tarjeta y no como diálogo porque nada de esto es
   urgente —la versión instalada sigue funcionando— y cortar el trabajo de
   alguien para anunciarle una mejora es una forma rara de mejorar algo.

   Lo que se descarga son unos pocos megas: la app, no el extractor. El
   intérprete de Python y los modelos viven en el directorio de datos y no se
   tocan al actualizar. Es toda la razón por la que están ahí; está explicada
   en `core/src/entorno.rs`.

   Si no se puede consultar si hay versión nueva —sin red, el endpoint caído,
   una compilación de desarrollo sin publicación detrás— no se dice nada. Que
   Legajo no haya podido hablar con GitHub no es un problema de quien está
   catalogando un archivo, y un error rojo por eso enseña a ignorar los
   errores rojos. */

type Fase = "buscando" | "hay" | "bajando" | "instalada" | "nada";

/** Cuánto esperar antes de preguntar, para no competir con el arranque. */
const ESPERA_MS = 4000;

export default function Actualizacion() {
  const [fase, setFase] = useState<Fase>("buscando");
  const [version, setVersion] = useState("");
  const [pct, setPct] = useState(0);
  const [cerrado, setCerrado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  /* El objeto que el plugin devuelve tiene métodos, no solo datos: no puede
     viajar por el estado de React sin perderlos. */
  const nueva = useRef<Update | null>(null);

  useEffect(() => {
    let vivo = true;
    const t = setTimeout(() => {
      check()
        .then((u) => {
          if (!vivo || !u) return setFase("nada");
          nueva.current = u;
          setVersion(u.version);
          setFase("hay");
        })
        .catch((e) => {
          // A la consola y a ninguna otra parte. Ver el comentario de arriba.
          console.info("legajo: no se pudo consultar actualizaciones:", e);
          if (vivo) setFase("nada");
        });
    }, ESPERA_MS);
    return () => { vivo = false; clearTimeout(t); };
  }, []);

  const instalar = useCallback(async () => {
    const u = nueva.current;
    if (!u) return;
    setFase("bajando");
    let total = 0;
    let leidos = 0;
    try {
      await u.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        if (ev.event === "Progress") {
          leidos += ev.data.chunkLength;
          setPct(total > 0 ? Math.min(100, (leidos / total) * 100) : 0);
        }
      });
      setFase("instalada");
    } catch (e) {
      console.info("legajo: no se pudo instalar la actualización:", e);
      setFase("hay");
    }
  }, []);

  /* Reiniciar en medio de un censo o de una extracción tira horas de trabajo:
     las dos cosas corren en este proceso y ninguna sobrevive a que se cierre.
     Así que se pregunta antes, y si hay algo en marcha se dice qué es en vez de
     desactivar un botón sin explicar por qué. */
  const reiniciar = useCallback(async () => {
    const [censo, extra] = await Promise.all([
      censoCorriendo().catch(() => false),
      extrayendo().catch(() => false),
    ]);
    if (censo || extra) {
      setOcupado(
        censo
          ? "Hay una lectura del archivo en marcha. La versión nueva ya está instalada: se aplica al cerrar Legajo cuando termine."
          : "Hay una extracción en marcha. La versión nueva ya está instalada: se aplica al cerrar Legajo cuando termine."
      );
      return;
    }
    await relaunch();
  }, []);

  if (cerrado || fase === "nada" || fase === "buscando") return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed", right: 18, bottom: 18, zIndex: 35, width: 320,
        background: "var(--elevada)", border: "1px solid var(--borde)",
        borderRadius: 10, padding: "13px 14px",
        boxShadow: "0 6px 24px rgba(0,0,0,.10)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span className="t-rotulo" style={{ letterSpacing: "1.2px" }}>
          {fase === "instalada" ? "Lista para aplicarse" : "Versión nueva"}
        </span>
        <button
          onClick={() => setCerrado(true)}
          aria-label="Cerrar el aviso"
          style={{ appearance: "none", background: "transparent", border: 0, padding: 0, fontSize: 13, color: "var(--t3)", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>

      <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.5 }}>
        Legajo {version}
      </div>

      {fase === "hay" && (
        <>
          <p style={{ margin: "6px 0 11px", fontSize: 12, lineHeight: 1.55, color: "var(--t2)" }}>
            Son unos pocos megas: la app. El extractor y los modelos que ya
            bajaste se quedan donde están.
          </p>
          <Accion onClick={instalar}>Descargar</Accion>
        </>
      )}

      {fase === "bajando" && (
        <div style={{ marginTop: 10 }}>
          <div style={{ height: 3, background: "var(--hundida)", borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "var(--acento)", transition: "width .2s linear" }} />
          </div>
          <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 7, fontVariantNumeric: "tabular-nums" }}>
            {pct > 0 ? `${pct.toFixed(0)} %` : "empezando"}
          </div>
        </div>
      )}

      {fase === "instalada" && (
        <>
          <p style={{ margin: "6px 0 11px", fontSize: 12, lineHeight: 1.55, color: "var(--t2)" }}>
            {ocupado ??
              "Se aplica al reiniciar. Nada de lo hecho se pierde: la sesión vuelve al paso donde está."}
          </p>
          {!ocupado && <Accion onClick={reiniciar}>Reiniciar ahora</Accion>}
        </>
      )}
    </div>
  );
}

function Accion({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        appearance: "none", border: "1px solid var(--acento)", background: "var(--acento-suave)",
        color: "var(--t1)", borderRadius: 7, padding: "6px 12px", fontSize: 12.5, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

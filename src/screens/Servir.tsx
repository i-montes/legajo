/* El panel para servir esta base a otra máquina.
 *
 * Los tres comandos de Tauri —`servir_estado`, `servir_iniciar`,
 * `servir_detener`— todavía no existen del lado de Rust: los está haciendo
 * otro agente en paralelo, contra el contrato que describe `EstadoServidor`
 * en `types.ts`. Esta pantalla programa contra ese contrato tal cual está
 * escrito. `invoke` es genérico sobre el nombre del comando, así que
 * `tsc --noEmit` queda limpio de todos modos: lo que falta hasta que la otra
 * rama llegue es que el comando exista en tiempo de ejecución.
 *
 * Encender el servidor ya no pone esta ventana en pausa: sigue anotando con
 * normalidad. Lo que cambia es que, a partir de ahora, quien abre un
 * artículo —en esta máquina o en la remota— lo ocupa para las dos; el
 * bloqueo va por artículo y lo gobierna `lib/presencia.ts` por WebSocket, no
 * por encender o apagar este interruptor. Esta pantalla solo le avisa a ese
 * módulo del `EstadoServidor` fresco (`notificarEstadoServidor`) cada vez que
 * lo obtiene, para que sepa a qué puerto y con qué token hablarle mientras
 * el modo sea local.
 */
import { useEffect, useState } from "react";
import { Aviso, Boton, Rotulo } from "../ui";
import { servirDetener, servirEstado, servirIniciar } from "../lib/ipc";
import { generarCadenaConexion } from "../lib/conexionRemota";
import { notificarEstadoServidor } from "../lib/presencia";
import type { EstadoServidor } from "../types";

type Copiado = "direccion" | "puerto" | "token" | "cadena" | null;

function copiar(texto: string) {
  navigator.clipboard?.writeText(texto).catch(() => {});
}

export default function Servir({ onCerrar }: { onCerrar: () => void }) {
  const [estado, setEstado] = useState<EstadoServidor | null>(null);
  const [cargando, setCargando] = useState(true);
  const [cambiando, setCambiando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<Copiado>(null);
  const [direccionElegida, setDireccionElegida] = useState<string | null>(null);

  useEffect(() => {
    servirEstado()
      .then((e) => {
        setEstado(e);
        setDireccionElegida(e.direcciones[0] ?? null);
        notificarEstadoServidor(e);
      })
      .catch((e) => setError(String(e).replace(/^Error:\s*/, "")))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    if (copiado == null) return;
    const t = setTimeout(() => setCopiado(null), 1600);
    return () => clearTimeout(t);
  }, [copiado]);

  async function encender() {
    setCambiando(true);
    setError(null);
    try {
      const e = await servirIniciar(0);
      notificarEstadoServidor(e);
      setEstado(e);
      setDireccionElegida((d) => d ?? e.direcciones[0] ?? null);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setCambiando(false);
    }
  }

  async function apagar() {
    setCambiando(true);
    setError(null);
    try {
      const e = await servirDetener();
      notificarEstadoServidor(e);
      setEstado(e);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setCambiando(false);
    }
  }

  const direccion = direccionElegida ?? estado?.direcciones[0] ?? null;
  const cadena = estado?.activo && direccion
    ? generarCadenaConexion({ direccion, puerto: estado.puerto, token: estado.token })
    : null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end", background: "rgba(0,0,0,.12)" }} onClick={onCerrar}>
      <div
        role="dialog"
        aria-label="Servir esta base a otro computador"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "92%", height: "100%", overflow: "auto", background: "var(--elevada)", borderLeft: "1px solid var(--borde)", padding: "28px 28px 40px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <Rotulo>Servir a otro computador</Rotulo>
          <Boton variante="texto" onClick={onCerrar}>cerrar</Boton>
        </div>

        <h2 className="t-display" style={{ fontSize: 22, margin: "0 0 10px" }}>Corregir desde otra máquina</h2>
        <p className="t-cuerpo" style={{ margin: "0 0 20px", color: "var(--t2)", maxWidth: "48ch" }}>
          Enciende el servidor y pasa la cadena de conexión a la otra máquina. Esta ventana sigue
          anotando con normalidad: el bloqueo ahora es por artículo, no por máquina — quien abre un
          artículo en cualquiera de las dos lo ocupa para las dos, y las dos pueden seguir corrigiendo
          artículos distintos a la vez.
        </p>

        {cargando && <p className="t-cuerpo" style={{ color: "var(--t3)" }}>Consultando el estado…</p>}

        {error && <Aviso estado="error">{error}</Aviso>}

        {!cargando && estado && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "20px 0 24px" }}>
              <Interruptor
                activo={estado.activo}
                deshabilitado={cambiando}
                onClick={() => (estado.activo ? apagar() : encender())}
              />
              <span style={{ fontSize: 14, fontWeight: 500, color: "var(--t1)" }}>
                {estado.activo ? "Sirviendo" : "Apagado"}
              </span>
            </div>

            {estado.activo && (
              <>
                <Aviso estado="advertencia">
                  Esta ventana sigue anotando con normalidad. El bloqueo ahora es por artículo:
                  el que abras aquí o desde la otra máquina queda ocupado para las dos hasta que
                  se cierre o se suelte.
                </Aviso>

                <div style={{ display: "flex", flexDirection: "column", gap: 14, margin: "20px 0" }}>
                  <Dato
                    etiqueta="Dirección"
                    valor={direccion ?? "sin detectar"}
                    onCopiar={direccion ? () => { copiar(direccion); setCopiado("direccion"); } : undefined}
                    copiado={copiado === "direccion"}
                  >
                    {estado.direcciones.length > 1 && (
                      <select
                        value={direccion ?? ""}
                        onChange={(e) => setDireccionElegida(e.target.value)}
                        style={{ marginTop: 8, width: "100%", background: "var(--hundida)", border: "1px solid var(--borde)", borderRadius: 6, padding: "6px 8px", color: "var(--t1)", fontSize: 12.5 }}
                      >
                        {estado.direcciones.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                    )}
                  </Dato>
                  <Dato
                    etiqueta="Puerto"
                    valor={String(estado.puerto)}
                    onCopiar={() => { copiar(String(estado.puerto)); setCopiado("puerto"); }}
                    copiado={copiado === "puerto"}
                  />
                  <Dato
                    etiqueta="Token"
                    valor={estado.token}
                    mono
                    onCopiar={() => { copiar(estado.token); setCopiado("token"); }}
                    copiado={copiado === "token"}
                  />
                </div>

                {cadena && (
                  <div style={{ marginTop: 8 }}>
                    <Rotulo style={{ marginBottom: 8 }}>Cadena de conexión</Rotulo>
                    <p className="t-menor" style={{ color: "var(--t2)", margin: "0 0 10px", lineHeight: 1.6 }}>
                      Pásala tal cual a la otra máquina: en su pantalla de conexión, pegarla rellena
                      dirección, puerto y token de una vez.
                    </p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <code
                        style={{
                          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--hundida)",
                          border: "1px solid var(--borde)", borderRadius: 6, padding: "8px 10px", color: "var(--t1)",
                        }}
                      >
                        {cadena}
                      </code>
                      <Boton variante="secundario" onClick={() => { copiar(cadena); setCopiado("cadena"); }}>
                        {copiado === "cadena" ? "Copiada ✓" : "Copiar"}
                      </Boton>
                    </div>
                  </div>
                )}
              </>
            )}

            {!estado.activo && (
              <p className="t-menor" style={{ color: "var(--t3)", lineHeight: 1.6, maxWidth: "44ch" }}>
                Al encender, Legajo elige un puerto libre y genera un token nuevo. Las direcciones que
                se ofrecen son las de esta máquina en tu red local.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Interruptor({ activo, deshabilitado, onClick }: { activo: boolean; deshabilitado: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={activo}
      disabled={deshabilitado}
      onClick={onClick}
      title={activo ? "Apagar el servidor" : "Encender el servidor"}
      style={{
        appearance: "none", width: 42, height: 24, borderRadius: 999, border: "1px solid var(--borde)",
        background: activo ? "var(--exito)" : "var(--hundida)", position: "relative", cursor: deshabilitado ? "default" : "pointer",
        opacity: deshabilitado ? 0.6 : 1, flex: "0 0 auto",
      }}
    >
      <span
        style={{
          position: "absolute", top: 2, left: activo ? 20 : 2, width: 18, height: 18, borderRadius: 999,
          background: "var(--elevada)", transition: "left 150ms cubic-bezier(.2,0,0,1)",
        }}
      />
    </button>
  );
}

function Dato({ etiqueta, valor, mono, onCopiar, copiado, children }: {
  etiqueta: string; valor: string; mono?: boolean;
  onCopiar?: () => void; copiado?: boolean; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="t-menor" style={{ color: "var(--t3)", marginBottom: 4 }}>{etiqueta}</div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <span style={{ fontFamily: mono ? "var(--font-mono)" : "inherit", fontSize: mono ? 13 : 14.5, color: "var(--t1)", wordBreak: "break-all" }}>
          {valor}
        </span>
        {onCopiar && (
          <Boton variante="enlace" onClick={onCopiar}>
            {copiado ? "copiado ✓" : "copiar"}
          </Boton>
        )}
      </div>
      {children}
    </div>
  );
}

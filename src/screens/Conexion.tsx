import { useCallback, useEffect, useState } from "react";
import { Boton, Campo, Etiqueta, Glifo, Latido, Rotulo } from "../ui";
import { cargarSesion, discoverSite, listConnections, saveConnection } from "../lib/ipc";
import type { ConnectionRow, Discovery, SesionRecuperada } from "../types";
import type { EstadoApp } from "../App";

type Fase = "reposo" | "verificando" | "conectado" | "error";

interface ErrorConexion {
  clave: string;
  titulo: string;
  estado: "error" | "advertencia";
  causa: string;
  hacer: string;
}

/* El backend devuelve un mensaje con el detalle de cada intento. Aquí se
   traduce a la taxonomía de errores del diseño, que dice qué hacer en vez de
   limitarse a informar de que algo falló. */
function clasificar(bruto: string): ErrorConexion {
  const m = bruto.toLowerCase();

  if (m.includes("no encontre una rest api")) {
    return {
      clave: "err-sitio",
      titulo: "El sitio no responde como un WordPress",
      estado: "error",
      causa:
        "El servidor respondió, pero no encontramos la ruta /wp-json/. Puede ser otro gestor de contenidos, o WordPress instalado en un subdirectorio.",
      hacer: "Prueba con la dirección exacta del panel de administración, por ejemplo tumedio.co/redaccion.",
    };
  }
  if (m.includes("certificado") || m.includes("tls") || m.includes("https")) {
    return {
      clave: "err-https",
      titulo: "El sitio no usa HTTPS",
      estado: "error",
      causa: "La autorización automática envía credenciales y solo funciona sobre una conexión cifrada.",
      hacer: "Pide al administrador que instale un certificado, o usa la conexión manual desde una red de confianza.",
    };
  }
  if (m.includes("no parece una direccion") || m.includes("escribe la direccion")) {
    return {
      clave: "err-url",
      titulo: "Esa dirección no se entiende",
      estado: "advertencia",
      causa: "Legajo no pudo interpretar lo que escribiste como una dirección web.",
      hacer: "Escribe el dominio como lo usas a diario, por ejemplo tumedio.co.",
    };
  }
  return {
    clave: "err-red",
    titulo: "No se pudo llegar al sitio",
    estado: "error",
    causa: bruto,
    hacer: "Comprueba tu conexión y que la dirección sea la correcta.",
  };
}

/* La plataforma se deduce de los namespaces que el propio sitio anuncia. */
function instalacion(d: Discovery): string {
  const ns = d.namespaces;
  const partes: string[] = [];
  if (ns.some((n) => n.startsWith("newspack"))) partes.push("Newspack");
  if (ns.some((n) => n.startsWith("jetpack") || n.startsWith("wpcom"))) partes.push("Jetpack");
  if (ns.some((n) => n.startsWith("wc/"))) partes.push("WooCommerce");
  if (d.transport.kind === "wpcom") partes.push("Alojado en WordPress.com");
  return partes.length ? partes.join(" · ") : "WordPress";
}

export default function Conexion({
  estado,
  onConectado,
  onAyuda,
}: {
  estado: EstadoApp;
  onConectado: (d: Discovery, id: number) => void;
  onAyuda: () => void;
}) {
  const [url, setUrl] = useState("");
  const [fase, setFase] = useState<Fase>("reposo");
  const [hallazgo, setHallazgo] = useState<Discovery | null>(estado.sitio);
  const [error, setError] = useState<ErrorConexion | null>(null);
  const [manual, setManual] = useState(false);
  const [verRecientes, setVerRecientes] = useState(false);
  const [recientes, setRecientes] = useState<ConnectionRow[]>([]);
  const [sesion, setSesion] = useState<SesionRecuperada | null>(null);

  const cargarRecientes = useCallback(() => {
    listConnections().then(setRecientes).catch(() => setRecientes([]));
  }, []);
  useEffect(cargarRecientes, [cargarRecientes]);

  /* Si hay trabajo a medias, lo primero que se ve es la forma de volver a él.
     Sin esto, reabrir la app parecía obligar a empezar de cero aunque el censo,
     la muestra y las anotaciones siguieran intactos en la base. */
  useEffect(() => {
    cargarSesion()
      .then((s) => setSesion(s && s.connection_id != null && s.paso !== "conexion" ? s : null))
      .catch(() => {});
  }, []);

  async function conectar(destino?: string) {
    const valor = (destino ?? url).trim();
    if (!valor) return;
    setUrl(valor);
    setFase("verificando");
    setError(null);
    try {
      const d = await discoverSite(valor);
      setHallazgo(d);
      setFase("conectado");
      const id = await saveConnection(d.resolved_origin, d.site_name ?? "");
      onConectado(d, id);
      cargarRecientes();
    } catch (e) {
      setError(clasificar(String(e)));
      setFase("error");
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "48px 32px" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <h1 style={{ fontFamily: "var(--font-serif-display)", fontWeight: 500, fontVariationSettings: "var(--fraunces-display)", fontSize: 34, lineHeight: 1.15, letterSpacing: "-.4px", margin: "0 0 10px" }}>
          Conecta el archivo
        </h1>
        <p style={{ margin: "0 0 40px", fontSize: 14.5, lineHeight: 1.6, color: "var(--t2)", maxWidth: "34ch" }}>
          Diagnostica el archivo de tu medio. Empieza por la dirección del sitio.
        </p>

        {sesion && (
          <div style={{ marginBottom: "var(--esp-8)", padding: "16px 18px", borderRadius: 10, background: "var(--acento-suave)", border: "1px solid var(--acento)" }}>
            <Rotulo style={{ marginBottom: 8 }}>Trabajo a medias</Rotulo>
            <p style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.6, color: "var(--t1)" }}>
              Dejaste {sesion.etiqueta ?? "un archivo"} en{" "}
              <strong style={{ fontWeight: 500 }}>{NOMBRES[sesion.paso] ?? sesion.paso}</strong>.
              Todo sigue guardado: el censo, la muestra, las anotaciones y los tiempos.
            </p>
            <Boton onClick={() => estado.avanzar(sesion.progreso, sesion.paso as never)}>
              Continuar donde ibas
            </Boton>
          </div>
        )}

        <Campo
          value={url}
          onChange={setUrl}
          placeholder="tumedio.co"
          autoFocus
          onEnter={() => fase !== "verificando" && conectar()}
        />

        <div style={{ height: 18 }} />

        {fase === "reposo" && (
          <div>
            <Boton onClick={() => conectar()} disabled={!url.trim()}>
              Conectar con WordPress
            </Boton>
            <div style={{ height: 14 }} />
            <Boton variante="enlace" onClick={() => setManual(!manual)}>
              {manual ? "ocultar conexión manual" : "conectar manualmente"}
            </Boton>
          </div>
        )}

        {fase === "verificando" && (
          <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13.5 }}>
              <Latido /> Verificando el sitio
            </div>
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, color: "var(--t2)" }}>
              <li>· Resolviendo la dirección y siguiendo redirecciones</li>
              <li>· Buscando la REST API</li>
              <li>· Sondeando qué permite el sitio</li>
            </ul>
          </div>
        )}

        {fase === "conectado" && hallazgo && (
          <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5, marginBottom: 14 }}>
              <Glifo estado="exito" /> Conectado
            </div>
            <dl style={{ margin: "0 0 22px", display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 22, rowGap: 7, fontSize: 13 }}>
              <Dato k="Sitio">
                {hallazgo.site_name ?? "—"} · {hallazgo.resolved_origin.replace(/^https?:\/\//, "")}
              </Dato>
              <Dato k="Acceso">
                {hallazgo.capabilities.anonymous_read
                  ? "lectura anónima (sin credenciales)"
                  : `requiere autenticación · HTTP ${hallazgo.capabilities.read_status}`}
              </Dato>
              <Dato k="Instalación">{instalacion(hallazgo)}</Dato>
              <Dato k="Archivo">
                {hallazgo.capabilities.total_posts?.toLocaleString("es-CO") ?? "—"} artículos ·{" "}
                {anio(hallazgo.capabilities.oldest_date)}—{anio(hallazgo.capabilities.newest_date)}
              </Dato>
            </dl>

            {hallazgo.capabilities.notes.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 22px", display: "flex", flexDirection: "column", gap: 8 }}>
                {hallazgo.capabilities.notes.map((n) => (
                  <li key={n} style={{ display: "flex", gap: 9, alignItems: "baseline", fontSize: 12.5, lineHeight: 1.6, color: "var(--t2)" }}>
                    <Glifo estado="advertencia" size={11} />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}

            <Boton onClick={() => estado.avanzar(1, "perfil")}>Perfilar la instalación</Boton>
            <div style={{ height: 12 }} />
            <Boton variante="enlace" onClick={onAyuda}>qué pasa en el siguiente paso</Boton>
          </div>
        )}

        {fase === "error" && error && (
          <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
            <div style={{ display: "flex", gap: 9, alignItems: "baseline", marginBottom: 8 }}>
              <Glifo estado={error.estado} />
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>{error.titulo}</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.65, color: "var(--t2)", maxWidth: "44ch" }}>{error.causa}</p>
            <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.65, color: "var(--t1)", maxWidth: "44ch" }}>{error.hacer}</p>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <Boton variante="secundario" onClick={() => conectar()}>Reintentar</Boton>
              <Boton variante="enlace" onClick={() => setManual(!manual)}>
                {manual ? "ocultar conexión manual" : "conectar manualmente"}
              </Boton>
            </div>
          </div>
        )}

        {manual && (
          <div style={{ marginTop: 26, paddingTop: 20, borderTop: "1px solid var(--borde)" }}>
            <Rotulo style={{ marginBottom: 6 }}>Conexión manual</Rotulo>
            <p style={{ margin: "0 0 18px", fontSize: 12.5, lineHeight: 1.6, color: "var(--t3)", maxWidth: "42ch" }}>
              Solo si la autorización automática no está disponible en tu instalación.
            </p>
            <Etiqueta>Usuario</Etiqueta>
            <Campo value="" onChange={() => {}} placeholder="tu.usuario" />
            <div style={{ height: 14 }} />
            <Etiqueta>Contraseña de aplicación</Etiqueta>
            <Campo value="" onChange={() => {}} placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" mono />
            <div style={{ height: 14 }} />
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <Glifo estado="neutro" size={11} />
              <span style={{ fontSize: 12, lineHeight: 1.6, color: "var(--t3)" }}>
                Todavía sin conectar al backend: el flujo de contraseñas de aplicación llega en el hito 2.
              </span>
            </div>
          </div>
        )}

        <div style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid var(--borde)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--t3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--exito)", display: "block" }} />
            El archivo nunca sale de este computador.
          </span>
          {recientes.length > 0 && (
            <Boton variante="enlace" onClick={() => setVerRecientes(!verRecientes)}>
              {verRecientes
                ? "ocultar sitios guardados"
                : `${recientes.length} ${recientes.length === 1 ? "sitio guardado" : "sitios guardados"}`}
            </Boton>
          )}
        </div>

        {verRecientes && (
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 1 }}>
            {recientes.map((r) => (
              <button
                key={r.id}
                onClick={() => conectar(r.resolved_origin)}
                style={{ appearance: "none", background: "transparent", border: 0, borderRadius: 6, padding: "9px 10px", textAlign: "left", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 14, alignItems: "baseline", color: "var(--t1)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hundida)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ fontSize: 13 }}>{r.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--t3)" }}>
                  {r.total_posts ? `${r.total_posts.toLocaleString("es-CO")} artículos` : r.resolved_origin}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Dato({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt style={{ color: "var(--t3)" }}>{k}</dt>
      <dd style={{ margin: 0, color: "var(--t1)" }}>{children}</dd>
    </>
  );
}

const NOMBRES: Record<string, string> = {
  perfil: "el perfil del archivo",
  sanidad: "la sanidad del archivo",
  muestreo: "el diseño de la muestra",
  anotacion: "la anotación",
  extraccion: "la extracción",
  resolucion: "la resolución de entidades",
  reporte: "el reporte",
};

const anio = (d: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : "?");

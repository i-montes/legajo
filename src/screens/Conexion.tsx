import { useCallback, useEffect, useState } from "react";
import { Boton, Campo, Cargando, Glifo, Rotulo } from "../ui";
import {
  cargarSesion, conexionGuardada, deleteConnection, discoverSite, duenio,
  pasoAutorizacion, probarCredencial, saveConnection, sondearArchivo,
  alFaseConexion,
} from "../lib/ipc";
import type { ConexionGuardada, Discovery, Identidad, PasoAutorizacion, SesionRecuperada } from "../types";
import type { EstadoApp } from "../App";
import { nombreEnFrase, pasoDe, type Paso } from "../contenido/pasos";

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
      hacer: "Pide al administrador del sitio que instale un certificado. Sin HTTPS, WordPress tampoco emite contraseñas de aplicación.",
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
}: {
  estado: EstadoApp;
  onConectado: (d: Discovery, id: number) => void;
}) {
  const [url, setUrl] = useState("");
  const [correo, setCorreo] = useState("");
  const [fase, setFase] = useState<Fase>("reposo");
  const [hallazgo, setHallazgo] = useState<Discovery | null>(estado.sitio);
  const [error, setError] = useState<ErrorConexion | null>(null);
  const [porBorrar, setPorBorrar] = useState(false);
  const [conexionId, setConexionId] = useState<number | null>(null);
  /* El medio conectado. Legajo trabaja con un archivo a la vez: hay uno o no
     hay ninguno, y cambiarlo es olvidar el anterior con todo lo que lleve
     encima. Antes esto era una lista de sitios guardados, y pulsar uno lo
     reconectaba sin ofrecer ninguna forma de seguir adelante. */
  const [guardado, setGuardado] = useState<ConexionGuardada | null>(null);
  const [cargandoGuardado, setCargandoGuardado] = useState(true);
  const [sesion, setSesion] = useState<SesionRecuperada | null>(null);
  /* Segunda etapa: probar que quien conecta pertenece al sitio. Leer un archivo
     público no necesita credenciales, pero quedarse con él entero para hacer su
     grafo sí debería: la contraseña de aplicación es la prueba, la emite el
     propio WordPress y se revoca desde allí sin tocar nada más. */
  const [autorizacion, setAutorizacion] = useState<PasoAutorizacion | null>(null);

  const [secreto, setSecreto] = useState("");
  const [identidad, setIdentidad] = useState<Identidad | null>(null);
  const [probando, setProbando] = useState(false);
  /* Qué está ocurriendo entre confirmar la contraseña y llegar al paso
     siguiente. Sin esto, al confirmar desaparecía el formulario y el sondeo del
     archivo —seis peticiones al sitio— corría con la pantalla muda. */
  const [preparando, setPreparando] = useState<number | null>(null);
  /* En qué transporte va el descubrimiento. Lo dice Rust antes de intentar
     cada uno, así que no es una cuenta atrás inventada: son los intentos que de
     verdad se están haciendo contra el servidor. */
  const [faseConexion, setFaseConexion] = useState("normalizando");
  const [errorCred, setErrorCred] = useState<string | null>(null);
  const [comoSacarla, setComoSacarla] = useState(false);


  const cargarGuardado = useCallback(() => {
    conexionGuardada()
      .then(setGuardado)
      .catch(() => setGuardado(null))
      .finally(() => setCargandoGuardado(false));
  }, []);
  useEffect(cargarGuardado, [cargarGuardado]);

  /* Si hay trabajo a medias, lo primero que se ve es la forma de volver a él.
     Sin esto, reabrir la app parecía obligar a empezar de cero aunque el censo,
     el lote y las correcciones siguieran intactos en la base. */
  useEffect(() => {
    const off = alFaseConexion(setFaseConexion);
    return () => { void off.then((f) => f()); };
  }, []);

  useEffect(() => {
    cargarSesion()
      .then((s) => setSesion(s && s.connection_id != null && s.paso !== "conexion" ? s : null))
      .catch(() => {});
  }, []);

  /* La salida hacia adelante desde un medio ya conectado.
     Faltaba entera: al pulsar un sitio guardado se le volvía a preguntar quién
     era, se pintaba el visto de «el sitio confirma la cuenta» y ahí acababa
     todo, porque el único camino al paso siguiente estaba dentro de comprobar
     la contraseña de aplicación —y esa ya estaba comprobada—. */
  async function continuar() {
    if (!guardado) return;
    if (!guardado.sitio) {
      // El descubrimiento guardado no se pudo leer: toca volver a preguntar.
      await conectar(guardado.conexion.resolved_origin);
      return;
    }
    onConectado(guardado.sitio, guardado.conexion.id);
    setConexionId(guardado.conexion.id);
    if (sesion && sesion.paso !== "conexion") {
      estado.avanzar(sesion.progreso, sesion.paso as Paso);
    } else {
      estado.avanzar(1, "perfil");
    }
  }

  async function conectar(destino?: string) {
    const valor = (destino ?? url).trim();
    if (!valor) return;
    setUrl(valor);
    setFase("verificando");
    setFaseConexion("normalizando");
    setError(null);
    try {
      const d = await discoverSite(valor);
      setHallazgo(d);
      setFase("conectado");
      const id = await saveConnection(d.resolved_origin, d.site_name ?? "");
      setConexionId(id);
      onConectado(d, id);
      cargarGuardado();
      // La dirección donde crear la contraseña sale del índice del propio
      // sitio, así que solo puede pedirse una vez conectados.
      pasoAutorizacion(d.resolved_origin).then(setAutorizacion).catch(() => setAutorizacion(null));
      duenio(id).then((d2) => {
        if (d2) setIdentidad({ id: 0, login: d2[1], nombre: d2[0], roles: [], edita: true });
      }).catch(() => {});
    } catch (e) {
      setError(clasificar(String(e)));
      setFase("error");
    }
  }

  async function comprobar() {
    if (!hallazgo || !correo.trim() || !secreto.trim()) return;
    setProbando(true);
    setErrorCred(null);
    setPreparando(0);
    try {
      setIdentidad(await probarCredencial(hallazgo.resolved_origin, correo, secreto));
      setSecreto("");
      setPreparando(1);
      /* Recién ahora Legajo lee algo del archivo. Hasta aquí solo ha leído el
         índice REST del sitio —cómo se llama, dónde se crean sus contraseñas—,
         que no es su contenido. */
      if (conexionId != null) {
        const caps = await sondearArchivo(conexionId);
        const conSondeo = { ...hallazgo, capabilities: caps };
        setHallazgo(conSondeo);
        onConectado(conSondeo, conexionId);
        setPreparando(2);
        // Confirmar la contraseña era el permiso que faltaba. A partir de aquí
        // no hay ninguna decisión que tomar hasta los hallazgos, así que la app
        // recorre sola lo que queda en medio.
        estado.avanzar(1, "perfil");
      }
    } catch (e) {
      setErrorCred(String(e).replace(/^Error:\s*/, ""));
      setPreparando(null);
    } finally {
      setProbando(false);
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "48px 32px" }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div className="t-rotulo" style={{ marginBottom: 12 }}>Paso 1 de 8 · Conexión</div>
        <h1 style={{ fontFamily: "var(--font-serif-display)", fontWeight: 500, fontVariationSettings: "var(--fraunces-display)", fontSize: 34, lineHeight: 1.15, letterSpacing: "-.4px", margin: "0 0 10px" }}>
          {pasoDe("conexion")!.titulo}
        </h1>
        <p style={{ margin: "0 0 40px", fontSize: 14.5, lineHeight: 1.6, color: "var(--t2)", maxWidth: "36ch" }}>
          {guardado && fase !== "conectado"
            ? "Hay un archivo conectado en este computador."
            : "La dirección del sitio y el correo con el que entras a su WordPress. Legajo averigua el resto."}
        </p>

        {/* El medio conectado. Es lo primero y casi lo único que se ve cuando
            ya hay uno: la app trabaja con un archivo a la vez, así que la
            pantalla de conexión deja de ser un formulario y pasa a ser la
            puerta de vuelta al trabajo. Antes esto era una lista de sitios
            guardados donde pulsar uno lo reconectaba y no ofrecía ninguna
            forma de seguir: se llegaba y no se podía salir. */}
        {guardado && fase !== "conectado" && (
          <div style={{ marginBottom: "var(--esp-8)", padding: "18px 20px", borderRadius: 10, background: "var(--acento-suave)", border: "1px solid var(--acento)" }}>
            <Rotulo style={{ marginBottom: 10 }}>
              {sesion ? "Trabajo a medias" : "Medio conectado"}
            </Rotulo>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4, color: "var(--t1)" }}>
              {guardado.conexion.site_name ?? guardado.conexion.label}
            </div>
            <div className="t-menor" style={{ color: "var(--t2)", marginBottom: 14 }}>
              {guardado.conexion.resolved_origin.replace(/^https?:\/\//, "")}
              {guardado.conexion.total_posts
                ? ` · ${guardado.conexion.total_posts.toLocaleString("es-CO")} artículos`
                : ""}
              {guardado.autorizado ? " · cuenta comprobada" : " · sin comprobar la cuenta"}
            </div>

            <p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.65, color: "var(--t1)", maxWidth: "44ch" }}>
              {sesion
                ? <>Dejaste este archivo en <strong style={{ fontWeight: 500 }}>{nombreEnFrase(sesion.paso)}</strong>. Todo sigue guardado: lo leído, el lote, lo extraído y tus correcciones.</>
                : "Todo lo que hayas leído de este archivo sigue en tu disco."}
            </p>

            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <Boton onClick={continuar}>
                {sesion ? "Continuar donde ibas" : "Continuar"}
              </Boton>
              <Boton variante="enlace" onClick={() => setPorBorrar(!porBorrar)}>
                conectar otro medio
              </Boton>
            </div>

            {/* Cambiar de medio arrastra el censo, los lotes y las
                correcciones: son horas de trabajo y la base las borra en
                cascada. Por eso se dice qué se va, en vez de un «¿seguro?»
                que no informa de nada. */}
            {porBorrar && (
              <div style={{ margin: "16px 0 0", padding: "12px 14px", borderRadius: 8, background: "var(--error-fondo)" }}>
                <p style={{ margin: "0 0 12px", fontSize: 12.5, lineHeight: 1.65, color: "var(--t1)", maxWidth: "44ch" }}>
                  Legajo trabaja con un archivo a la vez. Conectar otro medio borra
                  de <strong style={{ fontWeight: 500 }}>{guardado.conexion.label}</strong> su
                  censo{guardado.conexion.total_posts ? ` de ${guardado.conexion.total_posts.toLocaleString("es-CO")} artículos` : ""},
                  los cuerpos descargados, sus lotes y las correcciones que hayas hecho
                  sobre ellos. No se puede deshacer.
                </p>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <Boton variante="secundario" onClick={async () => {
                    await deleteConnection(guardado.conexion.id).catch(() => {});
                    setPorBorrar(false);
                    setGuardado(null);
                    setSesion(null);
                    setHallazgo(null);
                    setFase("reposo");
                    cargarGuardado();
                  }}>Borrar y conectar otro</Boton>
                  <Boton variante="enlace" onClick={() => setPorBorrar(false)}>cancelar</Boton>
                </div>
              </div>
            )}
          </div>
        )}

        {/* El formulario solo aparece cuando no hay nada conectado. Dejarlo a
            la vista invitaría a escribir una dirección que la base va a
            rechazar por haber ya un medio guardado. */}
        {!guardado && !cargandoGuardado && (
        <>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Campo
            etiqueta="Dirección del sitio"
            value={url}
            onChange={setUrl}
            placeholder="tumedio.co"
            autoFocus
            onEnter={() => fase !== "verificando" && conectar()}
          />
          {/* El correo y no el usuario: casi nadie sabe cuál es su nombre de
              usuario en WordPress, y el correo lo sabe todo el mundo porque es
              con lo que entra. WordPress lo admite —busca por `user_login` y,
              si no lo encuentra y parece un correo, busca por correo—, así que
              pedir el usuario era pedir un dato que la gente no tiene. */}
          <Campo
            etiqueta="Tu correo en ese WordPress"
            ayuda="El mismo con el que inicias sesión. No hace falta tu nombre de usuario."
            value={correo}
            onChange={setCorreo}
            placeholder="tu@medio.co"
            type="email"
            onEnter={() => fase !== "verificando" && conectar()}
          />
        </div>

        <div style={{ height: 18 }} />

        {fase === "reposo" && (
          <div>
            <Boton onClick={() => conectar()} disabled={!url.trim() || !correo.trim()}>
              Conectar con WordPress
            </Boton>
            <div style={{ height: 14 }} />
          </div>
        )}
        </>
        )}

        {fase === "verificando" && (
          <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
            <Cargando
              titulo="Buscando tu WordPress"
              pasos={[
                { texto: "Resolver la dirección y seguir redirecciones" },
                { texto: "Probar la REST API en /wp-json" },
                { texto: "Probar con permalinks feos", detalle: "?rest_route=" },
                { texto: "Probar el proxy de WordPress.com" },
              ]}
              actual={{ normalizando: 0, directo: 1, rest_route: 2, wpcom: 3 }[faseConexion] ?? 0}
              nota="Cada intento espera respuesta de un servidor que no es nuestro. Los que se saltan es porque el anterior funcionó."
            />
          </div>
        )}

        {/* Mientras se prepara no se enseña nada más: el formulario ya cumplió
            y dejarlo debajo invita a volver a pulsar. */}
        {preparando != null && (
          <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 18 }}>
            <Cargando
              titulo="Preparando tu archivo"
              pasos={[
                { texto: "Comprobar con tu sitio que la cuenta es tuya" },
                { texto: "Preguntar cuántas piezas hay y desde cuándo" },
                { texto: "Empezar a leer el archivo" },
              ]}
              actual={preparando}
              nota="Solo a partir del segundo paso Legajo mira tu archivo. Hasta aquí solo había leído el índice del sitio."
            />
          </div>
        )}

        {fase === "conectado" && hallazgo && !preparando && (
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
              {/* El tamaño del archivo no se sabe hasta que hay credencial:
                  averiguarlo es leerlo, y eso ya no ocurre antes de tiempo. */}
              <Dato k="Archivo">
                {hallazgo.capabilities.total_posts != null ? (
                  <>
                    {hallazgo.capabilities.total_posts.toLocaleString("es-CO")} artículos ·{" "}
                    {anio(hallazgo.capabilities.oldest_date)}—{anio(hallazgo.capabilities.newest_date)}
                  </>
                ) : (
                  <span style={{ color: "var(--t3)" }}>sin mirar todavía</span>
                )}
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

            {/* ── Segunda etapa: probar que el archivo es tuyo ──
                Leer un archivo público no necesita credenciales, y por eso la
                primera pantalla solo pide la dirección. Pero construir el grafo
                de un medio no es leerlo: es quedarse con su archivo entero, y
                eso debería poder hacerlo solo alguien de la casa. */}
            <div style={{ borderTop: "1px solid var(--borde)", paddingTop: 20, marginBottom: 22 }}>
              <Rotulo style={{ marginBottom: 8 }}>Demuestra que el archivo es tuyo</Rotulo>

              {identidad ? (
                <div style={{ display: "flex", gap: 9, alignItems: "baseline" }}>
                  <Glifo estado="exito" size={11} />
                  <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--t1)" }}>
                    <strong style={{ fontWeight: 500 }}>{identidad.nombre}</strong>
                    {identidad.login ? ` · ${identidad.login}` : ""}
                    <span style={{ color: "var(--t3)" }}> — el sitio confirma la cuenta.</span>
                  </span>
                </div>
              ) : (
                <>
                  <p style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.7, color: "var(--t2)", maxWidth: "44ch" }}>
                    WordPress puede darte una <strong style={{ fontWeight: 500, color: "var(--t1)" }}>contraseña
                    de aplicación</strong>: una clave aparte, solo para Legajo, que no es tu
                    contraseña real y que puedes revocar cuando quieras desde tu perfil.
                  </p>

                  {autorizacion?.url ? (
                    <div style={{ marginBottom: 16 }}>
                      <a
                        href={autorizacion.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "inline-block", fontSize: 13, color: "var(--acento)", textDecoration: "none", borderBottom: "1px solid var(--acento)", paddingBottom: 1 }}
                      >
                        Crearla en {new URL(autorizacion.url).host} ↗
                      </a>
                      <p className="t-menor" style={{ color: "var(--t3)", margin: "8px 0 0", lineHeight: 1.6, maxWidth: "44ch" }}>
                        Es tu propio sitio: te pedirá iniciar sesión allí y luego te enseñará la
                        contraseña para copiarla.
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 9, alignItems: "baseline", marginBottom: 16 }}>
                      <Glifo estado="advertencia" size={11} />
                      <span className="t-menor" style={{ color: "var(--t2)", lineHeight: 1.6, maxWidth: "44ch" }}>
                        {autorizacion?.anunciado
                          ? "El sitio admite contraseñas de aplicación pero no publica dónde crearlas. Búscalas en tu perfil de WordPress, al final de la página."
                          : "Este sitio no ofrece contraseñas de aplicación: necesita WordPress 5.6 o superior y HTTPS. Puedes seguir sin ella, pero solo verás lo publicado."}
                      </span>
                    </div>
                  )}

                  <Boton variante="enlace" onClick={() => setComoSacarla(!comoSacarla)}>
                    {comoSacarla ? "ocultar el paso a paso" : "¿cómo la saco?"}
                  </Boton>

                  {comoSacarla && (
                    <ol style={{ margin: "12px 0 18px", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 7 }}>
                      {[
                        "Abre el enlace de arriba, o entra a tu WordPress y ve a Usuarios › Perfil.",
                        "Baja hasta «Contraseñas de aplicación», al final de la página.",
                        "Escribe un nombre que reconozcas —«Legajo» sirve— y pulsa «Añadir nueva».",
                        "WordPress enseña la contraseña una sola vez, en grupos de cuatro letras. Cópiala entera.",
                        "Pégala aquí. Los espacios dan igual.",
                      ].map((paso, i) => (
                        <li key={i} style={{ fontSize: 12.5, lineHeight: 1.65, color: "var(--t2)" }}>{paso}</li>
                      ))}
                    </ol>
                  )}

                  {/* Solo la contraseña: el correo ya se dio al principio. Va
                      en monoespaciada y a la vista porque WordPress la enseña
                      una sola vez en grupos de cuatro, y ocultarla haría
                      imposible comprobar que se pegó entera, que es el fallo
                      más común. Se borra del campo en cuanto se guarda. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "16px 0 0" }}>
                    <Campo
                      etiqueta={`Contraseña de aplicación para ${correo}`}
                      ayuda="Los espacios dan igual: WordPress la acepta con ellos o sin ellos."
                      value={secreto}
                      onChange={setSecreto}
                      placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                      onEnter={comprobar}
                      mono
                    />
                  </div>

                  {errorCred && (
                    <div style={{ display: "flex", gap: 9, alignItems: "baseline", margin: "12px 0 0" }}>
                      <Glifo estado="error" size={11} />
                      <span className="t-menor" style={{ color: "var(--t1)", lineHeight: 1.6, maxWidth: "44ch" }}>{errorCred}</span>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 16 }}>
                    <Boton
                      variante="secundario"
                      onClick={comprobar}
                      disabled={probando || !secreto.trim()}
                    >
                      {probando ? "Comprobando…" : "Comprobar y guardar"}
                    </Boton>
                    <span className="t-menor" style={{ color: "var(--t3)" }}>
                      Se guarda solo en este computador.
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Confirmar la contraseña por primera vez lleva sola al paso
                siguiente, así que ahí no hace falta botón. Pero al volver a un
                medio ya comprobado no hay nada que confirmar, y sin esto la
                pantalla se quedaba sin ninguna salida. */}
            {identidad && (
              <div style={{ marginBottom: 16 }}>
                <Boton onClick={() => {
                  if (conexionId != null && hallazgo) onConectado(hallazgo, conexionId);
                  if (sesion && sesion.paso !== "conexion") {
                    estado.avanzar(sesion.progreso, sesion.paso as Paso);
                  } else {
                    estado.avanzar(1, "perfil");
                  }
                }}>
                  {sesion && sesion.paso !== "conexion" ? "Continuar donde ibas" : "Continuar"}
                </Boton>
              </div>
            )}

            {!identidad && (
              <p className="t-menor" style={{ color: "var(--t3)", margin: "0 0 12px", maxWidth: "44ch", lineHeight: 1.6 }}>
                Legajo no lee tu archivo hasta que compruebes que es tuyo. Hasta aquí solo ha
                leído el índice del sitio: cómo se llama y dónde creas tus contraseñas.
              </p>
            )}
            <Boton variante="enlace" onClick={estado.ayuda}>qué pasa en el siguiente paso</Boton>
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
            <Boton variante="secundario" onClick={() => conectar()}>Reintentar</Boton>
          </div>
        )}

        <div style={{ marginTop: 40, paddingTop: 18, borderTop: "1px solid var(--borde)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--t3)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--exito)", display: "block" }} />
            El archivo nunca sale de este computador.
          </span>
        </div>

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


const anio = (d: string | null) => (d && /^\d{4}/.test(d) ? d.slice(0, 4) : "?");

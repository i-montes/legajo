//! El modo servidor: expone por HTTP los comandos de revisión y anotación.
//!
//! El usuario anota en el SQLite de esta máquina Linux y quiere poder
//! corregir desde su Mac, por la red local. Encender este servidor deja que
//! otra instancia de Legajo llame a los mismos comandos que hoy llama esta
//! ventana por `invoke`, pero por HTTP contra este proceso.
//!
//! El contrato con quien escribe el cliente (fijado aparte, no negociable
//! desde aquí):
//!
//!   - `POST /api/<comando>`: el cuerpo es el mismo objeto de argumentos que
//!     el frontend le pasaría hoy a `invoke`, en camelCase.
//!   - Éxito: 200 con `{"ok": <lo que devuelva el comando>}`.
//!   - Error: 400 (comando inexistente o argumentos que no deserializan),
//!     401 (token ausente o incorrecto), 500 (el comando falló). Siempre
//!     `{"error": "<mensaje>"}`.
//!   - `GET /api/salud`: igual de protegida que el resto; es con lo que el
//!     cliente valida la conexión antes de guardarla.
//!   - `Authorization: Bearer <token>` en todas las rutas.
//!   - CORS abierto a cualquier origen: la protección es el token, no el
//!     origen, porque el cliente es otra app Tauri y su origen no es algo
//!     que valga la pena fijar.
//!
//! ## Por qué se ata a todas las interfaces, y por qué el puerto es fijo
//!
//! Dos decisiones de una versión anterior de este módulo estorbaban a quien
//! de verdad intentaba conectarse desde otra máquina, y las dos se revirtieron
//! a propósito:
//!
//! Antes el servidor solo escuchaba en la IPv4 de la ruta por defecto del
//! sistema. Esta máquina puede tener a la vez `enp4s0` y `wlp5s0` en la misma
//! red, más Tailscale en una tercera dirección: atarse a una sola de ellas
//! hacía que probar contra cualquier otra fallara aunque la red estuviera
//! perfectamente bien, sin ninguna pista de por qué. Con `ufw` activo y
//! política de entrada `DROP`, la frontera de verdad ya es el cortafuegos:
//! atarse a una sola interfaz no suma seguridad, solo rompe en cuanto la
//! máquina tiene más de una dirección o cambia de red. Por eso ahora escucha
//! en `0.0.0.0` —todas las interfaces— y es la regla de `ufw` la que decide
//! quién puede hablarle.
//!
//! El puerto era efímero: el sistema operativo elegía uno nuevo en cada
//! arranque, así que cualquier regla de cortafuegos abierta para un puerto
//! anterior dejaba de servir en el siguiente encendido. Ahora el puerto por
//! defecto es fijo, [`PUERTO_PREDETERMINADO`] (36507), y `iniciar` no elige
//! ningún otro por su cuenta: si ese puerto está ocupado, falla con un
//! mensaje claro en vez de caer en silencio a uno aleatorio. Un servidor
//! que "seguiría funcionando" en un puerto distinto es peor que uno que no
//! arranca: aparenta éxito mientras la regla de cortafuegos de quien lo
//! enciende queda apuntando a un puerto vacío.
//!
//! ## Por qué lista blanca, y por qué en el despacho
//!
//! `commands.rs` tiene comandos que abren una contraseña de aplicación de
//! WordPress (`probar_credencial`), que instalan software (`instalar_entorno`)
//! o que arrancan un censo contra un sitio ajeno. Filtrar esos por nombre en
//! una capa de rutas es del tipo de cosa que un cambio en otro fichero
//! rompe sin que nadie se entere: alguien añade un comando en `commands.rs`,
//! se le olvida tocar la lista de exclusión, y ese comando queda alcanzable
//! por HTTP el mismo día.
//!
//! Aquí no hay «todo menos»: `despachar` es un `match` con un brazo por cada
//! comando expuesto y nada más. Un nombre que no está en la lista cae en el
//! `_` sin haber tocado `Db` ni deserializado nada. Añadir un comando nuevo a
//! `commands.rs` no lo expone: hay que venir aquí a propósito y escribirle un
//! brazo. La prueba `ningun_comando_fuera_de_la_lista_es_alcanzable`, más
//! abajo, lee el código fuente real de `commands.rs` y comprueba que ningún
//! nombre fuera de `EXPUESTOS` llega a ejecutarse.
//!
//! ## La trampa de `grafo_evidencia`
//!
//! De los 16 comandos expuestos, `grafo_evidencia` es el único cuyos
//! argumentos no son identificadores de fila: `a` y `b` son el **texto
//! canonicalizado de la entidad**, es decir, lo que la columna
//! `anotaciones.texto` guarda después de pasar por el mapa de canónicos —no
//! `a_mid`/`b_mid`, que son las columnas que de verdad identifican una
//! mención en la tabla `relaciones`. Quien escriba un cliente nuevo y no haya
//! leído `Db::grafo_evidencia` (en `core/src/db.rs`, la fuente de verdad de
//! esta semántica) tiene toda la razón del mundo para asumir lo contrario: en
//! cualquier otro comando de esta lista, lo que se pasa son identificadores.
//!
//! El problema no es solo que sea fácil equivocarse, sino que equivocarse no
//! avisa. La consulta hace `JOIN anotaciones ma ON … AND ma.mid = r.a_mid` y
//! compara `ma.texto` contra el parámetro `a` con `quiere()`; si `a` lleva un
//! `mid` en vez de un texto canónico, esa comparación de cadenas
//! simplemente no encuentra ninguna fila. No hay tipo, ni validación, ni
//! error que lo detecte: la respuesta es `200 {"ok": []}`, exactamente la
//! misma que daría una relación que de verdad no tiene evidencia. El
//! frontend actual (`src/lib/ipc.ts`, función `grafoEvidencia`) lo llama
//! bien, porque le pasa `r.a`/`r.b` de una `AristaGrafo` que ya salió
//! canonicalizada de `grafo_relaciones`; esto no es un bug de hoy, es una
//! trampa a la espera de un cliente que no exista todavía.
use crate::commands::{self, AppState};
use legajo_core::db::{Db, Mencion, RelacionFila};
use legajo_core::{Error, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::State;

use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path as AxPath, Query as AxQuery, Request, State as AxState,
    },
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};

// ── Encendido / apagado ──────────────────────────────────────────────────

/// Lo que hay que soltar para que el servidor deje de escuchar. Vive en el
/// `Mutex` de `ServidorState` solo mientras el servidor está arriba.
struct Corriendo {
    puerto: u16,
    apagar: tokio::sync::oneshot::Sender<()>,
    /// Aparte de `apagar`: ese apaga el `axum::serve`, este para la tarea de
    /// vigilancia de latidos (§ws), que si no quedaría corriendo para
    /// siempre —cada encendido del servidor deja una tarea más— porque nada
    /// más la referencia una vez que `Corriendo` se suelta.
    apagar_vigilancia: tokio::sync::oneshot::Sender<()>,
    /// Se cierra cuando `axum::serve` ya terminó de verdad y soltó el
    /// `TcpListener`. Mandar por `apagar` solo pide el cierre; el propio
    /// `axum::serve` sigue corriendo en su tarea hasta que el runtime la
    /// vuelve a planificar. `detener` espera esto antes de decir que el
    /// servidor está apagado: sin ello, un `iniciar` inmediato después —el
    /// mismo puerto fijo, por contrato— puede chocar con un socket que el
    /// runtime todavía no tuvo ocasión de cerrar y fallar con «el puerto ya
    /// está en uso», que es exactamente el error que este módulo existe para
    /// evitar.
    cerrado: tokio::sync::oneshot::Receiver<()>,
}

/// Estado de Tauri con el servidor, si lo hay. Aparte de `AppState`: nada de
/// lo demás necesita saber si el servidor está encendido.
#[derive(Default)]
pub struct ServidorState(Mutex<Option<Corriendo>>);

/// Lo que ven `servir_estado`, `servir_iniciar` y `servir_detener` en el
/// frontend. `direcciones` lleva **todas** las IPv4 locales no-loopback de
/// interfaces activas (ver [`direcciones_locales`]), no la interfaz exacta a
/// la que quedó atado el servidor: desde que este escucha en `0.0.0.0`, esa
/// pregunta ya no tiene una sola respuesta, y el panel necesita mostrarlas
/// todas para que la persona pruebe la que le funcione. Cuando se puede
/// determinar cuál es la de la ruta por defecto del sistema, esa va primero
/// en la lista —es la más probable de servir—, pero el campo sigue siendo un
/// `Vec<String>` llano: no se distingue la recomendada con otra forma para no
/// romper el contrato ya fijado con el frontend.
#[derive(Clone, Debug, serde::Serialize)]
pub struct EstadoServidor {
    pub activo: bool,
    pub puerto: u16,
    pub token: String,
    pub direcciones: Vec<String>,
}

fn estado_con(db: &Db, puerto: Option<u16>) -> Result<EstadoServidor> {
    let token = token_o_crear(db)?;
    Ok(match puerto {
        Some(puerto) => {
            EstadoServidor { activo: true, puerto, token, direcciones: direcciones_locales() }
        }
        None => EstadoServidor { activo: false, puerto: 0, token, direcciones: Vec::new() },
    })
}

/// El estado actual, sin tocar nada.
pub fn estado(db: &Db, srv: &ServidorState) -> Result<EstadoServidor> {
    let g = srv.0.lock().unwrap();
    estado_con(db, g.as_ref().map(|c| c.puerto))
}

/// El puerto por defecto del modo servidor: el mismo, siempre, para que la
/// regla de cortafuegos que la persona añadió una vez le sirva para siempre.
///
/// `iniciar` traduce un `puerto` de `0` a este antes de intentar escuchar.
/// Ese es el único significado que le queda a `0` en todo el sistema: ya no
/// existe ningún camino, ni desde `servir_iniciar` ni desde ningún otro
/// llamador público, en el que `0` termine en "el sistema operativo elige
/// uno libre". Esa elección automática fue justo lo que dejó, una vez, la
/// regla de `ufw` de la persona apuntando a un puerto vacío tras un reinicio
/// del servidor: un fallo que aparenta éxito es peor que uno que no arranca.
pub const PUERTO_PREDETERMINADO: u16 = 36507;

/// Enciende el servidor si no lo estaba. Si ya lo estaba, devuelve su estado
/// tal cual: encenderlo dos veces no reinicia nada ni cambia el puerto.
///
/// `puerto == 0` se traduce a [`PUERTO_PREDETERMINADO`] (ver su docstring).
/// Cualquier otro valor se usa tal cual, y si ya está ocupado `iniciar`
/// falla —nunca elige otro por su cuenta—.
///
/// No vuelve hasta que el `TcpListener` está de verdad escuchando: el
/// frontend usa `activo` para decidir si le corresponde dejar de autoguardar,
/// y un «encendido» que solo significa «lo pedí» lo dejaría creyendo que ya
/// es seguro escribir desde el Mac cuando en realidad nadie atiende todavía
/// ese puerto.
pub async fn iniciar(db: Arc<Db>, srv: &ServidorState, puerto: u16) -> Result<EstadoServidor> {
    iniciar_con_predeterminado(db, srv, puerto, PUERTO_PREDETERMINADO).await
}

/// La traducción de `puerto == 0` al valor por defecto, con ese valor por
/// defecto como parámetro en vez de la constante fija [`PUERTO_PREDETERMINADO`].
///
/// Aparte por la misma razón que `iniciar_interno` recibe el `timeout` y el
/// `intervalo` como parámetro: las pruebas de este módulo sobre el puerto
/// fijo quieren comprobar la traducción de `0` —estable entre reinicios, y
/// sin reserva automática si el puerto ya está en uso— sin escuchar de
/// verdad en el puerto 36507 real, que puede estar ocupado por la propia
/// aplicación del usuario mientras corre `cargo test`. `iniciar` sigue
/// siendo la única función pública, y sigue usando siempre el 36507 de
/// verdad.
async fn iniciar_con_predeterminado(
    db: Arc<Db>,
    srv: &ServidorState,
    puerto: u16,
    predeterminado: u16,
) -> Result<EstadoServidor> {
    let puerto = if puerto == 0 { predeterminado } else { puerto };
    iniciar_interno(db, srv, puerto, LATIDO_TIMEOUT, VIGILANCIA_INTERVALO).await
}

/// La implementación real de `iniciar`, con el `timeout` y el `intervalo` de
/// la vigilancia de latidos como parámetro en vez de las constantes fijas, y
/// sin la traducción de `0` a [`PUERTO_PREDETERMINADO`] que hace `iniciar`.
///
/// Aparte por dos razones: para que las pruebas de caducidad no tengan que
/// esperar los 60 s de verdad (usan un `timeout` de milisegundos), y para que
/// las pruebas de este módulo puedan pedir un puerto efímero de verdad
/// (`0`, elegido por el sistema operativo) y así correr muchas a la vez sin
/// pisarse el puerto entre ellas. Esta función es privada a propósito: nadie
/// fuera de este módulo puede pedir «elígeme uno libre», ni siquiera por
/// accidente.
async fn iniciar_interno(
    db: Arc<Db>,
    srv: &ServidorState,
    puerto: u16,
    latido_timeout: Duration,
    vigilancia_intervalo: Duration,
) -> Result<EstadoServidor> {
    if let Some(c) = srv.0.lock().unwrap().as_ref() {
        return estado_con(&db, Some(c.puerto));
    }

    let token = token_o_crear(&db)?;

    // `0.0.0.0`: todas las interfaces. Ver «Por qué se ata a todas las
    // interfaces» en el docstring del módulo, arriba. El cortafuegos, no la
    // interfaz de bind, es la frontera real.
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, puerto))
        .await
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse {
                Error::Other(format!(
                    "el puerto {puerto} ya está en uso por otro proceso. \
                     Cierra lo que lo esté usando o elige otro puerto distinto de {puerto} \
                     y enciende el servidor de nuevo; no se elige otro puerto en su lugar."
                ))
            } else {
                Error::Other(format!("no se pudo escuchar en el puerto {puerto}: {e}"))
            }
        })?;
    let puerto_real = listener
        .local_addr()
        .map_err(|e| Error::Other(e.to_string()))?
        .port();

    let (apagar_tx, apagar_rx) = tokio::sync::oneshot::channel::<()>();
    let (apagar_vig_tx, apagar_vig_rx) = tokio::sync::oneshot::channel::<()>();
    let (cerrado_tx, cerrado_rx) = tokio::sync::oneshot::channel::<()>();
    let registro = Arc::new(RegistroWs::default());
    let router = construir_router(EstadoHttp { db: db.clone(), token: token.clone().into(), registro: registro.clone() });

    tokio::spawn(vigilar_caducidad(registro, latido_timeout, vigilancia_intervalo, apagar_vig_rx));

    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = apagar_rx.await;
            })
            .await;
        // Solo aquí, tras el `.await` de arriba, el `TcpListener` ya se
        // soltó de verdad: es la señal que espera `detener`.
        let _ = cerrado_tx.send(());
    });

    // Ya escucha: recién ahora se publica el estado «activo».
    *srv.0.lock().unwrap() = Some(Corriendo {
        puerto: puerto_real,
        apagar: apagar_tx,
        apagar_vigilancia: apagar_vig_tx,
        cerrado: cerrado_rx,
    });

    estado_con(&db, Some(puerto_real))
}

/// Cuánto espera como mucho `detener` a que el `TcpListener` se suelte de
/// verdad. Es una red de seguridad, no el camino normal: en el camino normal
/// el aviso llega en cuanto el runtime planifica de nuevo la tarea de
/// `axum::serve`, que es casi inmediato. Si nunca llega —la tarea se quedó
/// colgada por algo imprevisto— más vale reportar «apagado» pasados unos
/// segundos que dejar a quien llama esperando para siempre.
const CIERRE_TIMEOUT: Duration = Duration::from_secs(5);

/// Apaga el servidor si estaba encendido. Sin servidor que apagar, no falla:
/// simplemente devuelve el estado «apagado» que ya era cierto.
///
/// No vuelve hasta que el `TcpListener` de verdad se soltó (con
/// [`CIERRE_TIMEOUT`] de tope): el puerto por defecto es fijo, así que
/// `iniciar` puede llegar justo después pidiendo exactamente el mismo
/// puerto, y esa carrera no puede depender de que el runtime haya tenido
/// ocasión de cerrar el socket viejo antes de que el nuevo intente abrirlo.
pub async fn detener(db: &Db, srv: &ServidorState) -> Result<EstadoServidor> {
    let previo = srv.0.lock().unwrap().take();
    if let Some(c) = previo {
        let _ = c.apagar.send(());
        let _ = c.apagar_vigilancia.send(());
        let _ = tokio::time::timeout(CIERRE_TIMEOUT, c.cerrado).await;
    }
    estado_con(db, None)
}

// ── Comandos de Tauri ────────────────────────────────────────────────────

#[tauri::command]
pub fn servir_estado(
    app: State<'_, AppState>,
    srv: State<'_, ServidorState>,
) -> Result<EstadoServidor> {
    estado(&app.db, &srv)
}

/// `puerto == 0` significa [`PUERTO_PREDETERMINADO`], no «elige uno libre»
/// (ver el docstring de `iniciar`): el frontend puede seguir mandando `0`
/// como valor por defecto, o mandar `36507` directamente, da igual.
#[tauri::command]
pub async fn servir_iniciar(
    app: State<'_, AppState>,
    srv: State<'_, ServidorState>,
    puerto: u16,
) -> Result<EstadoServidor> {
    iniciar(app.db.clone(), &srv, puerto).await
}

#[tauri::command]
pub async fn servir_detener(
    app: State<'_, AppState>,
    srv: State<'_, ServidorState>,
) -> Result<EstadoServidor> {
    detener(&app.db, &srv).await
}

// ── Token ────────────────────────────────────────────────────────────────

/// El de la base, o uno nuevo si es la primera vez que se enciende el
/// servidor en esta máquina. Se persiste igual que la sesión: en el propio
/// SQLite, para que apagar y volver a encender no invalide lo que la persona
/// ya copió a mano en el Mac.
fn token_o_crear(db: &Db) -> Result<String> {
    if let Some(t) = db.token_servidor()? {
        return Ok(t);
    }
    let t = generar_token();
    db.guardar_token_servidor(&t)?;
    Ok(t)
}

/// Cuatro grupos de cuatro caracteres, para que se pueda teclear a mano en el
/// Mac sin ambigüedad: sin `0`/`O` ni `1`/`l` (todo el alfabeto es en
/// mayúsculas y dígitos, así que la ele minúscula no puede aparecer nunca).
fn generar_token() -> String {
    const ALFABETO: &[u8] = b"23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";
    let bytes = bytes_aleatorios(16);
    let letras: Vec<u8> = bytes
        .iter()
        .map(|b| ALFABETO[*b as usize % ALFABETO.len()])
        .collect();
    letras
        .chunks(4)
        .map(|g| std::str::from_utf8(g).unwrap())
        .collect::<Vec<_>>()
        .join("-")
}

/// `n` bytes con la aleatoriedad real del sistema operativo, sin sumar una
/// dependencia solo para pedírselos.
///
/// `RandomState::new()` es como la propia `std` protege los `HashMap` de
/// ataques de colisión: cada instancia se siembra desde el generador del
/// sistema operativo. Se pide una nueva por cada ocho bytes en vez de una
/// sola vez porque es la semilla, no el contador, la que tiene que ser
/// impredecible.
fn bytes_aleatorios(n: usize) -> Vec<u8> {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let mut out = Vec::with_capacity(n + 8);
    while out.len() < n {
        let mut h = RandomState::new().build_hasher();
        h.write_usize(out.len());
        out.extend_from_slice(&h.finish().to_le_bytes());
    }
    out.truncate(n);
    out
}

/// La IPv4 local por la que sale el tráfico con ruta por defecto.
///
/// `connect` sobre UDP no manda ningún paquete: solo le pide al sistema
/// operativo que resuelva, según su tabla de rutas, con qué interfaz local
/// hablaría con ese destino. Es la forma estándar de preguntar «¿por dónde
/// saldría?» sin enumerar interfaces a mano ni sumar una dependencia para
/// eso. Con varias interfaces activas, la que gane aquí es la de la ruta por
/// defecto del sistema.
///
/// Ya no decide dónde escucha el servidor (eso es `0.0.0.0`, todas): solo se
/// usa para ordenar `direcciones_locales`, poniendo primera la dirección que
/// más probablemente sirve.
fn ip_local_predeterminada() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(("8.8.8.8", 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

/// Todas las IPv4 locales por las que se puede llegar a este servidor: una
/// por cada interfaz activa que no sea loopback, incluida la de Tailscale si
/// la máquina la tiene (es la vía buena para conectarse desde fuera de la
/// red local). El servidor escucha en `0.0.0.0`, así que todas sirven a la
/// vez; esto es lo que le deja al panel mostrárselas todas a quien lo
/// enciende, en vez de adivinar una sola y fallar en silencio si esa no es
/// la que le sirve a quien se conecta.
///
/// La de la ruta por defecto del sistema, si se pudo determinar, va primero:
/// es la más probable de servir, pero no se marca de ninguna otra forma para
/// no romper el contrato `direcciones: string[]` ya fijado con el frontend.
///
/// Si no se puede enumerar interfaces (raro; solo pasa si el sistema
/// operativo niega la consulta), devuelve una lista vacía en vez de fallar:
/// no tener direcciones que mostrar no debería tumbar el resto del estado
/// del servidor.
fn direcciones_locales() -> Vec<String> {
    let preferida = ip_local_predeterminada();

    let mut resto: Vec<Ipv4Addr> = if_addrs::get_if_addrs()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .filter(|i| i.is_oper_up() && !i.is_loopback())
                .filter_map(|i| match i.ip() {
                    std::net::IpAddr::V4(ip) => Some(ip),
                    std::net::IpAddr::V6(_) => None,
                })
                .collect()
        })
        .unwrap_or_default();
    resto.sort();
    resto.dedup();

    let mut direcciones = Vec::with_capacity(resto.len() + 1);
    if let Some(ip) = preferida {
        direcciones.push(ip.to_string());
    }
    for ip in resto {
        if Some(ip) != preferida {
            direcciones.push(ip.to_string());
        }
    }
    direcciones
}

// ── El servidor HTTP en sí ───────────────────────────────────────────────

#[derive(Clone)]
struct EstadoHttp {
    db: Arc<Db>,
    token: Arc<str>,
    /// Sesiones presentes y bloqueos por artículo del WebSocket (§ws). No es
    /// parte del contrato HTTP; vive aquí solo porque es el mismo servidor.
    registro: Arc<RegistroWs>,
}

fn construir_router(estado: EstadoHttp) -> Router {
    // `/ws` va fuera de `cors_y_token`: el token de un WebSocket de
    // navegador no puede ir en una cabecera, así que llega por query y lo
    // comprueba `manejar_ws` a mano (ver §ws). Meterlo bajo el mismo
    // middleware que las rutas `/api/*` exigiría un `Authorization` que
    // ningún cliente de WebSocket manda.
    let api = Router::new()
        .route("/api/salud", get(manejar_salud))
        .route("/api/{comando}", post(manejar_comando))
        .layer(middleware::from_fn_with_state(estado.clone(), cors_y_token));

    Router::new()
        .merge(api)
        .route("/ws", get(manejar_ws))
        .with_state(estado)
}

fn con_cors(mut resp: Response) -> Response {
    let h = resp.headers_mut();
    h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static("*"));
    h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("GET, POST, OPTIONS"));
    h.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("authorization, content-type"),
    );
    resp
}

fn json_error(status: StatusCode, mensaje: impl Into<String>) -> Response {
    con_cors((status, Json(serde_json::json!({ "error": mensaje.into() }))).into_response())
}

/// Recorta espacios/saltos de línea y sube a mayúsculas antes de comparar.
///
/// El token se genera en mayúsculas (§`generar_token`) pero se teclea a mano
/// en otro computador, y copiar/pegar arrastra minúsculas o espacios con la
/// misma facilidad. Sin normalizar, escribirlo en minúsculas da el mismo 401
/// que un token equivocado, y el mensaje de error no distingue una cosa de
/// la otra. Como el alfabeto del token es solo mayúsculas y dígitos
/// (`generar_token`), aceptar minúsculas no reduce el espacio de búsqueda ni
/// resta seguridad: sigue habiendo un único token válido, solo que ahora se
/// reconoce sin importar cómo se haya tecleado. No «arreglar» esto de vuelta
/// a una comparación exacta.
fn normalizar_token(s: &str) -> String {
    s.trim().to_uppercase()
}

/// Compara en tiempo constante: el token no debería poder adivinarse a base
/// de medir cuánto tarda en rechazarse cada intento.
fn tokens_iguales(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// CORS abierto de verdad, y el token delante de todo lo demás.
///
/// Un `OPTIONS` de preflight nunca lleva la cabecera `Authorization` —el
/// navegador la quita a propósito de esa petición— así que tiene que
/// resolverse aquí, antes de comprobar el token, o toda petición real desde
/// el navegador del Mac fallaría en el preflight antes de llegar a intentarlo
/// con la de verdad.
async fn cors_y_token(
    AxState(estado): AxState<EstadoHttp>,
    req: Request,
    next: Next,
) -> Response {
    if req.method() == Method::OPTIONS {
        return con_cors(StatusCode::NO_CONTENT.into_response());
    }

    let autorizado = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| {
            tokens_iguales(normalizar_token(t).as_bytes(), normalizar_token(&estado.token).as_bytes())
        })
        .unwrap_or(false);

    if !autorizado {
        return json_error(StatusCode::UNAUTHORIZED, "falta el token o no es el que corresponde");
    }

    con_cors(next.run(req).await)
}

async fn manejar_salud(AxState(estado): AxState<EstadoHttp>) -> Response {
    let db = estado.db.clone();
    match tokio::task::spawn_blocking(move || db.contar_lotes()).await {
        Ok(Ok(lotes)) => con_cors(
            (
                StatusCode::OK,
                Json(serde_json::json!({
                    "ok": {
                        "protocolo": 1,
                        "version": env!("CARGO_PKG_VERSION"),
                        "lotes": lotes,
                    }
                })),
            )
                .into_response(),
        ),
        Ok(Err(e)) => json_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        Err(e) => json_error(StatusCode::INTERNAL_SERVER_ERROR, format!("la consulta no terminó: {e}")),
    }
}

async fn manejar_comando(
    AxState(estado): AxState<EstadoHttp>,
    AxPath(comando): AxPath<String>,
    cuerpo: Bytes,
) -> Response {
    match despachar(&comando, estado.db.clone(), &cuerpo).await {
        Despacho::Ok(v) => {
            con_cors((StatusCode::OK, Json(serde_json::json!({ "ok": v }))).into_response())
        }
        Despacho::NoEncontrado => {
            json_error(StatusCode::BAD_REQUEST, format!("no existe el comando «{comando}»"))
        }
        Despacho::ArgumentosInvalidos(m) => json_error(StatusCode::BAD_REQUEST, m),
        Despacho::Fallo(m) => json_error(StatusCode::INTERNAL_SERVER_ERROR, m),
    }
}

/// El resultado de intentar despachar un comando, antes de convertirlo en
/// una respuesta HTTP. Aparte de `Response` para que la prueba de superficie
/// pueda distinguir «no está en la lista» de cualquier otro desenlace sin
/// tener que levantar un servidor de verdad.
enum Despacho {
    Ok(serde_json::Value),
    NoEncontrado,
    ArgumentosInvalidos(String),
    Fallo(String),
}

// ── El WebSocket: presencia y bloqueos por artículo ──────────────────────
//
// Lo que sustituye al modo excluyente («mientras sirvo, mi ventana no
// anota»): antes, dos escritores sobre el mismo artículo se pisaban porque
// `guardar_anotacion` borra e inserta el artículo entero, así que quien
// escribiera último ganaba en silencio. Bloquear por artículo —quien lo abre
// lo ocupa, nadie más puede tocarlo mientras tanto— hace la colisión
// imposible por construcción sin tener que prohibirle a esta ventana que
// anote mientras sirve: puede anotar un artículo mientras el Mac anota otro,
// porque nunca son el mismo.
//
// El registro vive entero en memoria (`RegistroWs`, dentro de `EstadoHttp`):
// un bloqueo es de la conexión que lo pidió, no un dato que deba sobrevivir
// a un reinicio del servidor. No hay tabla nueva en SQLite ni falta que
// haga.

/// Tiempo sin latido tras el cual una sesión se da por ida (ver «Caducidad»
/// en el protocolo). El cliente manda uno cada 20 s; 60 permite perder dos
/// seguidos por una red ruidosa sin que a nadie se le expulse de golpe, y
/// sigue siendo poco tiempo real para quien de verdad cerró la tapa del
/// portátil.
const LATIDO_TIMEOUT: Duration = Duration::from_secs(60);

/// Cada cuánto la tarea de vigilancia mira si alguna sesión caducó. No hace
/// falta que sea fino: que un artículo abandonado tarde hasta 5 s de más en
/// liberarse no le importa a nadie.
const VIGILANCIA_INTERVALO: Duration = Duration::from_secs(5);

/// Animales en español con su emoji, para la identidad de cada sesión.
/// Lista con holgura de sobra sobre el número de máquinas que de verdad
/// anotan a la vez: que se agote y dos sesiones presentes compartan animal
/// es un problema estético, no de corrección (los bloqueos se rigen por
/// `sesion`, no por nombre).
const ANIMALES: &[(&str, &str)] = &[
    ("Zorro", "🦊"), ("Búho", "🦉"), ("Nutria", "🦦"), ("Panda", "🐼"),
    ("Koala", "🐨"), ("Tigre", "🐯"), ("León", "🦁"), ("Jirafa", "🦒"),
    ("Cebra", "🦓"), ("Pulpo", "🐙"), ("Delfín", "🐬"), ("Ballena", "🐳"),
    ("Erizo", "🦔"), ("Conejo", "🐰"), ("Ardilla", "🐿"), ("Mapache", "🦝"),
    ("Lobo", "🐺"), ("Oso", "🐻"), ("Pingüino", "🐧"), ("Flamenco", "🦩"),
    ("Loro", "🦜"), ("Águila", "🦅"), ("Pavorreal", "🦚"), ("Tortuga", "🐢"),
    ("Rana", "🐸"), ("Camaleón", "🦎"), ("Abeja", "🐝"), ("Mariposa", "🦋"),
    ("Caracol", "🐌"), ("Cangrejo", "🦀"), ("Pez globo", "🐡"), ("Canguro", "🦘"),
    ("Hipopótamo", "🦛"), ("Rinoceronte", "🦏"), ("Elefante", "🐘"),
];

/// Un artículo, como en el resto del protocolo: el lote y el `wp_id` dentro
/// de él.
type Articulo = (i64, i64);

/// Lo que el registro sabe de una sesión presente.
struct SesionInfo {
    animal_idx: usize,
    nombre: &'static str,
    emoji: &'static str,
    /// El artículo que tiene abierto, si tiene alguno. Como mucho uno: ver
    /// la regla «un bloqueo por sesión».
    ocupa: Option<Articulo>,
    ultimo_latido: Instant,
    /// Por dónde le llegan a esta conexión los mensajes que dispara *otra*
    /// tarea (la presencia que difunde un tercero, el «perdido» que le
    /// manda quien le arrebató el artículo). La propia tarea de esta
    /// conexión es la única dueña del `WebSocket`; este canal es cómo
    /// cualquier otra le hace llegar algo sin tocarlo directamente.
    tx: tokio::sync::mpsc::UnboundedSender<Message>,
}

#[derive(Default)]
struct RegistroInterno {
    sesiones: HashMap<String, SesionInfo>,
    bloqueos: HashMap<Articulo, String>,
    /// El animal ya asignado a cada `cliente`, para que una reconexión con
    /// el mismo id recupere la misma identidad si sigue sin usar. Sobrevive
    /// a que la sesión se caiga y a que se reconecte; no sobrevive a un
    /// reinicio del servidor, como el resto de este registro.
    animal_de_cliente: HashMap<String, usize>,
}

/// Sesiones presentes y bloqueos por artículo. Uno por servidor encendido:
/// se crea en `iniciar` y se tira, con todo lo que tenga dentro, cuando el
/// servidor se apaga o se reinicia.
#[derive(Default)]
struct RegistroWs(Mutex<RegistroInterno>);

/// Lo que devuelve `RegistroWs::tomar`.
enum ResultadoTomar {
    Tomado,
    Ocupado { nombre: &'static str, emoji: &'static str },
    /// La sesión no existe en el registro. No debería pasar —solo se llama
    /// con la propia sesión de quien manda el mensaje— pero si pasara, más
    /// vale no entrar en pánico por un mensaje tardío de una conexión que ya
    /// se limpió.
    SesionDesconocida,
}

impl RegistroWs {
    /// Da de alta una sesión nueva y le asigna animal: el mismo de la vez
    /// anterior de este `cliente` si sigue libre, o el primero libre que
    /// haya en `ANIMALES`.
    fn conectar(&self, cliente: String, tx: tokio::sync::mpsc::UnboundedSender<Message>) -> (String, &'static str, &'static str) {
        let mut g = self.0.lock().unwrap();
        let en_uso: std::collections::HashSet<usize> =
            g.sesiones.values().map(|s| s.animal_idx).collect();

        let idx = g
            .animal_de_cliente
            .get(&cliente)
            .copied()
            .filter(|i| !en_uso.contains(i))
            .or_else(|| (0..ANIMALES.len()).find(|i| !en_uso.contains(i)))
            .unwrap_or(0);
        g.animal_de_cliente.insert(cliente, idx);
        let (nombre, emoji) = ANIMALES[idx];

        let sesion_id = nuevo_id();
        g.sesiones.insert(
            sesion_id.clone(),
            SesionInfo {
                animal_idx: idx,
                nombre,
                emoji,
                ocupa: None,
                ultimo_latido: Instant::now(),
                tx,
            },
        );
        (sesion_id, nombre, emoji)
    }

    /// El nombre y emoji de una sesión presente, para que quien procesa un
    /// `forzar` sepa qué mandar en el `por` de `perdido`.
    fn identidad(&self, sesion_id: &str) -> Option<(&'static str, &'static str)> {
        self.0.lock().unwrap().sesiones.get(sesion_id).map(|s| (s.nombre, s.emoji))
    }

    /// Intenta tomar `articulo` para `sesion_id`. Si lo tenía otra sesión,
    /// deniega sin tocar nada —ni siquiera el bloqueo anterior de
    /// `sesion_id`, que sigue siendo suyo—. Si lo consigue, suelta antes su
    /// bloqueo previo si era un artículo distinto: «un bloqueo por sesión».
    fn tomar(&self, sesion_id: &str, articulo: Articulo) -> ResultadoTomar {
        let mut g = self.0.lock().unwrap();
        if !g.sesiones.contains_key(sesion_id) {
            return ResultadoTomar::SesionDesconocida;
        }
        if let Some(dueno) = g.bloqueos.get(&articulo) {
            if dueno != sesion_id {
                let (nombre, emoji) = g
                    .sesiones
                    .get(dueno)
                    .map(|s| (s.nombre, s.emoji))
                    .unwrap_or(("", ""));
                return ResultadoTomar::Ocupado { nombre, emoji };
            }
        }
        let anterior = g.sesiones.get(sesion_id).unwrap().ocupa;
        if let Some(a) = anterior {
            if a != articulo {
                g.bloqueos.remove(&a);
            }
        }
        g.bloqueos.insert(articulo, sesion_id.to_string());
        g.sesiones.get_mut(sesion_id).unwrap().ocupa = Some(articulo);
        ResultadoTomar::Tomado
    }

    /// Suelta `articulo` si de verdad era `sesion_id` quien lo tenía. Si no
    /// —ya se había soltado, se lo arrebataron con `forzar` mientras tanto, o
    /// el cliente se desincronizó— no hace nada: es un no-op silencioso, no
    /// un error. Pasa de verdad y no es un fallo del cliente: si a esta
    /// sesión le quitaron el artículo con `forzar` y después sale de la
    /// pantalla, manda `soltar` sobre algo que ya no tiene. Devuelve si de
    /// verdad soltó algo, para que quien llama solo difunda presencia si
    /// cambió algo de verdad.
    fn soltar(&self, sesion_id: &str, articulo: Articulo) -> bool {
        let mut g = self.0.lock().unwrap();
        if let Some(s) = g.sesiones.get_mut(sesion_id) {
            if s.ocupa == Some(articulo) {
                s.ocupa = None;
                g.bloqueos.remove(&articulo);
                return true;
            }
        }
        false
    }

    /// Arrebata `articulo` para `sesion_id`, sin importar quién lo tuviera:
    /// «`forzar` siempre funciona». Devuelve la sesión anterior si había una
    /// y era otra, para que quien llama le mande `perdido`.
    fn forzar(&self, sesion_id: &str, articulo: Articulo) -> Option<String> {
        let mut g = self.0.lock().unwrap();
        if !g.sesiones.contains_key(sesion_id) {
            return None;
        }
        let anterior_dueno = g.bloqueos.get(&articulo).cloned();

        let mi_anterior = g.sesiones.get(sesion_id).unwrap().ocupa;
        if let Some(a) = mi_anterior {
            if a != articulo {
                g.bloqueos.remove(&a);
            }
        }
        if let Some(prev) = &anterior_dueno {
            if prev != sesion_id {
                if let Some(s) = g.sesiones.get_mut(prev) {
                    s.ocupa = None;
                }
            }
        }
        g.bloqueos.insert(articulo, sesion_id.to_string());
        g.sesiones.get_mut(sesion_id).unwrap().ocupa = Some(articulo);

        anterior_dueno.filter(|p| p != sesion_id)
    }

    /// Refresca el latido de `sesion_id`. Una sesión que ya no está (mensaje
    /// tardío de una conexión que se acaba de limpiar) no hace nada.
    fn latido(&self, sesion_id: &str) {
        if let Some(s) = self.0.lock().unwrap().sesiones.get_mut(sesion_id) {
            s.ultimo_latido = Instant::now();
        }
    }

    /// Quita la sesión del registro y suelta lo que tuviera abierto.
    fn desconectar(&self, sesion_id: &str) {
        let mut g = self.0.lock().unwrap();
        if let Some(s) = g.sesiones.remove(sesion_id) {
            if let Some(a) = s.ocupa {
                g.bloqueos.remove(&a);
            }
        }
    }

    /// Expulsa las sesiones sin latido desde hace más de `timeout`,
    /// soltando lo que tuvieran abierto. Devuelve los ids expulsados, para
    /// que quien llama solo difunda presencia si de verdad cambió algo.
    fn expulsar_caducadas(&self, timeout: Duration) -> Vec<String> {
        let mut g = self.0.lock().unwrap();
        let ahora = Instant::now();
        let idas: Vec<String> = g
            .sesiones
            .iter()
            .filter(|(_, s)| ahora.saturating_duration_since(s.ultimo_latido) > timeout)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &idas {
            if let Some(s) = g.sesiones.remove(id) {
                if let Some(a) = s.ocupa {
                    g.bloqueos.remove(&a);
                }
            }
        }
        idas
    }

    /// El remitente de una sesión presente, para mandarle algo que no es
    /// para todos (`tomado`, `ocupado`, `perdido`).
    fn destinatario(&self, sesion_id: &str) -> Option<tokio::sync::mpsc::UnboundedSender<Message>> {
        self.0.lock().unwrap().sesiones.get(sesion_id).map(|s| s.tx.clone())
    }

    /// El remitente de todas las sesiones presentes, para `presencia`.
    fn destinatarios(&self) -> Vec<tokio::sync::mpsc::UnboundedSender<Message>> {
        self.0.lock().unwrap().sesiones.values().map(|s| s.tx.clone()).collect()
    }

    /// El `{"tipo":"presencia", ...}` con el estado actual de todas las
    /// sesiones presentes.
    fn presencia_json(&self) -> String {
        let g = self.0.lock().unwrap();
        let sesiones: Vec<_> = g
            .sesiones
            .iter()
            .map(|(id, s)| {
                serde_json::json!({
                    "sesion": id,
                    "nombre": s.nombre,
                    "emoji": s.emoji,
                    "loteId": s.ocupa.map(|(l, _)| l),
                    "wpId": s.ocupa.map(|(_, w)| w),
                })
            })
            .collect();
        serde_json::json!({ "tipo": "presencia", "sesiones": sesiones }).to_string()
    }
}

/// Un id de sesión nuevo: 16 caracteres hexadecimales de la misma fuente de
/// aleatoriedad que ya usa el token del servidor, sin sumar una dependencia
/// para un UUID que nadie necesita fuera de este proceso.
fn nuevo_id() -> String {
    bytes_aleatorios(8).iter().map(|b| format!("{b:02x}")).collect()
}

fn msg_tomado(lote_id: i64, wp_id: i64) -> String {
    serde_json::json!({ "tipo": "tomado", "loteId": lote_id, "wpId": wp_id }).to_string()
}

fn msg_ocupado(lote_id: i64, wp_id: i64, nombre: &str, emoji: &str) -> String {
    serde_json::json!({
        "tipo": "ocupado", "loteId": lote_id, "wpId": wp_id,
        "por": { "nombre": nombre, "emoji": emoji },
    })
    .to_string()
}

fn msg_perdido(lote_id: i64, wp_id: i64, nombre: &str, emoji: &str) -> String {
    serde_json::json!({
        "tipo": "perdido", "loteId": lote_id, "wpId": wp_id,
        "por": { "nombre": nombre, "emoji": emoji },
    })
    .to_string()
}

/// Manda `payload` solo a `sesion_id`. Si ya no está presente (se desconectó
/// justo antes), no hace nada: no hay nadie a quien avisar.
fn enviar_a(registro: &RegistroWs, sesion_id: &str, payload: String) {
    if let Some(tx) = registro.destinatario(sesion_id) {
        let _ = tx.send(Message::Text(payload.into()));
    }
}

/// Difunde `presencia` a todas las sesiones presentes. Se llama tras
/// cualquier cambio: conectar, desconectar, tomar, soltar, forzar o
/// caducar.
fn difundir_presencia(registro: &RegistroWs) {
    let payload = registro.presencia_json();
    for tx in registro.destinatarios() {
        let _ = tx.send(Message::Text(payload.clone().into()));
    }
}

/// Los mensajes que el cliente manda por el WebSocket, con el campo `tipo`
/// como discriminador y el resto de campos en camelCase, igual que el resto
/// del protocolo.
#[derive(Deserialize)]
#[serde(tag = "tipo")]
enum MensajeCliente {
    #[serde(rename = "hola")]
    Hola { cliente: String },
    #[serde(rename = "tomar", rename_all = "camelCase")]
    Tomar { lote_id: i64, wp_id: i64 },
    #[serde(rename = "soltar", rename_all = "camelCase")]
    Soltar { lote_id: i64, wp_id: i64 },
    #[serde(rename = "forzar", rename_all = "camelCase")]
    Forzar { lote_id: i64, wp_id: i64 },
    #[serde(rename = "latido")]
    Latido,
}

#[derive(Deserialize)]
struct ConsultaWs {
    token: String,
}

/// `GET /ws?token=<token>`: el token va en la query, no en `Authorization`,
/// porque un WebSocket de navegador no puede mandar cabeceras propias al
/// conectar. Por eso esta ruta vive fuera de `cors_y_token` (ver
/// `construir_router`) y comprueba el token ella misma antes de aceptar el
/// upgrade.
async fn manejar_ws(
    AxState(estado): AxState<EstadoHttp>,
    AxQuery(consulta): AxQuery<ConsultaWs>,
    ws: WebSocketUpgrade,
) -> Response {
    if !tokens_iguales(
        normalizar_token(&consulta.token).as_bytes(),
        normalizar_token(&estado.token).as_bytes(),
    ) {
        return json_error(StatusCode::UNAUTHORIZED, "token inválido");
    }
    ws.on_upgrade(move |socket| manejar_conexion(socket, estado))
}

/// Toda la vida de una conexión WebSocket: identificarse, quedar
/// registrada, atender mensajes propios y ajenos a la vez, y limpiarse al
/// final pase lo que pase.
///
/// El `select!` de más abajo es la forma de que esta tarea, que es la única
/// dueña del `WebSocket` (no se puede escribir y leer a la vez sobre él
/// desde dos tareas sin partirlo), pueda tanto reaccionar a lo que mande
/// este cliente como reenviarle lo que otra conexión —un `forzar` ajeno, un
/// cambio de presencia— le haya puesto en su canal `tx`.
async fn manejar_conexion(mut socket: WebSocket, estado: EstadoHttp) {
    // El primer mensaje tiene que ser «hola»: sin el `cliente` que lleva
    // dentro no hay a quién darle sesión ni animal. Cualquier otra cosa
    // primero —incluida una desconexión— y no hay sesión que crear.
    let cliente = loop {
        match socket.recv().await {
            Some(Ok(Message::Text(t))) => match serde_json::from_str::<MensajeCliente>(&t) {
                Ok(MensajeCliente::Hola { cliente }) => break cliente,
                _ => return,
            },
            Some(Ok(_)) => continue,
            _ => return,
        }
    };

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Message>();
    let (sesion_id, nombre, emoji) = estado.registro.conectar(cliente, tx);

    let bienvenida = serde_json::json!({
        "tipo": "bienvenida", "sesion": sesion_id, "nombre": nombre, "emoji": emoji,
    })
    .to_string();
    if socket.send(Message::Text(bienvenida.into())).await.is_err() {
        estado.registro.desconectar(&sesion_id);
        difundir_presencia(&estado.registro);
        return;
    }
    difundir_presencia(&estado.registro);

    loop {
        tokio::select! {
            entrante = socket.recv() => {
                match entrante {
                    Some(Ok(Message::Text(t))) => {
                        procesar_mensaje_cliente(&estado.registro, &sesion_id, &t);
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
            saliente = rx.recv() => {
                match saliente {
                    Some(m) => {
                        if socket.send(m).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    estado.registro.desconectar(&sesion_id);
    difundir_presencia(&estado.registro);
}

/// Procesa un mensaje ya identificado como texto de esta sesión. Un mensaje
/// que no encaja en `MensajeCliente` (JSON roto, `tipo` desconocido) se
/// ignora sin cerrar la conexión: más vale eso que dejar que un cliente
/// desactualizado tire la sesión de todos.
fn procesar_mensaje_cliente(registro: &RegistroWs, sesion_id: &str, texto: &str) {
    let mensaje = match serde_json::from_str::<MensajeCliente>(texto) {
        Ok(m) => m,
        Err(_) => return,
    };
    match mensaje {
        // Ya se usó como primer mensaje; una segunda «hola» no hace nada.
        MensajeCliente::Hola { .. } => {}
        MensajeCliente::Latido => registro.latido(sesion_id),
        MensajeCliente::Tomar { lote_id, wp_id } => match registro.tomar(sesion_id, (lote_id, wp_id)) {
            ResultadoTomar::Tomado => {
                enviar_a(registro, sesion_id, msg_tomado(lote_id, wp_id));
                difundir_presencia(registro);
            }
            ResultadoTomar::Ocupado { nombre, emoji } => {
                enviar_a(registro, sesion_id, msg_ocupado(lote_id, wp_id, nombre, emoji));
            }
            ResultadoTomar::SesionDesconocida => {}
        },
        MensajeCliente::Soltar { lote_id, wp_id } => {
            // No-op silencioso si esta sesión no tenía de verdad ese
            // artículo: ni error ni difusión de presencia, porque no cambió
            // nada que las demás sesiones necesiten saber.
            if registro.soltar(sesion_id, (lote_id, wp_id)) {
                difundir_presencia(registro);
            }
        }
        MensajeCliente::Forzar { lote_id, wp_id } => {
            let (nombre, emoji) = registro.identidad(sesion_id).unwrap_or(("", ""));
            if let Some(anterior) = registro.forzar(sesion_id, (lote_id, wp_id)) {
                enviar_a(registro, &anterior, msg_perdido(lote_id, wp_id, nombre, emoji));
            }
            enviar_a(registro, sesion_id, msg_tomado(lote_id, wp_id));
            difundir_presencia(registro);
        }
    }
}

/// La tarea de vigilancia: cada `intervalo`, expulsa sesiones sin latido
/// desde hace más de `timeout` y difunde presencia si expulsó a alguna.
/// Vive tanto como el servidor: se para con el mismo apagado que el
/// `axum::serve` (ver `detener`), para no dejar una tarea corriendo para
/// siempre por cada vez que se encendió el servidor.
async fn vigilar_caducidad(
    registro: Arc<RegistroWs>,
    timeout: Duration,
    intervalo: Duration,
    mut apagar: tokio::sync::oneshot::Receiver<()>,
) {
    let mut ticker = tokio::time::interval(intervalo);
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if !registro.expulsar_caducadas(timeout).is_empty() {
                    difundir_presencia(&registro);
                }
            }
            _ = &mut apagar => break,
        }
    }
}

// ── Los argumentos de cada comando expuesto, en camelCase ───────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsLote {
    lote_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsLoteWp {
    lote_id: i64,
    wp_id: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsTiempo {
    lote_id: i64,
    wp_id: i64,
    segundos: i64,
    menciones: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsGuardarAnotacion {
    lote_id: i64,
    wp_id: i64,
    menciones: Vec<Mencion>,
    relaciones: Vec<RelacionFila>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsConexion {
    connection_id: i64,
}

#[derive(Deserialize)]
struct ArgsVacio {}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsGuardarSesion {
    connection_id: Option<i64>,
    paso: String,
    progreso: i64,
    taxonomia: Option<String>,
    lote_id: Option<i64>,
}

/// Cuerpo de `POST /api/grafo_evidencia`.
///
/// `a` y `b` deben llevar el **texto canonicalizado de la entidad** —el que
/// guarda `anotaciones.texto`—, no `a_mid`/`b_mid` de la tabla `relaciones`.
/// Si alguien pone un `mid` en cualquiera de los dos campos, la petición no
/// falla: un `mid` deserializa como `String` sin ningún problema, así que no
/// hay validación de tipo ni de forma que lo detecte. Lo que se recibe es un
/// `200 {"ok": []}`, indistinguible de una relación que de verdad no tiene
/// evidencia. Ver la sección «La trampa de `grafo_evidencia`» al principio
/// de este archivo y `Db::grafo_evidencia` en `core/src/db.rs`.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArgsGrafoEvidencia {
    lote_id: i64,
    a: String,
    b: String,
    predicado: String,
}

/// Los nombres que este despacho reconoce. Es la misma lista que los brazos
/// del `match` de abajo, y existe aparte solo para que la prueba de
/// superficie pueda enumerarla sin duplicar el `match` entero.
#[allow(dead_code)] // solo lo usan las pruebas de superficie, más abajo.
pub(crate) const EXPUESTOS: &[&str] = &[
    "muestra",
    "anotacion",
    "guardar_anotacion",
    "cerrar_articulo",
    "apuntar_tiempo",
    "tiempo_articulo",
    "descartar_tiempo",
    "tiempos_dudosos",
    "avance_anotacion",
    "reanudar_anotacion",
    "lexico",
    "lotes",
    "categorias_del_lote",
    "guardar_sesion",
    "cargar_sesion",
    // Trampa (ver «La trampa de `grafo_evidencia`» arriba, en el docstring
    // del módulo, y `ArgsGrafoEvidencia` abajo): `a`/`b` van en texto
    // canonicalizado, no como `a_mid`/`b_mid`. Pasar un mid no falla, da
    // `{"ok": []}` igual que una relación sin evidencia de verdad.
    "grafo_evidencia",
];

fn args_invalidos(e: serde_json::Error) -> Despacho {
    Despacho::ArgumentosInvalidos(format!("argumentos inválidos: {e}"))
}

fn a_json<T: serde::Serialize>(v: T) -> Despacho {
    match serde_json::to_value(v) {
        Ok(j) => Despacho::Ok(j),
        Err(e) => Despacho::Fallo(format!("no se pudo convertir la respuesta: {e}")),
    }
}

/// El único punto por el que un nombre de comando se convierte en una
/// llamada de verdad contra la base. Cualquier nombre que no sea uno de los
/// brazos de este `match` cae en `_` sin que se deserialice nada ni se toque
/// `Db`: no hay ningún camino desde un nombre arbitrario hasta `commands.rs`.
async fn despachar(comando: &str, db: Arc<Db>, cuerpo: &[u8]) -> Despacho {
    let cuerpo = if cuerpo.is_empty() { b"{}".as_slice() } else { cuerpo };

    match comando {
        "muestra" => {
            let a: ArgsLote = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::muestra_impl(db, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "anotacion" => {
            let a: ArgsLoteWp = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::anotacion_impl(db, a.lote_id, a.wp_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "guardar_anotacion" => {
            let a: ArgsGuardarAnotacion = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::guardar_anotacion_impl(db, a.lote_id, a.wp_id, a.menciones, a.relaciones).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "cerrar_articulo" => {
            let a: ArgsTiempo = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::cerrar_articulo_impl(db, a.lote_id, a.wp_id, a.segundos, a.menciones).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "apuntar_tiempo" => {
            let a: ArgsTiempo = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::apuntar_tiempo_impl(db, a.lote_id, a.wp_id, a.segundos, a.menciones).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "tiempo_articulo" => {
            let a: ArgsLoteWp = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::tiempo_articulo_impl(db, a.lote_id, a.wp_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "descartar_tiempo" => {
            let a: ArgsLoteWp = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::descartar_tiempo_impl(db, a.lote_id, a.wp_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "tiempos_dudosos" => {
            let a: ArgsLote = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::tiempos_dudosos_impl(db, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "avance_anotacion" => {
            let a: ArgsLote = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::avance_anotacion_impl(db, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "reanudar_anotacion" => {
            let a: ArgsLote = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::reanudar_anotacion_impl(db, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "lexico" => {
            let a: ArgsLote = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::lexico_impl(db, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "lotes" => {
            let a: ArgsConexion = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::lotes_impl(db, a.connection_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "categorias_del_lote" => {
            let a: ArgsLote = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::categorias_del_lote_impl(db, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "guardar_sesion" => {
            let a: ArgsGuardarSesion = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::guardar_sesion_impl(db, a.connection_id, a.paso, a.progreso, a.taxonomia, a.lote_id).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "cargar_sesion" => {
            let _: ArgsVacio = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::cargar_sesion_impl(db).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        "grafo_evidencia" => {
            let a: ArgsGrafoEvidencia = match serde_json::from_slice(cuerpo) { Ok(a) => a, Err(e) => return args_invalidos(e) };
            match commands::grafo_evidencia_impl(db, a.lote_id, a.a, a.b, a.predicado).await {
                Ok(v) => a_json(v), Err(e) => Despacho::Fallo(e.to_string()),
            }
        }
        _ => Despacho::NoEncontrado,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    /// Todos los nombres reales de `#[tauri::command]` en `commands.rs`, leídos
    /// del código fuente tal cual compila. No hay reflexión en tiempo de
    /// ejecución para comandos de Tauri, así que esto es lo más cerca que se
    /// puede estar de «recorrer la lista real de comandos del binario»: es
    /// exactamente el fichero que el binario compila.
    fn comandos_reales() -> Vec<String> {
        let fuente = include_str!("commands.rs");
        let mut nombres = Vec::new();
        let lineas: Vec<&str> = fuente.lines().collect();
        let mut i = 0;
        while i < lineas.len() {
            if lineas[i].trim() == "#[tauri::command]" {
                // El nombre está en la primera línea después del atributo que
                // contenga "fn ": puede haber otro atributo (`#[allow(...)]`)
                // de por medio, pero nunca una línea en blanco.
                let mut j = i + 1;
                while j < lineas.len() && !lineas[j].contains("fn ") {
                    j += 1;
                }
                if j < lineas.len() {
                    if let Some(resto) = lineas[j].split("fn ").nth(1) {
                        let nombre: String = resto
                            .chars()
                            .take_while(|c| c.is_alphanumeric() || *c == '_')
                            .collect();
                        if !nombre.is_empty() {
                            nombres.push(nombre);
                        }
                    }
                }
            }
            i += 1;
        }
        nombres
    }

    #[test]
    fn la_lectura_del_fuente_encuentra_los_comandos_conocidos() {
        // Ancla contra el propio archivo cambiando de forma inesperada: si
        // esto deja de encontrar comandos, la prueba de superficie de abajo
        // pasaría por no encontrar nada que comprobar, no porque el despacho
        // esté bien cerrado.
        let reales = comandos_reales();
        assert!(reales.len() >= 50, "se esperaban ~55 comandos, se leyeron {}", reales.len());
        for nombre in EXPUESTOS {
            assert!(reales.iter().any(|r| r == nombre), "«{nombre}» está en EXPUESTOS pero no en commands.rs");
        }
    }

    /// La prueba de superficie: para cada comando que existe de verdad en
    /// `commands.rs`, si no está en `EXPUESTOS` el despacho tiene que
    /// devolver `NoEncontrado` —y por tanto no haber llamado a ningún
    /// `*_impl`— sin que importe qué cuerpo se le mande.
    #[tokio::test]
    async fn ningun_comando_fuera_de_la_lista_es_alcanzable() {
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-superficie.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Arc::new(Db::open(&path).unwrap());

        let expuestos: HashSet<&str> = EXPUESTOS.iter().copied().collect();
        let reales = comandos_reales();
        assert!(!reales.is_empty());

        for nombre in &reales {
            let resultado = despachar(nombre, db.clone(), b"{}").await;
            if expuestos.contains(nombre.as_str()) {
                assert!(
                    !matches!(resultado, Despacho::NoEncontrado),
                    "«{nombre}» está en la lista blanca pero el despacho no lo reconoce"
                );
            } else {
                assert!(
                    matches!(resultado, Despacho::NoEncontrado),
                    "«{nombre}» NO está en la lista blanca pero el despacho lo ejecutó (dio {:?})",
                    match &resultado {
                        Despacho::Ok(_) => "Ok",
                        Despacho::NoEncontrado => "NoEncontrado",
                        Despacho::ArgumentosInvalidos(_) => "ArgumentosInvalidos",
                        Despacho::Fallo(_) => "Fallo",
                    }
                );
            }
        }

        // Los de la lista negra explícita del encargo, con nombre y apellido:
        // si alguna vez se cuelan en `EXPUESTOS` por accidente, que revienten
        // aquí con su nombre en el mensaje, no como una entrada más del bucle
        // de arriba.
        for peligroso in [
            "discover_site", "save_connection", "delete_connection", "conexion_guardada",
            "paso_autorizacion", "probar_credencial", "olvidar_credencial", "duenio",
            "iniciar_censo", "cancelar_censo", "censo_corriendo", "catalogo_modelos",
            "preparar_modelos", "modelos_pendientes", "entorno_estado", "instalar_entorno",
            "iniciar_extraccion", "cancelar_extraccion", "deshacer_extraccion", "sondear_archivo",
        ] {
            assert!(
                matches!(despachar(peligroso, db.clone(), b"{}").await, Despacho::NoEncontrado),
                "«{peligroso}» debía estar bloqueado y no lo está"
            );
        }

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn el_token_evita_los_pares_ambiguos() {
        let t = generar_token();
        assert_eq!(t.len(), 19, "4 grupos de 4 + 3 guiones");
        for c in t.chars() {
            assert!(!['0', 'O', '1', 'l'].contains(&c), "el token «{t}» lleva un carácter ambiguo: {c}");
        }
    }

    #[test]
    fn comparacion_de_tokens() {
        assert!(tokens_iguales(b"abcd", b"abcd"));
        assert!(!tokens_iguales(b"abcd", b"abce"));
        assert!(!tokens_iguales(b"abcd", b"abc"));
    }

    #[test]
    fn normalizar_token_recorta_espacios_y_sube_a_mayusculas() {
        assert_eq!(normalizar_token("abcd-1234-efgh-5678"), "ABCD-1234-EFGH-5678");
        assert_eq!(normalizar_token("  ABCD-1234-EFGH-5678  "), "ABCD-1234-EFGH-5678");
        assert_eq!(normalizar_token("\tAbCd-1234-eFgH-5678\n"), "ABCD-1234-EFGH-5678");
        assert_eq!(
            tokens_iguales(
                normalizar_token("abcd-1234-efgh-5678").as_bytes(),
                normalizar_token(" ABCD-1234-EFGH-5678 ").as_bytes(),
            ),
            true,
            "mismo token en minúsculas, mayúsculas y con espacios debe compararse igual"
        );
    }

    // ── Pruebas de HTTP de verdad, contra un servidor levantado en el sitio ──

    fn db_de_prueba(sufijo: &str) -> (std::path::PathBuf, Arc<Db>) {
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-{sufijo}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        (path.clone(), Arc::new(Db::open(&path).unwrap()))
    }

    /// El `iniciar` que usan casi todas las pruebas de este módulo: pide un
    /// puerto efímero de verdad (por `iniciar_interno`, que no traduce `0`),
    /// para que muchas pruebas puedan correr a la vez sin pisarse el mismo
    /// puerto. La traducción de `0` a `PUERTO_PREDETERMINADO` que hace
    /// `iniciar` es justo lo que las pruebas de más abajo sobre el puerto fijo
    /// comprueban aparte, contra el `iniciar` público de verdad.
    async fn iniciar_prueba(db: Arc<Db>, srv: &ServidorState) -> Result<EstadoServidor> {
        iniciar_interno(db, srv, 0, LATIDO_TIMEOUT, VIGILANCIA_INTERVALO).await
    }

    /// Un cliente HTTP mínimo hecho a mano, sin sumar `reqwest` ni `tower` solo
    /// para las pruebas: abre el socket, escribe la petición en crudo y separa
    /// el código de estado del cuerpo de la respuesta.
    async fn pedir(
        addr: std::net::SocketAddr, metodo: &str, ruta: &str, token: Option<&str>, cuerpo: &str,
    ) -> (u16, String) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let auth = token.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
        let peticion = format!(
            "{metodo} {ruta} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nConnection: close\r\n{auth}\r\n{cuerpo}",
            cuerpo.len()
        );
        stream.write_all(peticion.as_bytes()).await.unwrap();
        let mut crudo = Vec::new();
        stream.read_to_end(&mut crudo).await.unwrap();
        let texto = String::from_utf8_lossy(&crudo).to_string();
        let codigo = texto
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let cuerpo_resp = texto.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (codigo, cuerpo_resp)
    }

    #[tokio::test]
    async fn sin_token_da_401_y_con_token_incorrecto_tambien() {
        let (path, db) = db_de_prueba("401");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        assert!(est.activo, "servir_iniciar debe devolver activo=true solo si ya está escuchando");
        let addr: std::net::SocketAddr =
            format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", None, "").await;
        assert_eq!(codigo, 401, "sin token: {cuerpo}");
        assert!(cuerpo.contains("\"error\""));

        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", Some("ZZZZ-ZZZZ-ZZZZ-ZZZZ"), "").await;
        assert_eq!(codigo, 401, "token incorrecto: {cuerpo}");

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn token_por_http_se_reconoce_en_mayusculas_minusculas_y_con_espacios() {
        let (path, db) = db_de_prueba("token-case-http");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        for variante in [
            est.token.clone(),
            est.token.to_lowercase(),
            est.token.to_uppercase(),
            mezclar_mayus_minus(&est.token),
            format!("  {}  ", est.token),
            format!(" {} ", est.token.to_lowercase()),
        ] {
            let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", Some(&variante), "").await;
            assert_eq!(codigo, 200, "variante «{variante}» debía aceptarse: {cuerpo}");
        }

        // Un token realmente distinto sigue dando 401, con o sin las mismas
        // libertades de mayúsculas/espacios: normalizar no debe ampliar el
        // conjunto de tokens válidos, solo la forma de teclear el correcto.
        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", Some("zzzz-zzzz-zzzz-zzzz"), "").await;
        assert_eq!(codigo, 401, "token distinto en minúsculas: {cuerpo}");
        let (codigo, cuerpo) =
            pedir(addr, "GET", "/api/salud", Some(&format!("  {} ", "ZZZZ-ZZZZ-ZZZZ-ZZZZ")), "").await;
        assert_eq!(codigo, 401, "token distinto con espacios: {cuerpo}");

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    /// Alterna mayúsculas y minúsculas carácter a carácter, para probar el
    /// caso «mezcla» sin depender de que el token generado tenga alguna
    /// letra en una posición concreta.
    fn mezclar_mayus_minus(s: &str) -> String {
        s.chars()
            .enumerate()
            .map(|(i, c)| if i % 2 == 0 { c.to_ascii_lowercase() } else { c.to_ascii_uppercase() })
            .collect()
    }

    #[tokio::test]
    async fn comando_fuera_de_la_lista_da_400_por_http() {
        let (path, db) = db_de_prueba("400");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr =
            format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let (codigo, cuerpo) =
            pedir(addr, "POST", "/api/probar_credencial", Some(&est.token), "{}").await;
        assert_eq!(codigo, 400, "comando en la lista negra: {cuerpo}");
        assert!(cuerpo.contains("\"error\""));

        let (codigo, _) =
            pedir(addr, "POST", "/api/esto_no_existe", Some(&est.token), "{}").await;
        assert_eq!(codigo, 400);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn salud_con_token_correcto_da_200_con_protocolo_1() {
        let (path, db) = db_de_prueba("salud");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr =
            format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", Some(&est.token), "").await;
        assert_eq!(codigo, 200, "{cuerpo}");
        let json: serde_json::Value = serde_json::from_str(&cuerpo).unwrap();
        assert_eq!(json["ok"]["protocolo"], 1);
        assert_eq!(json["ok"]["lotes"], 0);
        assert!(json["ok"]["version"].is_string());

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn iniciar_dos_veces_no_cambia_el_puerto_ni_rompe_nada() {
        let (path, db) = db_de_prueba("doble-inicio");
        let srv = ServidorState::default();
        let primero = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let segundo = iniciar_prueba(db.clone(), &srv).await.unwrap();
        assert_eq!(primero.puerto, segundo.puerto);
        assert_eq!(primero.token, segundo.token);
        assert_eq!(primero.direcciones, segundo.direcciones);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    // ── El puerto fijo: 36507 siempre, y nunca una reserva automática ────────
    //
    // El valor de PUERTO_PREDETERMINADO se comprueba aparte, como constante
    // (abajo), sin escuchar en ningún socket. El comportamiento de verdad
    // —la traducción de `0` es estable entre reinicios, y un puerto ocupado
    // falla sin elegir otro— se comprueba contra `iniciar_con_predeterminado`
    // con un "puerto por defecto" de prueba (libre en ese momento, elegido
    // por el sistema operativo), no contra el 36507 real: si la app del
    // usuario está corriendo y sirviendo de verdad en su puerto de
    // producción, esta prueba no debe fallar por esa colisión, que no tiene
    // nada que ver con lo que aquí se comprueba. Ya pasó una vez.
    #[tokio::test]
    async fn el_puerto_es_siempre_36507_estable_y_sin_reserva_automatica_si_esta_ocupado() {
        assert_eq!(PUERTO_PREDETERMINADO, 36507);

        let (path, db) = db_de_prueba("puerto-fijo");
        let srv = ServidorState::default();

        // Un puerto libre en este instante, para hacer de "puerto por
        // defecto" de esta prueba en vez del 36507 real.
        let libre = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let predeterminado_de_prueba = libre.local_addr().unwrap().port();
        drop(libre); // se libera para que iniciar_con_predeterminado pueda tomarlo de verdad.

        // 0 significa el puerto por defecto, no «elige uno libre».
        let primero = iniciar_con_predeterminado(db.clone(), &srv, 0, predeterminado_de_prueba).await.unwrap();
        assert_eq!(primero.puerto, predeterminado_de_prueba);

        // Apagar y volver a encender da el mismo puerto: la estabilidad que
        // ya tenía el token ahora también la tiene el puerto.
        detener(&db, &srv).await.unwrap();
        let segundo = iniciar_con_predeterminado(db.clone(), &srv, 0, predeterminado_de_prueba).await.unwrap();
        assert_eq!(segundo.puerto, predeterminado_de_prueba);
        assert_eq!(segundo.token, primero.token);
        detener(&db, &srv).await.unwrap();

        // Pedir un puerto que ya está ocupado falla con un mensaje que nombra
        // el puerto y dice que está en uso; nunca cae en silencio a otro.
        let ocupante = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let puerto_ocupado = ocupante.local_addr().unwrap().port();
        let err = iniciar_con_predeterminado(db.clone(), &srv, puerto_ocupado, predeterminado_de_prueba)
            .await
            .unwrap_err();
        let mensaje = err.to_string();
        assert!(
            mensaje.contains(&puerto_ocupado.to_string()),
            "el mensaje debía nombrar el puerto {puerto_ocupado}: {mensaje}"
        );
        assert!(
            mensaje.to_lowercase().contains("ocupado") || mensaje.to_lowercase().contains("en uso"),
            "el mensaje debía decir que está ocupado: {mensaje}"
        );
        // El fallo no dejó nada escuchando en otro puerto por su cuenta.
        let estado_tras_fallo = estado(&db, &srv).unwrap();
        assert!(!estado_tras_fallo.activo, "un puerto ocupado no debía dejar el servidor arrancado en otro puerto");
        drop(ocupante);

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn un_puerto_explicito_distinto_de_36507_se_respeta() {
        // El puerto fijo es el *valor por defecto*, no el único posible:
        // `servir_iniciar` sigue aceptando un puerto explícito.
        let (path, db) = db_de_prueba("puerto-explicito");
        let srv = ServidorState::default();
        let libre = std::net::TcpListener::bind("0.0.0.0:0").unwrap();
        let puerto = libre.local_addr().unwrap().port();
        drop(libre); // se libera para que iniciar() pueda tomarlo de verdad.

        let est = iniciar(db.clone(), &srv, puerto).await.unwrap();
        assert_eq!(est.puerto, puerto);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    // ── `direcciones`: todas las interfaces, no una sola ─────────────────────

    #[test]
    fn direcciones_locales_reporta_varias_interfaces_no_loopback() {
        // Esta máquina, al escribir esta prueba, tiene a la vez una interfaz
        // ethernet y una wifi en la misma red más Tailscale: es exactamente
        // el caso —varias interfaces activas a la vez— que la función tiene
        // que enumerar entera, no solo adivinar una. Se prueba la función
        // directamente, sin levantar un servidor, porque es donde vive de
        // verdad la enumeración; `EstadoServidor::direcciones` solo la llama.
        let direcciones = direcciones_locales();
        assert!(!direcciones.is_empty(), "debía reportar al menos una dirección local");
        assert!(
            !direcciones.iter().any(|d| d == "127.0.0.1"),
            "no debía incluir loopback: {direcciones:?}"
        );
        assert!(
            direcciones.len() >= 2,
            "esta máquina tiene varias interfaces no-loopback activas; se esperaba más de una dirección, se obtuvo {direcciones:?}"
        );
    }

    #[tokio::test]
    async fn el_estado_activo_expone_direcciones_locales() {
        let (path, db) = db_de_prueba("direcciones-activo");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        assert!(!est.direcciones.is_empty());
        assert_eq!(est.direcciones, direcciones_locales());

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn detener_sin_haber_iniciado_no_falla() {
        let (path, db) = db_de_prueba("apagar-en-frio");
        let srv = ServidorState::default();
        let est = detener(&db, &srv).await.unwrap();
        assert!(!est.activo);
        assert_eq!(est.puerto, 0);
        assert!(est.direcciones.is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn un_comando_de_la_lista_blanca_devuelve_datos_reales() {
        let (path, db) = db_de_prueba("datos");
        let conn_id = db
            .upsert_connection("prueba", "https://prueba.test", "{}", "wp-json", None, None, "{}")
            .unwrap();
        db.con(|c| {
            c.execute(
                "INSERT INTO lotes (connection_id, label) VALUES (?1, 'lote de prueba')",
                [conn_id],
            )?;
            Ok(())
        })
        .unwrap();

        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr =
            format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let cuerpo = format!("{{\"connectionId\": {conn_id}}}");
        let (codigo, resp) = pedir(addr, "POST", "/api/lotes", Some(&est.token), &cuerpo).await;
        assert_eq!(codigo, 200, "{resp}");
        let json: serde_json::Value = serde_json::from_str(&resp).unwrap();
        let lotes = json["ok"].as_array().unwrap();
        assert_eq!(lotes.len(), 1);
        assert_eq!(lotes[0]["etiqueta"], "lote de prueba");

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    // ── Pruebas del WebSocket: presencia y bloqueos por artículo ─────────────
    //
    // Un cliente de WebSocket mínimo hecho a mano, en el mismo espíritu que
    // `pedir` arriba: el handshake HTTP de upgrade es una petición de texto
    // como cualquier otra, y una vez arriba, un frame de texto sin
    // fragmentar (RFC 6455 §5) es poco código. No hace falta sumar
    // `tokio-tungstenite` como cliente de pruebas solo para esto.

    /// Handshake de WebSocket contra `ruta` (con o sin `?token=...`). La
    /// clave de `Sec-WebSocket-Key` es la fija del ejemplo de la RFC 6455:
    /// no hace falta que sea aleatoria para que el servidor la acepte, y
    /// para una prueba no hay nada que proteger repitiéndola.
    ///
    /// Devuelve el socket ya arriba si el servidor respondió 101, o `None`
    /// si lo rechazó (que es exactamente lo que prueban los casos de token
    /// ausente o incorrecto).
    async fn ws_conectar(addr: std::net::SocketAddr, ruta: &str) -> Option<tokio::net::TcpStream> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream = tokio::net::TcpStream::connect(addr).await.unwrap();
        let peticion = format!(
            "GET {ruta} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\
             Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
        );
        stream.write_all(peticion.as_bytes()).await.unwrap();

        // Lee byte a byte hasta el final de las cabeceras: un `read()` que
        // pidiera más se arriesgaría a tragarse el primer frame si el
        // servidor lo mandó pegado a la respuesta del handshake.
        let mut cabeceras = Vec::new();
        let mut b = [0u8; 1];
        loop {
            match stream.read(&mut b).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    cabeceras.push(b[0]);
                    if cabeceras.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
            }
        }
        let texto = String::from_utf8_lossy(&cabeceras);
        let codigo: u16 = texto
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        if codigo == 101 { Some(stream) } else { None }
    }

    /// Igual que `ws_conectar`, pero con el token ya puesto en la query.
    async fn ws_conectar_con_token(addr: std::net::SocketAddr, token: &str) -> Option<tokio::net::TcpStream> {
        ws_conectar(addr, &format!("/ws?token={token}")).await
    }

    /// Un frame de texto de cliente a servidor: RFC 6455 exige que vaya
    /// enmascarado. La máscara no necesita ser impredecible para que el
    /// servidor la acepte —solo para que un tercero no lea el payload en la
    /// red, que aquí es localhost y no hay tercero—, así que basta una fija.
    fn frame_texto(payload: &str) -> Vec<u8> {
        const MASCARA: [u8; 4] = [0x12, 0x34, 0x56, 0x78];
        let datos = payload.as_bytes();
        let mut out = vec![0x81u8]; // FIN=1, opcode=1 (texto)
        let len = datos.len();
        if len < 126 {
            out.push(0x80 | len as u8);
        } else if len <= 0xFFFF {
            out.push(0x80 | 126);
            out.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            out.push(0x80 | 127);
            out.extend_from_slice(&(len as u64).to_be_bytes());
        }
        out.extend_from_slice(&MASCARA);
        out.extend(datos.iter().enumerate().map(|(i, b)| b ^ MASCARA[i % 4]));
        out
    }

    async fn ws_enviar(stream: &mut tokio::net::TcpStream, payload: &str) {
        use tokio::io::AsyncWriteExt;
        stream.write_all(&frame_texto(payload)).await.unwrap();
    }

    /// Lee un frame del servidor (nunca enmascarado: RFC 6455 §5.1) y
    /// devuelve su payload si es de texto. Un `ping`/`pong`/binario se
    /// salta sin más —no debería llegar ninguno en este protocolo—, y un
    /// `close` o el cierre del socket devuelven `None`.
    async fn ws_recibir(stream: &mut tokio::net::TcpStream) -> Option<String> {
        use tokio::io::AsyncReadExt;
        loop {
            let mut cab = [0u8; 2];
            stream.read_exact(&mut cab).await.ok()?;
            let opcode = cab[0] & 0x0F;
            let enmascarado = cab[1] & 0x80 != 0;
            let mut len = (cab[1] & 0x7F) as u64;
            if len == 126 {
                let mut ext = [0u8; 2];
                stream.read_exact(&mut ext).await.ok()?;
                len = u16::from_be_bytes(ext) as u64;
            } else if len == 127 {
                let mut ext = [0u8; 8];
                stream.read_exact(&mut ext).await.ok()?;
                len = u64::from_be_bytes(ext);
            }
            let mascara = if enmascarado {
                let mut m = [0u8; 4];
                stream.read_exact(&mut m).await.ok()?;
                Some(m)
            } else {
                None
            };
            let mut datos = vec![0u8; len as usize];
            if len > 0 {
                stream.read_exact(&mut datos).await.ok()?;
            }
            if let Some(m) = mascara {
                for (i, byte) in datos.iter_mut().enumerate() {
                    *byte ^= m[i % 4];
                }
            }
            match opcode {
                0x1 => return Some(String::from_utf8(datos).unwrap()),
                0x8 => return None,
                _ => continue,
            }
        }
    }

    /// Lee frames hasta encontrar uno de `tipo` (saltándose, por ejemplo,
    /// una `presencia` de por medio cuando lo que se espera es un
    /// `tomado`), con un tope de intentos y de tiempo para que una prueba
    /// que de verdad está mal cuelgue en segundos, no para siempre.
    async fn ws_recibir_tipo(stream: &mut tokio::net::TcpStream, tipo: &str) -> serde_json::Value {
        for _ in 0..20 {
            let texto = tokio::time::timeout(Duration::from_secs(2), ws_recibir(stream))
                .await
                .expect("no llegó ningún mensaje del servidor a tiempo")
                .expect("la conexión se cerró antes de recibir el mensaje esperado");
            let json: serde_json::Value = serde_json::from_str(&texto)
                .unwrap_or_else(|e| panic!("mensaje del servidor no es JSON: {texto} ({e})"));
            if json["tipo"] == tipo {
                return json;
            }
        }
        panic!("no llegó un mensaje de tipo «{tipo}» tras 20 intentos");
    }

    async fn ws_hola(stream: &mut tokio::net::TcpStream, cliente: &str) -> serde_json::Value {
        ws_enviar(stream, &serde_json::json!({ "tipo": "hola", "cliente": cliente }).to_string()).await;
        ws_recibir_tipo(stream, "bienvenida").await
    }

    async fn ws_tomar(stream: &mut tokio::net::TcpStream, lote_id: i64, wp_id: i64) {
        ws_enviar(stream, &serde_json::json!({ "tipo": "tomar", "loteId": lote_id, "wpId": wp_id }).to_string()).await;
    }

    async fn ws_forzar(stream: &mut tokio::net::TcpStream, lote_id: i64, wp_id: i64) {
        ws_enviar(stream, &serde_json::json!({ "tipo": "forzar", "loteId": lote_id, "wpId": wp_id }).to_string()).await;
    }

    async fn ws_soltar(stream: &mut tokio::net::TcpStream, lote_id: i64, wp_id: i64) {
        ws_enviar(stream, &serde_json::json!({ "tipo": "soltar", "loteId": lote_id, "wpId": wp_id }).to_string()).await;
    }

    /// Lee y descarta frames hasta que pasan `quieto` sin que llegue ninguno
    /// más: deja el socket sin nada pendiente (los `presencia` que dispara
    /// cada conexión, típicamente), para que lo que se compruebe después sea
    /// solo lo que provoque la propia acción de la prueba.
    async fn ws_drenar(stream: &mut tokio::net::TcpStream, quieto: Duration) {
        loop {
            match tokio::time::timeout(quieto, ws_recibir(stream)).await {
                Ok(Some(_)) => continue,
                Ok(None) | Err(_) => break,
            }
        }
    }

    /// `true` si no llega ningún frame en `espera`. Es el reverso de
    /// `ws_recibir_tipo`: sirve para comprobar que una acción no provocó
    /// ningún mensaje —ni de respuesta ni de difusión— en vez de esperar uno
    /// que se sabe que sí debe llegar.
    async fn ws_nada_en(stream: &mut tokio::net::TcpStream, espera: Duration) -> bool {
        tokio::time::timeout(espera, ws_recibir(stream)).await.is_err()
    }

    #[tokio::test]
    async fn dos_sesiones_y_la_segunda_recibe_ocupado() {
        let (path, db) = db_de_prueba("ws-ocupado");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.expect("upgrade de a");
        let bienvenida_a = ws_hola(&mut a, "maquina-a").await;

        let mut b = ws_conectar_con_token(addr, &est.token).await.expect("upgrade de b");
        ws_hola(&mut b, "maquina-b").await;

        ws_tomar(&mut a, 1, 10).await;
        let tomado = ws_recibir_tipo(&mut a, "tomado").await;
        assert_eq!(tomado["loteId"], 1);
        assert_eq!(tomado["wpId"], 10);

        ws_tomar(&mut b, 1, 10).await;
        let ocupado = ws_recibir_tipo(&mut b, "ocupado").await;
        assert_eq!(ocupado["loteId"], 1);
        assert_eq!(ocupado["wpId"], 10);
        assert_eq!(ocupado["por"]["nombre"], bienvenida_a["nombre"]);
        assert_eq!(ocupado["por"]["emoji"], bienvenida_a["emoji"]);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    // Nótese que "b" nunca manda "tomar" antes de este "forzar": `forzar`
    // significa «quítaselo a quien lo tenga y dámelo», no «reintenta lo que
    // ya pedí», así que no hace falta haberlo pedido antes para forzarlo.
    async fn forzar_transfiere_y_el_anterior_recibe_perdido() {
        let (path, db) = db_de_prueba("ws-forzar");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut a, "maquina-a").await;
        let mut b = ws_conectar_con_token(addr, &est.token).await.unwrap();
        let bienvenida_b = ws_hola(&mut b, "maquina-b").await;

        ws_tomar(&mut a, 1, 10).await;
        let _ = ws_recibir_tipo(&mut a, "tomado").await;

        ws_forzar(&mut b, 1, 10).await;
        let tomado_b = ws_recibir_tipo(&mut b, "tomado").await;
        assert_eq!(tomado_b["loteId"], 1);
        assert_eq!(tomado_b["wpId"], 10);

        let perdido_a = ws_recibir_tipo(&mut a, "perdido").await;
        assert_eq!(perdido_a["loteId"], 1);
        assert_eq!(perdido_a["wpId"], 10);
        assert_eq!(perdido_a["por"]["nombre"], bienvenida_b["nombre"]);
        assert_eq!(perdido_a["por"]["emoji"], bienvenida_b["emoji"]);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn forzar_sobre_articulo_libre_lo_concede_como_un_tomar() {
        // Sin ningún "tomar" antes ni ningún otro dueño: "forzar" sobre un
        // artículo libre tiene que concederlo igual que lo haría un "tomar"
        // normal, no rechazarlo por no haberlo pedido primero.
        let (path, db) = db_de_prueba("ws-forzar-libre");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut a, "maquina-a").await;

        ws_forzar(&mut a, 1, 10).await;
        let tomado = ws_recibir_tipo(&mut a, "tomado").await;
        assert_eq!(tomado["loteId"], 1);
        assert_eq!(tomado["wpId"], 10);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn soltar_sin_tener_nada_no_rompe_ni_difunde() {
        // Pasa de verdad y no es un fallo del cliente: si a "a" le
        // arrebataron el artículo con "forzar" y sale de la pantalla, manda
        // "soltar" sobre algo que ya no tiene. Tiene que ser un no-op
        // silencioso: ni error para quien lo pide, ni difusión de presencia
        // para nadie, porque no cambió nada que las demás sesiones necesiten
        // saber.
        let (path, db) = db_de_prueba("ws-soltar-vacio");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut a, "maquina-a").await;
        let mut b = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut b, "maquina-b").await;

        // Deja ambos sockets sin nada pendiente de los `presencia` que ya
        // disparó cada conexión, para que lo que se compruebe después sea
        // solo lo que provoque el `soltar` de esta prueba.
        ws_drenar(&mut a, Duration::from_millis(200)).await;
        ws_drenar(&mut b, Duration::from_millis(200)).await;

        // "a" nunca tomó (1, 999): soltarlo no debe mandarle nada a "a" ni
        // difundir presencia a "b".
        ws_soltar(&mut a, 1, 999).await;
        assert!(
            ws_nada_en(&mut a, Duration::from_millis(300)).await,
            "soltar sin tener nada no debía mandarle nada a quien lo pidió"
        );
        assert!(
            ws_nada_en(&mut b, Duration::from_millis(300)).await,
            "soltar sin tener nada no debía difundir presencia a otras sesiones"
        );

        // La conexión sigue viva y funcionando con normalidad: un "tomar"
        // real después sí difunde presencia, lo que prueba que las dos
        // comprobaciones de arriba de verdad habrían detectado una difusión
        // si el "soltar" la hubiera provocado.
        ws_tomar(&mut a, 1, 999).await;
        let tomado = ws_recibir_tipo(&mut a, "tomado").await;
        assert_eq!(tomado["loteId"], 1);
        assert_eq!(tomado["wpId"], 999);
        let presencia_b = ws_recibir_tipo(&mut b, "presencia").await;
        assert_eq!(presencia_b["sesiones"].as_array().unwrap().len(), 2);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn tomar_un_segundo_articulo_suelta_el_primero() {
        let (path, db) = db_de_prueba("ws-un-bloqueo");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut a, "maquina-a").await;
        let mut b = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut b, "maquina-b").await;

        ws_tomar(&mut a, 1, 10).await;
        let _ = ws_recibir_tipo(&mut a, "tomado").await;

        // Un segundo artículo: el primero debe quedar libre por construcción.
        ws_tomar(&mut a, 1, 20).await;
        let tomado_20 = ws_recibir_tipo(&mut a, "tomado").await;
        assert_eq!(tomado_20["wpId"], 20);

        ws_tomar(&mut b, 1, 10).await;
        let tomado_10_por_b = ws_recibir_tipo(&mut b, "tomado").await;
        assert_eq!(tomado_10_por_b["loteId"], 1);
        assert_eq!(tomado_10_por_b["wpId"], 10);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn una_sesion_sin_latido_caduca_y_libera() {
        let (path, db) = db_de_prueba("ws-caduca");
        let srv = ServidorState::default();
        let est = iniciar_interno(db.clone(), &srv, 0, Duration::from_millis(150), Duration::from_millis(30))
            .await
            .unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut a, "maquina-a").await;
        ws_tomar(&mut a, 1, 10).await;
        let _ = ws_recibir_tipo(&mut a, "tomado").await;

        // Nunca manda un latido: pasado el `timeout` de esta prueba (mucho
        // más corto que los 60 s reales) la vigilancia debe soltar su
        // bloqueo sin que nadie la desconecte.
        tokio::time::sleep(Duration::from_millis(500)).await;

        let mut b = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut b, "maquina-b").await;
        ws_tomar(&mut b, 1, 10).await;
        let tomado = ws_recibir_tipo(&mut b, "tomado").await;
        assert_eq!(tomado["loteId"], 1);
        assert_eq!(tomado["wpId"], 10);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn desconectar_libera() {
        let (path, db) = db_de_prueba("ws-desconecta");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut a, "maquina-a").await;
        ws_tomar(&mut a, 1, 10).await;
        let _ = ws_recibir_tipo(&mut a, "tomado").await;

        drop(a); // cierre sucio, como un cable que se sale: sin `soltar` de por medio.
        tokio::time::sleep(Duration::from_millis(200)).await;

        let mut b = ws_conectar_con_token(addr, &est.token).await.unwrap();
        ws_hola(&mut b, "maquina-b").await;
        ws_tomar(&mut b, 1, 10).await;
        let tomado = ws_recibir_tipo(&mut b, "tomado").await;
        assert_eq!(tomado["loteId"], 1);
        assert_eq!(tomado["wpId"], 10);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn dos_sesiones_con_el_mismo_cliente_reciben_el_mismo_animal_si_esta_libre() {
        let (path, db) = db_de_prueba("ws-animal-estable");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        let mut a = ws_conectar_con_token(addr, &est.token).await.unwrap();
        let primera = ws_hola(&mut a, "portatil-fijo").await;
        drop(a);
        tokio::time::sleep(Duration::from_millis(200)).await;

        let mut b = ws_conectar_con_token(addr, &est.token).await.unwrap();
        let segunda = ws_hola(&mut b, "portatil-fijo").await;

        assert_eq!(primera["nombre"], segunda["nombre"], "el mismo cliente debía recuperar su animal");
        assert_eq!(primera["emoji"], segunda["emoji"]);

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn upgrade_sin_token_o_con_token_malo_es_rechazado() {
        let (path, db) = db_de_prueba("ws-token");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        assert!(
            ws_conectar(addr, "/ws?token=ZZZZ-ZZZZ-ZZZZ-ZZZZ").await.is_none(),
            "un token incorrecto debía rechazar el upgrade"
        );
        assert!(ws_conectar(addr, "/ws").await.is_none(), "sin token debía rechazar el upgrade");
        assert!(
            ws_conectar_con_token(addr, &est.token).await.is_some(),
            "con el token correcto sí debía aceptar el upgrade"
        );

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn token_por_ws_se_reconoce_en_mayusculas_minusculas_y_con_espacios() {
        let (path, db) = db_de_prueba("ws-token-case");
        let srv = ServidorState::default();
        let est = iniciar_prueba(db.clone(), &srv).await.unwrap();
        let addr: std::net::SocketAddr = format!("127.0.0.1:{}", est.puerto).parse().unwrap();

        assert!(
            ws_conectar_con_token(addr, &est.token.to_lowercase()).await.is_some(),
            "el token en minúsculas debía aceptar el upgrade"
        );
        assert!(
            ws_conectar_con_token(addr, &est.token.to_uppercase()).await.is_some(),
            "el token en mayúsculas debía aceptar el upgrade"
        );
        assert!(
            ws_conectar_con_token(addr, &mezclar_mayus_minus(&est.token)).await.is_some(),
            "el token con mayúsculas y minúsculas mezcladas debía aceptar el upgrade"
        );
        // Los espacios van percent-encoded en la query: un espacio literal
        // rompería la línea de la petición HTTP del propio handshake, no
        // solo el token.
        let con_espacios = format!("/ws?token=%20{}%20", est.token.to_lowercase());
        assert!(
            ws_conectar(addr, &con_espacios).await.is_some(),
            "el token con espacios alrededor (y en minúsculas) debía aceptar el upgrade"
        );

        // Un token realmente distinto sigue rechazándose, aunque venga en
        // minúsculas o con espacios: normalizar no amplía qué token vale.
        assert!(
            ws_conectar_con_token(addr, "zzzz-zzzz-zzzz-zzzz").await.is_none(),
            "un token distinto en minúsculas debía seguir rechazando el upgrade"
        );
        assert!(
            ws_conectar(addr, "/ws?token=%20ZZZZ-ZZZZ-ZZZZ-ZZZZ%20").await.is_none(),
            "un token distinto con espacios debía seguir rechazando el upgrade"
        );

        detener(&db, &srv).await.unwrap();
        let _ = std::fs::remove_file(&path);
    }
}

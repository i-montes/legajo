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
use crate::commands::{self, AppState};
use legajo_core::db::{Db, Mencion, RelacionFila};
use legajo_core::{Error, Result};
use serde::Deserialize;
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use tauri::State;

use axum::{
    body::Bytes,
    extract::{Path as AxPath, Request, State as AxState},
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
    ip: Ipv4Addr,
    puerto: u16,
    apagar: tokio::sync::oneshot::Sender<()>,
}

/// Estado de Tauri con el servidor, si lo hay. Aparte de `AppState`: nada de
/// lo demás necesita saber si el servidor está encendido.
#[derive(Default)]
pub struct ServidorState(Mutex<Option<Corriendo>>);

/// Lo que ven `servir_estado`, `servir_iniciar` y `servir_detener` en el
/// frontend. `direcciones` lleva como mucho un elemento: la interfaz exacta a
/// la que quedó atado el servidor, no una lista de candidatas para adivinar.
#[derive(Clone, Debug, serde::Serialize)]
pub struct EstadoServidor {
    pub activo: bool,
    pub puerto: u16,
    pub token: String,
    pub direcciones: Vec<String>,
}

fn estado_con(db: &Db, corriendo: Option<(Ipv4Addr, u16)>) -> Result<EstadoServidor> {
    let token = token_o_crear(db)?;
    Ok(match corriendo {
        Some((ip, puerto)) => {
            EstadoServidor { activo: true, puerto, token, direcciones: vec![ip.to_string()] }
        }
        None => EstadoServidor { activo: false, puerto: 0, token, direcciones: Vec::new() },
    })
}

/// El estado actual, sin tocar nada.
pub fn estado(db: &Db, srv: &ServidorState) -> Result<EstadoServidor> {
    let g = srv.0.lock().unwrap();
    estado_con(db, g.as_ref().map(|c| (c.ip, c.puerto)))
}

/// Enciende el servidor si no lo estaba. Si ya lo estaba, devuelve su estado
/// tal cual: encenderlo dos veces no reinicia nada ni cambia el puerto.
///
/// No vuelve hasta que el `TcpListener` está de verdad escuchando: el
/// frontend usa `activo` para decidir si le corresponde dejar de autoguardar,
/// y un «encendido» que solo significa «lo pedí» lo dejaría creyendo que ya
/// es seguro escribir desde el Mac cuando en realidad nadie atiende todavía
/// ese puerto.
pub async fn iniciar(db: Arc<Db>, srv: &ServidorState, puerto: u16) -> Result<EstadoServidor> {
    if let Some(c) = srv.0.lock().unwrap().as_ref() {
        return estado_con(&db, Some((c.ip, c.puerto)));
    }

    let token = token_o_crear(&db)?;
    let ip = ip_local_predeterminada().ok_or_else(|| {
        Error::Other(
            "No se encontró una interfaz de red local con ruta por defecto. \
             Conecta esta máquina a la red antes de encender el servidor."
                .into(),
        )
    })?;

    let listener = tokio::net::TcpListener::bind((ip, puerto))
        .await
        .map_err(|e| Error::Other(format!("no se pudo escuchar en {ip}:{puerto}: {e}")))?;
    let puerto_real = listener
        .local_addr()
        .map_err(|e| Error::Other(e.to_string()))?
        .port();

    let (apagar_tx, apagar_rx) = tokio::sync::oneshot::channel::<()>();
    let router = construir_router(EstadoHttp { db: db.clone(), token: token.clone().into() });

    tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = apagar_rx.await;
            })
            .await;
    });

    // Ya escucha: recién ahora se publica el estado «activo».
    *srv.0.lock().unwrap() = Some(Corriendo { ip, puerto: puerto_real, apagar: apagar_tx });

    estado_con(&db, Some((ip, puerto_real)))
}

/// Apaga el servidor si estaba encendido. Sin servidor que apagar, no falla:
/// simplemente devuelve el estado «apagado» que ya era cierto.
pub fn detener(db: &Db, srv: &ServidorState) -> Result<EstadoServidor> {
    if let Some(c) = srv.0.lock().unwrap().take() {
        let _ = c.apagar.send(());
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

#[tauri::command]
pub async fn servir_iniciar(
    app: State<'_, AppState>,
    srv: State<'_, ServidorState>,
    puerto: u16,
) -> Result<EstadoServidor> {
    iniciar(app.db.clone(), &srv, puerto).await
}

#[tauri::command]
pub fn servir_detener(
    app: State<'_, AppState>,
    srv: State<'_, ServidorState>,
) -> Result<EstadoServidor> {
    detener(&app.db, &srv)
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
fn ip_local_predeterminada() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect(("8.8.8.8", 80)).ok()?;
    match socket.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(ip) if !ip.is_loopback() => Some(ip),
        _ => None,
    }
}

// ── El servidor HTTP en sí ───────────────────────────────────────────────

#[derive(Clone)]
struct EstadoHttp {
    db: Arc<Db>,
    token: Arc<str>,
}

fn construir_router(estado: EstadoHttp) -> Router {
    Router::new()
        .route("/api/salud", get(manejar_salud))
        .route("/api/{comando}", post(manejar_comando))
        .layer(middleware::from_fn_with_state(estado.clone(), cors_y_token))
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
        .map(|t| tokens_iguales(t.as_bytes(), estado.token.as_bytes()))
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

    // ── Pruebas de HTTP de verdad, contra un servidor levantado en el sitio ──

    fn db_de_prueba(sufijo: &str) -> (std::path::PathBuf, Arc<Db>) {
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-{sufijo}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        (path.clone(), Arc::new(Db::open(&path).unwrap()))
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
        let est = iniciar(db.clone(), &srv, 0).await.unwrap();
        assert!(est.activo, "servir_iniciar debe devolver activo=true solo si ya está escuchando");
        let addr: std::net::SocketAddr =
            format!("{}:{}", est.direcciones[0], est.puerto).parse().unwrap();

        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", None, "").await;
        assert_eq!(codigo, 401, "sin token: {cuerpo}");
        assert!(cuerpo.contains("\"error\""));

        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", Some("ZZZZ-ZZZZ-ZZZZ-ZZZZ"), "").await;
        assert_eq!(codigo, 401, "token incorrecto: {cuerpo}");

        detener(&db, &srv).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn comando_fuera_de_la_lista_da_400_por_http() {
        let (path, db) = db_de_prueba("400");
        let srv = ServidorState::default();
        let est = iniciar(db.clone(), &srv, 0).await.unwrap();
        let addr: std::net::SocketAddr =
            format!("{}:{}", est.direcciones[0], est.puerto).parse().unwrap();

        let (codigo, cuerpo) =
            pedir(addr, "POST", "/api/probar_credencial", Some(&est.token), "{}").await;
        assert_eq!(codigo, 400, "comando en la lista negra: {cuerpo}");
        assert!(cuerpo.contains("\"error\""));

        let (codigo, _) =
            pedir(addr, "POST", "/api/esto_no_existe", Some(&est.token), "{}").await;
        assert_eq!(codigo, 400);

        detener(&db, &srv).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn salud_con_token_correcto_da_200_con_protocolo_1() {
        let (path, db) = db_de_prueba("salud");
        let srv = ServidorState::default();
        let est = iniciar(db.clone(), &srv, 0).await.unwrap();
        let addr: std::net::SocketAddr =
            format!("{}:{}", est.direcciones[0], est.puerto).parse().unwrap();

        let (codigo, cuerpo) = pedir(addr, "GET", "/api/salud", Some(&est.token), "").await;
        assert_eq!(codigo, 200, "{cuerpo}");
        let json: serde_json::Value = serde_json::from_str(&cuerpo).unwrap();
        assert_eq!(json["ok"]["protocolo"], 1);
        assert_eq!(json["ok"]["lotes"], 0);
        assert!(json["ok"]["version"].is_string());

        detener(&db, &srv).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn iniciar_dos_veces_no_cambia_el_puerto_ni_rompe_nada() {
        let (path, db) = db_de_prueba("doble-inicio");
        let srv = ServidorState::default();
        let primero = iniciar(db.clone(), &srv, 0).await.unwrap();
        let segundo = iniciar(db.clone(), &srv, 0).await.unwrap();
        assert_eq!(primero.puerto, segundo.puerto);
        assert_eq!(primero.token, segundo.token);
        assert_eq!(primero.direcciones, segundo.direcciones);

        detener(&db, &srv).unwrap();
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn detener_sin_haber_iniciado_no_falla() {
        let (path, db) = db_de_prueba("apagar-en-frio");
        let srv = ServidorState::default();
        let est = detener(&db, &srv).unwrap();
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
        let est = iniciar(db.clone(), &srv, 0).await.unwrap();
        let addr: std::net::SocketAddr =
            format!("{}:{}", est.direcciones[0], est.puerto).parse().unwrap();

        let cuerpo = format!("{{\"connectionId\": {conn_id}}}");
        let (codigo, resp) = pedir(addr, "POST", "/api/lotes", Some(&est.token), &cuerpo).await;
        assert_eq!(codigo, 200, "{resp}");
        let json: serde_json::Value = serde_json::from_str(&resp).unwrap();
        let lotes = json["ok"].as_array().unwrap();
        assert_eq!(lotes.len(), 1);
        assert_eq!(lotes[0]["etiqueta"], "lote de prueba");

        detener(&db, &srv).unwrap();
        let _ = std::fs::remove_file(&path);
    }
}

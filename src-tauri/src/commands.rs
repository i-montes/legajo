use legajo_core::census::{self, ProgresoCenso};
use legajo_core::db::{
    AristaGrafo, ConnectionRow, EntradaLexico, FilaAnotable, LoteRow, Mencion,
    NodoGrafo, RelacionFila, ResumenGrafo,
};
use legajo_core::{alcance, calibracion, extraccion};
use legajo_core::perfil::{self, Hallazgo, PerfilArchivo};
use legajo_core::{contenido, discover, Auth, Db, Discovery, Error, Http, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub http: Http,
    pub db: Arc<Db>,
    /// Último descubrimiento por origen, para guardar la conexión sin repetir
    /// todo el sondeo ni hacer que el frontend nos devuelva los datos.
    pub discoveries: Mutex<HashMap<String, Discovery>>,
    pub censo_corriendo: Arc<AtomicBool>,
    pub censo_cancelar: Arc<AtomicBool>,
    pub extrayendo: Arc<AtomicBool>,
    pub extraccion_cancelar: Arc<AtomicBool>,
}

/// Corre trabajo bloqueante fuera del hilo principal.
///
/// En Tauri un comando síncrono se ejecuta en el hilo de la interfaz. Una
/// consulta de siete segundos sobre un archivo grande congelaba la ventana, y
/// como durante ese rato la app deja de atender el socket X, el servidor
/// gráfico acababa matándola con un «Broken pipe» que parecía un fallo del
/// entorno. Todo lo que toca SQLite pasa por aquí.
async fn en_hilo<T, F>(f: F) -> Result<T>
where
    F: FnOnce() -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Other(format!("la consulta no terminó: {e}")))?
}

// ── Conexión ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn discover_site(state: State<'_, AppState>, input: String) -> Result<Discovery> {
    let found = discover(&state.http, &input).await?;
    {
        let mut cache = state.discoveries.lock().unwrap();
        cache.insert(found.resolved_origin.clone(), found.clone());
    }
    Ok(found)
}

#[tauri::command]
pub fn save_connection(state: State<'_, AppState>, resolved_origin: String, label: String) -> Result<i64> {
    let cache = state.discoveries.lock().unwrap();
    let d = cache.get(&resolved_origin).ok_or_else(|| {
        Error::Other("No hay un descubrimiento reciente para ese sitio. Vuelve a conectar.".into())
    })?;
    let label = if label.trim().is_empty() {
        d.site_name.clone().unwrap_or_else(|| d.resolved_origin.clone())
    } else {
        label.trim().to_string()
    };
    state.db.upsert_connection(
        &label,
        &d.resolved_origin,
        &serde_json::to_string(&d.transport)?,
        &d.transport_label,
        d.site_name.as_deref(),
        d.capabilities.total_posts.map(|t| t as i64),
        &serde_json::to_string(d)?,
    )
}

#[tauri::command]
pub async fn list_connections(state: State<'_, AppState>) -> Result<Vec<ConnectionRow>> {
    let db = state.db.clone();
    en_hilo(move || db.list_connections()).await
}

#[tauri::command]
pub fn delete_connection(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.db.delete_connection(id)
}

// ── Sesión ───────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct SesionRecuperada {
    pub connection_id: Option<i64>,
    pub paso: String,
    pub progreso: i64,
    pub taxonomia: Option<String>,
    pub lote_id: Option<i64>,
    pub etiqueta: Option<String>,
    /// El descubrimiento tal cual se guardó, para reabrir sin volver a sondear.
    pub sitio: Option<Discovery>,
}

#[tauri::command]
pub async fn guardar_sesion(
    state: State<'_, AppState>,
    connection_id: Option<i64>,
    paso: String,
    progreso: i64,
    taxonomia: Option<String>,
    lote_id: Option<i64>,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || {
        db.guardar_sesion(connection_id, &paso, progreso, taxonomia.as_deref(), lote_id)
    })
    .await
}

#[tauri::command]
pub async fn cargar_sesion(state: State<'_, AppState>) -> Result<Option<SesionRecuperada>> {
    let db = state.db.clone();
    let s = en_hilo(move || db.cargar_sesion()).await?;
    Ok(s.map(|s| {
        // Un descubrimiento ilegible —por un cambio de formato entre versiones—
        // no puede impedir volver a entrar: se pierde el atajo, no la sesión.
        let sitio = s
            .discovery_json
            .as_deref()
            .and_then(|j| serde_json::from_str::<Discovery>(j).ok());
        SesionRecuperada {
            connection_id: s.connection_id,
            paso: s.paso,
            progreso: s.progreso,
            taxonomia: s.taxonomia,
            lote_id: s.lote_id,
            etiqueta: s.etiqueta,
            sitio,
        }
    }))
}

#[tauri::command]
pub async fn olvidar_sesion(state: State<'_, AppState>) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.olvidar_sesion()).await
}

/// Índice del primer artículo sin cerrar dentro de la muestra.
#[tauri::command]
pub async fn reanudar_anotacion(state: State<'_, AppState>, lote_id: i64) -> Result<Option<i64>> {
    let db = state.db.clone();
    en_hilo(move || db.siguiente_sin_cerrar(lote_id)).await
}

// ── Censo ────────────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct FinCenso {
    pub ok: bool,
    pub cancelado: bool,
    pub error: Option<String>,
    pub filas: i64,
}

/// Lanza el censo en segundo plano y devuelve el control de inmediato.
///
/// El recorrido dura minutos: bloquear la llamada dejaría la ventana congelada.
/// El avance viaja por eventos `censo:progreso`, y el final por `censo:fin`.
#[tauri::command]
pub fn iniciar_censo(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: i64,
    taxonomias: Vec<String>,
    reiniciar: bool,
) -> Result<()> {
    if state.censo_corriendo.swap(true, Ordering::SeqCst) {
        return Err(Error::Other("Ya hay un censo en marcha.".into()));
    }
    state.censo_cancelar.store(false, Ordering::SeqCst);

    let http = state.http.clone();
    let db = state.db.clone();
    let corriendo = state.censo_corriendo.clone();
    let cancelar = state.censo_cancelar.clone();

    tauri::async_runtime::spawn(async move {
        let r = censar(&app, &http, &db, connection_id, &taxonomias, reiniciar, &cancelar).await;
        corriendo.store(false, Ordering::SeqCst);

        let cancelado = cancelar.load(Ordering::SeqCst);
        let fin = match r {
            Ok(filas) => FinCenso { ok: !cancelado, cancelado, error: None, filas },
            Err(e) => FinCenso { ok: false, cancelado, error: Some(e.to_string()), filas: 0 },
        };
        let _ = app.emit("censo:fin", fin);
    });

    Ok(())
}

#[tauri::command]
pub fn cancelar_censo(state: State<'_, AppState>) {
    state.censo_cancelar.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn censo_corriendo(state: State<'_, AppState>) -> bool {
    state.censo_corriendo.load(Ordering::SeqCst)
}

async fn censar(
    app: &AppHandle,
    http: &Http,
    db: &Db,
    conn_id: i64,
    taxonomias: &[String],
    reiniciar: bool,
    cancelar: &AtomicBool,
) -> Result<i64> {
    let transporte = db.transporte(conn_id)?;
    let auth = Auth::None;

    if reiniciar {
        db.limpiar_censo(conn_id)?;
    }

    let avisar = |fase: &str, ventana: &str, hechos: u64, total: u64| {
        let _ = app.emit(
            "censo:progreso",
            ProgresoCenso { fase: fase.into(), ventana: ventana.into(), hechos, total },
        );
    };

    // 1 · Nombres de los términos.
    avisar("terminos", "", 0, 0);
    let terminos = census::sincronizar_terminos(http, &transporte, &auth, taxonomias).await?;
    db.guardar_terminos(conn_id, &terminos.items)?;
    for (tax, n) in &terminos.omitidas {
        let _ = app.emit(
            "censo:aviso",
            format!(
                "La taxonomía «{tax}» tiene {n} términos: demasiados para estratificar, así que no se descargaron sus nombres."
            ),
        );
    }

    // 2 · Recorrido por ventanas mensuales.
    let (desde, hasta) = census::rango_real(http, &transporte, &auth).await?;
    let ventanas = census::ventanas_mensuales(desde, hasta);
    let hechas = db.ventanas_hechas(conn_id)?;
    let total = ventanas.len() as u64;

    let mut filas_totales = 0i64;
    let mut fallidas: Vec<String> = Vec::new();

    for (i, v) in ventanas.iter().enumerate() {
        if cancelar.load(Ordering::SeqCst) {
            return Ok(filas_totales);
        }
        if hechas.contains(&v.etiqueta) {
            avisar("censo", &v.etiqueta, i as u64 + 1, total);
            continue;
        }

        // Un tramo que falla no puede tumbar el recorrido entero: se anota y se
        // sigue. La ventana no se marca como hecha, así que reanudar la reintenta.
        match census::censar_ventana(http, &transporte, &auth, v, taxonomias).await {
            Ok(lote) => {
                filas_totales += lote.filas.len() as i64;
                db.guardar_censo(conn_id, &lote.filas)?;
                db.guardar_anomalias(conn_id, &lote.anomalias)?;
                db.marcar_ventana(conn_id, &v.etiqueta, lote.filas.len())?;
            }
            Err(e) => {
                fallidas.push(v.etiqueta.clone());
                let _ = app.emit(
                    "censo:aviso",
                    format!("El tramo {} no se pudo leer ({e}). Se reintentará al reanudar.", v.etiqueta),
                );
            }
        }
        avisar("censo", &v.etiqueta, i as u64 + 1, total);
    }

    if !fallidas.is_empty() {
        let _ = app.emit(
            "censo:aviso",
            format!(
                "Quedaron {} tramos sin leer: {}{}. Vuelve a lanzar el censo para recogerlos.",
                fallidas.len(),
                fallidas.iter().take(6).cloned().collect::<Vec<_>>().join(", "),
                if fallidas.len() > 6 { "…" } else { "" }
            ),
        );
    }

    // 3 · Sondeo de contenido sobre una submuestra reproducible.
    //     Lo que depende del cuerpo del artículo no puede salir del censo, y
    //     bajar 48.000 cuerpos para estimarlo sería absurdo.
    let ids = db.ids_para_sondeo(conn_id, 300, 20260905)?;
    if !ids.is_empty() && !cancelar.load(Ordering::SeqCst) {
        let n = ids.len() as u64;
        let mut hechos = 0u64;
        for trozo in ids.chunks(50) {
            if cancelar.load(Ordering::SeqCst) { break; }
            let cuerpos = census::traer_contenido(http, &transporte, &auth, trozo).await?;
            let limpios: Vec<(i64, contenido::Limpio)> = cuerpos
                .into_iter()
                .map(|(id, html)| (id, contenido::limpiar(&html)))
                .collect();
            db.guardar_sondeo(conn_id, &limpios)?;
            hechos += trozo.len() as u64;
            avisar("sondeo", "contenido", hechos, n);
        }
    }

    Ok(filas_totales)
}

#[tauri::command]
pub async fn perfil_archivo(
    state: State<'_, AppState>,
    connection_id: i64,
    taxonomia: Option<String>,
) -> Result<PerfilArchivo> {
    let db = state.db.clone();
    en_hilo(move || {
        // Bases censadas antes de que existiera census_terms se rellenan una
        // sola vez; después esto es una comprobación de dos consultas.
        db.rellenar_terminos_censo(connection_id)?;
        perfil::perfil(&db, connection_id, taxonomia.as_deref())
    })
    .await
}

// ── Los artículos del lote ───────────────────────────────────────────────

#[tauri::command]
pub async fn muestra(state: State<'_, AppState>, lote_id: i64) -> Result<Vec<FilaAnotable>> {
    let db = state.db.clone();
    en_hilo(move || db.muestra(lote_id)).await
}

// ── Anotación ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn guardar_anotacion(
    state: State<'_, AppState>,
    lote_id: i64,
    wp_id: i64,
    menciones: Vec<Mencion>,
    relaciones: Vec<RelacionFila>,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.guardar_anotacion(lote_id, wp_id, &menciones, &relaciones)).await
}

/// Lo que la pantalla de revisión tiene que pintar para un artículo.
///
/// Si la persona ya lo tocó, se le devuelve su trabajo tal cual. Si no, se le
/// sirve lo que propuso el modelo, ya filtrado por la calibración vigente: es la
/// diferencia entre corregir y empezar de cero, y es la razón de que revisar
/// unas decenas de artículos sea un rato y no una semana.
#[tauri::command]
pub async fn anotacion(
    state: State<'_, AppState>,
    lote_id: i64,
    wp_id: i64,
) -> Result<(Vec<Mencion>, Vec<RelacionFila>)> {
    let db = state.db.clone();
    en_hilo(move || {
        let (menciones, relaciones) = db.anotacion(lote_id, wp_id)?;
        if menciones.is_empty() && relaciones.is_empty() {
            return db.propuestas(lote_id, wp_id);
        }
        Ok((menciones, relaciones))
    })
    .await
}

/// Cierra un artículo: guarda el tiempo real que costó anotarlo.
///
/// Es la medida que justifica la fase entera. Se guarda por artículo y no en
/// agregado para poder mirar después la mediana y la curva de aprendizaje por
/// separado: proyectar desde los primeros artículos sobreestima el coste,
/// a veces al doble.
#[tauri::command]
pub async fn cerrar_articulo(
    state: State<'_, AppState>,
    lote_id: i64,
    wp_id: i64,
    segundos: i64,
    menciones: i64,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.registrar_tiempo(lote_id, wp_id, segundos, menciones, true)).await
}

/// Guardado periódico del cronómetro mientras se anota.
///
/// No marca el artículo como terminado: solo deja constancia de los minutos ya
/// invertidos, para que cerrar la ventana a mitad no los borre.
#[tauri::command]
pub async fn apuntar_tiempo(
    state: State<'_, AppState>,
    lote_id: i64,
    wp_id: i64,
    segundos: i64,
    menciones: i64,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.registrar_tiempo(lote_id, wp_id, segundos, menciones, false)).await
}

#[tauri::command]
pub async fn tiempo_articulo(state: State<'_, AppState>, lote_id: i64, wp_id: i64) -> Result<i64> {
    let db = state.db.clone();
    en_hilo(move || db.tiempo_de(lote_id, wp_id)).await
}

/// Lo anotado hasta ahora, para pre-marcar los artículos siguientes.
#[tauri::command]
pub async fn lexico(state: State<'_, AppState>, lote_id: i64) -> Result<Vec<EntradaLexico>> {
    let db = state.db.clone();
    en_hilo(move || db.lexico(lote_id)).await
}

#[tauri::command]
pub async fn descartar_tiempo(state: State<'_, AppState>, lote_id: i64, wp_id: i64) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.descartar_tiempo(lote_id, wp_id)).await
}

#[tauri::command]
pub async fn tiempos_dudosos(
    state: State<'_, AppState>,
    lote_id: i64,
) -> Result<Vec<(i64, i64, i64, String)>> {
    let db = state.db.clone();
    en_hilo(move || db.tiempos_dudosos(lote_id)).await
}

#[tauri::command]
pub async fn avance_anotacion(state: State<'_, AppState>, lote_id: i64) -> Result<(i64, i64)> {
    let db = state.db.clone();
    en_hilo(move || db.avance_anotacion(lote_id)).await
}

// ── Alcance ──────────────────────────────────────────────────────────────

/// Árbol de categorías › subcategorías con sus conteos reales.
#[tauri::command]
pub async fn arbol_categorias(
    state: State<'_, AppState>, connection_id: i64, taxonomia: String,
) -> Result<alcance::Arbol> {
    let db = state.db.clone();
    en_hilo(move || alcance::arbol(&db, connection_id, &taxonomia)).await
}

#[derive(Serialize)]
pub struct Estimacion {
    pub articulos: i64,
    pub terminos_expandidos: Vec<i64>,
    /// Segundos de cómputo, a la velocidad medida en el sondeo.
    pub segundos_cpu: f64,
    /// Los que aún no tienen el cuerpo descargado.
    pub por_descargar: i64,
}

/// Cuántos artículos caen en un alcance y cuánto costaría procesarlos.
#[tauri::command]
pub async fn estimar_alcance(
    state: State<'_, AppState>,
    connection_id: i64,
    mut alcance_sel: alcance::Alcance,
) -> Result<Estimacion> {
    let db = state.db.clone();
    en_hilo(move || {
        // Elegir un padre arrastra sus hijos: en WordPress un artículo regional
        // no siempre lleva también la categoría madre.
        let expandidos = alcance::expandir(
            &db, connection_id, &alcance_sel.taxonomia, &alcance_sel.terminos)?;
        alcance_sel.terminos = expandidos.clone();
        let n = alcance::contar(&db, connection_id, &alcance_sel)?;
        Ok(Estimacion {
            articulos: n,
            terminos_expandidos: expandidos,
            // 1,9 s por artículo con relaciones, medido en el sondeo.
            segundos_cpu: n as f64 * 1.9,
            por_descargar: n,
        })
    })
    .await
}

#[tauri::command]
pub async fn crear_lote(
    state: State<'_, AppState>,
    connection_id: i64,
    etiqueta: String,
    mut alcance_sel: alcance::Alcance,
    n_calibrar: i64,
) -> Result<i64> {
    let db = state.db.clone();
    en_hilo(move || {
        alcance_sel.terminos = alcance::expandir(
            &db, connection_id, &alcance_sel.taxonomia, &alcance_sel.terminos)?;
        alcance::crear_lote(&db, connection_id, &etiqueta, &alcance_sel, n_calibrar)
    })
    .await
}

#[tauri::command]
pub async fn lotes(state: State<'_, AppState>, connection_id: i64) -> Result<Vec<LoteRow>> {
    let db = state.db.clone();
    en_hilo(move || db.lotes(connection_id)).await
}

/// El catálogo, con cada modelo marcado según esté ya en la máquina o no.
///
/// Se consulta el disco antes de dejar elegir. Ofrecer tres tamaños de spaCy
/// cuando solo hay uno instalado convierte la elección en una trampa: se escoge
/// el grande, se espera, y lo que llega es un error de Python a mitad de la
/// extracción. Eso le pasó a alguien de verdad.
#[tauri::command]
pub async fn catalogo_modelos(app: AppHandle) -> Result<serde_json::Value> {
    let recursos = app.path().resource_dir().ok();
    let est = extraccion::estado_modelos(recursos.as_deref())
        .await
        .unwrap_or_default();
    Ok(extraccion::catalogo_con_estado(&est))
}

#[derive(Clone, Serialize)]
pub struct ProgresoModelo {
    pub evento: String,
    pub modelo: String,
    pub tamano: String,
}

/// Baja lo que le falte a esta combinación de modelos.
///
/// Devuelve cuántos bajó. Es lo único del programa que sale a la red por su
/// cuenta, y solo trae pesos de repositorios públicos: ningún texto del archivo
/// se envía a ninguna parte.
#[tauri::command]
pub async fn preparar_modelos(
    app: AppHandle,
    modelos: extraccion::Modelos,
) -> Result<usize> {
    let recursos = app.path().resource_dir().ok();
    let est = extraccion::estado_modelos(recursos.as_deref()).await?;
    let pendientes = extraccion::faltan(&est, &modelos);
    let n = pendientes.len();

    let app2 = app.clone();
    extraccion::preparar(recursos.as_deref(), &pendientes, move |evento, modelo, tamano| {
        let _ = app2.emit("modelos:progreso", ProgresoModelo {
            evento: evento.into(), modelo: modelo.into(), tamano: tamano.into(),
        });
    })
    .await?;
    Ok(n)
}

/// Qué le falta a esta combinación, sin bajar nada.
#[tauri::command]
pub async fn modelos_pendientes(
    app: AppHandle,
    modelos: extraccion::Modelos,
) -> Result<Vec<String>> {
    let recursos = app.path().resource_dir().ok();
    let est = extraccion::estado_modelos(recursos.as_deref()).await?;
    Ok(extraccion::faltan(&est, &modelos))
}

// ── Extracción ───────────────────────────────────────────────────────────

/// Lanza la extracción sobre un lote.
///
/// `solo_calibracion` limita al puñado de artículos que la persona va a revisar
/// antes de soltar el extractor sobre el resto: es la etapa de corrección que
/// evita descubrir a las cinco horas que el modelo estaba etiquetando mal.
#[tauri::command]
pub fn iniciar_extraccion(
    app: AppHandle,
    state: State<'_, AppState>,
    lote_id: i64,
    modelos: Option<extraccion::Modelos>,
    solo_calibracion: bool,
) -> Result<()> {
    if state.extrayendo.swap(true, Ordering::SeqCst) {
        return Err(Error::Other("Ya hay una extracción en marcha.".into()));
    }
    state.extraccion_cancelar.store(false, Ordering::SeqCst);

    let http = state.http.clone();
    let db = state.db.clone();
    let corriendo = state.extrayendo.clone();
    let cancelar = state.extraccion_cancelar.clone();
    let modelos = modelos.unwrap_or_default();
    let recursos = app.path().resource_dir().ok();

    tauri::async_runtime::spawn(async move {
        let r = extraer(&app, &http, &db, lote_id, &modelos, solo_calibracion,
                        recursos.as_deref(), &cancelar).await;
        corriendo.store(false, Ordering::SeqCst);
        let cancelado = cancelar.load(Ordering::SeqCst);
        let fin = match r {
            Ok(n) => FinCenso { ok: !cancelado, cancelado, error: None, filas: n },
            Err(e) => FinCenso { ok: false, cancelado, error: Some(e.to_string()), filas: 0 },
        };
        let _ = app.emit("extraccion:fin", fin);
    });
    Ok(())
}

#[tauri::command]
pub fn cancelar_extraccion(state: State<'_, AppState>) {
    state.extraccion_cancelar.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn extrayendo(state: State<'_, AppState>) -> bool {
    state.extrayendo.load(Ordering::SeqCst)
}

#[tauri::command]
pub async fn avance_extraccion(state: State<'_, AppState>, lote_id: i64) -> Result<(i64, i64)> {
    let db = state.db.clone();
    en_hilo(move || db.avance_extraccion(lote_id)).await
}

#[derive(Clone, Serialize)]
pub struct ProgresoExtraccion {
    pub fase: String,
    pub hechos: u64,
    pub total: u64,
    pub wp_id: i64,
    pub entidades: i64,
    pub relaciones: i64,
    /// Milisegundos por artículo, medidos: dice si esto es viable sobre un
    /// archivo entero o no.
    pub ms: u64,
    pub detalle: String,
}

#[allow(clippy::too_many_arguments)]
async fn extraer(
    app: &AppHandle,
    http: &Http,
    db: &Db,
    lote_id: i64,
    modelos: &extraccion::Modelos,
    solo_calibracion: bool,
    recursos: Option<&std::path::Path>,
    cancelar: &AtomicBool,
) -> Result<i64> {
    let avisar = |fase: &str, hechos: u64, total: u64, wp: i64, ents: i64, rels: i64, ms: u64, detalle: &str| {
        let _ = app.emit(
            "extraccion:progreso",
            ProgresoExtraccion {
                fase: fase.into(), hechos, total, wp_id: wp,
                entidades: ents, relaciones: rels, ms, detalle: detalle.into(),
            },
        );
    };

    let conn_id = db.conexion_de_lote(lote_id)?;

    // 1 · Lo que falte por descargar. El censo solo trajo metadatos.
    let faltan = db.lote_sin_contenido(lote_id, solo_calibracion)?;
    if !faltan.is_empty() {
        let transporte = db.transporte(conn_id)?;
        let total = faltan.len() as u64;
        let mut hechos = 0u64;
        avisar("descargando", 0, total, 0, 0, 0, 0, "");
        for trozo in faltan.chunks(50) {
            if cancelar.load(Ordering::SeqCst) { return Ok(0); }
            let cuerpos = census::traer_contenido(http, &transporte, &Auth::None, trozo).await?;
            let filas: Vec<(i64, String, contenido::Limpio)> = cuerpos
                .into_iter()
                .map(|(id, html)| { let l = contenido::limpiar(&html); (id, html, l) })
                .collect();
            db.guardar_articulos(conn_id, &filas)?;
            hechos += trozo.len() as u64;
            avisar("descargando", hechos, total, 0, 0, 0, 0, "");
        }
    }

    // 2 · El extractor.
    let (python, guion) = extraccion::localizar(recursos)?;
    avisar("arrancando", 0, 0, 0, 0, 0, 0, &python.display().to_string());
    let mut sc = extraccion::Sidecar::iniciar(&python, &guion).await?;

    avisar("cargando", 0, 0, 0, 0, 0, 0, &modelos.gliner);
    let ms_carga = sc.cargar(modelos).await?;
    let nota = if sc.glirel_activo { "" } else { "sin relaciones: GLiREL no cargó" };
    avisar("cargado", 0, 0, 0, 0, 0, ms_carga, nota);

    // 3 · El recorrido. Los umbrales de la calibración, si ya la hubo.
    let cal = db.calibracion(lote_id)?.unwrap_or_default();
    let predicados: Vec<String> = if modelos.relaciones {
        legajo_core::extraccion::predicados_modelo()
    } else {
        vec![]
    };

    let pendientes = db.pendientes_extraccion_lote(lote_id, solo_calibracion)?;
    let total = pendientes.len() as u64;
    let mut hechos = 0u64;
    let mut entidades = 0i64;

    for (wp_id, texto) in pendientes {
        if cancelar.load(Ordering::SeqCst) { break; }
        let parrafos: Vec<String> = texto
            .split("\n\n")
            .filter(|p| !p.trim().is_empty())
            .map(String::from)
            .collect();

        match sc.procesar(wp_id, &parrafos, &cal.umbrales, &predicados, 0.4).await {
            Ok((ents, rels, ms)) => {
                let n = db.guardar_extraidas(lote_id, wp_id, &ents)?;
                let nr = db.guardar_relaciones_extraidas(lote_id, wp_id, &rels)?;
                entidades += n;
                hechos += 1;
                avisar("extrayendo", hechos, total, wp_id, n, nr, ms, "");
            }
            Err(e) => {
                // Un artículo que falla no puede tumbar la corrida.
                hechos += 1;
                avisar("extrayendo", hechos, total, wp_id, 0, 0, 0, &e.to_string());
            }
        }
    }

    sc.cerrar().await;
    Ok(entidades)
}

// ── Grafo ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn grafo_resumen(state: State<'_, AppState>, lote_id: i64) -> Result<ResumenGrafo> {
    let db = state.db.clone();
    en_hilo(move || db.grafo_resumen(lote_id)).await
}

#[tauri::command]
pub async fn grafo_entidades(
    state: State<'_, AppState>, lote_id: i64, limite: i64,
) -> Result<Vec<NodoGrafo>> {
    let db = state.db.clone();
    en_hilo(move || db.grafo_entidades(lote_id, limite)).await
}

/// Descripciones que señalan a alguien sin nombrarlo, con quién ocupaba esa
/// plaza por esas fechas.
#[tauri::command]
pub async fn grafo_sin_nombrar(
    state: State<'_, AppState>,
    lote_id: i64,
) -> Result<Vec<legajo_core::db::SinNombrar>> {
    let db = state.db.clone();
    en_hilo(move || db.grafo_sin_nombrar(lote_id, 100)).await
}

/// Nombres distintos que probablemente son la misma entidad.
///
/// El grafo funde lo que la persona declaró igual con `=`, y nada más: no
/// adivina. Decir cuáles quedaron sueltos es la diferencia entre un grafo con
/// una limitación conocida y uno con un error escondido.
#[tauri::command]
pub async fn grafo_duplicados(
    state: State<'_, AppState>,
    lote_id: i64,
) -> Result<Vec<legajo_core::resolucion::Caso>> {
    let db = state.db.clone();
    en_hilo(move || legajo_core::resolucion::casos(&db, lote_id)).await
}

#[tauri::command]
pub async fn grafo_relaciones(
    state: State<'_, AppState>, lote_id: i64, limite: i64,
) -> Result<Vec<AristaGrafo>> {
    let db = state.db.clone();
    en_hilo(move || db.grafo_relaciones(lote_id, limite)).await
}

// ── Calibración ──────────────────────────────────────────────────────────

/// Calcula qué habría que cambiar en el extractor a partir de las correcciones.
#[tauri::command]
pub async fn calibrar(state: State<'_, AppState>, lote_id: i64) -> Result<calibracion::Resultado> {
    let db = state.db.clone();
    en_hilo(move || calibracion::calibrar(&db, lote_id)).await
}

/// Fija la calibración calculada para las siguientes extracciones del lote.
#[tauri::command]
pub async fn aplicar_calibracion(
    state: State<'_, AppState>, lote_id: i64, cal: calibracion::Calibracion,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.guardar_calibracion(lote_id, &cal)).await
}

#[tauri::command]
pub async fn calibracion_guardada(
    state: State<'_, AppState>, lote_id: i64,
) -> Result<Option<calibracion::Calibracion>> {
    let db = state.db.clone();
    en_hilo(move || db.calibracion(lote_id)).await
}

// ── Resolución y reporte ─────────────────────────────────────────────────

#[tauri::command]
pub async fn hallazgos_archivo(state: State<'_, AppState>, connection_id: i64) -> Result<Vec<Hallazgo>> {
    let db = state.db.clone();
    en_hilo(move || perfil::hallazgos(&db, connection_id)).await
}

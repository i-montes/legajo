use legajo_core::census::{self, ProgresoCenso};
use legajo_core::db::{ConnectionRow, EntradaLexico, FilaAnotable, Mencion, RelacionFila};
use legajo_core::{evaluacion, extraccion, muestreo, reporte, resolucion};
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
    pub design_id: Option<i64>,
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
    design_id: Option<i64>,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || {
        db.guardar_sesion(connection_id, &paso, progreso, taxonomia.as_deref(), design_id)
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
            design_id: s.design_id,
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
pub async fn reanudar_anotacion(state: State<'_, AppState>, design_id: i64) -> Result<Option<i64>> {
    let db = state.db.clone();
    en_hilo(move || db.siguiente_sin_cerrar(design_id)).await
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

// ── Muestra ──────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct EpocasPropuestas {
    pub epocas: Vec<legajo_core::muestreo::Epoca>,
}

/// Épocas sugeridas a partir del reparto real por año del archivo.
#[tauri::command]
pub async fn proponer_epocas(
    state: State<'_, AppState>,
    connection_id: i64,
    cuantas: usize,
) -> Result<EpocasPropuestas> {
    let db = state.db.clone();
    en_hilo(move || {
        let p = perfil::perfil(&db, connection_id, None)?;
        Ok(EpocasPropuestas { epocas: muestreo::proponer_epocas(&p.por_anio, cuantas) })
    })
    .await
}

#[tauri::command]
pub async fn plan_muestra(
    state: State<'_, AppState>,
    connection_id: i64,
    diseno: muestreo::Diseno,
) -> Result<muestreo::Plan> {
    let db = state.db.clone();
    en_hilo(move || muestreo::plan(&db, connection_id, &diseno)).await
}

#[derive(Serialize)]
pub struct MuestraSorteada {
    pub design_id: i64,
    pub n: usize,
}

#[tauri::command]
pub async fn sortear_muestra(
    state: State<'_, AppState>,
    connection_id: i64,
    diseno: muestreo::Diseno,
    etiqueta: String,
) -> Result<MuestraSorteada> {
    let db = state.db.clone();
    en_hilo(move || {
        let plan = muestreo::plan(&db, connection_id, &diseno)?;
        let filas = muestreo::sortear(&db, connection_id, &diseno, &plan)?;
        let design_id = db.guardar_muestra(connection_id, &etiqueta, &diseno, &filas)?;
        Ok(MuestraSorteada { design_id, n: filas.len() })
    })
    .await
}

#[tauri::command]
pub async fn muestra_actual(state: State<'_, AppState>, connection_id: i64) -> Result<Option<(i64, i64)>> {
    let db = state.db.clone();
    en_hilo(move || Ok(db.ultimo_diseno(connection_id)?.map(|(id, _, n)| (id, n)))).await
}

#[tauri::command]
pub async fn muestra(state: State<'_, AppState>, design_id: i64) -> Result<Vec<FilaAnotable>> {
    let db = state.db.clone();
    en_hilo(move || db.muestra(design_id)).await
}

/// Descarga el cuerpo de los artículos de la muestra.
///
/// Es el único momento en que Legajo baja contenido completo, y solo de los
/// cientos que caen en la muestra: el archivo entero se recorrió leyendo
/// metadatos.
#[tauri::command]
pub fn descargar_muestra(
    app: AppHandle,
    state: State<'_, AppState>,
    connection_id: i64,
    design_id: i64,
) -> Result<()> {
    if state.censo_corriendo.swap(true, Ordering::SeqCst) {
        return Err(Error::Other("Hay otra descarga en marcha.".into()));
    }
    state.censo_cancelar.store(false, Ordering::SeqCst);

    let http = state.http.clone();
    let db = state.db.clone();
    let corriendo = state.censo_corriendo.clone();
    let cancelar = state.censo_cancelar.clone();

    tauri::async_runtime::spawn(async move {
        let r = bajar_muestra(&app, &http, &db, connection_id, design_id, &cancelar).await;
        corriendo.store(false, Ordering::SeqCst);
        let cancelado = cancelar.load(Ordering::SeqCst);
        let fin = match r {
            Ok(n) => FinCenso { ok: !cancelado, cancelado, error: None, filas: n },
            Err(e) => FinCenso { ok: false, cancelado, error: Some(e.to_string()), filas: 0 },
        };
        let _ = app.emit("muestra:fin", fin);
    });
    Ok(())
}

async fn bajar_muestra(
    app: &AppHandle,
    http: &Http,
    db: &Db,
    conn_id: i64,
    design_id: i64,
    cancelar: &AtomicBool,
) -> Result<i64> {
    let transporte = db.transporte(conn_id)?;
    let pendientes = db.muestra_sin_contenido(design_id)?;
    let total = pendientes.len() as u64;
    let mut hechos = 0u64;

    for trozo in pendientes.chunks(50) {
        if cancelar.load(Ordering::SeqCst) { break; }
        let cuerpos = census::traer_contenido(http, &transporte, &Auth::None, trozo).await?;
        let filas: Vec<(i64, String, contenido::Limpio)> = cuerpos
            .into_iter()
            .map(|(id, html)| { let l = contenido::limpiar(&html); (id, html, l) })
            .collect();
        db.guardar_articulos(conn_id, &filas)?;
        hechos += trozo.len() as u64;
        let _ = app.emit(
            "muestra:progreso",
            ProgresoCenso { fase: "descarga".into(), ventana: String::new(), hechos, total },
        );
    }
    Ok(hechos as i64)
}

// ── Anotación ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn guardar_anotacion(
    state: State<'_, AppState>,
    design_id: i64,
    wp_id: i64,
    menciones: Vec<Mencion>,
    relaciones: Vec<RelacionFila>,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.guardar_anotacion(design_id, wp_id, &menciones, &relaciones)).await
}

#[tauri::command]
pub async fn anotacion(
    state: State<'_, AppState>,
    design_id: i64,
    wp_id: i64,
) -> Result<(Vec<Mencion>, Vec<RelacionFila>)> {
    let db = state.db.clone();
    en_hilo(move || db.anotacion(design_id, wp_id)).await
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
    design_id: i64,
    wp_id: i64,
    segundos: i64,
    menciones: i64,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.registrar_tiempo(design_id, wp_id, segundos, menciones, true)).await
}

/// Guardado periódico del cronómetro mientras se anota.
///
/// No marca el artículo como terminado: solo deja constancia de los minutos ya
/// invertidos, para que cerrar la ventana a mitad no los borre.
#[tauri::command]
pub async fn apuntar_tiempo(
    state: State<'_, AppState>,
    design_id: i64,
    wp_id: i64,
    segundos: i64,
    menciones: i64,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.registrar_tiempo(design_id, wp_id, segundos, menciones, false)).await
}

#[tauri::command]
pub async fn tiempo_articulo(state: State<'_, AppState>, design_id: i64, wp_id: i64) -> Result<i64> {
    let db = state.db.clone();
    en_hilo(move || db.tiempo_de(design_id, wp_id)).await
}

/// Lo anotado hasta ahora, para pre-marcar los artículos siguientes.
#[tauri::command]
pub async fn lexico(state: State<'_, AppState>, design_id: i64) -> Result<Vec<EntradaLexico>> {
    let db = state.db.clone();
    en_hilo(move || db.lexico(design_id)).await
}

#[tauri::command]
pub async fn descartar_tiempo(state: State<'_, AppState>, design_id: i64, wp_id: i64) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.descartar_tiempo(design_id, wp_id)).await
}

#[tauri::command]
pub async fn tiempos_dudosos(
    state: State<'_, AppState>,
    design_id: i64,
) -> Result<Vec<(i64, i64, i64, String)>> {
    let db = state.db.clone();
    en_hilo(move || db.tiempos_dudosos(design_id)).await
}

#[tauri::command]
pub async fn avance_anotacion(state: State<'_, AppState>, design_id: i64) -> Result<(i64, i64)> {
    let db = state.db.clone();
    en_hilo(move || db.avance_anotacion(design_id)).await
}

// ── Extracción ───────────────────────────────────────────────────────────

/// Lanza la extracción sobre los artículos de la muestra.
///
/// El alcance es la muestra, no el archivo entero, y es deliberado: extraer
/// sobre las 84.000 piezas exigiría antes descargarlas todas, que es justo lo
/// que el censo evita. Lo que la Fase 0 necesita medir es cómo se porta el
/// modelo frente a lo que anotó una persona, y eso solo se puede medir donde
/// hay anotación. Recorrer el archivo completo es un paso de producción
/// posterior, cuando la puerta ya haya dicho que sí.
#[tauri::command]
pub fn iniciar_extraccion(
    app: AppHandle,
    state: State<'_, AppState>,
    design_id: i64,
    modelo: Option<String>,
    umbral: f64,
) -> Result<()> {
    if state.extrayendo.swap(true, Ordering::SeqCst) {
        return Err(Error::Other("Ya hay una extracción en marcha.".into()));
    }
    state.extraccion_cancelar.store(false, Ordering::SeqCst);

    let db = state.db.clone();
    let corriendo = state.extrayendo.clone();
    let cancelar = state.extraccion_cancelar.clone();
    let modelo = modelo.unwrap_or_else(|| "urchade/gliner_multi-v2.1".to_string());
    let recursos = app.path().resource_dir().ok();

    tauri::async_runtime::spawn(async move {
        let r = extraer(&app, &db, design_id, &modelo, umbral, recursos.as_deref(), &cancelar).await;
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
pub async fn avance_extraccion(state: State<'_, AppState>, design_id: i64) -> Result<(i64, i64)> {
    let db = state.db.clone();
    en_hilo(move || db.avance_extraccion(design_id)).await
}

#[derive(Clone, Serialize)]
pub struct ProgresoExtraccion {
    pub fase: String,
    pub hechos: u64,
    pub total: u64,
    pub wp_id: i64,
    pub entidades: i64,
    /// Milisegundos por artículo, medidos: es el dato que dice si esto es
    /// viable sobre un archivo entero o no.
    pub ms: u64,
    pub detalle: String,
}

async fn extraer(
    app: &AppHandle,
    db: &Db,
    design_id: i64,
    modelo: &str,
    umbral: f64,
    recursos: Option<&std::path::Path>,
    cancelar: &AtomicBool,
) -> Result<i64> {
    let avisar = |fase: &str, hechos: u64, total: u64, wp: i64, ents: i64, ms: u64, detalle: &str| {
        let _ = app.emit(
            "extraccion:progreso",
            ProgresoExtraccion {
                fase: fase.into(), hechos, total, wp_id: wp,
                entidades: ents, ms, detalle: detalle.into(),
            },
        );
    };

    let (python, guion) = extraccion::localizar(recursos)?;
    avisar("arrancando", 0, 0, 0, 0, 0, &format!("{}", python.display()));

    let mut sc = extraccion::Sidecar::iniciar(&python, &guion).await?;

    // La primera vez el modelo se descarga: son varios minutos y hay que decirlo.
    avisar("cargando", 0, 0, 0, 0, 0, modelo);
    let ms_carga = sc.cargar(modelo, "cpu").await?;
    avisar("cargado", 0, 0, 0, 0, ms_carga, modelo);

    let pendientes = db.pendientes_extraccion(design_id)?;
    let total = pendientes.len() as u64;
    let mut hechos = 0u64;
    let mut entidades = 0i64;

    for (wp_id, texto) in pendientes {
        if cancelar.load(Ordering::SeqCst) {
            break;
        }
        // Los párrafos se parten igual que en la pantalla de anotación, o las
        // posiciones no coincidirían y la evaluación mediría cualquier cosa.
        let parrafos: Vec<String> = texto
            .split("

")
            .filter(|p| !p.trim().is_empty())
            .map(String::from)
            .collect();

        match sc.extraer(wp_id, &parrafos, umbral).await {
            Ok((por_parrafo, ms)) => {
                let n = db.guardar_extraidas(design_id, wp_id, &por_parrafo)?;
                entidades += n;
                hechos += 1;
                avisar("extrayendo", hechos, total, wp_id, n, ms, "");
            }
            Err(e) => {
                // Un artículo que falla no puede tumbar la corrida.
                hechos += 1;
                avisar("extrayendo", hechos, total, wp_id, 0, 0, &e.to_string());
            }
        }
    }

    sc.cerrar().await;
    Ok(entidades)
}

#[tauri::command]
pub async fn evaluacion(state: State<'_, AppState>, design_id: i64) -> Result<evaluacion::Evaluacion> {
    let db = state.db.clone();
    en_hilo(move || evaluacion::evaluar(&db, design_id)).await
}

// ── Resolución y reporte ─────────────────────────────────────────────────

#[tauri::command]
pub async fn casos_resolucion(state: State<'_, AppState>, design_id: i64) -> Result<Vec<resolucion::Caso>> {
    let db = state.db.clone();
    en_hilo(move || resolucion::casos(&db, design_id)).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn decidir_resolucion(
    state: State<'_, AppState>,
    design_id: i64,
    clave: String,
    a: String,
    b: String,
    tipo: String,
    decision: String,
    confianza: f64,
) -> Result<()> {
    let db = state.db.clone();
    en_hilo(move || db.decidir_resolucion(design_id, &clave, &a, &b, &tipo, &decision, confianza)).await
}

#[tauri::command]
pub async fn avance_resolucion(state: State<'_, AppState>, design_id: i64) -> Result<(i64, i64)> {
    let db = state.db.clone();
    en_hilo(move || db.avance_resolucion(design_id)).await
}

#[tauri::command]
pub async fn reporte(
    state: State<'_, AppState>,
    design_id: i64,
    universo: i64,
) -> Result<reporte::Reporte> {
    let db = state.db.clone();
    en_hilo(move || reporte::reporte(&db, design_id, universo)).await
}

#[tauri::command]
pub fn puerta(
    horas_necesarias: f64,
    personas: f64,
    horas_semana: f64,
    semanas: f64,
    universo: i64,
) -> reporte::Puerta {
    reporte::puerta(horas_necesarias, personas, horas_semana, semanas, universo)
}

#[tauri::command]
pub async fn hallazgos_archivo(state: State<'_, AppState>, connection_id: i64) -> Result<Vec<Hallazgo>> {
    let db = state.db.clone();
    en_hilo(move || perfil::hallazgos(&db, connection_id)).await
}

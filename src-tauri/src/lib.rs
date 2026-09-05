mod commands;

use commands::AppState;
use legajo_core::{Db, Http};
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(AppState {
                http: Http::new()?,
                db: Arc::new(Db::open(&dir.join("legajo.sqlite"))?),
                discoveries: Default::default(),
                censo_corriendo: Default::default(),
                censo_cancelar: Default::default(),
                extrayendo: Default::default(),
                extraccion_cancelar: Default::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::discover_site,
            commands::save_connection,
            commands::list_connections,
            commands::delete_connection,
            commands::guardar_sesion,
            commands::cargar_sesion,
            commands::olvidar_sesion,
            commands::reanudar_anotacion,
            commands::iniciar_censo,
            commands::cancelar_censo,
            commands::censo_corriendo,
            commands::perfil_archivo,
            commands::hallazgos_archivo,
            commands::proponer_epocas,
            commands::plan_muestra,
            commands::sortear_muestra,
            commands::muestra_actual,
            commands::muestra,
            commands::descargar_muestra,
            commands::guardar_anotacion,
            commands::anotacion,
            commands::cerrar_articulo,
            commands::apuntar_tiempo,
            commands::tiempo_articulo,
            commands::avance_anotacion,
            commands::descartar_tiempo,
            commands::tiempos_dudosos,
            commands::lexico,
            commands::casos_resolucion,
            commands::decidir_resolucion,
            commands::avance_resolucion,
            commands::reporte,
            commands::puerta,
            commands::iniciar_extraccion,
            commands::cancelar_extraccion,
            commands::extrayendo,
            commands::avance_extraccion,
            commands::evaluacion,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Legajo");
}

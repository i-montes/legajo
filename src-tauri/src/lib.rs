mod commands;
pub mod servidor;

use commands::AppState;
use legajo_core::{Db, Http};
use servidor::ServidorState;
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut b = tauri::Builder::default().plugin(tauri_plugin_opener::init());

    // La capa de actualizacion. Va aparte y con cfg porque en movil no existe,
    // y porque asi el resto del arranque no depende de que este.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        b = b
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    b
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
            app.manage(ServidorState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::discover_site,
            commands::save_connection,
            commands::delete_connection,
            commands::conexion_guardada,
            commands::guardar_sesion,
            commands::cargar_sesion,
            commands::olvidar_sesion,
            commands::reanudar_anotacion,
            commands::paso_autorizacion,
            commands::probar_credencial,
            commands::sondear_archivo,
            commands::duenio,
            commands::olvidar_credencial,
            commands::iniciar_censo,
            commands::cancelar_censo,
            commands::censo_corriendo,
            commands::perfil_archivo,
            commands::hallazgos_archivo,
            commands::muestra,
            commands::guardar_anotacion,
            commands::anotacion,
            commands::cerrar_articulo,
            commands::apuntar_tiempo,
            commands::tiempo_articulo,
            commands::avance_anotacion,
            commands::descartar_tiempo,
            commands::tiempos_dudosos,
            commands::lexico,
            commands::arbol_categorias,
            commands::estimar_alcance,
            commands::crear_lote,
            commands::lotes,
            commands::catalogo_modelos,
            commands::preparar_modelos,
            commands::modelos_pendientes,
            commands::entorno_estado,
            commands::instalar_entorno,
            commands::grafo_resumen,
            commands::grafo_entidades,
            commands::grafo_relaciones,
            commands::grafo_duplicados,
            commands::grafo_sin_nombrar,
            commands::grafo_evidencia,
            commands::resoluciones_del_lote,
            commands::deshacer_resolucion,
            commands::decidir_par,
            commands::calibrar,
            commands::aplicar_calibracion,
            commands::calibracion_guardada,
            commands::iniciar_extraccion,
            commands::deshacer_extraccion,
            commands::cancelar_extraccion,
            commands::extrayendo,
            commands::avance_extraccion,
            commands::categorias_del_lote,
            servidor::servir_estado,
            servidor::servir_iniciar,
            servidor::servir_detener,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Legajo");
}

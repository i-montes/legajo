mod commands;

use commands::AppState;
use legajo_core::{Db, Http};
use std::sync::Arc;
use tauri::Manager;

/// Coloca la ventana en la pantalla que se pida.
///
/// `LEGAJO_PANTALLA=2` la centra en la segunda pantalla contando de izquierda a
/// derecha; sin la variable, se deja donde el gestor de ventanas decida. Se listan las pantallas encontradas
/// por la salida estándar porque bajo WSLg no siempre se ven todas: si solo
/// aparece una, el problema está en el compositor y no en la app, y conviene
/// poder distinguir los dos casos sin adivinar.
fn colocar_ventana(app: &tauri::App) {
    use tauri::Manager;

    let Some(v) = app.get_webview_window("main") else { return };
    let mut monitores = match v.available_monitors() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("legajo: no se pudieron listar las pantallas: {e}");
            return;
        }
    };
    // De izquierda a derecha, que es como las numera quien las mira. El orden
    // en que las entrega el compositor es arbitrario: aquí llegaban con la
    // pantalla derecha como «1» y la izquierda como «2».
    monitores.sort_by_key(|m| (m.position().x, m.position().y));

    eprintln!("legajo: {} pantalla(s) detectada(s)", monitores.len());
    for (i, m) in monitores.iter().enumerate() {
        let s = m.size();
        let p = m.position();
        eprintln!(
            "  {}  {}  {}x{} en ({}, {})",
            i + 1,
            m.name().map(String::as_str).unwrap_or("sin nombre"),
            s.width, s.height, p.x, p.y
        );
    }

    let Ok(pedida) = std::env::var("LEGAJO_PANTALLA") else { return };
    let Ok(n) = pedida.trim().parse::<usize>() else {
        eprintln!("legajo: LEGAJO_PANTALLA no es un numero: {pedida:?}");
        return;
    };
    let Some(m) = monitores.get(n.saturating_sub(1)) else {
        eprintln!("legajo: no hay pantalla {n}; hay {}", monitores.len());
        return;
    };

    // Centrada en esa pantalla, no en su esquina: aparecer pegada a un borde en
    // un monitor grande se siente como un fallo.
    let ms = m.size();
    let mp = m.position();
    let vs = v.outer_size().unwrap_or(tauri::PhysicalSize { width: 1280, height: 860 });
    let x = mp.x + ((ms.width as i32 - vs.width as i32) / 2).max(0);
    let y = mp.y + ((ms.height as i32 - vs.height as i32) / 2).max(0);
    if let Err(e) = v.set_position(tauri::PhysicalPosition { x, y }) {
        eprintln!("legajo: no se pudo mover la ventana: {e}");
    }
}

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
            colocar_ventana(app);
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
            commands::grafo_resumen,
            commands::grafo_entidades,
            commands::grafo_relaciones,
            commands::grafo_duplicados,
            commands::grafo_sin_nombrar,
            commands::calibrar,
            commands::aplicar_calibracion,
            commands::calibracion_guardada,
            commands::iniciar_extraccion,
            commands::cancelar_extraccion,
            commands::extrayendo,
            commands::avance_extraccion,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar Legajo");
}

// Evita que se abra una consola junto a la ventana en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Bajo WSL, WebKitGTK se cae al poco de arrancar.
///
/// Su renderizador DMABUF da por hecho un paso de GPU que WSLg no ofrece: MESA
/// falla al elegir dispositivo, el cliente X acaba con la tubería rota y la
/// ventana muere sin dejar rastro útil —«Error flushing display: Broken pipe»—
/// entre segundos y media hora después de abrirse.
///
/// Se desactiva solo dentro de WSL, y solo si el usuario no ha dicho otra cosa:
/// en un escritorio Linux con GPU de verdad, DMABUF es la ruta rápida y no hay
/// razón para renunciar a ella.
#[cfg(target_os = "linux")]
fn ajustar_render_en_wsl() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    let es_wsl = std::env::var_os("WSL_DISTRO_NAME").is_some()
        || std::fs::read_to_string("/proc/version")
            .map(|v| {
                let v = v.to_lowercase();
                v.contains("microsoft") || v.contains("wsl")
            })
            .unwrap_or(false);

    if es_wsl {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn ajustar_render_en_wsl() {}

fn main() {
    // Antes de que arranque GTK: después ya no tiene efecto.
    ajustar_render_en_wsl();
    legajo_lib::run()
}

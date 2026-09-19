// Evita que se abra una consola junto a la ventana en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// El renderizador DMABUF de WebKitGTK no sobrevive en todas partes.
///
/// Bajo **WSL** da por hecho un paso de GPU que WSLg no ofrece: MESA falla al
/// elegir dispositivo, el cliente X acaba con la tubería rota y la ventana
/// muere sin dejar rastro útil —«Error flushing display: Broken pipe»— entre
/// segundos y media hora después de abrirse.
///
/// Bajo **Wayland** el desenlace es inmediato y el motivo es otro: MESA
/// registra la superficie en el protocolo de sincronización explícita
/// (`linux-drm-syncobj-v1`) y luego confirma un buffer sin declararle punto de
/// adquisición. Un compositor estricto —Hyprland lo es— responde con
/// `wp_linux_drm_syncobj_surface_v1: "Missing acquire timeline"` y cierra la
/// conexión: `Error 71 (Protocol error) dispatching to Wayland display`, antes
/// de que llegue a verse la ventana. No hay variable de MESA que apague ese
/// camino, así que el único punto donde se puede intervenir es este.
///
/// Se desactiva en ambos casos, y solo si el usuario no ha dicho otra cosa:
/// definir `WEBKIT_DISABLE_DMABUF_RENDERER` a mano manda siempre, incluido
/// ponerla a `0` para recuperar la ruta rápida donde de verdad funcione.
/// Renunciar a ella cuesta poco en una aplicación de texto como esta, y cuesta
/// mucho menos que no arrancar.
#[cfg(target_os = "linux")]
fn ajustar_render_de_webkit() {
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
    let es_wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();

    if es_wsl || es_wayland {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    // Solo WSL necesita además renunciar a la composición acelerada; en Wayland
    // basta con lo de arriba y conservarla sale más barato.
    if es_wsl && std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }
}

#[cfg(not(target_os = "linux"))]
fn ajustar_render_de_webkit() {}

fn main() {
    // Antes de que arranque GTK: después ya no tiene efecto.
    ajustar_render_de_webkit();
    legajo_lib::run()
}

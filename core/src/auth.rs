//! Contraseñas de aplicación de WordPress: probar que quien conecta el archivo
//! pertenece a él.
//!
//! Leer un archivo público no necesita credenciales, y durante un tiempo Legajo
//! no las pidió. Pero construir el grafo de conocimiento de un medio no es leer:
//! es quedarse con su archivo entero, y eso solo debería poder hacerlo alguien
//! de la casa. La contraseña de aplicación es la prueba, y es la buena por tres
//! razones: la emite el propio WordPress, no da acceso a la contraseña real de
//! nadie, y se revoca desde el panel del sitio en cualquier momento sin tocar
//! nada más.
//!
//! No se inventa la dirección donde se crea. El sitio la anuncia en su propio
//! índice REST, y de ahí se toma: hay instalaciones que mueven `wp-admin`, y
//! construirla a mano llevaría a media redacción a una página que no existe.

use crate::error::{Error, Result};
use crate::http::{Auth, Http};
use crate::transport::Transport;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Cómo se presenta Legajo ante el WordPress del medio. Aparece en la pantalla
/// de autorización y en la lista de contraseñas del perfil, que es donde una
/// persona va a buscarla el día que quiera revocarla.
pub const NOMBRE_APP: &str = "Legajo";

/// Quién resultó ser quien conectó, según el propio sitio.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Identidad {
    pub id: i64,
    pub login: String,
    pub nombre: String,
    pub roles: Vec<String>,
    /// Puede leer borradores y contenido en crudo. Sin esto el archivo se ve,
    /// pero solo lo publicado.
    pub edita: bool,
}

/// La dirección, en el sitio de la persona, donde WordPress crea la contraseña.
///
/// Se le pasa `app_name` para que la contraseña quede etiquetada y se pueda
/// reconocer entre las demás. No se pasa `success_url`: sin ella WordPress
/// enseña la contraseña en pantalla para copiarla, que es un paso más pero no
/// exige que la app abra un puerto a la escucha. La promesa de que esto no
/// levanta servidores se mantiene entera.
pub fn url_autorizacion(endpoint: &str) -> String {
    let sep = if endpoint.contains('?') { '&' } else { '?' };
    format!("{endpoint}{sep}app_name={}", urlencode(NOMBRE_APP))
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            b' ' => "+".to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Pregunta al sitio quién es el dueño de estas credenciales.
///
/// Se usa `context=edit` a propósito: cualquiera puede leer `users/me` con una
/// credencial válida, pero solo quien tiene permisos de edición obtiene esa
/// vista. Es la diferencia entre «tengo una cuenta aquí» y «este archivo es
/// mío», que es lo que hay que comprobar.
pub async fn verificar(http: &Http, t: &Transport, auth: &Auth) -> Result<Identidad> {
    let url = t.url("wp/v2/users/me", &[("context", "edit".into())])?;
    let r = http.get(&url, auth).await?;

    // Los dos rechazos que de verdad ocurren merecen decirse en castellano:
    // quien los lee no controla el servidor y un «401» a secas no le dice nada.
    if r.status == 401 {
        return Err(Error::Other(
            "El sitio rechazó el correo o la contraseña. Comprueba que la contraseña esté \
             copiada entera, tal como te la dio WordPress. Si el correo es correcto y aun \
             así falla, prueba con tu nombre de usuario: aparece en la misma pantalla \
             donde creaste la contraseña."
                .into(),
        ));
    }
    if r.status == 403 {
        return Err(Error::Other(
            "Las credenciales sirven, pero esa cuenta no tiene permisos de edición en el \
             sitio. Hace falta una cuenta del medio, no una de lector."
                .into(),
        ));
    }
    if !r.ok() {
        return Err(Error::Other(format!(
            "El sitio respondió {} al comprobar la cuenta.", r.status)));
    }

    let v: Value = serde_json::from_str(&r.body)
        .map_err(|e| Error::Other(format!("respuesta ilegible del sitio: {e}")))?;

    let roles: Vec<String> = v
        .get("roles")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default();

    Ok(Identidad {
        id: v.get("id").and_then(Value::as_i64).unwrap_or(0),
        login: v
            .get("username")
            .or_else(|| v.get("slug"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        nombre: v
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("(sin nombre)")
            .to_string(),
        // `context=edit` respondió, así que hay permisos de edición: es la
        // propia respuesta la que lo demuestra, no lo que diga el rol.
        edita: true,
        roles,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_direccion_sale_del_sitio_y_no_se_inventa() {
        // La Silla anuncia esta, y hay instalaciones que mueven `wp-admin`:
        // construirla a mano llevaría a media redacción a un 404.
        let u = url_autorizacion("https://www.lasillavacia.com/wp-admin/authorize-application.php");
        assert_eq!(
            u,
            "https://www.lasillavacia.com/wp-admin/authorize-application.php?app_name=Legajo"
        );
    }

    #[test]
    fn respeta_un_endpoint_que_ya_traiga_parametros() {
        let u = url_autorizacion("https://x.co/index.php?rest_route=/authorize");
        assert!(u.ends_with("&app_name=Legajo"), "quedó: {u}");
        assert_eq!(u.matches('?').count(), 1, "no puede haber dos interrogantes");
    }

    #[test]
    fn el_nombre_de_la_app_viaja_escapado() {
        assert_eq!(urlencode("Legajo"), "Legajo");
        assert_eq!(urlencode("Mi App & Co"), "Mi+App+%26+Co");
    }
}

use crate::error::Result;
use serde::{Deserialize, Serialize};
use url::Url;

pub const WPCOM_API: &str = "https://public-api.wordpress.com";

/// Como expone el sitio su REST API.
///
/// `Pretty` es el caso normal (`/wp-json/...`). `PlainQuery` es el respaldo para
/// sitios sin permalinks bonitos (`/?rest_route=/...`). `WpCom` es el caso de los
/// sitios alojados en WordPress.com, que **no tienen `/wp-json` en su dominio**
/// (devuelve 404) y solo son accesibles por el proxy de public-api.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Transport {
    DirectPretty { origin: String },
    DirectPlain { origin: String },
    WpCom { site: String },
}

impl Transport {
    pub fn label(&self) -> &'static str {
        match self {
            Transport::DirectPretty { .. } => "REST directo",
            Transport::DirectPlain { .. } => "REST directo (rest_route)",
            Transport::WpCom { .. } => "Proxy WordPress.com",
        }
    }

    /// URL del indice de la REST API, donde viven el nombre del sitio, los
    /// namespaces y los metodos de autenticacion anunciados.
    pub fn index_url(&self) -> Result<Url> {
        Ok(match self {
            Transport::DirectPretty { origin } => Url::parse(&format!("{origin}/wp-json/"))?,
            Transport::DirectPlain { origin } => Url::parse(&format!("{origin}/?rest_route=/"))?,
            // WordPress.com no expone el indice wp/v2; su equivalente es v1.1.
            Transport::WpCom { site } => {
                Url::parse(&format!("{WPCOM_API}/rest/v1.1/sites/{site}"))?
            }
        })
    }

    /// Construye la URL de una ruta `wp/v2/*` con sus parametros.
    ///
    /// `route` se pasa sin barra inicial, p.ej. `"wp/v2/posts"`.
    pub fn url(&self, route: &str, query: &[(&str, String)]) -> Result<Url> {
        let route = route.trim_start_matches('/');

        let mut url = match self {
            Transport::DirectPretty { origin } => Url::parse(&format!("{origin}/wp-json/{route}"))?,

            Transport::DirectPlain { origin } => {
                let mut u = Url::parse(&format!("{origin}/"))?;
                u.query_pairs_mut().append_pair("rest_route", &format!("/{route}"));
                u
            }

            // El proxy inserta `sites/{site}` justo despues del namespace:
            //   wp/v2/posts  ->  /wp/v2/sites/ejemplo.com/posts
            Transport::WpCom { site } => {
                let rest = route.strip_prefix("wp/v2/").unwrap_or(route);
                Url::parse(&format!("{WPCOM_API}/wp/v2/sites/{site}/{rest}"))?
            }
        };

        if !query.is_empty() {
            let mut pairs = url.query_pairs_mut();
            for (k, v) in query {
                pairs.append_pair(k, v);
            }
        }
        Ok(url)
    }

    /// Identificador estable para guardar la conexion.
    pub fn origin(&self) -> &str {
        match self {
            Transport::DirectPretty { origin } | Transport::DirectPlain { origin } => origin,
            Transport::WpCom { site } => site,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(v: &str) -> Vec<(&str, String)> {
        vec![("per_page", v.to_string())]
    }

    #[test]
    fn pretty_construye_ruta_wp_json() {
        let t = Transport::DirectPretty { origin: "https://www.lasillavacia.com".into() };
        assert_eq!(
            t.url("wp/v2/posts", &q("1")).unwrap().as_str(),
            "https://www.lasillavacia.com/wp-json/wp/v2/posts?per_page=1"
        );
    }

    #[test]
    fn plain_usa_rest_route() {
        let t = Transport::DirectPlain { origin: "https://ejemplo.com".into() };
        let u = t.url("wp/v2/posts", &q("1")).unwrap();
        assert!(u.as_str().contains("rest_route=%2Fwp%2Fv2%2Fposts"));
        assert!(u.as_str().contains("per_page=1"));
    }

    #[test]
    fn wpcom_inserta_el_segmento_sites() {
        let t = Transport::WpCom { site: "en.blog.wordpress.com".into() };
        assert_eq!(
            t.url("wp/v2/posts", &q("1")).unwrap().as_str(),
            "https://public-api.wordpress.com/wp/v2/sites/en.blog.wordpress.com/posts?per_page=1"
        );
    }

    #[test]
    fn wpcom_indice_va_a_v1_1() {
        let t = Transport::WpCom { site: "ejemplo.wordpress.com".into() };
        assert_eq!(
            t.index_url().unwrap().as_str(),
            "https://public-api.wordpress.com/rest/v1.1/sites/ejemplo.wordpress.com"
        );
    }
}

use crate::error::{Error, Result};
use crate::http::{Auth, Http};
use crate::transport::Transport;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

/// Un intento de conexion y su desenlace. Se devuelven todos al frontend: cuando
/// el sitio no es del usuario, "no se pudo conectar" a secas no sirve de nada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attempt {
    pub target: String,
    pub outcome: String,
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaxonomyInfo {
    pub slug: String,
    pub name: String,
    pub rest_base: String,
    pub hierarchical: bool,
    pub types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PostTypeInfo {
    pub slug: String,
    pub name: String,
    pub rest_base: String,
    pub taxonomies: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Capabilities {
    pub anonymous_read: bool,
    pub read_status: u16,
    pub total_posts: Option<u64>,
    pub has_total_header: bool,
    pub supports_fields: bool,
    pub supports_date_filter: bool,
    pub supports_terms_exclude: bool,
    pub oldest_date: Option<String>,
    pub newest_date: Option<String>,
    pub oldest_date_valid: bool,
    pub post_types: Vec<PostTypeInfo>,
    pub taxonomies: Vec<TaxonomyInfo>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Discovery {
    pub input: String,
    pub transport: Transport,
    pub transport_label: String,
    pub resolved_origin: String,
    pub site_name: Option<String>,
    pub site_description: Option<String>,
    pub namespaces: Vec<String>,
    pub auth_methods: Vec<String>,
    pub app_password_endpoint: Option<String>,
    pub capabilities: Capabilities,
    pub attempts: Vec<Attempt>,
}

/// Normaliza lo que el usuario haya escrito hasta un origen utilizable.
///
/// Acepta `ejemplo.com`, `https://ejemplo.com/`, `ejemplo.com/wp-json`, con o sin
/// `www`, con o sin barra final.
pub fn normalize_input(input: &str) -> Result<Url> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err(Error::Discovery("Escribe la direccion de un sitio.".into()));
    }

    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };

    let mut url = Url::parse(&with_scheme)?;
    if url.host_str().is_none() {
        return Err(Error::Discovery(format!("`{raw}` no parece una direccion web.")));
    }

    // Quitamos sufijos que el usuario pega por costumbre pero que no son el origen.
    let path = url.path().trim_end_matches('/').to_string();
    for suffix in ["/wp-json/wp/v2", "/wp-json", "/wp-admin", "/wp-login.php"] {
        if let Some(stripped) = path.strip_suffix(suffix) {
            url.set_path(stripped);
            break;
        }
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn origin_of(url: &Url) -> String {
    let mut s = format!("{}://{}", url.scheme(), url.host_str().unwrap_or_default());
    if let Some(p) = url.port() {
        s.push_str(&format!(":{p}"));
    }
    let path = url.path().trim_end_matches('/');
    if !path.is_empty() {
        s.push_str(path);
    }
    s
}

/// Un ano plausible para un archivo periodistico. WordPress devuelve fechas como
/// `-0001-11-30T00:00:00` en posts danados, y hay que detectarlas, no confiar en ellas.
fn date_is_plausible(s: &str) -> bool {
    let year: i32 = match s.get(0..4).and_then(|y| y.parse().ok()) {
        Some(y) => y,
        None => return false,
    };
    (1990..=2100).contains(&year)
}

pub async fn discover(http: &Http, input: &str) -> Result<Discovery> {
    discover_con_aviso(http, input, |_| {}).await
}

/// Igual, pero avisando de cada transporte antes de probarlo.
///
/// Existe para que la pantalla de espera pueda decir en qué va. Buscar la REST
/// API son hasta tres intentos contra servidores ajenos, cada uno con su tiempo
/// de espera: callar durante ese rato hace que una conexion lenta y una rota se
/// vean igual.
pub async fn discover_con_aviso<F>(http: &Http, input: &str, mut avisar: F) -> Result<Discovery>
where
    F: FnMut(&str),
{
    let base = normalize_input(input)?;
    let mut attempts = Vec::new();
    avisar("normalizando");

    // --- Paso 1: REST directo con permalinks bonitos ---------------------------
    avisar("directo");
    let pretty = Transport::DirectPretty { origin: origin_of(&base) };
    if let Some(d) = try_transport(http, pretty, input, &mut attempts).await? {
        return Ok(d);
    }

    // --- Paso 2: REST directo por rest_route (permalinks feos) ------------------
    avisar("rest_route");
    let plain = Transport::DirectPlain { origin: origin_of(&base) };
    if let Some(d) = try_transport(http, plain, input, &mut attempts).await? {
        return Ok(d);
    }

    // --- Paso 3: proxy de WordPress.com ----------------------------------------
    // Los sitios alojados en WordPress.com devuelven 404 en su propio /wp-json.
    if let Some(host) = base.host_str() {
        avisar("wpcom");
        let site = host.trim_start_matches("www.").to_string();
        let wpcom = Transport::WpCom { site };
        if let Some(d) = try_transport(http, wpcom, input, &mut attempts).await? {
            return Ok(d);
        }
    }

    let detail = attempts
        .iter()
        .map(|a| format!("  · {} → {}", a.target, a.outcome))
        .collect::<Vec<_>>()
        .join("\n");
    Err(Error::Discovery(format!(
        "No encontre una REST API de WordPress en `{input}`.\n{detail}"
    )))
}

/// Reconstruye el transporte a partir de la URL final de la peticion.
///
/// `ejemplo.com` puede redirigir a `https://www.ejemplo.com`. Si guardaramos el
/// origen que escribio el usuario, el mismo archivo entraria dos veces en la base
/// con dos censos distintos.
fn retarget(transport: &Transport, final_url: &str) -> Transport {
    let u = match Url::parse(final_url) {
        Ok(u) => u,
        Err(_) => return transport.clone(),
    };
    let mut origin = format!("{}://{}", u.scheme(), u.host_str().unwrap_or_default());
    if let Some(p) = u.port() {
        origin.push_str(&format!(":{p}"));
    }
    let path = u.path().trim_end_matches('/');
    let path = path.strip_suffix("/wp-json").unwrap_or(path);
    origin.push_str(path);

    match transport {
        Transport::DirectPretty { .. } => Transport::DirectPretty { origin },
        Transport::DirectPlain { .. } => Transport::DirectPlain { origin },
        Transport::WpCom { .. } => transport.clone(),
    }
}

async fn try_transport(
    http: &Http,
    transport: Transport,
    input: &str,
    attempts: &mut Vec<Attempt>,
) -> Result<Option<Discovery>> {
    let probe = http.probing();
    let index_url = transport.index_url()?;
    let resp = match probe.get(&index_url, &Auth::None).await {
        Ok(r) => r,
        Err(e) => {
            attempts.push(Attempt {
                target: index_url.to_string(),
                outcome: e.to_string(),
                ok: false,
            });
            return Ok(None);
        }
    };

    if !resp.ok() {
        attempts.push(Attempt {
            target: index_url.to_string(),
            outcome: format!("HTTP {}", resp.status),
            ok: false,
        });
        return Ok(None);
    }

    let index: Value = match resp.json() {
        Ok(v) => v,
        Err(_) => {
            attempts.push(Attempt {
                target: index_url.to_string(),
                outcome: "respondio, pero no con JSON (probablemente una pagina HTML)".into(),
                ok: false,
            });
            return Ok(None);
        }
    };

    // Confirmamos que de verdad hay una API wp/v2 detras antes de dar el paso por bueno.
    let is_wpcom = matches!(transport, Transport::WpCom { .. });
    let namespaces: Vec<String> = index
        .get("namespaces")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    if !is_wpcom && !namespaces.iter().any(|n| n == "wp/v2") {
        attempts.push(Attempt {
            target: index_url.to_string(),
            outcome: "hay JSON pero no expone el namespace wp/v2".into(),
            ok: false,
        });
        return Ok(None);
    }

    // A partir de aqui el transporte lleva el origen definitivo, ya sin redirecciones.
    let transport = retarget(&transport, &resp.url);

    attempts.push(Attempt {
        target: index_url.to_string(),
        outcome: format!("HTTP {} · {} · {}", resp.status, transport.label(), transport.origin()),
        ok: true,
    });

    // Los metodos de autenticacion que el sitio anuncia por su cuenta.
    let auth_obj = index.get("authentication").and_then(Value::as_object);
    let auth_methods: Vec<String> = auth_obj
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let app_password_endpoint = auth_obj
        .and_then(|o| o.get("application-passwords"))
        .and_then(|v| v.pointer("/endpoints/authorization"))
        .and_then(Value::as_str)
        .map(String::from);

    // Identificar no es leer. El sondeo del archivo espera a que haya
    // credencial: lo lanza el paso siguiente, no este.
    let capabilities = Capabilities::default();

    Ok(Some(Discovery {
        input: input.to_string(),
        transport_label: transport.label().to_string(),
        resolved_origin: transport.origin().to_string(),
        site_name: index
            .get("name")
            .and_then(Value::as_str)
            .map(String::from),
        site_description: index
            .get("description")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(String::from),
        namespaces,
        auth_methods,
        app_password_endpoint,
        capabilities,
        attempts: std::mem::take(attempts),
        transport,
    }))
}

/// Sondea lo que el sitio permite de verdad. Nada se da por supuesto: hay plugins
/// de seguridad que bloquean partes de la REST API, y descubrirlo a mitad de una
/// extraccion de 50.000 articulos es demasiado tarde.
/// Sondea lo que el sitio permite de verdad, ya con credencial.
///
/// Se separó de la identificación a propósito. Antes esto corría nada más pegar
/// una dirección, y hacía seis lecturas del archivo sin que nadie hubiera dado
/// permiso: cuántos artículos hay, cuál es el más viejo, si respeta los filtros.
/// Nada de eso era secreto, pero tampoco era asunto de Legajo antes de que el
/// dueño del archivo dijera que sí.
///
/// Identificar un sitio —leer su índice REST para saber cómo se llama y dónde se
/// crean sus contraseñas— no toca el archivo. Leerlo empieza aquí, y aquí ya hay
/// credencial.
pub async fn sondear(http: &Http, t: &Transport, auth: &Auth) -> Result<Capabilities> {
    probe_capabilities(http, t, auth).await
}

async fn probe_capabilities(http: &Http, t: &Transport, auth: &Auth) -> Result<Capabilities> {
    let mut c = Capabilities::default();

    // ¿Se puede leer sin credenciales, y cuantos posts hay?
    let base = http
        .get(&t.url("wp/v2/posts", &[("per_page", "1".into())])?, auth)
        .await?;
    c.read_status = base.status;
    c.anonymous_read = base.ok();
    c.total_posts = base.headers.total;
    c.has_total_header = base.headers.total.is_some();

    if !c.anonymous_read {
        c.notes.push(format!(
            "El sitio devuelve HTTP {} al leer con esta cuenta. Comprueba que la \
             contrasena de aplicacion sigue vigente en tu perfil de WordPress.",
            base.status
        ));
        return Ok(c);
    }
    if !c.has_total_header {
        c.notes
            .push("El sitio no envia X-WP-Total: habra que contar por ventanas de fecha.".into());
    }

    // ¿Respeta _fields? Si lo ignora, devuelve el post entero y el censo pesa 20x.
    if let Ok(r) = http
        .get(
            &t.url("wp/v2/posts", &[("per_page", "1".into()), ("_fields", "id,date".into())])?,
            auth,
        )
        .await
    {
        if let Ok(Value::Array(items)) = r.json::<Value>() {
            if let Some(Value::Object(o)) = items.first() {
                c.supports_fields = o.keys().all(|k| k == "id" || k == "date");
            }
        }
    }
    if !c.supports_fields {
        c.notes
            .push("El sitio ignora _fields: el censo descargara mas datos de los necesarios.".into());
    }

    // ¿Respeta after/before? Se comprueba de verdad: una ventana imposible debe dar 0.
    if let Ok(r) = http
        .get(
            &t.url(
                "wp/v2/posts",
                &[("per_page", "1".into()), ("after", "2099-01-01T00:00:00".into())],
            )?,
            auth,
        )
        .await
    {
        c.supports_date_filter = r.headers.total == Some(0)
            || (r.headers.total.is_some() && r.headers.total != c.total_posts);
    }
    if !c.supports_date_filter {
        c.notes.push(
            "El filtro de fechas no parece respetarse: la paginacion por ventana no servira.".into(),
        );
    }

    // ¿Respeta la exclusion de terminos? Se prueba contra la categoria mas grande.
    if let Ok(r) = http
        .get(
            &t.url(
                "wp/v2/categories",
                &[
                    ("per_page", "1".into()),
                    ("orderby", "count".into()),
                    ("order", "desc".into()),
                    ("_fields", "id,count".into()),
                ],
            )?,
            auth,
        )
        .await
    {
        if let Ok(Value::Array(items)) = r.json::<Value>() {
            if let Some(id) = items.first().and_then(|v| v.get("id")).and_then(Value::as_u64) {
                if let Ok(x) = http
                    .get(
                        &t.url(
                            "wp/v2/posts",
                            &[("per_page", "1".into()), ("categories_exclude", id.to_string())],
                        )?,
                        auth,
                    )
                    .await
                {
                    c.supports_terms_exclude =
                        x.headers.total.is_some() && x.headers.total != c.total_posts;
                }
            }
        }
    }

    // Rango temporal real del archivo.
    for (order, slot) in [("asc", true), ("desc", false)] {
        if let Ok(r) = http
            .get(
                &t.url(
                    "wp/v2/posts",
                    &[
                        ("per_page", "1".into()),
                        ("orderby", "date".into()),
                        ("order", order.into()),
                        ("_fields", "id,date".into()),
                    ],
                )?,
                auth,
            )
            .await
        {
            if let Ok(Value::Array(items)) = r.json::<Value>() {
                let d = items
                    .first()
                    .and_then(|v| v.get("date"))
                    .and_then(Value::as_str)
                    .map(String::from);
                if slot {
                    c.oldest_date_valid = d.as_deref().map(date_is_plausible).unwrap_or(false);
                    c.oldest_date = d;
                } else {
                    c.newest_date = d;
                }
            }
        }
    }
    if !c.oldest_date_valid {
        if let Some(d) = &c.oldest_date {
            c.notes.push(format!(
                "El post mas antiguo tiene una fecha invalida ({d}). Hay registros danados en el archivo."
            ));
        }
    }

    // Tipos de contenido y taxonomias: no asumimos `post` ni `category`.
    if let Ok(r) = http.get(&t.url("wp/v2/types", &[])?, auth).await {
        if let Ok(Value::Object(map)) = r.json::<Value>() {
            for (slug, v) in map {
                if v.get("rest_base").and_then(Value::as_str).is_none() {
                    continue;
                }
                c.post_types.push(PostTypeInfo {
                    slug: slug.clone(),
                    name: str_or(&v, "name", &slug),
                    rest_base: str_or(&v, "rest_base", &slug),
                    taxonomies: str_vec(&v, "taxonomies"),
                });
            }
        }
    }

    if let Ok(r) = http.get(&t.url("wp/v2/taxonomies", &[])?, auth).await {
        if let Ok(Value::Object(map)) = r.json::<Value>() {
            for (slug, v) in map {
                let types = str_vec(&v, "types");
                // Solo las que aplican a contenido editorial.
                if !types.iter().any(|ty| ty == "post") && !types.is_empty() {
                    continue;
                }
                c.taxonomies.push(TaxonomyInfo {
                    slug: slug.clone(),
                    name: str_or(&v, "name", &slug),
                    rest_base: str_or(&v, "rest_base", &slug),
                    hierarchical: v.get("hierarchical").and_then(Value::as_bool).unwrap_or(false),
                    types,
                });
            }
            c.taxonomies.sort_by(|a, b| a.slug.cmp(&b.slug));
        }
    }

    Ok(c)
}

fn str_or(v: &Value, key: &str, fallback: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or(fallback)
        .to_string()
}

fn str_vec(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normaliza_las_formas_que_escribe_la_gente() {
        let esperado = "https://ejemplo.com";
        for entrada in [
            "ejemplo.com",
            "  ejemplo.com  ",
            "https://ejemplo.com",
            "https://ejemplo.com/",
            "https://ejemplo.com/wp-json",
            "https://ejemplo.com/wp-json/",
            "https://ejemplo.com/wp-json/wp/v2",
            "https://ejemplo.com/wp-admin",
        ] {
            let u = normalize_input(entrada).expect(entrada);
            assert_eq!(origin_of(&u), esperado, "fallo con `{entrada}`");
        }
    }

    #[test]
    fn conserva_subdirectorio_y_puerto() {
        let u = normalize_input("http://localhost:8080/blog").unwrap();
        assert_eq!(origin_of(&u), "http://localhost:8080/blog");
    }

    #[test]
    fn detecta_fechas_danadas() {
        assert!(date_is_plausible("2009-03-11T08:00:00"));
        assert!(!date_is_plausible("-0001-11-30T00:00:00"));
        assert!(!date_is_plausible(""));
    }

    #[test]
    fn rechaza_entrada_vacia() {
        assert!(normalize_input("   ").is_err());
    }

    // ---- Pruebas contra sitios reales -------------------------------------
    // Tocan la red, asi que van marcadas #[ignore]. Son la unica verificacion
    // que importa de verdad: que la app funcione con archivos que no son el
    // nuestro. Ejecutar con:  cargo test -- --ignored --nocapture

    async fn probar(entrada: &str) -> Discovery {
        let http = Http::new().unwrap();
        discover(&http, entrada)
            .await
            .unwrap_or_else(|e| panic!("fallo con `{entrada}`: {e}"))
    }

    #[tokio::test]
    #[ignore]
    async fn red_newspack_con_jetpack() {
        let d = probar("lasillavacia.com").await;
        assert!(matches!(d.transport, Transport::DirectPretty { .. }));
        assert!(d.capabilities.anonymous_read);
        assert!(d.capabilities.total_posts.unwrap_or(0) > 50_000);
        assert!(d.auth_methods.iter().any(|m| m == "application-passwords"));
        // Archivo con registros danados: el sondeo tiene que detectarlo.
        assert!(!d.capabilities.oldest_date_valid);
    }

    #[tokio::test]
    #[ignore]
    async fn red_wordpress_autohospedado() {
        let d = probar("wordpress.org/news").await;
        assert!(matches!(d.transport, Transport::DirectPretty { .. }));
        assert!(d.capabilities.supports_fields);
        assert!(d.capabilities.supports_date_filter);
    }

    #[tokio::test]
    #[ignore]
    async fn red_sitio_alojado_en_wordpress_com() {
        // Su propio /wp-json devuelve 404: solo se llega por el proxy.
        let d = probar("en.blog.wordpress.com").await;
        assert!(matches!(d.transport, Transport::WpCom { .. }));
        assert!(d.capabilities.anonymous_read);
        assert!(d.capabilities.total_posts.unwrap_or(0) > 1_000);
    }

    #[tokio::test]
    #[ignore]
    async fn red_archivo_enorme() {
        let d = probar("techcrunch.com").await;
        assert!(d.capabilities.total_posts.unwrap_or(0) > 200_000);
    }

    #[tokio::test]
    #[ignore]
    async fn red_normalizacion_converge_al_mismo_origen() {
        let a = probar("lasillavacia.com").await;
        let b = probar("https://www.lasillavacia.com/wp-json/").await;
        assert_eq!(a.resolved_origin, b.resolved_origin);
    }

    #[tokio::test]
    #[ignore]
    async fn red_sitio_sin_wordpress_explica_por_que() {
        let http = Http::new().unwrap();
        let err = discover(&http, "example.com").await.unwrap_err().to_string();
        assert!(err.contains("No encontre una REST API"), "{err}");
        // El mensaje tiene que detallar cada intento, no solo decir que fallo.
        assert!(err.matches('\u{b7}').count() >= 3, "{err}");
    }
}

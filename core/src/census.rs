use crate::error::{Error, Result};
use crate::http::{Auth, Http};
use crate::transport::Transport;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Una pieza del archivo, tal como la necesita el marco muestral.
///
/// El cuerpo no vive aquí sino en `Lote::cuerpos`, porque no todo lo que
/// consume el censo lo necesita: el reparto por años y secciones se calcula
/// solo con esto.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilaCenso {
    pub wp_id: i64,
    pub date: Option<String>,
    pub date_valid: bool,
    pub slug: Option<String>,
    pub link: Option<String>,
    pub title: Option<String>,
    pub author: Option<i64>,
    /// taxonomía (rest_base) -> ids de términos
    pub terms: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Anomalia {
    pub wp_id: i64,
    pub kind: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Termino {
    pub taxonomy: String,
    pub term_id: i64,
    pub name: String,
    pub slug: String,
    pub parent: i64,
    pub count: i64,
}

/// Lote de resultados de una ventana temporal.
#[derive(Debug, Default)]
pub struct Lote {
    pub filas: Vec<FilaCenso>,
    pub anomalias: Vec<Anomalia>,
    /// El HTML de cada pieza, que viaja en la misma respuesta que sus
    /// metadatos. Pedirlo aparte era pedir dos veces lo mismo al mismo
    /// servidor: primero para censar y después para extraer.
    pub cuerpos: Vec<(i64, String)>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProgresoCenso {
    pub fase: String,
    pub ventana: String,
    pub hechos: u64,
    pub total: u64,
    /// Demora que el sitio nos ha impuesto, en milisegundos. Sin este dato «va
    /// lento» es un misterio; con él es un hecho con su causa, y se distingue
    /// «tu servidor nos está frenando» de «el programa se colgó».
    #[serde(default)]
    pub cortesia_ms: u64,
    /// Peticiones en vuelo que el recorrido encontró que este sitio admite.
    #[serde(default)]
    pub carriles: u64,
}

fn anio_plausible(s: &str) -> bool {
    s.get(0..4)
        .and_then(|y| y.parse::<i32>().ok())
        .map(|y| (1990..=2100).contains(&y))
        .unwrap_or(false)
}

fn texto(v: &Value, key: &str) -> Option<String> {
    // WordPress devuelve {"rendered": "..."} en title y excerpt.
    match v.get(key) {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Object(o)) => o.get("rendered").and_then(Value::as_str).map(String::from),
        _ => None,
    }
}

fn decodificar(html: &str) -> String {
    // Los títulos vienen con entidades HTML: &#8220;, &amp;, &nbsp;…
    let mut s = html.replace("&#8211;", "–").replace("&#8212;", "—");
    for (from, to) in [
        ("&#8216;", "‘"), ("&#8217;", "’"), ("&#8220;", "“"), ("&#8221;", "”"),
        ("&#8230;", "…"), ("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"),
        ("&gt;", ">"), ("&quot;", "\""), ("&#039;", "'"), ("&#8242;", "′"),
    ] {
        s = s.replace(from, to);
    }
    s.trim().to_string()
}

/// Resultado de sincronizar nombres de términos.
#[derive(Debug, Default)]
pub struct Terminos {
    pub items: Vec<Termino>,
    /// Taxonomías que se dejaron fuera por tamaño, con su recuento.
    pub omitidas: Vec<(String, u64)>,
}

/// Una taxonomía con más términos que esto no puede servir de estrato: las
/// celdas saldrían con uno o dos artículos cada una. Bajarse sus nombres solo
/// para mostrarlos es tráfico regalado, y en archivos grandes son decenas de
/// miles.
pub const MAX_TERMINOS_ESTRATO: u64 = 2000;

/// Trae los nombres de los términos de las taxonomías que puedan estratificar.
///
/// Sin los nombres, el marco muestral solo tiene identificadores numéricos y
/// las pantallas de sanidad y muestreo no pueden mostrar nada legible. Pero no
/// hace falta traerlos todos: el censo guarda los ids de todas las taxonomías
/// —vienen gratis en la respuesta de cada artículo— y aquí solo se resuelven
/// los nombres de las que de verdad pueden hacer de secciones.
/// `avisar` recibe (taxonomía, cuántas van, cuántas hay).
///
/// Sin esto la fase entera era muda: en un archivo con cuatro taxonomías son
/// nueve segundos largos —una sonda por cada una y las páginas de las que sí
/// caben— con la pantalla diciendo «0/0» y sin nada que distinga ir despacio de
/// haberse colgado. Es justo la queja que trae la gente.
pub async fn sincronizar_terminos(
    http: &Http,
    t: &Transport,
    auth: &Auth,
    taxonomias: &[String],
    avisar: impl Fn(&str, u64, u64),
) -> Result<Terminos> {
    let mut out = Terminos::default();
    let total = taxonomias.len() as u64;
    for (i, tax) in taxonomias.iter().enumerate() {
        avisar(tax, i as u64, total);
        // Primero cuántos hay: una sola petición decide si vale la pena.
        let sonda = t.url(&format!("wp/v2/{tax}"), &[("per_page", "1".into()), ("_fields", "id".into())])?;
        if let Ok(r) = http.get(&sonda, auth).await {
            if let Some(n) = r.headers.total {
                if n > MAX_TERMINOS_ESTRATO {
                    out.omitidas.push((tax.clone(), n));
                    continue;
                }
            }
        }
        let mut page = 1u32;
        loop {
            let url = t.url(
                &format!("wp/v2/{tax}"),
                &[
                    ("per_page", "100".into()),
                    ("page", page.to_string()),
                    ("_fields", "id,name,slug,parent,count".into()),
                    ("orderby", "id".into()),
                ],
            )?;
            let r = http.get(&url, auth).await?;
            // WordPress devuelve 400 al pedir una página más allá de la última.
            if r.status == 400 { break; }
            if !r.ok() {
                return Err(Error::Status { status: r.status, url: url.to_string() });
            }
            let items: Vec<Value> = match r.json() {
                Ok(v) => v,
                Err(_) => break,
            };
            if items.is_empty() { break; }
            for it in &items {
                let Some(id) = it.get("id").and_then(Value::as_i64) else { continue };
                out.items.push(Termino {
                    taxonomy: tax.clone(),
                    term_id: id,
                    name: decodificar(&texto(it, "name").unwrap_or_default()),
                    slug: it.get("slug").and_then(Value::as_str).unwrap_or_default().to_string(),
                    parent: it.get("parent").and_then(Value::as_i64).unwrap_or(0),
                    count: it.get("count").and_then(Value::as_i64).unwrap_or(0),
                });
            }
            if items.len() < 100 { break; }
            page += 1;
            if page > 30 { break; } // salvaguarda: 3.000 términos por taxonomía
        }
    }
    avisar("", total, total);
    Ok(out)
}

/// Una ventana temporal cerrada: [desde, hasta).
#[derive(Debug, Clone)]
pub struct Ventana {
    pub etiqueta: String,
    pub desde: Option<String>,
    pub hasta: Option<String>,
}

/// Trocea el archivo en ventanas mensuales.
///
/// Es deliberado no paginar con `page=N` sobre el archivo entero: con 48.000
/// piezas son 484 páginas, WordPress se degrada en desplazamientos altos y
/// devuelve 400 al pasarse de la última. Tampoco sirve avanzar con
/// `before=<fecha del último visto>`, porque los artículos que comparten fecha
/// exacta se pierden o provocan un bucle. Ventanas de un mes dejan cada tramo
/// en pocas páginas y hacen el censo reanudable por tramo.
pub fn ventanas_mensuales(desde_anio: i32, hasta_anio: i32) -> Vec<Ventana> {
    let mut v = Vec::new();
    // Cola inicial: todo lo anterior al rango, que es donde caen las fechas dañadas.
    v.push(Ventana {
        etiqueta: format!("anterior a {desde_anio}"),
        desde: None,
        hasta: Some(format!("{desde_anio}-01-01T00:00:00")),
    });
    for anio in desde_anio..=hasta_anio {
        for mes in 1..=12 {
            let (sa, sm) = if mes == 12 { (anio + 1, 1) } else { (anio, mes + 1) };
            v.push(Ventana {
                etiqueta: format!("{anio}-{mes:02}"),
                desde: Some(format!("{anio}-{mes:02}-01T00:00:00")),
                hasta: Some(format!("{sa}-{sm:02}-01T00:00:00")),
            });
        }
    }
    v
}

fn parametros(v: &Ventana, campos: &str, page: u32) -> Vec<(&'static str, String)> {
    let mut q: Vec<(&'static str, String)> = vec![
        ("per_page", POR_PAGINA.to_string()),
        ("page", page.to_string()),
        ("orderby", "date".into()),
        ("order", "asc".into()),
        ("_fields", campos.to_string()),
    ];
    if let Some(d) = &v.desde { q.push(("after", d.clone())); }
    if let Some(h) = &v.hasta { q.push(("before", h.clone())); }
    q
}

/// Recorre una ventana y devuelve sus filas. `None` si la ventana está vacía.
pub async fn censar_ventana(
    http: &Http,
    t: &Transport,
    auth: &Auth,
    ventana: &Ventana,
    taxonomias: &[String],
) -> Result<Lote> {
    // `content` viaja con los metadatos. Es lo que convierte el censo en la
    // única vez que se le pide el archivo al sitio: la extracción ya no vuelve
    // a la red, lee de la base.
    let mut campos = String::from("id,date,slug,link,title,author,content");
    for tax in taxonomias {
        campos.push(',');
        campos.push_str(tax);
    }

    let mut lote = Lote::default();
    let mut page = 1u32;

    loop {
        let url = t.url("wp/v2/posts", &parametros(ventana, &campos, page))?;
        let r = http.get(&url, auth).await?;

        if r.status == 400 { break; }
        if !r.ok() {
            return Err(Error::Status { status: r.status, url: url.to_string() });
        }
        let items: Vec<Value> = match r.json() {
            Ok(v) => v,
            Err(_) => break,
        };
        if items.is_empty() { break; }

        for it in &items {
            let Some(wp_id) = it.get("id").and_then(Value::as_i64) else { continue };
            let date = it.get("date").and_then(Value::as_str).map(String::from);
            let date_valid = date.as_deref().map(anio_plausible).unwrap_or(false);
            let title = texto(it, "title").map(|s| decodificar(&s));

            if !date_valid {
                lote.anomalias.push(Anomalia {
                    wp_id,
                    kind: "fecha_invalida".into(),
                    detail: date.clone().unwrap_or_else(|| "sin fecha".into()),
                });
            }
            if title.as_deref().map(|t| t.is_empty()).unwrap_or(true) {
                lote.anomalias.push(Anomalia { wp_id, kind: "sin_titulo".into(), detail: String::new() });
            }

            let mut terms = serde_json::Map::new();
            let mut sin_terminos = true;
            for tax in taxonomias {
                if let Some(arr) = it.get(tax) {
                    if arr.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
                        sin_terminos = false;
                    }
                    terms.insert(tax.clone(), arr.clone());
                }
            }
            if sin_terminos && !taxonomias.is_empty() {
                lote.anomalias.push(Anomalia { wp_id, kind: "sin_terminos".into(), detail: String::new() });
            }

            if let Some(html) = texto(it, "content") {
                lote.cuerpos.push((wp_id, html));
            }

            lote.filas.push(FilaCenso {
                wp_id,
                date,
                date_valid,
                slug: it.get("slug").and_then(Value::as_str).map(String::from),
                link: it.get("link").and_then(Value::as_str).map(String::from),
                title,
                author: it.get("author").and_then(Value::as_i64),
                terms,
            });
        }

        if items.len() < POR_PAGINA { break; }
        page += 1;
        // Una ventana mensual con más de cinco mil piezas es un archivo anómalo
        // o un filtro que el sitio ignora. Cortar evita un bucle infinito. El
        // tope se expresa en piezas y no en páginas para que no se mueva solo
        // si cambia el tamaño de la tanda.
        if page as usize * POR_PAGINA > 5_000 { break; }
    }

    Ok(lote)
}

/// Primer y último año con fecha plausible.
///
/// No se puede partir de la fecha del artículo más antiguo sin más: en archivos
/// migrados suele ser `-0001-11-30`, y las ventanas arrancarían en el año cero.
/// Se pregunta por el más antiguo *posterior a 1990*, que es el inicio real.
pub async fn rango_real(http: &Http, t: &Transport, auth: &Auth) -> Result<(i32, i32)> {
    let pedir = |orden: &'static str, filtro: Option<(&'static str, String)>| {
        let mut q: Vec<(&'static str, String)> = vec![
            ("per_page", "1".into()),
            ("orderby", "date".into()),
            ("order", orden.into()),
            ("_fields", "date".into()),
        ];
        if let Some(f) = filtro { q.push(f); }
        q
    };

    let leer = |cuerpo: &str| -> Option<i32> {
        let items: Vec<Value> = serde_json::from_str(cuerpo).ok()?;
        items
            .first()?
            .get("date")?
            .as_str()?
            .get(0..4)?
            .parse::<i32>()
            .ok()
    };

    let url = t.url("wp/v2/posts", &pedir("asc", Some(("after", "1990-01-01T00:00:00".into()))))?;
    let desde = leer(&http.get(&url, auth).await?.body);

    let url = t.url("wp/v2/posts", &pedir("desc", None))?;
    let hasta = leer(&http.get(&url, auth).await?.body);

    let ahora = 2026;
    let desde = desde.unwrap_or(2000).clamp(1990, ahora);
    let hasta = hasta.unwrap_or(ahora).clamp(desde, ahora + 5);
    Ok((desde, hasta))
}

/// Trae el contenido de un conjunto concreto de artículos.
///
/// El censo solo lee metadatos; esto se usa para dos cosas: el sondeo de
/// contenido sobre una submuestra aleatoria (que estima qué proporción del
/// archivo usa bloques, cuántas notas son muy cortas y cuánto HTML está roto)
/// y, más adelante, la descarga de los artículos que caen en la muestra.
/// Cuántos artículos se piden —y se procesan— de una vez.
///
/// La extracción va por tandas de este tamaño: una sola petición trae los
/// cuerpos y el extractor los consume acto seguido. Antes eran dos recorridos
/// separados sobre el mismo lote, uno bajándolo entero y otro extrayéndolo
/// entero, y el primero tenía que terminar antes de que empezara el segundo:
/// en un archivo grande eso son miles de cuerpos en disco esperando a que
/// carguen los modelos, y una corrida interrumpida a mitad dejaba descargado
/// mucho más de lo que llegó a procesar.
///
/// Cuarenta es el mínimo que pidió la redacción y va sobrado por debajo del
/// tope de cien de WordPress, que con el cuerpo incluido es una respuesta
/// pesada.
pub const POR_TANDA: usize = 40;

/// Cuántas piezas se piden por página al recorrer el archivo.
///
/// Es aparte de `POR_TANDA` porque son dos cosas: aquella es cuánto se procesa
/// de una vez; esta, cuánto se le pide al sitio en cada petición. Y al sitio le
/// conviene el máximo que WordPress admite, que es cien.
///
/// La razón es el limitador del servidor, no el ancho de banda. Medido contra
/// el archivo real, alojado en Automattic (Batcache, `a8c-cdn`): con cuarenta
/// por página el censo iba a 10–13 piezas por segundo —dos horas para 84.000—
/// con los carriles frenados por 429 casi todo el tiempo. El limitador cuenta
/// **peticiones**, no bytes: una página de cien con el cuerpo pesa 240 KB
/// comprimidos y tarda 2,6 s, frente a 1,2 s la de cuarenta; por pieza es más
/// barata y son dos veces y media menos peticiones que contar.
pub const POR_PAGINA: usize = 100;

pub async fn traer_contenido(
    http: &Http,
    t: &Transport,
    auth: &Auth,
    ids: &[i64],
) -> Result<Vec<(i64, String)>> {
    let mut out = Vec::new();
    for trozo in ids.chunks(POR_TANDA) {
        let lista = trozo.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let url = t.url(
            "wp/v2/posts",
            &[
                ("include", lista),
                ("per_page", trozo.len().to_string()),
                ("_fields", "id,content".into()),
            ],
        )?;
        let r = http.get(&url, auth).await?;
        if !r.ok() {
            return Err(Error::Status { status: r.status, url: url.to_string() });
        }
        let items: Vec<Value> = r.json()?;
        for it in &items {
            let Some(id) = it.get("id").and_then(Value::as_i64) else { continue };
            let html = texto(it, "content").unwrap_or_default();
            out.push((id, html));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_ventanas_cubren_el_rango_y_llevan_cola() {
        let v = ventanas_mensuales(2009, 2011);
        assert_eq!(v.len(), 1 + 3 * 12);
        assert!(v[0].desde.is_none(), "la primera ventana barre lo anterior al rango");
        assert_eq!(v[0].hasta.as_deref(), Some("2009-01-01T00:00:00"));
        assert_eq!(v[1].desde.as_deref(), Some("2009-01-01T00:00:00"));
        assert_eq!(v[1].hasta.as_deref(), Some("2009-02-01T00:00:00"));
    }

    #[test]
    fn diciembre_pasa_al_anio_siguiente() {
        let v = ventanas_mensuales(2009, 2009);
        let dic = v.last().unwrap();
        assert_eq!(dic.desde.as_deref(), Some("2009-12-01T00:00:00"));
        assert_eq!(dic.hasta.as_deref(), Some("2010-01-01T00:00:00"));
    }

    #[test]
    fn las_ventanas_no_dejan_huecos() {
        let v = ventanas_mensuales(2009, 2012);
        for par in v[1..].windows(2) {
            assert_eq!(par[0].hasta, par[1].desde, "hueco entre {} y {}", par[0].etiqueta, par[1].etiqueta);
        }
    }

    #[test]
    fn detecta_el_anio_danado_de_wordpress() {
        assert!(anio_plausible("2016-03-14T08:00:00"));
        assert!(!anio_plausible("-0001-11-30T00:00:00"));
    }

    #[test]
    fn el_recorrido_pide_el_cuerpo_con_los_metadatos() {
        /* El censo y la extracción pedían las mismas piezas al mismo servidor
           en dos pasadas: una para censar y otra para bajar el cuerpo. Con el
           cuerpo dentro de la misma respuesta, el archivo se pide una sola vez
           y la extracción ya no toca la red. */
        let v = Ventana {
            etiqueta: "2016-03".into(),
            desde: Some("2016-03-01T00:00:00".into()),
            hasta: Some("2016-04-01T00:00:00".into()),
        };
        let q = parametros(&v, "id,date,slug,link,title,author,content,categories", 1);
        let campos = q.iter().find(|(k, _)| *k == "_fields").unwrap().1.clone();
        assert!(campos.contains("content"), "sin el cuerpo habría que volver a pedirlo");

        // Y la página baja a la tanda: con el cuerpo dentro, cien piezas son
        // varios MB contra un tiempo de espera de 45 s.
        let por_pagina = q.iter().find(|(k, _)| *k == "per_page").unwrap().1.clone();
        assert_eq!(por_pagina, POR_PAGINA.to_string());
        assert!(POR_PAGINA >= 40, "la redacción pidió al menos cuarenta por petición");
        assert!(POR_PAGINA <= 100, "WordPress no admite más de cien por página");
    }

    #[test]
    fn decodifica_entidades_de_titulos() {
        assert_eq!(decodificar("El &#8220;acuerdo&#8221; de paz"), "El “acuerdo” de paz");
        assert_eq!(decodificar("Uribe &amp; Santos&nbsp;"), "Uribe & Santos");
    }
}

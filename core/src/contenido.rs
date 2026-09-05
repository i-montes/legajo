//! Convertir el HTML de WordPress en texto anotable, y saber qué se rompió al
//! hacerlo.
//!
//! Se conserva siempre el HTML crudo junto al texto limpio: si mañana cambia el
//! limpiador, las posiciones de las anotaciones guardadas dejan de cuadrar, y
//! sin el crudo no hay forma de detectarlo ni de rehacerlas.

use serde::{Deserialize, Serialize};

const ENTIDADES: &[(&str, &str)] = &[
    ("&#8211;", "–"), ("&#8212;", "—"), ("&#8216;", "‘"), ("&#8217;", "’"),
    ("&#8220;", "“"), ("&#8221;", "”"), ("&#8230;", "…"), ("&#8242;", "′"),
    ("&nbsp;", " "), ("&#160;", " "), ("&lt;", "<"), ("&gt;", ">"),
    ("&quot;", "\""), ("&#039;", "'"), ("&#39;", "'"), ("&hellip;", "…"),
    ("&mdash;", "—"), ("&ndash;", "–"), ("&laquo;", "«"), ("&raquo;", "»"),
    ("&amp;", "&"), // el último, o desharía los anteriores
];

/// Qué se encontró al limpiar. Alimenta el paso de sanidad del archivo.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Diagnostico {
    /// El artículo se escribió con el editor de bloques.
    ///
    /// Se detecta por las clases `wp-block-*` del HTML renderizado, no por los
    /// comentarios `<!-- wp:… -->`: esos solo existen en `content.raw`, que
    /// requiere autenticarse con `context=edit`. Con lectura anónima nunca
    /// llegan, así que buscarlos daría siempre cero.
    pub bloques: bool,
    /// Shortcodes que quedaron sin resolver, de plugins retirados.
    pub shortcodes: Vec<String>,
    /// Etiquetas de apertura sin cierre en el mismo fragmento.
    pub html_roto: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Limpio {
    pub texto: String,
    pub palabras: i64,
    pub diagnostico: Diagnostico,
}

fn decodificar(s: &str) -> String {
    let mut out = s.to_string();
    for (from, to) in ENTIDADES {
        if out.contains(from) {
            out = out.replace(from, to);
        }
    }
    out
}

/// Shortcodes de WordPress que aparecen sin resolver aunque no lleven atributos.
const CONOCIDOS: &[&str] = &[
    "caption", "gallery", "embed", "audio", "video", "playlist", "wp_caption",
    "contact-form", "gravityform", "et_pb_section", "vc_row", "vc_column",
];

/// Un par `[etiqueta]` localizado en el texto.
struct Marca { ini: usize, fin: usize, nombre: String, cierre: bool }

fn marcas(html: &str) -> Vec<Marca> {
    let mut out = Vec::new();
    let bytes = html.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'[' {
            if let Some(rel) = html[i + 1..].find(']') {
                if rel < 200 {
                    let dentro = &html[i + 1..i + 1 + rel];
                    let cierre = dentro.starts_with('/');
                    let nombre: String = dentro
                        .trim_start_matches('/')
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
                        .collect();
                    if !nombre.is_empty() {
                        out.push(Marca { ini: i, fin: i + 1 + rel + 1, nombre, cierre });
                    }
                    i = i + 1 + rel;
                }
            }
        }
        i += 1;
    }
    out
}

/// Nombres de shortcodes reales presentes en el texto, sin repetir.
///
/// Un corchete suelto en la prosa —«[risas]», «[ed]», «[sic]»— no es un
/// shortcode, y contarlo como tal infla el diagnóstico de HTML roto y hace que
/// la limpieza se coma palabras del artículo. Solo cuenta como shortcode si
/// lleva atributos, tiene etiqueta de cierre, o es uno de los conocidos.
fn shortcodes(html: &str) -> Vec<String> {
    let ms = marcas(html);
    let con_cierre: std::collections::HashSet<&str> =
        ms.iter().filter(|m| m.cierre).map(|m| m.nombre.as_str()).collect();

    let mut out: Vec<String> = Vec::new();
    for m in &ms {
        if m.cierre { continue; }
        let cuerpo = &html[m.ini + 1 + m.nombre.len()..m.fin - 1];
        let califica = cuerpo.contains('=')
            || con_cierre.contains(m.nombre.as_str())
            || CONOCIDOS.contains(&m.nombre.to_ascii_lowercase().as_str());
        if califica && !out.contains(&m.nombre) {
            out.push(m.nombre.clone());
        }
    }
    out
}

/// Convierte `content.rendered` en texto plano conservando los párrafos.
pub fn limpiar(html: &str) -> Limpio {
    let bloques = html.contains("wp-block-") || html.contains("<!-- wp:");
    let sc = shortcodes(html);

    let mut s = html.to_string();

    // Fuera lo que no es prosa.
    for (abre, cierra) in [("<script", "</script>"), ("<style", "</style>")] {
        while let Some(i) = s.find(abre) {
            match s[i..].find(cierra) {
                Some(j) => { s.replace_range(i..i + j + cierra.len(), " "); }
                None => { s.truncate(i); break; }
            }
        }
    }

    // Se retiran las etiquetas de los shortcodes reales, no lo que envuelven:
    // el texto entre [su_quote] y [/su_quote] es prosa del artículo. Y los
    // corchetes que no son shortcodes se dejan intactos, porque son parte del
    // texto que el periodista escribió.
    if !sc.is_empty() {
        let ms = marcas(&s);
        let mut limpio = String::with_capacity(s.len());
        let mut cur = 0usize;
        for m in &ms {
            if !sc.contains(&m.nombre) { continue; }
            if m.ini >= cur {
                limpio.push_str(&s[cur..m.ini]);
                limpio.push(' ');
                cur = m.fin;
            }
        }
        limpio.push_str(&s[cur.min(s.len())..]);
        s = limpio;
    }

    // Comentarios HTML, incluidos los delimitadores de Gutenberg.
    while let Some(i) = s.find("<!--") {
        match s[i..].find("-->") {
            Some(j) => { s.replace_range(i..i + j + 3, " "); }
            None => { s.truncate(i); break; }
        }
    }

    // Saltos y fin de bloque se vuelven separadores de párrafo.
    for t in ["<br>", "<br/>", "<br />", "<BR>"] {
        s = s.replace(t, "\n");
    }
    for t in ["</p>", "</div>", "</li>", "</h1>", "</h2>", "</h3>", "</h4>",
              "</blockquote>", "</figcaption>", "</figure>", "</tr>"] {
        s = s.replace(t, "\n\n");
    }

    // Etiquetas restantes.
    let mut plano = String::with_capacity(s.len());
    let mut dentro = false;
    let mut abiertas = 0usize;
    for c in s.chars() {
        match c {
            '<' => { dentro = true; abiertas += 1; }
            '>' => { if dentro { abiertas = abiertas.saturating_sub(1); } dentro = false; }
            _ if !dentro => plano.push(c),
            _ => {}
        }
    }
    let html_roto = abiertas > 0 || !sc.is_empty();

    let plano = decodificar(&plano);

    // Normalizar espacios conservando la separación de párrafos.
    let mut parrafos: Vec<String> = Vec::new();
    for bloque in plano.split("\n\n") {
        let t: String = bloque.split_whitespace().collect::<Vec<_>>().join(" ");
        if !t.is_empty() {
            parrafos.push(t);
        }
    }
    let texto = parrafos.join("\n\n");
    let palabras = texto.split_whitespace().count() as i64;

    Limpio {
        texto,
        palabras,
        diagnostico: Diagnostico { bloques, shortcodes: sc, html_roto },
    }
}

/// Clave de comparación para detectar republicaciones con el titular cambiado.
pub fn clave_titulo(t: &str) -> String {
    t.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' => 'a', 'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i', 'ó' | 'ò' | 'ö' | 'ô' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u', 'ñ' => 'n',
            c if c.is_alphanumeric() || c == ' ' => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conserva_los_parrafos() {
        let l = limpiar("<p>Primero.</p><p>Segundo.</p>");
        assert_eq!(l.texto, "Primero.\n\nSegundo.");
        assert_eq!(l.palabras, 2);
    }

    #[test]
    fn decodifica_entidades_sin_deshacerse_a_si_mismo() {
        // &amp;lt; debe quedar en &lt;, no en <.
        let l = limpiar("<p>Uribe &amp; Santos dijeron &#8220;s&iacute;&#8221;</p>");
        assert!(l.texto.contains("Uribe & Santos"), "{}", l.texto);
        assert!(l.texto.contains('“'), "{}", l.texto);
    }

    #[test]
    fn retira_las_etiquetas_del_shortcode_pero_conserva_la_prosa() {
        let html = r#"<p>Antes</p>[su_quote cite="Édgar Restrepo"]El acuerdo incluye la compra[/su_quote]<p>Después</p>"#;
        let l = limpiar(html);
        assert!(!l.texto.contains("cite"), "no debe arrastrar atributos: {}", l.texto);
        assert!(!l.texto.contains("su_quote"));
        // El texto entre las etiquetas es del artículo y tiene que sobrevivir.
        assert!(l.texto.contains("El acuerdo incluye la compra"), "{}", l.texto);
        assert!(l.texto.contains("Antes") && l.texto.contains("Después"));
        assert_eq!(l.diagnostico.shortcodes, vec!["su_quote".to_string()]);
        assert!(l.diagnostico.html_roto);
    }

    #[test]
    fn los_corchetes_de_la_prosa_no_son_shortcodes() {
        // Caso real encontrado en wordpress.org/news: acotaciones editoriales
        // que el detector ingenuo contaba como plugins rotos y se comía.
        let l = limpiar("<p>«No sabíamos nada» [risas]. Josepha [ed] añadió que sí.</p>");
        assert!(l.diagnostico.shortcodes.is_empty(), "{:?}", l.diagnostico.shortcodes);
        assert!(!l.diagnostico.html_roto);
        assert!(l.texto.contains("[risas]"), "la acotación es parte del texto: {}", l.texto);
        assert!(l.texto.contains("[ed]"), "{}", l.texto);
    }

    #[test]
    fn reconoce_shortcodes_conocidos_sin_atributos() {
        assert_eq!(limpiar("<p>x</p>[gallery]").diagnostico.shortcodes, vec!["gallery".to_string()]);
    }

    #[test]
    fn un_par_abierto_y_cerrado_cuenta_aunque_no_tenga_atributos() {
        let l = limpiar("[destacado]Texto[/destacado]");
        assert_eq!(l.diagnostico.shortcodes, vec!["destacado".to_string()]);
        assert!(l.texto.contains("Texto"));
    }

    #[test]
    fn detecta_el_editor_de_bloques_por_las_clases_renderizadas() {
        // Los comentarios <!-- wp: --> solo existen en content.raw, que exige
        // autenticarse. En el HTML renderizado el rastro son las clases.
        assert!(limpiar(r#"<p class="wp-block-paragraph">Hola</p>"#).diagnostico.bloques);
        assert!(limpiar("<!-- wp:paragraph --><p>Hola</p>").diagnostico.bloques);
        assert!(!limpiar("<p>Hola</p>").diagnostico.bloques);
    }

    #[test]
    fn los_comentarios_de_gutenberg_no_llegan_al_texto() {
        let l = limpiar("<!-- wp:paragraph --><p>Solo esto</p><!-- /wp:paragraph -->");
        assert_eq!(l.texto, "Solo esto");
    }

    #[test]
    fn descarta_script_y_estilo() {
        let l = limpiar("<p>Antes</p><script>var x = 1;</script><style>p{color:red}</style><p>Después</p>");
        assert!(!l.texto.contains("var x"));
        assert!(!l.texto.contains("color:red"));
        assert_eq!(l.texto, "Antes\n\nDespués");
    }

    #[test]
    fn una_etiqueta_sin_cerrar_marca_html_roto() {
        assert!(limpiar("<p>Texto <span class=\"x\" ").diagnostico.html_roto);
        assert!(!limpiar("<p>Texto normal</p>").diagnostico.html_roto);
    }

    #[test]
    fn la_clave_de_titulo_ignora_tildes_y_puntuacion() {
        assert_eq!(clave_titulo("Montería: censo de víctimas"), clave_titulo("monteria censo de victimas"));
        assert_ne!(clave_titulo("Paro arrocero"), clave_titulo("Paro cafetero"));
    }
}

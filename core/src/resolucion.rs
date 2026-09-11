//! ¿Dos menciones distintas nombran a la misma entidad?
//!
//! Es lo que separa una lista de nombres de un archivo consultable. La máquina
//! propone los casos dudosos y ordena la cola; decidir es siempre del humano,
//! porque el contexto que desempata —quién era quién en qué año— no está en el
//! texto sino en la cabeza de quien conoce el asunto.

use crate::db::Db;
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Partículas que en español no distinguen a nadie.
const PARTICULAS: &[&str] = &[
    "de", "del", "la", "las", "los", "el", "y", "para", "por", "con", "al",
    "a", "en", "e", "the", "of",
];

pub fn plegar(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n', 'ç' => 'c',
            c if c.is_alphanumeric() || c == ' ' => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Palabras significativas de un nombre, sin partículas ni iniciales sueltas.
pub fn nucleo(s: &str) -> Vec<String> {
    plegar(s)
        .split(' ')
        .filter(|t| t.len() > 1 && !PARTICULAS.contains(t))
        .map(String::from)
        .collect()
}

/// Iniciales, para reconocer «Luz M. Pérez» dentro de «Luz Marina Pérez».
fn iniciales(s: &str) -> Vec<char> {
    plegar(s)
        .split(' ')
        .filter(|t| !t.is_empty() && !PARTICULAS.contains(t))
        .filter_map(|t| t.chars().next())
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Candidata {
    pub nombre: String,
    pub tipo: String,
    pub menciones: i64,
    pub articulos: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Caso {
    pub clave: String,
    pub tipo: String,
    pub confianza: f64,
    pub motivo: String,
    pub a: Candidata,
    pub b: Candidata,
}

/// Cuánto se parecen dos nombres de organización, lugar u obra. 0 = nada,
/// 1 = idénticos. Para personas, cargos, leyes y montos ver `parecido_tipo`.
///
/// No es una distancia de edición: los casos reales de un archivo periodístico
/// son la forma larga frente a la corta («Unidad para la Atención y Reparación
/// Integral a las Víctimas» / «Unidad de Víctimas») y el nombre con inicial
/// frente al completo. Ahí la edición de caracteres no dice nada útil.
pub fn parecido(a: &str, b: &str) -> (f64, &'static str) {
    let (na, nb) = (nucleo(a), nucleo(b));
    if na.is_empty() || nb.is_empty() {
        return (0.0, "");
    }
    if plegar(a) == plegar(b) {
        return (1.0, "mismo nombre normalizado");
    }

    let sa: HashSet<&String> = na.iter().collect();
    let sb: HashSet<&String> = nb.iter().collect();
    let comunes = sa.intersection(&sb).count();
    if comunes == 0 {
        return (0.0, "");
    }

    let menor = na.len().min(nb.len());
    let mayor = na.len().max(nb.len());

    // Contención: todas las palabras del nombre corto están en el largo.
    if comunes == menor {
        // Cuanto mayor la diferencia de longitud, menos seguro: puede ser una
        // forma abreviada o dos organizaciones distintas de la misma familia.
        let conf = 0.55 + 0.3 * (menor as f64 / mayor as f64);
        return (conf, if menor == mayor { "mismas palabras" } else { "el nombre corto está contenido en el largo" });
    }

    // Comparten apellido e inicial: «Luz Marina Pérez» / «Luz M. Pérez Ortega».
    let (ia, ib) = (iniciales(a), iniciales(b));
    let ini_comunes = ia.iter().zip(ib.iter()).take_while(|(x, y)| x == y).count();
    if comunes >= 1 && ini_comunes >= 2 {
        return (0.45 + 0.05 * comunes as f64, "coinciden apellido e iniciales");
    }

    let jaccard = comunes as f64 / (sa.len() + sb.len() - comunes) as f64;
    if jaccard >= 0.5 {
        return (jaccard * 0.8, "comparten la mayoría de las palabras");
    }
    (0.0, "")
}

/// Umbral por debajo del cual ni se propone el caso: la cola tiene que ser
/// corta y densa en dudas reales, o el humano deja de mirarla.
pub const UMBRAL: f64 = 0.4;

/// Lo que se le quita a un cargo antes de compararlo: dice cuándo, no cuál.
/// «Alto Comisionado de Paz» y «ex comisionado de paz» son la misma plaza.
const PREFIJOS_CARGO: &[&str] = &[
    "ex", "exp", "entonces", "actual", "nuevo", "nueva", "nuevos", "antiguo", "antigua", "saliente",
    "encargado", "encargada", "designado", "designada", "electo", "electa", "alto", "alta", "hoy",
    "futuro", "futura", "candidato", "candidata",
];

/// Un cargo sin lo que dice cuándo. También separa el «ex» pegado:
/// «exministro» → «ministro».
fn nucleo_cargo(s: &str) -> Vec<String> {
    let mut v = Vec::new();
    for t in nucleo(s) {
        if PREFIJOS_CARGO.contains(&t.as_str()) {
            continue;
        }
        if let Some(resto) = t.strip_prefix("ex") {
            if resto.len() >= 4 {
                v.push(resto.to_string());
                continue;
            }
        }
        v.push(t);
    }
    v
}

/// Las palabras de `corto` aparecen en `largo`, en el mismo orden.
///
/// Un nombre de persona se acorta quitando piezas, nunca reordenándolas:
/// «Carlos Fernando Galán» → «Galán», «Carlos Galán», «Fernando Galán». Con
/// bolsas de palabras, «Luis Carlos Galán» y «Carlos Fernando Galán» compartían
/// la mitad y se proponían como uno; son dos personas.
fn subsecuencia(corto: &[String], largo: &[String]) -> bool {
    let mut j = 0;
    for t in corto {
        while j < largo.len() && &largo[j] != t {
            j += 1;
        }
        if j == largo.len() {
            return false;
        }
        j += 1;
    }
    true
}

/// Las iniciales de un nombre casan con las del otro en orden y comparten al
/// menos una palabra entera: «Luz M. Pérez Ortega» y «Luz Marina Pérez». Se
/// prueba en los dos sentidos porque cualquiera de los dos puede ser el que
/// abrevia. «Carlos Fernando Galán» y «Luis Carlos Galán» no pasan: C-F-G no
/// está en orden dentro de L-C-G ni al revés.
fn iniciales_en_orden(a: &str, b: &str) -> bool {
    fn en_orden(corto: &[char], largo: &[char]) -> bool {
        let mut j = 0;
        for c in corto {
            while j < largo.len() && largo[j] != *c {
                j += 1;
            }
            if j == largo.len() {
                return false;
            }
            j += 1;
        }
        true
    }
    let (na, nb) = (nucleo(a), nucleo(b));
    let (ia, ib) = (iniciales(a), iniciales(b));
    if ia.len() < 2 || ib.len() < 2 {
        return false;
    }
    // El que abrevia tiene que conservar su apellido —la última palabra— entero
    // en el otro. Compartir el nombre de pila y la inicial del apellido no
    // basta: «Carlos Carrillo» y «Carlos Castaño» son dos personas.
    let apellido_en = |x: &[String], y: &[String]| x.last().map_or(false, |ap| ap.len() >= 3 && y.contains(ap));
    (apellido_en(&na, &nb) && en_orden(&ia, &ib)) || (apellido_en(&nb, &na) && en_orden(&ib, &ia))
}

/// Cuánto se parecen dos nombres, sabiendo de qué tipo son.
///
/// La medida no es la misma para todo. Dos organizaciones que comparten la
/// mayoría de las palabras suelen ser una (forma larga y corta); dos personas
/// que comparten la mayoría de las palabras suelen ser dos, y de la misma
/// familia política: «Carlos Herney Abadía» y «Juan Carlos Abadía» son padre e
/// hijo. Sobre un lote real la regla única proponía 1.928 pares, y los seis
/// primeros eran falsos.
pub fn parecido_tipo(tipo: &str, a: &str, b: &str) -> (f64, &'static str) {
    if plegar(a) == plegar(b) {
        return (1.0, "mismo nombre normalizado");
    }
    match tipo {
        "persona" => {
            let (na, nb) = (nucleo(a), nucleo(b));
            if na.is_empty() || nb.is_empty() {
                return (0.0, "");
            }
            let (corto, largo, ca, cb) = if na.len() <= nb.len() { (&na, &nb, a, b) } else { (&nb, &na, b, a) };
            if subsecuencia(corto, largo) {
                // Un solo apellido puede ser de varios: se propone, pero abajo.
                let conf = if corto.len() == 1 { 0.45 } else { 0.6 + 0.3 * (corto.len() as f64 / largo.len() as f64) };
                return (conf, if corto.len() == 1 { "solo el apellido" } else { "el nombre corto está dentro del completo, en orden" });
            }
            if iniciales_en_orden(ca, cb) {
                return (0.55, "coinciden apellido e iniciales");
            }
            (0.0, "")
        }
        "cargo" => {
            let (na, nb) = (nucleo_cargo(a), nucleo_cargo(b));
            if !na.is_empty() && na == nb {
                return (0.85, "el mismo cargo, sin el «ex» o el «alto»");
            }
            (0.0, "")
        }
        // Una ley es la misma solo si se llama igual; un monto nunca se funde
        // con otro: «un millón» y «un billón» comparten todo menos lo que importa.
        "ley" | "monto" => (0.0, ""),
        _ => parecido(a, b),
    }
}

/// Construye la cola de casos a partir de las menciones anotadas.
pub fn casos(db: &Db, lote_id: i64) -> Result<Vec<Caso>> {
    let filas: Vec<(String, String, i64, i64)> = db.con(|c| {
        let mut st = c.prepare(
            "SELECT texto, tipo, COUNT(*) AS menciones, COUNT(DISTINCT wp_id) AS arts
             FROM anotaciones WHERE lote_id = ?1
             GROUP BY tipo, texto ORDER BY menciones DESC",
        )?;
        let v = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    })?;

    let decididas = decisiones(db, lote_id)?;
    // Lo que la persona ya declaró igual mientras anotaba no vuelve a la cola:
    // preguntarle dos veces lo mismo es la forma más rápida de que deje de
    // mirar la cola.
    let ya_unidas: HashSet<String> = db
        .alias_declarados(lote_id)?
        .into_iter()
        .map(|(_, a, b)| clave_par(&a, &b))
        .collect();

    // Se agrupa por tipo: no tiene sentido comparar una persona con una ley.
    let mut por_tipo: HashMap<String, Vec<&(String, String, i64, i64)>> = HashMap::new();
    for f in &filas {
        por_tipo.entry(f.1.clone()).or_default().push(f);
    }

    let mut out = Vec::new();
    for (tipo, grupo) in por_tipo {
        for i in 0..grupo.len() {
            for j in (i + 1)..grupo.len() {
                let (a, b) = (grupo[i], grupo[j]);
                let (conf, motivo) = parecido_tipo(&tipo, &a.0, &b.0);
                if conf < UMBRAL || motivo.is_empty() {
                    continue;
                }
                let clave = clave_par(&a.0, &b.0);
                if decididas.contains(&clave) || ya_unidas.contains(&clave) {
                    continue;
                }
                out.push(Caso {
                    clave,
                    tipo: tipo.clone(),
                    confianza: (conf * 100.0).round() / 100.0,
                    motivo: motivo.to_string(),
                    a: Candidata { nombre: a.0.clone(), tipo: tipo.clone(), menciones: a.2, articulos: a.3 },
                    b: Candidata { nombre: b.0.clone(), tipo: tipo.clone(), menciones: b.2, articulos: b.3 },
                });
            }
        }
    }

    // Lo más dudoso primero: es donde el juicio humano rinde más. Un caso con
    // 0,95 se decide solo; uno con 0,45 es el que de verdad hay que mirar.
    out.sort_by(|x, y| {
        x.confianza
            .partial_cmp(&y.confianza)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| y.a.menciones.cmp(&x.a.menciones))
    });
    Ok(out)
}

/// Resuelve, dentro de un artículo, las formas cortas de un nombre a la
/// completa: el primer párrafo dice «Gustavo Petro» y el resto dice «Petro».
///
/// Se hace con el cuerpo entero, no por párrafos, porque es ahí donde está la
/// forma completa. La regla es la misma que la de la cola de dudas: la forma
/// corta tiene que estar dentro de la completa en orden («Petro» ⊂ «Gustavo
/// Petro», «Luz M. Pérez» ⊂ «Luz Marina Pérez»), o ser su sigla («JEP» de
/// «Jurisdicción Especial para la Paz»), y tiene que haber **una sola**
/// completa que cuadre: si en el artículo están Álvaro Uribe y Miguel Uribe,
/// «Uribe» se queda sin resolver, porque adivinar sería peor que no decir.
/// Solo personas y organizaciones: un cargo o un lugar no se abrevian así.
pub fn canonizar_articulo(por_parrafo: &mut [Vec<crate::extraccion::Entidad>]) -> usize {
    let mut resueltas = 0;
    for tipo in ["persona", "organizacion"] {
        // Las formas completas del artículo: dos palabras o más, la variante
        // más larga por plegado.
        let mut completas: HashMap<String, String> = HashMap::new();
        for e in por_parrafo.iter().flatten().filter(|e| e.etiqueta == tipo) {
            let n = nucleo(&e.texto);
            if n.len() >= 2 {
                let k = plegar(&e.texto);
                let v = completas.entry(k).or_insert_with(|| e.texto.clone());
                if e.texto.chars().count() > v.chars().count() {
                    *v = e.texto.clone();
                }
            }
        }
        if completas.is_empty() {
            continue;
        }
        let lista: Vec<(String, Vec<String>, String)> = completas
            .iter()
            .map(|(k, t)| (k.clone(), nucleo(t), t.clone()))
            .collect();
        for e in por_parrafo.iter_mut().flatten().filter(|e| e.etiqueta == tipo) {
            let k = plegar(&e.texto);
            if completas.contains_key(&k) {
                continue; // ya es una forma completa
            }
            let corto = nucleo(&e.texto);
            let sigla: Vec<char> = if corto.len() == 1 && e.texto.chars().all(|c| c.is_uppercase() || !c.is_alphabetic()) {
                e.texto.chars().filter(|c| c.is_alphabetic()).flat_map(|c| c.to_lowercase()).collect()
            } else {
                Vec::new()
            };
            let candidatas: Vec<&String> = lista
                .iter()
                .filter(|(kc, nc, tc)| {
                    kc != &k && (
                        (!corto.is_empty() && subsecuencia(&corto, nc))
                        || (!sigla.is_empty() && iniciales(tc) == sigla)
                        || (corto.len() >= 2 && iniciales_en_orden(&e.texto, tc))
                    )
                })
                .map(|(_, _, tc)| tc)
                .collect();
            if candidatas.len() == 1 {
                e.canon = Some(candidatas[0].clone());
                resueltas += 1;
            }
        }
    }
    resueltas
}

/// Lo que ya se sabe de qué nombres son el mismo actor y cuáles no, leído de
/// los ficheros `identidades/*.jsonl` que viajan con la app (y de los que el
/// medio añada en su directorio de datos). Los escribe
/// `sidecar/exportar_identidades.py` a partir de las decisiones de los lotes y de
/// Quién-AI; el formato es una fila por grupo o por par de homónimos:
///
///   {"tipo":"persona","canonico":"Gustavo Petro","formas":["Gustavo Petro Urrego"],"fuentes":["quien-ai"]}
///   {"tipo":"persona","distintas":["Carlos Fernando Galán","Luis Carlos Galán"],"fuentes":["juez:MiniMax-M3"]}
#[derive(Debug, Default)]
pub struct BaseIdentidades {
    /// (tipo, clave del par) → fuentes, para los pares que son el mismo actor.
    pub misma: HashMap<(String, String), String>,
    pub distinta: HashMap<(String, String), String>,
}

#[derive(Deserialize)]
struct FilaBase {
    tipo: String,
    #[serde(default)]
    canonico: Option<String>,
    #[serde(default)]
    formas: Vec<String>,
    #[serde(default)]
    distintas: Vec<String>,
    #[serde(default)]
    fuentes: Vec<String>,
}

impl BaseIdentidades {
    /// Lee todos los `*.jsonl` de los directorios dados; los que no existen se
    /// saltan. Una fila mal formada se ignora, no tumba la carga.
    pub fn cargar(dirs: &[std::path::PathBuf]) -> Self {
        let mut base = Self::default();
        for d in dirs {
            let Ok(entradas) = std::fs::read_dir(d) else { continue };
            for e in entradas.filter_map(|e| e.ok()) {
                let ruta = e.path();
                if ruta.extension().and_then(|x| x.to_str()) != Some("jsonl") {
                    continue;
                }
                let Ok(texto) = std::fs::read_to_string(&ruta) else { continue };
                for linea in texto.lines().filter(|l| !l.trim().is_empty()) {
                    let Ok(f) = serde_json::from_str::<FilaBase>(linea) else { continue };
                    let fuentes = if f.fuentes.is_empty() { "base".to_string() } else { f.fuentes.join(", ") };
                    if let Some(c) = &f.canonico {
                        let mut todos = vec![c.clone()];
                        todos.extend(f.formas.iter().cloned());
                        for i in 0..todos.len() {
                            for j in (i + 1)..todos.len() {
                                base.misma.insert((f.tipo.clone(), clave_par(&todos[i], &todos[j])), fuentes.clone());
                            }
                        }
                    } else if f.distintas.len() == 2 {
                        base.distinta.insert((f.tipo.clone(), clave_par(&f.distintas[0], &f.distintas[1])), fuentes);
                    }
                }
            }
        }
        base
    }

    pub fn es_vacia(&self) -> bool {
        self.misma.is_empty() && self.distinta.is_empty()
    }

    /// Decide en el lote lo que la base ya sabe, con fuente «identidades», y
    /// devuelve cuántos pares decidió. Solo toca pares que estaban en la cola:
    /// lo ya decidido —por quien sea— se respeta.
    pub fn aplicar(&self, db: &Db, lote_id: i64) -> Result<usize> {
        if self.es_vacia() {
            return Ok(0);
        }
        let mut n = 0;
        for c in casos(db, lote_id)? {
            let k = (c.tipo.clone(), c.clave.clone());
            let (decision, fuentes) = if let Some(f) = self.misma.get(&k) {
                ("misma", f)
            } else if let Some(f) = self.distinta.get(&k) {
                ("distinta", f)
            } else {
                continue;
            };
            db.decidir_resolucion(lote_id, &c.clave, &c.a.nombre, &c.b.nombre, &c.tipo, decision, 0.9,
                                  "identidades", Some(&format!("base de identidades ({fuentes})")))?;
            n += 1;
        }
        Ok(n)
    }
}

/// Une los pares «misma» en componentes y devuelve, para cada nombre unido,
/// el nombre canónico de su componente: el más largo, y a igual largo el
/// menor alfabético para que sea estable.
pub fn canonicos(pares: &[(String, String)]) -> HashMap<String, String> {
    let mut padre: HashMap<String, String> = HashMap::new();
    fn raiz(padre: &mut HashMap<String, String>, x: &str) -> String {
        let p = padre.get(x).cloned().unwrap_or_else(|| x.to_string());
        if p == x {
            return p;
        }
        let r = raiz(padre, &p);
        padre.insert(x.to_string(), r.clone());
        r
    }
    for (a, b) in pares {
        padre.entry(a.clone()).or_insert_with(|| a.clone());
        padre.entry(b.clone()).or_insert_with(|| b.clone());
        let (ra, rb) = (raiz(&mut padre, a), raiz(&mut padre, b));
        if ra != rb {
            padre.insert(ra, rb);
        }
    }
    let nombres: Vec<String> = padre.keys().cloned().collect();
    let mut mejor: HashMap<String, String> = HashMap::new();
    for n in &nombres {
        let r = raiz(&mut padre, n);
        let e = mejor.entry(r).or_insert_with(|| n.clone());
        if n.chars().count() > e.chars().count() || (n.chars().count() == e.chars().count() && n < e) {
            *e = n.clone();
        }
    }
    nombres.into_iter().map(|n| { let r = raiz(&mut padre, &n); let c = mejor[&r].clone(); (n, c) }).collect()
}

/// Clave estable de un par, independiente del orden en que se compare.
pub fn clave_par(a: &str, b: &str) -> String {
    let (x, y) = (plegar(a), plegar(b));
    if x <= y { format!("{x}|{y}") } else { format!("{y}|{x}") }
}

fn decisiones(db: &Db, lote_id: i64) -> Result<HashSet<String>> {
    db.con(|c| {
        let mut st = c.prepare(
            "SELECT clave FROM resoluciones WHERE lote_id = ?1 AND decision <> 'posponer'")?;
        let v = st
            .query_map([lote_id], |r| r.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_forma_larga_y_la_corta_de_una_organizacion_se_emparejan() {
        // Caso real del archivo de un medio colombiano.
        let (c, m) = parecido(
            "Unidad para la Atención y Reparación Integral a las Víctimas",
            "Unidad de Víctimas",
        );
        assert!(c >= UMBRAL, "confianza {c} con motivo «{m}»");
        assert!(m.contains("contenido"));
    }

    #[test]
    fn el_nombre_con_inicial_se_empareja_con_el_completo() {
        let (c, m) = parecido("Luz Marina Pérez", "Luz M. Pérez Ortega");
        assert!(c >= UMBRAL, "confianza {c} con motivo «{m}»");
    }

    #[test]
    fn dos_personas_distintas_no_se_emparejan() {
        let (c, _) = parecido("Iván Cepeda", "Álvaro Uribe");
        assert!(c < UMBRAL, "confianza {c}");
    }

    #[test]
    fn compartir_una_particula_no_basta() {
        let (c, _) = parecido("Ministerio de Agricultura", "Ministerio de Educación");
        assert!(c < 0.9, "confianza {c}: no deben fusionarse a ciegas");
    }

    #[test]
    fn el_plegado_ignora_tildes_y_mayusculas() {
        assert_eq!(plegar("Montería"), plegar("MONTERIA"));
        assert_eq!(plegar("Bogotá, D.C."), "bogota d c");
    }

    #[test]
    fn el_nucleo_descarta_particulas() {
        assert_eq!(nucleo("Comisión de la Verdad"), vec!["comision", "verdad"]);
    }

    #[test]
    fn la_clave_del_par_no_depende_del_orden() {
        assert_eq!(clave_par("Uribe", "Petro"), clave_par("Petro", "Uribe"));
    }

    // Los seis primeros pares que la regla de bolsa de palabras proponía sobre
    // el lote de oro. Ninguno es la misma entidad.
    #[test]
    fn dos_personas_con_apellido_y_un_nombre_en_comun_son_dos() {
        for (a, b) in [
            ("Carlos Fernando Galán", "Luis Carlos Galán"),
            ("Carlos Herney Abadía", "Juan Carlos Abadía"),
            ("María Victoria Calle", "María Elisa Calle"),
        ] {
            let (c, m) = parecido_tipo("persona", a, b);
            assert!(c < UMBRAL, "«{a}» / «{b}»: {c} «{m}»");
        }
    }

    #[test]
    fn el_nombre_corto_de_una_persona_va_en_orden() {
        let (c, _) = parecido_tipo("persona", "Carlos Fernando Galán", "Carlos Galán");
        assert!(c >= UMBRAL);
        let (c, _) = parecido_tipo("persona", "Carlos Fernando Galán", "Galán");
        assert!(c >= UMBRAL && c < 0.5, "solo el apellido se propone, pero abajo: {c}");
        let (c, _) = parecido_tipo("persona", "Luz Marina Pérez", "Luz M. Pérez Ortega");
        assert!(c >= UMBRAL, "las iniciales siguen valiendo: {c}");
        let (c, _) = parecido_tipo("persona", "Gustavo Petro", "Petro Urrego");
        assert!(c < UMBRAL, "«Petro Urrego» no está dentro de «Gustavo Petro»: {c}");
        for (a, b) in [("Carlos Carrillo", "Carlos Castaño"), ("Iván Mordisco", "Iván Márquez"), ("Fernando Carrillo", "Juan Fernando Cristo")] {
            let (c, m) = parecido_tipo("persona", a, b);
            assert!(c < UMBRAL, "«{a}» / «{b}» comparten nombre de pila e inicial, nada más: {c} «{m}»");
        }
    }

    #[test]
    fn un_cargo_es_el_mismo_sin_el_ex_o_el_alto() {
        let (c, _) = parecido_tipo("cargo", "Alto Comisionado de Paz", "ex comisionado de paz");
        assert!(c >= UMBRAL);
        let (c, _) = parecido_tipo("cargo", "exministro de Hacienda", "ministro de Hacienda");
        assert!(c >= UMBRAL);
        let (c, _) = parecido_tipo("cargo", "ministro de Hacienda", "ministro del Interior");
        assert!(c < UMBRAL);
    }

    #[test]
    fn leyes_y_montos_no_se_funden_por_parecido() {
        let (c, _) = parecido_tipo("ley", "Ley de Justicia y Paz", "ley de paz total");
        assert_eq!(c, 0.0);
        let (c, _) = parecido_tipo("monto", "un millón de pesos", "un billón de pesos");
        assert_eq!(c, 0.0);
        let (c, _) = parecido_tipo("ley", "Ley 100", "ley 100");
        assert_eq!(c, 1.0);
    }

    #[test]
    fn las_organizaciones_siguen_con_la_regla_de_forma_larga_y_corta() {
        let (c, _) = parecido_tipo("organizacion", "Unidad para la Atención y Reparación Integral a las Víctimas", "Unidad de Víctimas");
        assert!(c >= UMBRAL);
    }

    fn ent(texto: &str, tipo: &str) -> crate::extraccion::Entidad {
        crate::extraccion::Entidad { texto: texto.into(), inicio: 0, fin: texto.len() as i64, etiqueta: tipo.into(), score: 0.9, canon: None }
    }

    #[test]
    fn dentro_del_articulo_el_apellido_se_resuelve_al_nombre_completo() {
        let mut parrafos = vec![
            vec![ent("Gustavo Petro", "persona"), ent("Jurisdicción Especial para la Paz", "organizacion")],
            vec![ent("Petro", "persona"), ent("JEP", "organizacion"), ent("Petro", "persona")],
            vec![ent("Nicolás Petro", "persona"), ent("Bogotá", "lugar")],
        ];
        let n = canonizar_articulo(&mut parrafos);
        // «Petro» cuadra con dos completas (Gustavo y Nicolás): no se resuelve.
        assert!(parrafos[1][0].canon.is_none(), "«Petro» es ambiguo en este artículo");
        assert_eq!(parrafos[1][1].canon.as_deref(), Some("Jurisdicción Especial para la Paz"), "la sigla se resuelve");
        assert_eq!(n, 1);

        let mut solo_uno = vec![vec![ent("Gustavo Petro", "persona")], vec![ent("Petro", "persona"), ent("Uribe", "persona")]];
        canonizar_articulo(&mut solo_uno);
        assert_eq!(solo_uno[1][0].canon.as_deref(), Some("Gustavo Petro"));
        assert!(solo_uno[1][1].canon.is_none(), "«Uribe» no tiene forma completa en el artículo");
    }

    #[test]
    fn la_base_de_identidades_se_lee_y_conoce_los_pares() {
        let dir = std::env::temp_dir().join(format!("legajo-identidades-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("prueba.jsonl"), concat!(
            r#"{"tipo":"persona","canonico":"Gustavo Petro","formas":["Gustavo Petro Urrego","GUSTAVO PETRO"],"fuentes":["quien-ai"]}"#, "\n",
            r#"{"tipo":"persona","distintas":["Carlos Fernando Galán","Luis Carlos Galán"],"fuentes":["juez:x"]}"#, "\n",
            "esto no es json\n",
        )).unwrap();
        let base = BaseIdentidades::cargar(&[dir.clone(), dir.join("no-existe")]);
        let _ = std::fs::remove_dir_all(&dir);
        // Tres formas, dos a dos, pero «GUSTAVO PETRO» y «Gustavo Petro» pliegan
        // igual: quedan dos claves distintas.
        assert_eq!(base.misma.len(), 2);
        assert!(base.misma.contains_key(&("persona".into(), clave_par("GUSTAVO PETRO", "Gustavo Petro Urrego"))));
        assert!(base.distinta.contains_key(&("persona".into(), clave_par("Luis Carlos Galán", "Carlos Fernando Galán"))));
        assert!(!base.misma.contains_key(&("organizacion".into(), clave_par("Gustavo Petro", "GUSTAVO PETRO"))), "el tipo forma parte de la clave");
    }

    #[test]
    fn las_decisiones_encadenan_y_gana_el_nombre_mas_largo() {
        let c = canonicos(&[
            ("Fico".into(), "Fico Gutiérrez".into()),
            ("Federico Gutiérrez".into(), "Fico Gutiérrez".into()),
            ("Petro".into(), "Gustavo Petro".into()),
        ]);
        assert_eq!(c["Fico"], "Federico Gutiérrez");
        assert_eq!(c["Fico Gutiérrez"], "Federico Gutiérrez");
        assert_eq!(c["Petro"], "Gustavo Petro");
        assert!(!c.contains_key("Uribe"));
    }

    #[test]
    fn el_mismo_nombre_normalizado_da_certeza() {
        let (c, _) = parecido("Montería", "monteria");
        assert_eq!(c, 1.0);
    }
}

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

/// Cuánto se parecen dos nombres del mismo tipo. 0 = nada, 1 = idénticos.
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

/// Construye la cola de casos a partir de las menciones anotadas.
pub fn casos(db: &Db, design_id: i64) -> Result<Vec<Caso>> {
    let filas: Vec<(String, String, i64, i64)> = db.con(|c| {
        let mut st = c.prepare(
            "SELECT texto, tipo, COUNT(*) AS menciones, COUNT(DISTINCT wp_id) AS arts
             FROM anotaciones WHERE design_id = ?1
             GROUP BY tipo, texto ORDER BY menciones DESC",
        )?;
        let v = st
            .query_map([design_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    })?;

    let decididas = decisiones(db, design_id)?;
    // Lo que la persona ya declaró igual mientras anotaba no vuelve a la cola:
    // preguntarle dos veces lo mismo es la forma más rápida de que deje de
    // mirar la cola.
    let ya_unidas: HashSet<String> = db
        .alias_declarados(design_id)?
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
                let (conf, motivo) = parecido(&a.0, &b.0);
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

/// Clave estable de un par, independiente del orden en que se compare.
pub fn clave_par(a: &str, b: &str) -> String {
    let (x, y) = (plegar(a), plegar(b));
    if x <= y { format!("{x}|{y}") } else { format!("{y}|{x}") }
}

fn decisiones(db: &Db, design_id: i64) -> Result<HashSet<String>> {
    db.con(|c| {
        let mut st = c.prepare(
            "SELECT clave FROM resoluciones WHERE design_id = ?1 AND decision <> 'posponer'")?;
        let v = st
            .query_map([design_id], |r| r.get::<_, String>(0))?
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

    #[test]
    fn el_mismo_nombre_normalizado_da_certeza() {
        let (c, _) = parecido("Montería", "monteria");
        assert_eq!(c, 1.0);
    }
}

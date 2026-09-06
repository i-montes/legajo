//! Elegir qué trozo del archivo se procesa.
//!
//! No es una muestra estadística: es un alcance de trabajo. La unidad natural
//! de un medio es su propio árbol de secciones —Nacional › Bogotá, Red de
//! Expertos › Red de la Paz— y procesarlo por ahí hace el avance trazable:
//! se sabe qué está hecho y qué falta en términos que la redacción reconoce.

use crate::db::Db;
use crate::error::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct Nodo {
    pub term_id: i64,
    pub nombre: String,
    pub slug: String,
    pub parent: i64,
    /// Artículos con este término exacto.
    pub propios: i64,
    /// Artículos distintos en todo el subárbol: lo que se procesaría al
    /// elegirlo. No es la suma de los hijos, porque en WordPress un artículo
    /// suele llevar la subcategoría **y** la categoría padre, y entre un 64 % y
    /// un 93 % de las veces lleva las dos. Sumar duplicaría; ignorar los hijos
    /// dejaría fuera a los que solo llevan la subcategoría.
    pub total: i64,
    pub hijos: Vec<Nodo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Arbol {
    pub taxonomia: String,
    pub raices: Vec<Nodo>,
    pub censado: i64,
    /// Con fecha inválida: no caen en ningún rango de años.
    pub sin_fecha: i64,
    pub anio_min: Option<i32>,
    pub anio_max: Option<i32>,
}

fn sanear(t: &str) -> String {
    t.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect()
}

pub fn arbol(db: &Db, conn_id: i64, taxonomia: &str) -> Result<Arbol> {
    let tax = sanear(taxonomia);
    db.con(|c| {
        let mut st = c.prepare(
            "SELECT t.term_id, t.name, t.slug, t.parent, COUNT(ct.wp_id)
             FROM terms t
             LEFT JOIN census_terms ct
               ON ct.connection_id = t.connection_id AND ct.taxonomy = t.taxonomy
              AND ct.term_id = t.term_id
             WHERE t.connection_id = ?1 AND t.taxonomy = ?2
             GROUP BY t.term_id",
        )?;
        let filas: Vec<(i64, String, String, i64, i64)> = st
            .query_map(rusqlite::params![conn_id, tax], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        // El total de cada nodo es un COUNT(DISTINCT) sobre su subárbol, no la
        // suma de los hijos: los artículos que llevan padre e hijo a la vez se
        // contarían dos veces.
        fn descendientes(id: i64, filas: &[(i64, String, String, i64, i64)]) -> Vec<i64> {
            let mut v = vec![id];
            for f in filas.iter().filter(|f| f.3 == id) {
                v.extend(descendientes(f.0, filas));
            }
            v
        }

        let contar_subarbol = |ids: &[i64]| -> i64 {
            if ids.is_empty() { return 0; }
            let lista = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            c.query_row(
                &format!(
                    "SELECT COUNT(DISTINCT wp_id) FROM census_terms
                     WHERE connection_id = ?1 AND taxonomy = ?2 AND term_id IN ({lista})"),
                rusqlite::params![conn_id, tax],
                |r| r.get(0),
            ).unwrap_or(0)
        };

        fn construir(
            padre: i64,
            filas: &[(i64, String, String, i64, i64)],
            contar: &dyn Fn(&[i64]) -> i64,
        ) -> Vec<Nodo> {
            let mut v: Vec<Nodo> = filas
                .iter()
                .filter(|f| f.3 == padre)
                .map(|f| {
                    let hijos = construir(f.0, filas, contar);
                    let total = contar(&descendientes(f.0, filas));
                    Nodo {
                        term_id: f.0, nombre: f.1.clone(), slug: f.2.clone(),
                        parent: f.3, propios: f.4, total, hijos,
                    }
                })
                .filter(|n| n.total > 0)
                .collect();
            v.sort_by(|a, b| b.total.cmp(&a.total));
            v
        }

        let censado: i64 = c.query_row(
            "SELECT COUNT(*) FROM census WHERE connection_id = ?1", [conn_id], |r| r.get(0))?;
        let sin_fecha: i64 = c.query_row(
            "SELECT COUNT(*) FROM census WHERE connection_id = ?1 AND date_valid = 0",
            [conn_id], |r| r.get(0))?;
        let anio = |orden: &str| -> Option<i32> {
            c.query_row(
                &format!("SELECT CAST(substr(date,1,4) AS INTEGER) FROM census
                          WHERE connection_id = ?1 AND date_valid = 1
                          ORDER BY date {orden} LIMIT 1"),
                [conn_id], |r| r.get(0)).ok()
        };

        let raices = {
            // El cierre toma prestado `tax`; se limita su vida a este bloque
            // para poder mover el nombre al resultado justo después.
            let contar = contar_subarbol;
            construir(0, &filas, &contar)
        };

        Ok(Arbol {
            taxonomia: tax,
            raices,
            censado,
            sin_fecha,
            anio_min: anio("ASC"),
            anio_max: anio("DESC"),
        })
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Alcance {
    pub taxonomia: String,
    /// Términos elegidos, **ya expandidos con sus descendientes**. Elegir
    /// «Nacional» tiene que arrastrar «Bogotá», o quedarían fuera los artículos
    /// regionales que no llevan también la categoría padre: un tercio de ellos.
    pub terminos: Vec<i64>,
    pub desde_anio: Option<i32>,
    pub hasta_anio: Option<i32>,
    /// Sin fecha válida: quedan fuera si se acota por años.
    pub incluir_sin_fecha: bool,
}

/// Expande una selección con todos los descendientes de cada término.
pub fn expandir(db: &Db, conn_id: i64, taxonomia: &str, elegidos: &[i64]) -> Result<Vec<i64>> {
    let tax = sanear(taxonomia);
    db.con(|c| {
        let mut st = c.prepare(
            "SELECT term_id, parent FROM terms WHERE connection_id = ?1 AND taxonomy = ?2")?;
        let pares: Vec<(i64, i64)> = st
            .query_map(rusqlite::params![conn_id, tax], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        let mut out: Vec<i64> = Vec::new();
        let mut pila: Vec<i64> = elegidos.to_vec();
        while let Some(id) = pila.pop() {
            if out.contains(&id) { continue; }
            out.push(id);
            for (h, p) in &pares {
                if *p == id { pila.push(*h); }
            }
        }
        out.sort_unstable();
        Ok(out)
    })
}

/// Cuántos artículos caen dentro de un alcance, sin crear nada.
pub fn contar(db: &Db, conn_id: i64, a: &Alcance) -> Result<i64> {
    db.con(|c| {
        let (sql, _) = consulta(a);
        Ok(c.query_row(&format!("SELECT COUNT(*) FROM ({sql})"), [conn_id], |r| r.get(0))
            .unwrap_or(0))
    })
}

/// La consulta que define el alcance. Devuelve wp_id y el término principal.
pub(crate) fn consulta(a: &Alcance) -> (String, ()) {
    let tax = sanear(&a.taxonomia);
    let ids = a.terminos.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");

    let mut w = String::from("c.connection_id = ?1");
    if !a.terminos.is_empty() {
        w.push_str(&format!(
            " AND EXISTS (SELECT 1 FROM census_terms x
                          WHERE x.connection_id = c.connection_id AND x.wp_id = c.wp_id
                            AND x.taxonomy = '{tax}' AND x.term_id IN ({ids}))"));
    }
    if a.desde_anio.is_some() || a.hasta_anio.is_some() {
        let mut f = String::new();
        if let Some(d) = a.desde_anio {
            f.push_str(&format!(" AND CAST(substr(c.date,1,4) AS INTEGER) >= {d}"));
        }
        if let Some(h) = a.hasta_anio {
            f.push_str(&format!(" AND CAST(substr(c.date,1,4) AS INTEGER) <= {h}"));
        }
        if a.incluir_sin_fecha {
            w.push_str(&format!(" AND (c.date_valid = 0 OR (c.date_valid = 1{f}))"));
        } else {
            w.push_str(&format!(" AND c.date_valid = 1{f}"));
        }
    } else if !a.incluir_sin_fecha {
        w.push_str(" AND c.date_valid = 1");
    }

    let sel = format!(
        "SELECT c.wp_id,
                COALESCE((SELECT t.name FROM census_terms x
                          JOIN terms t ON t.connection_id = x.connection_id
                                      AND t.taxonomy = x.taxonomy AND t.term_id = x.term_id
                          WHERE x.connection_id = c.connection_id AND x.wp_id = c.wp_id
                            AND x.taxonomy = '{tax}' ORDER BY x.term_id LIMIT 1), 'sin sección') AS seccion,
                c.date
         FROM census c WHERE {w}");
    (sel, ())
}

/// Crea el lote y materializa sus artículos.
///
/// Los `n_calibrar` primeros, repartidos por sección, se marcan para la
/// corrección previa: son los que la persona revisará antes de soltar el
/// extractor sobre el resto.
pub fn crear_lote(
    db: &Db, conn_id: i64, etiqueta: &str, a: &Alcance, n_calibrar: i64,
) -> Result<i64> {
    let (sel, _) = consulta(a);
    db.crear_lote(conn_id, etiqueta, a, &sel, n_calibrar)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alc(terminos: Vec<i64>, desde: Option<i32>, hasta: Option<i32>, sf: bool) -> Alcance {
        Alcance { taxonomia: "categories".into(), terminos, desde_anio: desde, hasta_anio: hasta, incluir_sin_fecha: sf }
    }

    #[test]
    fn sin_terminos_no_filtra_por_seccion() {
        let (sql, _) = consulta(&alc(vec![], None, None, false));
        assert!(!sql.contains("term_id IN"));
        assert!(sql.contains("date_valid = 1"));
    }

    #[test]
    fn los_terminos_entran_en_la_condicion() {
        let (sql, _) = consulta(&alc(vec![4924, 4926], None, None, false));
        assert!(sql.contains("term_id IN (4924,4926)"));
    }

    #[test]
    fn el_rango_de_anios_excluye_las_fechas_danadas_salvo_que_se_pidan() {
        let (a, _) = consulta(&alc(vec![], Some(2015), Some(2020), false));
        assert!(a.contains(">= 2015") && a.contains("<= 2020"));
        assert!(!a.contains("date_valid = 0"));

        let (b, _) = consulta(&alc(vec![], Some(2015), None, true));
        assert!(b.contains("date_valid = 0"), "pedidas explícitamente, entran");
    }

    #[test]
    fn la_taxonomia_no_puede_escapar_de_sus_comillas() {
        // El nombre de la taxonomía se interpola en la consulta, así que lo que
        // importa no es que desaparezcan las palabras sino que no sobreviva
        // ningún carácter capaz de cerrar la comilla o encadenar otra orden.
        let mut a = alc(vec![1], None, None, false);
        a.taxonomia = "cate'gories; DROP TABLE census-- \n".into();
        let saneada = sanear(&a.taxonomia);
        assert!(!saneada.contains('\''), "queda comilla: {saneada}");
        assert!(!saneada.contains(';'), "queda punto y coma: {saneada}");
        assert!(!saneada.contains(' '), "queda espacio: {saneada}");
        assert!(saneada.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'));

        // Y los identificadores legítimos pasan intactos.
        for t in ["categories", "post_tag", "newspack_spnsrs_tax"] {
            assert_eq!(sanear(t), t);
        }
    }
}

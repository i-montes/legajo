//! Lo que el censo permite afirmar sobre un archivo.
//!
//! Todo lo que sale de aquí se calcula en local sobre la base ya descargada: no
//! hay una sola petición de red. Lo que depende del cuerpo de los artículos se
//! marca como estimación solo si el sondeo no llegó a cubrirlo todo, que es el
//! caso de los archivos censados antes de que el censo bajara los cuerpos.

use crate::db::Db;
use crate::error::Result;
use rusqlite::Connection as Sqlite;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AnioFila { pub anio: i32, pub n: i64 }

#[derive(Debug, Serialize)]
pub struct SeccionFila {
    pub term_id: i64,
    pub nombre: String,
    pub slug: String,
    pub parent: i64,
    pub n: i64,
}

#[derive(Debug, Serialize)]
pub struct Sondeo {
    pub n: i64,
    pub palabras_p50: i64,
    pub palabras_p90: i64,
    pub pct_bloques: f64,
    pub pct_cortas: f64,
    pub pct_roto: f64,
    pub shortcodes: Vec<(String, i64)>,
}

#[derive(Debug, Serialize)]
pub struct PerfilArchivo {
    pub censado: i64,
    pub anio_min: Option<i32>,
    pub anio_max: Option<i32>,
    pub por_anio: Vec<AnioFila>,
    pub taxonomia: Option<String>,
    pub secciones: Vec<SeccionFila>,
    pub anomalias: Vec<(String, i64)>,
    /// Taxonomías que sí pueden hacer de eje de secciones, con su número de
    /// términos. Si la elegida no está aquí, el reparto saldría vacío.
    pub taxonomias_usables: Vec<(String, i64)>,
    pub sondeo: Option<Sondeo>,
    pub sin_fecha: i64,
    /// Tramos mensuales ya recorridos y cuántos hay en total.
    ///
    /// Antes se daba el censo por terminado comparándolo con el total que
    /// anuncia el sitio, y eso no podía cumplirse nunca: el archivo crece
    /// mientras se lee —La Silla publica unas 25 piezas al día— y además ese
    /// total incluye las piezas con fecha dañada, que ninguna ventana de fecha
    /// puede alcanzar. El botón de «seguir leyendo» no desaparecía por muchas
    /// veces que se pulsara. Terminado es haber recorrido todos los tramos,
    /// que es un hecho propio y no una carrera contra un blanco móvil.
    pub tramos_hechos: i64,
    pub tramos_totales: i64,
}

/// Un hallazgo de calidad con su decisión pendiente. Alimenta el paso 3.
#[derive(Debug, Serialize)]
pub struct Hallazgo {
    pub clave: String,
    pub titulo: String,
    pub conteo: i64,
    /// Viene de una submuestra y no del recuento exacto.
    ///
    /// Desde que el censo trae el cuerpo con los metadatos, el sondeo cubre
    /// todo lo recorrido y esto queda en falso: son cuentas, no estimaciones.
    /// Sigue existiendo porque un archivo censado por una versión anterior
    /// tiene medido solo un puñado, y decir «12.400» sobre trescientos
    /// artículos mirados sería inventar precisión.
    pub estimado: bool,
    /// Impide muestrear mientras no se decida.
    pub bloquea: bool,
    pub detalle: String,
    pub consecuencia: Option<String>,
    pub ejemplos: Vec<(String, String)>,
    pub opciones: Vec<String>,
}

fn sanear(tax: &str) -> String {
    tax.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect()
}

fn escalar(c: &Sqlite, sql: &str, id: i64) -> i64 {
    c.query_row(sql, [id], |r| r.get::<_, i64>(0)).unwrap_or(0)
}

pub fn perfil(db: &Db, conn_id: i64, taxonomia: Option<&str>) -> Result<PerfilArchivo> {
    db.con(|c| {
        let censado = escalar(c, "SELECT COUNT(*) FROM census WHERE connection_id = ?1", conn_id);
        let sin_fecha = escalar(
            c, "SELECT COUNT(*) FROM census WHERE connection_id = ?1 AND date_valid = 0", conn_id);

        let mut st = c.prepare(
            "SELECT CAST(substr(date,1,4) AS INTEGER) AS a, COUNT(*)
             FROM census WHERE connection_id = ?1 AND date_valid = 1
             GROUP BY a ORDER BY a",
        )?;
        let por_anio: Vec<AnioFila> = st
            .query_map([conn_id], |r| Ok(AnioFila { anio: r.get(0)?, n: r.get(1)? }))?
            .filter_map(|r| r.ok())
            .collect();

        let anio_min = por_anio.first().map(|a| a.anio);
        let anio_max = por_anio.last().map(|a| a.anio);

        // Reparto por término de la taxonomía elegida. json_each recorre el array
        // de ids que el censo guardó por artículo.
        let mut secciones = Vec::new();
        if let Some(tax) = taxonomia {
            let tax = sanear(tax);
            let sql = format!(
                "SELECT t.term_id, t.name, t.slug, t.parent, COUNT(*) AS n
                 FROM census_terms ct
                 JOIN terms t ON t.connection_id = ct.connection_id
                                AND t.taxonomy = ct.taxonomy AND t.term_id = ct.term_id
                 WHERE ct.connection_id = ?1 AND ct.taxonomy = '{tax}'
                 GROUP BY t.term_id ORDER BY n DESC"
            );
            if let Ok(mut st) = c.prepare(&sql) {
                secciones = st
                    .query_map([conn_id], |r| {
                        Ok(SeccionFila {
                            term_id: r.get(0)?, nombre: r.get(1)?, slug: r.get(2)?,
                            parent: r.get(3)?, n: r.get(4)?,
                        })
                    })?
                    .filter_map(|r| r.ok())
                    .collect();
            }
        }

        let mut st = c.prepare(
            "SELECT kind, COUNT(*) FROM anomalies WHERE connection_id = ?1 GROUP BY kind ORDER BY 2 DESC")?;
        let anomalias: Vec<(String, i64)> = st
            .query_map([conn_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        let mut st = c.prepare(
            "SELECT taxonomy, COUNT(*) FROM terms WHERE connection_id = ?1
             GROUP BY taxonomy ORDER BY 2 DESC")?;
        let taxonomias_usables: Vec<(String, i64)> = st
            .query_map([conn_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(PerfilArchivo {
            censado, anio_min, anio_max, por_anio,
            taxonomia: taxonomia.map(String::from),
            secciones, anomalias, taxonomias_usables,
            sondeo: sondeo(c, conn_id),
            sin_fecha,
            tramos_hechos: escalar(
                c, "SELECT COUNT(*) FROM census_windows WHERE connection_id = ?1", conn_id),
            // Un tramo por mes entre el primero y el último artículo, más la
            // cola inicial donde caen las fechas dañadas.
            tramos_totales: match (anio_min, anio_max) {
                (Some(a), Some(b)) if b >= a => ((b - a + 1) * 12 + 1) as i64,
                _ => 0,
            },
        })
    })
}

fn sondeo(c: &Sqlite, conn_id: i64) -> Option<Sondeo> {
    let n = escalar(c, "SELECT COUNT(*) FROM content_probe WHERE connection_id = ?1", conn_id);
    if n == 0 { return None; }

    let percentil = |p: f64| -> i64 {
        let off = ((n as f64 - 1.0) * p).round() as i64;
        c.query_row(
            "SELECT words FROM content_probe WHERE connection_id = ?1 ORDER BY words LIMIT 1 OFFSET ?2",
            rusqlite::params![conn_id, off],
            |r| r.get::<_, i64>(0),
        ).unwrap_or(0)
    };

    let pct = |sql: &str| -> f64 {
        escalar(c, sql, conn_id) as f64 / n as f64 * 100.0
    };

    let mut shortcodes: Vec<(String, i64)> = Vec::new();
    if let Ok(mut st) = c.prepare(
        "SELECT shortcodes FROM content_probe WHERE connection_id = ?1 AND shortcodes <> ''") {
        let mut cuenta: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
        if let Ok(it) = st.query_map([conn_id], |r| r.get::<_, String>(0)) {
            for fila in it.flatten() {
                for sc in fila.split(',').filter(|s| !s.is_empty()) {
                    *cuenta.entry(sc.to_string()).or_insert(0) += 1;
                }
            }
        }
        shortcodes = cuenta.into_iter().collect();
        shortcodes.sort_by(|a, b| b.1.cmp(&a.1));
        shortcodes.truncate(6);
    }

    Some(Sondeo {
        n,
        palabras_p50: percentil(0.5),
        palabras_p90: percentil(0.9),
        pct_bloques: pct("SELECT COUNT(*) FROM content_probe WHERE connection_id = ?1 AND blocks = 1"),
        pct_cortas: pct("SELECT COUNT(*) FROM content_probe WHERE connection_id = ?1 AND words < 120"),
        pct_roto: pct("SELECT COUNT(*) FROM content_probe WHERE connection_id = ?1 AND broken = 1"),
        shortcodes,
    })
}

/// Ejemplos reales del archivo para acompañar un hallazgo. Sin ellos el usuario
/// no puede juzgar si el hallazgo es un problema o una característica del medio.
fn ejemplos(c: &Sqlite, conn_id: i64, sql: &str, limite: i64) -> Vec<(String, String)> {
    let Ok(mut st) = c.prepare(sql) else { return Vec::new() };
    st.query_map(rusqlite::params![conn_id, limite], |r| {
        Ok((
            r.get::<_, Option<String>>(0)?.unwrap_or_else(|| "(sin título)".into()),
            r.get::<_, Option<String>>(1)?.unwrap_or_default(),
        ))
    })
    .map(|it| it.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn hallazgos(db: &Db, conn_id: i64) -> Result<Vec<Hallazgo>> {
    db.con(|c| {
        let total = escalar(c, "SELECT COUNT(*) FROM census WHERE connection_id = ?1", conn_id);
        let mut out = Vec::new();

        // 1 · Fechas dañadas. Bloquea: sin fecha no hay estrato temporal.
        let sin_fecha = escalar(
            c, "SELECT COUNT(*) FROM census WHERE connection_id = ?1 AND date_valid = 0", conn_id);
        if sin_fecha > 0 {
            out.push(Hallazgo {
                clave: "fecha_invalida".into(),
                titulo: "Artículos sin fecha confiable".into(),
                conteo: sin_fecha, estimado: false, bloquea: true,
                detalle: "WordPress devuelve una fecha imposible para estos artículos. Suele ser el rastro de una migración que dejó el campo de publicación sin valor original.".into(),
                consecuencia: Some(format!(
                    "Estos {sin_fecha} artículos no pueden asignarse a un estrato temporal, así que la estratificación por época queda incompleta mientras no decidas."
                )),
                ejemplos: ejemplos(c,
                    conn_id,
                    "SELECT title, date FROM census WHERE connection_id = ?1 AND date_valid = 0 LIMIT ?2",
                    3),
                opciones: vec!["Excluir del muestreo".into(), "Estratificar por sección".into()],
            });
        }

        // 2 · Duplicados: mismo titular normalizado.
        let dups = escalar(c,
            "SELECT COALESCE(SUM(n - 1), 0) FROM (
               SELECT COUNT(*) n FROM census WHERE connection_id = ?1 AND title_key <> ''
               GROUP BY title_key HAVING n > 1)", conn_id);
        if dups > 0 {
            out.push(Hallazgo {
                clave: "duplicados".into(),
                titulo: "Titulares repetidos".into(),
                conteo: dups, estimado: false, bloquea: false,
                detalle: "Artículos distintos con el mismo titular una vez normalizado (sin tildes ni puntuación). Suelen ser republicaciones o versiones actualizadas de la misma nota.".into(),
                consecuencia: None,
                ejemplos: ejemplos(c,
                    conn_id,
                    "SELECT title, 'repetido ' || COUNT(*) || ' veces' FROM census
                     WHERE connection_id = ?1 AND title_key <> ''
                     GROUP BY title_key HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC LIMIT ?2",
                    3),
                opciones: vec!["Conservar solo una versión".into(), "Incluir ambas".into()],
            });
        }

        // 3 · Artículos sin sección: no pueden estratificarse por taxonomía.
        let sin_term = escalar(c,
            "SELECT COUNT(*) FROM anomalies WHERE connection_id = ?1 AND kind = 'sin_terminos'", conn_id);
        if sin_term > 0 {
            out.push(Hallazgo {
                clave: "sin_terminos".into(),
                titulo: "Artículos sin sección asignada".into(),
                conteo: sin_term, estimado: false, bloquea: false,
                detalle: "No tienen ningún término de la taxonomía elegida, así que no caen en ninguna celda del estrato por sección.".into(),
                consecuencia: None,
                ejemplos: ejemplos(c,
                    conn_id,
                    "SELECT c.title, c.date FROM census c JOIN anomalies a
                       ON a.connection_id = c.connection_id AND a.wp_id = c.wp_id
                     WHERE c.connection_id = ?1 AND a.kind = 'sin_terminos' LIMIT ?2",
                    3),
                opciones: vec!["Agrupar en «sin sección»".into(), "Excluir del muestreo".into()],
            });
        }

        // 4 y 5 · Dependen del cuerpo del artículo: se estiman desde el sondeo.
        if let Some(s) = sondeo(c, conn_id) {
            if s.pct_roto > 0.0 {
                let est = (total as f64 * s.pct_roto / 100.0).round() as i64;
                let sc = if s.shortcodes.is_empty() {
                    String::new()
                } else {
                    format!(
                        " Los más frecuentes son {}.",
                        s.shortcodes.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(", ")
                    )
                };
                out.push(Hallazgo {
                    clave: "html_roto".into(),
                    titulo: "HTML roto o shortcodes huérfanos".into(),
                    conteo: est, estimado: s.n < total, bloquea: false,
                    detalle: format!(
                        "Restos de plugins retirados o etiquetas sin cerrar. El texto se recupera con una heurística, pero puede perder pies de foto y citas.{sc}"
                    ),
                    consecuencia: None,
                    ejemplos: ejemplos(c,
                        conn_id,
                        "SELECT c.title, p.shortcodes FROM content_probe p JOIN census c
                           ON c.connection_id = p.connection_id AND c.wp_id = p.wp_id
                         WHERE p.connection_id = ?1 AND p.broken = 1 LIMIT ?2",
                        3),
                    opciones: vec!["Incluir con la limpieza".into(), "Excluir del muestreo".into()],
                });
            }
            if s.pct_cortas > 0.0 {
                let est = (total as f64 * s.pct_cortas / 100.0).round() as i64;
                out.push(Hallazgo {
                    clave: "notas_cortas".into(),
                    titulo: "Notas muy cortas".into(),
                    conteo: est, estimado: s.n < total, bloquea: false,
                    detalle: "Menos de 120 palabras: breves de agenda, resultados y avisos. Rinden pocas entidades por artículo y encarecen la curación.".into(),
                    consecuencia: None,
                    ejemplos: ejemplos(c,
                        conn_id,
                        "SELECT c.title, p.words || ' palabras' FROM content_probe p JOIN census c
                           ON c.connection_id = p.connection_id AND c.wp_id = p.wp_id
                         WHERE p.connection_id = ?1 AND p.words < 120 ORDER BY p.words LIMIT ?2",
                        3),
                    opciones: vec!["Excluir del muestreo".into(), "Incluir tal cual".into()],
                });
            }
        }

        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_censo_se_da_por_terminado_por_tramos_y_no_por_el_total_del_sitio() {
        /* El botón de «seguir leyendo» no se iba por muchas veces que se
           pulsara. La causa no era el botón: se comparaba lo censado contra el
           total que anuncia el sitio, y ese número sube mientras se lee —el
           medio publica todos los días— y además cuenta las piezas con fecha
           dañada, que ninguna ventana de fecha alcanza. La condición no podía
           cumplirse nunca. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-tramos.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = crate::Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json, total_posts)
                 VALUES (1,'x','https://x','{}','d','{}', 500);
                 INSERT INTO census (connection_id, wp_id, date, date_valid) VALUES
                   (1, 1, '2020-01-05T00:00:00', 1),
                   (1, 2, '2021-06-05T00:00:00', 1),
                   (1, 3, '-0001-11-30T00:00:00', 0);",
            )?;
            // Dos años completos: 24 meses más la cola inicial.
            for anio in 2020..=2021 {
                for mes in 1..=12 {
                    c.execute(
                        "INSERT INTO census_windows (connection_id, label, rows) VALUES (1, ?1, 1)",
                        [format!("{anio}-{mes:02}")])?;
                }
            }
            c.execute(
                "INSERT INTO census_windows (connection_id, label, rows) VALUES (1,'anterior a 2020',0)",
                [])?;
            Ok(())
        }).unwrap();

        let p = perfil(&db, 1, None).unwrap();
        assert_eq!(p.tramos_totales, 25, "24 meses más la cola inicial");
        assert_eq!(p.tramos_hechos, 25, "se recorrieron todos");
        assert!(
            p.tramos_hechos >= p.tramos_totales,
            "con todos los tramos hechos el censo está terminado, aunque el sitio \
             anuncie 500 piezas y solo haya 3 censadas: las demás son posteriores \
             o inalcanzables por fecha"
        );
        // Y el criterio viejo, para dejar constancia de por qué no servía.
        assert!(p.censado < 500, "contra el total del sitio nunca habría terminado");

        let _ = std::fs::remove_file(path);
    }
}

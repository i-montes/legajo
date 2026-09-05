//! Comparar lo que extrajo el modelo contra lo que anotó la persona.
//!
//! Se reportan dos varas a la vez, y las dos hacen falta:
//!
//! - **estricta**: mismos límites exactos y mismo tipo. Es lo que importa si el
//!   grafo va a guardar la cadena tal cual aparece.
//! - **laxa**: basta con que se solapen y coincida el tipo. Es lo que importa
//!   si después hay un paso de normalización de nombres.
//!
//! Dar solo una de las dos infla o hunde el resultado según convenga. Un caso
//! real: el modelo devuelve «La Ley 1448 de 2011» donde la persona marcó «Ley
//! 1448 de 2011». En estricta es un fallo doble —un falso positivo y un falso
//! negativo—; en laxa es un acierto con el límite corrido.

use crate::db::Db;
use crate::error::Result;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Default)]
pub struct Marcador {
    pub aciertos: i64,
    pub falsos_positivos: i64,
    pub falsos_negativos: i64,
    pub precision: f64,
    pub cobertura: f64,
    pub f1: f64,
}

impl Marcador {
    fn cerrar(&mut self) {
        let vp = self.aciertos as f64;
        let fp = self.falsos_positivos as f64;
        let fneg = self.falsos_negativos as f64;
        self.precision = if vp + fp > 0.0 { vp / (vp + fp) } else { 0.0 };
        self.cobertura = if vp + fneg > 0.0 { vp / (vp + fneg) } else { 0.0 };
        self.f1 = if self.precision + self.cobertura > 0.0 {
            2.0 * self.precision * self.cobertura / (self.precision + self.cobertura)
        } else {
            0.0
        };
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MarcadorTipo {
    pub tipo: String,
    pub estricto: Marcador,
    pub laxo: Marcador,
    pub anotadas: i64,
    pub extraidas: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Evaluacion {
    pub articulos: i64,
    pub global_estricto: Marcador,
    pub global_laxo: Marcador,
    pub por_tipo: Vec<MarcadorTipo>,
    /// Errores concretos, para poder mirarlos en vez de creerse un número.
    pub ejemplos_fp: Vec<(String, String)>,
    pub ejemplos_fn: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
struct Span {
    pi: i64,
    ini: i64,
    fin: i64,
    texto: String,
    tipo: String,
}

fn solapan(a: &Span, b: &Span) -> bool {
    a.pi == b.pi && a.ini < b.fin && b.ini < a.fin
}

fn exactos(a: &Span, b: &Span) -> bool {
    a.pi == b.pi && a.ini == b.ini && a.fin == b.fin
}

/// Empareja dos listas de marcas de un mismo artículo.
///
/// Cada marca puede casar como mucho con una: sin eso, un modelo que devuelve
/// tres variantes solapadas del mismo nombre sacaría tres aciertos.
fn emparejar(oro: &[Span], pred: &[Span], estricto: bool) -> (i64, i64, i64, Vec<usize>, Vec<usize>) {
    let mut usado_pred = vec![false; pred.len()];
    let mut usado_oro = vec![false; oro.len()];
    let mut aciertos = 0i64;

    for (i, o) in oro.iter().enumerate() {
        for (j, p) in pred.iter().enumerate() {
            if usado_pred[j] || p.tipo != o.tipo {
                continue;
            }
            let casa = if estricto { exactos(o, p) } else { solapan(o, p) };
            if casa {
                usado_pred[j] = true;
                usado_oro[i] = true;
                aciertos += 1;
                break;
            }
        }
    }

    let fp: Vec<usize> = usado_pred.iter().enumerate().filter(|(_, u)| !**u).map(|(j, _)| j).collect();
    let fneg: Vec<usize> = usado_oro.iter().enumerate().filter(|(_, u)| !**u).map(|(i, _)| i).collect();
    (aciertos, fp.len() as i64, fneg.len() as i64, fp, fneg)
}

pub fn evaluar(db: &Db, design_id: i64) -> Result<Evaluacion> {
    db.con(|c| {
        // Solo los artículos que tienen las dos cosas: anotación cerrada y
        // extracción. Medir contra artículos sin anotar daría precisión falsa.
        let mut st = c.prepare(
            "SELECT DISTINCT a.wp_id FROM anotaciones a
             WHERE a.design_id = ?1
               AND EXISTS (SELECT 1 FROM extraidas e
                           WHERE e.design_id = a.design_id AND e.wp_id = a.wp_id)",
        )?;
        let ids: Vec<i64> = st
            .query_map([design_id], |r| r.get::<_, i64>(0))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        let leer = |tabla: &str, wp: i64| -> Vec<Span> {
            let sql = format!(
                "SELECT pi, ini, fin, texto, {} FROM {tabla} WHERE design_id = ?1 AND wp_id = ?2",
                if tabla == "extraidas" { "etiqueta" } else { "tipo" }
            );
            c.prepare(&sql)
                .and_then(|mut s| {
                    let v = s
                        .query_map(rusqlite::params![design_id, wp], |r| {
                            Ok(Span {
                                pi: r.get(0)?, ini: r.get(1)?, fin: r.get(2)?,
                                texto: r.get(3)?, tipo: r.get(4)?,
                            })
                        })?
                        .filter_map(|r| r.ok())
                        .collect::<Vec<_>>();
                    Ok(v)
                })
                .unwrap_or_default()
        };

        let mut ge = Marcador::default();
        let mut gl = Marcador::default();
        let mut por_tipo: HashMap<String, (Marcador, Marcador, i64, i64)> = HashMap::new();
        let mut ej_fp: Vec<(String, String)> = Vec::new();
        let mut ej_fn: Vec<(String, String)> = Vec::new();

        for wp in &ids {
            let oro = leer("anotaciones", *wp);
            let pred = leer("extraidas", *wp);

            let (ae, fpe, fne, idx_fp, idx_fn) = emparejar(&oro, &pred, true);
            ge.aciertos += ae; ge.falsos_positivos += fpe; ge.falsos_negativos += fne;

            let (al, fpl, fnl, _, _) = emparejar(&oro, &pred, false);
            gl.aciertos += al; gl.falsos_positivos += fpl; gl.falsos_negativos += fnl;

            for j in idx_fp.iter().take(3) {
                if ej_fp.len() < 12 {
                    ej_fp.push((pred[*j].texto.clone(), pred[*j].tipo.clone()));
                }
            }
            for i in idx_fn.iter().take(3) {
                if ej_fn.len() < 12 {
                    ej_fn.push((oro[*i].texto.clone(), oro[*i].tipo.clone()));
                }
            }

            // Por tipo, filtrando ambas listas al tipo en cuestión.
            let mut tipos: Vec<String> = oro.iter().chain(pred.iter()).map(|s| s.tipo.clone()).collect();
            tipos.sort();
            tipos.dedup();
            for t in tipos {
                let o: Vec<Span> = oro.iter().filter(|s| s.tipo == t).cloned().collect();
                let p: Vec<Span> = pred.iter().filter(|s| s.tipo == t).cloned().collect();
                let e = por_tipo.entry(t).or_insert_with(|| (Marcador::default(), Marcador::default(), 0, 0));
                let (a, fp, fneg, _, _) = emparejar(&o, &p, true);
                e.0.aciertos += a; e.0.falsos_positivos += fp; e.0.falsos_negativos += fneg;
                let (a, fp, fneg, _, _) = emparejar(&o, &p, false);
                e.1.aciertos += a; e.1.falsos_positivos += fp; e.1.falsos_negativos += fneg;
                e.2 += o.len() as i64;
                e.3 += p.len() as i64;
            }
        }

        ge.cerrar();
        gl.cerrar();
        let mut lista: Vec<MarcadorTipo> = por_tipo
            .into_iter()
            .map(|(tipo, (mut est, mut lax, an, ex))| {
                est.cerrar();
                lax.cerrar();
                MarcadorTipo { tipo, estricto: est, laxo: lax, anotadas: an, extraidas: ex }
            })
            .collect();
        lista.sort_by(|a, b| b.anotadas.cmp(&a.anotadas));

        Ok(Evaluacion {
            articulos: ids.len() as i64,
            global_estricto: ge,
            global_laxo: gl,
            por_tipo: lista,
            ejemplos_fp: ej_fp,
            ejemplos_fn: ej_fn,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(pi: i64, ini: i64, fin: i64, texto: &str, tipo: &str) -> Span {
        Span { pi, ini, fin, texto: texto.into(), tipo: tipo.into() }
    }

    #[test]
    fn un_acierto_exacto_cuenta_en_las_dos_varas() {
        let oro = vec![s(0, 3, 11, "Montería", "lugar")];
        let pred = vec![s(0, 3, 11, "Montería", "lugar")];
        assert_eq!(emparejar(&oro, &pred, true).0, 1);
        assert_eq!(emparejar(&oro, &pred, false).0, 1);
    }

    #[test]
    fn el_limite_corrido_falla_en_estricta_y_acierta_en_laxa() {
        // Caso real: el modelo se lleva el artículo dentro del nombre de la ley.
        let oro = vec![s(2, 3, 22, "Ley 1448 de 2011", "ley")];
        let pred = vec![s(2, 0, 22, "La Ley 1448 de 2011", "ley")];
        let (a_est, fp, fneg, _, _) = emparejar(&oro, &pred, true);
        assert_eq!((a_est, fp, fneg), (0, 1, 1), "en estricta cuenta doble error");
        assert_eq!(emparejar(&oro, &pred, false).0, 1, "en laxa es acierto");
    }

    #[test]
    fn el_tipo_equivocado_nunca_es_acierto() {
        let oro = vec![s(0, 0, 8, "Montería", "lugar")];
        let pred = vec![s(0, 0, 8, "Montería", "organizacion")];
        assert_eq!(emparejar(&oro, &pred, false).0, 0);
    }

    #[test]
    fn tres_variantes_solapadas_no_dan_tres_aciertos() {
        // Sin emparejamiento uno a uno, un modelo verboso sacaría nota alta.
        let oro = vec![s(0, 0, 16, "Luz Marina Pérez", "persona")];
        let pred = vec![
            s(0, 0, 16, "Luz Marina Pérez", "persona"),
            s(0, 4, 16, "Marina Pérez", "persona"),
            s(0, 0, 3, "Luz", "persona"),
        ];
        let (a, fp, _, _, _) = emparejar(&oro, &pred, false);
        assert_eq!(a, 1);
        assert_eq!(fp, 2, "las otras dos son falsos positivos");
    }

    #[test]
    fn marcas_en_parrafos_distintos_no_se_confunden() {
        let oro = vec![s(0, 0, 8, "Montería", "lugar")];
        let pred = vec![s(1, 0, 8, "Montería", "lugar")];
        assert_eq!(emparejar(&oro, &pred, false).0, 0);
    }

    #[test]
    fn el_marcador_calcula_f1_correctamente() {
        let mut m = Marcador { aciertos: 8, falsos_positivos: 2, falsos_negativos: 2, ..Default::default() };
        m.cerrar();
        assert!((m.precision - 0.8).abs() < 1e-9);
        assert!((m.cobertura - 0.8).abs() < 1e-9);
        assert!((m.f1 - 0.8).abs() < 1e-9);
    }

    #[test]
    fn sin_predicciones_la_cobertura_es_cero_y_la_precision_no_explota() {
        let mut m = Marcador { aciertos: 0, falsos_positivos: 0, falsos_negativos: 5, ..Default::default() };
        m.cerrar();
        assert_eq!(m.precision, 0.0);
        assert_eq!(m.cobertura, 0.0);
        assert_eq!(m.f1, 0.0);
    }
}

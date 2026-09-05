//! El resultado del diagnóstico: cuánto costaría de verdad curar el archivo.
//!
//! La cifra que importa no es la precisión de ningún modelo, sino los minutos
//! de curación humana por cada cien artículos, multiplicados por el tamaño del
//! archivo y comparados con las horas que la redacción puede poner. Si no
//! cuadra, el alcance hay que recortarlo antes de seguir; ese es el propósito
//! de toda la fase.

use crate::db::Db;
use crate::error::Result;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Tiempos {
    pub articulos: i64,
    /// Mediana, no media: la distribución tiene cola larga y un artículo con
    /// cuarenta entidades ambiguas domina el promedio.
    pub mediana_seg: i64,
    pub p90_seg: i64,
    /// Mediana de los primeros y de los últimos, para ver la curva de aprendizaje.
    pub primeros_seg: Option<i64>,
    pub ultimos_seg: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct Proyeccion {
    /// Minutos por cada 100 artículos, según la mediana global.
    pub min_por_100: f64,
    /// Lo mismo usando solo los últimos artículos anotados. Es la cifra buena:
    /// proyectar desde los primeros sobreestima el coste, a veces al doble.
    pub min_por_100_maduro: Option<f64>,
    pub universo: i64,
    pub horas_totales: f64,
    pub horas_totales_maduro: Option<f64>,
}

#[derive(Debug, Serialize)]
pub struct DensidadTipo {
    pub tipo: String,
    pub menciones: i64,
    pub por_articulo: f64,
}

#[derive(Debug, Serialize)]
pub struct TramoFrecuencia {
    pub etiqueta: String,
    pub entidades: i64,
    pub pct: f64,
}

#[derive(Debug, Serialize)]
pub struct Reporte {
    pub anotados: i64,
    pub muestra: i64,
    pub universo: i64,
    pub tiempos: Option<Tiempos>,
    pub proyeccion: Option<Proyeccion>,
    pub entidades_por_articulo: f64,
    pub densidad: Vec<DensidadTipo>,
    pub curva: Vec<TramoFrecuencia>,
    pub entidades_distintas: i64,
    pub resueltos: i64,
    pub pospuestos: i64,
}

/// Horas disponibles frente a horas necesarias. La puerta de salida.
#[derive(Debug, Serialize)]
pub struct Puerta {
    pub horas_necesarias: f64,
    pub horas_disponibles: f64,
    pub cabe: bool,
    /// Cuántos artículos sí caben con la capacidad declarada.
    pub alcance_viable: i64,
    pub pct_archivo: f64,
}

pub fn puerta(horas_necesarias: f64, personas: f64, horas_semana: f64, semanas: f64, universo: i64) -> Puerta {
    let disponibles = personas * horas_semana * semanas;
    let viable = if horas_necesarias > 0.0 {
        ((disponibles / horas_necesarias) * universo as f64).min(universo as f64)
    } else {
        universo as f64
    };
    Puerta {
        horas_necesarias,
        horas_disponibles: disponibles,
        cabe: disponibles >= horas_necesarias,
        alcance_viable: viable.round() as i64,
        pct_archivo: if universo > 0 { viable / universo as f64 * 100.0 } else { 0.0 },
    }
}

fn mediana(v: &[i64]) -> i64 {
    if v.is_empty() { return 0; }
    let m = v.len() / 2;
    if v.len() % 2 == 1 { v[m] } else { (v[m - 1] + v[m]) / 2 }
}

fn percentil(v: &[i64], p: f64) -> i64 {
    if v.is_empty() { return 0; }
    let i = (((v.len() - 1) as f64) * p).round() as usize;
    v[i.min(v.len() - 1)]
}

pub fn reporte(db: &Db, design_id: i64, universo: i64) -> Result<Reporte> {
    db.con(|c| {
        let muestra: i64 = c.query_row(
            "SELECT COUNT(*) FROM sample WHERE design_id = ?1", [design_id], |r| r.get(0))?;

        // Tiempos, en el orden en que se anotaron.
        let mut st = c.prepare(
            "SELECT segundos FROM tiempos WHERE design_id = ?1 AND cerrado = 1 ORDER BY orden")?;
        let en_orden: Vec<i64> = st
            .query_map([design_id], |r| r.get::<_, i64>(0))?
            .filter_map(|r| r.ok())
            .collect();
        let anotados = en_orden.len() as i64;

        let tiempos = if anotados > 0 {
            let mut ord = en_orden.clone();
            ord.sort_unstable();
            // Se comparan tercios solo si hay material suficiente para que la
            // comparación signifique algo.
            let (primeros, ultimos) = if anotados >= 12 {
                let k = (anotados / 3) as usize;
                let mut a: Vec<i64> = en_orden[..k].to_vec();
                let mut b: Vec<i64> = en_orden[en_orden.len() - k..].to_vec();
                a.sort_unstable();
                b.sort_unstable();
                (Some(mediana(&a)), Some(mediana(&b)))
            } else {
                (None, None)
            };
            Some(Tiempos {
                articulos: anotados,
                mediana_seg: mediana(&ord),
                p90_seg: percentil(&ord, 0.9),
                primeros_seg: primeros,
                ultimos_seg: ultimos,
            })
        } else {
            None
        };

        let proyeccion = tiempos.as_ref().map(|t| {
            let por_100 = |seg: i64| seg as f64 * 100.0 / 60.0;
            let min100 = por_100(t.mediana_seg);
            let min100_maduro = t.ultimos_seg.map(por_100);
            let horas = |m: f64| universo as f64 / 100.0 * m / 60.0;
            Proyeccion {
                min_por_100: min100,
                min_por_100_maduro: min100_maduro,
                universo,
                horas_totales: horas(min100),
                horas_totales_maduro: min100_maduro.map(horas),
            }
        });

        // Densidad de entidades por tipo.
        let mut st = c.prepare(
            "SELECT tipo, COUNT(*) FROM anotaciones WHERE design_id = ?1 GROUP BY tipo ORDER BY 2 DESC")?;
        let crudas: Vec<(String, i64)> = st
            .query_map([design_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        let arts_con_anotacion: i64 = c.query_row(
            "SELECT COUNT(DISTINCT wp_id) FROM anotaciones WHERE design_id = ?1",
            [design_id], |r| r.get(0))?;
        let base = arts_con_anotacion.max(1) as f64;
        let densidad: Vec<DensidadTipo> = crudas
            .iter()
            .map(|(t, n)| DensidadTipo {
                tipo: t.clone(),
                menciones: *n,
                por_articulo: *n as f64 / base,
            })
            .collect();
        let total_menciones: i64 = crudas.iter().map(|x| x.1).sum();

        // Curva de frecuencia: en cuántos artículos aparece cada entidad.
        // Las formas que la persona declaró equivalentes cuentan como una sola
        // entidad: «Ómar Yepes» y «Yepes» no son dos nombres en el índice.
        let mut st = c.prepare(
            "SELECT COUNT(DISTINCT wp_id) AS arts FROM anotaciones
             WHERE design_id = ?1
             GROUP BY COALESCE(grupo, tipo || '|' || texto)")?;
        let apariciones: Vec<i64> = st
            .query_map([design_id], |r| r.get::<_, i64>(0))?
            .filter_map(|r| r.ok())
            .collect();
        let distintas = apariciones.len() as i64;
        let tramos: [(&str, i64, i64); 5] = [
            ("1 artículo", 1, 1), ("2—4", 2, 4), ("5—19", 5, 19),
            ("20—49", 20, 49), ("50+", 50, i64::MAX),
        ];
        let curva: Vec<TramoFrecuencia> = tramos
            .iter()
            .map(|(et, lo, hi)| {
                let n = apariciones.iter().filter(|a| **a >= *lo && **a <= *hi).count() as i64;
                TramoFrecuencia {
                    etiqueta: et.to_string(),
                    entidades: n,
                    pct: if distintas > 0 { n as f64 * 100.0 / distintas as f64 } else { 0.0 },
                }
            })
            .collect();

        let resueltos: i64 = c.query_row(
            "SELECT COUNT(*) FROM resoluciones WHERE design_id = ?1 AND decision <> 'posponer'",
            [design_id], |r| r.get(0)).unwrap_or(0);
        let pospuestos: i64 = c.query_row(
            "SELECT COUNT(*) FROM resoluciones WHERE design_id = ?1 AND decision = 'posponer'",
            [design_id], |r| r.get(0)).unwrap_or(0);

        Ok(Reporte {
            anotados, muestra, universo, tiempos, proyeccion,
            entidades_por_articulo: total_menciones as f64 / base,
            densidad, curva, entidades_distintas: distintas, resueltos, pospuestos,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_mediana_no_se_deja_arrastrar_por_la_cola() {
        // Un artículo monstruoso no puede definir el coste de todos.
        let v = vec![100, 110, 120, 130, 4000];
        assert_eq!(mediana(&v), 120);
    }

    #[test]
    fn la_puerta_dice_cuanto_alcance_cabe_cuando_no_cabe_todo() {
        // 2.400 horas necesarias, 480 disponibles: cabe una quinta parte.
        let p = puerta(2400.0, 2.0, 20.0, 12.0, 50_000);
        assert!(!p.cabe);
        assert_eq!(p.horas_disponibles, 480.0);
        assert_eq!(p.alcance_viable, 10_000);
        assert!((p.pct_archivo - 20.0).abs() < 0.01);
    }

    #[test]
    fn la_puerta_no_promete_mas_articulos_de_los_que_hay() {
        let p = puerta(10.0, 4.0, 40.0, 12.0, 5_000);
        assert!(p.cabe);
        assert_eq!(p.alcance_viable, 5_000);
    }

    #[test]
    fn el_percentil_90_cae_en_la_cola() {
        let v: Vec<i64> = (1..=10).collect();
        assert_eq!(percentil(&v, 0.9), 9);
        assert_eq!(percentil(&v, 1.0), 10);
        assert!(percentil(&v, 0.9) > mediana(&v));
    }
}

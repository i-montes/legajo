//! Diseño y sorteo de la muestra.
//!
//! Todo ocurre en local sobre el censo ya descargado. La única entrada de azar
//! es la semilla, y es explícita: sin ella el sorteo no es reproducible y el
//! diagnóstico deja de valer como evidencia frente a un tercero.

use crate::db::Db;
use crate::error::Result;
use crate::perfil::AnioFila;
use rusqlite::Connection as Sqlite;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Epoca {
    pub etiqueta: String,
    pub desde: i32,
    pub hasta: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diseno {
    pub n: usize,
    pub semilla: String,
    pub epocas: Vec<Epoca>,
    /// Términos de la taxonomía elegida que quedan fuera del universo.
    pub excluir_terminos: Vec<i64>,
    pub excluir_sin_fecha: bool,
    pub taxonomia: Option<String>,
    /// Reparto entre épocas: equilibrado o proporcional al archivo.
    pub equilibrar_epocas: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Celda {
    pub epoca: String,
    pub seccion: String,
    pub seccion_id: i64,
    pub universo: i64,
    pub asignado: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Plan {
    pub celdas: Vec<Celda>,
    pub universo: i64,
    pub asignado: i64,
    pub avisos: Vec<String>,
    /// Reparto del archivo frente al de la muestra, por época y por sección.
    pub sesgo_epoca: Vec<Sesgo>,
    pub sesgo_seccion: Vec<Sesgo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Sesgo {
    pub etiqueta: String,
    pub archivo_pct: f64,
    pub muestra_pct: f64,
}

/// Corta el archivo en épocas de volumen parecido.
///
/// No se reparte por décadas naturales: un archivo que publica cuatro veces más
/// desde 2020 dejaría la época fundacional con una muestra inservible. Cortar
/// por volumen da épocas comparables entre sí, que es lo que hace falta para
/// preguntarse si el método se degrada con el material viejo.
pub fn proponer_epocas(por_anio: &[AnioFila], cuantas: usize) -> Vec<Epoca> {
    if por_anio.is_empty() || cuantas == 0 {
        return Vec::new();
    }
    let cuantas = cuantas.min(por_anio.len());
    let total: i64 = por_anio.iter().map(|a| a.n).sum();
    let objetivo = total as f64 / cuantas as f64;

    let mut epocas = Vec::new();
    let mut ini = 0usize;
    let mut acumulado = 0i64;

    for (i, fila) in por_anio.iter().enumerate() {
        acumulado += fila.n;
        let ultimo = i + 1 == por_anio.len();
        let restantes_epocas = cuantas - epocas.len();
        let restantes_anios = por_anio.len() - i - 1;

        // Se cierra la época cuando ya lleva su cuota, salvo que cerrarla dejara
        // sin años suficientes para las que faltan.
        let cerrar = ultimo
            || (acumulado as f64 >= objetivo && restantes_epocas > 1 && restantes_anios >= restantes_epocas - 1);

        if cerrar {
            let desde = por_anio[ini].anio;
            let hasta = fila.anio;
            epocas.push(Epoca {
                etiqueta: if desde == hasta { desde.to_string() } else { format!("{desde}—{hasta}") },
                desde,
                hasta,
            });
            ini = i + 1;
            acumulado = 0;
            if epocas.len() == cuantas {
                // Lo que quede se acumula en la última época.
                if ini < por_anio.len() {
                    let ult = epocas.last_mut().unwrap();
                    ult.hasta = por_anio.last().unwrap().anio;
                    ult.etiqueta = if ult.desde == ult.hasta {
                        ult.desde.to_string()
                    } else {
                        format!("{}—{}", ult.desde, ult.hasta)
                    };
                }
                break;
            }
        }
    }
    epocas
}

fn sanear(t: &str) -> String {
    t.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect()
}

/// Condición SQL del universo, con las exclusiones del diseño aplicadas.
fn filtro(d: &Diseno) -> String {
    let mut w = String::from("c.connection_id = ?1");
    if d.excluir_sin_fecha {
        w.push_str(" AND c.date_valid = 1");
    }
    if !d.excluir_terminos.is_empty() {
        if let Some(tax) = &d.taxonomia {
            let tax = sanear(tax);
            let ids = d
                .excluir_terminos
                .iter()
                .map(|i| i.to_string())
                .collect::<Vec<_>>()
                .join(",");
            w.push_str(&format!(
                " AND NOT EXISTS (SELECT 1 FROM census_terms x
                                  WHERE x.connection_id = c.connection_id AND x.wp_id = c.wp_id
                                    AND x.taxonomy = '{tax}' AND x.term_id IN ({ids}))"
            ));
        }
    }
    w
}

/// Expresión que da la época de una fila a partir de su año.
fn caso_epoca(d: &Diseno) -> String {
    let mut s = String::from("CASE ");
    for e in &d.epocas {
        s.push_str(&format!(
            "WHEN CAST(substr(c.date,1,4) AS INTEGER) BETWEEN {} AND {} THEN '{}' ",
            e.desde, e.hasta, e.etiqueta.replace('\'', "")
        ));
    }
    s.push_str("ELSE 'sin fecha' END");
    s
}

/// Expresión que da la sección: el primer término de la taxonomía elegida.
///
/// Un artículo puede llevar varias secciones; para estratificar hace falta una
/// sola, y se toma la de menor id, que es estable entre ejecuciones.
fn caso_seccion(d: &Diseno) -> String {
    match &d.taxonomia {
        Some(tax) => {
            let tax = sanear(tax);
            format!(
                "COALESCE((SELECT MIN(x.term_id) FROM census_terms x
                           WHERE x.connection_id = c.connection_id AND x.wp_id = c.wp_id
                             AND x.taxonomy = '{tax}'), -1)"
            )
        }
        None => "-1".into(),
    }
}

pub fn plan(db: &Db, conn_id: i64, d: &Diseno) -> Result<Plan> {
    db.con(|c| {
        let sql = format!(
            "SELECT {epoca} AS ep, {seccion} AS sec, COUNT(*) AS n
             FROM census c WHERE {filtro}
             GROUP BY ep, sec ORDER BY ep, n DESC",
            epoca = caso_epoca(d),
            seccion = caso_seccion(d),
            filtro = filtro(d)
        );
        let mut st = c.prepare(&sql)?;
        let crudas: Vec<(String, i64, i64)> = st
            .query_map([conn_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .filter_map(|r| r.ok())
            .collect();

        let nombres = nombres_terminos(c, conn_id, d)?;
        let universo: i64 = crudas.iter().map(|x| x.2).sum();
        let mut avisos = Vec::new();

        if universo == 0 {
            avisos.push("El universo quedó vacío tras aplicar las exclusiones.".into());
            return Ok(Plan { celdas: vec![], universo: 0, asignado: 0, avisos,
                             sesgo_epoca: vec![], sesgo_seccion: vec![] });
        }

        // Reparto entre épocas.
        let epocas: Vec<String> = {
            let mut v: Vec<String> = Vec::new();
            for (e, _, _) in &crudas {
                if !v.contains(e) { v.push(e.clone()); }
            }
            v
        };
        let n_total = d.n.min(universo as usize) as i64;
        let cuota_epoca = reparto(
            &epocas
                .iter()
                .map(|e| crudas.iter().filter(|x| &x.0 == e).map(|x| x.2).sum::<i64>())
                .collect::<Vec<_>>(),
            n_total,
            d.equilibrar_epocas,
        );

        // Dentro de cada época, siempre proporcional a la sección.
        let mut celdas = Vec::new();
        for (i, ep) in epocas.iter().enumerate() {
            let en_epoca: Vec<&(String, i64, i64)> = crudas.iter().filter(|x| &x.0 == ep).collect();
            let univs: Vec<i64> = en_epoca.iter().map(|x| x.2).collect();
            let cuotas = reparto(&univs, cuota_epoca[i], false);
            for (j, fila) in en_epoca.iter().enumerate() {
                celdas.push(Celda {
                    epoca: ep.clone(),
                    seccion: nombres.get(&fila.1).cloned().unwrap_or_else(|| "sin sección".into()),
                    seccion_id: fila.1,
                    universo: fila.2,
                    asignado: cuotas[j].min(fila.2),
                });
            }
        }

        let asignado: i64 = celdas.iter().map(|c| c.asignado).sum();
        let vacias = celdas.iter().filter(|c| c.asignado == 0).count();
        if vacias > 0 {
            avisos.push(format!(
                "{vacias} celdas quedan sin ningún artículo: son demasiado pequeñas para la muestra pedida."
            ));
        }
        let flacas = celdas.iter().filter(|c| c.asignado > 0 && c.asignado < 5).count();
        if flacas > 0 {
            avisos.push(format!(
                "{flacas} celdas quedan con menos de cinco artículos. Sirven para el conjunto, pero no para afirmar nada sobre esa celda por separado."
            ));
        }

        let sesgo_epoca = sesgo(&celdas, universo, asignado, |c| c.epoca.clone());
        let sesgo_seccion = sesgo(&celdas, universo, asignado, |c| c.seccion.clone());

        Ok(Plan { celdas, universo, asignado, avisos, sesgo_epoca, sesgo_seccion })
    })
}

fn nombres_terminos(c: &Sqlite, conn_id: i64, d: &Diseno) -> Result<std::collections::HashMap<i64, String>> {
    let mut m = std::collections::HashMap::new();
    if let Some(tax) = &d.taxonomia {
        let mut st = c.prepare(
            "SELECT term_id, name FROM terms WHERE connection_id = ?1 AND taxonomy = ?2")?;
        for r in st.query_map(rusqlite::params![conn_id, tax], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))? {
            if let Ok((k, v)) = r { m.insert(k, v); }
        }
    }
    m.insert(-1, "sin sección".into());
    Ok(m)
}

/// Reparte `n` entre grupos, por tamaño o a partes iguales, con resto por mayor
/// residuo para que la suma cuadre exactamente con `n`.
fn reparto(universos: &[i64], n: i64, equilibrado: bool) -> Vec<i64> {
    let k = universos.len();
    if k == 0 || n <= 0 { return vec![0; k]; }
    let total: i64 = universos.iter().sum();
    if total == 0 { return vec![0; k]; }
    // No se puede sortear más artículos de los que existen.
    let n = n.min(total);

    let ideales: Vec<f64> = if equilibrado {
        // Equilibrado, pero sin pedirle a un grupo más de lo que tiene.
        let base = n as f64 / k as f64;
        universos.iter().map(|u| base.min(*u as f64)).collect()
    } else {
        universos.iter().map(|u| n as f64 * *u as f64 / total as f64).collect()
    };

    // El suelo va acotado por el universo de cada celda: en un archivo con
    // muchas celdas diminutas, la cuota proporcional puede pedirle a una celda
    // más artículos de los que tiene.
    let mut out: Vec<i64> = ideales
        .iter()
        .zip(universos)
        .map(|(x, u)| (x.floor() as i64).min(*u))
        .collect();

    let mut restos: Vec<(usize, f64)> = ideales
        .iter()
        .enumerate()
        .map(|(i, x)| (i, x - x.floor()))
        .collect();
    restos.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // El resto se reparte por mayor residuo y se repite mientras quede hueco.
    // Lo que una celda pequeña no puede absorber lo recogen las demás; el bucle
    // termina cuando no cabe nada más, no por un número fijo de vueltas.
    let mut faltan = n - out.iter().sum::<i64>();
    while faltan > 0 {
        let mut colocado = false;
        for (i, _) in &restos {
            if faltan == 0 { break; }
            if out[*i] < universos[*i] {
                out[*i] += 1;
                faltan -= 1;
                colocado = true;
            }
        }
        if !colocado { break; }
    }
    out
}

fn sesgo(celdas: &[Celda], universo: i64, asignado: i64, clave: impl Fn(&Celda) -> String) -> Vec<Sesgo> {
    let mut orden: Vec<String> = Vec::new();
    let mut acc: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
    for c in celdas {
        let k = clave(c);
        if !orden.contains(&k) { orden.push(k.clone()); }
        let e = acc.entry(k).or_insert((0, 0));
        e.0 += c.universo;
        e.1 += c.asignado;
    }
    orden
        .into_iter()
        .map(|k| {
            let (u, a) = acc[&k];
            Sesgo {
                etiqueta: k,
                archivo_pct: if universo > 0 { u as f64 * 100.0 / universo as f64 } else { 0.0 },
                muestra_pct: if asignado > 0 { a as f64 * 100.0 / asignado as f64 } else { 0.0 },
            }
        })
        .collect()
}

/// Orden pseudoaleatorio estable para un artículo dado una semilla.
///
/// Se calcula aquí y no en SQL a propósito: SQLite no trae una función de hash
/// decente, y el sorteo tiene que dar exactamente el mismo resultado en
/// cualquier máquina y versión para que la muestra sea auditable.
fn orden(wp_id: i64, semilla: i64) -> u64 {
    // splitmix64
    let mut z = (wp_id as u64).wrapping_mul(0x9E3779B97F4A7C15) ^ (semilla as u64);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

#[derive(Debug, Clone, Serialize)]
pub struct FilaMuestra {
    pub wp_id: i64,
    pub epoca: String,
    pub seccion: String,
}

/// Ejecuta el sorteo sobre el plan. Determinista: misma semilla, misma muestra.
pub fn sortear(db: &Db, conn_id: i64, d: &Diseno, plan: &Plan) -> Result<Vec<FilaMuestra>> {
    let semilla = semilla_num(&d.semilla);

    // Se trae el universo entero con su celda y se ordena en memoria. Son
    // decenas de miles de enteros: cabe de sobra y evita depender del motor.
    let universo: Vec<(i64, String, i64)> = db.con(|c| {
        let sql = format!(
            "SELECT c.wp_id, {epoca} AS ep, {seccion} AS sec
             FROM census c WHERE {filtro}",
            epoca = caso_epoca(d),
            seccion = caso_seccion(d),
            filtro = filtro(d)
        );
        let mut st = c.prepare(&sql)?;
        let v = st
            .query_map([conn_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    })?;

    let mut por_celda: std::collections::HashMap<(String, i64), Vec<i64>> = Default::default();
    for (id, ep, sec) in universo {
        por_celda.entry((ep, sec)).or_default().push(id);
    }

    let mut out = Vec::new();
    for celda in &plan.celdas {
        if celda.asignado <= 0 { continue; }
        let Some(ids) = por_celda.get_mut(&(celda.epoca.clone(), celda.seccion_id)) else { continue };
        // Desempate por wp_id: dos artículos con el mismo hash no pueden
        // depender del orden en que los devolvió la base.
        ids.sort_by_key(|id| (orden(*id, semilla), *id));
        for id in ids.iter().take(celda.asignado as usize) {
            out.push(FilaMuestra {
                wp_id: *id,
                epoca: celda.epoca.clone(),
                seccion: celda.seccion.clone(),
            });
        }
    }
    Ok(out)
}

/// Convierte la semilla en un entero estable. La misma cadena da siempre el
/// mismo sorteo, en cualquier máquina y en cualquier versión.
pub fn semilla_num(s: &str) -> i64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    (h & 0x7fff_ffff_ffff) as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anios(v: &[(i32, i64)]) -> Vec<AnioFila> {
        v.iter().map(|(a, n)| AnioFila { anio: *a, n: *n }).collect()
    }

    #[test]
    fn las_epocas_equilibran_volumen_no_calendario() {
        // Archivo que cuadruplica su producción a partir de 2020, como es normal
        // en un medio digital. Por décadas la época vieja quedaría sin muestra.
        let a = anios(&[
            (2016, 100), (2017, 100), (2018, 100), (2019, 100),
            (2020, 400), (2021, 400),
        ]);
        let e = proponer_epocas(&a, 2);
        assert_eq!(e.len(), 2);
        assert_eq!(e[0].desde, 2016);
        assert_eq!(e[1].hasta, 2021);
        // El primer corte cae antes de la explosión de volumen.
        assert!(e[0].hasta <= 2020, "cortó en {}", e[0].hasta);
    }

    #[test]
    fn las_epocas_cubren_todos_los_anios_sin_huecos() {
        let a = anios(&[(2009, 10), (2010, 20), (2011, 30), (2012, 40), (2013, 50)]);
        let e = proponer_epocas(&a, 3);
        assert_eq!(e.first().unwrap().desde, 2009);
        assert_eq!(e.last().unwrap().hasta, 2013);
        for par in e.windows(2) {
            assert_eq!(par[0].hasta + 1, par[1].desde, "hueco entre épocas");
        }
    }

    #[test]
    fn nunca_pide_mas_epocas_que_anios() {
        let e = proponer_epocas(&anios(&[(2020, 5), (2021, 5)]), 8);
        assert!(e.len() <= 2);
    }

    #[test]
    fn el_reparto_proporcional_suma_exactamente_n() {
        let r = reparto(&[100, 200, 700], 100, false);
        assert_eq!(r.iter().sum::<i64>(), 100);
        assert!(r[2] > r[1] && r[1] > r[0]);
    }

    #[test]
    fn el_reparto_equilibrado_da_partes_parecidas() {
        let r = reparto(&[100, 200, 700], 90, true);
        assert_eq!(r.iter().sum::<i64>(), 90);
        assert_eq!(r, vec![30, 30, 30]);
    }

    #[test]
    fn el_equilibrado_no_pide_mas_de_lo_que_hay() {
        // El grupo pequeño solo tiene 5: lo que le sobra va a los demás.
        let r = reparto(&[5, 500, 500], 90, true);
        assert_eq!(r.iter().sum::<i64>(), 90);
        assert_eq!(r[0], 5);
    }

    #[test]
    fn el_reparto_nunca_excede_el_universo_de_una_celda() {
        let r = reparto(&[2, 2, 2], 100, false);
        assert!(r.iter().zip([2, 2, 2]).all(|(a, u)| *a <= u));
    }

    #[test]
    fn el_orden_es_estable_y_depende_de_la_semilla() {
        assert_eq!(orden(4211, 99), orden(4211, 99));
        assert_ne!(orden(4211, 99), orden(4211, 100));
        assert_ne!(orden(4211, 99), orden(4212, 99));
    }

    #[test]
    fn el_orden_reparte_sin_sesgo_por_id() {
        // Ids consecutivos no deben salir en bloque: si el hash conservara el
        // orden, la muestra serían los artículos más antiguos de cada celda.
        let mut ids: Vec<i64> = (1000..1100).collect();
        ids.sort_by_key(|id| orden(*id, 7));
        let primeros: Vec<i64> = ids.iter().take(10).copied().collect();
        let consecutivos = primeros.windows(2).filter(|p| p[1] == p[0] + 1).count();
        assert!(consecutivos <= 2, "el sorteo conserva el orden original: {primeros:?}");
    }

    #[test]
    fn la_semilla_es_estable_y_distingue() {
        assert_eq!(semilla_num("legajo-2026-a3f"), semilla_num("legajo-2026-a3f"));
        assert_ne!(semilla_num("legajo-2026-a3f"), semilla_num("legajo-2026-b91"));
    }
}

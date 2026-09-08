//! Enseñarle al extractor qué está haciendo mal, antes de soltarlo sobre el
//! archivo entero.
//!
//! El modelo es de vocabulario abierto y no se reentrena aquí. Lo que sí se
//! puede hacer con unas pocas correcciones humanas es afinar cómo se usa:
//!
//! - **Umbral por tipo.** No hay razón para que «persona» y «evento» compartan
//!   corte de confianza si uno acierta y el otro produce ruido.
//! - **Lista de bloqueo.** Lo que la persona borra una y otra vez —«gobierno»,
//!   «político», «bandas criminales»— deja de proponerse.
//! - **Diccionario.** Lo que la persona añade porque el modelo no lo vio, se
//!   marca siempre.
//!
//! Nada de esto exige volver a pasar el modelo: las puntuaciones quedaron
//! guardadas al extraer, así que reajustar el umbral es aritmética y el efecto
//! se ve al instante.

use crate::db::Db;
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Calibracion {
    /// Corte de confianza por tipo.
    pub umbrales: HashMap<String, f64>,
    /// Lo que no se propone nunca: (tipo, texto en minúscula).
    ///
    /// Lleva el tipo porque el rechazo lo tiene. Cuando bloqueaba solo por
    /// texto, dos rechazos de «Colombia» como *organización* escondieron 1.229
    /// menciones de «Colombia» como *lugar* en un archivo colombiano. Las
    /// listas guardadas con el formato viejo —solo texto— se descartan al leer:
    /// eran justamente las que hacían daño.
    #[serde(deserialize_with = "bloqueos_con_tipo")]
    pub bloqueadas: Vec<(String, String)>,
    /// Textos que se marcan siempre, con su tipo.
    pub diccionario: Vec<(String, String)>,
}

/// Acepta pares (tipo, texto) y deja caer las entradas del formato anterior,
/// que eran solo texto y bloqueaban sin mirar el tipo.
fn bloqueos_con_tipo<'de, D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Vec<(String, String)>, D::Error> {
    let crudo: Vec<serde_json::Value> = Deserialize::deserialize(d)?;
    Ok(crudo
        .into_iter()
        .filter_map(|v| {
            let par = v.as_array()?;
            Some((par.first()?.as_str()?.to_string(), par.get(1)?.as_str()?.to_string()))
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct MarcadorTipo {
    pub tipo: String,
    pub umbral: f64,
    pub antes_f1: f64,
    pub despues_f1: f64,
    pub propuestas: i64,
    pub aceptadas: i64,
    pub rechazadas: i64,
    pub anadidas: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Resultado {
    pub articulos: i64,
    pub calibracion: Calibracion,
    pub por_tipo: Vec<MarcadorTipo>,
    pub antes_f1: f64,
    pub despues_f1: f64,
    /// Lo que más veces se rechazó: es lo que el bot tiene que dejar de proponer.
    pub rechazos_frecuentes: Vec<(String, String, i64)>,
}

const UMBRAL_MIN: f64 = 0.30;

/// Los cortes que se prueban. De 0,30 a 0,85 de cinco en cinco; de ahí a 0,99
/// de uno en uno. El modelo actual satura —mediana 0,87, casi la mitad de lo
/// que devuelve por encima de 0,9— y con el techo anterior de 0,90 la zona
/// donde había que cortar fino ni siquiera se podía probar.
fn cortes() -> Vec<f64> {
    let mut v: Vec<f64> = (0..=11).map(|i| UMBRAL_MIN + i as f64 * 0.05).collect();
    v.extend((86..=99).map(|i| i as f64 / 100.0));
    v.into_iter().map(|x| (x * 100.0).round() / 100.0).collect()
}

/// Una propuesta del modelo, con lo que la persona decidió sobre ella.
struct Propuesta {
    tipo: String,
    score: f64,
    /// La persona la conservó (con o sin cambio de tipo).
    aceptada: bool,
}

fn f1(vp: f64, fp: f64, fneg: f64) -> f64 {
    let p = if vp + fp > 0.0 { vp / (vp + fp) } else { 0.0 };
    let c = if vp + fneg > 0.0 { vp / (vp + fneg) } else { 0.0 };
    if p + c > 0.0 { 2.0 * p * c / (p + c) } else { 0.0 }
}

/// El corte que maximiza F1 para un tipo, dadas las decisiones de la persona.
///
/// Subir el umbral quita falsos positivos pero también aciertos: el óptimo es
/// donde el intercambio deja de compensar, y depende del tipo.
fn mejor_umbral(props: &[&Propuesta], anadidas: f64) -> (f64, f64, f64) {
    let base = {
        let vp = props.iter().filter(|p| p.aceptada).count() as f64;
        let fp = props.len() as f64 - vp;
        f1(vp, fp, anadidas)
    };

    // Pasos enteros: acumular en coma flotante producía umbrales como
    // 0,49999999999999994, que además de feos en la configuración hacen
    // comparaciones frágiles.
    let mut mejor = (UMBRAL_MIN, base);
    for t in cortes() {
        let sobre: Vec<_> = props.iter().filter(|p| p.score >= t).collect();
        let vp = sobre.iter().filter(|p| p.aceptada).count() as f64;
        let fp = sobre.len() as f64 - vp;
        // Lo aceptado que cae por debajo del corte pasa a ser un fallo de cobertura.
        let perdidas = props.iter().filter(|p| p.aceptada && p.score < t).count() as f64;
        let s = f1(vp, fp, anadidas + perdidas);
        // Ante empate gana el umbral más bajo: conserva más candidatos, y
        // descartar de más es peor que proponer de más, que se borra con una tecla.
        if s > mejor.1 + 1e-9 {
            mejor = (t, s);
        }
    }
    (mejor.0, base, mejor.1)
}

pub fn calibrar(db: &Db, lote_id: i64) -> Result<Resultado> {
    // Lo que la revisión estaba enseñando cuando la persona revisó. Una
    // propuesta que nunca llegó a la pantalla —por debajo del corte, o
    // bloqueada— no fue rechazada por nadie, y contarla como rechazo fabricaba
    // bloqueos de la nada: así acabó «Colombia» en la lista.
    let vigente = db.calibracion(lote_id)?.unwrap_or_default();
    let bloqueadas_vigentes: HashSet<(String, String)> = vigente
        .bloqueadas.iter().map(|(t, x)| (t.clone(), x.to_lowercase())).collect();
    let visible = |tipo: &str, texto: &str, score: f64| -> bool {
        // El mismo criterio que `Db::propuestas`, que es quien sirve la pantalla.
        score >= vigente.umbrales.get(tipo).copied().unwrap_or(0.50)
            && !bloqueadas_vigentes.contains(&(tipo.to_string(), texto.to_lowercase()))
    };

    db.con(|c| {
        // Artículos con extracción y con revisión humana cerrada: solo ahí se
        // sabe qué se aceptó y qué se rechazó.
        let mut st = c.prepare(
            "SELECT DISTINCT e.wp_id FROM extraidas e
             WHERE e.lote_id = ?1
               AND EXISTS (SELECT 1 FROM tiempos t
                           WHERE t.lote_id = e.lote_id AND t.wp_id = e.wp_id AND t.cerrado = 1)",
        )?;
        let ids: Vec<i64> = st.query_map([lote_id], |r| r.get(0))?.filter_map(|r| r.ok()).collect();
        drop(st);

        let mut props: Vec<Propuesta> = Vec::new();
        let mut anadidas: HashMap<String, i64> = HashMap::new();
        let mut dicc: Vec<(String, String)> = Vec::new();
        let mut rechazos: HashMap<(String, String), i64> = HashMap::new();

        for wp in &ids {
            let leer = |tabla: &str| -> Vec<(i64, i64, i64, String, String, f64)> {
                let campo = if tabla == "extraidas" { "etiqueta" } else { "tipo" };
                let score = if tabla == "extraidas" { "score" } else { "1.0" };
                let sql = format!(
                    "SELECT pi, ini, fin, texto, {campo}, {score} FROM {tabla}
                     WHERE lote_id = ?1 AND wp_id = ?2");
                c.prepare(&sql)
                    .and_then(|mut s| {
                        let v = s.query_map(rusqlite::params![lote_id, wp], |r| {
                            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
                        })?.filter_map(|r| r.ok()).collect::<Vec<_>>();
                        Ok(v)
                    })
                    .unwrap_or_default()
            };

            let propuestas: Vec<_> = leer("extraidas").into_iter()
                .filter(|(_, _, _, texto, etiqueta, score)| visible(etiqueta, texto, *score))
                .collect();
            let humanas = leer("anotaciones");

            // Una propuesta se considera aceptada si la persona dejó una marca
            // que la solapa. Si además le cambió el tipo, el acierto es del
            // tramo, no de la etiqueta: cuenta como rechazo para ese tipo.
            let mut usadas: HashSet<usize> = HashSet::new();
            for (pi, ini, fin, texto, etiqueta, score) in &propuestas {
                let casada = humanas.iter().position(|(hpi, hini, hfin, _, htipo, _)| {
                    hpi == pi && ini < hfin && hini < fin && htipo == etiqueta
                });
                if let Some(k) = casada {
                    usadas.insert(k);
                }
                let aceptada = casada.is_some();
                if !aceptada {
                    *rechazos.entry((etiqueta.clone(), texto.to_lowercase())).or_insert(0) += 1;
                }
                props.push(Propuesta { tipo: etiqueta.clone(), score: *score, aceptada });
            }

            // Lo que la persona marcó y el modelo no propuso.
            for (k, (_, _, _, texto, tipo, _)) in humanas.iter().enumerate() {
                if usadas.contains(&k) { continue; }
                *anadidas.entry(tipo.clone()).or_insert(0) += 1;
                if texto.len() >= 3 {
                    dicc.push((texto.clone(), tipo.clone()));
                }
            }
        }

        // Se bloquea lo rechazado dos veces o más: una vez puede ser el
        // contexto; dos veces es un patrón.
        let mut bloqueadas: Vec<(String, String)> = rechazos.iter()
            .filter(|(_, n)| **n >= 2)
            .map(|((tipo, texto), _)| (tipo.clone(), texto.clone()))
            .collect();
        bloqueadas.sort();
        bloqueadas.dedup();

        dicc.sort();
        dicc.dedup();

        let mut tipos: Vec<String> = props.iter().map(|p| p.tipo.clone()).collect();
        tipos.extend(anadidas.keys().cloned());
        tipos.sort();
        tipos.dedup();

        let mut umbrales = HashMap::new();
        let mut por_tipo = Vec::new();
        let (mut ga, mut gd, mut gn) = (0.0, 0.0, 0.0);

        for t in tipos {
            let del_tipo: Vec<&Propuesta> = props.iter().filter(|p| p.tipo == t).collect();
            let add = *anadidas.get(&t).unwrap_or(&0) as f64;
            let (umbral, antes, despues) = mejor_umbral(&del_tipo, add);
            umbrales.insert(t.clone(), umbral);
            let acep = del_tipo.iter().filter(|p| p.aceptada).count() as i64;
            por_tipo.push(MarcadorTipo {
                tipo: t, umbral,
                antes_f1: (antes * 100.0).round() / 100.0,
                despues_f1: (despues * 100.0).round() / 100.0,
                propuestas: del_tipo.len() as i64,
                aceptadas: acep,
                rechazadas: del_tipo.len() as i64 - acep,
                anadidas: add as i64,
            });
            ga += antes; gd += despues; gn += 1.0;
        }
        por_tipo.sort_by(|a, b| b.propuestas.cmp(&a.propuestas));

        let mut frec: Vec<(String, String, i64)> = rechazos.into_iter()
            .filter(|(_, n)| *n >= 2)
            .map(|((tipo, texto), n)| (tipo, texto, n))
            .collect();
        frec.sort_by(|a, b| b.2.cmp(&a.2));
        frec.truncate(20);

        Ok(Resultado {
            articulos: ids.len() as i64,
            calibracion: Calibracion { umbrales, bloqueadas, diccionario: dicc },
            por_tipo,
            antes_f1: if gn > 0.0 { (ga / gn * 100.0).round() / 100.0 } else { 0.0 },
            despues_f1: if gn > 0.0 { (gd / gn * 100.0).round() / 100.0 } else { 0.0 },
            rechazos_frecuentes: frec,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(tipo: &str, score: f64, aceptada: bool) -> Propuesta {
        Propuesta { tipo: tipo.into(), score, aceptada }
    }

    #[test]
    fn sube_el_umbral_cuando_lo_de_baja_confianza_es_basura() {
        // Lo que el modelo propone con poca confianza se rechaza siempre; lo
        // que propone con mucha se acepta. El corte debe subir.
        let v = vec![
            p("evento", 0.35, false), p("evento", 0.40, false), p("evento", 0.45, false),
            p("evento", 0.80, true), p("evento", 0.85, true), p("evento", 0.90, true),
        ];
        let refs: Vec<&Propuesta> = v.iter().collect();
        let (umbral, antes, despues) = mejor_umbral(&refs, 0.0);
        assert!(umbral >= 0.5, "umbral {umbral}");
        assert_eq!(umbral, (umbral * 100.0).round() / 100.0, "el umbral debe ser un valor limpio");
        assert!(despues > antes, "{antes} → {despues}");
    }

    #[test]
    fn no_toca_el_umbral_si_todo_se_acepta() {
        let v: Vec<Propuesta> = (0..6).map(|i| p("persona", 0.4 + i as f64 * 0.08, true)).collect();
        let refs: Vec<&Propuesta> = v.iter().collect();
        let (umbral, antes, despues) = mejor_umbral(&refs, 0.0);
        assert_eq!(umbral, UMBRAL_MIN, "subirlo solo perdería aciertos");
        assert!((despues - antes).abs() < 1e-9);
    }

    #[test]
    fn subir_el_umbral_no_compensa_si_cuesta_demasiados_aciertos() {
        // Un único falso positivo de baja confianza entre muchos aciertos
        // también de baja confianza: cortar haría más daño que bien.
        let mut v = vec![p("persona", 0.35, false)];
        v.extend((0..12).map(|_| p("persona", 0.36, true)));
        let refs: Vec<&Propuesta> = v.iter().collect();
        let (umbral, _, _) = mejor_umbral(&refs, 0.0);
        assert!(umbral < 0.4, "umbral {umbral}: cortaría doce aciertos por un fallo");
    }

    /// Lo que nunca llegó a la pantalla no cuenta como rechazado.
    ///
    /// Es el fallo real: «Colombia» propuesta dos veces como organización a
    /// 0,3 —por debajo del corte, invisible en la revisión— contaba como dos
    /// rechazos, entraba en la lista de bloqueo, y la lista bloqueaba por texto
    /// sin mirar el tipo: 1.229 menciones de «Colombia» como lugar escondidas.
    #[test]
    fn lo_que_no_se_vio_no_se_rechazo() {
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-calibrar.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');
                 INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1, 100), (1, 101);
                 INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1, 102);
                 -- Visible y conservada; invisible (0,3) dos veces como organización.
                 INSERT INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score) VALUES
                   (1,100,0, 0, 8,'Colombia','lugar',0.96),
                   (1,100,0,20,28,'Colombia','organizacion',0.31),
                   (1,101,0, 0, 8,'Colombia','lugar',0.95),
                   (1,101,0,20,28,'Colombia','organizacion',0.33);
                 -- La persona conservó lo que vio (auto = 1) y cerró los dos.
                 INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo, auto) VALUES
                   (1,100,'m0-0-8',0,0,8,'Colombia','lugar',1),
                   (1,101,'m0-0-8',0,0,8,'Colombia','lugar',1);
                 INSERT INTO tiempos (lote_id, wp_id, segundos, cerrado) VALUES (1,100,30,1), (1,101,30,1);",
            )?;
            Ok(())
        }).unwrap();
        let r = calibrar(&db, 1).unwrap();
        assert!(r.calibracion.bloqueadas.is_empty(),
            "nadie rechazó nada: {:?}", r.calibracion.bloqueadas);
        let lugar = r.por_tipo.iter().find(|m| m.tipo == "lugar").expect("hay lugar");
        assert_eq!((lugar.propuestas, lugar.aceptadas, lugar.rechazadas), (2, 2, 0));
        assert!(r.por_tipo.iter().all(|m| m.tipo != "organizacion"),
            "las de 0,3 nunca se vieron: no hay nada que decir de organización");

        // Y si un día sí se rechaza dos veces, bloquea ese tipo y no los demás.
        let cal = Calibracion {
            umbrales: HashMap::new(),
            bloqueadas: vec![("organizacion".into(), "colombia".into())],
            diccionario: vec![],
        };
        db.guardar_calibracion(1, &cal).unwrap();
        let (m, _) = db.propuestas(1, 100).unwrap();
        assert!(m.iter().any(|x| x.texto == "Colombia" && x.tipo == "lugar"),
            "el bloqueo de organización no puede esconder el lugar: {m:?}");

        // Una lista del formato viejo —solo texto— se descarta al leer.
        db.con(|c| {
            c.execute("UPDATE lotes SET calibracion_json = ?1 WHERE id = 1",
                [r#"{"umbrales":{},"bloqueadas":["colombia"],"diccionario":[]}"#])?;
            Ok(())
        }).unwrap();
        let vieja = db.calibracion(1).unwrap().expect("se lee");
        assert!(vieja.bloqueadas.is_empty(), "el formato viejo bloqueaba sin tipo: fuera");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn f1_se_comporta() {
        assert!((f1(8.0, 2.0, 2.0) - 0.8).abs() < 1e-9);
        assert_eq!(f1(0.0, 0.0, 5.0), 0.0);
    }
}

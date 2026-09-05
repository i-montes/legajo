//! Cuánto tardan las consultas que la interfaz llama al pintar cada paso.
use legajo_core::{muestreo, perfil, Db};
use std::time::Instant;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ruta = std::env::temp_dir().join("legajo-censo-prueba.sqlite");
    let db = Db::open(&ruta)?;
    let conn_id = 1;

    let t = Instant::now();
    let n = db.rellenar_terminos_censo(conn_id)?;
    println!("relleno de terminos {:>8.0} ms  ({n} relaciones)", t.elapsed().as_secs_f64() * 1000.0);

    let t = Instant::now();
    let p = perfil::perfil(&db, conn_id, Some("categories"))?;
    println!("perfil_archivo      {:>8.0} ms  ({} filas censadas)", t.elapsed().as_secs_f64() * 1000.0, p.censado);

    let t = Instant::now();
    let h = perfil::hallazgos(&db, conn_id)?;
    println!("hallazgos_archivo   {:>8.0} ms  ({} hallazgos)", t.elapsed().as_secs_f64() * 1000.0, h.len());

    let epocas = muestreo::proponer_epocas(&p.por_anio, 4);
    let d = muestreo::Diseno {
        n: 400, semilla: "prueba".into(), epocas,
        excluir_terminos: vec![], excluir_sin_fecha: true,
        taxonomia: Some("categories".into()), equilibrar_epocas: true,
    };

    let t = Instant::now();
    let plan = muestreo::plan(&db, conn_id, &d)?;
    println!("plan_muestra        {:>8.0} ms  ({} celdas)", t.elapsed().as_secs_f64() * 1000.0, plan.celdas.len());

    let t = Instant::now();
    let filas = muestreo::sortear(&db, conn_id, &d, &plan)?;
    println!("sortear_muestra     {:>8.0} ms  ({} sorteados)", t.elapsed().as_secs_f64() * 1000.0, filas.len());
    Ok(())
}

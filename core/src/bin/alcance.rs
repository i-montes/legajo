//! Comprueba el árbol y el conteo de alcance contra el censo real.
use legajo_core::{alcance, Db};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let ruta = dirs_local().join("legajo.sqlite");
    let db = Db::open(&ruta)?;
    let a = alcance::arbol(&db, 1, "categories")?;
    println!("censado {} · sin fecha {} · {:?}—{:?}\n", a.censado, a.sin_fecha, a.anio_min, a.anio_max);
    for r in a.raices.iter().take(6) {
        println!("  {:<26} {:>6} ({} propios, {} hijos)", r.nombre, r.total, r.propios, r.hijos.len());
    }
    println!("\n── conteos de alcance ──");
    for (nombre, terms, desde, hasta) in [
        ("todo el archivo",            vec![],      None,       None),
        ("Nacional (con regiones)",    vec![4924],  None,       None),
        ("Nacional 2020—2026",         vec![4924],  Some(2020), Some(2026)),
        ("Detector de mentiras",       vec![4984],  None,       None),
        ("Quién es quién",             vec![5027],  None,       None),
    ] {
        let expandidos = alcance::expandir(&db, 1, "categories", &terms)?;
        let al = alcance::Alcance {
            taxonomia: "categories".into(), terminos: expandidos,
            desde_anio: desde, hasta_anio: hasta, incluir_sin_fecha: false,
        };
        let n = alcance::contar(&db, 1, &al)?;
        // A 3,6 s por artículo en CPU, medido en el sondeo.
        println!("  {:<26} {:>6} artículos · {:>5.1} h de cómputo", nombre, n, n as f64 * 3.6 / 3600.0);
    }
    Ok(())
}

fn dirs_local() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("HOME").unwrap()).join(".local/share/com.legajo.app")
}

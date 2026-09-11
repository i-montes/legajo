//! Los casos dudosos de identidad de un lote, en JSON, para el juez de Python.
//!
//!   cargo run -q -p legajo-core --bin casos -- <lote_id> [ruta.sqlite]
//!
//! Es la misma cola que enseña el grafo (`resolucion::casos`), con las reglas
//! por tipo ya aplicadas y sin lo que ya se decidió. El juez (`sidecar/juez_alias.py`)
//! lee esto, mira los párrafos y escribe su veredicto en `resoluciones`.
use legajo_core::db::Db;
use legajo_core::resolucion;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let lote: i64 = args.next().ok_or("uso: casos <lote_id> [ruta.sqlite]")?.parse()?;
    let ruta = args.next().map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
            .join("Library/Application Support/com.legajo.app/legajo.sqlite")
    });
    let db = Db::open(&ruta)?;
    let casos = resolucion::casos(&db, lote)?;
    println!("{}", serde_json::to_string(&casos)?);
    Ok(())
}

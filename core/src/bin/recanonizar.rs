//! Vuelve a resolver las formas cortas («Petro» → «Gustavo Petro») de lo ya
//! extraído en un lote. Solo hace falta para lotes extraídos antes de que
//! existiera la columna `canon`; lo nuevo se resuelve al guardar.
//!
//!   cargo run -q -p legajo-core --bin recanonizar -- <lote_id> [ruta.sqlite]
use legajo_core::db::Db;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let lote: i64 = args.next().ok_or("uso: recanonizar <lote_id> [ruta.sqlite]")?.parse()?;
    let ruta = args.next().map(std::path::PathBuf::from).unwrap_or_else(|| {
        std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
            .join("Library/Application Support/com.legajo.app/legajo.sqlite")
    });
    let db = Db::open(&ruta)?;
    let n = db.recanonizar(lote)?;
    println!("lote {lote}: {n} menciones resueltas a su forma completa");
    Ok(())
}

//! Prueba de consola de `grafo_evidencia`: de qué artículos sale una relación.
//!   cargo run -q -p legajo-core --bin evidencia -- <lote> "<a>" "<b>" "<predicado>"
use legajo_core::db::Db;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let ruta = std::path::PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join("Library/Application Support/com.legajo.app/legajo.sqlite");
    let db = Db::open(&ruta)?;
    let t0 = std::time::Instant::now();
    let ev = db.grafo_evidencia(a[0].parse()?, &a[1], &a[2], &a[3], 12)?;
    println!("{} evidencias en {:?}", ev.len(), t0.elapsed());
    for e in ev.iter().take(3) { println!("- {:?} {:?} [{}] {}", e.titulo, e.fecha, e.pi, &e.parrafo.chars().take(160).collect::<String>()); }
    Ok(())
}

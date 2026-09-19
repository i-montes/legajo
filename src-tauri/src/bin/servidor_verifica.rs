//! Arranca el modo servidor contra una base SQLite ya existente, dada por
//! ruta, sin tocarla más que abrirla. Para verificar el modo servidor contra
//! datos reales sin arriesgar la base real: se le pasa una COPIA.
//!
//! A diferencia de `servidor_debug`, este binario NUNCA borra el fichero que
//! recibe ni siembra nada en él: abre lo que ya hay y sirve encima.
//!
//! Uso: cargo run -p legajo --bin servidor_verifica -- <ruta-sqlite> [puerto]
use legajo_lib::servidor::{self, ServidorState};
use legajo_core::db::Db;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let ruta = match args.next() {
        Some(r) => r,
        None => {
            eprintln!("uso: servidor_verifica <ruta-sqlite> [puerto]");
            std::process::exit(1);
        }
    };
    let path = std::path::PathBuf::from(&ruta);
    if !path.exists() {
        eprintln!("no existe el fichero: {}", path.display());
        std::process::exit(1);
    }
    let puerto: u16 = args.next().and_then(|s| s.parse().ok()).unwrap_or(0);

    let db = Arc::new(Db::open(&path).expect("abrir la base indicada"));

    let srv = ServidorState::default();
    let estado = servidor::iniciar(db.clone(), &srv, puerto)
        .await
        .expect("encender el servidor");

    println!("base: {}", path.display());
    println!("activo: {}", estado.activo);
    println!("direccion: {}:{}", estado.direcciones.first().cloned().unwrap_or_default(), estado.puerto);
    println!("token: {}", estado.token);
    println!("esperando peticiones (Ctrl+C para salir)...");

    std::future::pending::<()>().await;
}

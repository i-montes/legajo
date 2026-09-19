//! Arranca el modo servidor de verdad contra una base temporal, para probarlo
//! con `curl` desde fuera del proceso de `cargo test`.
//!
//! Uso: cargo run -p legajo --bin servidor_debug -- [puerto]
//!
//! Imprime el token y la dirección donde quedó escuchando, siembra un lote
//! de prueba con un artículo y una anotación, y se queda corriendo hasta que
//! lo maten (Ctrl+C o `kill`).
use legajo_lib::servidor::{self, ServidorState};
use legajo_core::db::Db;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    let puerto: u16 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    let path = std::env::temp_dir().join("legajo-servidor-debug.sqlite");
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = std::fs::remove_file(path.with_extension("sqlite-shm"));
    let db = Arc::new(Db::open(&path).expect("abrir la base temporal"));

    let conn_id = db
        .upsert_connection(
            "Sitio de prueba", "https://prueba.legajo.test", "{}", "REST directo",
            Some("Prueba"), Some(1), "{}",
        )
        .expect("crear la conexión de prueba");
    db.con(|c| {
        c.execute_batch(&format!(
            "INSERT INTO lotes (id, connection_id, label, taxonomia) VALUES (1, {conn_id}, 'lote de prueba', 'categories');
             INSERT INTO articles (connection_id, wp_id, html_raw, text_plain, word_count)
               VALUES ({conn_id}, 10, '<p>Hola</p>', 'Hola', 1);
             INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1, 10);
             INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo)
               VALUES (1, 10, 'm1', 0, 0, 4, 'Hola', 'persona');"
        ))?;
        Ok(())
    })
    .expect("sembrar el lote de prueba");

    let srv = ServidorState::default();
    let estado = servidor::iniciar(db.clone(), &srv, puerto)
        .await
        .expect("encender el servidor");

    println!("base: {}", path.display());
    println!("activo: {}", estado.activo);
    println!("direccion: {}:{}", estado.direcciones.first().cloned().unwrap_or_default(), estado.puerto);
    println!("token: {}", estado.token);
    println!("lote_id de prueba: 1");
    println!("esperando peticiones (Ctrl+C para salir)...");

    // Se queda vivo: el servidor corre en una tarea aparte.
    std::future::pending::<()>().await;
}

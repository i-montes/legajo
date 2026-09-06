//! Nucleo de Legajo: hablar con cualquier WordPress y guardar lo que se saca.
//!
//! Vive aparte del crate de Tauri a proposito. Aqui no hay nada de interfaz ni
//! de sistema de ventanas, asi que `cargo test -p legajo-core` compila y corre
//! sin webkit2gtk ni ninguna dependencia grafica.

pub mod alcance;
pub mod calibracion;
pub mod census;
pub mod contenido;
pub mod db;
pub mod discovery;
pub mod error;
pub mod extraccion;
pub mod http;
pub mod perfil;
pub mod resolucion;
pub mod transport;

pub use db::Db;
pub use discovery::{discover, Discovery};
pub use error::{Error, Result};
pub use http::{Auth, Http};
pub use transport::Transport;

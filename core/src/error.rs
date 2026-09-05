use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("error de red: {0}")]
    Http(#[from] reqwest::Error),

    #[error("URL invalida: {0}")]
    Url(#[from] url::ParseError),

    #[error("error de base de datos: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("respuesta no valida: {0}")]
    Json(#[from] serde_json::Error),

    /// No se pudo determinar como hablar con el sitio. Lleva el detalle de cada
    /// intento para que el usuario sepa por que fallo, no solo que fallo.
    #[error("{0}")]
    Discovery(String),

    #[error("el sitio respondio {status} en {url}")]
    Status { status: u16, url: String },

    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

/// Los comandos de Tauri necesitan un error serializable hacia el frontend.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

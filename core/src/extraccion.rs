//! Puente con el extractor de entidades.
//!
//! El modelo vive en un proceso hijo de Python que habla por tuberías. No abre
//! puertos: la app promete que el archivo no sale del computador, y un hijo con
//! stdin/stdout es la forma más simple de cumplirlo y de que se pueda auditar.
//!
//! Si el proceso muere, muere solo él. La app lo detecta, lo dice y se puede
//! relanzar sin perder lo ya extraído, que se guarda artículo a artículo.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entidad {
    pub texto: String,
    pub inicio: i64,
    pub fin: i64,
    pub etiqueta: String,
    pub score: f64,
}

/// Los ocho tipos del sistema y cómo se le piden al modelo.
///
/// GLiNER es de vocabulario abierto: la etiqueta es una instrucción en lenguaje
/// natural, y cómo se redacte cambia el resultado bastante. Se mantienen aquí,
/// juntas y visibles, porque son un parámetro del experimento y no un detalle.
pub const ETIQUETAS: &[(&str, &str)] = &[
    ("persona", "persona"),
    ("organizacion", "organización"),
    ("lugar", "lugar"),
    ("cargo", "cargo o rol"),
    ("ley", "ley o norma"),
    ("evento", "evento"),
    ("obra", "obra o publicación"),
    ("monto", "monto o cifra"),
];

pub fn etiquetas_modelo() -> Vec<String> {
    ETIQUETAS.iter().map(|(_, v)| v.to_string()).collect()
}

/// Devuelve la clave interna a partir de lo que respondió el modelo.
pub fn clave_de(etiqueta: &str) -> String {
    let e = etiqueta.to_lowercase();
    ETIQUETAS
        .iter()
        .find(|(_, v)| *v == e)
        .map(|(k, _)| k.to_string())
        .unwrap_or(e)
}

/// Dónde están el intérprete y el guion.
///
/// En desarrollo salen del propio repositorio; empaquetada, del directorio de
/// recursos que Tauri deja junto al binario. Las variables de entorno mandan
/// sobre todo, para poder apuntar a otro entorno sin recompilar.
pub fn localizar(raiz_recursos: Option<&Path>) -> Result<(PathBuf, PathBuf)> {
    if let (Ok(py), Ok(sc)) = (std::env::var("LEGAJO_PYTHON"), std::env::var("LEGAJO_SIDECAR")) {
        return Ok((PathBuf::from(py), PathBuf::from(sc)));
    }

    let mut candidatos: Vec<(PathBuf, PathBuf)> = Vec::new();
    if let Some(r) = raiz_recursos {
        candidatos.push((r.join("sidecar/.venv/bin/python"), r.join("sidecar/legajo_ner.py")));
        candidatos.push((r.join("sidecar/legajo_ner"), r.join("sidecar/legajo_ner.py")));
    }
    // Desarrollo: se sube desde el ejecutable hasta encontrar el repositorio.
    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(Path::to_path_buf);
        for _ in 0..5 {
            let Some(d) = dir.clone() else { break };
            candidatos.push((d.join(".venv/bin/python"), d.join("sidecar/legajo_ner.py")));
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidatos.push((cwd.join(".venv/bin/python"), cwd.join("sidecar/legajo_ner.py")));
    }

    for (py, sc) in candidatos {
        if py.exists() && sc.exists() {
            return Ok((py, sc));
        }
    }
    Err(Error::Other(
        "No encuentro el entorno de Python del extractor. Créalo con \
         `python3 -m venv .venv && .venv/bin/pip install -r sidecar/requirements.txt`."
            .into(),
    ))
}

pub struct Sidecar {
    hijo: Child,
    entrada: ChildStdin,
    salida: BufReader<ChildStdout>,
    pub modelo: Option<String>,
    pub dispositivo: String,
}

impl Sidecar {
    pub async fn iniciar(python: &Path, guion: &Path) -> Result<Self> {
        let mut hijo = Command::new(python)
            .arg("-u") // sin buffer: si no, las respuestas se quedan atrapadas
            .arg(guion)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| Error::Other(format!("no se pudo lanzar el extractor: {e}")))?;

        let entrada = hijo.stdin.take().ok_or_else(|| Error::Other("sin stdin".into()))?;
        let salida = BufReader::new(hijo.stdout.take().ok_or_else(|| Error::Other("sin stdout".into()))?);

        let mut s = Self { hijo, entrada, salida, modelo: None, dispositivo: "cpu".into() };
        // El proceso saluda al arrancar; leerlo confirma que está vivo.
        s.leer().await?;
        Ok(s)
    }

    async fn leer(&mut self) -> Result<Value> {
        let mut linea = String::new();
        let n = self
            .salida
            .read_line(&mut linea)
            .await
            .map_err(|e| Error::Other(format!("el extractor no respondió: {e}")))?;
        if n == 0 {
            return Err(Error::Other("el extractor se cerró inesperadamente".into()));
        }
        let v: Value = serde_json::from_str(linea.trim())
            .map_err(|e| Error::Other(format!("respuesta ilegible del extractor: {e}")))?;
        if v.get("ok").and_then(Value::as_bool) == Some(false) {
            let msg = v.get("error").and_then(Value::as_str).unwrap_or("error desconocido");
            return Err(Error::Other(msg.to_string()));
        }
        Ok(v)
    }

    async fn pedir(&mut self, req: Value) -> Result<Value> {
        let linea = serde_json::to_string(&req)? + "\n";
        self.entrada
            .write_all(linea.as_bytes())
            .await
            .map_err(|e| Error::Other(format!("no se pudo hablar con el extractor: {e}")))?;
        self.entrada.flush().await.ok();
        self.leer().await
    }

    pub async fn cargar(&mut self, modelo: &str, dispositivo: &str) -> Result<u64> {
        let r = self
            .pedir(json!({"op": "cargar", "modelo": modelo, "dispositivo": dispositivo}))
            .await?;
        self.modelo = Some(modelo.to_string());
        self.dispositivo = dispositivo.to_string();
        Ok(r.get("ms").and_then(Value::as_u64).unwrap_or(0))
    }

    /// Extrae entidades párrafo a párrafo. El índice de la lista devuelta es el
    /// del párrafo, para que las posiciones cuadren con la anotación manual.
    pub async fn extraer(
        &mut self,
        id: i64,
        parrafos: &[String],
        umbral: f64,
    ) -> Result<(Vec<Vec<Entidad>>, u64)> {
        let r = self
            .pedir(json!({
                "op": "extraer", "id": id, "parrafos": parrafos,
                "etiquetas": etiquetas_modelo(), "umbral": umbral,
            }))
            .await?;

        let ms = r.get("ms").and_then(Value::as_u64).unwrap_or(0);
        let crudo = r.get("parrafos").cloned().unwrap_or(Value::Array(vec![]));
        let mut out: Vec<Vec<Entidad>> = serde_json::from_value(crudo)?;
        for grupo in &mut out {
            for e in grupo.iter_mut() {
                e.etiqueta = clave_de(&e.etiqueta);
            }
        }
        Ok((out, ms))
    }

    pub async fn cerrar(mut self) {
        let _ = self.pedir(json!({"op": "salir"})).await;
        let _ = self.hijo.kill().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_etiquetas_van_y_vuelven() {
        for (k, v) in ETIQUETAS {
            assert_eq!(clave_de(v), *k, "no vuelve «{v}» a «{k}»");
        }
    }

    #[test]
    fn una_etiqueta_desconocida_no_se_pierde() {
        assert_eq!(clave_de("Fecha"), "fecha");
    }

    #[test]
    fn hay_una_etiqueta_por_tipo_del_sistema() {
        assert_eq!(ETIQUETAS.len(), 8);
        assert_eq!(etiquetas_modelo().len(), 8);
    }
}

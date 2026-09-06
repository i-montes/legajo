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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RelacionExtraida {
    pub a: String,
    pub b: String,
    pub predicado: String,
    pub score: f64,
}

/// Qué modelos usa el extractor. Se guarda con el lote: comparar dos corridas
/// solo tiene sentido si se sabe con qué se hicieron.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Modelos {
    pub gliner: String,
    pub spacy: String,
    pub glirel: Option<String>,
    pub relaciones: bool,
}

impl Default for Modelos {
    fn default() -> Self {
        Self {
            gliner: "urchade/gliner_multi-v2.1".into(),
            spacy: "es_core_news_sm".into(),
            glirel: Some("jackboyla/glirel-large-v0".into()),
            relaciones: true,
        }
    }
}

/// Los modelos entre los que se puede elegir, con lo que cuesta cada uno.
pub fn catalogo() -> Value {
    json!({
        "gliner": [
            {"id": "urchade/gliner_multi-v2.1", "nombre": "GLiNER multilingüe v2.1",
             "nota": "El caballo de batalla. Multilingüe, 209M, equilibrado."},
            {"id": "urchade/gliner_multi_pii-v1", "nombre": "GLiNER multilingüe PII",
             "nota": "Afinado para datos personales; útil si el foco son personas."},
            {"id": "knowledgator/gliner-bi-large-v1.0", "nombre": "GLiNER bi-encoder grande",
             "nota": "Codifica etiquetas aparte: más rápido con muchas etiquetas, y más pesado de cargar."},
            {"id": "knowledgator/gliner-multitask-large-v0.5", "nombre": "GLiNER multitarea grande",
             "nota": "El más preciso de la familia y el más lento. Sirve para saber cuánto techo se deja."}
        ],
        "spacy": [
            {"id": "es_core_news_sm", "nombre": "spaCy español pequeño",
             "nota": "15 MB. Segmenta y tokeniza de sobra para lo que hace falta."},
            {"id": "es_core_news_md", "nombre": "spaCy español mediano",
             "nota": "40 MB, con vectores. Mejor segmentación en prosa difícil."},
            {"id": "es_core_news_lg", "nombre": "spaCy español grande",
             "nota": "560 MB. Solo si la segmentación resulta ser el cuello de botella."}
        ],
        "glirel": [
            {"id": "jackboyla/glirel-large-v0", "nombre": "GLiREL grande",
             "nota": "Relaciones de vocabulario abierto sobre las entidades ya halladas."}
        ]
    })
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

/// Los predicados tal como se le piden a GLiREL. También son instrucciones en
/// lenguaje natural, no clases: cómo se redacten cambia lo que devuelve.
pub fn predicados_modelo() -> Vec<String> {
    ["ocupa el cargo", "aspira a", "aliado de", "opositor de", "familiar de",
     "investigado por", "financia a", "trabaja en", "parte de", "citado en",
     "ubicado en", "destinado a", "sanciona con"]
        .iter().map(|s| s.to_string()).collect()
}

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
    /// GLiREL cargó de verdad. Puede fallar sin impedir extraer entidades.
    pub glirel_activo: bool,
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

        let mut s = Self {
            hijo, entrada, salida, modelo: None,
            dispositivo: "cpu".into(), glirel_activo: false,
        };
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

    pub async fn cargar(&mut self, m: &Modelos) -> Result<u64> {
        let r = self
            .pedir(json!({
                "op": "cargar", "gliner": m.gliner, "spacy": m.spacy,
                "glirel": m.glirel, "relaciones": m.relaciones,
            }))
            .await?;
        self.modelo = Some(m.gliner.clone());
        // El sidecar responde qué cargó de verdad: si GLiREL falló, se sabe.
        self.glirel_activo = r.get("glirel").and_then(Value::as_str).is_some();
        Ok(r.get("ms").and_then(Value::as_u64).unwrap_or(0))
    }

    /// Procesa un artículo párrafo a párrafo.
    ///
    /// El índice de las listas devueltas es el del párrafo, para que las
    /// posiciones cuadren con la revisión humana sin aproximar nada.
    pub async fn procesar(
        &mut self,
        id: i64,
        parrafos: &[String],
        umbrales: &std::collections::HashMap<String, f64>,
        predicados: &[String],
        umbral_rel: f64,
    ) -> Result<(Vec<Vec<Entidad>>, Vec<Vec<RelacionExtraida>>, u64)> {
        // Se pide con el umbral más bajo de todos y se filtra por tipo después:
        // así las puntuaciones quedan guardadas y recalibrar no exige volver a
        // pasar el modelo, que es lo que hace que el antes y el después sean
        // instantáneos.
        let piso = umbrales.values().cloned().fold(0.30_f64, f64::min);

        let r = self
            .pedir(json!({
                "op": "procesar", "id": id, "parrafos": parrafos,
                "etiquetas": etiquetas_modelo(), "predicados": predicados,
                "umbral": piso, "umbral_rel": umbral_rel,
            }))
            .await?;

        let ms = r.get("ms").and_then(Value::as_u64).unwrap_or(0);
        let crudo = r.get("parrafos").cloned().unwrap_or(Value::Array(vec![]));
        let mut ents: Vec<Vec<Entidad>> = serde_json::from_value(crudo)?;
        for grupo in &mut ents {
            for e in grupo.iter_mut() {
                e.etiqueta = clave_de(&e.etiqueta);
            }
        }
        let crudo = r.get("relaciones").cloned().unwrap_or(Value::Array(vec![]));
        let rels: Vec<Vec<RelacionExtraida>> = serde_json::from_value(crudo).unwrap_or_default();
        Ok((ents, rels, ms))
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

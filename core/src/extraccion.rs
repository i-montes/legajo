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
///
/// `instalado` lo rellena `catalogo_con_estado`: aquí no se puede saber sin
/// mirar el disco, y este catálogo también se usa donde no hay entorno.
pub fn catalogo() -> Value {
    json!({
        "gliner": [
            {"id": "urchade/gliner_multi-v2.1", "nombre": "GLiNER multilingüe v2.1", "mb": 1156,
             "nota": "El caballo de batalla. Multilingüe, 209M, equilibrado."},
            {"id": "urchade/gliner_multi_pii-v1", "nombre": "GLiNER multilingüe PII", "mb": 1156,
             "nota": "Afinado para datos personales; útil si el foco son personas."},
            {"id": "knowledgator/gliner-bi-large-v1.0", "nombre": "GLiNER bi-encoder grande", "mb": 2288,
             "nota": "Codifica etiquetas aparte: más rápido con muchas etiquetas, y más pesado de cargar."},
            {"id": "knowledgator/gliner-multitask-large-v0.5", "nombre": "GLiNER multitarea grande", "mb": 892,
             "nota": "El más preciso de la familia y el más lento. Sirve para saber cuánto techo se deja."}
        ],
        "spacy": [
            {"id": "es_core_news_sm", "nombre": "spaCy español pequeño", "mb": 13,
             "nota": "Segmenta y tokeniza de sobra para lo que hace falta."},
            {"id": "es_core_news_md", "nombre": "spaCy español mediano", "mb": 42,
             "nota": "Con vectores. Mejor segmentación en prosa difícil."},
            {"id": "es_core_news_lg", "nombre": "spaCy español grande", "mb": 545,
             "nota": "Solo si la segmentación resulta ser el cuello de botella."}
        ],
        "glirel": [
            {"id": "jackboyla/glirel-large-v0", "nombre": "GLiREL grande", "mb": 1867,
             "nota": "Relaciones de vocabulario abierto sobre las entidades ya halladas."}
        ]
    })
}

/// Qué modelos hay ya en la máquina y cuáles habría que bajar.
///
/// Se pregunta antes de dejar elegir, no después: ofrecer tres tamaños de spaCy
/// cuando solo hay uno instalado convierte una elección en una trampa. Se
/// escogía el grande, se esperaba la carga, y lo que llegaba era un `OSError`
/// de Python a mitad de la extracción.
#[derive(Debug, Serialize, Deserialize, Default)]
pub struct EstadoModelos {
    /// Modelos de spaCy presentes en el entorno.
    pub spacy: Vec<String>,
    /// Modelos de Hugging Face ya en el caché local.
    pub hf: Vec<String>,
}

pub async fn estado_modelos(raiz_recursos: Option<&Path>) -> Result<EstadoModelos> {
    let (python, guion) = localizar(raiz_recursos)?;
    let preparador = guion.with_file_name("preparar.py");
    let salida = Command::new(&python)
        .arg("-u")
        .arg(&preparador)
        .arg("--estado")
        .output()
        .await
        .map_err(|e| Error::Other(format!("no se pudo consultar los modelos: {e}")))?;

    let texto = String::from_utf8_lossy(&salida.stdout);
    let mut est = EstadoModelos::default();
    for linea in texto.lines() {
        if let Ok(v) = serde_json::from_str::<Value>(linea.trim()) {
            if let Some(xs) = v.get("spacy").and_then(Value::as_array) {
                est.spacy = xs.iter().filter_map(Value::as_str).map(String::from).collect();
            }
        }
    }
    est.hf = hf_en_cache();
    Ok(est)
}

/// Modelos de Hugging Face ya descargados.
///
/// Se mira el caché en disco en vez de preguntárselo a la librería porque
/// cargarla para averiguarlo tarda quince segundos, que es justo lo que se
/// quiere evitar.
fn hf_en_cache() -> Vec<String> {
    let base = std::env::var("HF_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".cache/huggingface")
        })
        .join("hub");
    let Ok(dirs) = std::fs::read_dir(&base) else { return vec![] };
    dirs.filter_map(|e| e.ok())
        .filter_map(|e| e.file_name().into_string().ok())
        // `models--urchade--gliner_multi-v2.1` → `urchade/gliner_multi-v2.1`
        .filter_map(|n| n.strip_prefix("models--").map(|r| r.replace("--", "/")))
        .collect()
}

/// Lo que hay que bajar para poder correr esta combinación.
pub fn faltan(est: &EstadoModelos, m: &Modelos) -> Vec<String> {
    let mut f = Vec::new();
    if !est.spacy.iter().any(|x| x == &m.spacy) {
        f.push(format!("spacy:{}", m.spacy));
    }
    if !est.hf.iter().any(|x| x == &m.gliner) {
        f.push(format!("gliner:{}", m.gliner));
    }
    if m.relaciones {
        if let Some(g) = &m.glirel {
            if !est.hf.iter().any(|x| x == g) {
                f.push(format!("glirel:{g}"));
            }
        }
    }
    f
}

/// Baja lo que falte, avisando de cada paso.
///
/// Es lo único de todo el programa que sale a la red por su cuenta, y baja
/// pesos de modelos de repositorios públicos. Ningún texto del archivo se envía
/// a ninguna parte.
pub async fn preparar<F>(
    raiz_recursos: Option<&Path>,
    pendientes: &[String],
    mut avisar: F,
) -> Result<()>
where
    F: FnMut(&str, &str, &str),
{
    if pendientes.is_empty() {
        return Ok(());
    }
    let (python, guion) = localizar(raiz_recursos)?;
    let preparador = guion.with_file_name("preparar.py");

    let mut hijo = Command::new(&python)
        .arg("-u")
        .arg(&preparador)
        .args(pendientes)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| Error::Other(format!("no se pudo lanzar la descarga: {e}")))?;

    let salida = hijo.stdout.take().ok_or_else(|| Error::Other("sin stdout".into()))?;
    let mut lineas = BufReader::new(salida).lines();
    let mut error: Option<String> = None;

    while let Ok(Some(linea)) = lineas.next_line().await {
        let Ok(v) = serde_json::from_str::<Value>(linea.trim()) else { continue };
        let evento = v.get("evento").and_then(Value::as_str).unwrap_or("");
        let modelo = v.get("modelo").and_then(Value::as_str).unwrap_or("");
        let tamano = v.get("tamano").and_then(Value::as_str).unwrap_or("");
        if v.get("ok").and_then(Value::as_bool) == Some(false) {
            error = Some(v.get("error").and_then(Value::as_str).unwrap_or("falló la descarga").into());
        }
        avisar(evento, modelo, tamano);
    }
    let _ = hijo.wait().await;

    match error {
        Some(e) => Err(Error::Other(e)),
        None => Ok(()),
    }
}

/// El catálogo con una marca por modelo diciendo si ya está en la máquina.
pub fn catalogo_con_estado(est: &EstadoModelos) -> Value {
    let mut cat = catalogo();
    for (familia, presentes) in [("spacy", &est.spacy), ("gliner", &est.hf), ("glirel", &est.hf)] {
        if let Some(xs) = cat.get_mut(familia).and_then(Value::as_array_mut) {
            for m in xs.iter_mut() {
                let id = m.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                if let Some(o) = m.as_object_mut() {
                    o.insert("instalado".into(), json!(presentes.iter().any(|p| *p == id)));
                }
            }
        }
    }
    cat
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

/// El vocabulario de relaciones, con los tipos entre los que cada una tiene
/// sentido y si es simétrica.
///
/// Estas restricciones ya existían para filtrar el menú de la persona —nunca se
/// le ofrece afirmar que un monto ocupa un cargo—, pero no se aplicaban a lo que
/// devolvía el modelo. Medido sobre un lote real, el **39 %** de las relaciones
/// propuestas unían tipos que su propio predicado no admite: «Álvaro Leyva
/// *trabaja en* Bogotá», con Bogotá marcado como lugar y `trabaja en` declarado
/// persona → organización. Se estaban sirviendo a revisar sabiendo de antemano
/// que eran imposibles.
///
/// El campo `simetrico` distingue las que valen en los dos sentidos —ser aliado
/// es mutuo— de las que no. GLiREL propone las dos direcciones de casi todo con
/// puntuaciones casi iguales (`Santos parte de Partido Liberal` 0,88 y su
/// espejo 0,87): no está determinando dirección, está midiendo cercanía. Otro
/// **21 %** del total eran espejos del mismo hecho.
pub struct Predicado {
    pub etiqueta: &'static str,
    /// Tipos válidos para el origen. Vacío = cualquiera.
    pub desde: &'static [&'static str],
    pub hasta: &'static [&'static str],
    pub simetrico: bool,
}

const P: &str = "persona";
const O: &str = "organizacion";
const C: &str = "cargo";
const L: &str = "lugar";
const N: &str = "ley";
const M: &str = "monto";
const B: &str = "obra";
const E: &str = "evento";

/// Tiene que coincidir con `PREDICADOS` en `src/contenido/tipos.ts`, que es lo
/// que ve la persona al relacionar dos marcas a mano. Hay una prueba que lo
/// comprueba leyendo el otro fichero.
pub const PREDICADOS: &[Predicado] = &[
    Predicado { etiqueta: "ocupa el cargo",  desde: &[P],    hasta: &[C],             simetrico: false },
    Predicado { etiqueta: "aspira a",        desde: &[P, O], hasta: &[C],             simetrico: false },
    Predicado { etiqueta: "aliado de",       desde: &[P, O], hasta: &[P, O],          simetrico: true  },
    Predicado { etiqueta: "opositor de",     desde: &[P, O], hasta: &[P, O],          simetrico: true  },
    Predicado { etiqueta: "familiar de",     desde: &[P],    hasta: &[P],             simetrico: true  },
    Predicado { etiqueta: "investigado por", desde: &[P, O], hasta: &[O, N],          simetrico: false },
    Predicado { etiqueta: "financia a",      desde: &[P, O], hasta: &[P, O],          simetrico: false },
    Predicado { etiqueta: "trabaja en",      desde: &[P],    hasta: &[O],             simetrico: false },
    // Pertenencia, no identidad. Va de la parte al todo, y por eso no admite
    // como destino los tipos que nunca son un todo que contenga a otra cosa.
    Predicado { etiqueta: "parte de",        desde: &[],     hasta: &[O, L, N, E],    simetrico: false },
    Predicado { etiqueta: "citado en",       desde: &[P, O], hasta: &[O, B],          simetrico: false },
    Predicado { etiqueta: "ubicado en",      desde: &[],     hasta: &[L],             simetrico: false },
    Predicado { etiqueta: "destinado a",     desde: &[M],    hasta: &[O, C, E, L, N], simetrico: false },
    Predicado { etiqueta: "sanciona con",    desde: &[N],    hasta: &[M],             simetrico: false },
];

pub fn predicados_modelo() -> Vec<String> {
    PREDICADOS.iter().map(|p| p.etiqueta.to_string()).collect()
}

/// El vocabulario en la forma que el extractor entiende, para que pueda
/// preguntar solo lo que aplica y descartar lo que no.
pub fn predicados_con_tipos() -> Value {
    Value::Array(
        PREDICADOS
            .iter()
            .map(|p| json!({
                "etiqueta": p.etiqueta,
                "desde": p.desde,
                "hasta": p.hasta,
                "simetrico": p.simetrico,
            }))
            .collect(),
    )
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
                "etiquetas": etiquetas_modelo(),
                // Cómo vuelve cada etiqueta del modelo a la clave interna. El
                // extractor la necesita para comparar tipos contra el
                // vocabulario; hasta ahora esa conversión solo pasaba aquí.
                "claves": ETIQUETAS.iter()
                    .map(|(k, v)| (v.to_string(), k.to_string()))
                    .collect::<std::collections::HashMap<_, _>>(),
                // El vocabulario viaja con sus restricciones de tipo, no como
                // una lista de nombres: es lo que permite no preguntar lo
                // imposible y descartar lo que llega mal unido.
                "predicados": if predicados.is_empty() {
                    Value::Array(vec![])
                } else {
                    predicados_con_tipos()
                },
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

    /// El vocabulario está escrito dos veces —aquí y en `tipos.ts`, que es lo
    /// que ve la persona— porque el menú de la interfaz no puede esperar a una
    /// llamada al backend para pintarse. Escribirlo dos veces es aceptable;
    /// que se separen sin que nadie se entere, no: el modelo propondría
    /// relaciones que la persona no puede afirmar a mano, o al revés.
    #[test]
    fn el_vocabulario_de_rust_y_el_de_la_interfaz_dicen_lo_mismo() {
        let ruta = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/contenido/tipos.ts");
        let Ok(ts) = std::fs::read_to_string(&ruta) else {
            // En un paquete sin el frontend al lado no hay nada que comparar.
            return;
        };

        let en_ts: Vec<String> = ts
            .lines()
            .filter_map(|l| l.split_once("{ etiqueta: \""))
            .filter_map(|(_, r)| r.split_once('"'))
            .map(|(n, _)| n.to_string())
            .collect();
        assert!(!en_ts.is_empty(), "no encontré predicados en tipos.ts");

        let en_rust: Vec<String> = predicados_modelo();
        assert_eq!(
            en_rust, en_ts,
            "los dos vocabularios se separaron:\n  rust: {en_rust:?}\n  ts:   {en_ts:?}"
        );
    }

    #[test]
    fn ningun_predicado_admite_un_destino_que_no_puede_contener_nada() {
        // «parte de» era el único sin restricciones y absorbía el 38 % de todo
        // lo que devolvía el modelo, incluida la dirección imposible: un
        // partido no es parte de una persona.
        for p in PREDICADOS {
            assert!(
                !p.hasta.is_empty(),
                "«{}» acepta cualquier destino: será el cajón de sastre del modelo",
                p.etiqueta
            );
        }
    }

    #[test]
    fn lo_simetrico_va_entre_tipos_simetricos() {
        // Si «aliado de» aceptara origen y destino distintos, el espejo no
        // sería el mismo hecho y descartarlo perdería información.
        for p in PREDICADOS.iter().filter(|p| p.simetrico) {
            assert_eq!(
                p.desde, p.hasta,
                "«{}» se declara simétrica pero sus dos extremos no admiten lo mismo",
                p.etiqueta
            );
        }
    }

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

//! La capa de ejecución del extractor: el intérprete de Python y sus librerías.
//!
//! Está fuera del instalador a propósito. El extractor necesita torch, spaCy y
//! GLiNER, que en disco son 1,4 GB. Meterlos dentro del paquete convertiría
//! cada actualización de la app —veinte megas de binario y de interfaz— en una
//! descarga de giga y medio, y a ese precio nadie actualiza: se queda con la
//! versión que instaló el primer día, que es exactamente lo que la capa de
//! actualización existe para evitar. Así que el instalador trae solo la app y
//! esto trae el resto una vez, aparte, a un directorio que las actualizaciones
//! no tocan.
//!
//! El intérprete es un CPython portátil de python-build-standalone, no el de la
//! máquina. Depender del `python3` que haya en un computador de redacción es
//! depender de que exista, de que sea una versión que torch soporte y de que
//! nadie lo actualice por debajo; los tres fallan en silencio y a mitad de una
//! extracción. La versión y el hash están fijados aquí abajo.
//!
//! Esto sale a la red, como `preparar.py`, y por la misma razón acotada: trae
//! un intérprete y unas librerías de repositorios públicos. Ningún texto del
//! archivo se envía a ninguna parte.

use crate::error::{Error, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

/// Versión del intérprete y publicación de python-build-standalone de la que
/// sale.
///
/// Es la misma con la que se probó el extractor en desarrollo. Subirla es un
/// cambio deliberado y no gratuito: obliga a reinstalar la capa entera en cada
/// máquina que ya la tenga.
pub const PYTHON: &str = "3.14.7";
const PUBLICACION: &str = "20260901";

/// Los paquetes del intérprete, uno por plataforma, con su SHA-256.
///
/// Los hashes están escritos aquí y no se consultan a la red. Bajar el
/// `SHA256SUMS` de la publicación en el mismo momento que el tarball no
/// comprueba nada: quien pudiera cambiar uno cambiaría el otro. Fijados en el
/// código, el que se comprueba es el hash que vio quien escribió esta línea.
const PAQUETES: &[Paquete] = &[
    // sistema    arquitectura  triple                        sha256
    Paquete { os: "macos",   arch: "aarch64", triple: "aarch64-apple-darwin",      sha: "30daa970c7d223530120f1693cd3c6fa4c0c0d31ef158710b0dd77f286a5b23e" },
    Paquete { os: "macos",   arch: "x86_64",  triple: "x86_64-apple-darwin",       sha: "dd8841a2e8ef94bd1a02b52f92843120942140f112145d4e0199abab56f120b1" },
    Paquete { os: "windows", arch: "x86_64",  triple: "x86_64-pc-windows-msvc",    sha: "5d9242012dded591d723a3a572dda265173ad58d8a3e6fdbc6dac8f94f36c80a" },
    Paquete { os: "windows", arch: "aarch64", triple: "aarch64-pc-windows-msvc",   sha: "5efa2548bf1248ca07ed6f8afb0cb52b83d4869d533ea5be919a989c8ee1b17c" },
    Paquete { os: "linux",   arch: "x86_64",  triple: "x86_64-unknown-linux-gnu",  sha: "0ab3305457051cd3e7c031857e005f1bda17c218a1990567dacaaac6dd1d14f0" },
    Paquete { os: "linux",   arch: "aarch64", triple: "aarch64-unknown-linux-gnu", sha: "30f1cc489be654477d895b441e196bb080738bf0456da82080ad4ab66a22d80f" },
];

struct Paquete {
    os: &'static str,
    arch: &'static str,
    triple: &'static str,
    sha: &'static str,
}

/// Cuánto pesa cada mitad de la instalación, en megas y aproximado.
///
/// Sirve para poder decir el precio antes de cobrarlo, igual que los tamaños de
/// los modelos en `preparar.py`. Empezar una descarga de giga y medio creyendo
/// que son treinta megas es la clase de sorpresa que hace cerrar la app.
pub const MB_INTERPRETE: u64 = 32;
pub const MB_LIBRERIAS: u64 = 1400;

fn paquete() -> Result<&'static Paquete> {
    let (os, arch) = (std::env::consts::OS, std::env::consts::ARCH);
    PAQUETES
        .iter()
        .find(|p| p.os == os && p.arch == arch)
        .ok_or_else(|| {
            Error::Other(format!(
                "No hay intérprete de Python preparado para {os}/{arch}. El extractor \
                 necesita uno; el resto de Legajo funciona igual."
            ))
        })
}

/// Qué hay instalado y qué haría falta.
#[derive(Debug, Clone, Serialize)]
pub struct Estado {
    /// La capa está completa y se puede extraer.
    pub listo: bool,
    /// Identificador de la capa que pide esta versión de la app.
    pub sello: String,
    /// La que hay instalada, si hay alguna. Distinta de `sello` significa que
    /// las dependencias cambiaron y hay que rehacerla.
    pub instalado: Option<String>,
    /// Megas que habría que bajar. Cero si ya está.
    pub mb: u64,
    pub python: String,
}

/// Identificador de la capa: versión del intérprete y huella de las
/// dependencias.
///
/// Va en el nombre del directorio para que una capa vieja y una nueva puedan
/// convivir un rato en vez de pisarse. Y se calcula sobre el contenido de
/// `requirements.txt` porque es lo que de verdad determina qué hay dentro: si
/// alguien sube la versión de torch, el sello cambia solo y la capa se rehace
/// sin que haya que acordarse de decirlo en ningún otro sitio.
pub fn sello(requisitos: &Path) -> Result<String> {
    let bytes = std::fs::read(requisitos).map_err(|e| {
        Error::Other(format!(
            "no se pudo leer {}: {e}",
            requisitos.display()
        ))
    })?;
    let huella = hex(&Sha256::digest(&bytes));
    Ok(format!("py{PYTHON}-{}", &huella[..12]))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Dónde vive una capa concreta.
fn raiz_de(datos: &Path, sello: &str) -> PathBuf {
    datos.join("entorno").join(sello)
}

/// El intérprete del entorno virtual, que es el que corre el extractor.
fn python_del_venv(raiz: &Path) -> PathBuf {
    if cfg!(windows) {
        raiz.join("venv").join("Scripts").join("python.exe")
    } else {
        raiz.join("venv").join("bin").join("python")
    }
}

/// El intérprete portátil recién desempaquetado, que solo se usa para crear el
/// entorno virtual.
fn python_portatil(raiz: &Path) -> PathBuf {
    if cfg!(windows) {
        raiz.join("python").join("python.exe")
    } else {
        raiz.join("python").join("bin").join("python3")
    }
}

/// La marca de que una capa quedó terminada.
///
/// Se escribe al final, después de que pip haya vuelto bien. Sin esto, una
/// instalación cortada a mitad —se cierra la app, se cae la red— dejaría un
/// directorio con un intérprete y media librería que el buscador daría por
/// bueno, y el fallo aparecería mucho después, al cargar un modelo.
fn marca(raiz: &Path) -> PathBuf {
    raiz.join(".listo")
}

/// El intérprete de una capa terminada, si la hay.
pub fn instalado(datos: &Path, requisitos: &Path) -> Option<PathBuf> {
    let s = sello(requisitos).ok()?;
    let raiz = raiz_de(datos, &s);
    let py = python_del_venv(&raiz);
    (marca(&raiz).exists() && py.exists()).then_some(py)
}

pub fn estado(datos: &Path, requisitos: &Path) -> Result<Estado> {
    let s = sello(requisitos)?;
    let py = instalado(datos, requisitos);
    Ok(Estado {
        listo: py.is_some(),
        sello: s.clone(),
        instalado: capa_presente(datos),
        mb: if py.is_some() { 0 } else { MB_INTERPRETE + MB_LIBRERIAS },
        python: PYTHON.into(),
    })
}

/// El sello de la capa terminada que haya en disco, sea la que pide esta
/// versión o una anterior.
fn capa_presente(datos: &Path) -> Option<String> {
    let dirs = std::fs::read_dir(datos.join("entorno")).ok()?;
    dirs.filter_map(|e| e.ok())
        .filter(|e| marca(&e.path()).exists())
        .filter_map(|e| e.file_name().into_string().ok())
        .next()
}

/// Cada paso de la instalación, para que se vea avanzar.
///
/// Son veinte minutos de descarga en una conexión de oficina: sin nada que
/// mirar, una barra quieta y un botón desactivado se leen como app colgada.
#[derive(Debug, Clone, Serialize)]
pub struct Progreso {
    /// `bajando`, `verificando`, `extrayendo`, `creando`, `instalando`, `listo`.
    pub fase: String,
    pub detalle: String,
    pub bytes: u64,
    pub total: u64,
}

/// Instala la capa de ejecución y devuelve el intérprete que la corre.
///
/// Es idempotente: si ya está terminada, no baja nada y vuelve enseguida.
pub async fn instalar<F>(datos: &Path, requisitos: &Path, mut avisar: F) -> Result<PathBuf>
where
    F: FnMut(Progreso) + Send + 'static,
{
    if let Some(py) = instalado(datos, requisitos) {
        return Ok(py);
    }

    let s = sello(requisitos)?;
    let raiz = raiz_de(datos, &s);
    let pq = paquete()?;

    // Una capa a medio hacer no se aprovecha: se tira y se empieza. Reanudar
    // una descarga de tarball y un pip a medias cuesta más código del que vale,
    // y el modo de fallo de equivocarse es un entorno que arranca y falla raro.
    if raiz.exists() {
        std::fs::remove_dir_all(&raiz)
            .map_err(|e| Error::Other(format!("no se pudo limpiar {}: {e}", raiz.display())))?;
    }
    std::fs::create_dir_all(&raiz)
        .map_err(|e| Error::Other(format!("no se pudo crear {}: {e}", raiz.display())))?;

    let url = format!(
        "https://github.com/astral-sh/python-build-standalone/releases/download/\
         {PUBLICACION}/cpython-{PYTHON}+{PUBLICACION}-{}-install_only.tar.gz",
        pq.triple
    );
    let tarball = raiz.join("python.tar.gz");

    bajar(&url, &tarball, pq.sha, &mut avisar).await?;

    avisar(Progreso {
        fase: "extrayendo".into(),
        detalle: format!("CPython {PYTHON}"),
        bytes: 0,
        total: 0,
    });
    desempaquetar(&tarball, &raiz).await?;
    let _ = std::fs::remove_file(&tarball);

    let portatil = python_portatil(&raiz);
    if !portatil.exists() {
        return Err(Error::Other(format!(
            "el paquete de Python no traía {}",
            portatil.display()
        )));
    }

    avisar(Progreso {
        fase: "creando".into(),
        detalle: "entorno virtual".into(),
        bytes: 0,
        total: 0,
    });
    correr(&portatil, &["-m", "venv", &raiz.join("venv").to_string_lossy()], "crear el entorno").await?;

    let venv = python_del_venv(&raiz);
    instalar_librerias(&venv, requisitos, &mut avisar).await?;

    // La marca al final y solo al final: es lo que distingue una capa completa
    // de un directorio con la mitad de las cosas.
    std::fs::write(marca(&raiz), &s)
        .map_err(|e| Error::Other(format!("no se pudo marcar la capa como lista: {e}")))?;

    // Las capas anteriores son giga y medio cada una. Se van cuando hay una
    // nueva que funciona, no antes: si se borrasen al empezar, una instalación
    // fallida dejaría la máquina sin extractor y sin el que tenía.
    limpiar_viejos(datos, &s);

    avisar(Progreso {
        fase: "listo".into(),
        detalle: venv.display().to_string(),
        bytes: 0,
        total: 0,
    });
    Ok(venv)
}

/// Baja el tarball comprobando el hash a medida que entra.
///
/// Se calcula sobre el flujo y no releyendo el archivo después: son treinta
/// megas, pero es el mismo trabajo y evita dejar en disco, aunque sea un
/// instante, un archivo sin verificar que otra cosa pudiera usar.
async fn bajar<F>(url: &str, destino: &Path, sha: &str, avisar: &mut F) -> Result<()>
where
    F: FnMut(Progreso),
{
    use tokio::io::AsyncWriteExt;

    let cliente = reqwest::Client::builder()
        .user_agent("Legajo")
        .build()
        .map_err(|e| Error::Other(format!("no se pudo preparar la descarga: {e}")))?;

    let mut r = cliente.get(url).send().await?.error_for_status()?;
    let total = r.content_length().unwrap_or(0);

    let mut f = tokio::fs::File::create(destino)
        .await
        .map_err(|e| Error::Other(format!("no se pudo escribir {}: {e}", destino.display())))?;
    let mut hasher = Sha256::new();
    let mut leidos: u64 = 0;

    while let Some(trozo) = r.chunk().await? {
        hasher.update(&trozo);
        f.write_all(&trozo)
            .await
            .map_err(|e| Error::Other(format!("no se pudo escribir el intérprete: {e}")))?;
        leidos += trozo.len() as u64;
        avisar(Progreso {
            fase: "bajando".into(),
            detalle: format!("CPython {PYTHON}"),
            bytes: leidos,
            total,
        });
    }
    f.flush()
        .await
        .map_err(|e| Error::Other(format!("no se pudo cerrar el intérprete: {e}")))?;
    drop(f);

    avisar(Progreso {
        fase: "verificando".into(),
        detalle: format!("CPython {PYTHON}"),
        bytes: leidos,
        total,
    });

    let visto = hex(&hasher.finalize());
    if visto != sha {
        // Se borra antes de fallar: un tarball que no cuadra no se queda en
        // disco esperando a que alguien lo use por descuido.
        let _ = std::fs::remove_file(destino);
        return Err(Error::Other(format!(
            "el paquete de Python no coincide con su huella. Se esperaba {sha} y llegó {visto}. \
             No se instaló nada."
        )));
    }
    Ok(())
}

/// Desempaqueta el tarball. Va a un hilo aparte porque tar y gzip son
/// síncronos y son varios segundos de CPU: en el hilo del runtime dejarían la
/// interfaz congelada justo cuando dice estar trabajando.
async fn desempaquetar(tarball: &Path, raiz: &Path) -> Result<()> {
    let (tarball, raiz) = (tarball.to_path_buf(), raiz.to_path_buf());
    tokio::task::spawn_blocking(move || {
        let f = std::fs::File::open(&tarball)
            .map_err(|e| Error::Other(format!("no se pudo abrir el paquete: {e}")))?;
        let mut ar = tar::Archive::new(flate2::read::GzDecoder::new(f));
        ar.unpack(&raiz)
            .map_err(|e| Error::Other(format!("no se pudo desempaquetar Python: {e}")))
    })
    .await
    .map_err(|e| Error::Other(format!("el desempaquetado se interrumpió: {e}")))?
}

/// pip sobre el `requirements.txt` que viaja con la app.
///
/// Es el mismo archivo que se usa en desarrollo. Tener dos listas de
/// dependencias —una para la máquina de quien programa y otra para la de quien
/// usa— es tener dos entornos distintos y probar solo uno.
async fn instalar_librerias<F>(venv: &Path, requisitos: &Path, avisar: &mut F) -> Result<()>
where
    F: FnMut(Progreso),
{
    let mut hijo = Command::new(venv)
        .args(["-m", "pip", "install", "--disable-pip-version-check", "--no-input"])
        // La barra de pip escribe con retornos de carro y aquí nadie la mira:
        // sin esto, cada actualización de su barra llega como una línea nueva.
        .args(["--progress-bar", "off"])
        .arg("-r")
        .arg(requisitos)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| Error::Other(format!("no se pudo lanzar pip: {e}")))?;

    let salida = hijo.stdout.take().ok_or_else(|| Error::Other("pip sin stdout".into()))?;
    let errores = hijo.stderr.take().ok_or_else(|| Error::Other("pip sin stderr".into()))?;

    // stderr se guarda entero y aparte. Si pip falla, lo que explica por qué
    // está ahí, y son las últimas líneas las que lo dicen.
    let cola = tokio::spawn(async move {
        let mut lineas = BufReader::new(errores).lines();
        let mut todo = Vec::new();
        while let Ok(Some(l)) = lineas.next_line().await {
            todo.push(l);
        }
        todo
    });

    let mut lineas = BufReader::new(salida).lines();
    while let Ok(Some(l)) = lineas.next_line().await {
        // De todo lo que escribe pip solo interesa qué está trayendo ahora.
        // «Collecting torch» dice algo; «Using cached …» repetido treinta veces
        // solo hace ruido.
        if let Some(qué) = l.strip_prefix("Collecting ").or_else(|| l.strip_prefix("Downloading ")) {
            avisar(Progreso {
                fase: "instalando".into(),
                detalle: qué.split_whitespace().next().unwrap_or(qué).to_string(),
                bytes: 0,
                total: 0,
            });
        } else if l.starts_with("Installing collected packages") {
            avisar(Progreso {
                fase: "instalando".into(),
                detalle: "colocando las librerías".into(),
                bytes: 0,
                total: 0,
            });
        }
    }

    let estado = hijo
        .wait()
        .await
        .map_err(|e| Error::Other(format!("pip no terminó bien: {e}")))?;
    if !estado.success() {
        let cola = cola.await.unwrap_or_default();
        let ultimas: Vec<&str> = cola.iter().rev().take(6).rev().map(String::as_str).collect();
        return Err(Error::Other(format!(
            "no se pudieron instalar las librerías del extractor.\n{}",
            ultimas.join("\n")
        )));
    }
    Ok(())
}

async fn correr(programa: &Path, args: &[&str], qué: &str) -> Result<()> {
    let salida = Command::new(programa)
        .args(args)
        .output()
        .await
        .map_err(|e| Error::Other(format!("no se pudo {qué}: {e}")))?;
    if !salida.status.success() {
        let err = String::from_utf8_lossy(&salida.stderr);
        return Err(Error::Other(format!(
            "no se pudo {qué}: {}",
            err.lines().rev().take(4).collect::<Vec<_>>().join(" / ")
        )));
    }
    Ok(())
}

/// Borra las capas que ya no son la actual.
///
/// Cada una pesa giga y medio. Sin esto, tres cambios de dependencias en un año
/// dejarían cuatro entornos y cinco gigas en el disco de alguien que nunca supo
/// que existían.
fn limpiar_viejos(datos: &Path, actual: &str) {
    let Ok(dirs) = std::fs::read_dir(datos.join("entorno")) else { return };
    for e in dirs.filter_map(|e| e.ok()) {
        let nombre = e.file_name();
        if nombre.to_string_lossy() == actual {
            continue;
        }
        if e.path().is_dir() {
            if let Err(err) = std::fs::remove_dir_all(e.path()) {
                eprintln!("legajo: no se pudo borrar la capa vieja {nombre:?}: {err}");
            }
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    /// El sello cambia si cambian las dependencias, y no cambia si no cambian.
    /// Es toda la garantía de que una capa vieja no se dé por buena.
    #[test]
    fn el_sello_sigue_a_las_dependencias() {
        let dir = std::env::temp_dir().join(format!("legajo-sello-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let r = dir.join("requirements.txt");

        std::fs::write(&r, "torch==2.14.0\n").unwrap();
        let a = sello(&r).unwrap();
        let a2 = sello(&r).unwrap();
        std::fs::write(&r, "torch==2.15.0\n").unwrap();
        let b = sello(&r).unwrap();

        assert_eq!(a, a2, "el mismo requirements da el mismo sello");
        assert_ne!(a, b, "otro requirements da otro sello");
        assert!(a.starts_with(&format!("py{PYTHON}-")));
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Hay paquete para la máquina en la que corren las pruebas. Si esto falla
    /// en una plataforma nueva, la tabla es lo que hay que ampliar.
    #[test]
    fn hay_interprete_para_esta_maquina() {
        assert!(paquete().is_ok(), "{}/{}", std::env::consts::OS, std::env::consts::ARCH);
    }

    /// Instala la capa de verdad, contra la red, con una lista de dependencias
    /// vacía.
    ///
    /// Ignorada por defecto porque baja treinta megas. Es la única forma de
    /// comprobar lo que de verdad puede fallar en la máquina de otro: que la
    /// URL siga existiendo, que el hash cuadre, que el tarball se
    /// desempaquete y que el intérprete que trae sepa crear un entorno
    /// virtual. Lo que no cubre es pip sobre el `requirements.txt` real, que
    /// son 1,4 GB y veinte minutos.
    #[tokio::test]
    #[ignore]
    async fn instala_la_capa_contra_la_red() {
        let datos = std::env::temp_dir().join(format!("legajo-entorno-{}", std::process::id()));
        let req = datos.join("requirements.txt");
        std::fs::create_dir_all(&datos).unwrap();
        std::fs::write(&req, "# sin dependencias: aquí se prueba el intérprete\n").unwrap();

        let py = instalar(&datos, &req, |p| {
            if p.fase != "bajando" {
                eprintln!("  {} · {}", p.fase, p.detalle);
            }
        })
        .await
        .expect("la capa se instala");

        assert!(py.exists(), "{}", py.display());

        // El intérprete instalado es el que dice ser.
        let v = std::process::Command::new(&py).arg("-V").output().unwrap();
        let dicho = String::from_utf8_lossy(&v.stdout);
        assert!(dicho.contains(PYTHON), "dijo {dicho:?}, se esperaba {PYTHON}");

        // Y queda encontrable: es lo que hace el buscador del extractor.
        assert_eq!(instalado(&datos, &req).as_deref(), Some(py.as_path()));

        // Segunda vez: no baja nada y devuelve lo mismo.
        let otra = instalar(&datos, &req, |_| {}).await.unwrap();
        assert_eq!(otra, py, "instalar dos veces no rehace la capa");

        std::fs::remove_dir_all(&datos).ok();
    }

    /// Los hashes están escritos a mano. Uno corto o con un carácter de más no
    /// se nota hasta que una descarga falla en la máquina de otro.
    #[test]
    fn los_hashes_estan_bien_formados() {
        for p in PAQUETES {
            assert_eq!(p.sha.len(), 64, "{}", p.triple);
            assert!(p.sha.chars().all(|c| c.is_ascii_hexdigit()), "{}", p.triple);
        }
    }
}

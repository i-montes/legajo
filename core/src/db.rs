use crate::error::Result;
use rusqlite::Connection as Sqlite;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;

pub struct Db {
    conn: Mutex<Sqlite>,
}

/// Dónde estaba el usuario la última vez.
#[derive(Debug, Serialize)]
pub struct Sesion {
    pub connection_id: Option<i64>,
    pub paso: String,
    pub progreso: i64,
    pub taxonomia: Option<String>,
    pub lote_id: Option<i64>,
    /// El descubrimiento guardado, para no volver a sondear el sitio al abrir.
    pub discovery_json: Option<String>,
    pub etiqueta: Option<String>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct Mencion {
    pub mid: String,
    pub pi: i64,
    pub ini: i64,
    pub fin: i64,
    pub texto: String,
    pub tipo: String,
    /// La propuso la propagacion, no la persona. Se guarda para poder decir
    /// despues que parte del trabajo fue asistido.
    #[serde(default)]
    pub auto: bool,
    /// Señala a un individuo concreto que el texto no nombra. Ver el esquema.
    #[serde(default)]
    pub designa: bool,
    /// Menciones con el mismo grupo nombran la misma entidad. Lo declara la
    /// persona; es verdad de referencia contra la que medir el paso 7.
    #[serde(default)]
    pub grupo: Option<String>,
}

/// Una entrada del lexico: un texto ya anotado y el tipo que se le dio.
#[derive(Debug, Clone, Serialize)]
pub struct EntradaLexico {
    pub texto: String,
    pub tipo: String,
    /// En cuantos articulos distintos se ha marcado asi.
    pub articulos: i64,
    /// Se marco con mas de un tipo en el archivo: no se propaga sola.
    pub ambigua: bool,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct RelacionFila {
    pub rid: String,
    pub a_mid: String,
    pub b_mid: String,
    pub predicado: String,
    /// `vigente`, `pasada` o `futura`, respecto a la fecha del artículo.
    #[serde(default = "vigente")]
    pub cuando: String,
}

fn vigente() -> String {
    "vigente".into()
}

#[derive(Debug, Serialize)]
pub struct Evidencia {
    pub wp_id: i64,
    pub pi: i64,
    pub titulo: Option<String>,
    pub fecha: Option<String>,
    pub enlace: Option<String>,
    pub parrafo: String,
    pub revisada: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Resolucion {
    pub clave: String,
    pub a: String,
    pub b: String,
    pub tipo: String,
    /// `misma`, `distinta` o `posponer`.
    pub decision: String,
    pub confianza: f64,
    /// `persona`, `quien-ai` o `juez:<modelo>`.
    pub fuente: String,
    pub motivo: Option<String>,
    pub decidido_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodoGrafo {
    pub tipo: String,
    pub texto: String,
    pub menciones: i64,
    pub articulos: i64,
    /// La confirmó una persona; el resto lo propuso el modelo.
    pub revisada: bool,
}

#[derive(Debug, Serialize)]
pub struct AristaGrafo {
    pub a: String,
    pub b: String,
    pub predicado: String,
    pub articulos: i64,
    pub revisada: bool,
    /// Cuántos artículos lo afirman en cada año: «presidente según notas de
    /// 2022 (12), 2023 (30)». Es lo que permite leer un cargo con su periodo
    /// sin fingir una fecha exacta que el texto no da.
    pub por_anio: Vec<(i32, i64)>,
    /// `vigente`, `pasada` o `futura`. No se funde con las demás vigencias: que
    /// alguien fuera ministro y que lo sea son hechos distintos, y un grafo que
    /// los suma en una sola arista afirma algo que nadie dijo.
    pub cuando: String,
    /// Años del primer y último artículo que lo afirman. Es lo único datable:
    /// la fecha del artículo dice cuándo se dijo, no cuándo fue verdad.
    pub desde_anio: Option<i32>,
    pub hasta_anio: Option<i32>,
}

#[derive(Debug, Serialize)]
pub struct ResumenGrafo {
    pub articulos: i64,
    pub procesados: i64,
    pub revisados: i64,
    pub entidades_distintas: i64,
    pub entidades_una_vez: i64,
    pub relaciones: i64,
}

/// Una descripción que señala a alguien concreto sin nombrarlo, y quién ocupaba
/// esa plaza por esas fechas según el resto del lote.
#[derive(Debug, Serialize)]
pub struct SinNombrar {
    pub texto: String,
    pub tipo: String,
    pub wp_id: i64,
    pub titulo: Option<String>,
    pub anio: Option<i32>,
    pub candidatos: Vec<Ocupante>,
}

#[derive(Debug, Serialize)]
pub struct Ocupante {
    pub nombre: String,
    /// Año del artículo donde se afirmó, no año en que fue cierto: es lo único
    /// que se sabe de verdad.
    pub anio: Option<i32>,
    /// Años de distancia respecto al artículo sin nombrar. Se muestra en vez de
    /// filtrarse: un cargo dura lo que dura según el cargo, y ninguna ventana
    /// fija sería defendible para todos.
    pub distancia: Option<i32>,
    pub cuando: String,
}

#[derive(Debug, Serialize)]
pub struct LoteRow {
    pub id: i64,
    pub etiqueta: String,
    pub taxonomia: Option<String>,
    pub creado: String,
    pub articulos: i64,
    pub calibrar: i64,
    pub extraidos: i64,
    pub calibrado: bool,
}

/// Una categoría dentro de un lote, con cuánto lleva extraído.
///
/// Alimenta la cola del paso 7: qué queda por procesar, cuánto, y en qué orden
/// conviene atacarlo.
#[derive(Debug, Clone, Serialize)]
pub struct CategoriaLote {
    pub term_id: i64,
    pub nombre: String,
    pub slug: String,
    pub parent: i64,
    /// Artículos del lote que llevan esta categoría.
    pub total: i64,
    pub extraidos: i64,
    pub pendientes: i64,
}

/// Una fila de la muestra con todo lo necesario para anotarla.
#[derive(Debug, Serialize)]
pub struct FilaAnotable {
    pub wp_id: i64,
    pub seccion: Option<String>,
    pub titulo: Option<String>,
    pub fecha: Option<String>,
    pub link: Option<String>,
    pub texto: Option<String>,
    pub html: Option<String>,
    pub palabras: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct ConnectionRow {
    pub id: i64,
    pub label: String,
    pub resolved_origin: String,
    pub transport_label: String,
    pub site_name: Option<String>,
    pub total_posts: Option<i64>,
    pub auth_method: String,
    pub created_at: String,
    pub last_used_at: String,
}


/// Deja el fichero legible solo por quien lo creó.
///
/// Aquí dentro está el archivo entero del medio y, desde que se pide, la
/// contraseña de aplicación con la que se probó la pertenencia al sitio. En un
/// equipo compartido, el modo por defecto la dejaría al alcance de cualquier
/// otra cuenta. En Windows no hay equivalente y no se hace nada: los permisos
/// del directorio de datos del usuario ya cumplen ese papel.
#[cfg(unix)]
fn solo_para_su_dueno(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    for sufijo in ["", "-wal", "-shm"] {
        let p = if sufijo.is_empty() {
            path.to_path_buf()
        } else {
            path.with_extension(format!(
                "{}{sufijo}",
                path.extension().and_then(|e| e.to_str()).unwrap_or("")
            ))
        };
        let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600));
    }
}

#[cfg(not(unix))]
fn solo_para_su_dueno(_path: &Path) {}


/// Pone los dos extremos de una relación simétrica en un orden fijo.
///
/// Ser aliado es mutuo: «A aliado de B» y «B aliado de A» son el mismo hecho, y
/// guardarlos como dos filas hace que el grafo lo cuente dos veces y que quien
/// revisa lea dos veces lo mismo. El modelo los propone casi siempre en los dos
/// sentidos con puntuaciones casi iguales, pero el extractor no es la única
/// fuente: una persona también puede marcar las dos a mano. Por eso se ordena
/// aquí, al guardar, y no en quien produce: es la única puerta por la que pasan
/// todas.
///
/// Con los extremos ordenados, la clave primaria de la tabla ya impide el
/// duplicado —deja de ser una regla que alguien tiene que recordar aplicar.
///
/// Las asimétricas se dejan como vienen: «A parte de B» y «B parte de A» son
/// afirmaciones distintas, y una de las dos es falsa. Ahí no hay nada que
/// fundir, hay algo que corregir.
pub fn extremos_canonicos<'a>(predicado: &str, a: &'a str, b: &'a str) -> (&'a str, &'a str) {
    let simetrico = crate::extraccion::PREDICADOS
        .iter()
        .any(|p| p.etiqueta == predicado && p.simetrico);
    if simetrico && a > b {
        (b, a)
    } else {
        (a, b)
    }
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Sqlite::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let db = Self { conn: Mutex::new(conn) };
        db.migrate()?;
        solo_para_su_dueno(path);
        Ok(db)
    }

    /// Presta la conexión para consultas de solo lectura definidas en otros
    /// módulos, sin exponer el Mutex ni duplicar el estado.
    pub fn con<T>(&self, f: impl FnOnce(&Sqlite) -> Result<T>) -> Result<T> {
        let conn = self.conn.lock().unwrap();
        f(&conn)
    }

    /// Añade una columna solo si falta.
    ///
    /// `CREATE TABLE IF NOT EXISTS` no toca una tabla que ya existe, así que una
    /// base creada por una versión anterior se queda sin las columnas nuevas y
    /// falla en el primer índice o consulta que las use. Le pasa a cualquiera
    /// que actualice la app teniendo datos.
    fn asegurar_columna(conn: &Sqlite, tabla: &str, columna: &str, tipo: &str) -> Result<()> {
        let mut st = conn.prepare(&format!("PRAGMA table_info({tabla})"))?;
        let existe = st
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|n| n == columna);
        drop(st);
        if !existe {
            conn.execute(&format!("ALTER TABLE {tabla} ADD COLUMN {columna} {tipo}"), [])?;
        }
        Ok(())
    }

    /// Renombra `design_id` a `lote_id` en las tablas que aún lo lleven.
    ///
    /// El paso dejó de llamarse «diseño de muestra» y pasó a ser «lote», y el
    /// esquema declarado se renombró con él; pero `CREATE TABLE IF NOT EXISTS`
    /// no toca una tabla que ya existe, así que cualquier base anterior seguía
    /// con la columna vieja y toda consulta nueva fallaba contra ella. Renombrar
    /// conserva las anotaciones, los tiempos y lo ya extraído.
    fn renombrar_columna_de_lote(conn: &Sqlite) -> Result<()> {
        for tabla in [
            "lote_articulos", "anotaciones", "relaciones", "extraidas",
            "relaciones_extraidas", "tiempos",
            // `sesion` faltaba en esta lista, y como es la tabla que recuerda
            // por dónde iba el usuario, el síntoma no fue un error sino algo
            // peor: cada guardado fallaba en silencio y la app volvía siempre
            // al paso 1, como si nunca se hubiera usado.
            "sesion",
        ] {
            let existe: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                [tabla], |r| r.get(0))?;
            if existe == 0 {
                continue;
            }
            let mut st = conn.prepare(&format!("PRAGMA table_info({tabla})"))?;
            let columnas: Vec<String> = st
                .query_map([], |r| r.get::<_, String>(1))?
                .filter_map(|r| r.ok())
                .collect();
            drop(st);
            if columnas.iter().any(|c| c == "design_id") && !columnas.iter().any(|c| c == "lote_id") {
                conn.execute(
                    &format!("ALTER TABLE {tabla} RENAME COLUMN design_id TO lote_id"), [])?;
            }
        }
        Ok(())
    }

    /// Reapunta a `lotes` las claves foráneas que aún nombran a `designs`.
    ///
    /// `ALTER TABLE … RENAME COLUMN` arregla el nombre de la columna pero deja
    /// intacta la tabla a la que apunta, así que las anotaciones seguían
    /// exigiendo una fila en `designs` que ya nadie escribe: cualquier registro
    /// nuevo moría con «FOREIGN KEY constraint failed». SQLite tampoco sabe
    /// alterar una restricción, de modo que hay que rehacer la tabla.
    ///
    /// La definición nueva se saca de la vieja cambiando solo el nombre
    /// apuntado, en vez de repetir aquí el esquema: repetirlo garantizaría que
    /// un día divergiera del declarado y nadie se enterase.
    fn reapuntar_a_lotes(conn: &Sqlite) -> Result<()> {
        let mut st = conn.prepare(
            "SELECT name, sql FROM sqlite_master
             WHERE type = 'table' AND sql LIKE '%REFERENCES designs%'")?;
        let pendientes: Vec<(String, String)> = st
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        for (tabla, sql) in pendientes {
            // Los índices se van con la tabla; hay que rehacerlos después.
            let mut st = conn.prepare(
                "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ?1
                 AND sql IS NOT NULL")?;
            let indices: Vec<String> = st
                .query_map([&tabla], |r| r.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .collect();
            drop(st);

            let temporal = format!("{tabla}__reapuntada");
            let nuevo = sql
                .replace("REFERENCES designs", "REFERENCES lotes")
                .replacen(&tabla, &temporal, 1);

            conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN;")?;
            let hecho = (|| -> Result<()> {
                conn.execute_batch(&nuevo)?;
                conn.execute(&format!("INSERT INTO {temporal} SELECT * FROM {tabla}"), [])?;
                conn.execute(&format!("DROP TABLE {tabla}"), [])?;
                conn.execute(&format!("ALTER TABLE {temporal} RENAME TO {tabla}"), [])?;
                for i in &indices {
                    conn.execute_batch(i)?;
                }
                Ok(())
            })();
            match hecho {
                Ok(()) => conn.execute_batch("COMMIT; PRAGMA foreign_keys = ON;")?,
                Err(e) => {
                    conn.execute_batch("ROLLBACK; PRAGMA foreign_keys = ON;").ok();
                    return Err(e);
                }
            }
        }
        Ok(())
    }

    /// Rehace `lotes` sin las columnas del muestreo aleatorio.
    ///
    /// Solo actúa si siguen ahí, y conserva todas las filas: quien venga de una
    /// versión anterior no pierde los lotes que ya tenía.
    fn retirar_columnas_del_muestreo(conn: &Sqlite) -> Result<()> {
        let mut st = conn.prepare("PRAGMA table_info(lotes)")?;
        let sobra = st
            .query_map([], |r| r.get::<_, String>(1))?
            .filter_map(|r| r.ok())
            .any(|n| n == "seed" || n == "spec_json");
        drop(st);
        if !sobra {
            return Ok(());
        }
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = OFF;
            BEGIN;
            CREATE TABLE lotes_nueva (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id     INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                label             TEXT NOT NULL,
                taxonomia         TEXT,
                terminos_json     TEXT NOT NULL DEFAULT '[]',
                desde_anio        INTEGER,
                hasta_anio        INTEGER,
                calibracion_json  TEXT,
                created_at        TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO lotes_nueva
                (id, connection_id, label, taxonomia, terminos_json,
                 desde_anio, hasta_anio, calibracion_json, created_at)
            SELECT id, connection_id, label, taxonomia, terminos_json,
                   desde_anio, hasta_anio, calibracion_json, created_at FROM lotes;
            DROP TABLE lotes;
            ALTER TABLE lotes_nueva RENAME TO lotes;
            COMMIT;
            PRAGMA foreign_keys = ON;
            "#,
        )?;
        Ok(())
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS connections (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                label             TEXT NOT NULL,
                resolved_origin   TEXT NOT NULL UNIQUE,
                transport_json    TEXT NOT NULL,
                transport_label   TEXT NOT NULL,
                site_name         TEXT,
                auth_method       TEXT NOT NULL DEFAULT 'anonymous',
                discovery_json    TEXT NOT NULL,
                total_posts       INTEGER,
                created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                last_used_at      TEXT NOT NULL DEFAULT (datetime('now'))
            );

            -- Marco muestral: un registro por pieza del archivo, sin contenido.
            CREATE TABLE IF NOT EXISTS census (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                wp_id          INTEGER NOT NULL,
                date           TEXT,
                date_valid     INTEGER NOT NULL DEFAULT 1,
                slug           TEXT,
                link           TEXT,
                title          TEXT,
                title_key      TEXT,
                author         INTEGER,
                terms_json     TEXT,
                PRIMARY KEY (connection_id, wp_id)
            );
            CREATE INDEX IF NOT EXISTS census_date ON census(connection_id, date);

            -- Relacion articulo-termino, materializada.
            --
            -- La misma informacion esta en census.terms_json, pero consultarla
            -- exige json_each sobre cada fila: 7 segundos para pintar el perfil
            -- de un archivo de 84.000 piezas, con el hilo principal bloqueado
            -- todo ese rato. Aqui es un GROUP BY indexado.
            CREATE TABLE IF NOT EXISTS census_terms (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                wp_id          INTEGER NOT NULL,
                taxonomy       TEXT NOT NULL,
                term_id        INTEGER NOT NULL,
                PRIMARY KEY (connection_id, wp_id, taxonomy, term_id)
            );
            CREATE INDEX IF NOT EXISTS census_terms_tax
                ON census_terms(connection_id, taxonomy, term_id);

            -- Nombres de los terminos: sin ellos el marco muestral solo tiene ids.
            CREATE TABLE IF NOT EXISTS terms (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                taxonomy       TEXT NOT NULL,
                term_id        INTEGER NOT NULL,
                name           TEXT NOT NULL,
                slug           TEXT,
                parent         INTEGER NOT NULL DEFAULT 0,
                count          INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (connection_id, taxonomy, term_id)
            );

            -- Ventanas del censo ya completadas, para poder reanudar.
            CREATE TABLE IF NOT EXISTS census_windows (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                label          TEXT NOT NULL,
                rows           INTEGER NOT NULL DEFAULT 0,
                done_at        TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (connection_id, label)
            );

            -- Sondeo de contenido sobre una submuestra aleatoria. El censo solo
            -- lee metadatos; lo que depende del cuerpo del articulo se estima
            -- desde aqui, y se declara como estimacion en la interfaz.
            CREATE TABLE IF NOT EXISTS content_probe (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                wp_id          INTEGER NOT NULL,
                words          INTEGER NOT NULL,
                blocks         INTEGER NOT NULL,
                broken         INTEGER NOT NULL,
                shortcodes     TEXT,
                PRIMARY KEY (connection_id, wp_id)
            );

            CREATE TABLE IF NOT EXISTS anomalies (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                wp_id          INTEGER NOT NULL,
                kind           TEXT NOT NULL,
                detail         TEXT
            );

            -- Un lote es un trozo del archivo elegido para procesar: unas
            -- categorias, opcionalmente un rango de anios. Sustituye al diseno
            -- de muestra estadistica, que respondia a otra pregunta.
            CREATE TABLE IF NOT EXISTS lotes (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id     INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                label             TEXT NOT NULL,
                taxonomia         TEXT,
                terminos_json     TEXT NOT NULL DEFAULT '[]',
                desde_anio        INTEGER,
                hasta_anio        INTEGER,
                -- Lo aprendido corrigiendo: umbrales, bloqueos y diccionario.
                calibracion_json  TEXT,
                created_at        TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS lote_articulos (
                lote_id    INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                seccion    TEXT,
                -- Los primeros del lote se usan para calibrar antes de soltar
                -- el extractor sobre el resto.
                calibra    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (lote_id, wp_id)
            );

            -- Se guarda el HTML crudo ademas del texto limpio: sin el, cambiar el
            -- limpiador corrompe en silencio las posiciones de las anotaciones.
            CREATE TABLE IF NOT EXISTS articles (
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                wp_id          INTEGER NOT NULL,
                html_raw       TEXT,
                text_plain     TEXT,
                word_count     INTEGER,
                fetched_at     TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (connection_id, wp_id)
            );

            -- Anotacion manual. Las posiciones son desplazamientos dentro del
            -- parrafo del texto limpio: el unico anclaje estable que sobrevive
            -- a que el articulo se vuelva a maquetar en el sitio.
            CREATE TABLE IF NOT EXISTS anotaciones (
                lote_id  INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                mid        TEXT NOT NULL,
                pi         INTEGER NOT NULL,
                ini        INTEGER NOT NULL,
                fin        INTEGER NOT NULL,
                texto      TEXT NOT NULL,
                tipo       TEXT NOT NULL,
                -- La marca es una descripción que señala a un individuo
                -- concreto al que el texto nunca nombra: «el Gobernador de
                -- Antioquia», «la cooperativa». Se queda en su tipo —sigue
                -- siendo un cargo— para no enseñarle al modelo que eso es un
                -- nombre propio; lo que cambia es que el grafo sabe que ahí
                -- falta una identidad, en vez de contar la descripción como si
                -- fuera la entidad.
                designa    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (lote_id, wp_id, mid)
            );
            CREATE INDEX IF NOT EXISTS anotaciones_art ON anotaciones(lote_id, wp_id);

            CREATE TABLE IF NOT EXISTS relaciones (
                lote_id  INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                rid        TEXT NOT NULL,
                a_mid      TEXT NOT NULL,
                b_mid      TEXT NOT NULL,
                predicado  TEXT NOT NULL,
                -- Cuándo fue cierta, respecto a la fecha del artículo. La fecha
                -- dice cuándo se **afirmó**, no cuándo fue **verdad**: «Carlos
                -- Costa, ministro de Ambiente» en un artículo de 2010 y «el ex
                -- ministro Costa» en uno de 2015 son la misma relación con
                -- vigencias opuestas, y fundirlas da un grafo que miente.
                cuando     TEXT NOT NULL DEFAULT 'vigente',
                PRIMARY KEY (lote_id, wp_id, rid)
            );

            -- La medida que justifica toda la fase: cuanto cuesta de verdad
            -- anotar un articulo. Se guarda por articulo, no en agregado, para
            -- poder mirar la mediana y la curva de aprendizaje por separado.
            CREATE TABLE IF NOT EXISTS tiempos (
                lote_id   INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                wp_id       INTEGER NOT NULL,
                segundos    INTEGER NOT NULL,
                menciones   INTEGER NOT NULL DEFAULT 0,
                orden       INTEGER NOT NULL DEFAULT 0,
                cerrado_at  TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (lote_id, wp_id)
            );

            -- Decisiones de resolucion. Se guarda el par, no la entidad
            -- fusionada: asi se puede rehacer el grafo si cambia el criterio.
            CREATE TABLE IF NOT EXISTS resoluciones (
                lote_id  INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                clave      TEXT NOT NULL,
                a_nombre   TEXT NOT NULL,
                b_nombre   TEXT NOT NULL,
                tipo       TEXT NOT NULL,
                decision   TEXT NOT NULL,
                confianza  REAL NOT NULL DEFAULT 0,
                decidido_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (lote_id, clave)
            );

            -- Lo que propuso el modelo. Mismas coordenadas que la anotacion
            -- manual (parrafo + desplazamiento), que es lo que permite
            -- compararlas sin aproximar nada.
            CREATE TABLE IF NOT EXISTS extraidas (
                lote_id  INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                pi         INTEGER NOT NULL,
                ini        INTEGER NOT NULL,
                fin        INTEGER NOT NULL,
                texto      TEXT NOT NULL,
                etiqueta   TEXT NOT NULL,
                score      REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (lote_id, wp_id, pi, ini, fin)
            );
            CREATE INDEX IF NOT EXISTS extraidas_art ON extraidas(lote_id, wp_id);

            -- Relaciones que propuso el modelo, aparte de las humanas. Se
            -- guardan por texto y no por identificador de marca porque el
            -- extractor no conoce las marcas de nadie.
            CREATE TABLE IF NOT EXISTS relaciones_extraidas (
                lote_id    INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                pi         INTEGER NOT NULL,
                a          TEXT NOT NULL,
                b          TEXT NOT NULL,
                predicado  TEXT NOT NULL,
                score      REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (lote_id, wp_id, pi, a, b, predicado)
            );

            -- Dónde se quedó el usuario. Una sola fila: la sesión es una.
            --
            -- El trabajo ya estaba a salvo en sus tablas, pero al reabrir la app
            -- volvía al paso 1 sin archivo conectado, y recuperar el sitio y
            -- llegar otra vez a anotar era una penalizacion gratuita sobre un
            -- trabajo que se mide en horas.
            CREATE TABLE IF NOT EXISTS sesion (
                id             INTEGER PRIMARY KEY CHECK (id = 1),
                connection_id  INTEGER REFERENCES connections(id) ON DELETE CASCADE,
                paso           TEXT NOT NULL DEFAULT 'conexion',
                progreso       INTEGER NOT NULL DEFAULT 0,
                taxonomia      TEXT,
                lote_id      INTEGER,
                guardado_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                kind           TEXT NOT NULL,
                state          TEXT NOT NULL,
                cursor_json    TEXT,
                progress       REAL NOT NULL DEFAULT 0,
                error          TEXT,
                updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )?;

        // Columnas incorporadas después de la primera versión del esquema.
        Self::asegurar_columna(&conn, "census", "title_key", "TEXT")?;
        // La credencial con la que se probó la pertenencia al sitio. Se guarda
        // porque el censo son horas y volver a pedirla en cada arranque sería
        // insufrible; el fichero queda en 0600 y la contraseña de aplicación se
        // revoca desde el propio WordPress sin tocar nada más.
        for col in ["auth_user TEXT", "auth_secret TEXT", "auth_nombre TEXT",
                    "auth_roles TEXT", "auth_at TEXT"] {
            let (c, t) = col.split_once(' ').unwrap();
            Self::asegurar_columna(&conn, "connections", c, t)?;
        }
        // El tiempo se guarda mientras se anota, no solo al cerrar: si la
        // ventana se cierra a mitad de un articulo, los minutos ya invertidos
        // son parte del coste real y perderlos falsearia la unica cifra que
        // esta fase existe para producir. Las filas antiguas eran todas cierres.
        Self::asegurar_columna(&conn, "tiempos", "cerrado", "INTEGER NOT NULL DEFAULT 1")?;
        // Distingue lo que marcó la persona de lo que se propago solo. No es
        // cosmetica: si el 70% de una sesion vino propagado, el tiempo por
        // articulo mide otra cosa, y el reporte tiene que poder decirlo.
        Self::asegurar_columna(&conn, "anotaciones", "auto", "INTEGER NOT NULL DEFAULT 0")?;
        // Menciones que la persona declaro que son la misma entidad: «Omar
        // Yepes», «Yepes» y «el politico caldense» comparten grupo. Es verdad de
        // referencia para el paso 7, no una conjetura de la maquina.
        Self::asegurar_columna(&conn, "anotaciones", "grupo", "TEXT")?;
        Self::asegurar_columna(&conn, "anotaciones", "designa", "INTEGER NOT NULL DEFAULT 0")?;
        // Quién decidió que dos nombres son o no la misma entidad —la persona,
        // el diccionario de Quién-AI o el juez con LLM— y por qué. El grafo
        // funde lo que diga «misma» venga de donde venga, y la pantalla enseña
        // la razón para que se pueda deshacer.
        // La forma completa a la que se resolvió una mención corta dentro de su
        // artículo («Petro» → «Gustavo Petro»). Ver resolucion::canonizar_articulo.
        Self::asegurar_columna(&conn, "extraidas", "canon", "TEXT")?;
        Self::asegurar_columna(&conn, "resoluciones", "fuente", "TEXT NOT NULL DEFAULT 'persona'")?;
        Self::asegurar_columna(&conn, "resoluciones", "motivo", "TEXT")?;
        // Lo anterior a esta columna se anotó sin poder decir otra cosa, y
        // «vigente» es lo que se estaba asumiendo: es el valor honesto para el
        // pasado, no una conjetura nueva.
        Self::asegurar_columna(&conn, "relaciones", "cuando", "TEXT NOT NULL DEFAULT 'vigente'")?;
        // Un articulo terminado y una medicion creible son cosas distintas.
        // Borrar la medicion contaminada de un articulo lo devolvia a la cola
        // como si no se hubiera anotado, y la reanudacion mandaba al principio.
        Self::asegurar_columna(&conn, "tiempos", "valido", "INTEGER NOT NULL DEFAULT 1")?;
        Self::asegurar_columna(&conn, "lote_articulos", "seccion", "TEXT")?;
        Self::asegurar_columna(&conn, "lote_articulos", "calibra", "INTEGER NOT NULL DEFAULT 0")?;
        // Haber pasado por el extractor y haber dado entidades son cosas
        // distintas. Mientras «hecho» se dedujo de tener filas en `extraidas`,
        // un articulo del que el modelo no sacaba nada volvia a la cola en cada
        // corrida: se bajaba y se procesaba una y otra vez sin que la cuenta de
        // pendientes bajara nunca. Con la extraccion por categorias eso deja de
        // ser un desperdicio invisible y pasa a ser una categoria que no puede
        // llegar a cero.
        Self::asegurar_columna(&conn, "lote_articulos", "extraido_at", "TEXT")?;
        for (t, c) in [("lotes", "taxonomia TEXT"), ("lotes", "terminos_json TEXT NOT NULL DEFAULT '[]'"),
                       ("lotes", "desde_anio INTEGER"), ("lotes", "hasta_anio INTEGER"),
                       ("lotes", "calibracion_json TEXT")] {
            let (col, tipo) = c.split_once(' ').unwrap();
            Self::asegurar_columna(&conn, t, col, tipo)?;
        }

        // `lotes` nació como `designs`, la tabla del muestreo aleatorio, con
        // `seed` y `spec_json` obligatorias. Un lote ya no se sortea: se define
        // por un recorte del árbol de categorías, así que esas dos columnas no
        // tienen valor que darles y su NOT NULL rechazaba todo lote nuevo. SQLite
        // no sabe relajar una restricción, de modo que hay que rehacer la tabla.
        Self::renombrar_columna_de_lote(&conn)?;
        Self::retirar_columnas_del_muestreo(&conn)?;
        Self::reapuntar_a_lotes(&conn)?;

        // Los índices que dependen de esas columnas van al final, ya con la
        // certeza de que existen.
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS census_title_key ON census(connection_id, title_key);
             CREATE INDEX IF NOT EXISTS lote_art_cal ON lote_articulos(lote_id, calibra);
             CREATE INDEX IF NOT EXISTS lote_art_hecho ON lote_articulos(lote_id, extraido_at);
             CREATE INDEX IF NOT EXISTS census_terms_term
               ON census_terms(connection_id, taxonomy, term_id);",
        )?;

        // Una base anterior lleva el trabajo hecho anotado solo en `extraidas`.
        // Sin esto, actualizar la app mandaría a rehacer todo lo ya extraído,
        // que en un archivo grande son horas. Solo rellena lo que está vacío,
        // así que a partir de la segunda vez no hace nada.
        conn.execute(
            "UPDATE lote_articulos SET extraido_at = datetime('now')
             WHERE extraido_at IS NULL AND EXISTS (
               SELECT 1 FROM extraidas e
               WHERE e.lote_id = lote_articulos.lote_id AND e.wp_id = lote_articulos.wp_id)",
            [],
        )?;
        Ok(())
    }

    /// Guarda la credencial con la que se probó la pertenencia al sitio.
    pub fn guardar_credencial(
        &self, conn_id: i64, usuario: &str, secreto: &str,
        identidad: &crate::auth::Identidad,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE connections SET auth_method = 'application-password',
               auth_user = ?2, auth_secret = ?3, auth_nombre = ?4, auth_roles = ?5,
               auth_at = datetime('now')
             WHERE id = ?1",
            rusqlite::params![
                conn_id, usuario, secreto, identidad.nombre, identidad.roles.join(",")],
        )?;
        Ok(())
    }

    /// Con qué credencial hablar con este sitio.
    ///
    /// Devuelve `Auth::None` si no hay ninguna, para que quien llame no tenga
    /// que decidir: pedir sin credencial sigue funcionando en un archivo
    /// público, y lo que cambia es lo que se puede ver.
    pub fn credencial(&self, conn_id: i64) -> Result<crate::http::Auth> {
        let conn = self.conn.lock().unwrap();
        let r: (Option<String>, Option<String>) = conn.query_row(
            "SELECT auth_user, auth_secret FROM connections WHERE id = ?1",
            [conn_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok(match r {
            (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => {
                crate::http::Auth::Basic { user: u, password: p }
            }
            _ => crate::http::Auth::None,
        })
    }

    /// Quién quedó registrado como dueño de esta conexión, si alguien.
    pub fn duenio(&self, conn_id: i64) -> Result<Option<(String, String)>> {
        let conn = self.conn.lock().unwrap();
        let r: (Option<String>, Option<String>) = conn.query_row(
            "SELECT auth_nombre, auth_user FROM connections WHERE id = ?1",
            [conn_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(match r {
            (Some(n), Some(u)) if !u.is_empty() => Some((n, u)),
            _ => None,
        })
    }

    /// Olvida la credencial sin tocar el archivo censado.
    pub fn olvidar_credencial(&self, conn_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE connections SET auth_method = 'anonymous', auth_user = NULL,
               auth_secret = NULL, auth_nombre = NULL, auth_roles = NULL, auth_at = NULL
             WHERE id = ?1",
            [conn_id])?;
        Ok(())
    }

    pub fn upsert_connection(
        &self,
        label: &str,
        resolved_origin: &str,
        transport_json: &str,
        transport_label: &str,
        site_name: Option<&str>,
        total_posts: Option<i64>,
        discovery_json: &str,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();

        // Legajo trabaja con un archivo a la vez. Dos sitios en la misma base
        // significan dos censos, dos juegos de lotes y dos grafos compartiendo
        // una `sesion` que solo sabe apuntar a uno: al reabrir, la app volvería
        // a un trabajo a medias sin decir de cuál de los dos. Cambiar de medio
        // es empezar de nuevo, y eso se pide explícitamente olvidando el
        // guardado, con lo que se pierde dicho de antemano.
        let mut st = conn.prepare(
            "SELECT resolved_origin FROM connections WHERE resolved_origin <> ?1 LIMIT 1")?;
        let otro: Option<String> = st
            .query_map([resolved_origin], |r| r.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .next();
        drop(st);
        if let Some(o) = otro {
            return Err(crate::error::Error::Other(format!(
                "Ya hay un medio conectado: {}. Legajo trabaja con un archivo a la vez; \
                 para conectar otro hay que olvidar primero el guardado, y eso borra \
                 su censo, sus lotes y las correcciones que lleve encima.",
                o.replace("https://", "").replace("http://", ""))));
        }

        conn.execute(
            r#"
            INSERT INTO connections
                (label, resolved_origin, transport_json, transport_label,
                 site_name, total_posts, discovery_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(resolved_origin) DO UPDATE SET
                label           = excluded.label,
                transport_json  = excluded.transport_json,
                transport_label = excluded.transport_label,
                site_name       = excluded.site_name,
                total_posts     = excluded.total_posts,
                discovery_json  = excluded.discovery_json,
                last_used_at    = datetime('now')
            "#,
            rusqlite::params![
                label,
                resolved_origin,
                transport_json,
                transport_label,
                site_name,
                total_posts,
                discovery_json
            ],
        )?;
        let id: i64 = conn.query_row(
            "SELECT id FROM connections WHERE resolved_origin = ?1",
            [resolved_origin],
            |r| r.get(0),
        )?;
        Ok(id)
    }

    pub fn actualizar_sondeo(&self, id: i64, d: &crate::Discovery) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE connections SET discovery_json = ?2, total_posts = ?3 WHERE id = ?1",
            rusqlite::params![id, serde_json::to_string(d)?, d.capabilities.total_posts],
        )?;
        Ok(())
    }

    /// El sondeo guardado al conectar: transporte, capacidades y qué anuncia el
    /// sitio sobre su autenticación.
    pub fn discovery(&self, id: i64) -> Result<crate::Discovery> {
        let conn = self.conn.lock().unwrap();
        let j: String = conn.query_row(
            "SELECT discovery_json FROM connections WHERE id = ?1", [id], |r| r.get(0))?;
        serde_json::from_str(&j).map_err(Into::into)
    }

    pub fn transporte(&self, id: i64) -> Result<crate::Transport> {
        let conn = self.conn.lock().unwrap();
        let json: String = conn.query_row(
            "SELECT transport_json FROM connections WHERE id = ?1", [id], |r| r.get(0))?;
        Ok(serde_json::from_str(&json)?)
    }

    pub fn id_por_origen(&self, origen: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT id FROM connections WHERE resolved_origin = ?1", [origen], |r| r.get(0))?)
    }

    // ── Censo ────────────────────────────────────────────────────────────

    pub fn guardar_censo(&self, conn_id: i64, filas: &[crate::census::FilaCenso]) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO census (connection_id, wp_id, date, date_valid, slug, link, title, title_key, author, terms_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
                 ON CONFLICT(connection_id, wp_id) DO UPDATE SET
                   date=excluded.date, date_valid=excluded.date_valid, slug=excluded.slug,
                   link=excluded.link, title=excluded.title, title_key=excluded.title_key,
                   author=excluded.author, terms_json=excluded.terms_json",
            )?;
            let mut st_term = tx.prepare(
                "INSERT OR IGNORE INTO census_terms (connection_id, wp_id, taxonomy, term_id)
                 VALUES (?1,?2,?3,?4)",
            )?;
            for f in filas {
                let clave = f.title.as_deref().map(crate::contenido::clave_titulo);
                st.execute(rusqlite::params![
                    conn_id, f.wp_id, f.date, f.date_valid as i64, f.slug, f.link, f.title,
                    clave, f.author, serde_json::to_string(&f.terms)?
                ])?;
                for (tax, ids) in &f.terms {
                    if let Some(arr) = ids.as_array() {
                        for v in arr {
                            if let Some(id) = v.as_i64() {
                                st_term.execute(rusqlite::params![conn_id, f.wp_id, tax, id])?;
                            }
                        }
                    }
                }
            }
        }
        tx.commit()?;
        Ok(filas.len())
    }

    pub fn guardar_anomalias(&self, conn_id: i64, xs: &[crate::census::Anomalia]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO anomalies (connection_id, wp_id, kind, detail) VALUES (?1,?2,?3,?4)",
            )?;
            for a in xs {
                st.execute(rusqlite::params![conn_id, a.wp_id, a.kind, a.detail])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn guardar_terminos(&self, conn_id: i64, xs: &[crate::census::Termino]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO terms (connection_id, taxonomy, term_id, name, slug, parent, count)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(connection_id, taxonomy, term_id) DO UPDATE SET
                   name=excluded.name, slug=excluded.slug, parent=excluded.parent, count=excluded.count",
            )?;
            for t in xs {
                st.execute(rusqlite::params![conn_id, t.taxonomy, t.term_id, t.name, t.slug, t.parent, t.count])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn marcar_ventana(&self, conn_id: i64, label: &str, filas: usize) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO census_windows (connection_id, label, rows) VALUES (?1,?2,?3)
             ON CONFLICT(connection_id, label) DO UPDATE SET rows=excluded.rows, done_at=datetime('now')",
            rusqlite::params![conn_id, label, filas as i64],
        )?;
        Ok(())
    }

    /// Taxonomias con nombres descargados, con cuantos terminos tiene cada una.
    ///
    /// Solo estas pueden hacer de eje de secciones: sin nombres, el reparto
    /// saldria en identificadores numericos y el join no encuentra nada. Es lo
    /// que hacia que el perfil devolviera secciones vacias en silencio cuando
    /// la taxonomia elegida se habia omitido por tener demasiados terminos.
    pub fn taxonomias_con_nombres(&self, conn_id: i64) -> Result<Vec<(String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT taxonomy, COUNT(*) FROM terms WHERE connection_id = ?1
             GROUP BY taxonomy ORDER BY 2 DESC")?;
        let v = st
            .query_map([conn_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Rellena census_terms desde el JSON para bases censadas antes de que
    /// existiera la tabla. Se salta el trabajo si ya esta al dia.
    pub fn rellenar_terminos_censo(&self, conn_id: i64) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        // Basta con mirar si la tabla ya tiene algo para esta conexion: el
        // relleno solo corre una vez, al abrir una base censada por una version
        // anterior. Contar filas pendientes costaria un escaneo completo cada
        // vez que se pinta el perfil.
        let ya: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM census_terms WHERE connection_id = ?1 LIMIT 1)",
            [conn_id], |r| r.get(0))?;
        let hay_censo: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM census WHERE connection_id = ?1 LIMIT 1)",
            [conn_id], |r| r.get(0))?;
        if ya || !hay_censo {
            return Ok(0);
        }

        let tx = conn.transaction()?;
        let n = tx.execute(
            "INSERT OR IGNORE INTO census_terms (connection_id, wp_id, taxonomy, term_id)
             SELECT c.connection_id, c.wp_id, k.key, v.value
             FROM census c
             JOIN json_each(c.terms_json) k
             JOIN json_each(k.value) v
             WHERE c.connection_id = ?1 AND json_type(k.value) = 'array'",
            [conn_id],
        )?;
        tx.commit()?;
        Ok(n as i64)
    }

    pub fn ventanas_hechas(&self, conn_id: i64) -> Result<std::collections::HashSet<String>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare("SELECT label FROM census_windows WHERE connection_id = ?1")?;
        let it = st.query_map([conn_id], |r| r.get::<_, String>(0))?;
        Ok(it.filter_map(|r| r.ok()).collect())
    }

    pub fn limpiar_censo(&self, conn_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        for t in ["census", "census_terms", "anomalies", "census_windows", "content_probe"] {
            conn.execute(&format!("DELETE FROM {t} WHERE connection_id = ?1"), [conn_id])?;
        }
        Ok(())
    }

    pub fn guardar_sondeo(&self, conn_id: i64, xs: &[(i64, crate::contenido::Limpio)]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO content_probe (connection_id, wp_id, words, blocks, broken, shortcodes)
                 VALUES (?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(connection_id, wp_id) DO UPDATE SET
                   words=excluded.words, blocks=excluded.blocks, broken=excluded.broken,
                   shortcodes=excluded.shortcodes",
            )?;
            for (id, l) in xs {
                st.execute(rusqlite::params![
                    conn_id, id, l.palabras, l.diagnostico.bloques as i64,
                    l.diagnostico.html_roto as i64, l.diagnostico.shortcodes.join(",")
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    // ── Lotes ────────────────────────────────────────────────────────────

    /// Crea un lote y materializa sus artículos desde el censo.
    ///
    /// Los `n_calibrar` que se marcan para la corrección previa se reparten
    /// entre secciones en vez de tomarse en bloque: revisar quince artículos
    /// seguidos de la misma sección no enseñaría nada sobre las demás.
    pub fn crear_lote(
        &self, conn_id: i64, etiqueta: &str,
        alcance: &crate::alcance::Alcance, consulta: &str, n_calibrar: i64,
    ) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO lotes (connection_id, label, taxonomia, terminos_json,
                                desde_anio, hasta_anio)
             VALUES (?1,?2,?3,?4,?5,?6)",
            rusqlite::params![
                conn_id, etiqueta, alcance.taxonomia,
                serde_json::to_string(&alcance.terminos)?,
                alcance.desde_anio, alcance.hasta_anio
            ],
        )?;
        let lote_id = tx.last_insert_rowid();

        tx.execute(
            &format!(
                "INSERT INTO lote_articulos (lote_id, wp_id, seccion)
                 SELECT {lote_id}, q.wp_id, q.seccion FROM ({consulta}) q"),
            [conn_id],
        )?;

        // Reparto del conjunto de calibración: uno por sección dando vueltas,
        // hasta completar. Así entran todas las secciones representadas.
        if n_calibrar > 0 {
            tx.execute(
                "UPDATE lote_articulos SET calibra = 1 WHERE lote_id = ?1 AND wp_id IN (
                   SELECT wp_id FROM (
                     SELECT wp_id, ROW_NUMBER() OVER (PARTITION BY seccion ORDER BY wp_id) AS puesto
                     FROM lote_articulos WHERE lote_id = ?1
                   ) ORDER BY puesto, wp_id LIMIT ?2)",
                rusqlite::params![lote_id, n_calibrar],
            )?;
        }
        tx.commit()?;
        Ok(lote_id)
    }

    pub fn lotes(&self, conn_id: i64) -> Result<Vec<LoteRow>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT l.id, l.label, l.taxonomia, l.created_at,
                    (SELECT COUNT(*) FROM lote_articulos a WHERE a.lote_id = l.id),
                    (SELECT COUNT(*) FROM lote_articulos a WHERE a.lote_id = l.id AND a.calibra = 1),
                    (SELECT COUNT(DISTINCT e.wp_id) FROM extraidas e WHERE e.lote_id = l.id),
                    l.calibracion_json IS NOT NULL
             FROM lotes l WHERE l.connection_id = ?1 ORDER BY l.id DESC")?;
        let v = st
            .query_map([conn_id], |r| Ok(LoteRow {
                id: r.get(0)?, etiqueta: r.get(1)?, taxonomia: r.get(2)?,
                creado: r.get(3)?, articulos: r.get(4)?, calibrar: r.get(5)?,
                extraidos: r.get(6)?, calibrado: r.get::<_, i64>(7)? != 0,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn guardar_calibracion(&self, lote_id: i64, cal: &crate::calibracion::Calibracion) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("UPDATE lotes SET calibracion_json = ?2 WHERE id = ?1",
                     rusqlite::params![lote_id, serde_json::to_string(cal)?])?;
        Ok(())
    }

    pub fn calibracion(&self, lote_id: i64) -> Result<Option<crate::calibracion::Calibracion>> {
        let conn = self.conn.lock().unwrap();
        let j: Option<String> = conn
            .query_row("SELECT calibracion_json FROM lotes WHERE id = ?1", [lote_id], |r| r.get(0))
            .unwrap_or(None);
        Ok(j.and_then(|s| serde_json::from_str(&s).ok()))
    }

    // ── Los artículos del lote ───────────────────────────────────────────

    /// Los artículos que hay que revisar: el conjunto de calibración.
    ///
    /// No el lote entero. Un lote son miles de artículos y solo se descarga el
    /// cuerpo de la docena que se revisa a mano; recorrerlos todos hacía que del
    /// decimotercero en adelante la pantalla dijera «este artículo no tiene
    /// cuerpo descargado», que era verdad y no tenía arreglo, porque nunca debió
    /// haber pedido ese artículo.
    pub fn muestra(&self, lote_id: i64) -> Result<Vec<crate::db::FilaAnotable>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            // `epoch` y `section` eran del muestreo por estratos, que ya no
            // existe: solo quedan en bases creadas por versiones anteriores, y
            // en una instalación nueva esta consulta fallaba entera. La sección
            // vive ahora en `seccion`, que sí está en el esquema declarado.
            "SELECT s.wp_id, s.seccion, c.title, c.date, c.link,
                    a.text_plain, a.html_raw, a.word_count
             FROM lote_articulos s
             JOIN census c ON c.connection_id = (SELECT connection_id FROM lotes WHERE id = ?1)
                          AND c.wp_id = s.wp_id
             LEFT JOIN articles a ON a.connection_id = c.connection_id AND a.wp_id = s.wp_id
             WHERE s.lote_id = ?1 AND s.calibra = 1
             ORDER BY c.date, s.wp_id",
        )?;
        let v = st
            .query_map([lote_id], |r| {
                Ok(FilaAnotable {
                    wp_id: r.get(0)?, seccion: r.get(1)?,
                    titulo: r.get(2)?, fecha: r.get(3)?, link: r.get(4)?,
                    texto: r.get(5)?, html: r.get(6)?, palabras: r.get(7)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Artículos de la muestra a los que todavía les falta el cuerpo.
    pub fn muestra_sin_contenido(&self, lote_id: i64) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT s.wp_id FROM lote_articulos s
             WHERE s.lote_id = ?1 AND NOT EXISTS (
               SELECT 1 FROM articles a
               WHERE a.connection_id = (SELECT connection_id FROM lotes WHERE id = ?1)
                 AND a.wp_id = s.wp_id)",
        )?;
        let v = st
            .query_map([lote_id], |r| r.get::<_, i64>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn guardar_articulos(
        &self,
        conn_id: i64,
        xs: &[(i64, String, crate::contenido::Limpio)],
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO articles (connection_id, wp_id, html_raw, text_plain, word_count)
                 VALUES (?1,?2,?3,?4,?5)
                 ON CONFLICT(connection_id, wp_id) DO UPDATE SET
                   html_raw=excluded.html_raw, text_plain=excluded.text_plain,
                   word_count=excluded.word_count, fetched_at=datetime('now')",
            )?;
            for (id, html, limpio) in xs {
                st.execute(rusqlite::params![conn_id, id, html, limpio.texto, limpio.palabras])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    // ── Anotacion ────────────────────────────────────────────────────────

    /// Reemplaza las anotaciones de un articulo. Se guarda entero en cada
    /// cambio: son decenas de filas y evita un estado a medias si algo falla.
    pub fn guardar_anotacion(
        &self,
        lote_id: i64,
        wp_id: i64,
        menciones: &[Mencion],
        relaciones: &[RelacionFila],
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM anotaciones WHERE lote_id = ?1 AND wp_id = ?2",
                   rusqlite::params![lote_id, wp_id])?;
        tx.execute("DELETE FROM relaciones WHERE lote_id = ?1 AND wp_id = ?2",
                   rusqlite::params![lote_id, wp_id])?;
        {
            let mut st = tx.prepare(
                "INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo, auto, grupo, designa)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)")?;
            for m in menciones {
                st.execute(rusqlite::params![
                    lote_id, wp_id, m.mid, m.pi, m.ini, m.fin, m.texto, m.tipo,
                    m.auto as i64, m.grupo, m.designa as i64])?;
            }
            let mut st = tx.prepare(
                "INSERT OR IGNORE INTO relaciones
                   (lote_id, wp_id, rid, a_mid, b_mid, predicado, cuando)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)")?;
            // El `rid` es distinto en cada una, así que la clave primaria no
            // ve el duplicado: hay que reconocerlo por lo que la relación dice.
            let mut vistas = std::collections::HashSet::new();
            for r in relaciones {
                if r.a_mid == r.b_mid {
                    continue;
                }
                let (a, b) = extremos_canonicos(&r.predicado, &r.a_mid, &r.b_mid);
                if !vistas.insert((a.to_string(), b.to_string(), r.predicado.clone())) {
                    continue;
                }
                st.execute(rusqlite::params![
                    lote_id, wp_id, r.rid, a, b, r.predicado, r.cuando])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn anotacion(&self, lote_id: i64, wp_id: i64) -> Result<(Vec<Mencion>, Vec<RelacionFila>)> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT mid, pi, ini, fin, texto, tipo, auto, grupo, designa FROM anotaciones
             WHERE lote_id = ?1 AND wp_id = ?2 ORDER BY pi, ini")?;
        let ms: Vec<Mencion> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| Ok(Mencion {
                mid: r.get(0)?, pi: r.get(1)?, ini: r.get(2)?, fin: r.get(3)?,
                texto: r.get(4)?, tipo: r.get(5)?, auto: r.get::<_, i64>(6)? != 0,
                grupo: r.get(7)?, designa: r.get::<_, i64>(8)? != 0,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);
        let mut st = conn.prepare(
            "SELECT rid, a_mid, b_mid, predicado, cuando FROM relaciones
             WHERE lote_id = ?1 AND wp_id = ?2")?;
        let rs: Vec<RelacionFila> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| Ok(RelacionFila {
                rid: r.get(0)?, a_mid: r.get(1)?, b_mid: r.get(2)?, predicado: r.get(3)?,
                cuando: r.get(4)?,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        Ok((ms, rs))
    }

    /// Anota el tiempo invertido en un artículo.
    ///
    /// `cerrado` distingue el guardado periódico —que ocurre mientras se anota,
    /// para que cerrar la ventana no borre los minutos ya puestos— del cierre
    /// definitivo, que es el que cuenta como artículo terminado.
    /// Lo aprendido hasta ahora: cada texto anotado con el tipo que se le dio.
    ///
    /// Sirve para pre-marcar articulos nuevos. Un texto que en unos articulos
    /// se marco como una cosa y en otros como otra sale como ambiguo y no se
    /// propaga: proponer el tipo equivocado cuesta mas de corregir que de
    /// marcar desde cero, y ademas ancla al anotador.
    /// Alias declarados por la persona: pares de formas que nombran lo mismo.
    ///
    /// Es lo que el paso 7 tendria que haber deducido solo. Guardarlo permite
    /// medir cuanto acierta el emparejador automatico contra un criterio humano.
    /// Lo que el modelo propuso para un artículo, listo para corregir.
    ///
    /// Es el eslabón del que depende toda la promesa del paso: la persona no
    /// marca desde una página en blanco, corrige. Se sirve ya filtrado por la
    /// calibración vigente —umbral por tipo y lista de bloqueo— porque mostrar
    /// lo que la calibración anterior ya descartó obligaría a rechazar dos veces
    /// lo mismo.
    ///
    /// Las relaciones vienen por texto y no por identificador de marca, que es
    /// como las guarda el extractor; se casan con las menciones aquí, y la que
    /// no encuentre sus dos extremos se descarta en silencio: proponer una
    /// relación cuyos extremos no están marcados no es corregible.
    pub fn propuestas(&self, lote_id: i64, wp_id: i64) -> Result<(Vec<Mencion>, Vec<RelacionFila>)> {
        let cal = self.calibracion(lote_id)?.unwrap_or_default();
        let bloqueadas: std::collections::HashSet<(String, String)> =
            cal.bloqueadas.iter().map(|(t, x)| (t.clone(), x.to_lowercase())).collect();

        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT pi, ini, fin, texto, etiqueta, score, canon FROM extraidas
             WHERE lote_id = ?1 AND wp_id = ?2 ORDER BY pi, ini, fin")?;
        let crudas: Vec<(i64, i64, i64, String, String, f64, Option<String>)> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        // Las menciones que dentro del artículo se resolvieron a la misma forma
        // completa llegan a la revisión ya unidas con «=»: es lo que la persona
        // habría hecho a mano, y deshacerlo es una tecla.
        let mut por_canon: std::collections::HashMap<(String, String), usize> = std::collections::HashMap::new();
        for (_, _, _, texto, etiqueta, _, canon) in &crudas {
            let clave = canon.clone().unwrap_or_else(|| texto.clone());
            *por_canon.entry((etiqueta.clone(), clave)).or_insert(0) += 1;
        }

        let mut menciones: Vec<Mencion> = Vec::new();
        for (pi, ini, fin, texto, etiqueta, score, canon) in crudas {
            let umbral = cal.umbrales.get(&etiqueta).copied().unwrap_or(0.50);
            if score < umbral || bloqueadas.contains(&(etiqueta.clone(), texto.to_lowercase())) {
                continue;
            }
            let clave = canon.clone().unwrap_or_else(|| texto.clone());
            let grupo = if por_canon.get(&(etiqueta.clone(), clave.clone())).copied().unwrap_or(0) >= 2 {
                Some(format!("c:{}:{}", etiqueta, crate::resolucion::plegar(&clave)))
            } else {
                None
            };
            menciones.push(Mencion {
                mid: format!("m{pi}-{ini}-{fin}"),
                pi, ini, fin, texto, tipo: etiqueta,
                // Todo lo que llega del modelo entra marcado como asistido: lo
                // que la persona toque deja de serlo, y esa diferencia es lo que
                // permite decir después cuánto puso cada uno.
                auto: true,
                grupo,
                // El extractor no distingue una descripción definida de un
                // nombre; eso lo pone la persona al revisar.
                designa: false,
            });
        }

        let mut st = conn.prepare(
            "SELECT pi, a, b, predicado FROM relaciones_extraidas
             WHERE lote_id = ?1 AND wp_id = ?2 ORDER BY pi")?;
        let crudas: Vec<(i64, String, String, String)> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        let buscar = |pi: i64, texto: &str| -> Option<String> {
            menciones.iter()
                .find(|m| m.pi == pi && m.texto == texto)
                .map(|m| m.mid.clone())
        };
        let mut relaciones = Vec::new();
        for (pi, a, b, predicado) in crudas {
            if let (Some(am), Some(bm)) = (buscar(pi, &a), buscar(pi, &b)) {
                if am == bm { continue; }
                let rid = format!("r{pi}-{am}-{bm}");
                if relaciones.iter().any(|r: &RelacionFila| r.rid == rid) { continue; }
                // El modelo no predice tiempo verbal. «Vigente» es lo que el
                // texto afirma por defecto, y corregirlo es un clic; asumir lo
                // contrario obligaría a corregir la mayoría.
                relaciones.push(RelacionFila {
                    rid, a_mid: am, b_mid: bm, predicado, cuando: "vigente".into(),
                });
            }
        }
        Ok((menciones, relaciones))
    }

    pub fn alias_declarados(&self, lote_id: i64) -> Result<Vec<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT DISTINCT a.tipo, a.texto, b.texto
             FROM anotaciones a JOIN anotaciones b
               ON a.lote_id = b.lote_id AND a.grupo = b.grupo
             WHERE a.lote_id = ?1 AND a.grupo IS NOT NULL
               AND a.texto < b.texto",
        )?;
        let v = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn lexico(&self, lote_id: i64) -> Result<Vec<EntradaLexico>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT a.texto, a.tipo, COUNT(DISTINCT a.wp_id) AS arts,
                    (SELECT COUNT(DISTINCT b.tipo) FROM anotaciones b
                     WHERE b.lote_id = a.lote_id AND b.texto = a.texto) AS tipos
             FROM anotaciones a
             WHERE a.lote_id = ?1 AND LENGTH(a.texto) >= 3
             GROUP BY a.texto, a.tipo
             ORDER BY LENGTH(a.texto) DESC",
        )?;
        let v = st
            .query_map([lote_id], |r| {
                Ok(EntradaLexico {
                    texto: r.get(0)?,
                    tipo: r.get(1)?,
                    articulos: r.get(2)?,
                    ambigua: r.get::<_, i64>(3)? > 1,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn registrar_tiempo(
        &self, lote_id: i64, wp_id: i64, segundos: i64, menciones: i64, cerrado: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let orden: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tiempos WHERE lote_id = ?1 AND cerrado = 1",
            [lote_id], |r| r.get(0))?;
        conn.execute(
            "INSERT INTO tiempos (lote_id, wp_id, segundos, menciones, orden, cerrado)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(lote_id, wp_id) DO UPDATE SET
               segundos = excluded.segundos, menciones = excluded.menciones,
               -- Un artículo ya cerrado no vuelve a abrirse por un guardado
               -- periódico posterior, ni pierde su puesto en el orden.
               cerrado = MAX(tiempos.cerrado, excluded.cerrado),
               orden = CASE WHEN tiempos.cerrado = 1 THEN tiempos.orden ELSE excluded.orden END,
               cerrado_at = datetime('now')",
            rusqlite::params![lote_id, wp_id, segundos, menciones, orden, cerrado as i64],
        )?;
        Ok(())
    }

    /// Invalida la medición de un artículo sin deshacer su cierre.
    ///
    /// Una medición contaminada —la ventana abierta mientras se hacía otra
    /// cosa, o un artículo por el que se pasó de largo— es peor que ninguna:
    /// entra en la mediana y desplaza la única cifra que la fase produce. Pero
    /// el artículo sigue anotado y terminado: borrar la fila entera lo devolvía
    /// a la cola y mandaba la reanudación al principio de la muestra.
    pub fn descartar_tiempo(&self, lote_id: i64, wp_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE tiempos SET valido = 0 WHERE lote_id = ?1 AND wp_id = ?2",
            rusqlite::params![lote_id, wp_id],
        )?;
        Ok(())
    }

    /// Mediciones que no son creíbles como tiempo de anotación real.
    ///
    /// Muy cortas: se pasó de largo sin anotar. Muy largas: la ventana quedó
    /// abierta. No se borran solas —eso lo decide quien anota— pero se señalan.
    pub fn tiempos_dudosos(&self, lote_id: i64) -> Result<Vec<(i64, i64, i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT t.wp_id, t.segundos, t.menciones, COALESCE(c.title, '')
             FROM tiempos t
             JOIN lotes d ON d.id = t.lote_id
             LEFT JOIN census c ON c.connection_id = d.connection_id AND c.wp_id = t.wp_id
             WHERE t.lote_id = ?1 AND t.cerrado = 1
               AND t.valido = 1
               AND (t.segundos < 20 OR t.segundos > 1800)
             ORDER BY t.segundos",
        )?;
        let v = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Segundos ya invertidos en un artículo, para reanudar el cronómetro.
    pub fn tiempo_de(&self, lote_id: i64, wp_id: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row(
                "SELECT segundos FROM tiempos WHERE lote_id = ?1 AND wp_id = ?2",
                rusqlite::params![lote_id, wp_id],
                |r| r.get(0),
            )
            .unwrap_or(0))
    }

    /// Cuantos articulos de la muestra llevan ya anotacion cerrada.
    pub fn avance_anotacion(&self, lote_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let hechos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tiempos WHERE lote_id = ?1 AND cerrado = 1",
            [lote_id], |r| r.get(0))?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM lote_articulos WHERE lote_id = ?1 AND calibra = 1",
            [lote_id], |r| r.get(0))?;
        Ok((hechos, total))
    }

    // ── Grafo ────────────────────────────────────────────────────────────

    /// Las entidades del lote, uniendo lo extraido con lo revisado a mano.
    ///
    /// Se cuenta por articulos distintos y no por menciones: una entidad que
    /// aparece cuarenta veces en un solo articulo pesa menos en el grafo que
    /// una que aparece en cuarenta articulos.
    pub fn grafo_entidades(&self, lote_id: i64, limite: i64) -> Result<Vec<NodoGrafo>> {
        // Lo que el diccionario o el juez decidieron que es la misma entidad se
        // funde igual que lo que la persona marcó con «=»: se agrega en Rust
        // porque la unión encadena y en SQL saldría ilegible.
        let canon = self.nombres_canonicos(lote_id)?;
        // La lista de bloqueo de la calibración también vale para el grafo: lo
        // que la revisión no enseña («Estado», «gobierno») tampoco se cuenta.
        let bloqueadas: std::collections::HashSet<(String, String)> = self
            .calibracion(lote_id)?
            .map(|c| c.bloqueadas.into_iter().map(|(t, x)| (t, x.to_lowercase())).collect())
            .unwrap_or_default();
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT tipo, superficie, texto, menciones, wp_id, revisada FROM (
                 -- Cuando la persona declaró que varias marcas nombran a la
                 -- misma entidad, el grafo la cuenta una vez y con el nombre
                 -- más largo del grupo, que es casi siempre el completo:
                 -- «Gustavo Petro» y no «Petro». Ignorar esa declaración sería
                 -- tirar el único dato de identidad que hay verificado.
                 SELECT a.tipo AS tipo, a.texto AS superficie,
                        COALESCE((SELECT g.texto FROM anotaciones g
                                  WHERE g.lote_id = a.lote_id AND g.grupo = a.grupo
                                  ORDER BY LENGTH(g.texto) DESC, g.texto LIMIT 1),
                                 a.texto) AS texto,
                        COUNT(*) AS menciones,
                        a.wp_id AS wp_id, 1 AS revisada
                 FROM anotaciones a WHERE a.lote_id = ?1
                 GROUP BY a.tipo, texto, a.wp_id
                 UNION ALL
                 -- Lo propuesto por el modelo entra solo por encima del corte
                 -- de su tipo (la calibración del lote, o 0,5): por debajo son
                 -- candidatos que nadie confirmó y que la revisión tampoco enseña.
                 SELECT e.etiqueta, e.texto, COALESCE(e.canon, e.texto), COUNT(*), e.wp_id, 0
                 FROM extraidas e JOIN lotes d ON d.id = e.lote_id
                 WHERE e.lote_id = ?1
                   AND e.score >= COALESCE(json_extract(d.calibracion_json, '$.umbrales.' || e.etiqueta), 0.5)
                   AND NOT EXISTS (SELECT 1 FROM anotaciones a2
                                   WHERE a2.lote_id = e.lote_id AND a2.wp_id = e.wp_id)
                 GROUP BY e.etiqueta, e.texto, COALESCE(e.canon, e.texto), e.wp_id
             )")?;
        let filas: Vec<(String, String, String, i64, i64, i64)> = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        let mut acumulado: std::collections::HashMap<(String, String), (i64, std::collections::HashSet<i64>, bool)> =
            std::collections::HashMap::new();
        for (tipo, superficie, texto, menciones, wp, revisada) in filas {
            // El bloqueo mira lo que el modelo escribió («Estado»), no la forma
            // completa a la que se resolvió («Estado colombiano»).
            if revisada == 0 && (bloqueadas.contains(&(tipo.clone(), superficie.to_lowercase()))
                || bloqueadas.contains(&(tipo.clone(), texto.to_lowercase()))) {
                continue;
            }
            let texto = canon.get(&texto).cloned().unwrap_or(texto);
            let e = acumulado.entry((tipo, texto)).or_insert_with(|| (0, std::collections::HashSet::new(), false));
            e.0 += menciones;
            e.1.insert(wp);
            e.2 |= revisada != 0;
        }
        let mut v: Vec<NodoGrafo> = acumulado
            .into_iter()
            .map(|((tipo, texto), (menciones, arts, revisada))| NodoGrafo {
                tipo, texto, menciones, articulos: arts.len() as i64, revisada,
            })
            .collect();
        v.sort_by(|x, y| y.articulos.cmp(&x.articulos).then(y.menciones.cmp(&x.menciones)).then(x.texto.cmp(&y.texto)));
        v.truncate(limite.max(0) as usize);
        Ok(v)
    }

    pub fn grafo_relaciones(&self, lote_id: i64, limite: i64) -> Result<Vec<AristaGrafo>> {
        let canon = self.nombres_canonicos(lote_id)?;
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT a, b, predicado, wp_id, revisada, cuando, anio FROM (
                 SELECT ma.texto AS a, mb.texto AS b, r.predicado AS predicado,
                        r.wp_id AS wp_id, 1 AS revisada, r.cuando AS cuando,
                        CAST(SUBSTR(ce.date, 1, 4) AS INTEGER) AS anio
                 FROM relaciones r
                 JOIN anotaciones ma ON ma.lote_id = r.lote_id AND ma.wp_id = r.wp_id AND ma.mid = r.a_mid
                 JOIN anotaciones mb ON mb.lote_id = r.lote_id AND mb.wp_id = r.wp_id AND mb.mid = r.b_mid
                 JOIN lotes d ON d.id = r.lote_id
                 LEFT JOIN census ce ON ce.connection_id = d.connection_id AND ce.wp_id = r.wp_id
                                    AND ce.date_valid = 1
                 WHERE r.lote_id = ?1
                 UNION ALL
                 -- Lo que solo propuso el modelo entra como vigente: el modelo no
                 -- predice tiempo verbal, y decir «vigente» es repetir lo que el
                 -- texto afirma en presente, no inventar una fecha.
                 -- Los extremos van por su forma completa dentro del artículo:
                 -- «Petro ocupa el cargo presidente» cuenta para «Gustavo Petro».
                 SELECT COALESCE((SELECT ea.canon FROM extraidas ea WHERE ea.lote_id = x.lote_id AND ea.wp_id = x.wp_id
                                    AND ea.pi = x.pi AND ea.texto = x.a AND ea.canon IS NOT NULL LIMIT 1), x.a),
                        COALESCE((SELECT eb.canon FROM extraidas eb WHERE eb.lote_id = x.lote_id AND eb.wp_id = x.wp_id
                                    AND eb.pi = x.pi AND eb.texto = x.b AND eb.canon IS NOT NULL LIMIT 1), x.b),
                        x.predicado, x.wp_id, 0, 'vigente',
                        CAST(SUBSTR(ce.date, 1, 4) AS INTEGER)
                 FROM relaciones_extraidas x
                 JOIN lotes d ON d.id = x.lote_id
                 LEFT JOIN census ce ON ce.connection_id = d.connection_id AND ce.wp_id = x.wp_id
                                    AND ce.date_valid = 1
                 WHERE x.lote_id = ?1
                   AND NOT EXISTS (SELECT 1 FROM relaciones r2
                                   WHERE r2.lote_id = x.lote_id AND r2.wp_id = x.wp_id)
             ) WHERE a <> '' AND b <> ''")?;
        let filas: Vec<(String, String, String, i64, i64, String, Option<i32>)> = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        type Acum = (std::collections::HashSet<i64>, bool, std::collections::BTreeMap<i32, std::collections::HashSet<i64>>);
        let mut acumulado: std::collections::HashMap<(String, String, String, String), Acum> = std::collections::HashMap::new();
        for (a, b, predicado, wp, revisada, cuando, anio) in filas {
            let a = canon.get(&a).cloned().unwrap_or(a);
            let b = canon.get(&b).cloned().unwrap_or(b);
            if a == b {
                continue; // dos nombres del mismo actor no se relacionan entre sí
            }
            let e = acumulado.entry((a, b, predicado, cuando)).or_insert_with(|| (std::collections::HashSet::new(), false, Default::default()));
            e.0.insert(wp);
            e.1 |= revisada != 0;
            if let Some(y) = anio {
                e.2.entry(y).or_default().insert(wp);
            }
        }
        let mut v: Vec<AristaGrafo> = acumulado
            .into_iter()
            .map(|((a, b, predicado, cuando), (arts, revisada, anios))| AristaGrafo {
                a, b, predicado, articulos: arts.len() as i64, revisada, cuando,
                desde_anio: anios.keys().next().copied(), hasta_anio: anios.keys().next_back().copied(),
                por_anio: anios.iter().map(|(y, ws)| (*y, ws.len() as i64)).collect(),
            })
            .collect();
        v.sort_by(|x, y| y.articulos.cmp(&x.articulos).then(x.a.cmp(&y.a)).then(x.b.cmp(&y.b)).then(x.predicado.cmp(&y.predicado)));
        v.truncate(limite.max(0) as usize);
        Ok(v)
    }

    /// De dónde sale una relación del grafo: los artículos y párrafos que la
    /// afirman, con lo que la persona confirmó marcado. Es lo que permite
    /// mirar un hallazgo y ver la frase, en vez de creerse la arista.
    pub fn grafo_evidencia(&self, lote_id: i64, a: &str, b: &str, predicado: &str, limite: i64) -> Result<Vec<Evidencia>> {
        let canon = self.nombres_canonicos(lote_id)?;
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT f.wp_id, f.pi, f.a, f.b, f.revisada, ce.title, ce.date, ce.link, d.connection_id FROM (
                 SELECT r.lote_id AS lote_id, r.wp_id AS wp_id, ma.pi AS pi, ma.texto AS a, mb.texto AS b, 1 AS revisada
                 FROM relaciones r
                 JOIN anotaciones ma ON ma.lote_id = r.lote_id AND ma.wp_id = r.wp_id AND ma.mid = r.a_mid
                 JOIN anotaciones mb ON mb.lote_id = r.lote_id AND mb.wp_id = r.wp_id AND mb.mid = r.b_mid
                 WHERE r.lote_id = ?1 AND r.predicado = ?2
                 UNION ALL
                 SELECT x.lote_id, x.wp_id, x.pi,
                        COALESCE((SELECT ea.canon FROM extraidas ea WHERE ea.lote_id = x.lote_id AND ea.wp_id = x.wp_id
                                    AND ea.pi = x.pi AND ea.texto = x.a AND ea.canon IS NOT NULL LIMIT 1), x.a),
                        COALESCE((SELECT eb.canon FROM extraidas eb WHERE eb.lote_id = x.lote_id AND eb.wp_id = x.wp_id
                                    AND eb.pi = x.pi AND eb.texto = x.b AND eb.canon IS NOT NULL LIMIT 1), x.b),
                        0
                 FROM relaciones_extraidas x
                 WHERE x.lote_id = ?1 AND x.predicado = ?2
                   AND NOT EXISTS (SELECT 1 FROM relaciones r2 WHERE r2.lote_id = x.lote_id AND r2.wp_id = x.wp_id)
             ) f
             JOIN lotes d ON d.id = f.lote_id
             LEFT JOIN census ce ON ce.connection_id = d.connection_id AND ce.wp_id = f.wp_id
             ORDER BY ce.date DESC")?;
        let filas: Vec<(i64, i64, String, String, i64, Option<String>, Option<String>, Option<String>, i64)> = st
            .query_map(rusqlite::params![lote_id, predicado], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);
        let quiere = |x: &str, y: &str| canon.get(x).map(String::as_str).unwrap_or(x) == y;
        let mut out = Vec::new();
        let mut vistos = std::collections::HashSet::new();
        for (wp, pi, fa, fb, revisada, titulo, fecha, enlace, conn_id) in filas {
            if !(quiere(&fa, a) && quiere(&fb, b)) || !vistos.insert((wp, pi)) {
                continue;
            }
            let parrafo: Option<String> = conn.query_row(
                "SELECT text_plain FROM articles WHERE connection_id = ?1 AND wp_id = ?2",
                rusqlite::params![conn_id, wp], |r| r.get(0)).ok();
            let parrafo = parrafo
                .and_then(|t| t.split("\n\n").filter(|p| !p.trim().is_empty()).nth(pi as usize).map(str::to_string))
                .unwrap_or_default();
            out.push(Evidencia { wp_id: wp, pi, titulo, fecha, enlace, parrafo, revisada: revisada != 0 });
            if out.len() as i64 >= limite {
                break;
            }
        }
        Ok(out)
    }

    /// Cifras de conjunto del lote.
    /// Las descripciones sin nombre del lote, con los ocupantes conocidos de
    /// esa misma plaza.
    ///
    /// Es donde los dos huecos se pagan a la vez. «El Gobernador de Antioquia»
    /// sin nombre no vale nada por sí solo; junto a «Luis Alfredo Ramos ocupa el
    /// cargo Gobernador de Antioquia, afirmado en 2010» ya es una identidad
    /// candidata. Y sin la vigencia se propondría además al gobernador de 2003,
    /// que es otra persona: saber cuándo es lo que impide equivocarse, no un
    /// adorno.
    ///
    /// No funde nada. Propone, ordena por cercanía en el tiempo y enseña la
    /// distancia, porque quien lea el archivo sabe si ese cargo dura cuatro
    /// años o veinte.
    pub fn grafo_sin_nombrar(&self, lote_id: i64, limite: i64) -> Result<Vec<SinNombrar>> {
        let conn = self.conn.lock().unwrap();

        // Ocupantes conocidos: alguien nombrado que ocupa o aspira a una plaza,
        // con el año del artículo que lo afirma.
        let mut st = conn.prepare(
            "SELECT LOWER(c.texto), p.texto, r.cuando,
                    CAST(SUBSTR(ce.date, 1, 4) AS INTEGER)
             FROM relaciones r
             JOIN anotaciones p ON p.lote_id = r.lote_id AND p.wp_id = r.wp_id AND p.mid = r.a_mid
             JOIN anotaciones c ON c.lote_id = r.lote_id AND c.wp_id = r.wp_id AND c.mid = r.b_mid
             JOIN lotes d ON d.id = r.lote_id
             LEFT JOIN census ce ON ce.connection_id = d.connection_id AND ce.wp_id = r.wp_id
                                AND ce.date_valid = 1
             WHERE r.lote_id = ?1 AND r.predicado = 'ocupa el cargo'
               AND p.tipo = 'persona' AND p.designa = 0")?;
        let ocupantes: Vec<(String, String, String, Option<i32>)> = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        // Las descripciones sin nombre, una fila por texto y artículo.
        let mut st = conn.prepare(
            "SELECT a.texto, a.tipo, a.wp_id, ce.title,
                    CAST(SUBSTR(ce.date, 1, 4) AS INTEGER)
             FROM anotaciones a
             JOIN lotes d ON d.id = a.lote_id
             LEFT JOIN census ce ON ce.connection_id = d.connection_id AND ce.wp_id = a.wp_id
                                AND ce.date_valid = 1
             WHERE a.lote_id = ?1 AND a.designa = 1
             GROUP BY a.texto, a.wp_id
             ORDER BY a.wp_id, a.texto
             LIMIT ?2")?;
        let filas: Vec<(String, String, i64, Option<String>, Option<i32>)> = st
            .query_map(rusqlite::params![lote_id, limite], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        let mut out = Vec::new();
        for (texto, tipo, wp_id, titulo, anio) in filas {
            let clave = texto.to_lowercase();
            let mut candidatos: Vec<Ocupante> = ocupantes
                .iter()
                .filter(|(cargo, _, _, _)| *cargo == clave)
                .map(|(_, nombre, cuando, a)| Ocupante {
                    nombre: nombre.clone(),
                    anio: *a,
                    distancia: match (anio, a) {
                        (Some(x), Some(y)) => Some((x - y).abs()),
                        _ => None,
                    },
                    cuando: cuando.clone(),
                })
                .collect();
            // Lo más cercano en el tiempo primero; lo que no tiene fecha, al
            // final: sin fecha no se puede juzgar y no debe encabezar la lista.
            candidatos.sort_by_key(|c| (c.distancia.is_none(), c.distancia.unwrap_or(i32::MAX), c.nombre.clone()));
            candidatos.dedup_by(|a, b| a.nombre == b.nombre && a.anio == b.anio);
            out.push(SinNombrar { texto, tipo, wp_id, titulo, anio, candidatos });
        }
        Ok(out)
    }

    pub fn grafo_resumen(&self, lote_id: i64) -> Result<ResumenGrafo> {
        let conn = self.conn.lock().unwrap();
        let uno = |sql: &str| -> i64 { conn.query_row(sql, [lote_id], |r| r.get(0)).unwrap_or(0) };
        let distintas = uno(
            "SELECT COUNT(*) FROM (SELECT DISTINCT tipo, texto FROM (
               SELECT tipo, texto FROM anotaciones WHERE lote_id = ?1
               UNION SELECT e.etiqueta, COALESCE(e.canon, e.texto) FROM extraidas e JOIN lotes d ON d.id = e.lote_id
                 WHERE e.lote_id = ?1 AND e.score >= COALESCE(json_extract(d.calibracion_json, '$.umbrales.' || e.etiqueta), 0.5)))");
        let una_vez = uno(
            "SELECT COUNT(*) FROM (
               SELECT texto FROM (
                 SELECT texto, wp_id FROM anotaciones WHERE lote_id = ?1
                 UNION SELECT COALESCE(e.canon, e.texto), e.wp_id FROM extraidas e JOIN lotes d ON d.id = e.lote_id
                 WHERE e.lote_id = ?1 AND e.score >= COALESCE(json_extract(d.calibracion_json, '$.umbrales.' || e.etiqueta), 0.5))
               GROUP BY texto HAVING COUNT(DISTINCT wp_id) = 1)");
        Ok(ResumenGrafo {
            articulos: uno("SELECT COUNT(*) FROM lote_articulos WHERE lote_id = ?1"),
            procesados: uno("SELECT COUNT(DISTINCT wp_id) FROM extraidas WHERE lote_id = ?1"),
            revisados: uno("SELECT COUNT(DISTINCT wp_id) FROM anotaciones WHERE lote_id = ?1"),
            entidades_distintas: distintas,
            entidades_una_vez: una_vez,
            relaciones: uno(
                "SELECT COUNT(*) FROM (
                   SELECT a, b, predicado FROM relaciones_extraidas WHERE lote_id = ?1
                   UNION SELECT a_mid, b_mid, predicado FROM relaciones WHERE lote_id = ?1)"),
        })
    }

    // ── Resolucion ───────────────────────────────────────────────────────

    pub fn decidir_resolucion(
        &self, lote_id: i64, clave: &str, a: &str, b: &str,
        tipo: &str, decision: &str, confianza: f64, fuente: &str, motivo: Option<&str>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO resoluciones (lote_id, clave, a_nombre, b_nombre, tipo, decision, confianza, fuente, motivo)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(lote_id, clave) DO UPDATE SET
               decision = excluded.decision, confianza = excluded.confianza, fuente = excluded.fuente,
               motivo = excluded.motivo, decidido_at = datetime('now')",
            rusqlite::params![lote_id, clave, a, b, tipo, decision, confianza, fuente, motivo],
        )?;
        Ok(())
    }

    /// Las decisiones del lote, las más recientes primero.
    pub fn resoluciones(&self, lote_id: i64) -> Result<Vec<Resolucion>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT clave, a_nombre, b_nombre, tipo, decision, confianza, fuente, motivo, decidido_at
             FROM resoluciones WHERE lote_id = ?1 ORDER BY decidido_at DESC, clave")?;
        let v = st
            .query_map([lote_id], |r| Ok(Resolucion {
                clave: r.get(0)?, a: r.get(1)?, b: r.get(2)?, tipo: r.get(3)?, decision: r.get(4)?,
                confianza: r.get(5)?, fuente: r.get(6)?, motivo: r.get(7)?, decidido_at: r.get(8)?,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Para cada nombre que alguna decisión «misma» une a otro, el nombre con
    /// el que el grafo lo cuenta: el más largo de su componente, que es casi
    /// siempre el completo. Las decisiones encadenan («Fico» = «Fico Gutiérrez»
    /// = «Federico Gutiérrez»), así que es una unión de conjuntos, no un mapa
    /// de pares.
    pub fn nombres_canonicos(&self, lote_id: i64) -> Result<std::collections::HashMap<String, String>> {
        let pares: Vec<(String, String)> = {
            let conn = self.conn.lock().unwrap();
            let mut st = conn.prepare(
                "SELECT a_nombre, b_nombre FROM resoluciones WHERE lote_id = ?1 AND decision = 'misma'")?;
            let v: Vec<(String, String)> = st.query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .filter_map(|r| r.ok())
                .collect();
            v
        };
        Ok(crate::resolucion::canonicos(&pares))
    }

    pub fn avance_resolucion(&self, lote_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let decididos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM resoluciones WHERE lote_id = ?1 AND decision <> 'posponer'",
            [lote_id], |r| r.get(0))?;
        let pospuestos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM resoluciones WHERE lote_id = ?1 AND decision = 'posponer'",
            [lote_id], |r| r.get(0))?;
        Ok((decididos, pospuestos))
    }

    // ── Extraccion ───────────────────────────────────────────────────────

    pub fn guardar_extraidas(
        &self, lote_id: i64, wp_id: i64,
        por_parrafo: &[Vec<crate::extraccion::Entidad>],
    ) -> Result<i64> {
        // El cuerpo entero se mira una vez para resolver las formas cortas a
        // la completa; el extractor trabaja por párrafos y no puede saberlo.
        let mut por_parrafo = por_parrafo.to_vec();
        crate::resolucion::canonizar_articulo(&mut por_parrafo);
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM extraidas WHERE lote_id = ?1 AND wp_id = ?2",
                   rusqlite::params![lote_id, wp_id])?;
        let mut n = 0i64;
        {
            let mut st = tx.prepare(
                "INSERT OR REPLACE INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score, canon)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")?;
            for (pi, grupo) in por_parrafo.iter().enumerate() {
                for e in grupo {
                    st.execute(rusqlite::params![
                        lote_id, wp_id, pi as i64, e.inicio, e.fin, e.texto, e.etiqueta, e.score, e.canon])?;
                    n += 1;
                }
            }
        }
        tx.commit()?;
        Ok(n)
    }

    /// Vuelve a resolver las formas cortas de todos los artículos extraídos de
    /// un lote. Para lo que se extrajo antes de que existiera `canon`.
    pub fn recanonizar(&self, lote_id: i64) -> Result<usize> {
        let filas: Vec<(i64, i64, i64, i64, String, String, f64)> = {
            let conn = self.conn.lock().unwrap();
            let mut st = conn.prepare(
                "SELECT wp_id, pi, ini, fin, texto, etiqueta, score FROM extraidas WHERE lote_id = ?1 ORDER BY wp_id, pi, ini")?;
            let v = st.query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))?
                .filter_map(|r| r.ok()).collect::<Vec<_>>();
            v
        };
        let mut por_wp: std::collections::BTreeMap<i64, Vec<Vec<crate::extraccion::Entidad>>> = std::collections::BTreeMap::new();
        for (wp, pi, ini, fin, texto, etiqueta, score) in filas {
            let arts = por_wp.entry(wp).or_default();
            let pi = pi as usize;
            if arts.len() <= pi { arts.resize(pi + 1, Vec::new()); }
            arts[pi].push(crate::extraccion::Entidad { texto, inicio: ini, fin, etiqueta, score, canon: None });
        }
        let mut total = 0;
        for (wp, mut arts) in por_wp {
            total += crate::resolucion::canonizar_articulo(&mut arts);
            let conn = self.conn.lock().unwrap();
            let mut st = conn.prepare(
                "UPDATE extraidas SET canon = ?5 WHERE lote_id = ?1 AND wp_id = ?2 AND pi = ?3 AND ini = ?4")?;
            for (pi, grupo) in arts.iter().enumerate() {
                for e in grupo {
                    st.execute(rusqlite::params![lote_id, wp, pi as i64, e.inicio, e.canon])?;
                }
            }
        }
        Ok(total)
    }

    pub fn guardar_relaciones_extraidas(
        &self, lote_id: i64, wp_id: i64,
        por_parrafo: &[Vec<crate::extraccion::RelacionExtraida>],
    ) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM relaciones_extraidas WHERE lote_id = ?1 AND wp_id = ?2",
                   rusqlite::params![lote_id, wp_id])?;
        let mut n = 0i64;
        {
            let mut st = tx.prepare(
                // Si el espejo ya entró, gana el de más confianza: es lo único
                // que hay para desempatar cuál de los dos sentidos es el bueno.
                "INSERT INTO relaciones_extraidas (lote_id, wp_id, pi, a, b, predicado, score)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(lote_id, wp_id, pi, a, b, predicado) DO UPDATE SET
                   score = MAX(score, excluded.score)")?;
            for (pi, grupo) in por_parrafo.iter().enumerate() {
                for r in grupo {
                    // Nada se relaciona consigo mismo. Pasa cuando la misma
                    // cadena aparece dos veces en el párrafo.
                    if r.a == r.b {
                        continue;
                    }
                    let (a, b) = extremos_canonicos(&r.predicado, &r.a, &r.b);
                    st.execute(rusqlite::params![
                        lote_id, wp_id, pi as i64, a, b, r.predicado, r.score])?;
                    n += 1;
                }
            }
        }
        tx.commit()?;
        Ok(n)
    }

    /// Articulos del lote con cuerpo descargado y sin extraer todavia.
    ///
    /// `solo_calibracion` limita al conjunto que se revisa antes de soltar el
    /// extractor sobre el resto.
    pub fn pendientes_extraccion_lote(
        &self, lote_id: i64, solo_calibracion: bool,
    ) -> Result<Vec<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let filtro = if solo_calibracion { "AND s.calibra = 1" } else { "" };
        let mut st = conn.prepare(&format!(
            "SELECT s.wp_id, a.text_plain FROM lote_articulos s
             JOIN lotes d ON d.id = s.lote_id
             JOIN articles a ON a.connection_id = d.connection_id AND a.wp_id = s.wp_id
             WHERE s.lote_id = ?1 {filtro}
               AND a.text_plain IS NOT NULL AND a.text_plain <> ''
               AND NOT EXISTS (SELECT 1 FROM extraidas e
                               WHERE e.lote_id = s.lote_id AND e.wp_id = s.wp_id)
             ORDER BY s.wp_id"))?;
        let v = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Articulos del lote sin el cuerpo descargado todavia.
    pub fn lote_sin_contenido(&self, lote_id: i64, solo_calibracion: bool) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let filtro = if solo_calibracion { "AND s.calibra = 1" } else { "" };
        let mut st = conn.prepare(&format!(
            "SELECT s.wp_id FROM lote_articulos s JOIN lotes d ON d.id = s.lote_id
             WHERE s.lote_id = ?1 {filtro} AND NOT EXISTS (
               SELECT 1 FROM articles a
               WHERE a.connection_id = d.connection_id AND a.wp_id = s.wp_id
                 AND a.text_plain IS NOT NULL AND a.text_plain <> '')"))?;
        let v = st.query_map([lote_id], |r| r.get::<_, i64>(0))?.filter_map(|r| r.ok()).collect();
        Ok(v)
    }

    // ── Extracción por categorías ────────────────────────────────────────

    /// Los artículos del lote que aún no han pasado por el extractor,
    /// opcionalmente limitados a una rama del árbol de categorías.
    ///
    /// Devuelve solo identificadores y no exige cuerpo descargado, al revés que
    /// la versión anterior. Con la extracción por tandas el cuerpo se trae
    /// dentro del mismo bucle que extrae, así que exigirlo aquí dejaría fuera
    /// justo a los que faltan por bajar: la consulta devolvería vacío y no
    /// habría nada que procesar.
    ///
    /// `terminos` ya viene expandido con los descendientes: elegir una
    /// categoría madre arrastra sus hijas, que es como está organizado el
    /// archivo y como se eligió en el paso de alcance.
    pub fn pendientes_del_lote(
        &self, lote_id: i64, solo_calibracion: bool, terminos: &[i64],
    ) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let filtro = if solo_calibracion { "AND s.calibra = 1" } else { "" };
        // Los términos son enteros ya tipados, no texto del usuario.
        let rama = if terminos.is_empty() {
            String::new()
        } else {
            let ids = terminos.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            format!(
                " AND EXISTS (SELECT 1 FROM census_terms x
                              WHERE x.connection_id = d.connection_id AND x.wp_id = s.wp_id
                                AND x.taxonomy = d.taxonomia AND x.term_id IN ({ids}))")
        };
        let mut st = conn.prepare(&format!(
            "SELECT s.wp_id FROM lote_articulos s
             JOIN lotes d ON d.id = s.lote_id
             WHERE s.lote_id = ?1 {filtro} AND s.extraido_at IS NULL {rama}
             ORDER BY s.wp_id"))?;
        let v = st.query_map([lote_id], |r| r.get::<_, i64>(0))?.filter_map(|r| r.ok()).collect();
        Ok(v)
    }

    /// Deshace la extracción de parte de un lote para poder repetirla.
    ///
    /// Volver a extraer es una operación normal, no una anomalía: cambia el
    /// modelo, cambian las reglas, cambia la calibración, y lo propuesto sobre
    /// un lote queda viejo. Sin esto la única salida era crear otro lote, y
    /// así aparecieron dos lotes idénticos con la misma revisión encima.
    ///
    /// Se borran las **propuestas** —entidades y relaciones extraídas— y se
    /// marcan los artículos como pendientes. Las marcas de la persona y sus
    /// tiempos no se tocan: son su trabajo, no el del modelo. Devuelve cuántos
    /// artículos vuelven a la cola.
    pub fn deshacer_extraccion(
        &self, lote_id: i64, solo_calibracion: bool, terminos: &[i64],
    ) -> Result<usize> {
        let mut conn = self.conn.lock().unwrap();
        let filtro = if solo_calibracion { "AND s.calibra = 1" } else { "" };
        let rama = if terminos.is_empty() {
            String::new()
        } else {
            let ids = terminos.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            format!(
                " AND EXISTS (SELECT 1 FROM census_terms x
                              WHERE x.connection_id = d.connection_id AND x.wp_id = s.wp_id
                                AND x.taxonomy = d.taxonomia AND x.term_id IN ({ids}))")
        };
        let tx = conn.transaction()?;
        let ids: Vec<i64> = {
            let mut st = tx.prepare(&format!(
                "SELECT s.wp_id FROM lote_articulos s
                 JOIN lotes d ON d.id = s.lote_id
                 WHERE s.lote_id = ?1 {filtro} AND s.extraido_at IS NOT NULL {rama}"))?;
            let v: Vec<i64> = st.query_map([lote_id], |r| r.get::<_, i64>(0))?
                .filter_map(|r| r.ok()).collect();
            v
        };
        for wp in &ids {
            tx.execute("DELETE FROM extraidas WHERE lote_id = ?1 AND wp_id = ?2", rusqlite::params![lote_id, wp])?;
            tx.execute("DELETE FROM relaciones_extraidas WHERE lote_id = ?1 AND wp_id = ?2", rusqlite::params![lote_id, wp])?;
            tx.execute("UPDATE lote_articulos SET extraido_at = NULL WHERE lote_id = ?1 AND wp_id = ?2", rusqlite::params![lote_id, wp])?;
        }
        tx.commit()?;
        Ok(ids.len())
    }

    /// Cuáles de estos artículos no tienen todavía el cuerpo en caché.
    ///
    /// El caché de cuerpos es del sitio y no del lote, así que una tanda puede
    /// llegar con parte del trabajo hecho: los doce de calibración ya se
    /// bajaron en el paso 5, y un artículo que esté en dos categorías se bajó
    /// al extraer la primera.
    pub fn sin_cuerpo(&self, conn_id: i64, ids: &[i64]) -> Result<Vec<i64>> {
        if ids.is_empty() { return Ok(Vec::new()); }
        let conn = self.conn.lock().unwrap();
        let lista = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let mut st = conn.prepare(&format!(
            "SELECT wp_id FROM articles
             WHERE connection_id = ?1 AND wp_id IN ({lista})
               AND text_plain IS NOT NULL AND text_plain <> ''"))?;
        let tienen: std::collections::HashSet<i64> = st
            .query_map([conn_id], |r| r.get::<_, i64>(0))?
            .filter_map(|r| r.ok())
            .collect();
        // Se conserva el orden de lo pedido: la tanda se pide por identificador
        // ascendente y la petición al sitio sale igual.
        Ok(ids.iter().copied().filter(|i| !tienen.contains(i)).collect())
    }

    /// Los cuerpos ya limpios de una tanda, en el orden en que se pidieron.
    pub fn textos_de(&self, conn_id: i64, ids: &[i64]) -> Result<Vec<(i64, String)>> {
        if ids.is_empty() { return Ok(Vec::new()); }
        let conn = self.conn.lock().unwrap();
        let lista = ids.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        let mut st = conn.prepare(&format!(
            "SELECT wp_id, text_plain FROM articles
             WHERE connection_id = ?1 AND wp_id IN ({lista})
               AND text_plain IS NOT NULL AND text_plain <> ''
             ORDER BY wp_id"))?;
        let v = st
            .query_map([conn_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Deja constancia de que estos artículos ya pasaron por el extractor.
    ///
    /// Se marca aunque no hayan dado ninguna entidad: haber sido procesado y
    /// haber rendido algo son cosas distintas, y confundirlas es lo que dejaba
    /// artículos dando vueltas en la cola para siempre.
    pub fn marcar_extraidos(&self, lote_id: i64, ids: &[i64]) -> Result<()> {
        if ids.is_empty() { return Ok(()); }
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        {
            let mut st = tx.prepare(
                "UPDATE lote_articulos SET extraido_at = datetime('now')
                 WHERE lote_id = ?1 AND wp_id = ?2")?;
            for id in ids {
                st.execute(rusqlite::params![lote_id, id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Las categorías presentes en un lote, con cuánto llevan hecho.
    ///
    /// Es la cola de trabajo del paso 7: de aquí sale qué queda por extraer y
    /// en qué orden conviene atacarlo. Un artículo que lleva dos categorías
    /// cuenta en las dos, porque en WordPress una nota regional suele llevar la
    /// subcategoría y la madre; se extrae una sola vez y al hacerlo baja el
    /// pendiente de ambas.
    pub fn categorias_del_lote(&self, lote_id: i64) -> Result<Vec<CategoriaLote>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT t.term_id, t.name, t.slug, t.parent,
                    COUNT(*),
                    SUM(CASE WHEN s.extraido_at IS NOT NULL THEN 1 ELSE 0 END)
             FROM lote_articulos s
             JOIN lotes d ON d.id = s.lote_id
             JOIN census_terms x ON x.connection_id = d.connection_id
                                AND x.wp_id = s.wp_id AND x.taxonomy = d.taxonomia
             JOIN terms t ON t.connection_id = d.connection_id
                         AND t.taxonomy = x.taxonomy AND t.term_id = x.term_id
             WHERE s.lote_id = ?1
             GROUP BY t.term_id
             ORDER BY COUNT(*) - SUM(CASE WHEN s.extraido_at IS NOT NULL THEN 1 ELSE 0 END) DESC,
                      t.name")?;
        let v = st
            .query_map([lote_id], |r| {
                let total: i64 = r.get(4)?;
                let hechos: i64 = r.get(5)?;
                Ok(CategoriaLote {
                    term_id: r.get(0)?, nombre: r.get(1)?, slug: r.get(2)?, parent: r.get(3)?,
                    total, extraidos: hechos, pendientes: total - hechos,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Artículos del lote que no caen en ninguna categoría de la taxonomía.
    ///
    /// Existen —el censo los marca como `sin_terminos`— y si la cola solo
    /// mostrara categorías quedarían fuera del recorrido sin que nadie lo
    /// notara: el lote nunca llegaría a cero y no habría dónde ver por qué.
    pub fn sueltos_del_lote(&self, lote_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row(
            "SELECT COUNT(*), SUM(CASE WHEN s.extraido_at IS NOT NULL THEN 1 ELSE 0 END)
             FROM lote_articulos s
             JOIN lotes d ON d.id = s.lote_id
             WHERE s.lote_id = ?1 AND NOT EXISTS (
               SELECT 1 FROM census_terms x
               WHERE x.connection_id = d.connection_id AND x.wp_id = s.wp_id
                 AND x.taxonomy = d.taxonomia)",
            [lote_id],
            |r| Ok((r.get(0)?, r.get::<_, Option<i64>>(1)?.unwrap_or(0))),
        )?)
    }

    /// La taxonomía sobre la que se definió el lote.
    ///
    /// Cae en `categories` si el lote es de una versión anterior que no la
    /// guardaba: es la que usa el árbol de secciones y la única que existía.
    pub fn taxonomia_de_lote(&self, lote_id: i64) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let t: Option<String> = conn
            .query_row("SELECT taxonomia FROM lotes WHERE id = ?1", [lote_id], |r| r.get(0))
            .unwrap_or(None);
        Ok(t.filter(|s| !s.is_empty()).unwrap_or_else(|| "categories".into()))
    }

    pub fn conexion_de_lote(&self, lote_id: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT connection_id FROM lotes WHERE id = ?1", [lote_id], |r| r.get(0))?)
    }

    /// Articulos de la muestra con cuerpo descargado y sin extraer todavia.
    pub fn pendientes_extraccion(&self, lote_id: i64) -> Result<Vec<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT s.wp_id, a.text_plain FROM lote_articulos s
             JOIN lotes d ON d.id = s.lote_id
             JOIN articles a ON a.connection_id = d.connection_id AND a.wp_id = s.wp_id
             WHERE s.lote_id = ?1 AND a.text_plain IS NOT NULL AND a.text_plain <> ''
               AND NOT EXISTS (SELECT 1 FROM extraidas e
                               WHERE e.lote_id = s.lote_id AND e.wp_id = s.wp_id)
             ORDER BY s.wp_id")?;
        let v = st
            .query_map([lote_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Cuántos artículos lleva procesados y cuántos son en total.
    ///
    /// `solo_calibracion` tiene que ser el mismo con el que corre la
    /// extracción. Cuando no lo era, la barra se quedaba clavada: el
    /// denominador contaba todos los artículos que tuvieran cuerpo descargado
    /// —y el caché de cuerpos es del sitio, no del lote, así que arrastraba los
    /// de lotes anteriores— mientras que la corrida procesaba solo los doce de
    /// calibración. «12 de 21» y ahí se quedaba para siempre, sin nada roto que
    /// arreglar porque nunca hubo un artículo 13 que procesar.
    ///
    /// El total tampoco puede exigir cuerpo descargado: la extracción los
    /// descarga sobre la marcha, así que contar solo los que ya están haría que
    /// la barra creciera y menguara al mismo tiempo.
    ///
    /// Lo hecho se cuenta por `extraido_at` y no por tener filas en
    /// `extraidas`. Un artículo del que el modelo no saca ninguna entidad está
    /// procesado igual, y contarlo como pendiente dejaba la barra sin poder
    /// llegar al final por una razón que no era un fallo.
    ///
    /// `terminos` limita la cuenta a una rama del árbol, para que la barra
    /// hable de la categoría que se está extrayendo y no del lote entero.
    pub fn avance_extraccion(
        &self, lote_id: i64, solo_calibracion: bool, terminos: &[i64],
    ) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let filtro = if solo_calibracion { "AND s.calibra = 1" } else { "" };
        let rama = if terminos.is_empty() {
            String::new()
        } else {
            let ids = terminos.iter().map(|i| i.to_string()).collect::<Vec<_>>().join(",");
            format!(
                " AND EXISTS (SELECT 1 FROM census_terms x
                              WHERE x.connection_id = d.connection_id AND x.wp_id = s.wp_id
                                AND x.taxonomy = d.taxonomia AND x.term_id IN ({ids}))")
        };
        let fila = |extra: &str| -> Result<i64> {
            Ok(conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM lote_articulos s
                     JOIN lotes d ON d.id = s.lote_id
                     WHERE s.lote_id = ?1 {filtro} {rama} {extra}"),
                [lote_id], |r| r.get(0))?)
        };
        Ok((fila("AND s.extraido_at IS NOT NULL")?, fila("")?))
    }

    // ── Sesion ───────────────────────────────────────────────────────────

    pub fn guardar_sesion(
        &self, connection_id: Option<i64>, paso: &str, progreso: i64,
        taxonomia: Option<&str>, lote_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sesion (id, connection_id, paso, progreso, taxonomia, lote_id)
             VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               connection_id = excluded.connection_id, paso = excluded.paso,
               progreso = excluded.progreso, taxonomia = excluded.taxonomia,
               lote_id = excluded.lote_id, guardado_at = datetime('now')",
            rusqlite::params![connection_id, paso, progreso, taxonomia, lote_id],
        )?;
        Ok(())
    }

    /// Lo que hace falta para dejar al usuario donde estaba, incluido el
    /// descubrimiento del sitio para no tener que volver a sondearlo.
    pub fn cargar_sesion(&self) -> Result<Option<Sesion>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT s.connection_id, s.paso, s.progreso, s.taxonomia, s.lote_id,
                    c.discovery_json, c.label
             FROM sesion s LEFT JOIN connections c ON c.id = s.connection_id
             WHERE s.id = 1",
            [],
            |r| {
                Ok(Sesion {
                    connection_id: r.get(0)?,
                    paso: r.get(1)?,
                    progreso: r.get(2)?,
                    taxonomia: r.get(3)?,
                    lote_id: r.get(4)?,
                    discovery_json: r.get(5)?,
                    etiqueta: r.get(6)?,
                })
            },
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    pub fn olvidar_sesion(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM sesion WHERE id = 1", [])?;
        Ok(())
    }

    /// Primer artículo de la muestra que todavía no se ha cerrado.
    ///
    /// Reanudar en el índice cero obligaría a pasar de nuevo por todo lo ya
    /// anotado, y peor: el cronómetro volvería a contar tiempo sobre artículos
    /// ya medidos y estropearía la única cifra que la fase existe para producir.
    pub fn siguiente_sin_cerrar(&self, lote_id: i64) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT s.wp_id FROM lote_articulos s
             JOIN lotes d ON d.id = s.lote_id
             JOIN census c ON c.connection_id = d.connection_id AND c.wp_id = s.wp_id
             WHERE s.lote_id = ?1 AND s.calibra = 1
               AND NOT EXISTS (SELECT 1 FROM tiempos t
                               WHERE t.lote_id = s.lote_id AND t.wp_id = s.wp_id
                                 AND t.cerrado = 1)
             ORDER BY c.date, s.wp_id LIMIT 1",
            [lote_id],
            |r| r.get::<_, i64>(0),
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// La única conexión guardada, con el descubrimiento tal cual quedó.
    ///
    /// Devuelve también el JSON del sondeo para que reabrir la app no tenga que
    /// volver a preguntarle al sitio quién es: son seis peticiones a un
    /// servidor ajeno para averiguar algo que ya está en disco.
    pub fn conexion_guardada(&self) -> Result<Option<(ConnectionRow, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT id, label, resolved_origin, transport_label, site_name, total_posts,
                    auth_method, created_at, last_used_at, discovery_json
             FROM connections ORDER BY id LIMIT 1")?;
        let fila = st
            .query_map([], |r| {
                Ok((
                    ConnectionRow {
                        id: r.get(0)?, label: r.get(1)?, resolved_origin: r.get(2)?,
                        transport_label: r.get(3)?, site_name: r.get(4)?,
                        total_posts: r.get(5)?, auth_method: r.get(6)?,
                        created_at: r.get(7)?, last_used_at: r.get(8)?,
                    },
                    r.get::<_, Option<String>>(9)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .next();
        Ok(fila)
    }

    /// Olvida un sitio y todo lo que se supo de él.
    ///
    /// Borrar la fila de `connections` dispara las cascadas, y hoy todas las
    /// tablas cuelgan de ahí —directamente o a través de `lotes`—. Pero eso es
    /// una propiedad del esquema, no una garantía: basta que alguien añada una
    /// tabla y olvide la clave foránea para que queden restos de un archivo
    /// que el usuario cree borrado. Como Legajo trabaja con un medio a la vez,
    /// cuando se va el último no puede sobrevivir ni una fila: lo que quede es
    /// basura de una cascada que no saltó, y se barre. Las tablas se leen del
    /// propio esquema, así que esto no se queda viejo al añadir una.
    ///
    /// Después se compacta el fichero. SQLite marca las páginas como libres
    /// pero no las devuelve al disco ni las sobrescribe: sin esto, el texto de
    /// un archivo entero —que ahora son gigabytes, desde que el censo se trae
    /// los cuerpos— seguiría legible dentro del fichero después de «borrarlo».
    pub fn delete_connection(&self, id: i64) -> Result<()> {
        {
            let mut conn = self.conn.lock().unwrap();
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM connections WHERE id = ?1", [id])?;

            let quedan: i64 =
                tx.query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0))?;
            if quedan == 0 {
                let mut st = tx.prepare(
                    "SELECT name FROM sqlite_master
                     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")?;
                let tablas: Vec<String> = st
                    .query_map([], |r| r.get::<_, String>(0))?
                    .filter_map(|r| r.ok())
                    .collect();
                drop(st);
                for t in tablas {
                    // El nombre viene del esquema, no de fuera.
                    tx.execute(&format!("DELETE FROM {t}"), [])?;
                }
            }
            tx.commit()?;
        }

        // VACUUM no puede correr dentro de una transacción, y necesita el
        // candado libre de la escritura anterior. El volcado posterior no es
        // opcional: en modo WAL el fichero se reconstruye a través del diario,
        // así que sin checkpoint el `.sqlite` conserva las páginas viejas —con
        // el texto de los artículos legible dentro— y el `-wal` guarda una
        // copia más. Truncar deja los dos limpios.
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("VACUUM; PRAGMA wal_checkpoint(TRUNCATE);")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cada prueba necesita su propio archivo: comparten proceso y corren en paralelo.
    fn db_temporal(nombre: &str) -> (Db, std::path::PathBuf) {
        let p = std::env::temp_dir()
            .join(format!("legajo-test-{}-{nombre}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&p);
        (Db::open(&p).unwrap(), p)
    }

    #[test]
    fn olvidar_el_sitio_no_deja_ni_una_fila() {
        /* «Eliminar el sitio» tiene que llevarse todo. Hoy cada tabla cuelga de
           `connections` por cascada, pero eso es una propiedad del esquema y no
           una garantía: basta una tabla nueva sin clave foránea para que queden
           restos de un archivo que el usuario cree borrado. Esta prueba llena
           todas las tablas y exige que después no quede nada; y como recorre el
           esquema en vez de una lista escrita a mano, una tabla nueva que se
           olvide de limpiar hace fallar la prueba sola. */
        let (db, path) = db_temporal("sin-rastro");

        let conn_id = db.upsert_connection(
            "La Silla", "https://www.lasillavacia.com", "{}", "REST directo",
            Some("La Silla Vacia"), Some(84_343), r#"{"x":1}"#).unwrap();
        db.guardar_sesion(Some(conn_id), "perfil", 1, None, Some(1)).unwrap();

        db.con(|c| {
            c.execute_batch(&format!("
                INSERT INTO lotes (id, connection_id, label, taxonomia)
                  VALUES (1, {conn_id}, 'lote', 'categories');
                INSERT INTO census (connection_id, wp_id, date, date_valid, title, title_key)
                  VALUES ({conn_id}, 10, '2016-01-01', 1, 't', 't');
                INSERT INTO census_terms (connection_id, wp_id, taxonomy, term_id)
                  VALUES ({conn_id}, 10, 'categories', 5);
                INSERT INTO census_windows (connection_id, label, rows)
                  VALUES ({conn_id}, '2016-01', 1);
                INSERT INTO terms (connection_id, taxonomy, term_id, name, slug, parent, count)
                  VALUES ({conn_id}, 'categories', 5, 'Nacional', 'nacional', 0, 1);
                INSERT INTO anomalies (connection_id, wp_id, kind, detail)
                  VALUES ({conn_id}, 10, 'sin_titulo', '');
                INSERT INTO articles (connection_id, wp_id, html_raw, text_plain, word_count)
                  VALUES ({conn_id}, 10, '<p>secreto</p>', 'secreto', 1);
                INSERT INTO content_probe (connection_id, wp_id, words, blocks, broken, shortcodes)
                  VALUES ({conn_id}, 10, 1, 0, 0, '');
                INSERT INTO jobs (connection_id, kind, state) VALUES ({conn_id}, 'censo', 'listo');
                INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1, 10);
                INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo)
                  VALUES (1, 10, 'm1', 0, 0, 5, 'Petro', 'persona');
                INSERT INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score)
                  VALUES (1, 10, 0, 0, 5, 'Petro', 'persona', 0.9);
                INSERT INTO relaciones (lote_id, wp_id, rid, a_mid, b_mid, predicado, cuando)
                  VALUES (1, 10, 'r1', 'm1', 'm2', 'aliado de', 'vigente');
                INSERT INTO relaciones_extraidas (lote_id, wp_id, pi, a, b, predicado, score)
                  VALUES (1, 10, 0, 'a', 'b', 'aliado de', 0.8);
                INSERT INTO resoluciones (lote_id, clave, a_nombre, b_nombre, tipo, decision, confianza)
                  VALUES (1, 'k', 'A', 'B', 'persona', 'misma', 0.9);
                INSERT INTO tiempos (lote_id, wp_id, segundos, menciones, orden)
                  VALUES (1, 10, 30, 2, 1);
            "))?;
            Ok(())
        }).unwrap();

        let tablas = |db: &Db| -> Vec<String> {
            db.con(|c| {
                let mut st = c.prepare(
                    "SELECT name FROM sqlite_master
                     WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?;
                let v = st.query_map([], |r| r.get::<_, String>(0))?
                    .filter_map(|r| r.ok()).collect();
                Ok(v)
            }).unwrap()
        };
        let cuenta = |db: &Db, t: &str| -> i64 {
            db.con(|c| Ok(c.query_row(
                &format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0))?)).unwrap()
        };

        // Si la prueba dejara una tabla vacía no estaría comprobando nada sobre
        // ella, y el borrado podría dejarla sucia sin que nadie se enterara.
        let todas = tablas(&db);
        for t in &todas {
            assert!(cuenta(&db, t) > 0, "la prueba dejó «{t}» vacía: no comprueba nada sobre ella");
        }

        db.delete_connection(conn_id).unwrap();

        for t in &todas {
            let n = cuenta(&db, t);
            assert_eq!(n, 0, "«{t}» conservó {n} filas del sitio olvidado");
        }

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn olvidar_el_sitio_saca_su_texto_del_fichero() {
        /* SQLite marca las páginas borradas como libres pero no las sobrescribe
           ni devuelve el espacio: sin compactar, el cuerpo de los artículos se
           sigue leyendo con un editor hexadecimal después de haberlo «borrado».
           Desde que el censo se trae los cuerpos eso son gigabytes del archivo
           de un medio, en un programa cuya promesa es que ese archivo no sale
           de aquí. */
        let (db, path) = db_temporal("sin-rastro-en-disco");
        let conn_id = db.upsert_connection(
            "La Silla", "https://www.lasillavacia.com", "{}", "REST directo",
            None, None, "{}").unwrap();
        db.con(|c| {
            c.execute(
                "INSERT INTO articles (connection_id, wp_id, html_raw, text_plain, word_count)
                 VALUES (?1, 10, '<p>zanahoria-testigo</p>', 'zanahoria-testigo', 1)",
                [conn_id])?;
            // El fichero está en WAL: sin volcar, lo escrito vive en el `-wal`
            // y leer el `.sqlite` no probaría nada.
            c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
            Ok(())
        }).unwrap();

        let testigo = b"zanahoria-testigo";
        let dentro = |p: &std::path::Path| -> bool {
            std::fs::read(p).map(|v| v.windows(testigo.len()).any(|w| w == testigo)).unwrap_or(false)
        };
        assert!(dentro(&path), "el montaje no sirve: el texto ni siquiera llegó al fichero");

        db.delete_connection(conn_id).unwrap();

        let wal = path.with_extension("sqlite-wal");
        assert!(!dentro(&path), "el texto del archivo sigue en el fichero tras olvidarlo");
        assert!(!dentro(&wal), "el texto del archivo sigue en el diario tras olvidarlo");

        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn solo_puede_haber_un_medio_conectado() {
        /* Legajo trabaja con un archivo a la vez. Dos sitios en la misma base
           serían dos censos, dos juegos de lotes y dos grafos compartiendo una
           `sesion` que solo sabe apuntar a uno. Cambiar de medio es empezar de
           nuevo, y se pide explícitamente olvidando el guardado. */
        let (db, path) = db_temporal("conexiones");

        let id = db
            .upsert_connection("La Silla", "https://www.lasillavacia.com", r#"{"kind":"direct_pretty","origin":"https://www.lasillavacia.com"}"#, "REST directo", Some("La Silla Vacia"), Some(84_343), "{}")
            .unwrap();

        let (fila, _) = db.conexion_guardada().unwrap().expect("hay un medio");
        assert_eq!(fila.total_posts, Some(84_343));

        // Reconectar al mismo sitio actualiza en vez de duplicar: es la razon de
        // que resolved_origin sea UNIQUE y de que se resuelva tras redirecciones.
        let id2 = db
            .upsert_connection("La Silla Vacia", "https://www.lasillavacia.com", "{}", "REST directo", None, Some(84_400), "{}")
            .unwrap();
        assert_eq!(id, id2);
        let (fila, _) = db.conexion_guardada().unwrap().unwrap();
        assert_eq!(fila.label, "La Silla Vacia");
        assert_eq!(fila.total_posts, Some(84_400));

        // Pero otro sitio distinto no entra mientras este siga guardado.
        let otro = db.upsert_connection(
            "Otro medio", "https://otromedio.co", "{}", "REST directo", None, None, "{}");
        assert!(otro.is_err(), "un segundo medio no puede convivir con el primero");
        let msg = otro.unwrap_err().to_string();
        assert!(msg.contains("lasillavacia.com"),
                "el error tiene que decir cuál está ocupando el sitio: {msg}");

        // Olvidar el guardado deja la puerta abierta al siguiente.
        db.delete_connection(id).unwrap();
        assert!(db.conexion_guardada().unwrap().is_none());
        db.upsert_connection(
            "Otro medio", "https://otromedio.co", "{}", "REST directo", None, None, "{}")
            .expect("con la base limpia sí entra");

        let _ = std::fs::remove_file(path);
    }

    /// Base con dos artículos sobre la misma plaza: uno nombra a quien la
    /// ocupa, el otro solo la describe.
    fn base_de_cargos(nombre: &str) -> (Db, std::path::PathBuf) {
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-{nombre}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        {
            let c = db.conn.lock().unwrap();
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');
                 INSERT INTO census (connection_id, wp_id, date, date_valid, title) VALUES
                   (1, 10, '2010-03-15', 1, 'El gabinete'),
                   (1, 11, '2003-06-01', 1, 'Otro tiempo'),
                   (1, 12, '2011-08-20', 1, 'Los hijos');",
            ).unwrap();
        }
        (db, path)
    }

    #[test]
    fn una_descripcion_sin_nombre_recibe_a_quien_ocupaba_la_plaza() {
        /* «El Gobernador de Antioquia» sin nombre no vale nada por sí solo. El
           valor aparece al cruzarlo con quien ocupaba esa plaza por esas
           fechas, y la fecha es justo lo que impide proponer al gobernador de
           ocho años antes, que es otra persona. */
        let (db, path) = base_de_cargos("sinnombre");

        // 2010: alguien nombrado ocupa la plaza.
        db.guardar_anotacion(1, 10,
            &[m("m1", 0, 0, 17, "Luis Alfredo Ramos", "persona"),
              m("m2", 0, 20, 44, "Gobernador de Antioquia", "cargo")],
            &[rel("r1", "m1", "m2", "ocupa el cargo", "vigente")]).unwrap();

        // 2003: otro, en el mismo cargo. Es el que no debe encabezar la lista.
        db.guardar_anotacion(1, 11,
            &[m("m1", 0, 0, 12, "Aníbal Gaviria", "persona"),
              m("m2", 0, 20, 44, "Gobernador de Antioquia", "cargo")],
            &[rel("r1", "m1", "m2", "ocupa el cargo", "vigente")]).unwrap();

        // 2011: la plaza aparece descrita, sin nombre.
        let mut sin = m("m1", 0, 0, 23, "Gobernador de Antioquia", "cargo");
        sin.designa = true;
        db.guardar_anotacion(1, 12, &[sin], &[]).unwrap();

        let casos = db.grafo_sin_nombrar(1, 50).unwrap();
        assert_eq!(casos.len(), 1, "solo la marcada como descripción: {casos:?}");
        let c = &casos[0];
        assert_eq!(c.texto, "Gobernador de Antioquia");
        assert_eq!(c.anio, Some(2011));
        assert_eq!(c.titulo.as_deref(), Some("Los hijos"));

        assert_eq!(c.candidatos.len(), 2, "los dos ocupantes conocidos");
        assert_eq!(c.candidatos[0].nombre, "Luis Alfredo Ramos", "primero el más cercano");
        assert_eq!(c.candidatos[0].distancia, Some(1));
        assert_eq!(c.candidatos[1].nombre, "Aníbal Gaviria");
        assert_eq!(c.candidatos[1].distancia, Some(8), "ocho años: casi seguro otra persona");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn haber_sido_ministro_y_serlo_no_son_la_misma_arista() {
        /* La fecha del artículo dice cuándo se **afirmó**, no cuándo fue
           **cierto**. Si el grafo suma las dos vigencias en una sola arista,
           afirma que Costa es ministro hoy, que es exactamente lo que nadie
           dijo. */
        let (db, path) = base_de_cargos("vigencia");

        db.guardar_anotacion(1, 10,
            &[m("m1", 0, 0, 12, "Carlos Costa", "persona"),
              m("m2", 0, 20, 40, "ministro de Ambiente", "cargo")],
            &[rel("r1", "m1", "m2", "ocupa el cargo", "vigente")]).unwrap();

        db.guardar_anotacion(1, 12,
            &[m("m1", 0, 0, 12, "Carlos Costa", "persona"),
              m("m2", 0, 20, 40, "ministro de Ambiente", "cargo")],
            &[rel("r1", "m1", "m2", "ocupa el cargo", "pasada")]).unwrap();

        let aristas = db.grafo_relaciones(1, 50).unwrap();
        assert_eq!(aristas.len(), 2, "una arista por vigencia: {aristas:?}");

        let vig = aristas.iter().find(|a| a.cuando == "vigente").expect("falta la vigente");
        assert_eq!(vig.desde_anio, Some(2010));
        assert_eq!(vig.hasta_anio, Some(2010));

        let pas = aristas.iter().find(|a| a.cuando == "pasada").expect("falta la pasada");
        assert_eq!(pas.desde_anio, Some(2011), "se afirmó en 2011 que ya había pasado");

        let _ = std::fs::remove_file(path);
    }

    fn m(mid: &str, pi: i64, ini: i64, fin: i64, texto: &str, tipo: &str) -> Mencion {
        Mencion {
            mid: mid.into(), pi, ini, fin, texto: texto.into(), tipo: tipo.into(),
            auto: false, grupo: None, designa: false,
        }
    }

    fn rel(rid: &str, a: &str, b: &str, pred: &str, cuando: &str) -> RelacionFila {
        RelacionFila {
            rid: rid.into(), a_mid: a.into(), b_mid: b.into(),
            predicado: pred.into(), cuando: cuando.into(),
        }
    }

    #[test]
    fn olvidar_un_sitio_se_lleva_todo_lo_suyo_y_nada_de_los_demas() {
        /* Borrar una conexión arrastra en cascada su censo, sus lotes y las
           correcciones hechas sobre ellos: son horas de trabajo, y por eso la
           pantalla dice qué se va antes de preguntar. Lo que no puede pasar es
           que se lleve por delante el trabajo de otro sitio. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-olvidar.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES
                   (1,'uno','https://uno','{}','d','{}'),
                   (2,'dos','https://dos','{}','d','{}');
                 INSERT INTO census (connection_id, wp_id, date, date_valid) VALUES
                   (1, 10, '2020-01-01', 1), (1, 11, '2020-01-02', 1),
                   (2, 20, '2020-01-01', 1);
                 INSERT INTO lotes (id, connection_id, label) VALUES (1,1,'l1'), (2,2,'l2');
                 INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1,10), (2,20);
                 INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo)
                   VALUES (1,10,'m1',0,0,5,'Petro','persona'),
                          (2,20,'m1',0,0,5,'Uribe','persona');",
            )?;
            Ok(())
        }).unwrap();

        db.delete_connection(1).unwrap();

        db.con(|c| {
            let cuenta = |t: &str| -> i64 {
                c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap()
            };
            assert_eq!(cuenta("connections"), 1, "queda el otro sitio");
            assert_eq!(cuenta("census"), 1, "su censo se fue, el del otro no");
            assert_eq!(cuenta("lotes"), 1);
            assert_eq!(cuenta("lote_articulos"), 1);
            assert_eq!(cuenta("anotaciones"), 1, "las correcciones del otro siguen ahí");
            let queda: i64 = c.query_row("SELECT connection_id FROM census", [], |r| r.get(0))?;
            assert_eq!(queda, 2);
            Ok(())
        }).unwrap();

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_credencial_va_y_vuelve_y_se_puede_olvidar_sin_perder_el_censo() {
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-credencial.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO census (connection_id, wp_id, date, date_valid)
                   VALUES (1, 10, '2020-01-01', 1);",
            )?;
            Ok(())
        }).unwrap();

        // Sin credencial no hay con qué leer, y eso ahora significa que no se lee.
        assert!(matches!(db.credencial(1).unwrap(), crate::http::Auth::None));

        let ident = crate::auth::Identidad {
            id: 3, login: "imontes".into(), nombre: "Iván".into(),
            roles: vec!["editor".into()], edita: true,
        };
        db.guardar_credencial(1, "imontes", "abcd efgh", &ident).unwrap();

        match db.credencial(1).unwrap() {
            crate::http::Auth::Basic { user, password } => {
                assert_eq!(user, "imontes");
                assert_eq!(password, "abcd efgh");
            }
            _ => panic!("no volvió la credencial guardada"),
        }
        assert_eq!(db.duenio(1).unwrap(), Some(("Iván".into(), "imontes".into())));

        // Olvidarla no toca el archivo: son cosas distintas.
        db.olvidar_credencial(1).unwrap();
        assert!(matches!(db.credencial(1).unwrap(), crate::http::Auth::None));
        assert_eq!(db.duenio(1).unwrap(), None);
        db.con(|c| {
            let n: i64 = c.query_row("SELECT COUNT(*) FROM census", [], |r| r.get(0))?;
            assert_eq!(n, 1, "el censo sigue donde estaba");
            Ok(())
        }).unwrap();

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_sesion_sobrevive_al_renombrado_de_la_columna() {
        /* La tabla `sesion` se quedó fuera de la lista de renombrado, y como es
           la que recuerda por dónde iba el usuario, el síntoma no fue un error:
           cada guardado fallaba en silencio y la app volvía siempre al paso 1,
           como si nunca se hubiera usado. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-sesionvieja.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let c = Sqlite::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
                   resolved_origin TEXT NOT NULL UNIQUE, transport_json TEXT NOT NULL,
                   transport_label TEXT NOT NULL, site_name TEXT,
                   auth_method TEXT NOT NULL DEFAULT 'anonymous', discovery_json TEXT NOT NULL,
                   total_posts INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
                   last_used_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE sesion (
                   id INTEGER PRIMARY KEY CHECK (id = 1),
                   connection_id INTEGER REFERENCES connections(id) ON DELETE CASCADE,
                   paso TEXT NOT NULL DEFAULT 'conexion',
                   progreso INTEGER NOT NULL DEFAULT 0,
                   taxonomia TEXT, design_id INTEGER,
                   guardado_at TEXT NOT NULL DEFAULT (datetime('now')));
                 INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json)
                   VALUES (1,'La Silla','https://lasillavacia.com','{}','directo','{}');
                 INSERT INTO sesion (id, connection_id, paso, progreso, taxonomia, design_id)
                   VALUES (1, 1, 'revision', 5, 'categories', 7);",
            ).unwrap();
        }

        let db = Db::open(&path).unwrap();

        // Lo que ya estaba guardado no se pierde al migrar.
        let s = db.cargar_sesion().unwrap().expect("se perdió la sesión al migrar");
        assert_eq!(s.paso, "revision");
        assert_eq!(s.lote_id, Some(7));
        assert_eq!(s.progreso, 5);

        // Y guardar vuelve a funcionar, que es lo que estaba roto.
        db.guardar_sesion(Some(1), "grafo", 7, Some("categories"), Some(7))
            .expect("no se pudo guardar la sesión tras migrar");
        let s = db.cargar_sesion().unwrap().unwrap();
        assert_eq!(s.paso, "grafo");
        assert_eq!(s.progreso, 7);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_barra_de_extraccion_cuenta_lo_mismo_que_la_corrida() {
        /* Se quedaba clavada en «12 de 21». El denominador contaba todos los
           artículos con cuerpo descargado —y el caché de cuerpos es del sitio,
           no del lote, así que arrastraba los de lotes anteriores— mientras que
           la corrida de calibración procesaba solo los doce marcados. Nunca hubo
           un artículo 13 que procesar: la barra no podía llegar al final. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-avance.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label, taxonomia)
                   VALUES (1, 1, 'l', 'categories');",
            )?;
            for wp in 1..=50 {
                c.execute(
                    "INSERT INTO lote_articulos (lote_id, wp_id, calibra) VALUES (1, ?1, ?2)",
                    rusqlite::params![wp, i64::from(wp <= 4)])?;
                // Cuerpos de sobra, tambien de articulos que no son del lote:
                // es lo que despistaba a la cuenta vieja.
                c.execute(
                    "INSERT INTO articles (connection_id, wp_id, html_raw, text_plain, word_count)
                     VALUES (1, ?1, '<p>x</p>', 'x', 1)", [wp])?;
            }
            Ok(())
        }).unwrap();

        // Procesados: los cuatro de calibracion y uno mas del resto.
        db.marcar_extraidos(1, &[1, 2, 3, 4, 30]).unwrap();

        // En calibración: los cuatro marcados, y los cuatro hechos.
        assert_eq!(db.avance_extraccion(1, true, &[]).unwrap(), (4, 4),
                   "la calibración tiene que poder llegar al 100 %");

        // En el lote entero: los cincuenta, con cinco hechos.
        assert_eq!(db.avance_extraccion(1, false, &[]).unwrap(), (5, 50),
                   "el total es el lote, no los cuerpos que haya en caché");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn un_articulo_sin_entidades_cuenta_como_procesado() {
        /* Mientras «hecho» se dedujo de tener filas en `extraidas`, un artículo
           del que el modelo no sacaba nada volvía a la cola en cada corrida: se
           bajaba y se procesaba otra vez sin que el pendiente bajara nunca. Con
           la extracción por categorías eso deja de ser un desperdicio invisible
           y pasa a ser una categoría que no puede llegar a cero. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-vacios.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label, taxonomia)
                   VALUES (1, 1, 'l', 'categories');
                 INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1,10),(1,11);",
            )?;
            Ok(())
        }).unwrap();

        // El 10 rinde una entidad; el 11 no rinde ninguna, pero pasó igual.
        db.con(|c| {
            c.execute(
                "INSERT INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score)
                 VALUES (1, 10, 0, 0, 1, 'x', 'persona', 0.9)", [])?;
            Ok(())
        }).unwrap();
        db.marcar_extraidos(1, &[10, 11]).unwrap();

        assert_eq!(db.avance_extraccion(1, false, &[]).unwrap(), (2, 2),
                   "procesado y haber rendido entidades son cosas distintas");
        assert!(db.pendientes_del_lote(1, false, &[]).unwrap().is_empty(),
                "el que no dio nada no puede volver a la cola");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_cola_reparte_el_lote_por_categorias() {
        /* La extracción va categoría por categoría, así que la cola tiene que
           decir cuánto queda en cada una. Un artículo que lleva la subcategoría
           y la madre —entre el 64 % y el 93 % de las veces en WordPress— cuenta
           en las dos y se extrae una sola vez: al hacerlo baja el pendiente de
           ambas, que es la única lectura honesta de un árbol solapado. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-cola.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label, taxonomia)
                   VALUES (1, 1, 'l', 'categories');
                 INSERT INTO terms (connection_id, taxonomy, term_id, name, slug, parent, count)
                   VALUES (1,'categories',5,'Nacional','nacional',0,0),
                          (1,'categories',7,'Bogotá','bogota',5,0);
                 -- El 100 lleva las dos; el 101 solo la madre; el 102 ninguna.
                 INSERT INTO census_terms (connection_id, wp_id, taxonomy, term_id)
                   VALUES (1,100,'categories',5),(1,100,'categories',7),
                          (1,101,'categories',5);
                 INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1,100),(1,101),(1,102);",
            )?;
            Ok(())
        }).unwrap();

        let cola = db.categorias_del_lote(1).unwrap();
        let de = |id: i64| cola.iter().find(|c| c.term_id == id).unwrap().clone();
        assert_eq!((de(5).total, de(5).pendientes), (2, 2), "Nacional lleva los dos");
        assert_eq!((de(7).total, de(7).pendientes), (1, 1), "Bogotá solo el compartido");
        assert_eq!(db.sueltos_del_lote(1).unwrap(), (1, 0),
                   "el que no tiene categoría no puede desaparecer de la cuenta");

        // Extraer Bogotá se lleva por delante el compartido, y Nacional lo nota.
        assert_eq!(db.pendientes_del_lote(1, false, &[7]).unwrap(), vec![100]);
        db.marcar_extraidos(1, &[100]).unwrap();
        let cola = db.categorias_del_lote(1).unwrap();
        let de = |id: i64| cola.iter().find(|c| c.term_id == id).unwrap().clone();
        assert_eq!(de(7).pendientes, 0, "Bogotá queda hecha");
        assert_eq!(de(5).pendientes, 1, "y a Nacional le baja el suyo");
        assert_eq!(db.avance_extraccion(1, false, &[5]).unwrap(), (1, 2),
                   "la barra habla de la rama que se está extrayendo");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_revision_solo_recorre_lo_que_se_descargo() {
        /* Un lote son miles de artículos y solo se baja el cuerpo de la docena
           que se revisa a mano. La revisión recorría el lote entero, así que
           del decimotercero en adelante enseñaba «este artículo no tiene cuerpo
           descargado»: cierto, sin arreglo posible, y culpa de haber pedido un
           artículo que nunca debió pedirse. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-revision.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        db.con(|c| {
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');",
            )?;
            // Cien en el lote, tres para calibrar y con cuerpo.
            for wp in 1..=100 {
                c.execute(
                    "INSERT INTO census (connection_id, wp_id, date, date_valid, title)
                     VALUES (1, ?1, '2020-01-01', 1, 'titulo')", [wp])?;
                c.execute(
                    "INSERT INTO lote_articulos (lote_id, wp_id, calibra) VALUES (1, ?1, ?2)",
                    rusqlite::params![wp, i64::from(wp <= 3)])?;
                if wp <= 3 {
                    c.execute(
                        "INSERT INTO articles (connection_id, wp_id, html_raw, text_plain, word_count)
                         VALUES (1, ?1, '<p>x</p>', 'x', 1)", [wp])?;
                }
            }
            Ok(())
        }).unwrap();

        let filas = db.muestra(1).unwrap();
        assert_eq!(filas.len(), 3, "solo los de calibración, no los cien del lote");
        assert!(
            filas.iter().all(|f| f.texto.as_deref().unwrap_or("").is_empty() == false),
            "todos los que se ofrecen a revisar tienen cuerpo"
        );

        // Y el avance cuenta sobre lo mismo: «1 de 100» daría una barra que
        // nunca llega y un trabajo que parece cien veces mayor de lo que es.
        let (hechos, total) = db.avance_anotacion(1).unwrap();
        assert_eq!((hechos, total), (0, 3));

        // La reanudación tampoco puede mandar a un artículo sin cuerpo.
        let siguiente = db.siguiente_sin_cerrar(1).unwrap().unwrap();
        assert!(siguiente <= 3, "reanudó en el artículo {siguiente}, que no está descargado");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn el_espejo_de_una_relacion_simetrica_no_llega_a_guardarse() {
        /* Ser aliado es mutuo: «A aliado de B» y «B aliado de A» son el mismo
           hecho. Filtrarlo en el extractor no bastaba, porque una persona
           también puede marcar las dos a mano y esas no pasan por ahí. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-espejos.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        {
            let c = db.conn.lock().unwrap();
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');",
            ).unwrap();
        }

        // Lo que marca la persona: las dos direcciones y un lazo sobre sí misma.
        db.guardar_anotacion(1, 100,
            &[m("mA", 0, 0, 1, "Santos", "persona"),
              m("mB", 0, 5, 6, "Uribe", "persona"),
              m("mC", 0, 9, 10, "Petro", "persona")],
            &[rel("r1", "mA", "mB", "aliado de", "vigente"),
              rel("r2", "mB", "mA", "aliado de", "vigente"),
              rel("r3", "mA", "mA", "aliado de", "vigente"),
              // Asimétrica: los dos sentidos son afirmaciones distintas y las
              // dos se guardan; una es falsa, pero eso se corrige, no se funde.
              rel("r4", "mA", "mC", "trabaja en", "vigente"),
              rel("r5", "mC", "mA", "trabaja en", "vigente")]).unwrap();

        let (_, rs) = db.anotacion(1, 100).unwrap();
        let aliados: Vec<_> = rs.iter().filter(|r| r.predicado == "aliado de").collect();
        assert_eq!(aliados.len(), 1, "el espejo y el lazo debían caer: {rs:?}");
        assert_eq!((aliados[0].a_mid.as_str(), aliados[0].b_mid.as_str()), ("mA", "mB"),
                   "los extremos quedan en orden fijo");
        assert_eq!(rs.iter().filter(|r| r.predicado == "trabaja en").count(), 2,
                   "las asimétricas conservan las dos direcciones");

        // Y lo que propone el modelo: gana la de más confianza.
        use crate::extraccion::RelacionExtraida;
        let ex = |a: &str, b: &str, s: f64| RelacionExtraida {
            a: a.into(), b: b.into(), predicado: "aliado de".into(), score: s,
        };
        db.guardar_relaciones_extraidas(1, 100,
            &[vec![ex("Santos", "Uribe", 0.71), ex("Uribe", "Santos", 0.88),
                   ex("Santos", "Santos", 0.62)]]).unwrap();

        db.con(|c| {
            let (a, b, sc): (String, String, f64) = c.query_row(
                "SELECT a, b, score FROM relaciones_extraidas WHERE lote_id = 1", [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            assert_eq!((a.as_str(), b.as_str()), ("Santos", "Uribe"));
            assert!((sc - 0.88).abs() < 1e-9, "debía quedar la de más confianza, quedó {sc}");
            let n: i64 = c.query_row(
                "SELECT COUNT(*) FROM relaciones_extraidas WHERE lote_id = 1", [], |r| r.get(0))?;
            assert_eq!(n, 1, "una sola fila para el par");
            Ok(())
        }).unwrap();

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_evidencia_de_una_relacion_trae_el_parrafo_y_la_forma_completa() {
        let path = std::env::temp_dir().join(format!("legajo-test-{}-evidencia.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        {
            let c = db.conn.lock().unwrap();
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json, transport_label, discovery_json)
                   VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');
                 INSERT INTO census (connection_id, wp_id, date, title, link) VALUES (1, 100, '2023-05-01', 'Una nota', 'https://x/nota');
                 INSERT INTO articles (connection_id, wp_id, html_raw, text_plain) VALUES (1, 100, '', 'Gustavo Petro llegó.\n\nPetro es el presidente desde 2022.');
                 INSERT INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score, canon) VALUES
                   (1,100,0,0,13,'Gustavo Petro','persona',0.9,NULL),
                   (1,100,1,0,5,'Petro','persona',0.9,'Gustavo Petro'),
                   (1,100,1,12,22,'presidente','cargo',0.9,NULL);
                 INSERT INTO relaciones_extraidas (lote_id, wp_id, pi, a, b, predicado, score)
                   VALUES (1, 100, 1, 'Petro', 'presidente', 'ocupa el cargo', 0.8);",
            ).unwrap();
        }
        let aristas = db.grafo_relaciones(1, 10).unwrap();
        assert_eq!(aristas.len(), 1);
        assert_eq!(aristas[0].a, "Gustavo Petro", "la arista va por la forma completa");
        assert_eq!(aristas[0].por_anio, vec![(2023, 1)]);
        let ev = db.grafo_evidencia(1, "Gustavo Petro", "presidente", "ocupa el cargo", 5).unwrap();
        assert_eq!(ev.len(), 1);
        assert!(ev[0].parrafo.contains("presidente desde 2022"), "{:?}", ev[0].parrafo);
        assert_eq!(ev[0].titulo.as_deref(), Some("Una nota"));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn el_grafo_cuenta_una_vez_lo_que_la_persona_declaro_igual() {
        /* Marcar «Gustavo Petro», «Petro» y «el presidente» como la misma
           entidad es de lo más laborioso que hace la persona en la revisión.
           Si el grafo los pinta como tres nodos, ese trabajo no sirvió de nada. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-alias.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        {
            let c = db.conn.lock().unwrap();
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');
                 INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo, grupo) VALUES
                   (1,100,'m1',0, 0,13,'Gustavo Petro','persona','g1'),
                   (1,100,'m2',1, 0, 5,'Petro','persona','g1'),
                   (1,101,'m3',0, 0,13,'el presidente','persona','g1'),
                   (1,100,'m4',2, 0, 6,'Duque','persona',NULL);",
            ).unwrap();
        }

        let nodos = db.grafo_entidades(1, 50).unwrap();
        let personas: Vec<_> = nodos.iter().filter(|n| n.tipo == "persona").collect();
        assert_eq!(personas.len(), 2, "el grupo debía colapsar en un nodo: {personas:?}");

        let petro = personas.iter().find(|n| n.texto == "Gustavo Petro")
            .expect("gana el nombre más largo del grupo");
        assert_eq!(petro.menciones, 3, "las tres menciones son de la misma entidad");
        assert_eq!(petro.articulos, 2, "y aparecen en dos artículos");

        // Lo que decide el diccionario o el juez funde igual que el «=»: si
        // «Duque» es «Iván Duque» según Quién-AI, el grafo lo cuenta una vez.
        db.decidir_resolucion(1, &crate::resolucion::clave_par("Duque", "Iván Duque"), "Duque", "Iván Duque",
                              "persona", "misma", 0.9, "quien-ai", Some("alias curado")).unwrap();
        db.decidir_resolucion(1, &crate::resolucion::clave_par("Iván Duque", "Duque Márquez"), "Iván Duque", "Duque Márquez",
                              "persona", "misma", 0.8, "juez:prueba", None).unwrap();
        let nodos = db.grafo_entidades(1, 50).unwrap();
        let duque = nodos.iter().find(|n| n.tipo == "persona" && n.texto != "Gustavo Petro").unwrap();
        assert_eq!(duque.texto, "Duque Márquez", "el nombre más largo de la cadena de decisiones");
        assert_eq!(nodos.iter().filter(|n| n.tipo == "persona").count(), 2);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn lo_propuesto_llega_filtrado_por_la_calibracion() {
        /* La promesa del paso es corregir, no marcar desde cero, y eso solo se
           sostiene si lo que llega ya viene depurado: volver a rechazar lo que
           la calibración anterior descartó convertiría la revisión en un bucle. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-propuestas.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let db = Db::open(&path).unwrap();
        {
            let c = db.conn.lock().unwrap();
            c.execute_batch(
                "INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO lotes (id, connection_id, label) VALUES (1, 1, 'l');
                 INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1, 100);
                 INSERT INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score) VALUES
                   (1,100,0, 0, 5,'Petro','persona',0.97),
                   (1,100,0,10,17,'senador','persona',0.41),
                   (1,100,0,20,28,'Congreso','lugar',0.88),
                   (1,100,1, 0, 5,'Petro','persona',0.95);
                 INSERT INTO relaciones_extraidas (lote_id, wp_id, pi, a, b, predicado, score) VALUES
                   (1,100,0,'Petro','Congreso','trabaja en',0.7),
                   (1,100,0,'Petro','senador','trabaja en',0.6);",
            ).unwrap();
        }

        // Sin calibración: pasa lo que supere el corte por defecto.
        let (m, r) = db.propuestas(1, 100).unwrap();
        assert_eq!(m.len(), 3, "el senador de 0,41 no debía pasar: {m:?}");
        assert!(m.iter().all(|x| x.auto), "todo lo del modelo entra como asistido");
        assert_eq!(r.len(), 1, "la relación cuyo extremo se filtró no es corregible");
        assert_eq!(r[0].predicado, "trabaja en");

        // Con la calibración puesta: sube el corte de persona y se bloquea
        // «Congreso», que ya se rechazó dos veces.
        let cal = crate::calibracion::Calibracion {
            umbrales: [("persona".to_string(), 0.96)].into_iter().collect(),
            bloqueadas: vec![("lugar".into(), "congreso".into())],
            diccionario: vec![],
        };
        db.guardar_calibracion(1, &cal).unwrap();
        let (m, r) = db.propuestas(1, 100).unwrap();
        assert_eq!(m.len(), 1, "solo el Petro de 0,97 supera el corte: {m:?}");
        assert_eq!(m[0].pi, 0);
        assert!(r.is_empty(), "sin los dos extremos no hay relación que corregir");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migra_una_base_del_tiempo_en_que_el_lote_se_llamaba_diseno() {
        /* El fallo real, en tres actos, contra una base con datos dentro:
           el lote no se dejaba crear porque `seed` era obligatoria y ya nadie
           la escribe; la extracción no encontraba `lote_id` porque la columna
           seguía llamándose `design_id`; y renombrarla no bastaba, porque la
           clave foránea seguía exigiendo una fila en `designs`, tabla que
           quedó vacía. Cada acto se descubrió al chocar con el siguiente. */
        let path = std::env::temp_dir()
            .join(format!("legajo-test-{}-designs.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let c = Sqlite::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
                   resolved_origin TEXT NOT NULL UNIQUE, transport_json TEXT NOT NULL,
                   transport_label TEXT NOT NULL, site_name TEXT,
                   auth_method TEXT NOT NULL DEFAULT 'anonymous', discovery_json TEXT NOT NULL,
                   total_posts INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
                   last_used_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE designs (id INTEGER PRIMARY KEY AUTOINCREMENT,
                   connection_id INTEGER NOT NULL, label TEXT NOT NULL,
                   seed INTEGER NOT NULL, spec_json TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE lotes (id INTEGER PRIMARY KEY AUTOINCREMENT,
                   connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                   label TEXT NOT NULL, seed INTEGER NOT NULL, spec_json TEXT NOT NULL,
                   created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE anotaciones (
                   design_id INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                   wp_id INTEGER NOT NULL, mid TEXT NOT NULL, pi INTEGER NOT NULL,
                   ini INTEGER NOT NULL, fin INTEGER NOT NULL, texto TEXT NOT NULL,
                   tipo TEXT NOT NULL, PRIMARY KEY (design_id, wp_id, mid));
                 CREATE INDEX anotaciones_art ON anotaciones(design_id, wp_id);
                 INSERT INTO connections (id, label, resolved_origin, transport_json,
                   transport_label, discovery_json) VALUES (1,'x','https://x','{}','d','{}');
                 INSERT INTO designs (id, connection_id, label, seed, spec_json)
                   VALUES (7, 1, 'lote viejo', 42, '{}');
                 INSERT INTO lotes (id, connection_id, label, seed, spec_json)
                   VALUES (7, 1, 'lote viejo', 42, '{}');
                 INSERT INTO anotaciones (design_id, wp_id, mid, pi, ini, fin, texto, tipo)
                   VALUES (7, 100, 'm1', 0, 0, 5, 'Petro', 'persona');",
            ).unwrap();
        }

        let db = Db::open(&path).expect("la migración debe sobrevivir al esquema de designs");

        // El trabajo anterior sigue ahí: migrar no puede costarle a nadie sus
        // anotaciones.
        let (menciones, _) = db.anotacion(7, 100).unwrap();
        assert_eq!(menciones.len(), 1, "se perdió la anotación al migrar");
        assert_eq!(menciones[0].texto, "Petro");

        {
            let conn = db.conn.lock().unwrap();
            // La foránea apunta a `lotes`, no al cementerio de `designs`.
            let mut st = conn.prepare("PRAGMA foreign_key_list(anotaciones)").unwrap();
            let destinos: Vec<String> = st.query_map([], |r| r.get::<_, String>(2)).unwrap()
                .filter_map(|r| r.ok()).collect();
            assert_eq!(destinos, vec!["lotes".to_string()], "la foránea quedó apuntando mal");
            drop(st);

            // El índice sobrevive a rehacer la tabla.
            let n: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='anotaciones_art'",
                [], |r| r.get(0)).unwrap();
            assert_eq!(n, 1, "el índice se perdió al rehacer la tabla");

            // Y `lotes` ya no exige lo que nadie escribe.
            let mut st = conn.prepare("PRAGMA table_info(lotes)").unwrap();
            let cols: Vec<String> = st.query_map([], |r| r.get::<_, String>(1)).unwrap()
                .filter_map(|r| r.ok()).collect();
            assert!(!cols.contains(&"seed".to_string()), "sigue la columna del sorteo: {cols:?}");
        }

        // Un lote nuevo entra sin pelea, que es lo que fallaba.
        let a = crate::alcance::Alcance {
            taxonomia: "categories".into(), terminos: vec![],
            desde_anio: None, hasta_anio: None, incluir_sin_fecha: false,
        };
        let (consulta, _) = crate::alcance::consulta(&a);
        db.crear_lote(1, "lote nuevo", &a, &consulta, 0)
            .expect("no se pudo crear un lote tras migrar");

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn migra_una_base_creada_por_una_version_anterior() {
        // Reproduce el fallo real al actualizar la app con datos ya guardados:
        // la tabla existe sin la columna nueva y el índice reventaba al arrancar.
        let path = std::env::temp_dir().join(format!("legajo-test-{}-vieja.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        {
            let c = Sqlite::open(&path).unwrap();
            c.execute_batch(
                "CREATE TABLE connections (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL,
                   resolved_origin TEXT NOT NULL UNIQUE, transport_json TEXT NOT NULL,
                   transport_label TEXT NOT NULL, site_name TEXT,
                   auth_method TEXT NOT NULL DEFAULT 'anonymous', discovery_json TEXT NOT NULL,
                   total_posts INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')),
                   last_used_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE census (connection_id INTEGER NOT NULL, wp_id INTEGER NOT NULL,
                   date TEXT, date_valid INTEGER NOT NULL DEFAULT 1, slug TEXT, link TEXT,
                   title TEXT, author INTEGER, terms_json TEXT,
                   PRIMARY KEY (connection_id, wp_id));",
            ).unwrap();
        }

        let db = Db::open(&path).expect("la migración debe sobrevivir a un esquema viejo");
        let conn = db.conn.lock().unwrap();
        let mut st = conn.prepare("PRAGMA table_info(census)").unwrap();
        let cols: Vec<String> = st.query_map([], |r| r.get::<_, String>(1)).unwrap()
            .filter_map(|r| r.ok()).collect();
        assert!(cols.contains(&"title_key".to_string()), "columnas: {cols:?}");
        drop(st);
        drop(conn);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn la_sesion_sobrevive_a_cerrar_la_app() {
        let (db, path) = db_temporal("sesion");
        let id = db.upsert_connection(
            "La Silla", "https://www.lasillavacia.com", "{}", "REST directo",
            Some("La Silla Vacía"), Some(84_000), r#"{"input":"x"}"#).unwrap();

        assert!(db.cargar_sesion().unwrap().is_none(), "sesión limpia al empezar");

        db.guardar_sesion(Some(id), "anotacion", 4, Some("categories"), Some(7)).unwrap();
        let s = db.cargar_sesion().unwrap().expect("debe recordar dónde iba");
        assert_eq!(s.connection_id, Some(id));
        assert_eq!(s.paso, "anotacion");
        assert_eq!(s.progreso, 4);
        assert_eq!(s.taxonomia.as_deref(), Some("categories"));
        assert_eq!(s.etiqueta.as_deref(), Some("La Silla"));
        assert!(s.discovery_json.is_some(), "el sondeo se recupera sin repetirlo");

        // Avanzar de paso pisa la fila anterior, no acumula sesiones.
        db.guardar_sesion(Some(id), "reporte", 7, Some("categories"), Some(7)).unwrap();
        assert_eq!(db.cargar_sesion().unwrap().unwrap().paso, "reporte");

        db.olvidar_sesion().unwrap();
        assert!(db.cargar_sesion().unwrap().is_none());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn reanuda_en_el_primer_articulo_sin_cerrar() {
        let (db, path) = db_temporal("reanudar");
        let conn_id = db.upsert_connection(
            "sitio", "https://ejemplo.com", "{}", "REST directo", None, None, "{}").unwrap();

        {
            let c = db.conn.lock().unwrap();
            for (wp, fecha) in [(10, "2020-01-01"), (11, "2020-02-01"), (12, "2020-03-01")] {
                c.execute(
                    "INSERT INTO census (connection_id, wp_id, date, date_valid) VALUES (?1,?2,?3,1)",
                    rusqlite::params![conn_id, wp, fecha]).unwrap();
            }
            c.execute(
                "INSERT INTO lotes (connection_id, label) VALUES (?1,'d')",
                [conn_id]).unwrap();
            for wp in [10, 11, 12] {
                // Con `calibra = 1`: la revisión recorre el conjunto de
                // calibración, que es lo único que se descarga.
                c.execute("INSERT INTO lote_articulos (lote_id, wp_id, calibra) VALUES (1, ?1, 1)", [wp]).unwrap();
            }
        }

        assert_eq!(db.siguiente_sin_cerrar(1).unwrap(), Some(10), "sin nada cerrado, el primero");

        // Un guardado periódico deja constancia del tiempo sin dar el artículo
        // por terminado: al reabrir hay que volver a él, no saltárselo.
        db.registrar_tiempo(1, 10, 120, 3, false).unwrap();
        assert_eq!(db.siguiente_sin_cerrar(1).unwrap(), Some(10), "a medias sigue pendiente");
        assert_eq!(db.tiempo_de(1, 10).unwrap(), 120, "el cronómetro reanuda donde iba");
        assert_eq!(db.avance_anotacion(1).unwrap().0, 0, "a medias no cuenta como hecho");

        db.registrar_tiempo(1, 10, 300, 7, true).unwrap();
        assert_eq!(db.siguiente_sin_cerrar(1).unwrap(), Some(11), "salta el ya cerrado");

        // Un guardado periódico posterior no puede reabrir lo ya cerrado.
        db.registrar_tiempo(1, 10, 305, 7, false).unwrap();
        assert_eq!(db.avance_anotacion(1).unwrap().0, 1, "sigue contando como cerrado");

        db.registrar_tiempo(1, 11, 250, 5, true).unwrap();
        db.registrar_tiempo(1, 12, 280, 6, true).unwrap();
        assert_eq!(db.siguiente_sin_cerrar(1).unwrap(), None, "todo cerrado");

        // El tiempo medido no se pisa al volver a pasar por el artículo.
        let (hechos, total) = db.avance_anotacion(1).unwrap();
        assert_eq!((hechos, total), (3, 3));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn el_esquema_crea_todas_las_tablas() {
        let (db, path) = db_temporal("esquema");
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap();
        let tablas: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .filter(|t| !t.starts_with("sqlite_"))
            .collect();
        for esperada in ["anomalies", "articles", "census", "connections", "lotes", "jobs", "lote_articulos"] {
            assert!(tablas.contains(&esperada.to_string()), "falta la tabla {esperada}: {tablas:?}");
        }
        drop(stmt);
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}

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
}

#[derive(Debug, Serialize)]
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

/// Una fila de la muestra con todo lo necesario para anotarla.
#[derive(Debug, Serialize)]
pub struct FilaAnotable {
    pub wp_id: i64,
    pub epoca: Option<String>,
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
        // Un articulo terminado y una medicion creible son cosas distintas.
        // Borrar la medicion contaminada de un articulo lo devolvia a la cola
        // como si no se hubiera anotado, y la reanudacion mandaba al principio.
        Self::asegurar_columna(&conn, "tiempos", "valido", "INTEGER NOT NULL DEFAULT 1")?;
        Self::asegurar_columna(&conn, "lote_articulos", "seccion", "TEXT")?;
        Self::asegurar_columna(&conn, "lote_articulos", "calibra", "INTEGER NOT NULL DEFAULT 0")?;
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
             CREATE INDEX IF NOT EXISTS lote_art_cal ON lote_articulos(lote_id, calibra);",
        )?;
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

    pub fn list_connections(&self) -> Result<Vec<ConnectionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            r#"SELECT id, label, resolved_origin, transport_label, site_name,
                      total_posts, auth_method, created_at, last_used_at
               FROM connections ORDER BY last_used_at DESC"#,
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ConnectionRow {
                    id: r.get(0)?,
                    label: r.get(1)?,
                    resolved_origin: r.get(2)?,
                    transport_label: r.get(3)?,
                    site_name: r.get(4)?,
                    total_posts: r.get(5)?,
                    auth_method: r.get(6)?,
                    created_at: r.get(7)?,
                    last_used_at: r.get(8)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(rows)
    }


    /// Recupera el transporte guardado de una conexión.
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

    /// Ids del censo elegidos al azar de forma reproducible, para el sondeo.
    pub fn ids_para_sondeo(&self, conn_id: i64, n: usize, semilla: i64) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        // El orden depende de la semilla, no del azar del motor: dos ejecuciones
        // con la misma semilla sondean exactamente los mismos articulos.
        let mut st = conn.prepare(
            "SELECT wp_id FROM census WHERE connection_id = ?1
             ORDER BY (wp_id * 2654435761 + ?2) % 1000003 LIMIT ?3",
        )?;
        let it = st.query_map(rusqlite::params![conn_id, semilla, n as i64], |r| r.get::<_, i64>(0))?;
        Ok(it.filter_map(|r| r.ok()).collect())
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

    pub fn muestra(&self, lote_id: i64) -> Result<Vec<crate::db::FilaAnotable>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT s.wp_id, s.epoch, s.section, c.title, c.date, c.link,
                    a.text_plain, a.html_raw, a.word_count
             FROM lote_articulos s
             JOIN census c ON c.connection_id = (SELECT connection_id FROM lotes WHERE id = ?1)
                          AND c.wp_id = s.wp_id
             LEFT JOIN articles a ON a.connection_id = c.connection_id AND a.wp_id = s.wp_id
             WHERE s.lote_id = ?1
             ORDER BY c.date, s.wp_id",
        )?;
        let v = st
            .query_map([lote_id], |r| {
                Ok(FilaAnotable {
                    wp_id: r.get(0)?, epoca: r.get(1)?, seccion: r.get(2)?,
                    titulo: r.get(3)?, fecha: r.get(4)?, link: r.get(5)?,
                    texto: r.get(6)?, html: r.get(7)?, palabras: r.get(8)?,
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
                "INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo, auto, grupo)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
            for m in menciones {
                st.execute(rusqlite::params![
                    lote_id, wp_id, m.mid, m.pi, m.ini, m.fin, m.texto, m.tipo,
                    m.auto as i64, m.grupo])?;
            }
            let mut st = tx.prepare(
                "INSERT INTO relaciones (lote_id, wp_id, rid, a_mid, b_mid, predicado)
                 VALUES (?1,?2,?3,?4,?5,?6)")?;
            for r in relaciones {
                st.execute(rusqlite::params![lote_id, wp_id, r.rid, r.a_mid, r.b_mid, r.predicado])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn anotacion(&self, lote_id: i64, wp_id: i64) -> Result<(Vec<Mencion>, Vec<RelacionFila>)> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT mid, pi, ini, fin, texto, tipo, auto, grupo FROM anotaciones
             WHERE lote_id = ?1 AND wp_id = ?2 ORDER BY pi, ini")?;
        let ms: Vec<Mencion> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| Ok(Mencion {
                mid: r.get(0)?, pi: r.get(1)?, ini: r.get(2)?, fin: r.get(3)?,
                texto: r.get(4)?, tipo: r.get(5)?, auto: r.get::<_, i64>(6)? != 0,
                grupo: r.get(7)?,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);
        let mut st = conn.prepare(
            "SELECT rid, a_mid, b_mid, predicado FROM relaciones WHERE lote_id = ?1 AND wp_id = ?2")?;
        let rs: Vec<RelacionFila> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| Ok(RelacionFila {
                rid: r.get(0)?, a_mid: r.get(1)?, b_mid: r.get(2)?, predicado: r.get(3)?,
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
        let bloqueadas: std::collections::HashSet<String> =
            cal.bloqueadas.iter().map(|t| t.to_lowercase()).collect();

        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT pi, ini, fin, texto, etiqueta, score FROM extraidas
             WHERE lote_id = ?1 AND wp_id = ?2 ORDER BY pi, ini, fin")?;
        let crudas: Vec<(i64, i64, i64, String, String, f64)> = st
            .query_map(rusqlite::params![lote_id, wp_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);

        let mut menciones: Vec<Mencion> = Vec::new();
        for (pi, ini, fin, texto, etiqueta, score) in crudas {
            let umbral = cal.umbrales.get(&etiqueta).copied().unwrap_or(0.50);
            if score < umbral || bloqueadas.contains(&texto.to_lowercase()) {
                continue;
            }
            menciones.push(Mencion {
                mid: format!("m{pi}-{ini}-{fin}"),
                pi, ini, fin, texto, tipo: etiqueta,
                // Todo lo que llega del modelo entra marcado como asistido: lo
                // que la persona toque deja de serlo, y esa diferencia es lo que
                // permite decir después cuánto puso cada uno.
                auto: true,
                grupo: None,
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
                relaciones.push(RelacionFila { rid, a_mid: am, b_mid: bm, predicado });
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
            "SELECT COUNT(*) FROM lote_articulos WHERE lote_id = ?1", [lote_id], |r| r.get(0))?;
        Ok((hechos, total))
    }

    // ── Grafo ────────────────────────────────────────────────────────────

    /// Las entidades del lote, uniendo lo extraido con lo revisado a mano.
    ///
    /// Se cuenta por articulos distintos y no por menciones: una entidad que
    /// aparece cuarenta veces en un solo articulo pesa menos en el grafo que
    /// una que aparece en cuarenta articulos.
    pub fn grafo_entidades(&self, lote_id: i64, limite: i64) -> Result<Vec<NodoGrafo>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT tipo, texto, SUM(menciones), COUNT(DISTINCT wp_id), MAX(revisada) FROM (
                 -- Cuando la persona declaró que varias marcas nombran a la
                 -- misma entidad, el grafo la cuenta una vez y con el nombre
                 -- más largo del grupo, que es casi siempre el completo:
                 -- «Gustavo Petro» y no «Petro». Ignorar esa declaración sería
                 -- tirar el único dato de identidad que hay verificado.
                 SELECT a.tipo AS tipo,
                        COALESCE((SELECT g.texto FROM anotaciones g
                                  WHERE g.lote_id = a.lote_id AND g.grupo = a.grupo
                                  ORDER BY LENGTH(g.texto) DESC, g.texto LIMIT 1),
                                 a.texto) AS texto,
                        COUNT(*) AS menciones,
                        a.wp_id AS wp_id, 1 AS revisada
                 FROM anotaciones a WHERE a.lote_id = ?1
                 GROUP BY a.tipo, texto, a.wp_id
                 UNION ALL
                 SELECT e.etiqueta, e.texto, COUNT(*), e.wp_id, 0
                 FROM extraidas e WHERE e.lote_id = ?1
                   AND NOT EXISTS (SELECT 1 FROM anotaciones a2
                                   WHERE a2.lote_id = e.lote_id AND a2.wp_id = e.wp_id)
                 GROUP BY e.etiqueta, e.texto, e.wp_id
             ) GROUP BY tipo, texto ORDER BY 4 DESC, 3 DESC LIMIT ?2")?;
        let v = st
            .query_map(rusqlite::params![lote_id, limite], |r| Ok(NodoGrafo {
                tipo: r.get(0)?, texto: r.get(1)?, menciones: r.get(2)?,
                articulos: r.get(3)?, revisada: r.get::<_, i64>(4)? != 0,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn grafo_relaciones(&self, lote_id: i64, limite: i64) -> Result<Vec<AristaGrafo>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT a, b, predicado, COUNT(DISTINCT wp_id), MAX(revisada) FROM (
                 SELECT ma.texto AS a, mb.texto AS b, r.predicado AS predicado,
                        r.wp_id AS wp_id, 1 AS revisada
                 FROM relaciones r
                 JOIN anotaciones ma ON ma.lote_id = r.lote_id AND ma.wp_id = r.wp_id AND ma.mid = r.a_mid
                 JOIN anotaciones mb ON mb.lote_id = r.lote_id AND mb.wp_id = r.wp_id AND mb.mid = r.b_mid
                 WHERE r.lote_id = ?1
                 UNION ALL
                 SELECT x.a, x.b, x.predicado, x.wp_id, 0
                 FROM relaciones_extraidas x WHERE x.lote_id = ?1
                   AND NOT EXISTS (SELECT 1 FROM relaciones r2
                                   WHERE r2.lote_id = x.lote_id AND r2.wp_id = x.wp_id)
             ) WHERE a <> '' AND b <> ''
             GROUP BY a, b, predicado ORDER BY 4 DESC LIMIT ?2")?;
        let v = st
            .query_map(rusqlite::params![lote_id, limite], |r| Ok(AristaGrafo {
                a: r.get(0)?, b: r.get(1)?, predicado: r.get(2)?,
                articulos: r.get(3)?, revisada: r.get::<_, i64>(4)? != 0,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Cifras de conjunto del lote.
    pub fn grafo_resumen(&self, lote_id: i64) -> Result<ResumenGrafo> {
        let conn = self.conn.lock().unwrap();
        let uno = |sql: &str| -> i64 { conn.query_row(sql, [lote_id], |r| r.get(0)).unwrap_or(0) };
        let distintas = uno(
            "SELECT COUNT(*) FROM (SELECT DISTINCT tipo, texto FROM (
               SELECT tipo, texto FROM anotaciones WHERE lote_id = ?1
               UNION SELECT etiqueta, texto FROM extraidas WHERE lote_id = ?1))");
        let una_vez = uno(
            "SELECT COUNT(*) FROM (
               SELECT texto FROM (
                 SELECT texto, wp_id FROM anotaciones WHERE lote_id = ?1
                 UNION SELECT texto, wp_id FROM extraidas WHERE lote_id = ?1)
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
        tipo: &str, decision: &str, confianza: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO resoluciones (lote_id, clave, a_nombre, b_nombre, tipo, decision, confianza)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(lote_id, clave) DO UPDATE SET
               decision = excluded.decision, decidido_at = datetime('now')",
            rusqlite::params![lote_id, clave, a, b, tipo, decision, confianza],
        )?;
        Ok(())
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
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM extraidas WHERE lote_id = ?1 AND wp_id = ?2",
                   rusqlite::params![lote_id, wp_id])?;
        let mut n = 0i64;
        {
            let mut st = tx.prepare(
                "INSERT OR REPLACE INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")?;
            for (pi, grupo) in por_parrafo.iter().enumerate() {
                for e in grupo {
                    st.execute(rusqlite::params![
                        lote_id, wp_id, pi as i64, e.inicio, e.fin, e.texto, e.etiqueta, e.score])?;
                    n += 1;
                }
            }
        }
        tx.commit()?;
        Ok(n)
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
                "INSERT OR REPLACE INTO relaciones_extraidas (lote_id, wp_id, pi, a, b, predicado, score)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)")?;
            for (pi, grupo) in por_parrafo.iter().enumerate() {
                for r in grupo {
                    st.execute(rusqlite::params![lote_id, wp_id, pi as i64, r.a, r.b, r.predicado, r.score])?;
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

    pub fn avance_extraccion(&self, lote_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let hechos: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT wp_id) FROM extraidas WHERE lote_id = ?1",
            [lote_id], |r| r.get(0))?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM lote_articulos s JOIN lotes d ON d.id = s.lote_id
             JOIN articles a ON a.connection_id = d.connection_id AND a.wp_id = s.wp_id
             WHERE s.lote_id = ?1 AND a.text_plain IS NOT NULL AND a.text_plain <> ''",
            [lote_id], |r| r.get(0))?;
        Ok((hechos, total))
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
             WHERE s.lote_id = ?1
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

    pub fn delete_connection(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM connections WHERE id = ?1", [id])?;
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
    fn guarda_lista_y_borra_conexiones() {
        let (db, path) = db_temporal("conexiones");

        let id = db
            .upsert_connection("La Silla", "https://www.lasillavacia.com", r#"{"kind":"direct_pretty","origin":"https://www.lasillavacia.com"}"#, "REST directo", Some("La Silla Vacia"), Some(84_343), "{}")
            .unwrap();

        let rows = db.list_connections().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].total_posts, Some(84_343));

        // Reconectar al mismo sitio actualiza en vez de duplicar: es la razon de
        // que resolved_origin sea UNIQUE y de que se resuelva tras redirecciones.
        let id2 = db
            .upsert_connection("La Silla Vacia", "https://www.lasillavacia.com", "{}", "REST directo", None, Some(84_400), "{}")
            .unwrap();
        assert_eq!(id, id2);
        let rows = db.list_connections().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].label, "La Silla Vacia");
        assert_eq!(rows[0].total_posts, Some(84_400));

        db.delete_connection(id).unwrap();
        assert!(db.list_connections().unwrap().is_empty());

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
            bloqueadas: vec!["congreso".into()],
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
                c.execute("INSERT INTO lote_articulos (lote_id, wp_id) VALUES (1, ?1)", [wp]).unwrap();
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

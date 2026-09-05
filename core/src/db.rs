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
    pub design_id: Option<i64>,
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

            CREATE TABLE IF NOT EXISTS designs (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id  INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                label          TEXT NOT NULL,
                seed           INTEGER NOT NULL,
                spec_json      TEXT NOT NULL,
                created_at     TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS sample (
                design_id  INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                epoch      TEXT,
                section    TEXT,
                doc_type   TEXT,
                phase      INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (design_id, wp_id)
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
                design_id  INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                mid        TEXT NOT NULL,
                pi         INTEGER NOT NULL,
                ini        INTEGER NOT NULL,
                fin        INTEGER NOT NULL,
                texto      TEXT NOT NULL,
                tipo       TEXT NOT NULL,
                PRIMARY KEY (design_id, wp_id, mid)
            );
            CREATE INDEX IF NOT EXISTS anotaciones_art ON anotaciones(design_id, wp_id);

            CREATE TABLE IF NOT EXISTS relaciones (
                design_id  INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                rid        TEXT NOT NULL,
                a_mid      TEXT NOT NULL,
                b_mid      TEXT NOT NULL,
                predicado  TEXT NOT NULL,
                PRIMARY KEY (design_id, wp_id, rid)
            );

            -- La medida que justifica toda la fase: cuanto cuesta de verdad
            -- anotar un articulo. Se guarda por articulo, no en agregado, para
            -- poder mirar la mediana y la curva de aprendizaje por separado.
            CREATE TABLE IF NOT EXISTS tiempos (
                design_id   INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                wp_id       INTEGER NOT NULL,
                segundos    INTEGER NOT NULL,
                menciones   INTEGER NOT NULL DEFAULT 0,
                orden       INTEGER NOT NULL DEFAULT 0,
                cerrado_at  TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (design_id, wp_id)
            );

            -- Decisiones de resolucion. Se guarda el par, no la entidad
            -- fusionada: asi se puede rehacer el grafo si cambia el criterio.
            CREATE TABLE IF NOT EXISTS resoluciones (
                design_id  INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                clave      TEXT NOT NULL,
                a_nombre   TEXT NOT NULL,
                b_nombre   TEXT NOT NULL,
                tipo       TEXT NOT NULL,
                decision   TEXT NOT NULL,
                confianza  REAL NOT NULL DEFAULT 0,
                decidido_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (design_id, clave)
            );

            -- Lo que propuso el modelo. Mismas coordenadas que la anotacion
            -- manual (parrafo + desplazamiento), que es lo que permite
            -- compararlas sin aproximar nada.
            CREATE TABLE IF NOT EXISTS extraidas (
                design_id  INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
                wp_id      INTEGER NOT NULL,
                pi         INTEGER NOT NULL,
                ini        INTEGER NOT NULL,
                fin        INTEGER NOT NULL,
                texto      TEXT NOT NULL,
                etiqueta   TEXT NOT NULL,
                score      REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (design_id, wp_id, pi, ini, fin)
            );
            CREATE INDEX IF NOT EXISTS extraidas_art ON extraidas(design_id, wp_id);

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
                design_id      INTEGER,
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

        // Los índices que dependen de esas columnas van al final, ya con la
        // certeza de que existen.
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS census_title_key ON census(connection_id, title_key);",
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

    // ── Muestra ──────────────────────────────────────────────────────────

    /// Guarda el diseño y su sorteo. Un diseño nuevo por cada sorteo: cambiar
    /// la semilla o los criterios no debe pisar la muestra que ya se anotó.
    pub fn guardar_muestra(
        &self,
        conn_id: i64,
        etiqueta: &str,
        spec: &crate::muestreo::Diseno,
        filas: &[crate::muestreo::FilaMuestra],
    ) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO designs (connection_id, label, seed, spec_json) VALUES (?1,?2,?3,?4)",
            rusqlite::params![
                conn_id, etiqueta,
                crate::muestreo::semilla_num(&spec.semilla),
                serde_json::to_string(spec)?
            ],
        )?;
        let design_id = tx.last_insert_rowid();
        {
            let mut st = tx.prepare(
                "INSERT INTO sample (design_id, wp_id, epoch, section, phase) VALUES (?1,?2,?3,?4,1)",
            )?;
            for f in filas {
                st.execute(rusqlite::params![design_id, f.wp_id, f.epoca, f.seccion])?;
            }
        }
        tx.commit()?;
        Ok(design_id)
    }

    pub fn ultimo_diseno(&self, conn_id: i64) -> Result<Option<(i64, String, i64)>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT d.id, d.spec_json, (SELECT COUNT(*) FROM sample s WHERE s.design_id = d.id)
             FROM designs d WHERE d.connection_id = ?1 ORDER BY d.id DESC LIMIT 1",
            [conn_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        );
        match r {
            Ok(v) => Ok(Some(v)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    /// La muestra con lo que hace falta para anotarla, en orden estable.
    pub fn muestra(&self, design_id: i64) -> Result<Vec<crate::db::FilaAnotable>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT s.wp_id, s.epoch, s.section, c.title, c.date, c.link,
                    a.text_plain, a.html_raw, a.word_count
             FROM sample s
             JOIN census c ON c.connection_id = (SELECT connection_id FROM designs WHERE id = ?1)
                          AND c.wp_id = s.wp_id
             LEFT JOIN articles a ON a.connection_id = c.connection_id AND a.wp_id = s.wp_id
             WHERE s.design_id = ?1
             ORDER BY c.date, s.wp_id",
        )?;
        let v = st
            .query_map([design_id], |r| {
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
    pub fn muestra_sin_contenido(&self, design_id: i64) -> Result<Vec<i64>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT s.wp_id FROM sample s
             WHERE s.design_id = ?1 AND NOT EXISTS (
               SELECT 1 FROM articles a
               WHERE a.connection_id = (SELECT connection_id FROM designs WHERE id = ?1)
                 AND a.wp_id = s.wp_id)",
        )?;
        let v = st
            .query_map([design_id], |r| r.get::<_, i64>(0))?
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
        design_id: i64,
        wp_id: i64,
        menciones: &[Mencion],
        relaciones: &[RelacionFila],
    ) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM anotaciones WHERE design_id = ?1 AND wp_id = ?2",
                   rusqlite::params![design_id, wp_id])?;
        tx.execute("DELETE FROM relaciones WHERE design_id = ?1 AND wp_id = ?2",
                   rusqlite::params![design_id, wp_id])?;
        {
            let mut st = tx.prepare(
                "INSERT INTO anotaciones (design_id, wp_id, mid, pi, ini, fin, texto, tipo, auto, grupo)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")?;
            for m in menciones {
                st.execute(rusqlite::params![
                    design_id, wp_id, m.mid, m.pi, m.ini, m.fin, m.texto, m.tipo,
                    m.auto as i64, m.grupo])?;
            }
            let mut st = tx.prepare(
                "INSERT INTO relaciones (design_id, wp_id, rid, a_mid, b_mid, predicado)
                 VALUES (?1,?2,?3,?4,?5,?6)")?;
            for r in relaciones {
                st.execute(rusqlite::params![design_id, wp_id, r.rid, r.a_mid, r.b_mid, r.predicado])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn anotacion(&self, design_id: i64, wp_id: i64) -> Result<(Vec<Mencion>, Vec<RelacionFila>)> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT mid, pi, ini, fin, texto, tipo, auto, grupo FROM anotaciones
             WHERE design_id = ?1 AND wp_id = ?2 ORDER BY pi, ini")?;
        let ms: Vec<Mencion> = st
            .query_map(rusqlite::params![design_id, wp_id], |r| Ok(Mencion {
                mid: r.get(0)?, pi: r.get(1)?, ini: r.get(2)?, fin: r.get(3)?,
                texto: r.get(4)?, tipo: r.get(5)?, auto: r.get::<_, i64>(6)? != 0,
                grupo: r.get(7)?,
            }))?
            .filter_map(|r| r.ok())
            .collect();
        drop(st);
        let mut st = conn.prepare(
            "SELECT rid, a_mid, b_mid, predicado FROM relaciones WHERE design_id = ?1 AND wp_id = ?2")?;
        let rs: Vec<RelacionFila> = st
            .query_map(rusqlite::params![design_id, wp_id], |r| Ok(RelacionFila {
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
    pub fn alias_declarados(&self, design_id: i64) -> Result<Vec<(String, String, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT DISTINCT a.tipo, a.texto, b.texto
             FROM anotaciones a JOIN anotaciones b
               ON a.design_id = b.design_id AND a.grupo = b.grupo
             WHERE a.design_id = ?1 AND a.grupo IS NOT NULL
               AND a.texto < b.texto",
        )?;
        let v = st
            .query_map([design_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn lexico(&self, design_id: i64) -> Result<Vec<EntradaLexico>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT a.texto, a.tipo, COUNT(DISTINCT a.wp_id) AS arts,
                    (SELECT COUNT(DISTINCT b.tipo) FROM anotaciones b
                     WHERE b.design_id = a.design_id AND b.texto = a.texto) AS tipos
             FROM anotaciones a
             WHERE a.design_id = ?1 AND LENGTH(a.texto) >= 3
             GROUP BY a.texto, a.tipo
             ORDER BY LENGTH(a.texto) DESC",
        )?;
        let v = st
            .query_map([design_id], |r| {
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
        &self, design_id: i64, wp_id: i64, segundos: i64, menciones: i64, cerrado: bool,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let orden: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tiempos WHERE design_id = ?1 AND cerrado = 1",
            [design_id], |r| r.get(0))?;
        conn.execute(
            "INSERT INTO tiempos (design_id, wp_id, segundos, menciones, orden, cerrado)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(design_id, wp_id) DO UPDATE SET
               segundos = excluded.segundos, menciones = excluded.menciones,
               -- Un artículo ya cerrado no vuelve a abrirse por un guardado
               -- periódico posterior, ni pierde su puesto en el orden.
               cerrado = MAX(tiempos.cerrado, excluded.cerrado),
               orden = CASE WHEN tiempos.cerrado = 1 THEN tiempos.orden ELSE excluded.orden END,
               cerrado_at = datetime('now')",
            rusqlite::params![design_id, wp_id, segundos, menciones, orden, cerrado as i64],
        )?;
        Ok(())
    }

    /// Borra la medición de un artículo.
    ///
    /// Una medición contaminada —la ventana abierta mientras se hacía otra
    /// cosa, o un artículo por el que se pasó de largo— es peor que ninguna:
    /// entra en la mediana y desplaza la única cifra que la fase produce.
    pub fn descartar_tiempo(&self, design_id: i64, wp_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "DELETE FROM tiempos WHERE design_id = ?1 AND wp_id = ?2",
            rusqlite::params![design_id, wp_id],
        )?;
        Ok(())
    }

    /// Mediciones que no son creíbles como tiempo de anotación real.
    ///
    /// Muy cortas: se pasó de largo sin anotar. Muy largas: la ventana quedó
    /// abierta. No se borran solas —eso lo decide quien anota— pero se señalan.
    pub fn tiempos_dudosos(&self, design_id: i64) -> Result<Vec<(i64, i64, i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT t.wp_id, t.segundos, t.menciones, COALESCE(c.title, '')
             FROM tiempos t
             JOIN designs d ON d.id = t.design_id
             LEFT JOIN census c ON c.connection_id = d.connection_id AND c.wp_id = t.wp_id
             WHERE t.design_id = ?1 AND t.cerrado = 1
               AND (t.segundos < 20 OR t.segundos > 1800)
             ORDER BY t.segundos",
        )?;
        let v = st
            .query_map([design_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    /// Segundos ya invertidos en un artículo, para reanudar el cronómetro.
    pub fn tiempo_de(&self, design_id: i64, wp_id: i64) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        Ok(conn
            .query_row(
                "SELECT segundos FROM tiempos WHERE design_id = ?1 AND wp_id = ?2",
                rusqlite::params![design_id, wp_id],
                |r| r.get(0),
            )
            .unwrap_or(0))
    }

    /// Cuantos articulos de la muestra llevan ya anotacion cerrada.
    pub fn avance_anotacion(&self, design_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let hechos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM tiempos WHERE design_id = ?1 AND cerrado = 1",
            [design_id], |r| r.get(0))?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sample WHERE design_id = ?1", [design_id], |r| r.get(0))?;
        Ok((hechos, total))
    }

    // ── Resolucion ───────────────────────────────────────────────────────

    pub fn decidir_resolucion(
        &self, design_id: i64, clave: &str, a: &str, b: &str,
        tipo: &str, decision: &str, confianza: f64,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO resoluciones (design_id, clave, a_nombre, b_nombre, tipo, decision, confianza)
             VALUES (?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(design_id, clave) DO UPDATE SET
               decision = excluded.decision, decidido_at = datetime('now')",
            rusqlite::params![design_id, clave, a, b, tipo, decision, confianza],
        )?;
        Ok(())
    }

    pub fn avance_resolucion(&self, design_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let decididos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM resoluciones WHERE design_id = ?1 AND decision <> 'posponer'",
            [design_id], |r| r.get(0))?;
        let pospuestos: i64 = conn.query_row(
            "SELECT COUNT(*) FROM resoluciones WHERE design_id = ?1 AND decision = 'posponer'",
            [design_id], |r| r.get(0))?;
        Ok((decididos, pospuestos))
    }

    // ── Extraccion ───────────────────────────────────────────────────────

    pub fn guardar_extraidas(
        &self, design_id: i64, wp_id: i64,
        por_parrafo: &[Vec<crate::extraccion::Entidad>],
    ) -> Result<i64> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM extraidas WHERE design_id = ?1 AND wp_id = ?2",
                   rusqlite::params![design_id, wp_id])?;
        let mut n = 0i64;
        {
            let mut st = tx.prepare(
                "INSERT OR REPLACE INTO extraidas (design_id, wp_id, pi, ini, fin, texto, etiqueta, score)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")?;
            for (pi, grupo) in por_parrafo.iter().enumerate() {
                for e in grupo {
                    st.execute(rusqlite::params![
                        design_id, wp_id, pi as i64, e.inicio, e.fin, e.texto, e.etiqueta, e.score])?;
                    n += 1;
                }
            }
        }
        tx.commit()?;
        Ok(n)
    }

    /// Articulos de la muestra con cuerpo descargado y sin extraer todavia.
    pub fn pendientes_extraccion(&self, design_id: i64) -> Result<Vec<(i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let mut st = conn.prepare(
            "SELECT s.wp_id, a.text_plain FROM sample s
             JOIN designs d ON d.id = s.design_id
             JOIN articles a ON a.connection_id = d.connection_id AND a.wp_id = s.wp_id
             WHERE s.design_id = ?1 AND a.text_plain IS NOT NULL AND a.text_plain <> ''
               AND NOT EXISTS (SELECT 1 FROM extraidas e
                               WHERE e.design_id = s.design_id AND e.wp_id = s.wp_id)
             ORDER BY s.wp_id")?;
        let v = st
            .query_map([design_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    }

    pub fn avance_extraccion(&self, design_id: i64) -> Result<(i64, i64)> {
        let conn = self.conn.lock().unwrap();
        let hechos: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT wp_id) FROM extraidas WHERE design_id = ?1",
            [design_id], |r| r.get(0))?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sample s JOIN designs d ON d.id = s.design_id
             JOIN articles a ON a.connection_id = d.connection_id AND a.wp_id = s.wp_id
             WHERE s.design_id = ?1 AND a.text_plain IS NOT NULL AND a.text_plain <> ''",
            [design_id], |r| r.get(0))?;
        Ok((hechos, total))
    }

    // ── Sesion ───────────────────────────────────────────────────────────

    pub fn guardar_sesion(
        &self, connection_id: Option<i64>, paso: &str, progreso: i64,
        taxonomia: Option<&str>, design_id: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sesion (id, connection_id, paso, progreso, taxonomia, design_id)
             VALUES (1, ?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               connection_id = excluded.connection_id, paso = excluded.paso,
               progreso = excluded.progreso, taxonomia = excluded.taxonomia,
               design_id = excluded.design_id, guardado_at = datetime('now')",
            rusqlite::params![connection_id, paso, progreso, taxonomia, design_id],
        )?;
        Ok(())
    }

    /// Lo que hace falta para dejar al usuario donde estaba, incluido el
    /// descubrimiento del sitio para no tener que volver a sondearlo.
    pub fn cargar_sesion(&self) -> Result<Option<Sesion>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT s.connection_id, s.paso, s.progreso, s.taxonomia, s.design_id,
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
                    design_id: r.get(4)?,
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
    pub fn siguiente_sin_cerrar(&self, design_id: i64) -> Result<Option<i64>> {
        let conn = self.conn.lock().unwrap();
        let r = conn.query_row(
            "SELECT s.wp_id FROM sample s
             JOIN designs d ON d.id = s.design_id
             JOIN census c ON c.connection_id = d.connection_id AND c.wp_id = s.wp_id
             WHERE s.design_id = ?1
               AND NOT EXISTS (SELECT 1 FROM tiempos t
                               WHERE t.design_id = s.design_id AND t.wp_id = s.wp_id
                                 AND t.cerrado = 1)
             ORDER BY c.date, s.wp_id LIMIT 1",
            [design_id],
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
                "INSERT INTO designs (connection_id, label, seed, spec_json) VALUES (?1,'d',1,'{}')",
                [conn_id]).unwrap();
            for wp in [10, 11, 12] {
                c.execute("INSERT INTO sample (design_id, wp_id) VALUES (1, ?1)", [wp]).unwrap();
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
        for esperada in ["anomalies", "articles", "census", "connections", "designs", "jobs", "sample"] {
            assert!(tablas.contains(&esperada.to_string()), "falta la tabla {esperada}: {tablas:?}");
        }
        drop(stmt);
        drop(conn);
        let _ = std::fs::remove_file(path);
    }
}

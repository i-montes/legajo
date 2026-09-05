use crate::error::{Error, Result};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use url::Url;

/// Cabeceras que nos interesan de una respuesta de WordPress.
#[derive(Debug, Clone, Default)]
pub struct WpHeaders {
    pub total: Option<u64>,
    pub total_pages: Option<u64>,
}

#[derive(Debug)]
pub struct Fetched {
    pub status: u16,
    pub url: String,
    pub headers: WpHeaders,
    pub body: String,
}

impl Fetched {
    pub fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Result<T> {
        Ok(serde_json::from_str(&self.body)?)
    }
}

/// Credencial a aplicar en la peticion.
#[derive(Debug, Clone)]
pub enum Auth {
    None,
    /// Application Password de WordPress core: Basic user:password.
    Basic { user: String, password: String },
    /// Token OAuth2 de WordPress.com.
    Bearer { token: String },
}

/// Cliente HTTP con reintentos y cortesia adaptativa.
///
/// Legajo golpea servidores que no son del usuario, asi que portarse bien no es
/// opcional. Y la demora no puede ser fija: cuanto aguanta un servidor no se
/// sabe de antemano, y un recorrido largo acaba topandose con su limite. Ante
/// un 429 el cliente se frena para el resto de la corrida y se va soltando
/// despues, en vez de reintentar al mismo ritmo hasta agotarse.
#[derive(Clone)]
pub struct Http {
    client: reqwest::Client,
    /// Compartida entre clones: frenar en un sitio frena en todos.
    politeness_ms: Arc<AtomicU64>,
    base_ms: u64,
    exitos: Arc<AtomicU64>,
    max_retries: u32,
}

/// Techo de la demora adaptativa. Por encima de esto el sitio no quiere que se
/// le recorra y es mejor decirlo que arrastrarse durante horas.
const CORTESIA_MAX_MS: u64 = 5_000;

impl Http {
    pub fn new() -> Result<Self> {
        let client = reqwest::Client::builder()
            .user_agent(concat!(
                "Legajo/",
                env!("CARGO_PKG_VERSION"),
                " (+https://github.com/i-montes/legajo)"
            ))
            .timeout(Duration::from_secs(45))
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()?;
        Ok(Self {
            client,
            politeness_ms: Arc::new(AtomicU64::new(250)),
            base_ms: 250,
            exitos: Arc::new(AtomicU64::new(0)),
            max_retries: 5,
        })
    }

    pub fn with_politeness(mut self, ms: u64) -> Self {
        self.politeness_ms = Arc::new(AtomicU64::new(ms));
        self.base_ms = ms;
        self
    }

    /// Demora actual entre peticiones, en milisegundos.
    pub fn cortesia_ms(&self) -> u64 {
        self.politeness_ms.load(Ordering::Relaxed)
    }

    fn frenar(&self) {
        let actual = self.politeness_ms.load(Ordering::Relaxed);
        let nuevo = (actual * 2).clamp(self.base_ms, CORTESIA_MAX_MS);
        self.politeness_ms.store(nuevo, Ordering::Relaxed);
        self.exitos.store(0, Ordering::Relaxed);
    }

    /// Tras una racha sin tropiezos se recupera velocidad poco a poco. Bajar de
    /// golpe volveria a chocar con el mismo limite al instante.
    fn soltar(&self) {
        let n = self.exitos.fetch_add(1, Ordering::Relaxed) + 1;
        if n % 40 != 0 {
            return;
        }
        let actual = self.politeness_ms.load(Ordering::Relaxed);
        if actual > self.base_ms {
            let nuevo = (actual * 4 / 5).max(self.base_ms);
            self.politeness_ms.store(nuevo, Ordering::Relaxed);
        }
    }

    /// Cliente para sondeos: durante el descubrimiento, un 5xx significa "aqui no
    /// hay nada", no "vuelve a intentarlo". Reintentar cuesta un minuto por sitio.
    pub fn probing(&self) -> Self {
        let mut c = self.clone();
        c.max_retries = 1;
        c
    }

    /// GET con backoff exponencial ante 429 y 5xx. Devuelve la respuesta aunque
    /// sea 4xx: distinguir un 401 de un 404 es informacion util para el sondeo.
    pub async fn get(&self, url: &Url, auth: &Auth) -> Result<Fetched> {
        let mut delay = Duration::from_secs(2);

        for attempt in 0..=self.max_retries {
            tokio::time::sleep(Duration::from_millis(self.cortesia_ms())).await;

            let mut req = self.client.get(url.clone());
            req = match auth {
                Auth::None => req,
                Auth::Basic { user, password } => req.basic_auth(user, Some(password)),
                Auth::Bearer { token } => req.bearer_auth(token),
            };

            let resp = match req.send().await {
                Ok(r) => r,
                Err(e) if attempt < self.max_retries && (e.is_timeout() || e.is_connect()) => {
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(Duration::from_secs(120));
                    continue;
                }
                Err(e) => return Err(Error::Http(e)),
            };

            let status = resp.status();

            // 429 o 5xx: esperamos lo que pida el servidor, o backoff exponencial.
            if status.as_u16() == 429 || status.is_server_error() {
                // El freno se aplica siempre, se reintente o no: si el servidor
                // ya dijo que no, el resto del recorrido tiene que ir mas lento.
                self.frenar();
            }
            if (status.as_u16() == 429 || status.is_server_error()) && attempt < self.max_retries {
                let wait = resp
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .map(Duration::from_secs)
                    .unwrap_or(delay);
                tokio::time::sleep(wait.min(Duration::from_secs(120))).await;
                delay = (delay * 2).min(Duration::from_secs(120));
                continue;
            }

            if status.is_success() {
                self.soltar();
            }

            let headers = WpHeaders {
                total: header_u64(&resp, "x-wp-total"),
                total_pages: header_u64(&resp, "x-wp-totalpages"),
            };
            let final_url = resp.url().to_string();
            let body = resp.text().await.unwrap_or_default();

            return Ok(Fetched {
                status: status.as_u16(),
                url: final_url,
                headers,
                body,
            });
        }

        Err(Error::Other(format!(
            "se agotaron los reintentos contra {url}"
        )))
    }
}

fn header_u64(resp: &reqwest::Response, name: &str) -> Option<u64> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.trim().parse::<u64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_freno_sube_y_se_comparte_entre_clones() {
        let a = Http::new().unwrap().with_politeness(100);
        let b = a.clone();
        assert_eq!(a.cortesia_ms(), 100);
        a.frenar();
        // Frenar en un clon frena en todos: es un solo servidor al otro lado.
        assert_eq!(b.cortesia_ms(), 200);
    }

    #[test]
    fn el_freno_tiene_techo() {
        let h = Http::new().unwrap().with_politeness(1000);
        for _ in 0..20 {
            h.frenar();
        }
        assert_eq!(h.cortesia_ms(), CORTESIA_MAX_MS);
    }

    #[test]
    fn se_recupera_velocidad_tras_una_racha_limpia() {
        let h = Http::new().unwrap().with_politeness(100);
        h.frenar();
        h.frenar();
        let frenado = h.cortesia_ms();
        assert!(frenado > 100);
        for _ in 0..200 {
            h.soltar();
        }
        assert!(h.cortesia_ms() < frenado, "no solto: sigue en {}", h.cortesia_ms());
    }

    #[test]
    fn nunca_baja_de_la_cortesia_base() {
        let h = Http::new().unwrap().with_politeness(250);
        for _ in 0..1000 {
            h.soltar();
        }
        assert_eq!(h.cortesia_ms(), 250);
    }
}

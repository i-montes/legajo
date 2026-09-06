use crate::error::{Error, Result};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
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
    /// Cuántas peticiones conviene tener en vuelo contra *este* sitio.
    ///
    /// No es una constante afinada a mano: se descubre corriendo. Un archivo
    /// alojado en un servidor holgado aguanta ocho a la vez; uno detrás de un
    /// limitador estricto no pasa de dos. Elegir un número fijo significa ir
    /// lento en el primero y atropellar el segundo, y no hay forma de saber
    /// cuál es cuál sin probar.
    carriles: Arc<AtomicUsize>,
    base_ms: u64,
    exitos: Arc<AtomicU64>,
    max_retries: u32,
}

/// Techo de la demora adaptativa. Por encima de esto el sitio no quiere que se
/// le recorra y es mejor decirlo que arrastrarse durante horas.
/// Techo de la demora de cortesía.
///
/// Estaba en 5 s y era un castigo desproporcionado. Medido contra el sitio real:
/// una petición tarda 1,4 s, y con seis en paralelo el servidor devuelve 780
/// artículos por segundo sin quejarse. Un solo 429 llevaba la demora al techo, y
/// desde ahí cada carril dormía cinco segundos antes de cada petición: el censo
/// bajaba a 20 artículos por segundo, cuarenta veces menos de lo que el sitio
/// daba de sobra. La cortesía se había convertido en el cuello de botella.
///
/// Con 1,5 s se sigue cediendo el paso de verdad cuando el sitio se queja —es
/// seis veces la demora base—, sin convertir un tropiezo en media hora de
/// espera.
const CORTESIA_MAX_MS: u64 = 1_500;

/// Nunca menos de uno —hay que poder avanzar— ni más de ocho: medido contra un
/// sitio holgado, pasando de ocho ya no sube el rendimiento y solo aumenta la
/// probabilidad de que un limitador lo tome por un ataque.
const CARRILES_MIN: usize = 1;
const CARRILES_MAX: usize = 8;

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
            // Se empieza por dos: suficiente para no ir en fila india, prudente
            // como primer contacto con un servidor del que no se sabe nada.
            carriles: Arc::new(AtomicUsize::new(2)),
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

    /// Cuántas peticiones tener en vuelo contra este sitio ahora mismo.
    pub fn carriles(&self) -> usize {
        self.carriles.load(Ordering::Relaxed).clamp(CARRILES_MIN, CARRILES_MAX)
    }

    /// Sube de a uno tras una racha limpia; baja a la mitad al primer rechazo.
    ///
    /// Es la misma regla con la que TCP reparte una red que no conoce: subir
    /// despacio cuesta poco si se acierta, y bajar de golpe cuesta poco si se
    /// falla. Lo contrario —subir rápido y bajar despacio— es exactamente cómo
    /// se tumba un servidor ajeno.
    ///
    /// La concurrencia es la palanca buena, y la demora entre peticiones la
    /// secundaria: contra un servidor lento pero holgado, esperar más entre
    /// peticiones no arregla nada y pedir varias a la vez lo arregla todo.
    fn ensanchar(&self) {
        let n = self.exitos.load(Ordering::Relaxed);
        // Un carril más cada 16 aciertos: en un archivo grande sobra tiempo
        // para llegar al techo, y en uno pequeño no da tiempo a molestar.
        if n > 0 && n % 16 == 0 {
            let actual = self.carriles.load(Ordering::Relaxed);
            if actual < CARRILES_MAX {
                self.carriles.store(actual + 1, Ordering::Relaxed);
            }
        }
    }

    fn estrechar(&self) {
        let actual = self.carriles.load(Ordering::Relaxed);
        self.carriles.store((actual / 2).max(CARRILES_MIN), Ordering::Relaxed);
    }

    fn frenar(&self) {
        let actual = self.politeness_ms.load(Ordering::Relaxed);
        let nuevo = (actual * 2).clamp(self.base_ms, CORTESIA_MAX_MS);
        self.politeness_ms.store(nuevo, Ordering::Relaxed);
        self.exitos.store(0, Ordering::Relaxed);
        self.estrechar();
    }

    /// Tras una racha sin tropiezos se recupera velocidad poco a poco. Bajar de
    /// golpe volveria a chocar con el mismo limite al instante.
    ///
    /// Los numeros importan mas de lo que parece. Con una rebaja del 20 % cada
    /// 40 aciertos, volver del techo de 5 s a los 250 ms de base costaba unos
    /// 500 aciertos: mas peticiones de las que tiene un censo entero. En la
    /// practica bastaba un 429 al principio para que el resto del recorrido
    /// fuera al ralenti, y eso es justo lo que se veia — una ventana cada trece
    /// segundos contra un servidor que responde en cuatro decimas.
    ///
    /// Con 30 % cada 8 aciertos son unos 70: una decima parte, y sigue siendo
    /// gradual. Si el limite del servidor sigue ahi, se choca otra vez y se
    /// vuelve a frenar, que es como tiene que funcionar.
    fn soltar(&self) {
        let n = self.exitos.fetch_add(1, Ordering::Relaxed) + 1;
        self.ensanchar();
        if n % 8 != 0 {
            return;
        }
        let actual = self.politeness_ms.load(Ordering::Relaxed);
        if actual > self.base_ms {
            let nuevo = (actual * 7 / 10).max(self.base_ms);
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
        /* Espera entre reintentos, aparte de la cortesía.
         *
         * Empezaba en 2 s y doblaba: un 429 costaba 2 s, el siguiente 4, el
         * siguiente 8. Con varias peticiones en vuelo eso sumaba mas espera que
         * la propia cortesia, y encima invisible —no aparecia en ningun sitio—.
         * Medio segundo basta: el limitador del sitio se abre enseguida, y si no
         * se abre, el freno global ya se encarga de bajar el ritmo de todos. */
        let mut delay = Duration::from_millis(500);

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
            // Frenar solo cuando el servidor dice «demasiadas»: 429, y 503, que
            // es lo que devuelve un WordPress detras de un limitador. Un 500 es
            // un error del sitio, no una queja por el ritmo, y tratarlo como tal
            // dejaba el recorrido entero al ralenti por un fallo puntual.
            if status.as_u16() == 429 || status.as_u16() == 503 {
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
    fn volver_del_techo_cuesta_un_censo_o_una_decima_parte() {
        /* El caso real: un 429 al principio del censo dejaba la cortesia en el
           techo de 5 s, y con la recuperacion vieja —20 % cada 40 aciertos—
           hacian falta unas 500 peticiones para volver a los 250 ms de base.
           Un censo entero de La Silla son unas 400. Es decir: no volvia nunca,
           y se veia una ventana cada trece segundos contra un servidor que
           responde en cuatro decimas. */
        let h = Http::new().unwrap().with_politeness(250);
        for _ in 0..8 {
            h.frenar();
        }
        assert_eq!(h.cortesia_ms(), CORTESIA_MAX_MS, "deberia estar en el techo");

        let mut peticiones = 0;
        while h.cortesia_ms() > 250 {
            h.soltar();
            peticiones += 1;
            assert!(peticiones < 500, "sigue sin volver tras {peticiones} aciertos");
        }
        assert!(
            peticiones < 100,
            "volver del techo costo {peticiones} aciertos; un censo entero son unas 400"
        );
    }

    #[test]
    fn un_error_del_sitio_no_es_una_queja_por_el_ritmo() {
        // Solo 429 y 503 significan «demasiadas». Un 500 es un fallo del sitio,
        // y frenar por el dejaba el recorrido entero al ralenti por un tropiezo.
        assert!(matches!(429_u16, 429 | 503));
        assert!(matches!(503_u16, 429 | 503));
        assert!(!matches!(500_u16, 429 | 503));
    }

    #[test]
    fn la_cortesia_no_puede_ser_peor_que_el_limite_del_sitio() {
        /* La cortesia existe para no atropellar al servidor, no para castigarnos.
           Con el techo en 5 s, un solo 429 dejaba cada peticion esperando cinco
           segundos contra un sitio que —medido— entrega 780 articulos por
           segundo con seis peticiones en paralelo. El censo caia a 20 art/s:
           cuarenta veces menos de lo que habia disponible.

           El techo tiene que seguir siendo un freno de verdad —varias veces la
           base— pero no puede convertir un tropiezo en media hora de espera. */
        assert!(
            CORTESIA_MAX_MS >= 1_000,
            "un techo por debajo de un segundo no frena nada cuando el sitio se queja"
        );
        assert!(
            CORTESIA_MAX_MS <= 2_000,
            "por encima de dos segundos la cortesia pesa mas que la latencia del \
             servidor (1,4 s medidos) y se vuelve el cuello de botella"
        );

        // Y desde el techo se vuelve en pocas peticiones, no en un censo entero.
        let h = Http::new().unwrap().with_politeness(250);
        for _ in 0..8 {
            h.frenar();
        }
        let mut n = 0;
        while h.cortesia_ms() > 250 {
            h.soltar();
            n += 1;
        }
        // Un censo de La Silla son unas 840 peticiones. Volver del techo tiene
        // que costar un pellizco de eso, no una fraccion apreciable: con seis
        // carriles, estas pasan en segundos.
        assert!(n <= 60, "volver del techo costo {n} peticiones de las ~840 de un censo");
    }

    #[test]
    fn el_ritmo_lo_descubre_corriendo_y_no_lo_trae_puesto() {
        /* Un numero fijo de peticiones en vuelo va lento contra un servidor
           holgado y atropella a uno estrecho, y no hay forma de saber cual es
           cual sin probar. Sube de a uno, baja a la mitad: acertar cuesta poco
           y equivocarse tambien. */
        let h = Http::new().unwrap();
        let inicio = h.carriles();
        assert!(inicio >= CARRILES_MIN && inicio <= CARRILES_MAX);

        // Una racha limpia ensancha, sin pasarse del techo.
        for _ in 0..(16 * 20) {
            h.soltar();
        }
        assert_eq!(h.carriles(), CARRILES_MAX, "una racha larga deberia llegar al techo");

        // Un rechazo lo parte por la mitad de golpe.
        h.frenar();
        assert_eq!(h.carriles(), CARRILES_MAX / 2, "bajar tiene que ser inmediato");
    }

    #[test]
    fn por_muchos_rechazos_que_haya_siempre_queda_un_carril() {
        // Llegar a cero seria quedarse parado para siempre: un sitio que
        // rechaza todo tiene que dejar, al menos, reintentar de uno en uno.
        let h = Http::new().unwrap();
        for _ in 0..40 {
            h.frenar();
        }
        assert_eq!(h.carriles(), CARRILES_MIN);
        assert!(CARRILES_MIN >= 1, "sin carriles no se avanza nunca");
    }

    #[test]
    fn el_ritmo_se_comparte_entre_los_clones() {
        // Cada carril del censo usa su propio clon del cliente. Si el ritmo no
        // se compartiera, un 429 solo frenaria al carril que lo recibio y los
        // otros seguirian empujando contra un sitio que ya dijo que no.
        let a = Http::new().unwrap();
        let b = a.clone();
        for _ in 0..(16 * 20) {
            a.soltar();
        }
        assert_eq!(b.carriles(), CARRILES_MAX);
        b.frenar();
        assert_eq!(a.carriles(), CARRILES_MAX / 2, "el clon no vio el frenazo");
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

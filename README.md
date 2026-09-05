# Legajo

Aplicación de escritorio para radiografiar y muestrear el archivo de **cualquier
sitio en WordPress**. Pega una dirección y Legajo averigua por su cuenta cómo
hablar con ese sitio, qué permite hacer y qué hay dentro.

Nace para responder una pregunta concreta de una redacción —cuánto cuesta de
verdad curar a mano las entidades de veinte años de archivo— pero no está atada a
ningún medio: funciona igual con un blog auto-hospedado que con un sitio alojado
en WordPress.com.

## Los ocho pasos

El diagnóstico es un recorrido, y cada paso se abre cuando el anterior está resuelto.
Todos leen y escriben datos reales del archivo que conectes:

| # | Paso | Qué hace de verdad |
|---|---|---|
| 01 | **Conexión** | Descubre el transporte, sondea qué permite el sitio y guarda la conexión |
| 02 | **Perfil** | Censa el archivo entero leyendo solo metadatos, más un sondeo de contenido sobre una submuestra |
| 03 | **Sanidad** | Hallazgos calculados sobre el censo: fechas dañadas, titulares repetidos, notas cortas, HTML roto |
| 04 | **Muestreo** | Épocas cortadas por volumen, reparto entre celdas, sorteo reproducible por semilla y descarga de los cuerpos |
| 05 | **Anotación** | Marca entidades y relaciones sobre los artículos sorteados, con cronómetro por artículo |
| 06 | **Extracción** | Pasa GLiNER por la muestra desde un proceso hijo de Python |
| 07 | **Resolución** | Empareja candidatos a la misma entidad y ordena la cola de la más dudosa a la más clara |
| 08 | **Reporte** | Coste de curación, proyección al archivo completo, puerta de salida y precisión del modelo |

La cifra que persigue todo el recorrido está en el paso 8: **minutos de curación humana por cada
cien artículos**, multiplicados por el tamaño del archivo y comparados con las horas que la
redacción puede poner. Si no cuadra, hay que recortar el alcance — y saberlo a tiempo es justo
para lo que existe la herramienta.

## Cómo se conecta a un sitio

Tres transportes, elegidos automáticamente:

| Caso | Cómo se llega |
|---|---|
| WordPress auto-hospedado | `{sitio}/wp-json/wp/v2/…` |
| Sin permalinks bonitos | `{sitio}/?rest_route=/wp/v2/…` |
| Alojado en WordPress.com | `public-api.wordpress.com/wp/v2/sites/{sitio}/…` — su propio `/wp-json` devuelve 404 |

Y tres niveles de autenticación, empezando por el que no pide nada:

0. **Anónimo.** La mayoría de archivos públicos se leen sin credenciales.
1. **Application Password.** WordPress ≥5.6 lo trae de serie y lo anuncia en su
   propio `/wp-json`. Funciona en cualquier instalación, sin registrar nada.
2. **OAuth de WordPress.com.** Solo para sitios `.com` o con Jetpack.

## Desarrollo

```bash
pnpm install
python3 -m venv .venv && ./.venv/bin/pip install -r sidecar/requirements.txt

cargo test -p legajo-core                            # núcleo: sin librerías gráficas
cargo test -p legajo-core -- --ignored --nocapture   # contra sitios reales
python3 sidecar/prueba_troceo.py                     # troceo del extractor
pnpm tauri dev                                       # la app

# Censo completo contra un sitio, por línea de comandos
cargo run -p legajo-core --bin censo --release -- lasillavacia.com
```

El código está partido en dos crates a propósito:

- **`core/`** — todo lo que habla con WordPress y con SQLite. Rust puro: compila y
  se prueba sin webkit, así que iterar es rápido y CI no necesita un escritorio.
- **`src-tauri/`** — solo la cáscara: estado, comandos y ventana.
- **`sidecar/`** — el extractor de entidades, en Python con GLiNER. Vive en un
  proceso hijo que habla por tuberías: no abre puertos ni envía nada a la red,
  que es la única forma de sostener la promesa de procesamiento local y de que
  se pueda auditar.
- **`src/`** — la interfaz. `theme.css` son los tokens del sistema de diseño;
  `ui/` las primitivas; `screens/` los ocho pasos; `contenido/` los textos de
  ayuda y los datos de demostración.

Las tipografías (Cormorant Garamond, Inter, JetBrains Mono) van empaquetadas en vez de
cargarse desde Google Fonts: la promesa de la app es que el archivo nunca sale de este
computador, y pedir tipografías a un servidor externo en cada arranque filtraría su uso.

### Dependencias de sistema (Linux)

```bash
sudo apt install -y pkg-config libwebkit2gtk-4.1-dev libsoup-3.0-dev \
  libssl-dev librsvg2-dev build-essential curl wget file \
  libayatana-appindicator3-dev
```

### WSL

La app desactiva sola el renderizador DMABUF de WebKitGTK cuando detecta que corre
bajo WSL. Sin eso la ventana se muere entre segundos y media hora después de
abrirse, con un `Error flushing display: Broken pipe` que no dice nada útil: WSLg
no ofrece el paso de GPU que ese renderizador da por hecho. En un escritorio Linux
con GPU real no se toca nada, porque ahí DMABUF es la ruta rápida. Se puede forzar
a mano exportando `WEBKIT_DISABLE_DMABUF_RENDERER` antes de arrancar.

### Credenciales

`.env` solo hace falta para el nivel 2 (OAuth de WordPress.com), que es opcional.
Copia `.env.example` y registra tu propia app **Native** en
[developer.wordpress.org/apps](https://developer.wordpress.com/apps/) con las URLs
de retorno `http://127.0.0.1:8765/callback` y `http://localhost:8765/callback`.

## Pruebas

Las pruebas que importan son las que corren contra sitios que no son el nuestro:
`lasillavacia.com` (Newspack, 84k artículos, fechas dañadas), `wordpress.org/news`
(auto-hospedado limpio), `en.blog.wordpress.com` (alojado en WordPress.com) y
`techcrunch.com` (262k artículos). Construir contra un solo sitio y "generalizar
después" produce una herramienta que solo sirve para ese sitio.

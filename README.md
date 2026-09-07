# Legajo

Aplicación de escritorio para radiografiar y muestrear el archivo de **cualquier
sitio en WordPress**. Pega una dirección y Legajo averigua por su cuenta cómo
hablar con ese sitio, qué permite hacer y qué hay dentro.

Nace para responder una pregunta concreta de una redacción —cuánto cuesta de
verdad curar a mano las entidades de veinte años de archivo— pero no está atada a
ningún medio: funciona igual con un blog auto-hospedado que con un sitio alojado
en WordPress.com.

## Los ocho pasos, en tres fases

Un recorrido de principio a fin: se conecta un archivo, se elige qué trozo
procesar, se corrige al extractor sobre un puñado de artículos y se suelta sobre
el resto. La interfaz los agrupa en tres fases porque ocho pasos en fila no se
recuerdan y tres tramos sí.

| Fase | # | Paso | Qué hace |
|---|---|---|---|
| El archivo | 01 | **Conexión** | Descubre cómo hablar con el sitio y comprueba que el archivo es tuyo |
| | 02 | **Lectura** | Baja el archivo entero —metadatos y texto en la misma petición—, por tramos y reanudable |
| | 03 | **Hallazgos** | Calidad del archivo leído, con ejemplos reales: qué conviene dejar fuera |
| La preparación | 04 | **Alcance** | Árbol de categorías › subcategorías, con el cómputo estimado |
| | 05 | **Calibración** | El modelo corre sobre unos pocos, tú corriges, se recalculan sus cortes |
| | 06 | **Revisión** | Corregir lo propuesto, no marcar desde cero |
| El resultado | 07 | **Extracción** | Categoría por categoría, ya calibrado, desatendido y sin tocar la red |
| | 08 | **Grafo** | Entidades y relaciones del archivo, con lo confirmado distinguido |

Los pasos 5 y 6 son un ida y vuelta: se extrae sobre los artículos de
calibración en el 5, se corrigen en el 6, y al cerrar el último se vuelve al 5,
donde la calibración se calcula sola con esas correcciones. El trabajo humano
vive ahí, y siempre es **corregir**, nunca partir de una página en blanco:
corregir es tres o cuatro veces más rápido y produce la misma información.

Todo lo que se dice de un paso —nombre, fase, titular, frase— vive una sola vez
en `src/contenido/pasos.ts`; la barra lateral, las cabeceras de pantalla y la
ayuda lo leen de ahí. La ayuda de cada paso (`src/contenido/ayuda.ts`) sigue el
mismo orden en los ocho: qué es, qué haces, qué consigues, qué pasa después, y
aparte las razones, para quien las quiera.

Los tres modelos —spaCy para segmentar, GLiNER para entidades, GLiREL para
relaciones— comparten un solo proceso. Está explicado en
[`docs/pipeline.md`](docs/pipeline.md).

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
./.venv/bin/python sidecar/preparar.py --predeterminados

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
  `ui/` las primitivas; `screens/` los ocho pasos; `contenido/` la definición
  de los pasos, los textos de ayuda y los datos de demostración.

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

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

## Instalador y actualizaciones

Legajo se distribuye en **dos capas con vidas distintas**, y esa separación es la
que hace que actualizar sea barato:

| Capa | Qué lleva | Peso | Cómo llega | Se renueva |
|---|---|---|---|---|
| La app | Binario de Rust, la interfaz y los `.py` del extractor | 3,6 MB | Instalador (`.dmg`, `.msi`, `.AppImage`, `.deb`) | Sola, con el updater |
| La ejecución | CPython portátil + torch, spaCy, GLiNER, GLiREL | ~1,4 GB | La instala la app en el paso 5, una vez | Solo si cambian las dependencias |
| Los modelos | Pesos de GLiNER, GLiREL y spaCy | ~1,5 GB | Los baja el paso 5, una vez | Nunca |

Las dos últimas viven en el directorio de datos de la app y **las
actualizaciones no las tocan**. El `.dmg` de 0.1.0 mide 3,6 MB medidos. Si el
extractor fuese dentro del paquete, cada corrección de un botón costaría giga y
medio de descarga; a ese precio nadie
actualiza y se queda con la versión del primer día, que es justo lo que la capa
de actualización existe para evitar. El razonamiento completo y los hashes del
intérprete están en [`core/src/entorno.rs`](core/src/entorno.rs).

El sello de la capa de ejecución sale del contenido de
`sidecar/requirements.txt`: si alguien sube la versión de torch, la capa se
rehace sola en cada máquina y la anterior se borra. No hay que acordarse de
avisarlo en ningún otro sitio.

### Construir el instalador

```bash
# En local, para la máquina en la que estás.
# El bundler quiere la clave, no su ruta: `TAURI_SIGNING_PRIVATE_KEY_PATH` lo
# entiende el subcomando `signer` pero no el empaquetador, y sin la clave el
# build llega hasta el final y falla al firmar.
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/legajo-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
pnpm tauri build --bundles app,dmg          # macOS
pnpm tauri build --bundles nsis             # Windows
pnpm tauri build --bundles appimage,deb     # Linux
```

Sale en `target/<objetivo>/release/bundle/`. Junto al instalador aparece el
`.tar.gz`/`.zip` con su `.sig`: eso es lo que consume el updater, no el
instalador.

### Publicar una versión

El release lo arma CI, no una máquina de nadie:

La versión vive en **cinco archivos** y tienen que decir lo mismo:
`src-tauri/tauri.conf.json`, `package.json`, `Cargo.toml`, `core/Cargo.toml` y
`src-tauri/Cargo.toml`. El nombre del release y el número que la app compara
salen del primero, no de la etiqueta: etiquetar `v0.1.1` sin subir ese número
produce un release llamado 0.1.0 que ninguna instalación reconoce como nuevo.
CI lo comprueba antes de compilar y se niega si no cuadran.

```bash
git commit -am "Legajo: 0.1.1"
git tag v0.1.1 && git push origin main --tags
```

[`.github/workflows/publicar.yml`](.github/workflows/publicar.yml) construye las
cuatro plataformas, firma los paquetes y deja en el release un `latest.json` que
es lo que la app consulta. **El release se crea como borrador**: subir los
instaladores y encender la actualización para todo el mundo son dos decisiones
distintas, y la segunda se toma a mano publicando el release. Hasta entonces
nadie recibe el aviso.

En la app, el aviso aparece como una tarjeta discreta abajo a la derecha, nunca
como un diálogo: la versión instalada sigue funcionando y no hay nada urgente
que interrumpir. Antes de reiniciar se comprueba que no haya un censo ni una
extracción en marcha —las dos corren en este proceso y ninguna sobrevive a que
se cierre—, y si hay algo corriendo se dice qué es en vez de desactivar un botón
sin explicación. Si no se puede consultar si hay versión nueva —sin red, el
endpoint caído— no se dice nada: que Legajo no haya podido hablar con GitHub no
es un problema de quien está catalogando un archivo.

### Las claves de firma

La app rechaza cualquier actualización que no venga firmada con la clave cuya
pública está en `tauri.conf.json`. La privada **no está en el repositorio** y no
debe estarlo: quien la tenga puede publicar una actualización que todas las
instalaciones aceptarán como legítima.

```bash
# Generar el par (ya hecho una vez; regenerarlo invalida las instalaciones existentes)
pnpm tauri signer generate -w ~/.tauri/legajo-updater.key
```

En GitHub hacen falta dos secretos del repositorio:

| Secreto | Qué es |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | El contenido de `~/.tauri/legajo-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Su contraseña; vacío si se generó sin ella |

Guarda una copia de la privada fuera de la máquina. Perderla obliga a
reinstalar a mano en cada computador que ya tenga Legajo, porque ninguna
actualización firmada con una clave nueva será aceptada por las instalaciones
viejas.

### macOS: el paquete no está firmado con Apple

No hay certificado de Apple Developer todavía, así que el `.dmg` no está firmado
ni notarizado y Gatekeeper lo marca de procedencia desconocida: **el primer
arranque exige clic derecho › Abrir**. Las actualizaciones posteriores no vuelven
a pedirlo. Cuando haya certificado, se firma añadiendo al build:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)"
export APPLE_ID="…" APPLE_PASSWORD="…" APPLE_TEAM_ID="…"   # notarización
```

y `bundle.macOS.signingIdentity` en `tauri.conf.json`. La firma del updater es
otra cosa y es independiente: ya está.

## Pruebas

Las pruebas que importan son las que corren contra sitios que no son el nuestro:
`lasillavacia.com` (Newspack, 84k artículos, fechas dañadas), `wordpress.org/news`
(auto-hospedado limpio), `en.blog.wordpress.com` (alojado en WordPress.com) y
`techcrunch.com` (262k artículos). Construir contra un solo sitio y "generalizar
después" produce una herramienta que solo sirve para ese sitio.

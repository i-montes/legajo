# Plan de entrenamiento, versión 2: con los datos de Quién-AI y gpt-oss-20b

Este documento sustituye la parte de **datos** de [`entrenamiento.md`](entrenamiento.md)
y ajusta el resto a lo que se encontró el 9 de septiembre de 2026 en la base de
datos `quien-ai-prod` (MongoDB Atlas): el archivo completo de La Silla más las
extracciones de entidades y relaciones que dos LLM hicieron sobre ~11.000
artículos en marzo de 2025. El razonamiento sobre *por qué* afinar y *qué*
afinar no cambia y está en [`llm.md`](llm.md) y en `entrenamiento.md` §1, §4.1.
Lo que cambia es de dónde salen los datos, cuánto cuestan y dónde va la
revisión humana: **solo en tres sitios, ~19 horas en total**, frente a las 40
del plan anterior.

Está escrito para ejecutarse paso a paso. Cada cifra que no lleva «estimado»
se midió sobre el volcado local de la base (`/home/modev/lsv/datos/quien-ai/`,
ver su `README.md`) o sobre `legajo.sqlite`.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Qué se entrena** | `knowledgator/gliner-relex-multi-v1.0` (mDeBERTa-v3-base, 280M): entidades y relaciones en una pasada. Sin cambios. |
| **Modelo auxiliar** | **gpt-oss-20b** por Ollama en la Mac (M5 Pro, 24 GB): anota párrafos, reclasifica relaciones, juzga discrepancias. Sustituye al Qwen 27B del plan anterior. |
| **Con qué datos** | ~4.000 párrafos del archivo anotados por gpt-oss-20b **con pistas** de Quién-AI (entidades y relaciones que Gemini y DeepSeek ya encontraron, con la cita textual). De ellos, ~2.200 relaciones familiares ya vienen etiquetadas y ~18.000 pares políticos/laborales vienen localizados y solo hay que ponerles predicado. |
| **Revisión humana** | (a) corregir la pre-anotación de los **30 artículos apartados**, que son la vara de medir: ~10 h; (b) **3 de esos 30 desde cero**, para medir cuánto sesga corregir en vez de anotar: ~2 h; (c) auditar **300 párrafos de plata** para conocer la tasa de error del anotador por predicado: ~5 h. Nada más. |
| **Antes de empezar** | **Un piloto de medio día en la Mac** (§4): gpt-oss-20b sobre 60 párrafos. Fija el tiempo por párrafo, la validez del JSON, el acuerdo con Quién-AI y la dirección de los predicados familiares. Si falla, se decide ahí, no en la semana 4. |
| **Dónde se entrena** | El PC con RTX 4060 (8 GB) en WSL, o la Mac en MPS. Una época de 4.000 párrafos son minutos. |
| **Qué se mide** | P/R/F1 por tipo y por predicado sobre los 30 artículos apartados, contra el modelo actual medido el mismo día. |
| **Criterio de éxito** | El mismo: F1 de relaciones ≥ 0,60 en el apartado (hoy estimado < 0,35); persona/organización/lugar con P ≥ 0,80 y R ≥ 0,85; nombres comunes < 10 % (hoy 27–31 %). Si no se alcanza, se documenta y se queda el modelo actual. |
| **Calendario** | 4 semanas, ~19 h humanas, ~20 h de máquina desatendida. |

---

## 1. Punto de partida

### 1.1 Lo que hay en Quién-AI

La base `quien-ai-prod` se volcó completa (25 colecciones útiles, 890.652
documentos, 198 MB comprimidos) a `/home/modev/lsv/datos/quien-ai/`. Lo que
importa para entrenar:

| | cifra medida |
|---|---:|
| Artículos de lasillavacia.com (`news`), 2009–2026, HTML y Markdown | 57.287 |
| De ellos, casan por URL con el censo de Legajo (`census.link`, 83.145 `wp_id`) | **56.152** |
| Artículos con extracción de entidades y relaciones (corridas «deep» ∪ «gemi») | 10.990 |
| De ellos, en el censo de Legajo / ya con HTML descargado en `legajo.sqlite` | 10.839 / 8.084 |
| Párrafos de ≥ 15 palabras en esos artículos (18,9 por artículo) | 204.933 |
| De ellos, de 40–200 palabras (el tamaño que el modelo digiere bien) | 128.211 |
| Menciones de entidad con tipo, por artículo («deep» / «gemi») | 201.718 / 146.232 |
| Relaciones con cita textual (`exact_quote`), «deep» / «gemi» | 38.759 / 23.277 |
| **Relaciones alineables**: cita literal en el artículo *y* ambos extremos localizables dentro de la cita | **10.915 / 10.381** |
| De las alineables, la cita cae en un solo párrafo | 99,7 % |
| Cargos como atributo de la persona (`charge_or_position`) localizables en el mismo párrafo que ella | ~54.000 (gemi) + ~29.000 (deep) |
| Perfiles del Quién es quién (nombres normalizados), proyectos de ley con título e identificador | 21.253 / 17.314 |

Lo que **no** hay: `cargo`, `monto`, `obra` ni `ley` como menciones en el texto
(la ley aparece como entidad de artículo, no localizada); predicados judiciales,
económicos, `aspira a`, `ubicado en`, `parte de`. Y el vocabulario de relaciones
es grueso: `POLITICA` (≈ 50 %) y `LABORAL` (≈ 35 %) son bolsas que mezclan
«nombró a», «asesor de», «se reunió con», «criticó a» y simple coocurrencia.
Solo lo **familiar** viene fino (`HIJO`, `HERMANO`, `ESPOSO`, `PADRE`, `PRIMO`,
`TÍO`, `CUÑADO`…), y es justamente lo que el archivo tiene raro y el plan
anterior iba a buscar en MultiTACRED traducido.

El acuerdo entre las dos corridas es bajo —874 tripletas idénticas (misma
noticia, mismos nombres, mismo predicado) de ~10.900 por lado—, así que no hay
una capa de «plata alta» gratis por coincidencia. Lo que sí hay es **cobertura
complementaria**: la unión son ~20.000 relaciones localizadas en ~6.000
artículos.

No se sabe qué prompt produjo estas extracciones (los de la colección `prompts`
son los del generador de perfiles). Su calidad **se mide, no se asume**: es lo
que hace el piloto y la auditoría de 300 párrafos.

### 1.2 Lo que hay en Legajo

`~/.local/share/com.legajo.app/legajo.sqlite`: censo de 83.145 artículos, lote
«Nacional» de 25.202 con 64 de calibración, 25.204 artículos con HTML, 726
anotaciones (723 con `auto = 1`), 128 relaciones humanas, 13 tiempos. Patrón
humano real: **cero**, como ya decía `entrenamiento.md`. Herramientas
reutilizables: `banco.py`, `banco_comparar.py`, `banco_genericos.py`,
`banco_oro.py`, `banco_juez.py`, `banco_llm.py`, la interfaz del paso 6 y las
tablas `anotaciones`/`relaciones`/`tiempos` (con `valido`).

### 1.3 Máquinas

| | Mac | PC (WSL2) |
|---|---|---|
| | Apple M5 Pro, 24 GB unificada, MPS | Ryzen 7 5700X (16 hilos), 15 GB RAM, **RTX 4060 8 GB**, CUDA |
| gpt-oss-20b (14 GB en MXFP4) | **cabe**, con la app cerrada | no cabe en la GPU; en CPU sería inservible |
| Afinar mDeBERTa-base (280M), lote 8 × 384 tokens, bf16 | sí, en MPS | **sí**, con ~6–7 GB de VRAM (si no cabe, lote 4 con acumulación 2) |

Reparto: **todo lo que use gpt-oss-20b se hace en la Mac; el entrenamiento, en
el PC** (CUDA es la ruta probada del `Trainer` de `gliner`; MPS es la
alternativa). Los datos viajan como JSONL en el repo o en `~/lsv/datos`.

### 1.4 Por qué gpt-oss-20b y no el Qwen 27B

| | gpt-oss-20b | Qwen3.8 27B (plan anterior) |
|---|---|---|
| Memoria en Ollama | ~14 GB (MXFP4) | 17–19 GB, paginaba en 24 GB |
| Arquitectura | MoE, 3,6B activos por token: **rápido** | denso |
| Salida estructurada | JSON con esquema (`format`) nativo; niveles de razonamiento `low/medium/high` | JSON por instrucción |
| Licencia | Apache 2.0 | Apache 2.0 |
| Español | multilingüe; **no medido aquí** → el piloto lo mide | medido, preciso |

Es más rápido y cabe con holgura; lo que no se sabe es su calidad en prosa
política colombiana. Por eso el piloto compara sus salidas con las de Gemini y
DeepSeek sobre los mismos párrafos (§4) antes de comprometer las 20 horas de
máquina. Si el piloto lo descalifica, el plan sigue igual con Qwen3.5 9B o el
27B: solo cambia `--modelo`.

---

## 2. Decisiones de diseño

1. **La unidad es el párrafo, y el párrafo se anota entero.** GLiNER aprende
   por contraste: toda mención no marcada en un párrafo de entrenamiento se
   convierte en un negativo. Meter las 20.000 relaciones de Quién-AI con solo
   sus dos extremos marcados enseñaría al modelo a *no* ver las demás
   entidades. Por eso Quién-AI no se usa como conjunto de entrenamiento
   directo sino como **pistas** para que gpt-oss-20b anote el párrafo completo,
   y como **control** para medir cuánto de lo que ya se sabía recupera.
2. **La revisión humana va donde nada la sustituye:** la vara de medir (los 30
   apartados) y la tasa de error del anotador automático (300 párrafos). Todo
   lo demás lo hace la máquina y se cuantifica su error en vez de corregirlo.
3. **Nada del apartado toca el entrenamiento**, ni como párrafo, ni como pista,
   ni como sintético. La comprobación es por `wp_id`, no por texto.
4. **Etiquetas de entrenamiento = etiquetas de inferencia.** Se entrena con las
   cadenas exactas de `ETIQUETAS` (redacción G) y `PREDICADOS`, porque es lo
   que la app manda con cada petición.
5. **Los sintéticos, si hacen falta, nunca entran en validación ni apartado.**
6. **Cada corrida deja rastro**: config, hash del JSONL, métricas, en
   `sidecar/entrenamiento/<fecha>/`.

---

## 3. Ontología

### 3.1 Entidades: siete tipos

Los de `entrenamiento.md` §2.1, con `evento` retirado (decidido en
`plan-anotacion.md`, confirmado en `pipeline.md`: 90 % nombre común en las siete
redacciones). Las cadenas de entrenamiento son las de `ETIQUETAS`:

| clave | cadena que ve el modelo | de dónde saldrán ejemplos |
|---|---|---|
| `persona` | persona con nombre propio | Quién-AI (`PERSONA`, 27.000 nombres) + anotación |
| `organizacion` | nombre de organización, institución, empresa o partido | Quién-AI (`ORGANIZACION`, `ENTIDAD GUBERNAMENTAL`, `PARTIDO POLITICO`, `ENTIDAD PRIVADA`, `INSTITUCION EDUCATIVA`, `FUNDACION`, `BANDA CRIMINAL`, `GUERRILLA`, `ENTE DE CONTROL`, `CORTE`, `CONGRESO`, `SINDICATO`, `MEDIO DE COMUNICACIÓN`…) + anotación |
| `lugar` | nombre propio de lugar | Quién-AI (`LUGAR(ES)`, `MUNICIPIO`, `CIUDAD`, `PAIS`, `DEPARTAMENTO`, `LOCALIDAD`, `BARRIO`, `REGION`, `CORREGIMIENTO`, `VEREDA`…) + anotación |
| `cargo` | cargo público o título de un puesto | `charge_or_position` localizado en el párrafo (~80.000 candidatos) + anotación |
| `ley` | nombre de ley, decreto, sentencia o norma jurídica | anotación dirigida (regex `Ley \d+`, `Decreto`, `Sentencia`, `Acto Legislativo`, `artículo \d+`) + `laws.id_title` como gazetteer |
| `obra` | título de libro, informe, periódico, revista o medio | anotación (comillas, cursivas, «según El Tiempo») |
| `monto` | monto de dinero o cifra | anotación dirigida (regex de cifra + `millones`, `pesos`, `por ciento`, `%`) |

Se mantiene el señuelo `grupo genérico de personas` **en entrenamiento**, con
ejemplos negativos (los grupos que gpt-oss-20b marque como tal se guardan con
esa etiqueta para que el modelo siga absorbiéndolos ahí). Los tipos de Quién-AI
que no mapean (`OTRO`, `EVENTO`, `FECHA`, `CONCEPTO`, `PROGRAMA`, `PROYECTO`) se
descartan.

### 3.2 Relaciones: los 31 predicados, con su oferta de datos

Los 31 de `entrenamiento.md` §2.2 se mantienen (definición, tipos admitidos,
simetría). Lo nuevo es saber **de dónde saldrá cada uno** y cuántos casos hay
ya localizados. «Directo» significa que Quién-AI ya trae el predicado y solo
hay que alinear; «reclasificar» que trae el par y la cita y gpt-oss-20b decide
el predicado; «dirigido» que no hay nada y se muestrean párrafos por palabras
clave para que el anotador los encuentre.

| familia | predicado | origen | casos localizados (deep + gemi, alineables) |
|---|---|---|---:|
| familiar | `hermano de` | directo (`HERMANO/A`, `HERMANASTRO`) | 599 |
| | `hijo de` | directo (`HIJO/A`) | 531 |
| | `padre o madre de` | directo (`PADRE`, `MADRE`) | 331 |
| | `cónyuge o pareja de` | directo (`ESPOSO/A`, `RELACIÓN SENTIMENTAL`, `EX(-)ESPOSO/A`, `EX-PAREJA`) | 408 |
| | `familiar de` | directo (`PRIMO/A`, `TÍO/A`, `CUÑADO/A`, `SOBRINO/A`, `SUEGRO/A`, `ABUELO/A`, `YERNO`, `NIETO/A`, `BISABUELO`, `AHIJADO`, `PADRINO`, `PADRASTRO`, `HIJASTRO`, `CONSUEGRO`, `FAMILIAR`) | 486 |
| laboral | `ocupa el cargo` | `charge_or_position` en el párrafo + anotación | ~80.000 candidatos (se muestrean) |
| | `trabaja en`, `dirige`, `fundó`, `dueño de`, `asesor de`, `sucedió a`, `nombró a`, `renunció a`, `parte de` | **reclasificar** `LABORAL` (8.305 alineables) | a medir en el piloto |
| política | `aliado de`, `opositor de`, `miembro de`, `aspira a`, `apoyó a`, `se reunió con`, `criticó a` | **reclasificar** `POLITICA` (9.569) y `OTRO` (1.055) | a medir en el piloto |
| económica | `financia a`, `contrató a`, `socio de`, `donó a`, `destinado a` | dirigido (regex de monto; «financió», «contrato», «socio», «donó») | 0 |
| judicial | `investigado por`, `condenado por`, `acusado de`, `demandó a`, `sanciona con` | dirigido: `processed_news_2.procesos_judiciales` no vacío señala **25.980 (artículo, persona)** donde buscar; regex «investigad», «imputad», «condenad», «acusad», «demand» | 0 |
| ubicación y fuente | `ubicado en`, `citado en`, `autor de` | anotación general (salen solos: son los más frecuentes del modelo actual) | — |

Reglas transversales (afirmado, vigencia, dirección, mismo párrafo, dos
predicados si aplican): las de `entrenamiento.md` §2.2, sin cambios.

**Dirección de los familiares en Quién-AI.** El campo `relation_type` describe
al **destino respecto al origen**: en `PADRE` con origen «Samuel Tcherassi» y
destino «José Tcherassi», la cita dice «su padre fue José Tcherassi». Es decir,
`HIJO(origen → destino)` = «destino es hijo de origen» = nuestro
`hijo de(destino → origen)`. Se deduce de tres ejemplos; **el piloto lo verifica
sobre 50** antes de que se convierta en 850 etiquetas invertidas (§4, paso 5).

**Cuántos hacen falta.** Del orden de 60–100 positivos por predicado para que
GLiNER lo aprenda; por debajo de 40, el predicado se refuerza con sintéticos
(§5.7) o se retira del modelo y se deja solo en el menú humano. Con la tabla
de arriba, los familiares y `ocupa el cargo`/`trabaja en` sobran; el resto se
sabrá tras la reclasificación (semana 2).

---

## 4. Fase 0: el piloto en la Mac

**Objetivo:** en medio día, saber si gpt-oss-20b sirve como anotador y a qué
velocidad, y verificar las cuatro suposiciones de las que cuelga el plan. No se
escribe ninguna otra herramienta hasta que esto pase.

**Requisitos:** Mac con Ollama, la app y cualquier otro modelo cerrados (la
última vez, tres modelos residentes llevaron el swap a 11 GB); el volcado de
`~/lsv/datos/quien-ai/` copiado o montado; `sidecar/.venv` con spaCy.

```
ollama pull gpt-oss:20b
ollama run gpt-oss:20b "Responde solo: ok"      # comprobar que carga y cuánta memoria toma (ollama ps)
```

**Herramienta:** `sidecar/piloto_anotador.py` (por escribir, ~200 líneas; toma
de `banco_llm.py` el cliente de Ollama y `localizar()`, y de `legajo_ner.py`
`aplicables()` y `sin_espejos()`).

**Pasos, en orden:**

1. **Muestra**: 60 párrafos de artículos con extracción Quién-AI, excluidos
   los 30 apartados (§5.1, que se fijan antes): 30 con al menos una relación
   familiar alineable, 20 con `POLITICA`/`LABORAL` alineable, 10 con regex de
   monto o de ley. Semilla fija.
2. **Anotación sin pistas** (zero-shot) de los 60, con el prompt de §5.4 sin
   la sección «pistas». Guardar salida cruda, tiempo, tokens.
3. **Anotación con pistas** de los mismos 60. Guardar igual.
4. **Medir**, automático:
   - segundos por párrafo y tokens/s (carga aparte), con `reasoning: low` y
     con `medium`;
   - JSON inválidos o que no pasan la validación de §5.4 (tramos que no están
     en el párrafo, tipos fuera del vocabulario, predicados con tipos no
     admitidos);
   - **acuerdo con Quién-AI**: de las entidades que Gemini/DeepSeek localizaron
     en esos párrafos, cuántas recupera (cobertura de pistas); de las
     relaciones familiares alineables, cuántas devuelve con el mismo predicado
     y la misma dirección;
   - diferencia entre sin pistas y con pistas: cuánto añaden.
5. **Dirección de los familiares**: 50 relaciones familiares alineables al
   azar (no solo de los 60), impresas como «A —HIJO→ B: “cita”». Una persona
   marca si A es hijo de B o B de A. **30 minutos.** Fija la regla de
   inversión de §5.2.
6. **Lectura humana de 20 párrafos** anotados con pistas, al lado del texto:
   ¿marca nombres comunes? ¿inventa relaciones que el párrafo no afirma?
   ¿copia los tramos exactamente? **45 minutos.** No se cuenta como revisión:
   es mirar antes de gastar.

**Criterios para seguir:**

| medida | sigue si | si no |
|---|---|---|
| Tiempo por párrafo (`low`) | ≤ 10 s | con `medium` si la calidad lo compensa; si > 20 s, cambiar a Qwen3.5 9B y repetir el piloto |
| JSON válido tras validación | ≥ 95 % | reforzar el esquema con `format`; si sigue, cambiar de modelo |
| Cobertura de las entidades de Quién-AI (con pistas) | ≥ 90 % | las pistas no se están usando: revisar el prompt |
| Familiares con mismo predicado y dirección | ≥ 85 % | revisar el mapa de §5.2 o la dirección |
| Nombres comunes en tipos con nombre (lectura de los 20) | < 10 % de las marcas | añadir la regla al prompt y repetir 20 |
| Relaciones no afirmadas por el párrafo (lectura) | < 10 % | subir a `medium`; añadir ejemplos negativos al prompt |

El resultado del piloto se escribe en `sidecar/entrenamiento/piloto/README.md`
con la tabla anterior rellena. **Solo entonces** empieza la semana 1.

---

## 5. Los datos

### 5.1 Apartado: los 30 artículos que nunca se tocan

Se fija **antes** de mirar ningún párrafo. `sidecar/entrenamiento/apartado.txt`:
30 `wp_id` del lote Nacional de Legajo que (a) tienen extracción Quién-AI (para
poder medir también contra Gemini/DeepSeek), (b) tienen HTML descargado, (c)
están estratificados: 10 de 2009–2015, 10 de 2016–2021, 10 de 2022–2026; al
menos 6 de `en-vivo`, 18 de `silla-nacional`, 3 de `detector-de-mentiras`, 3 de
regiones; 300–1.200 palabras; ninguna transcripción (artículos con > 60 % de
párrafos de una línea, como el `32190`). Semilla fija, listado en el fichero
con su URL y su `_id` de Mongo.

Toda herramienta que produzca datos de entrenamiento lee este fichero y
**aborta** si un párrafo de esos `wp_id` (o de sus `_id` de Mongo) aparece en
su salida.

### 5.2 Alineación de Quién-AI al párrafo

`sidecar/alinear_quien_ai.py` (por escribir, ~250 líneas). Entrada: el volcado.
Salida: `datos/quien-ai/alineado.jsonl`, una fila por relación alineada:

```json
{"oid_news": "66bd…", "wp_id": 32061, "pi": 4, "predicado_qai": "HIJO", "corrida": "gemi",
 "a": {"texto": "Tomás Uribe", "ini": 88, "fin": 99, "tipo": "persona"},
 "b": {"texto": "Álvaro Uribe", "ini": 12, "fin": 24, "tipo": "persona"},
 "cita": "…", "predicado": "hijo de", "cabeza": "a", "cola": "b"}
```

Algoritmo, exacto:

1. **Párrafos**: `processed_content` (Markdown) partido por línea en blanco;
   se quitan imágenes `![…](…)`, se sustituyen enlaces `[texto](url)` por
   `texto`, se quitan `*`, `_`, `#`, `>`; se guardan los párrafos con
   ≥ 15 palabras y su índice `pi`. Se cruza con `articles.text_plain` de Legajo
   por `wp_id` para comprobar que el texto es el mismo (si difiere en > 5 % de
   caracteres, el artículo se marca `desfasado` y no se usa: WordPress lo
   editó después).
2. **Plegado** para comparar: NFKD sin diacríticos, minúsculas, espacios
   colapsados, comillas tipográficas → rectas.
3. **Cita → párrafo**: la cita plegada se busca como subcadena en cada párrafo
   plegado. Sin coincidencia exacta, se prueba con la cita recortada a sus
   primeras 12 palabras y a sus últimas 12 (Gemini a veces recorta con «…»).
   Si sigue sin aparecer, la relación se descarta (**~25 % de deep, ~20 % de
   gemi**, medido).
4. **Extremos**: para cada entidad, se busca en el párrafo (sin plegar, con
   posiciones de carácter) primero el nombre completo, luego el nombre sin
   partículas («de», «del», «la»), luego el último token de ≥ 4 letras (el
   apellido). Se toma la coincidencia **más cercana a la cita**. Si alguno no
   aparece, se descarta (queda el **~48 %** de las literales, medido). Los
   tramos deben respetar límites de palabra.
5. **Tipos**: mapa de §3.1. Si el tipo de Quién-AI no mapea, la entidad se
   conserva como pista **sin tipo** (el anotador decidirá).
6. **Predicado y dirección**: familiares por el mapa de §3.2 con la regla de
   inversión verificada en el piloto (`HIJO(a→b)` ⇒ `hijo de` con cabeza `b`
   y cola `a`; `PADRE/MADRE(a→b)` ⇒ `padre o madre de` con cabeza `b`, cola
   `a`; los simétricos sin dirección). `POLITICA`, `LABORAL`, `OTRO`, `AMIGO`,
   `MENTOR`, `DISCIPULO` se guardan con `predicado = null` y
   `predicado_qai` para que el anotador los resuelva.
7. **Cargos**: por cada `properties.charge_or_position` no vacío de una
   `PERSONA`, si la cadena aparece plegada en el mismo párrafo que algún
   token del nombre, se emite una pista `{"texto": cargo, "tipo": "cargo"}` y
   una relación candidata `persona —ocupa el cargo→ cargo` con
   `predicado_qai = "CARGO"`. Se descartan cargos de una sola palabra en
   minúscula que sean oficios («abogado», «periodista», «empresario»,
   «político»): la guía de anotación no los marca salvo como cargo
   institucional.
8. **Deduplicación** entre deep y gemi por `(pi, a.ini, a.fin, b.ini, b.fin,
   predicado)`; se anota `corridas: ["deep","gemi"]` cuando coinciden.

Prueba: 30 filas al azar impresas con el párrafo y los tramos resaltados; una
persona confirma que los tramos son los nombres y que la cita está donde se
dice. Es parte de los 45 minutos del piloto, no revisión adicional.

### 5.3 Selección de párrafos: ~4.000

Todos de artículos **fuera del apartado**, de 40–200 palabras salvo donde se
indica, sin etiquetas de hablante («Nombre: » al principio), sin párrafos de
una línea. Semilla fija; el listado `(wp_id, pi)` se guarda en
`sidecar/entrenamiento/seleccion.jsonl` con su estrato.

| estrato | cuántos | cómo se eligen | para qué |
|---|---:|---|---|
| **F** familiar | todos los que tengan ≥ 1 relación familiar alineada, ~1.900 párrafos | de `alineado.jsonl` | los cinco predicados familiares, con etiqueta directa |
| **PL** político/laboral | 1.200 | párrafos con ≥ 1 `POLITICA`/`LABORAL` alineada, estratificados por año (tres tramos iguales) y con preferencia por los que tienen ≥ 2 relaciones | los 16 predicados laborales y políticos, por reclasificación |
| **J** judicial | 400 | artículos donde `processed_news_2.procesos_judiciales` no está vacío para alguna persona, párrafos que contienen el apellido de esa persona **y** una raíz de {investig, imput, acus, conden, demand, fiscal, procurad, tutela, sanci} | `investigado por`, `condenado por`, `acusado de`, `demandó a`, `sanciona con` |
| **E** económico | 300 | párrafos con regex de monto `\d[\d.,]*\s*(mil|millones|billones|pesos|dólares|%|por ciento)` y una raíz de {financ, contrat, donó, don[oó], socio, aport, pag} | `financia a`, `contrató a`, `socio de`, `donó a`, `destinado a`, y el tipo `monto` |
| **N** normativo | 200 | regex `(Ley|Decreto|Resolución|Sentencia|Acto Legislativo|Acuerdo)\s+\d` o `artículo \d+` | `ley`, `sanciona con` |
| **A** aspiraciones y cambios | 200 | raíces {aspira, candidat, precandidat, renunci, reemplaz, sucedi, nombr, design, posesion} | `aspira a`, `renunció a`, `sucedió a`, `nombró a` |
| **R** al azar | 400 | uniformes sobre todos los párrafos de 40–200 palabras del archivo con extracción, incluidos los que no tienen ninguna pista | que el modelo vea párrafos sin entidades y la distribución real; sin ellos, sobreaprende que todo párrafo tiene relaciones |
| **V** validación | 250 | apartados **del mismo muestreo**, en la misma proporción por estrato, antes de anotar | elegir hiperparámetros y parar a tiempo; nunca se entrena con ellos |
| | **~4.850** | | de los que ~4.600 son entrenamiento y 250 validación |

Los estratos J, E, N y A son **búsquedas**, no garantías: un párrafo con
«investigado» puede no afirmar ninguna relación judicial. Se muestrean con
holgura (400, no 60) porque parte saldrá vacía; la tasa real se conoce tras
anotar y decide si hacen falta sintéticos (§5.7).

### 5.4 Anotación con gpt-oss-20b, con pistas

`sidecar/anotar_llm.py` (por escribir, ~300 líneas; evoluciona
`piloto_anotador.py`). Corre en la Mac, reanudable (guarda cada párrafo al
terminar, salta los ya hechos), y escribe `datos/entrenamiento/plata.jsonl`.

**Petición a Ollama** (`/api/chat`): `model: gpt-oss:20b`, `options:
{temperature: 0, num_ctx: 8192, num_predict: 1500}`, `format:` el esquema JSON
de abajo, nivel de razonamiento **`low`** por defecto (`medium` si el piloto
lo justificó). Un párrafo por petición: `pipeline.md` midió que agrupar
párrafos cambia la salida de forma imprevisible.

**Prompt de sistema** (fijo, se guarda con la corrida):

> Eres un anotador de prosa periodística colombiana para un archivo de poder
> político. Marcas entidades y relaciones **solo si el párrafo las afirma**,
> nunca lo que sabes por fuera. Respondes únicamente con el JSON pedido.

**Prompt de usuario**, cinco secciones:

1. **Tipos de entidad**: las siete claves con la descripción exacta de
   `ETIQUETAS` y la regla de exclusión de cada una (la tabla de
   `entrenamiento.md` §2.1, columna «no se marca»), más `grupo generico`
   como octava clave para los nombres de grupo («indígenas», «empresarios»):
   se pide para que no caigan en persona/organización.
2. **Predicados**: los 31 con sus tipos admitidos, en el formato de
   `banco_llm.py` («- trabaja en: de persona a organizacion»), agrupados por
   familia, y la nota de simetría.
3. **Reglas** (numeradas, cortas): copiar el tramo **exactamente** como
   aparece; no pronombres, no nombres comunes, no gentilicios, no fechas; un
   monto lleva cifra; una norma es identificable o no se marca; «Canciller
   Bermúdez» son dos marcas (cargo + persona) unidas por `ocupa el cargo`;
   «alcaldesa de Bogotá» es `ocupa el cargo` y además `dirige`; se marca lo
   afirmado, no lo insinuado («habría», «se dice que» → no); vigencia
   `vigente`/`pasada`/`futura` respecto a la fecha del artículo, que se da.
4. **Pistas** (cuando las hay): «Otro sistema ya encontró en este párrafo
   estas entidades: [texto, tipo o «?»]. Y afirmó que entre A y B hay una
   relación de tipo LABORAL/POLITICA/FAMILIAR (cita: “…”). Compruébalo contra
   el párrafo: si el párrafo lo afirma, elige el predicado exacto de la lista;
   si no lo afirma, no lo incluyas. Las pistas pueden estar equivocadas.»
5. **El párrafo**, con la fecha del artículo, y el esquema de salida:

```json
{"entidades": [{"texto": "…", "tipo": "persona|organizacion|lugar|cargo|ley|obra|monto|grupo generico"}],
 "relaciones": [{"a": "…", "predicado": "…", "b": "…", "cuando": "vigente|pasada|futura"}],
 "pistas_rechazadas": [{"a": "…", "b": "…", "por_que": "…"}]}
```

`pistas_rechazadas` no se entrena: sirve para medir cuántas pistas de
Quién-AI el anotador considera falsas y por qué (la tasa de error de Gemini y
DeepSeek, gratis).

**Validación a la salida**, por párrafo, antes de guardar:

- JSON parseable y con las tres claves; si no, **una** repetición con
  `temperature: 0.2`; si vuelve a fallar, el párrafo se marca `invalido` y se
  cuenta.
- Cada `texto` se localiza en el párrafo con `localizar()` (exacto, luego
  plegado); si no aparece, la entidad se descarta y se cuenta como
  `no_localizada`. Si una entidad se descarta, sus relaciones también.
- Tipo fuera de las ocho claves → entidad descartada. `grupo generico` se
  guarda con la etiqueta del señuelo.
- Predicado fuera de los 31 → relación descartada. Par de tipos que el
  predicado no admite (`aplicables()`) → descartada. Espejos de simétricas →
  uno (`sin_espejos()`). Extremo que no es entidad marcada → descartada.
- Pronombres (lista cerrada) como persona, montos sin dígito ni palabra de
  cantidad → descartados (las tres reglas de salida de `pipeline.md`).
- Se guardan los contadores por corrida: cuántas entidades y relaciones
  entraron, cuántas se descartaron y por qué.

**Salida por párrafo** (`plata.jsonl`):

```json
{"wp_id": 32061, "oid_news": "66bd…", "pi": 4, "estrato": "F", "fecha": "2010-05-03",
 "texto": "…", "entidades": [{"ini": 88, "fin": 99, "tipo": "persona", "texto": "Tomás Uribe"}],
 "relaciones": [{"a": 0, "b": 1, "predicado": "hijo de", "cuando": "vigente"}],
 "pistas": {"entidades": 5, "recuperadas": 5, "relaciones": 1, "confirmadas": 1, "rechazadas": 0},
 "modelo": "gpt-oss:20b", "razonamiento": "low", "segundos": 6.1, "fuente": "plata"}
```

**Tiempo estimado**: 4.850 párrafos × 5–10 s (lo fija el piloto) = **7–13 h**
desatendidas en la Mac. Se corre de noche, en dos tandas si hace falta; el
guion es reanudable.

### 5.5 Niveles de confianza

Cada párrafo anotado recibe un nivel, que el exportador usa para pesar y para
elegir qué audita la persona:

| nivel | condición | uso |
|---|---|---|
| **plata alta** | todas las pistas de entidades recuperadas **y** todas las relaciones de pista confirmadas con un predicado (o rechazadas con razón), **y** ≥ 1 relación | entrenamiento, peso 1 |
| **plata** | el resto de los párrafos válidos | entrenamiento, peso 1 (el peso 2 se reserva al oro humano; con plata no se distingue porque no hay medida de calidad por párrafo) |
| **sospechoso** | > 30 % de entidades no localizadas, o pistas recuperadas < 50 %, o > 6 relaciones en < 60 palabras | **no entra**; se cuenta y se muestran 20 en la auditoría |

El acuerdo por predicado entre lo que Quién-AI decía (`predicado_qai`) y lo que
gpt-oss-20b eligió se tabula al terminar: si un `LABORAL` acaba en `trabaja
en` el 60 %, `ocupa el cargo` el 20 % y `ninguna` el 15 %, esa tabla es la
descripción más honesta que hay de lo que Gemini y DeepSeek llamaban «laboral»,
y va al informe.

### 5.6 Revisión humana: tres tareas, y ninguna más

**(a) Los 30 apartados, corregidos** — ~10 h. Los ~570 párrafos del apartado
se anotan con gpt-oss-20b **sin pistas** (las pistas vienen de Quién-AI, y
Quién-AI no debe influir en la vara: también se medirá contra él), se cargan
en `extraidas`/`relaciones_extraidas` de Legajo con `sidecar/importar_propuestas.py`
(por escribir, ~80 líneas) como si fueran propuestas del extractor, y una
persona los corrige en el paso 6: borra lo falso, añade lo que falta, arregla
tramos y tipos, marca relaciones. A ~1 minuto por párrafo corregido (frente a
2 anotando de cero, medido en `plan-anotacion.md`: 3,5 h para 60 artículos
solo de entidades). Lo que queda en `anotaciones`/`relaciones` con `tiempos.valido = 1`
es el **oro**. `tiempos.valido` debe ponerse a 0 si el artículo se cierra sin
una sola edición o en menos de 20 segundos por párrafo (cambio pequeño en
`db.rs`; hoy `valido` existe pero no se invalida por tiempo).

**(b) Tres de los 30, desde cero** — ~2 h. Antes de ver la propuesta, la
misma persona anota 3 artículos (~57 párrafos) en blanco. Después corrige la
propuesta de esos mismos 3 como en (a). La diferencia entre las dos versiones
mide el **sesgo de anclaje**: cuánto de lo que el modelo propone se conserva
solo porque estaba ahí, y cuánto de lo que falta no se añade porque nadie lo
echa en falta. Es la cifra que dice cuánto hay que desconfiar de la de (a).
Si la cobertura anotando en blanco supera a la corregida en > 10 puntos en
algún tipo, el oro de (a) se marca «cota inferior de cobertura» en el informe.

**(c) Auditoría de 300 párrafos de plata** — ~5 h. Estratificados: 10 por
cada predicado que tenga ≥ 10 casos (los 31 dan como mucho 310), completados
con párrafos sin relaciones y 20 «sospechosos». La persona **no corrige**:
marca cada entidad y relación como correcta / incorrecta / dudosa en una
tabla, a un minuto por párrafo. Da la **precisión de la plata por tipo y por
predicado**, que es el dato que el exportador usa para decidir qué entra:

- predicado con precisión ≥ 0,80 en la auditoría → entra entero;
- entre 0,60 y 0,80 → entra, y en el informe se marca «ruidoso»; si el modelo
  final lo saca con F1 < 0,4 en el apartado, se retira en la v2;
- < 0,60 → **se retira del entrenamiento** (sus relaciones se borran de los
  párrafos, las entidades se quedan) y se deja en el menú humano.

Con el piloto (1,25 h de lectura) el total humano es **~18–19 horas**. Lo que
el plan anterior pedía y este no: revisar 500 párrafos destilados (10 h),
revisar 60 artículos con dos personas en 15 (25 h), κ de Cohen. Se pierde la
medida de acuerdo entre anotadores; a cambio se gana una medida de anclaje
(b), que en un flujo de corrección es el sesgo que importa. Si más adelante hay
horas, la doble anotación de 5 artículos (2 h) se añade sin tocar nada más.

### 5.7 Sintéticos, solo para lo que no llegue a 40

Tras anotar, se cuentan positivos por predicado. Para los que tengan < 40:
gpt-oss-20b genera párrafos nuevos «en el estilo de una nota de La Silla
Vacía» a partir de plantillas con entidades reales del gazetteer de `profiles`
(«escribe un párrafo de 60–120 palabras donde {persona} renuncia a {cargo} en
{organización}, con fecha y contexto, sin adjetivos»), 60 por predicado, y
después **se anota con el mismo `anotar_llm.py`**, no se confía en la
plantilla. Se marcan `fuente = sintetico`, tope del 30 % de los positivos de
cada predicado, y nunca entran en validación ni apartado. Los 60 por predicado
se leen en diagonal (20 minutos por predicado, dentro de la holgura de las 19 h
si son ≤ 3 predicados; si son más, se decide si vale la pena).

### 5.8 Exportador y formato

`sidecar/exportar_patron.py` (por escribir, ~200 líneas). Lee `plata.jsonl`,
`sinteticos.jsonl` y el oro de `legajo.sqlite`; escribe
`sidecar/entrenamiento/<fecha>/{train,val,apartado}.jsonl` en el formato que
`gliner` 0.2.28 espera (`RelationExtractionSpanProcessor`, verificado en el
código del paquete):

```json
{"tokenized_text": ["El", "ministro", "de", "Hacienda", ",", "José", "Manuel", "Restrepo", ",", "anunció", "…"],
 "ner": [[1, 3, "cargo público o título de un puesto"], [5, 7, "persona con nombre propio"]],
 "relations": [[1, 0, "ocupa el cargo"]]}
```

- **Tokenización: la del propio modelo**, `model.data_processor.words_splitter`
  (`WhitespaceTokenSplitter`, regex `\w+(?:[-_]\w+)*|\S`), **no spaCy**. Es lo
  que el modelo usa al inferir, y entrenar con otra partición desalinea los
  límites de tramo. Las posiciones de carácter (`ini`, `fin`) se convierten a
  índices de palabra con los offsets que el splitter devuelve; una marca cuyo
  límite cae dentro de una palabra se expande a la palabra y se cuenta.
- `ner`: `[inicio, fin_inclusive, etiqueta]` con la **cadena de `ETIQUETAS`**,
  no la clave; el señuelo con su cadena.
- `relations`: `[índice_cabeza, índice_cola, predicado]` sobre `ner`. Las
  simétricas se escriben **en las dos direcciones** (el modelo puntúa pares
  ordenados; a la salida `sin_espejos()` ya colapsa).
- Párrafos de más de 350 tokens del transformador (`max_len = 384` menos las
  etiquetas) se cortan por oración con spaCy en dos ejemplos, sin partir
  entidades; se cuenta cuántos.
- `meta` aparte, en un JSONL paralelo con el mismo orden: `wp_id`, `pi`,
  `fuente` (`oro`, `plata`, `sintetico`), `estrato`, `nivel`, `cuando` por
  relación, `corridas`. El modelo no lo lee.

**Comprobaciones que abortan la exportación:**

1. Ningún `wp_id` ni `oid_news` del apartado en `train` ni `val`.
2. Ningún índice fuera de rango; ningún tramo vacío o solapado con otro del
   mismo tipo (anidados de tipos distintos sí: «Gobernador de Antioquia» /
   «Antioquia»).
3. Ningún predicado fuera de `PREDICADOS`; ningún par de tipos que el
   predicado no admita (se importa `PREDICADOS` de `banco.py`, que ya lo lee
   de la misma fuente que la app).
4. Ningún monto sin cifra; ningún pronombre como persona.
5. **Ida y vuelta**: el párrafo de la entrevista de Adriana Camacho y 20 más
   al azar, exportados y reconstruidos a caracteres, dan exactamente las
   mismas marcas.

Y un informe al final: ejemplos por conjunto, positivos por tipo y por
predicado, párrafos sin relaciones, tokens por ejemplo (mediana, p95), hash
SHA-256 de cada JSONL.

---

## 6. Entrenamiento

### 6.1 Entorno

`sidecar/entrenamiento/requirements-entrenar.txt`, separado del
`requirements.txt` del sidecar (que lleva torch **CPU** a propósito):

```
--extra-index-url https://download.pytorch.org/whl/cu124
torch==2.14.0
gliner==0.2.28
transformers>=4.51,<5
accelerate
spacy>=3.8   # solo para cortar párrafos largos por oración
```

En el PC: `python3 -m venv ~/lsv/venv-entrenar && ~/lsv/venv-entrenar/bin/pip
install -r sidecar/entrenamiento/requirements-entrenar.txt`. En la Mac, sin
`--extra-index-url` (MPS viene en la rueda normal). Se fija la misma versión de
`gliner` que el sidecar usa para inferir: si el afinado exige una versión
nueva, cambia `requirements.txt` y la capa de ejecución de la app se rehace una
vez.

### 6.2 Receta

`sidecar/entrenar.py` (por escribir, ~150 líneas) sobre `GLiNER.train_model`
/ `gliner.training.TrainingArguments`, verificados en el paquete.

| | valor | por qué |
|---|---|---|
| Punto de partida | `knowledgator/gliner-relex-multi-v1.0` | multilingüe; ya sabe relaciones; 280M |
| Épocas | hasta 6, **parada** por F1 de relaciones en `val`, paciencia 2 | |
| `learning_rate` (codificador) | **1e-5** (barrido: 5e-6, 1e-5, 2e-5) | lr bajo para no olvidar lo general |
| `others_lr` (cabezas) | 5e-5 | las cabezas de tramo y relación tienen más que aprender |
| `others_weight_decay` / `weight_decay` | 0,01 | |
| `lr_scheduler_type`, `warmup_ratio` | linear, 0,1 | |
| `per_device_train_batch_size` | 8 (4 × acumulación 2 si la 4060 no cabe) | |
| `bf16` | true (CUDA) · en MPS, fp32 | |
| `focal_loss_alpha`, `focal_loss_gamma` | 0,75, 2 (entidades) | los negativos de tramo son el 99 % |
| `rel_focal_loss_alpha`, `rel_focal_loss_gamma` | 0,75, **2** | las relaciones son aún más escasas frente a los pares |
| `negatives` | 1,0 | |
| `max_types` (config del modelo, se sube al cargar) | **40** | el modelo tiene 25; con 31 predicados + negativos muestreados cada ejemplo necesita ver más. Los ejemplos con más tipos de los que caben se truncan al azar (lo hace el procesador), y eso perdería predicados en los párrafos densos |
| `max_neg_type_ratio` | 1 | por cada tipo positivo, hasta uno negativo muestreado del vocabulario |
| `augment_data_prob` y compañía | los del modelo (0,5; drop de tipos 0–1; drop de relaciones 0–0,3; «other» 0,5) | son los que la familia relex usó; no se tocan en la primera vuelta |
| Semilla | 42, y se registra | |
| `save_strategy`/`eval_strategy` | por época; `save_total_limit = 2`; `load_best_model_at_end` | |

Cada corrida escribe en `sidecar/entrenamiento/<fecha>-<lr>/`: `config.json`,
`args.json`, hashes de los JSONL, `metrics.jsonl` por época (pérdida, F1 de
entidades y de relaciones en `val`, por tipo y por predicado), y el modelo
final (`save_pretrained`, cargable con `GLiNER.from_pretrained(ruta)`, que es lo
que el sidecar hace hoy).

**Tiempo estimado**: 4.600 ejemplos, lote 8 → 575 pasos por época; en una 4060
con bf16, ~0,4 s por paso → **~4 minutos por época**; el barrido de tres lr con
6 épocas máximo, **< 1,5 h**. En MPS, dos o tres veces más.

**Barrido pequeño**: tres lr con lo demás fijo. Si la mejor no supera a la base
en `val`, **el problema son los datos, no los hiperparámetros**: se vuelve a la
auditoría (§5.6c) y a la tabla de acuerdo (§5.5) a buscar el predicado que
está enseñando ruido.

### 6.3 Dos comprobaciones que el plan anterior no tenía

- **El prompt de inferencia con 31 predicados.** El modelo antepone al texto
  las etiquetas de entidad y de relación; 31 predicados son ~100 tokens más
  de prompt sobre `max_len = 384`. Se mide en `val` (a) con los 31 de una vez,
  (b) en dos llamadas por familias (familiar+laboral / política+económica+
  judicial+fuente) y (c) con los 13 actuales. Si (b) gana claramente a (a), el
  sidecar pide en dos pasadas y el coste por párrafo se duplica: la decisión
  la toma la tabla, con el tiempo al lado.
- **Olvido.** Se corre `banco.py` con el modelo afinado sobre los 12 artículos
  de calibración de `pipeline.md` (que no están en el apartado) y se compara
  con la base: si la cobertura en tipos donde no se añadieron datos (`obra`,
  `lugar`) cae > 10 %, se baja el lr del codificador a 5e-6 o se congela la
  mitad inferior (`freeze_components`) y se repite.

### 6.4 Camino alterno

El de `entrenamiento.md` §4.2 (Qwen3 1,7B o NuExtract-2.0-2B con LoRA, MLX en
la Mac), con **los mismos JSONL**: solo si el codificador no aprende las
direccionales. gpt-oss-20b **no** es candidato a servirse en la app: 14 GB y
generación token a token en un portátil de redacción es lo que `llm.md`
descartó; es el oráculo de la máquina de quien construye.

---

## 7. Evaluación

Sobre el **apartado** (oro de §5.6a), y siempre con la base
(`gliner-relex-multi-v1.0` con la redacción G y los 13 predicados) medida el
mismo día con las mismas herramientas.

| métrica | herramienta | éxito |
|---|---|---|
| P/R/F1 por tipo, solape en el mismo párrafo y mismo tipo | `banco_oro.py` extendido al patrón completo (hoy solo mira conservadas/borradas) | P ≥ 0,80 y R ≥ 0,85 en persona/organización/lugar; F1 ≥ 0,70 en cargo, ley, obra, monto |
| P/R/F1 por predicado, extremos por solape, predicado exacto, simétricas en cualquier dirección; **dirección** de las asimétricas aparte | `banco_relaciones.py` (por escribir, ~100 líneas) | F1 ≥ 0,60 global; ≥ 0,70 en `trabaja en`, `ocupa el cargo`, `ubicado en`, `parte de`; se publica todo, también los 0,2 |
| Ruido: nombres comunes en minúscula en tipos con nombre | `banco_genericos.py` | < 10 % |
| Velocidad y memoria, MPS y CPU | `banco.py --vueltas 2` | base ± 10 % |
| Contra Quién-AI sobre los mismos 30 (las entidades y relaciones de deep/gemi alineadas) | `banco_relaciones.py --contra alineado.jsonl` | informativo: dice cuánto de lo que Gemini y DeepSeek veían recupera un modelo de 280M |
| Anclaje | (b) de §5.6 | si la cobertura en blanco supera la corregida en > 10 puntos, todas las R del apartado se publican como cota inferior |
| Discrepancias afinado/base, adjudicadas por gpt-oss-20b como juez | `banco_comparar.py`, `banco_juez.py --modelo gpt-oss:20b` | lo exclusivo del afinado ≥ 60 % válido (la base dio 18–21 %) |

Se publica la tabla en `pipeline.md`, con la fila de la base y la del afinado,
la fecha, los hashes de los JSONL y el `wp_id` de los 30. **Si el afinado no
gana en F1 de relaciones y en ruido, no se despliega.**

---

## 8. Integración en Legajo

Sin cambios respecto a `entrenamiento.md` §6, salvo dos precisiones:

- `Modelos::default().gliner` pasa a `lasillavacia/legajo-relex-es-v1` en un
  repositorio **privado** de Hugging Face (`preparar.py` lo baja con el token
  de la máquina; el catálogo de `catalogo()` recibe el tamaño real). Público
  cuando la redacción lo decida.
- Si §6.3 decide dos pasadas por familia, `legajo_ner.py` recibe una lista de
  listas de predicados y las concatena; `extraccion.rs` agrupa `PREDICADOS`
  por `familia`, campo nuevo que también sirve para el menú del paso 6.

Y lo que ya estaba: retirar `evento`; los 31 predicados en Rust y TS con la
prueba de paridad; el menú del paso 6 en dos niveles por familia; la
calibración con corte por predicado además de por tipo.

---

## 9. Cronograma

| semana | qué | horas humanas | máquina |
|---|---|---:|---:|
| **0** (medio día) | Piloto en la Mac (§4): `piloto_anotador.py`, 60 párrafos, dirección de familiares, lectura de 20. Decisión de modelo y nivel de razonamiento | 1,25 (lectura) + 3 (código) | 1 h |
| 1 | Fijar el apartado (§5.1); `alinear_quien_ai.py`; `seleccion.jsonl`; prompt definitivo; retirar `evento` y ampliar `PREDICADOS`/menú; `importar_propuestas.py`; `tiempos.valido` por tiempo | 10 (código) | — |
| 2 | Anotación de los ~4.850 párrafos en la Mac (de noche); anotación sin pistas del apartado; **(b) 3 artículos desde cero**; empezar **(a)** | 2 + 5 | 7–13 h |
| 3 | Terminar **(a)**; **(c) auditoría de 300**; tabla de acuerdo con Quién-AI; sintéticos si hay predicados < 40; `exportar_patron.py`; `entrenar.py`; primera corrida | 5 + 5 + 6 (código) | 2 h |
| 4 | Barrido de lr; §6.3; `banco_relaciones.py`; evaluación sobre el apartado; juez; tabla en `pipeline.md`; decisión y despliegue o documentación del no | 8 (código y lectura) | 4 h |
| | | **~19 h de revisión** + ~27 h de código | **~20 h** |

Las horas de código son de quien construye, no de la redacción. Las de
revisión son las tres tareas de §5.6 más la lectura del piloto, y son las
únicas que necesitan a alguien que conozca el archivo.

---

## 10. Riesgos

| riesgo | señal | respuesta |
|---|---|---|
| **gpt-oss-20b anota mal en español político** | piloto: nombres comunes > 10 %, relaciones no afirmadas > 10 %, o cobertura de pistas < 90 % | `medium`; ejemplos negativos en el prompt; si persiste, Qwen3.5 9B (5,5 GB, 13 % de nombres comunes en `llm.md`) con el mismo guion |
| **Las pistas de Quién-AI arrastran sus errores** | `pistas_rechazadas` bajo (< 5 %) con una auditoría que encuentra relaciones falsas confirmadas | el prompt dice que las pistas pueden estar mal; si el anotador las traga igual, se anota **sin** pistas y se usa Quién-AI solo como control |
| **Dirección invertida en familiares** | los 50 del piloto | se fija la regla antes de alinear; se mide dirección aparte en §7 |
| **La bolsa `LABORAL`/`POLITICA` es coocurrencia, no relación** | tabla de acuerdo: > 40 % acaba en «ninguna» | es lo esperado en parte; los párrafos siguen sirviendo para entidades; los predicados se nutren de los confirmados |
| **Predicados raros que no llegan a 40** | conteo tras anotar | sintéticos hasta 60, tope 30 % de positivos; si no, fuera del modelo, dentro del menú |
| **Anclaje de la corrección** | (b) > 10 puntos | las R se publican como cota inferior; si hay horas, 5 artículos más en blanco |
| **Olvido de lo general** | §6.3 | lr 5e-6 o congelar capas bajas |
| **31 predicados no caben bien en el prompt** | (a) vs (b) en §6.3 | dos pasadas por familia; se paga en tiempo y se dice |
| **Fuga del apartado** | F1 sospechosamente alto | comprobación por `wp_id` y `oid_news` en el exportador y en la selección; el apartado se fija antes de muestrear |
| **Texto de Mongo distinto del de Legajo** (ediciones posteriores en WordPress) | `desfasado` en la alineación | se usa el texto de Legajo (`text_plain`) como referencia; los desfasados se excluyen y se cuentan |
| **La Mac se queda sin memoria** | swap alto, Ollama muere | un solo modelo residente; `num_ctx 8192`; la app cerrada |
| **La 4060 no cabe** | OOM | lote 4 × acumulación 2; `max_len 320`; o MPS |

---

## 11. Consideraciones

**Procedencia de los datos.** Las extracciones de Quién-AI las hicieron
Gemini y DeepSeek en 2025 sobre artículos propios de La Silla: el texto ya
pasó por servicios externos. Este plan no envía nada fuera: gpt-oss-20b corre
en la Mac. El modelo afinado se publica en un repositorio privado; los JSONL
de entrenamiento contienen párrafos del archivo y **no se suben** al repo de
código (van en `~/lsv/datos/entrenamiento/`, con `.gitignore` en `data/` ya
cubriéndolo si se mueven dentro).

**Licencias.** gpt-oss-20b es Apache 2.0; GLiNER-relex y `gliner`, Apache 2.0;
mDeBERTa-v3, MIT. Un modelo afinado sobre ellos se puede distribuir con la app.

**Seguridad de la base.** El usuario `claude` de Atlas lee todas las
colecciones, incluidas `users` (hashes bcrypt de la redacción) y `wokspace`
(una clave de API de OpenAI en claro). Ninguna de las dos se descargó. Conviene
**rotar esa clave** y restringir el usuario a lectura de las colecciones de
datos, o borrarlo al terminar la descarga: ya no hace falta, todo está en el
volcado.

**Reproducibilidad.** Semillas fijas en la selección, en el muestreo de la
auditoría y en el entrenamiento; hashes de todos los JSONL; el prompt exacto y
el nivel de razonamiento guardados con cada corrida de anotación; la versión
de Ollama y el digest del modelo (`ollama show gpt-oss:20b --modelfile`).

**Lo que este plan no mide.** Acuerdo entre anotadores (κ). Se cambió por la
medida de anclaje porque el flujo real de Legajo es corregir, no anotar en
blanco. Si el apartado va a publicarse como cifra oficial, hacen falta 5
artículos con dos personas (2 h) antes de publicarla.

**Lo que se descartó y por qué.** MultiTACRED-es: sus 70.000 oraciones
traducidas ya no aportan lo que Quién-AI trae nativo (~2.350 familiares), y
el riesgo de contaminar el estilo no compensa. Destilar 2.500 párrafos de cero
con el 27B (14 h): las pistas hacen el mismo trabajo más barato y con control.
Usar `batches_pending` o `processed_news_2` como texto: son copias y resúmenes;
el texto siempre es `news`/`articles`.

---

## 12. Lista de comprobación

**Antes del piloto**
- [ ] `ollama pull gpt-oss:20b` en la Mac; `ollama ps` muestra ≤ 15 GB con el modelo cargado y nada más
- [ ] Volcado de `~/lsv/datos/quien-ai/` accesible desde la Mac
- [ ] `sidecar/entrenamiento/apartado.txt` con los 30 `wp_id`, URL y `_id` de Mongo, y su semilla

**Piloto (fase 0)**
- [ ] `piloto_anotador.py`; 60 párrafos sin y con pistas; tabla de §4 rellena en `sidecar/entrenamiento/piloto/README.md`
- [ ] Dirección de familiares verificada en 50; regla escrita en `alinear_quien_ai.py`
- [ ] Decisión: modelo y nivel de razonamiento

**Semana 1**
- [ ] `alinear_quien_ai.py` → `alineado.jsonl`; 30 filas comprobadas a ojo
- [ ] `seleccion.jsonl` con los estratos de §5.3 y su semilla; cero `wp_id` del apartado
- [ ] `evento` retirado; 31 predicados con `familia` en Rust y TS; prueba de paridad en verde; menú en dos niveles
- [ ] `tiempos.valido = 0` sin edición o < 20 s por párrafo
- [ ] `importar_propuestas.py` carga un JSON de anotación como propuestas en `extraidas`/`relaciones_extraidas`

**Semanas 2–3**
- [ ] `anotar_llm.py` reanudable; `plata.jsonl` con contadores de validación por corrida
- [ ] Apartado anotado **sin pistas** y cargado en Legajo
- [ ] (b) 3 artículos desde cero → después corregidos; diferencia calculada
- [ ] (a) 30 artículos corregidos con `valido = 1`
- [ ] (c) 300 párrafos auditados; precisión por tipo y predicado; predicados < 0,60 retirados
- [ ] Positivos por predicado contados; sintéticos solo donde < 40
- [ ] `exportar_patron.py` con las cinco comprobaciones y la ida y vuelta; hashes

**Semana 4**
- [ ] `entrenar.py`; barrido de tres lr; `metrics.jsonl`
- [ ] §6.3: 31 vs familias vs 13; olvido sobre los 12 de calibración
- [ ] `banco_relaciones.py`; `banco_oro.py` extendido; tabla en `pipeline.md` con base y afinado el mismo día
- [ ] Decisión escrita; si se despliega, `Modelos::default()`, `catalogo()`, `preparar.py`, calibración por predicado

---

## Fuentes

- Volcado y hallazgos de `quien-ai-prod`: `/home/modev/lsv/datos/quien-ai/README.md`
- gpt-oss (OpenAI, Apache 2.0; 20B MoE, MXFP4, 128K de contexto, niveles de razonamiento) — https://ollama.com/library/gpt-oss · https://huggingface.co/openai/gpt-oss-20b
- GLiNER-Relex — https://arxiv.org/abs/2605.10108 · modelo https://huggingface.co/knowledgator/gliner-relex-multi-v1.0
- `gliner` 0.2.28: `RelationExtractionSpanProcessor`, `TrainingArguments` (`others_lr`, `focal_loss_*`, `rel_focal_loss_*`), `GLiNER.train_model`, `WhitespaceTokenSplitter` — https://github.com/urchade/GLiNER
- Sub-Billion, Super-Frontier — https://arxiv.org/abs/2606.22606 · How Small Can You Go? — https://arxiv.org/abs/2606.08051 · ETLCH — https://arxiv.org/abs/2509.08381
- Plan anterior y su razonamiento: [`entrenamiento.md`](entrenamiento.md), [`llm.md`](llm.md); medición del modelo actual: [`pipeline.md`](pipeline.md); tamaño del patrón y retirada de `evento`: [`plan-anotacion.md`](plan-anotacion.md); reglas de anotación: [`dudas-de-anotacion.md`](dudas-de-anotacion.md)

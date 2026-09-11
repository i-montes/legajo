# Plan de entrenamiento: un extractor propio de entidades y relaciones en español

> **Nota (2026-09-09):** la parte de datos de este plan quedó sustituida por
> [`plan-entrenamiento.md`](plan-entrenamiento.md), escrito tras encontrar las
> extracciones de Quién-AI en Mongo. Este documento se conserva por el
> razonamiento y la ontología, a los que el nuevo remite.

Este documento es el plan completo para pasar de un modelo genérico que se usa
tal cual (GLiNER-relex multilingüe, ver [`pipeline.md`](pipeline.md)) a **un
modelo afinado con datos de La Silla Vacía**, en español, que extraiga los ocho
tipos de entidad y **todas las relaciones que el archivo afirma**: familiares,
laborales, políticas, económicas, judiciales, de pertenencia y de fuente.

Está escrito para que se pueda ejecutar sin haber leído lo anterior, pero el
razonamiento que lo sostiene está en [`llm.md`](llm.md): sin afinar, ningún
modelo local le gana al actual; afinado, un modelo pequeño supera a los de
frontera; y en español no existe nada que adoptar. Hay que fabricarlo.

---

## 0. Resumen ejecutivo

| | |
|---|---|
| **Qué se entrena** | GLiNER-relex (codificador mDeBERTa-v3-base, 280M), partiendo del checkpoint multilingüe actual. Misma velocidad y memoria que hoy: cabe en cualquier portátil. |
| **Con qué** | 2.000–3.000 párrafos del archivo anotados con entidades y relaciones. Origen: destilación revisada del Qwen 27B + revisión humana del paso 6. Más MultiTACRED-es como pre-afinado. |
| **Qué se mide** | Precisión, cobertura y F1 por tipo y por predicado sobre **30 artículos apartados que el modelo nunca ve**, contra la línea base actual medida con las mismas herramientas. |
| **Cuánto cuesta** | ~6 semanas de calendario; ~40 h humanas de revisión; ~25 h de máquina desatendida en este Mac. Sin GPU externa. |
| **Criterio de éxito** | F1 de relaciones ≥ 0,60 en el apartado (hoy, estimado, < 0,35); cobertura de `persona`/`organizacion`/`lugar` ≥ 0,85 con precisión ≥ 0,80; ruido de nombres comunes < 10 % (hoy 31 %). Si no se alcanza, se documenta por qué y se queda el modelo actual. |

---

## 1. Punto de partida

**Modelo.** `knowledgator/gliner-relex-multi-v1.0`: entidades y relaciones en una
pasada, 1,4 GB en memoria, 1,4 s por 1.000 palabras en MPS y ~5 s en CPU. Su
segunda etapa de entrenamiento fueron ~3.000 ejemplos anotados por Gemini
(arXiv 2605.10108): la familia está hecha para afinarse con pocos miles.

**Lo que sabemos de sus fallos** (medido en `pipeline.md`, once artículos):

- Un 31 % de lo que devuelve en los tipos con nombre es nombre común
  («Estado», «universidades», «ley», «decreto»); en `ley` llega al 66 %.
- Las relaciones son fiables por encima de 0,8 (`trabaja en`, `ocupa el cargo`)
  y basura por debajo de 0,7 en `aliado de`/`opositor de`; 208 pares aparecen
  como aliados y opositores a la vez.
- No distingue una descripción definida («el Gobernador de Antioquia») de un
  nombre propio; eso lo pone la persona con `designa`.
- Su vocabulario de relaciones es el nuestro de 13 predicados; nunca vio
  `investigado por` ni `aspira a` en entrenamiento, y se nota (3 y 25 en 25.000).

**Datos.** Hoy, **cero** párrafos revisados de verdad: hay 12 artículos
«cerrados» en 25 segundos con todas las marcas iguales a las propuestas. Es el
primer problema y el que ordena todo el plan.

**Herramientas ya construidas** que el plan reutiliza:

| herramienta | para qué |
|---|---|
| `sidecar/banco.py` | correr cualquier GLiNER sobre artículos reales por la ruta de la app |
| `sidecar/banco_comparar.py`, `banco_genericos.py`, `banco_oro.py` | comparar corridas, medir ruido, medir contra decisiones humanas |
| `sidecar/banco_juez.py` | adjudicar discrepancias con el Qwen 27B local |
| `sidecar/banco_llm.py` | correr un LLM local con el mismo esquema (base del destilador) |
| Paso 6 de la app | la interfaz de revisión: corregir propuestas, agrupar identidades, relacionar |
| Tablas `anotaciones`, `relaciones`, `tiempos` | donde queda el patrón humano, con `auto` distinguiendo lo tocado de lo copiado |

---

## 2. La ontología: qué se va a extraer

### 2.1 Entidades

Los ocho tipos actuales, con dos cambios:

| tipo | se marca | no se marca | cambio |
|---|---|---|---|
| `persona` | nombre propio de una persona | pronombres, «el trabajador», «la experta» | — |
| `organizacion` | nombre de institución, empresa, partido, colectivo | «el Estado», «las empresas», «un sindicato» | — |
| `lugar` | nombre propio de lugar, sede | «el país», «la región», «municipios» | — |
| `cargo` | cargo o título, con o sin titular: «ministro de Hacienda», «senador» | oficios genéricos: «trabajador», «profesor» salvo como cargo institucional («profesor titular de la UN») | precisar la guía |
| `ley` | norma identificable: «Ley 1448 de 2011», «Acuerdo de Paz», «artículo 49 de la Constitución» | «la ley», «normas», «un decreto» | — |
| `obra` | título de libro, informe, medio, columna | «el artículo», «un libro» | — |
| `monto` | cantidad con cifra: «10 mil millones de pesos», «30 por ciento» | «salarios», «plata» | ya aplicado como regla |
| `evento` | **se retira** del entrenamiento y del esquema | | el 90 % de lo que devuelve es nombre común en las siete redacciones probadas; `plan-anotacion.md` ya lo había decidido |

**Designaciones.** «El Gobernador de Antioquia», «el dueño de Avianca», «la
cooperativa» señalan a alguien concreto sin nombrarlo. Se anotan con su tipo
(`cargo`, `organizacion`) y la marca `designa = 1`. El modelo se entrena a
**reconocerlas como entidad de su tipo**; resolver a quién señalan es la
resolución de identidades, un problema aparte que no se entrena aquí.

### 2.2 Relaciones: de 13 a 31

El vocabulario actual (13) se queda y se amplía a lo que un archivo de poder
afirma de verdad. Cada predicado declara los tipos que admite —eso ya existe y
filtra lo imposible a la salida— y si es simétrico. Los ejemplos son del estilo
del archivo.

**Familiares** (`persona` ↔ `persona`, simétricas salvo las dos primeras)

| predicado | admite | ejemplo |
|---|---|---|
| `padre o madre de` | P → P | «Álvaro Uribe, padre de Tomás Uribe» |
| `hijo de` | P → P | inversa de la anterior; se anota una sola dirección y la otra se deriva |
| `hermano de` | P ↔ P | «los hermanos Char» |
| `cónyuge o pareja de` | P ↔ P | «su esposa, Verónica Alcocer» |
| `familiar de` | P ↔ P | cuando el texto dice «primo», «sobrino», «familiar» sin precisar más |

**Laborales e institucionales**

| predicado | admite | ejemplo |
|---|---|---|
| `ocupa el cargo` | P → C | «el ministro de Hacienda, José Manuel Restrepo». Vigencia: el texto la dice («exministro» → pasada) |
| `trabaja en` | P → O | «Adriana Camacho, de la Universidad del Rosario» |
| `dirige` | P → O | «Claudia López, alcaldesa de Bogotá» implica `ocupa el cargo`; «Roy Barreras preside el Senado» es `dirige` |
| `fundó` | P, O → O | «fundador del Centro Democrático» |
| `dueño de` | P, O → O | «el dueño de Avianca» |
| `asesor de` | P → P, O | «asesor del presidente» |
| `sucedió a` | P → P | «reemplazó a X en el ministerio» |
| `nombró a` | P, O → P | «Petro nombró a Y como…» |
| `renunció a` | P → C, O | «renunció al ministerio» |
| `parte de` | cualquiera → O, L, N | pertenencia, no identidad: «la Facultad es parte de la Universidad» |

**Políticas**

| predicado | admite | ejemplo |
|---|---|---|
| `aliado de` | P, O ↔ P, O | solo si el texto lo afirma |
| `opositor de` | P, O ↔ P, O | idem |
| `miembro de` | P → O | militancia: «militante del Polo» (≠ `trabaja en`) |
| `aspira a` | P, O → C | «Char aspira a la Presidencia» |
| `apoyó a` | P, O → P, O | respaldo explícito a una candidatura o iniciativa |
| `se reunió con` | P, O ↔ P, O | encuentro afirmado |
| `criticó a` | P, O → P, O, N | declaración crítica afirmada |

**Económicas**

| predicado | admite | ejemplo |
|---|---|---|
| `financia a` | P, O → P, O | «financió la campaña de» |
| `contrató a` | O, P → O, P | contratación pública o privada afirmada |
| `socio de` | P, O ↔ P, O | «socio de X en la empresa Y» |
| `donó a` | P, O → P, O | |
| `destinado a` | M → O, C, L, N | «10 mil millones para el bicentenario» |

**Judiciales**

| predicado | admite | ejemplo |
|---|---|---|
| `investigado por` | P, O → O, N | «investigado por la Fiscalía» / «por peculado» |
| `condenado por` | P, O → O, N | |
| `acusado de` | P, O → N | «acusado de concierto para delinquir» |
| `demandó a` | P, O → P, O | |
| `sanciona con` | N → M | |

**Ubicación y fuente**

| predicado | admite | ejemplo |
|---|---|---|
| `ubicado en` | cualquiera → L | |
| `citado en` | P, O → O, B | «dijo a El Tiempo» |
| `autor de` | P → B | «autora del libro…» |

**Reglas de anotación transversales**

1. Solo lo que el texto **afirma**; no lo que la persona sabe. «Se dice que»,
   «habría» → no se marca, o se marca con vigencia `dudosa` si la interfaz lo
   permite.
2. **Vigencia**: `vigente`, `pasada`, `futura`. La fecha del artículo dice
   cuándo se afirmó, no cuándo fue verdad («el exministro» en 2015 es
   `pasada`). Ya existe en la tabla `relaciones.cuando`.
3. **Dirección**: en las asimétricas, siempre de sujeto a objeto tal como las
   tablas; en las simétricas, una sola fila.
4. Una relación **entre menciones del mismo párrafo**. Las que cruzan párrafos
   se dejan para la resolución de identidades: el modelo trabaja por párrafo.
5. Si dos predicados aplican («alcaldesa de Bogotá»: `ocupa el cargo` y
   `dirige`), se marcan los dos.

**Por qué 31 y no 100.** Cada predicado que se añade cuesta ejemplos: para que
el modelo aprenda uno hacen falta del orden de 60–100 casos positivos. Con 31
predicados, 2.500 párrafos dan unos 80 por predicado si están repartidos, y no
lo estarán: `ubicado en` saldrá mil veces y `donó a` diez. Los raros se
refuerzan con datos sintéticos (§3.4) o se dejan fuera si no llegan a 40.

**La interfaz.** El menú del paso 6 elige predicado con las teclas 1–9 sobre una
lista filtrada por tipos. Con 31 predicados el filtro por tipos deja 6–12
opciones por par; hay que **agrupar por familia** (familiar / laboral /
política / económica / judicial / fuente) en dos niveles. Y `PREDICADOS` vive
duplicado en `core/src/extraccion.rs` y `src/contenido/tipos.ts` con una prueba
que exige que coincidan: se cambian los dos.

---

## 3. Los datos

### 3.1 Cuánto hace falta y por qué

| conjunto | tamaño | para |
|---|---:|---|
| **Entrenamiento** | 2.000–2.500 párrafos con entidades y relaciones | afinar |
| **Validación** | 250 párrafos | elegir hiperparámetros y parar a tiempo |
| **Apartado** (30 artículos ≈ 1.000 párrafos) | nunca se entrena con ellos | la cifra que se publica |

Los números salen de tres sitios: GLiNER-relex se afinó con ~3.000; ETLCH mejora
con cientos por tarea; y `plan-anotacion.md` calculó que 60 artículos revisados
dan ±0,05 de precisión en los cuatro tipos grandes. Los 30 apartados son los
mismos 30 que el plan de anotación ya reservaba «para no quedarse sin vara».

### 3.2 De dónde salen: tres fuentes, en este orden

**A. Destilación revisada del Qwen 27B (el grueso).** Medido en `pipeline.md`:
el 27B es preciso pero lento (~20 s por párrafo aquí), y no cabe en una máquina
de redacción — pero sí en esta. Se usa una vez, para fabricar datos:

1. Muestra de **2.500 párrafos** del archivo, estratificada por sección
   (política, regiones, académica, judicial…) y por año, excluyendo los 30
   artículos apartados. Párrafos de 40–200 palabras; nada de transcripciones
   de una línea.
2. El 27B anota cada párrafo con el esquema de §2 (prompt de `banco_llm.py`
   ampliado a 31 predicados, con las tres reglas de salida). **~14 h
   desatendidas** en este Mac. Se guarda con puntuación de confianza si el
   modelo la da, o se repite con temperatura 0 y se marca lo inestable.
3. **Revisión humana de una muestra del 20 %** (500 párrafos, ~10 h a dos
   minutos por párrafo) en la interfaz del paso 6 cargada con esas propuestas.
   Da dos cosas: la tasa de error del 27B por tipo y predicado, y 500 párrafos
   de calidad humana.
4. Si un predicado tiene precisión < 0,7 en la muestra revisada, se revisa el
   100 % de sus casos o se retira del entrenamiento. Lo demás entra como
   «plata» con su etiqueta de origen (`fuente = destilado`).

**B. La revisión del paso 6, de verdad (la calidad).** Los 60 artículos del
plan de anotación, revisados por dos personas en al menos 15 de ellos para
medir acuerdo. Cada artículo revisado produce ~35 párrafos con entidades
corregidas y relaciones marcadas a mano. **~25 h humanas.** Estos son los
únicos datos «oro» y van todos a validación y apartado, más una parte a
entrenamiento con peso doble.

> Lo que hoy hay en la base **no sirve**: 12 artículos cerrados en 25 segundos
> con `auto = 1` en las 1.923 marcas. Se descartan. La app debe dejar de contar
> como revisado un artículo cerrado en menos de N segundos o sin una sola
> edición: es un cambio pequeño en `tiempos.valido` y evita repetir esto.

**C. MultiTACRED-es como pre-afinado (opcional, barato).** ~70.000 oraciones en
español (traducidas), con relaciones TAC KBP. Se mapean las que existen en
nuestro vocabulario —`per:employee_of` → `trabaja en`, `per:title` →
`ocupa el cargo`, `org:parents`/`org:subsidiaries` → `parte de`,
`per:parents`/`per:children` → `padre o madre de`/`hijo de`,
`per:spouse` → `cónyuge o pareja de`, `per:siblings` → `hermano de`,
`per:charges` → `acusado de`, `org:founded_by` → `fundó`— y se hace una época
de pre-afinado antes de los datos propios. Aporta volumen en las familiares y
judiciales, que en el archivo son raras. Riesgo: son traducciones automáticas
de noticias en inglés; por eso va **antes** y no mezclado.

### 3.3 Formato

El que espera el paquete `gliner` (`RelationExtractionSpanProcessor`): texto
tokenizado, entidades por índices de token, relaciones por índices de entidad.

```json
{
  "tokenized_text": ["El", "ministro", "de", "Hacienda", ",", "José", "Manuel", "Restrepo", ",", "anunció", "…"],
  "ner": [[1, 3, "cargo"], [5, 7, "persona"]],
  "relations": [[1, 0, "ocupa el cargo"]],
  "meta": {"wp_id": 32061, "pi": 4, "fuente": "humano", "revisor": "…", "cuando": ["vigente"]}
}
```

- `ner`: `[inicio_token, fin_token_inclusive, tipo]`, ordenadas.
- `relations`: `[índice_cabeza, índice_cola, predicado]` sobre `ner`. Las
  simétricas se escriben en una dirección; el exportador puede duplicarlas si
  el entrenamiento lo pide.
- Tokenización: la de spaCy `es_core_news_sm`, la misma que usa la app, para
  que las posiciones de carácter de `anotaciones` (pi, ini, fin) se alineen a
  tokens con `doc.char_span(..., alignment_mode="expand")`.
- `meta` no lo lee el modelo; sirve para filtrar por fuente y para volver al
  artículo cuando algo sale raro.

**Exportador** (`sidecar/exportar_patron.py`, por escribir): lee `anotaciones`
y `relaciones` de un lote, junta por `mid`, tokeniza, alinea, valida (ningún
índice fuera de rango, ningún predicado fuera del vocabulario, ningún par de
tipos que el predicado no admita) y escribe un JSONL por fuente. Prueba: el
párrafo de la entrevista de Adriana Camacho exportado y vuelto a leer da las
mismas marcas.

### 3.4 Sintéticos para los predicados raros

Para los que no lleguen a 40 positivos (`donó a`, `renunció a`, `sucedió a`,
`hermano de`…), el 27B genera **párrafos nuevos en el estilo del archivo** a
partir de plantillas con entidades reales del censo («escribe un párrafo de
noticia colombiana donde {persona} renuncia a {cargo}»), y una persona revisa
todos. Se marcan `fuente = sintetico` y **nunca** entran en validación ni en el
apartado. Tope: el 30 % de los positivos de cada predicado.

### 3.5 Control de calidad

- **Acuerdo entre anotadores** (κ de Cohen por tipo y por predicado) sobre los
  15 artículos doblemente revisados. Por debajo de 0,6 en un predicado, su guía
  está mal escrita: se reescribe antes de seguir.
- **Chequeos automáticos** en el exportador: tipos admitidos por predicado,
  espejos duplicados, relaciones con un extremo que no es entidad, montos sin
  cifra, pronombres como persona.
- **Fugas**: ningún párrafo del apartado en entrenamiento ni validación; se
  comprueba por `wp_id`, no por texto.

---

## 4. El entrenamiento

### 4.1 Camino principal: afinar GLiNER-relex

**Por qué este y no un LLM.** Conserva lo que hace viable el producto: 1,4 GB,
1,4 s por 1.000 palabras, CPU aceptable. Los LLM pequeños afinados también
funcionan (§`llm.md`), pero al servirlos son 14–35 veces más lentos.

**Receta**

| | |
|---|---|
| Punto de partida | `knowledgator/gliner-relex-multi-v1.0` (mDeBERTa-v3-base, multilingüe). No partir de cero ni del `large` inglés. |
| Etapa 0 (opcional) | 1 época sobre MultiTACRED-es mapeado, lr 1e-5, solo relaciones familiares/judiciales/laborales. |
| Etapa 1 | 3–5 épocas sobre entrenamiento (§3.1), lr codificador 1e-5, lr cabezas 5e-5, lote 8, `warmup` 10 %, `weight_decay` 0,01, *focal loss* en relaciones (`rel_focal_loss_gamma = 2`) porque las relaciones son escasas frente a los pares posibles. |
| Etiquetas | Las mismas cadenas que envía la app (`ETIQUETAS` en `extraccion.rs`, redacción G, y los 31 predicados). Entrenar con las etiquetas que se van a usar es lo que hace que el afinado se note. |
| Negativos | Los tipos y predicados que no aparecen en un párrafo se muestrean como negativos (`augment_example` lo hace); mantener el señuelo «grupo genérico de personas» en entrenamiento con sus ejemplos negativos, para que siga absorbiendo. |
| Parada | Por F1 de relaciones en validación, paciencia 2 épocas. |
| Hardware | Este Mac (M5 Pro, 24 GB) en MPS: el codificador es de 280M; una época de 2.500 párrafos son minutos, no horas. Toda la etapa 1 cabe en una tarde. Una GPU alquilada no hace falta. |
| Trazabilidad | Cada corrida guarda su config, el hash del JSONL de entrenamiento y las métricas en `sidecar/entrenamiento/<fecha>/`. |

**Herramienta**: `sidecar/entrenar.py` (por escribir), sobre
`gliner.training.Trainer`/`TrainingArguments` (extienden los de
`transformers`; traen *focal loss* y tasas de aprendizaje distintas por bloque).
Entrada: JSONL de §3.3; salida: un directorio de modelo cargable con
`GLiNER.from_pretrained(ruta)`, que es exactamente lo que el sidecar hace hoy.

**Barrido pequeño, no grande.** Tres corridas bastan para saber si va: lr
{5e-6, 1e-5, 2e-5} con el resto fijo. Si la mejor no supera a la base en
validación, el problema son los datos, no los hiperparámetros: se vuelve a §3.

### 4.2 Camino alterno: un LLM pequeño con LoRA

Solo si el camino principal falla en relaciones (por ejemplo, si el codificador
no aprende las direccionales). Qwen3 1,7B o NuExtract-2.0-2B, LoRA rango 16
sobre las proyecciones de atención, instrucción → JSON con el mismo esquema,
2.500 ejemplos, 3 épocas, MLX en este Mac (~1 h por época). Al servirlo hay que
asumir 20–50 s por 1.000 palabras y JSON que a veces se rompe: el sidecar ya
tolera respuestas inválidas por párrafo. Es un plan B, no una segunda pista en
paralelo: los datos son los mismos y son lo caro.

---

## 5. Evaluación

Siempre sobre el **apartado** (30 artículos), con las herramientas que ya
existen y una nueva:

| métrica | herramienta | umbral de éxito |
|---|---|---|
| P / R / F1 por **tipo de entidad**, solape en el mismo párrafo y mismo tipo (la regla de la calibración) | `banco_oro.py` extendido a patrón humano completo | P ≥ 0,80 y R ≥ 0,85 en persona/organización/lugar; F1 ≥ 0,70 en cargo, ley, obra, monto |
| P / R / F1 por **predicado**, extremos casados por solape y predicado exacto; las simétricas en cualquier dirección | `banco_relaciones.py` (por escribir, ~80 líneas) | F1 ≥ 0,60 global; ≥ 0,70 en `trabaja en`, `ocupa el cargo`, `ubicado en`, `parte de`; se reporta todo, también lo que salga en 0,2 |
| **Ruido**: nombres comunes en minúscula en los tipos con nombre | `banco_genericos.py` | < 10 % (hoy 31 %) |
| **Velocidad y memoria**: s por 1.000 palabras en MPS y CPU, GB residentes | `banco.py --vueltas 2` | igual que la base ±10 % (es el mismo codificador) |
| **Contra la base**: acuerdo y discrepancias, adjudicadas por el 27B como plata | `banco_comparar.py`, `banco_juez.py` | lo exclusivo del afinado ≥ 60 % válido (la base zero-shot dio 21 %) |

Se publica la tabla completa en `pipeline.md`, incluida la fila del modelo
actual medida el mismo día, sobre los mismos 30 artículos. Si el afinado no
gana en F1 de relaciones **y** en ruido, no se despliega.

---

## 6. Integración en Legajo

Casi todo el pipeline es agnóstico al modelo; lo que cambia:

| dónde | qué |
|---|---|
| `core/src/extraccion.rs` → `Modelos::default().gliner` | el identificador del modelo afinado: un repositorio en Hugging Face (privado o público) `lasillavacia/legajo-relex-es-v1`, que `preparar.py` baja como cualquier otro |
| `ETIQUETAS`, `PREDICADOS` (Rust) y `PREDICADOS` (`tipos.ts`) | los 31 predicados con sus tipos; retirar `evento`; la prueba de paridad Rust/TS obliga a hacerlo a la vez |
| `catalogo()` | el tamaño del modelo nuevo para el mensaje de descarga |
| `sidecar/requirements.txt` | si cambia la versión de `gliner`; cambia el sello y la capa de ejecución se rehace una vez |
| Paso 6, menú de predicados | agrupar por familia (§2.2) |
| `calibracion.rs` | las relaciones se calibran también: corte por predicado con la misma regla de F1 que los tipos; hoy el umbral de relaciones es fijo en 0,4 |
| `docs/pipeline.md` | la tabla del apartado, el día del despliegue |

El despliegue es un cambio de configuración más una migración de vocabulario;
la app no cambia de arquitectura.

---

## 7. Cronograma

| semana | qué | horas humanas | máquina |
|---|---|---:|---:|
| 1 | Guía de anotación de los 31 predicados (§2) revisada por la redacción; retirar `evento`; ampliar `PREDICADOS` y el menú; escribir `exportar_patron.py`; apartar los 30 artículos | 12 | — |
| 2 | Muestra de 2.500 párrafos; destilación con el 27B; primera revisión de 500 párrafos | 10 | 14 h |
| 3 | Revisión humana de 30 de los 60 artículos (dos personas en 15); κ; corregir la guía donde κ < 0,6 | 20 | — |
| 4 | Exportar; escribir `entrenar.py`; etapa 0 (MultiTACRED-es) y etapa 1; barrido de lr | 6 | 6 h |
| 5 | Evaluación sobre el apartado; `banco_relaciones.py`; adjudicación de discrepancias; segunda revisión de los otros 30 artículos si hace falta más patrón | 12 | 4 h |
| 6 | Decisión; despliegue o documentación del no; sintéticos para predicados raros si se decide seguir | 6 | 2 h |
| | | **~66 h** | **~26 h** |

El 60 % de las horas humanas son revisión en la interfaz que ya existe. Es el
mismo trabajo que el paso 6 pide de todas formas para calibrar: no es un coste
añadido, es el mismo trabajo hecho con rigor y guardado.

---

## 8. Riesgos y qué se hace con cada uno

| riesgo | señal | respuesta |
|---|---|---|
| **Se afina sobre basura.** Datos destilados sin revisar, o revisiones de dos segundos | precisión del 27B < 0,7 en la muestra; `tiempos` cortos; κ bajo | la muestra revisada es obligatoria antes de exportar; `tiempos.valido` invalida cierres sin edición; κ < 0,6 para la guía |
| **Predicados raros que no aprenden** | < 40 positivos; F1 0 en validación | sintéticos revisados hasta 40; si no, se retiran del modelo y se dejan en el menú humano |
| **El afinado olvida lo general** (pierde en artículos de secciones no vistas) | cae la cobertura en el apartado de secciones distintas a las de entrenamiento | estratificar por sección; lr bajo en el codificador; mezclar un 20 % de los datos originales de la familia si están disponibles |
| **Direccionalidad** (`padre de` vs `hijo de`) | espejos con puntuaciones iguales | anotar una sola dirección y derivar la inversa en la salida; medir dirección aparte |
| **Fuga del apartado** | F1 sospechosamente alto | comprobación por `wp_id` en el exportador; el apartado se fija antes de muestrear |
| **Traducciones de MultiTACRED contaminan el estilo** | el modelo marca como en inglés traducido | usarlo solo en etapa 0 y con lr bajo; comparar con y sin |
| **La redacción no tiene 40 h** | la semana 3 no se hace | el plan degrada con gracia: con solo la destilación revisada (500 párrafos humanos + 2.000 plata) se entrena igual; la cifra del apartado sale con menos precisión |

---

## 9. Lista de comprobación antes de empezar

- [ ] Guía de anotación de §2 aprobada por quien va a revisar
- [ ] `evento` retirado del esquema; 31 predicados en Rust y TS; prueba de paridad en verde
- [ ] Menú del paso 6 agrupado por familia
- [ ] `tiempos.valido` invalida cierres sin edición
- [ ] 30 artículos apartados, listados por `wp_id` en `sidecar/entrenamiento/apartado.txt`
- [ ] `exportar_patron.py` con su prueba de ida y vuelta
- [ ] Prompt del destilador con los 31 predicados, probado sobre 20 párrafos a mano
- [ ] Este Mac libre de otros modelos residentes durante la destilación (Ollama con un solo modelo cargado: la última vez, tres modelos a la vez llevaron el swap a 11 GB y el sistema mató las tareas)

---

## Fuentes

- GLiNER-Relex — https://arxiv.org/abs/2605.10108
- Sub-Billion, Super-Frontier (SLM afinados vs frontera en RE) — https://arxiv.org/abs/2606.22606
- How Small Can You Go? (LoRA 270M–8B para extracción) — https://arxiv.org/abs/2606.08051
- ETLCH (1B, pocos cientos de ejemplos por tarea) — https://arxiv.org/abs/2509.08381
- MultiTACRED — https://aclanthology.org/2023.acl-long.210/
- `gliner` (entrenamiento: `gliner.training.Trainer`) — https://github.com/urchade/GLiNER
- Evaluación previa de LLM locales — [`llm.md`](llm.md); medición del modelo actual — [`pipeline.md`](pipeline.md); tamaño del patrón — [`plan-anotacion.md`](plan-anotacion.md)


## Despliegue del afinado (2026-09-10)

El modelo que corre en la app sale de `sidecar/entrenamiento/v5/lr2e-5-s42/final`
(plata MiniMax v5 + oro de los lotes 1–8), instalado con `sidecar/instalar_modelo.py`.
Sobre la prueba de 50 artículos que nunca se entrenó: entidades F1 0,86 con umbral por
tipo, relaciones 0,47 con umbral por predicado (0,42 con un corte único de 0,7; el
anotador que lo enseñó llega a 0,53). Los resultados de cada vuelta están en
`sidecar/entrenamiento/{v1,v2,oro100,v5}/RESULTADOS.md`. La app amplió su
vocabulario de 13 a los 35 predicados del entrenamiento; el menú de revisión los
agrupa por familia cuando entre dos tipos encajan más de nueve.

# ¿Un modelo de lenguaje como extractor?

La pregunta, dicha como la hizo la redacción: *un Qwen local saca mejores
entidades y relaciones que GLiNER, pero no todos los medios tienen 16 GB de RAM
ni paciencia; ¿qué opciones hay, se puede afinar uno pequeño para esto, y existe
ya alguno hecho para español?* Se responde en tres partes: lo que existe, lo que
se midió aquí, y qué tan probable es que afinar funcione.

Las cifras de velocidad y ruido de GLiNER-relex con las que se compara están en
[`pipeline.md`](pipeline.md); las de los LLM salen de `sidecar/banco_llm.py`,
que corre el mismo esquema —ocho tipos, trece predicados— por Ollama sobre los
mismos artículos y deja el mismo JSON, así que `banco_comparar.py` y
`banco_genericos.py` los leen igual.

## 1. Lo que existe

### Hecho para español: nada que extraiga relaciones

Buscado en Hugging Face y en la literatura, con los nombres que usa cada
comunidad:

| Qué | Qué hace | Para esto |
|---|---|---|
| **PlanTL / ALIA (BSC)** `roberta-base-bne-capitel-ner` y familia | NER en español, cuatro tipos clásicos (persona, organización, lugar, otro), afinado sobre CAPITEL | Entidades sí, con precisión alta en sus cuatro tipos; **sin cargos, normas, obras ni montos, y sin relaciones**. Es el mejor NER en español que hay; cubre la mitad del esquema. |
| `mrm8488/bert-spanish-cased-finetuned-ner`, `MMG/xlm-roberta-large-ner-spanish`, `flair/ner-spanish-large` | NER español, los mismos cuatro tipos | Idem. |
| **Salamandra-7b-instruct / ALIA-40b (BSC)** | LLM instruido en español y lenguas de España; «NER incluido en el ajuste, no optimizado» según su ficha | Un Qwen en español. Mismo problema de tamaño (7B y 40B). |
| **GoLLIE (HiTZ, UPV/EHU)** | LLM 7–34B que sigue guías de anotación para extracción zero-shot | Entrenado en inglés; grande; latencia de LLM. Su idea —la guía de anotación como parte de la instrucción— sí es aprovechable. |
| **MultiTACRED** | TACRED traducido a 12 lenguas, español incluido; 83 % de traducciones aceptables según nativos | **El único corpus de relaciones en español de tamaño útil.** Sus relaciones son las de TAC KBP —`employee_of`, `title`, `member_of`, `parents`…— y varias mapean a las nuestras: `trabaja en`, `ocupa el cargo`, `parte de`, `familiar de`. Sirve para pre-afinar, no para el vocabulario político. |
| Un TFG de la UPM (2023) | REBEL afinado sobre «un dataset creado en español» | Sin modelo ni datos publicados. |
| **NuExtract 2.0 2B** (NuMind, MIT) | Texto → JSON según una plantilla, multilingüe (mitad del entrenamiento en francés, alemán, español, italiano, portugués), sobre Qwen2-VL-2B | Cabe en 8 GB y está hecho para extraer con esquema. No modela relaciones como tales, pero una plantilla `{"relaciones":[…]}` es una plantilla. Candidato serio a afinar si se quiere un LLM y no GLiNER. |

No hay, a septiembre de 2026, un modelo público que extraiga **relaciones** en
español, ni uno con un vocabulario de poder político. Lo más cercano a lo que
Legajo necesita sigue siendo un modelo **multilingüe**: el GLiNER-relex que ya
usa (mDeBERTa-v3, entrenado en varias lenguas) o un LLM multilingüe pequeño.

### Los pequeños, y cuánta memoria piden

Lo que Ollama carga en memoria, cuantizado a 4 bits, medido en esta máquina:

| modelo | en memoria | cabe en |
|---|---:|---|
| GLiNER-relex-multi (el actual) | ~1,4 GB | cualquier portátil |
| Qwen3 1,7B | ~1,4 GB | 8 GB |
| Qwen3 4B · Gemma 3 4B · Llama 3.2 3B | 2,5–3,3 GB | 8 GB |
| Qwen3.5 9B | 5,5 GB | 16 GB, justo con la app y el navegador |
| Qwen3 14B | ~9 GB | 16 GB, sin nada más abierto |
| Qwen3.8 27B (el que juzgó las discrepancias) | 17–19 GB | **no cabe en 16 GB**; aquí, con 24, paginaba |

La memoria no es el único límite: un LLM genera token a token, y la velocidad
la pone el ancho de banda de memoria de la máquina. En un portátil sin GPU
dedicada, los tokens por segundo caen a un tercio o menos de los de aquí.

## 2. Lo que se midió

Cinco LLM locales por Ollama, cuantizados a 4 bits, con el mismo esquema y el
mismo prompt —tipos, predicados con sus tipos admitidos, las tres reglas de
salida, JSON estricto—, sobre los dos artículos más cortos del lote de
calibración (2.722 palabras), y GLiNER-relex sobre los mismos dos. Zero-shot:
lo que un modelo saca de la caja, sin afinar. Apple M5 Pro; la columna «CPU»
apaga el GPU, que es el portátil de redacción sin gráfica.

| modelo | memoria | tok/s | **s / 1.000 pal** | entidades ≥0,5 | nombre común | relaciones | acuerdo con relex |
|---|---:|---:|---:|---:|---:|---:|---:|
| **GLiNER-relex-multi** (280M) | ~1,4 GB | — | **1,4** | 162 | 31 % | 72 | — |
| Qwen3 14B | 9,6 GB | 25 | 53 | 82† | 56 % | 5† | 44 % |
| Qwen3.5 9B | 5,5 GB | 16 | 29 | 40 | **13 %** | 21 | 31 % |
| Qwen3 4B | 3,2 GB | 65 | 20 | 135 | 42 % | 18 | 44 % |
| Qwen3 4B **solo CPU** | 3,5 GB | 20 | **50** | 53† | 44 % | 7† | 34 % |
| Gemma 3 4B | 2,9 GB | 64 | 37 | 310 | 69 % | 29 | 38 % |
| Qwen3 1,7B | 1,6 GB | 163 | 26 | 247 | 64 % | 12 | 38 % |
| Llama 3.2 3B | 2,5 GB | 102 | 78 | 298 | 70 % | 19 | 37 % |

† un solo artículo (1.099 palabras). «Nombre común» es la proporción de
entidades de los tipos que llevan mayúscula que vienen en minúscula total, el
indicio barato de ruido de `banco_genericos.py`; «acuerdo» es la coincidencia con
GLiNER-relex por solape en el mismo párrafo y tipo. Los JSON inválidos: Gemma 2,
Llama 6, Qwen3 1,7B **11** de unas 85 respuestas cada uno; los Qwen de 4B en
adelante, ninguno.

Tres lecturas:

**Velocidad.** El más rápido de los LLM (Qwen3 4B con GPU) es **14 veces más
lento** que GLiNER-relex; en CPU, **35 veces**. Más tokens por segundo no
significa más rápido: el 1,7B genera a 163 tok/s y tarda lo mismo que el 9B,
porque escribe el doble y la mitad es basura o JSON roto. Y más grande tampoco
es más rápido ni mejor sin afinar: el 14B tarda 53 s por mil palabras, ocupa
9,6 GB y devolvió 24 «eventos» en un artículo con uno. Un portátil de redacción sin
gráfica y con menos núcleos que este Mac queda 2–4 veces por debajo de esa
columna: entre 100 y 200 s por artículo. El archivo son 84.000 artículos: con
GLiNER-relex en CPU, unos días de máquina; con un LLM de 4B en CPU, meses. La
memoria cabe en 16 GB para todos menos el 27B; **el tiempo es lo que no cabe.**

**Calidad, sin afinar.** Los pequeños (3–4B) producen más ruido que GLiNER, no
menos: Gemma y Llama devuelven un 70 % de nombres comunes y rompen el JSON con
frecuencia (2 y 6 respuestas inválidas de ~85); Llama marca «obra» a 105 tramos
en dos artículos. Qwen3 4B es el más contenido (42 %) y aun así peor que GLiNER
(31 %). Y todos sacan **de tres a diez veces menos relaciones**: 7–29 frente a
72.

**El 9B es otra cosa.** Lo poco que devuelve es casi siempre correcto —13 % de
nombres comunes, la mejor precisión de la tabla— y sus relaciones se leen como
las escribiría una persona: «Carlos Manrique *ocupa el cargo* Director del
Departamento de Filosofía», «Facultad de Ciencias Sociales *parte de* Universidad
de Los Andes», «Reserva de Encenillo *ubicado en* Guasca». Pero devuelve una
cuarta parte de las entidades de GLiNER: en una entrevista de 35 párrafos marcó
5, todas del párrafo de presentación, y nada en las respuestas. Es exactamente
el perfil que describe la literatura para los LLM en zero-shot: **precisos y
cortos de cobertura** — y por eso los modelos pequeños afinados les ganan.

Lo que esto no dice: qué haría cualquiera de ellos **afinado**. Eso lo dice la
sección siguiente.

## 3. ¿Se puede afinar uno pequeño para esto?

**Sí, con alta probabilidad — y el límite no es el modelo, son los datos.** La
evidencia de 2025–2026 es consistente:

- **Sub-Billion, Super-Frontier** (arXiv 2606.22606): modelos de 0,36–3B
  afinados para extracción de relaciones superan a los modelos de frontera en
  zero-shot: Qwen2.5-0.5B afinado, F1 0,83 frente a GPT-5.4 0,69 y Claude
  Sonnet 4.6 0,66. Afinar cada uno costó unas 16 h en una sola RTX 4090. Todo en
  inglés, con hasta 200.000 ejemplos por corrida.
- **How Small Can You Go?** (arXiv 2606.08051): extracción estructurada, de
  270M a 8B. Qwen 3.5-0.8B afinado queda a 2 puntos de F1 del 8B (94,8 frente a
  97,0), y el 4B es 3,8 veces más rápido que el 8B con la misma precisión.
- **ETLCH** (arXiv 2509.08381): un modelo de ~1B afinado con **unos cientos a mil
  ejemplos por tarea** de NER, JSON y grafos de conocimiento, con ganancias
  «sustanciales incluso en la escala de datos más baja».
- **GLiNER-Relex** (arXiv 2605.10108), el modelo que Legajo usa: su segunda
  etapa de entrenamiento fueron **~3.000 ejemplos** anotados por Gemini. Es
  decir, la propia familia se afina con pocos miles de ejemplos, y se puede
  volver a afinar sobre los nuestros: es un codificador de 280M y el paquete
  `gliner` trae el entrenamiento.

Trasladado a Legajo:

| | qué haría falta | cuánto cuesta |
|---|---|---|
| **Afinar GLiNER-relex** sobre nuestro esquema | 1.000–3.000 párrafos anotados con entidades y relaciones. La revisión del paso 6 los produce; hoy hay 12 artículos cerrados sin corregir, es decir, cero. | Horas en el Mac (es un codificador de 280M). Mantiene velocidad y memoria actuales. **El camino más corto.** |
| **Afinar un LLM de 0,6–1,7B** (Qwen3) con LoRA | Los mismos 1.000–3.000 ejemplos, en formato instrucción → JSON | MLX en Apple Silicon: del orden de una hora por cada pocos miles de ejemplos. Cabe en 8 GB al servirlo. |
| **Destilar del 27B** | Correr el 27B sobre 2.000 párrafos del archivo, que una persona revise una muestra, y afinar con eso | El 27B tarda ~20 s por párrafo aquí: 2.000 párrafos son 11 horas de máquina, desatendidas. Es la forma de tener datos sin 60 horas de anotación. |

El riesgo real no es técnico. Es que **lo afinado aprende lo que se le enseña**:
si el patrón son propuestas del modelo conservadas sin leer —como los 12
artículos de hoy—, se afina para repetir sus errores. Afinar exige revisión de
verdad primero, y una parte del patrón apartada para medir: los 60 + 30
artículos del plan.

## 4. Recomendación

El plan concreto para afinar está en [`entrenamiento.md`](entrenamiento.md).


1. **Hoy, GLiNER-relex se queda.** Es 14–35 veces más rápido, cabe en cualquier
   máquina, y sin afinar nadie le gana en cobertura ni en relaciones. Un LLM
   zero-shot en el paso 5 haría la extracción del archivo inviable en el
   hardware que una redacción tiene.

2. **El camino a menos ruido no es un LLM más grande: es afinar con datos
   propios.** La evidencia (§3) dice que un modelo pequeño afinado supera a los
   de frontera, y que la familia GLiNER-relex se afina con unos miles de
   ejemplos. Ese es el proyecto: **1.000–3.000 párrafos revisados de verdad**,
   con entidades y relaciones, apartando 30 artículos para medir. Primer
   candidato a afinar: el propio GLiNER-relex (misma velocidad, misma memoria).
   Segundo: Qwen3 0,6–1,7B con LoRA, si se quiere generación, a costa de
   velocidad.

3. **El 27B tiene un sitio, y no es el paso 5.** Es demasiado grande para la
   redacción, pero cabe en *una* máquina —esta— y es preciso: sirve para
   **fabricar datos** (destilación revisada: 2.000 párrafos en ~11 h
   desatendidas) y para **juzgar** discrepancias, como se hizo en
   `pipeline.md`. Un oráculo en la máquina de quien construye, no un extractor
   en la de quien usa.

4. **En español no hay nada que adoptar directamente.** Los NER de BSC cubren
   cuatro tipos y ninguna relación; MultiTACRED es el único corpus de relaciones
   y sirve para pre-afinar, no para el vocabulario político. Legajo tiene que
   fabricar su propio patrón; la buena noticia es que el paso 6 está diseñado
   justamente para eso, y que no hacen falta 400 artículos sino sesenta.

## Fuentes

- Sub-Billion, Super-Frontier: SLMs Rival Zero-Shot Frontier LLMs on Relation Extraction — https://arxiv.org/abs/2606.22606
- How Small Can You Go? LoRA Fine-Tuning 270M–8B Models for IE — https://arxiv.org/abs/2606.08051
- Low-Resource Fine-Tuning for Multi-Task Structured IE with a 1B Model (ETLCH) — https://arxiv.org/abs/2509.08381
- GLiNER-Relex: Joint NER and RE — https://arxiv.org/abs/2605.10108
- GLiNER2 — https://arxiv.org/abs/2507.18546
- GoLLIE — https://arxiv.org/abs/2310.03668 · https://github.com/hitz-zentroa/GoLLIE
- MultiTACRED — https://aclanthology.org/2023.acl-long.210/
- Salamandra-7b-instruct (BSC) — https://huggingface.co/BSC-LT/salamandra-7b-instruct · ALIA Kit https://langtech-bsc.gitbook.io/alia-kit/modelos/modelos-de-texto
- NuExtract 2.0 2B — https://huggingface.co/numind/NuExtract-2.0-2B
- TFG UPM, extracción de relaciones en español con REBEL — https://oa.upm.es/75409/

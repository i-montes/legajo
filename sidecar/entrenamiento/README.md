# Entrenamiento del extractor: las herramientas y el orden

Implementación de `docs/plan-entrenamiento.md`. Todo corre desde la raíz del
repo con `.venv/bin/python`. Los datos grandes viven fuera del repo:
`~/lsv/datos/quien-ai/` (volcado de Mongo y alineación) y
`~/lsv/datos/entrenamiento/` (anotaciones del LLM).

| paso | guion | entrada → salida |
|---|---|---|
| 0 | `sidecar/vocabulario.py` | los 7 tipos, las etiquetas (redacción G) y los 35 predicados con sus familias; lo importan todos los demás |
| 1 | `sidecar/alinear_quien_ai.py` | volcado de Quién-AI → `alineado.jsonl` (relaciones con su párrafo de Legajo, dirección corregida) y `cargos.jsonl` |
| 2 | `sidecar/apartar.py` | 30 artículos que nunca se entrenan → `entrenamiento/apartado.txt` (semilla 2026) |
| 3 | `sidecar/seleccionar.py [--escala 0.25 --salida …]` | párrafos por estrato (F, PL, J, E, N, A, R) con su conjunto train/val → `seleccion.jsonl`, `seleccion-025.jsonl` |
| 4 | `sidecar/anotar_llm.py --piloto` / `--seleccion X` / `--apartado` | gpt-oss:20b anota con pistas → `plata.jsonl`; sin pistas los apartados → `apartado-sin-pistas.jsonl`. Reanudable |
| 4b | `sidecar/piloto_informe.py [--columna nombre=patrón]` | tabla del piloto (§4) |
| 5 | `sidecar/exportar_patron.py --etiqueta v1 --seleccion …` | plata + oro de la app → `entrenamiento/v1/{train,val}.jsonl` en formato GLiNER, `informe.json` |
| 6 | `sidecar/entrenar.py --datos entrenamiento/v1 --lr 1e-5 --epocas 4` | afina `knowledgator/gliner-relex-multi-v1.0` → `final/`, `metrics.jsonl` |
| 7 | `sidecar/banco_relaciones.py --datos … --conjunto val --modelo base --modelo afinado` | P/R/F1 por tipo y predicado, dirección |
| 8 | `sidecar/importar_propuestas.py --anotaciones apartado-sin-pistas.jsonl [--lote N]` | crea en la app un lote con los apartados (o carga propuestas nuevas en uno existente) para que una persona los corrija |
| 9 | `sidecar/oro_apartado.py --lote N {hoja WP\|aplicar spec.json\|estado}` | corrección de oro desde un JSON por artículo (`~/lsv/datos/entrenamiento/oro/<wp>.json`): marca todas las apariciones, valida tipos de cada predicado contra `vocabulario.py`, cierra el artículo |
| 10 | `sidecar/seleccionar_oro.py` | 100 artículos más de oro → `oro100.txt`; 50 de ellos → `prueba.txt`, conjunto de prueba que nunca se entrena |
| 11 | `sidecar/umbrales.py --elegir-en apartado --medir-en prueba`, `sidecar/techo.py`, `sidecar/acuerdo.py` | umbral por predicado elegido sobre oro (y poda de los que no se distinguen); techo del anotador LLM contra el oro; acuerdo entre dos anotadores |
| 12 | `sidecar/consenso.py --a plata-mm.jsonl --b plata-mm-v5.jsonl` | plata de consenso: solo lo que dos anotadores dijeron igual |
| 13 | `sidecar/instalar_modelo.py --desde …/final --umbrales …/umbrales-*.json` | copia el afinado a `<datos de la app>/modelos/legajo-relex` con `umbrales.json`; la app lo usa en cuanto lo ve |
| 14 | `sidecar/generar_vocabulario.py` | reescribe la tabla de predicados en `core/src/extraccion.rs` y `src/contenido/tipos.ts` desde `vocabulario.py` |
| 15 | `sidecar/importar_alias.py --lote N` | identidades curadas de Quién-AI (alias → «misma»; dos perfiles completos distintos → «distinta») a `resoluciones` |
| 16 | `sidecar/juez_alias.py --lote N [--modelo … --url …]` | el juez: decide con los párrafos los pares dudosos que dejan las reglas (`cargo run --bin casos`), o los pospone con la razón |

`primera_corrida.sh v1 seleccion-025.jsonl` encadena 5 → 6 (tres tasas) → 7;
`segunda_corrida.sh v2 plata-mm.jsonl` lo mismo con la plata de MiniMax y evaluación
sobre `apartado`. Las cadenas posteriores (`~/lsv/datos/entrenamiento/cadena*.sh`)
son variantes de la segunda.

Conjuntos que salen de `exportar_patron.py`: `train`, `val` (plata), `apartado`
(30 artículos de oro, lote 7) y `prueba` (50 artículos de oro del lote 8). Los
dos últimos solo se miden; el resto del oro del lote 8 (49 artículos) entrena.

## Convenciones

- Un párrafo es un bloque de `text_plain` separado por `\n\n`; `pi` es su índice,
  `ini`/`fin` son posiciones en caracteres dentro del párrafo. Es la misma
  convención de la app (`core/src/contenido.rs`).
- Nada del apartado entra en la plata: `exportar_patron.py` aborta si lo ve.
- El prompt lleva versión (`PROMPT_VERSION` en `anotar_llm.py`) y cada fila la
  guarda. El piloto y sus lecciones están en `piloto/README.md`.
- Ollama y torch no se solapan: un modelo a la vez en esta máquina.

## Parche local a gliner 0.2.28

`gliner/data_processing/processor.py`, `create_relation_labels`: cuando ningún
ejemplo del lote tiene más de una entidad, la máscara de tramos es `(B, 1)` y el
`squeeze(-1)` original la dejaba en un escalar; el entrenamiento moría a mitad de
época con «Value after * must be an iterable, not int». El parche (comentario
`Legajo: squeeze(-1)` en el fichero) solo quita la cola cuando la máscara es 3-D.
`entrenar.py` comprueba que el parche esté y se niega a arrancar si no; si se
reinstala el entorno hay que volver a aplicarlo (o subir el arreglo aguas arriba).

## Del entrenamiento a la app

La app no elige modelo: usa el afinado si `modelo_afinado()` (core/src/extraccion.rs)
lo encuentra en `<datos de la app>/modelos/legajo-relex`, en `sidecar/modelos/legajo-relex`
(desarrollo) o donde apunte `LEGAJO_MODELOS`; si no, el GLiNER base. Junto a los
pesos va `umbrales.json`: el corte por predicado (y los podados) se manda al sidecar
en cada petición y el corte por tipo sirve de calibración inicial mientras la persona
no haya calibrado el lote. El vocabulario de 35 predicados es el mismo en Python,
Rust y TypeScript, y las pruebas de Rust lo comprueban contra los otros dos ficheros.

## Resolución de identidades

La cola de «¿son la misma entidad?» del grafo sale de `core/src/resolucion.rs`,
con una regla por tipo: una persona solo se propone si un nombre es la forma corta
del otro **en orden** («Carlos Galán» ⊂ «Carlos Fernando Galán») o coinciden apellido
e iniciales; un cargo si es el mismo sin «ex»/«alto»/«entonces»; leyes y montos nunca
por parecido; organizaciones por forma larga/corta. Sobre el lote de oro eso bajó la
cola de 1.928 pares a 936, sin los falsos («Luis Carlos Galán» / «Carlos Fernando Galán»).
Lo que queda lo deciden, en este orden, la grafía (mismo nombre normalizado), el
diccionario de Quién-AI y el juez con LLM; todo cae en `resoluciones` con `fuente` y
`motivo`, el grafo funde lo «misma» venga de donde venga y la pantalla del grafo lo
enseña con un «deshacer».

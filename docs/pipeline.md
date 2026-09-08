# El pipeline

Dos modelos en un solo proceso hijo de Python que habla con la app por
tuberías. No abre puertos ni envía nada a la red: la promesa de que el archivo
no sale del computador se sostiene por construcción, no por confianza.

Fueron tres, y hubo un menú para elegir entre cuatro variantes de uno de ellos.
La sección [«Qué modelo, medido»](#qué-modelo-medido) cuenta cómo se midió y
por qué quedó uno.

## Quién hace qué

**spaCy** (`es_core_news_sm`) tokeniza y segmenta oraciones. No se usa su
reconocedor de entidades —va desactivado, junto al lematizador— porque solo hace
falta la segmentación, y quitarlos ahorra la mitad del tiempo por artículo.
Aporta lo que ningún troceo casero da bien: **cortar por oración y no por número
de palabras**. La versión anterior troceaba en ventanas de N palabras con
solape, y una entidad partida por la mitad no da error: simplemente no aparece.

**GLiNER-relex** (`knowledgator/gliner-relex-multi-v1.0`, sobre mDeBERTa-v3)
extrae **entidades y relaciones en una sola pasada**, las dos de vocabulario
abierto: las etiquetas y los predicados son instrucciones en lenguaje natural,
no clases aprendidas, así que cómo se redacten cambia el resultado. La redacción
vive en `core/src/extraccion.rs` (`ETIQUETAS`, `SENUELOS`, `PREDICADOS`) y se
manda con cada petición.

El modelo corre en el **GPU de la máquina si lo hay** (MPS en Mac, CUDA donde
exista) y si no en la CPU. Lo decide el sidecar al cargar; `LEGAJO_DISPOSITIVO`
lo fuerza.

## Por qué se pide con el umbral más bajo

El extractor pide siempre con el corte más permisivo de todos los tipos y filtra
después. Así las puntuaciones quedan guardadas, y recalibrar es aritmética sobre
lo ya extraído en vez de una segunda pasada del modelo. Es lo que hace que el
antes y el después de la calibración se vean al instante.

## Calibrar, no reentrenar

Los errores que produce el modelo sin ajustar se agrupan por confianza. En una
prueba sobre prosa periodística colombiana:

| lo que devolvió | confianza |
|---|---|
| `Montería` → lugar | 0,96 |
| `Luz Marina Pérez` → persona | 0,99 |
| `Ley 1448 de 2011` → norma | 0,93 |
| `senador` → **persona** | 0,48 |
| `Congreso` → **lugar** | 0,64 |
| `presupuesto` → **monto** | 0,56 |

Los aciertos entre 0,93 y 0,99; los fallos entre 0,37 y 0,64. Eso lo arregla un
corte por tipo, que es gratis e instantáneo. Reentrenar sirve para errores que
persisten con alta confianza, y hasta no ver cuáles quedan no hay forma de saber
si los hay.

Si llega a hacer falta, harían falta unos 80–100 artículos revisados para
entrenar más 30 apartados que nunca entren: entrenar con todo dejaría sin vara
para medir. Corrigiendo pre-anotado son unas dos horas.

Hoy hay **un** artículo revisado, y 60 de sus 61 marcas son propuestas del
modelo que la persona conservó (`auto = 1`). Con eso no se afina nada: no hay
cobertura que medir, porque la persona no añadió lo que el modelo no vio, y la
única señal humana genuina son las 30 propuestas que borró. Afinar queda para
cuando haya el patrón que dice el párrafo anterior; mientras, lo que se puede
mover —y se movió, ver abajo— es qué modelo se usa y cómo se le pide.

## Dónde se iba el tiempo, con los tres modelos

Esta sección describe el pipeline **anterior** —GLiNER para entidades y GLiREL
para relaciones— y se conserva porque la lista de lo que se probó y no
funcionó sigue valiendo, y porque explica por qué hubo que cambiar de modelo y
no de ajustes. Los números vigentes están en [«Qué modelo,
medido»](#qué-modelo-medido).

Medido sobre un perfil real de 39 párrafos y 12.348 tokens, en un Ryzen 7 5700X
de 8 núcleos, torch en CPU:

| | segundos | del total |
|---|---:|---:|
| spaCy, segmentar y tokenizar | 0,27 | 0,8 % |
| GLiNER, entidades | 8,11 | 25,6 % |
| **GLiREL, relaciones** | **23,27** | **73,5 %** |
| | **31,66** | |

Más 16–20 s de carga de los modelos, una vez por corrida.

El coste de GLiREL es **fijo por llamada**, no proporcional al trabajo que hace:
una pasada del transformador por párrafo, medio segundo, independientemente de
cuántas entidades haya dentro. Eso se comprobó por eliminación, y conviene
dejarlo escrito para que nadie vuelva a intentarlo:

| Lo que se probó | Resultado |
|---|---|
| Procesar por lotes (`batch_predict_*`, ambos modelos) | **Peor.** En CPU se rellena hasta la secuencia más larga del lote, y ese relleno cuesta más de lo que se gana. GLiNER: 8,1 s → 11,1 s. GLiREL: 20,8 s → 34,9 s con lotes de 16. |
| Pasarle a GLiREL menos entidades (subir el corte de 0,30 a 0,70) | **Casi nada.** De 2.156 pares a 918 —el 57 % menos— y de 21,0 s a 19,8 s: un 6 %. Los pares no son lo que cuesta. |
| Pedirle menos predicados (13 → 4) | **13 % más rápido y la recuperación se hunde**: de 77 relaciones a 1. No compensa. |
| Más hilos de torch (8 → 16) | **Peor**: 20,1 s → 24,7 s. Con 4 hilos, 28,2 s. Ocho, que son los núcleos físicos, es el óptimo. |
| Agrupar párrafos en una sola llamada | **Sin ganancia** (17–21 s) y cambia lo que devuelve de forma imprevisible: 167 relaciones con uno por llamada, 432 con cinco, 54 con diez, donde ya se desborda la ventana del modelo. |
| Varios procesos a la vez (4 × 2 hilos) | **Peor**: torch ya satura los ocho núcleos con una sola pasada, y cada proceso vuelve a pagar los 20 s de carga. |
| Cuantizar a int8 (`quantize_dynamic`) | **Rompe los modelos.** 6,3× más rápido y **cero** entidades: las puntuaciones se hunden de 0,98 a 0,02 y las etiquetas salen todas iguales. Cuantizar solo el codificador —el 96 % de los parámetros— tampoco sirve: la atención desenredada de DeBERTa no sobrevive. Hay ONNX oficial de GLiNER en `onnx-community/gliner_multi-v2.1`, pero optimizar el 26 % no arregla el 73 %. |
| Modelos de esquema fijo en español (`xlm-roberta-large-ner-spanish`, CAPITEL) | **No aplican.** Son NER, no relaciones, y cubren 3 de los 8 tipos. El de XLM-R es de 560M, más grande que lo que ya hay. |
| mREBEL, entidades y relaciones en una pasada | **Rompería el producto**, no solo el rendimiento. Es generativo: da tripletas, no candidatos con puntuación, y toda la calibración se apoya en pedir con el umbral más bajo y guardar el *score*. Además su vocabulario es Wikidata en inglés: `ocupa el cargo` y `trabaja en` mapean, pero `aliado de`, `opositor de` e `investigado por` no existen ahí. |

### Lo que sí salió, y no era velocidad

Mirando *qué* devolvía GLiREL en vez de cuánto tardaba, resultó que el 63 % era
demostrablemente imposible o repetido, y las reglas para descartarlo ya estaban
escritas —se usaban para filtrar el menú de la persona, pero no lo que devolvía
el modelo:

| | de 397 |
|---|---:|
| Tipos que su propio predicado no admite | 39,3 % |
| Espejos del mismo par | 20,9 % |
| Un extremo que no es ninguna entidad | 3,0 % |
| **Queda** | **36,8 %** |

`Álvaro Leyva —trabaja en→ Bogotá` con 0,85: Bogotá está marcado como lugar y
`trabaja en` está declarado persona → organización. `Santos parte de Partido
Liberal` con 0,88 y `Partido Liberal parte de Santos` con 0,87: GLiREL no está
determinando dirección, está midiendo cercanía, y proponía los dos sentidos de
casi todo.

Desde entonces el vocabulario viaja con sus restricciones y el extractor descarta
lo que vuelve mal unido. Medido sobre los mismos cuatro artículos, con GLiREL:
**420 relaciones → 135**, con las 635 entidades idénticas. Entonces además se le
preguntaban solo los predicados que podían aplicar a los tipos presentes en el
párrafo; con el modelo conjunto eso ya no se puede —las entidades y las
relaciones salen juntas—, así que se piden los trece y el filtro trabaja a la
salida. Los trece predicados son unos pocos tokens más en la petición.

Los espejos, además, se atajan al **guardar** y no solo al extraer: el extractor
no es la única fuente —una persona puede marcar «A aliado de B» y «B aliado de
A» a mano, y esas marcas no pasan por el filtro del extractor—. Los extremos de
una relación simétrica se ordenan antes de escribirlos, de modo que la clave
primaria de la tabla impide el duplicado. Deja de ser una regla que alguien
tiene que acordarse de aplicar.

Un efecto secundario que la restricción de `parte de` destapó: hay pares de
tipos para los que el vocabulario no tiene nada, y antes se devolvían los trece
predicados «para no bloquear a quien anota». Trece opciones de las que ninguna
aplica no es libertad, es ruido, y dejaba cuatro fuera del alcance de las teclas
1—9. Ahora la lista vacía se aprovecha: casi siempre la relación existe al
revés —no hay nada que una un lugar con una persona porque lo que hay es
«persona *ubicado en* lugar»— y la pantalla lo dice en vez de callarse.

El tiempo de máquina no tenía mucha holgura. El de la persona, que es el
escaso, sí: **tres veces menos que revisar**.

Conclusión: en CPU, esto cuesta lo que cuesta. La palanca que sí existe es
**apagar las relaciones para una primera pasada** —de 32 s a 8 s por artículo— y
volver después, que retoma sin repetir. La otra es tener paciencia con un número
a la vista: la pantalla de extracción dice cuánto falta en minutos, no solo un
porcentaje.

## Qué modelo, medido

La pregunta era cuál de los cuatro GLiNER del menú usar, y si convenía afinar
uno. Se respondió midiendo, con `sidecar/banco.py`, que corre **la misma ruta
de código que la app** sobre artículos reales del archivo —los doce de
calibración del lote, 38.333 palabras— y deja cada entidad y relación en un
JSON para comparar corridas sin repetirlas. Máquina: Apple M5 Pro, 24 GB.

### Primero, el dispositivo

El pipeline de tres modelos, tal cual estaba, en CPU y en el GPU de la máquina:

| | CPU | MPS | |
|---|---:|---:|---|
| 12 artículos, entidades + relaciones | 392 s | **129 s** | 3,0× |
| Mediana por 1.000 palabras | 6,0 s | **2,1 s** | |
| Entidades / relaciones devueltas | 3.124 / 1.464 | 3.124 / 1.464 | idénticas |

En MPS la **primera pasada con cada longitud de secuencia nueva paga un
calentamiento**: 212 ms frente a 13 ms la segunda vez con el mismo párrafo. Sobre
doce artículos eso disfraza la ganancia (la primera vuelta dio casi lo mismo que
la CPU); sobre un archivo entero se amortiza a nada, porque el extractor es un
solo proceso de larga vida y las longitudes posibles son finitas. El banco mide
por eso la **segunda vuelta**. fp16 daba un 10 % más y cambiaba tres entidades
de tres mil: no compensa perder que dos corridas sean comparables.

### Después, el modelo

Los candidatos, en MPS, segunda vuelta, sobre los once artículos que no son el
patológico (ver abajo):

| | s | s / 1k pal | hace | vocabulario de relaciones (≥0,3) |
|---|---:|---:|---|---|
| `gliner_multi-v2.1` + GLiREL (el de antes) | 63 | 2,07 | ent. + rel. | `parte de` 790, `ubicado en` 429, `trabaja en` 59… **`ocupa el cargo` 0, `aliado de` 1, `opositor de` 1, `aspira a` 1** |
| `gliner_multi-v2.1` solo | 28 | 0,90 | entidades | — |
| `gliner-multitask-large-v0.5` | 46 | 1,43 | entidades | — (codificador en inglés) |
| **`gliner-relex-multi-v1.0`** | **37** | **1,17** | **ent. + rel.** | `ocupa el cargo` 176, `opositor de` 194, `aliado de` 142, `aspira a` 57, `trabaja en` 222, `citado en` 265… |
| **`gliner-relex-multi-v1.0` con la redacción G** (lo que quedó) | **44** | **1,38** | **ent. + rel.** | `ocupa el cargo` 108, `opositor de` 57, `aliado de` 55, `aspira a` 25, `trabaja en` 167, `citado en` 148… |
| `gliner-x-base` / `-large` | — | — | — | no aplican: devuelven entidades sin posición en el texto, y necesitan `stanza` |

La configuración final —redacción G, con su señuelo— cuesta un 20 % más que la
original porque pide nueve etiquetas en vez de ocho, y devuelve menos relaciones
porque devuelve menos entidades falsas que las sostengan. Frente a lo que la app
corría antes de esto —los tres modelos en CPU, unos 6 s por 1.000 palabras en
esta misma máquina— son **4,4 veces menos tiempo con las relaciones incluidas**.

El conjunto hace entidades **y** relaciones en menos tiempo del que GLiREL
tardaba solo en las relaciones, y devuelve el vocabulario que un grafo de poder
necesita, del que GLiREL devolvía uno o ninguno por lote. Eso no era un ajuste
de umbral: GLiREL encontraba `ocupa el cargo` cero veces porque `gliner_multi`
encontraba 38 cargos en once artículos, y el conjunto encuentra 258.

El artículo **patológico** (`32190`) tiene 4.703 «párrafos» de una línea —una
transcripción— y tarda 66 s solo, 8 s por 1.000 palabras: el coste es por
llamada, no por texto. Es un problema de limpieza del contenido, no del modelo,
y queda anotado.

### Y después, cómo se le pide

La redacción de las etiquetas es un parámetro. La original —«persona»,
«lugar», «cargo o rol»— hacía que el conjunto devolviera **544 nombres comunes
con confianza ≥0,9** en once artículos («país», «indígenas», «libro», «niños»), y
a esa confianza un umbral ya no los separa de nada. Se probaron siete
redacciones (`--redaccion A…G`) sobre los mismos artículos, contando cuántas
entidades de los seis tipos que llevan mayúscula venían en minúscula total
(`banco_genericos.py`, ≥0,5):

| redacción | minúscula total | de ellas con ≥0,9 | relaciones ≥0,5 |
|---|---:|---:|---:|
| A · la original | 53 % | 544 | 1.323 |
| B · «nombre de …» | 48 % | 168 | 1.303 |
| C · descriptiva | 47 % | 272 | 1.068 |
| D · en inglés | 51 % | 447 | 1.280 |
| E · la mejor de cada tipo | 42 % | 92 | 1.108 |
| F · E + dos señuelos | 20 % | 36 | 763 |
| **G · E + señuelo de grupos** | **27 %** | **44** | **870** |

Dos cosas salieron de ahí. Una, que ninguna redacción arregla **`evento`**: el
90 % de lo que devuelve es nombre común en las siete, lo que confirma lo que
`plan-anotacion.md` ya había decidido sobre retirarlo. Otra, el **señuelo**: un
nombre de grupo —«indígenas», «niños», «empresarios»— acaba en persona o en
organización según a cuál se le abra más la puerta, porque el modelo le da a
cada tramo la etiqueta que mejor le cuadre de las que hay. Pedirle además «grupo
genérico de personas» y tirar lo que caiga ahí bajó los falsos de persona de 392
a 77. El segundo señuelo de F, «sustantivo común», se llevaba también cosas
reales —las relaciones cayeron un 30 %—, así que quedó G.

Una regla de mayúsculas como filtro **se probó y se descartó**: en el único
artículo revisado, la persona conservó 21 marcas en minúscula («gobierno»,
«mezquitas», «transición») y borró 23. Quitaría casi tanto bueno como malo, y
decide por la persona algo que la guía de anotación tiene que decidir antes.

### Y tres reglas a la salida, que salieron de mirar un artículo real

Una entrevista de la Silla Académica, con el modelo ya elegido y la redacción G.
Lo que sobraba no era uniforme, y solo una parte lo iba a arreglar la
calibración:

| lo que sobraba | confianza | qué lo arregla |
|---|---|---|
| «huelga», «paro», «posiciones», «uno», «mí» | ≤ 0,66 | el corte por tipo, al calibrar |
| «Adriana Camacho» ×23, «La Silla Académica» ×8 | 1,00 | **las etiquetas de hablante**: «Nombre: » al principio de dos o más párrafos se salta antes de extraer. Es quién habla, no de qué se habla; y de ahí salían casi todas las relaciones absurdas («Adriana Camacho trabaja en sindicato»). |
| «salarios», «plata», «chequeras» como monto | 0,7–0,88 | **un monto lleva cifra**: sin dígito ni «mil», «millones», «por ciento»… no es una cantidad |
| «Usted», «Yo», «tu» como persona | 0,8–0,85 | **un pronombre no es una persona**: lista cerrada, ninguno es jamás un nombre |

Medido sobre los once artículos: la entrevista pasa de 189 menciones a 144, las
relaciones de 46 a 25 —se van exactamente las que colgaban del nombre de la
entrevistada—, y en total 870 → 695 relaciones con `ocupa el cargo` intacto
(85 → 85). Se probó también resolver los pronombres y los roles sueltos
(«dueño», «trabajador») con dos señuelos más (redacción H): no atrapó un solo
pronombre y se llevó cargos reales, 154 → 108. Descartado. Los roles sueltos
quedan para la calibración y la revisión: «dueño» a 0,97 es una designación
—alguien concreto sin nombre—, que es justo lo que la guía de anotación pide
marcar como cargo.

### Lo que esto no mide

Precisión. El único artículo con marcas humanas se anotó **sobre propuestas del
modelo** —60 de 61 con `auto = 1`, del `multitask` del menú, como se dedujo al
ver que lo reproducía al 98 %—, así que compararse con él mide parecido con
aquella corrida, no acierto. La señal humana genuina son las 30 propuestas que
la persona borró, y ahí G repite 5 de 31 frente a 8 del pipeline anterior
(`banco_oro.py`). Para lo demás se recurrió a un modelo instruido local como
**juez de plata** sobre las discrepancias entre corridas (`banco_juez.py`,
Qwen 27B por Ollama, 150 al azar por lado, umbral 0,5): se le enseña el párrafo
y el tramo y dice si es una entidad de ese tipo. Solo se le preguntan las
discrepancias, porque lo que los dos modelos coinciden en marcar no distingue
entre ellos.

| de lo que solo encuentra… | válido según el juez |
|---|---:|
| el pipeline anterior (frente a relex-A) | 25 % |
| relex con la redacción original A | **8 %** |
| el pipeline anterior (frente a relex-G) | 21 % |
| relex con la redacción G | **18 %** |

Dos lecturas. Con la redacción original, lo que relex añadía era ruido casi
todo; la redacción G lo puso a la par del pipeline anterior en lo que cada uno
encuentra por su cuenta. Y que los dos anden por el 20 % dice que **lo que vale
es lo que ambos encuentran** —el 61 % de acuerdo—, y que lo exclusivo de cada
uno es mayormente nombre común. Donde G pierde algo real es en lugares: de los
41 lugares que solo veía el pipeline anterior, 21 eran válidos. Es el precio de
pedir «nombre propio de lugar».

Los veredictos están en `sidecar/banco/juez-*.json` y son para ordenar
candidatos, no para publicar una cifra: el juez dijo «no» a «LSA» como
organización sin saber que es La Silla Académica. La cifra de verdad la darán
los 60 artículos revisados del plan.

## Fallos de terceros que hubo que sortear

- **`gliner-x` devuelve entidades sin posición** (`start = None`) con el
  segmentador de `stanza` que exige, así que no se puede alinear con el
  párrafo. Se descartó por eso, no por calidad.
- **Los `gliner` del menú no guardaban con qué se hizo cada corrida**, y las
  corridas de dos variantes no son comparables entre sí: doce tipos y
  cincuenta puntuaciones distintas sobre los mismos tramos. Con un solo modelo
  el problema desaparece.

De la época de GLiREL: importaba `loguru` sin declararlo, su `_from_pretrained`
exigía argumentos que `huggingface_hub` ya no pasa, y spaCy no admite los
solapes que GLiNER devuelve, que había que resolver antes de alinear a tokens.
Ninguno hace falta ya.

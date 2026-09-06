# El pipeline

Tres modelos que se reparten el trabajo, en un solo proceso hijo de Python que
habla con la app por tuberías. No abre puertos ni envía nada a la red: la
promesa de que el archivo no sale del computador se sostiene por construcción,
no por confianza.

## Quién hace qué

**spaCy** (`es_core_news_sm` por defecto) tokeniza y segmenta oraciones. No se
usa su reconocedor de entidades —va desactivado, junto al lematizador— porque
solo hace falta la segmentación, y quitarlos ahorra la mitad del tiempo por
artículo.

Aporta dos cosas que ningún troceo casero da bien:

- **Cortar por oración y no por número de palabras.** La versión anterior
  troceaba en ventanas de N palabras con solape, y una entidad partida por la
  mitad no da error: simplemente no aparece. Cortar por oración elimina esa
  clase de fallo.
- **Alinear a límites de token.** GLiNER devuelve desplazamientos de carácter
  que no siempre caen donde spaCy corta; GLiREL, en cambio, trabaja con índices
  de token. spaCy es el puente entre ambos, y hacerlo a mano con expresiones
  regulares sería frágil en español.

**GLiNER** extrae entidades de vocabulario abierto. Las etiquetas son
instrucciones en lenguaje natural, no clases aprendidas, así que cómo se
redacten cambia el resultado. Se puede elegir entre cuatro variantes, incluida
la de bi-encoder, que codifica las etiquetas aparte y sale a cuenta cuando hay
muchas.

**GLiREL** extrae relaciones sobre las entidades ya encontradas, también de
vocabulario abierto. Cuesta el 73 % del cómputo de toda la extracción —ver
abajo—. Sin él hay entidades pero no grafo: solo un índice de nombres.

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

## Dónde se va el tiempo

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

Ahora el vocabulario viaja con sus restricciones, el extractor pregunta solo los
predicados que pueden aplicar a los tipos presentes en cada párrafo, y descarta
lo que vuelve mal unido. Medido sobre los mismos cuatro artículos: **420
relaciones → 135**, con las 635 entidades idénticas. De paso, un 18 % más
rápido, porque preguntar ocho predicados en vez de trece también cuesta menos.

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

## Fallos de terceros que hubo que sortear

- **GLiREL 1.2.1 importa `loguru` sin declararlo** entre sus dependencias.
- **Su `_from_pretrained` exige `proxies` y `resume_download`**, argumentos que
  las versiones nuevas de `huggingface_hub` ya no le pasan. Se llama
  directamente con los valores por defecto en vez de esperar una actualización.
- **spaCy no admite entidades solapadas** en `doc.ents`, y GLiNER sí las
  devuelve. Antes de pasárselas a GLiREL se resuelve el solape quedándose con la
  más larga.

Ninguno de los tres impide extraer entidades si falla: GLiREL cae con aviso y el
pipeline sigue sin relaciones.

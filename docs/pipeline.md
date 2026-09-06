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
vocabulario abierto. Casi duplica el tiempo por artículo. Sin él hay entidades
pero no grafo: solo un índice de nombres.

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

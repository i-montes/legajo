# Qué hacer con el paso de anotación

Escrito después de anotar 22 artículos reales, y a raíz de una objeción certera:
si esto solo sirve para comparar contra el modelo, ¿por qué anotar 400?

## Lo que dicen los datos

Sobre 22 artículos anotados, la densidad por tipo determina cuántos artículos
hacen falta para estimar la precisión de ese tipo con un margen utilizable:

| tipo | por artículo | artículos para ±0,05 | para ±0,10 |
|---|---|---|---|
| persona | 13,6 | 15 | 4 |
| organización | 13,5 | 15 | 4 |
| cargo | 3,7 | 55 | 14 |
| lugar | 3,2 | 62 | 16 |
| monto | 1,3 | 158 | 40 |
| ley | 1,2 | 170 | 43 |
| evento | 0,1 | 2.200 | 550 |
| **cifra global** | 36,6 | **6** | 2 |

**El tamaño lo fija el tipo más raro que importe, no el tamaño del archivo.**
400 nunca estuvo justificado. Diez tampoco alcanzan salvo para las dos grandes.

Y hay una segunda restricción que no depende de los tipos: **la mediana de
tiempo**. Con diez mediciones un artículo raro la desplaza entera; hacen falta
unas cuarenta para que se estabilice. Como la mediana es la cifra que decide si
el proyecto sigue, es ella la que manda.

## Decisión: 60 artículos

Cubre persona, organización, cargo y lugar con ±0,05 — los cuatro tipos que
sostienen un grafo de poder. Deja monto y ley con ±0,08, suficiente para saber
si sirven. Y da sesenta mediciones de tiempo, que es holgado para la mediana.

Al ritmo actual son unas 3,5 horas de trabajo. Frente a las ~4.900 horas que
proyecta la curación del archivo completo, es medio por ciento: la proporción
correcta entre medir y hacer.

**`evento` sale de la ontología.** A 0,1 por artículo no es medible ni con dos
mil, y las dos marcas existentes son oraciones narrativas, no sucesos con
nombre. O el tipo es demasiado raro o está mal definido; en cualquiera de los
dos casos no puede sostener una cifra.

## Lo que las anotaciones hacen además de medir

Tres usos que no son evaluación y que sobreviven al paso:

### Gazetteer

Las entidades marcadas son un diccionario. El extractor lo consulta para cazar
lo que el modelo se pierde, y mejora el grafo directamente. Es la salida más
duradera del paso: sobrevive al modelo que se acabe usando.

### Ejemplos para un extractor con LLM

GLiNER es de vocabulario abierto pero no acepta ejemplos: solo etiquetas. Un
modelo instruido —hay uno instalado en esta máquina— sí, y darle tres artículos
ya anotados **de la misma sección** como contexto es previsiblemente mejor que
una etiqueta genérica. Las secciones de un medio tienen convenciones propias, y
eso es justo lo que un ejemplo transmite y una etiqueta no.

Se convierte además en una comparación que el reporte puede hacer: GLiNER en CPU
frente a LLM con ejemplos, con su coste de cómputo al lado.

### Ajuste de las etiquetas

GLiNER cambia bastante según cómo se redacte la etiqueta. Con el patrón de oro
se pueden probar tres redacciones por tipo sobre los mismos artículos y quedarse
con la mejor. Estaba en el plan de la fase y no se implementó.

## Plan

| # | Qué | Por qué ahora |
|---|---|---|
| 1 | Bajar la muestra activa a 60, conservando lo ya anotado | 400 no está justificado por ningún número |
| 2 | Retirar `evento` de la ontología | No es medible y produce marcas malas |
| 3 | Que el paso 4 justifique el tamaño: una tabla que diga qué compra cada cifra | Hoy es un deslizador con 400 por defecto y ninguna razón |
| 4 | Exportar el gazetteer y usarlo en la extracción | Convierte la anotación en mejora directa del grafo |
| 5 | Extractor con LLM y ejemplos por sección, comparado con GLiNER | La idea del few-shot, y hay modelo local disponible |
| 6 | Barrido de redacciones de etiqueta sobre el patrón | Barato y estaba pendiente del plan original |

Los puntos 1 a 3 son de esta tanda. El 4 desbloquea valor permanente. El 5 y el
6 son del paso 6 y se hacen cuando haya patrón suficiente — con 40 artículos ya
se puede empezar a comparar.

## Lo que esto no cambia

La medición de tiempo sigue siendo el resultado que decide si el proyecto
avanza, y no depende del modelo: incluso con extracción perfecta, alguien tiene
que revisar lo propuesto, y eso cuesta horas de redacción que hay que tener.

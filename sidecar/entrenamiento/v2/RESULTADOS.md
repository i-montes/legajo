# Segunda vuelta (2026-09-10): selección completa anotada por MiniMax-M3

## Qué cambió respecto a v1

| | v1 | v2 |
|---|---|---|
| Anotador | gpt-oss-20b local, 9 s/párrafo | MiniMax-M3 por API sin razonamiento, 3,5 s/párrafo secuencial, 4 hilos → 1,4 h para todo |
| Plata | 968 párrafos (un cuarto de la selección) | 3.921 párrafos (la selección completa, 3.975 menos inválidos) |
| Oro | 679 párrafos (12 artículos de calibración) | 1.071 (los mismos + 392 del apartado, que **no** entrena) |
| Ejemplos train / val / apartado | 1.587 / 60 / — | 4.352 / 248 / 392 |
| Relaciones positivas | 2.386 | 13.717 |
| Épocas | 4 | 3 |
| Limpieza nueva | — | menciones repetidas marcadas; solapes del mismo tipo se resuelven al tramo largo (627 → 198 relaciones perdidas) |

Piloto MiniMax-M3 vs gpt-oss en los 30 párrafos familiares (con pistas):
pistas recuperadas 98 % vs 89 %, familiares con el mismo predicado 92 % vs 81 %,
0 inválidos. El modo con razonamiento: 69 s/párrafo y 5 inválidos de 28; descartado.

Acuerdo entre los dos anotadores en los 649 párrafos comunes (misma limpieza):
entidades F1 0,78 (persona 0,92, organización 0,71, lugar 0,67, cargo 0,57,
obra 0,21), relaciones 0,41 (cónyuge 0,83, hermano 0,70, hijo 0,69,
ocupa el cargo 0,43, parte de 0,18, ubicado en 0,03). Discrepancias en
`~/lsv/datos/entrenamiento/discrepancias.jsonl` (626 párrafos).

## Sobre el apartado (392 párrafos, oro), umbral de entidad 0,5

| F1 | base | v1 lr 1e-5 | v2 lr 1e-5 | **v2 lr 2e-5** |
|---|---|---|---|---|
| persona | 0,89 | 0,93 | 0,95 | 0,97 |
| organización | 0,78 | 0,75 | 0,86 | 0,87 |
| lugar | 0,45 | 0,78 | 0,87 | 0,88 |
| cargo | 0,52 | 0,75 | 0,78 | 0,78 |
| **ENTIDADES** | **0,75** | 0,79 | 0,85 | **0,86** |
| ocupa el cargo | 0,43 | 0,72 | 0,70 | 0,67 |
| miembro de | 0,17 | 0,20 | 0,33 | 0,40 |
| dirige | 0,22 | 0,14 | 0,32 | 0,41 |
| opositor de | 0,12 | 0,27 | 0,47 | 0,63 |
| **RELACIONES, umbral 0,5** | **0,21** (P 0,15 R 0,37) | 0,26 | 0,29 | **0,34** (P 0,22 R 0,71) |
| **RELACIONES, umbral 0,7** | 0,24 (P 0,26 R 0,23) | 0,33 | 0,41 | **0,47** (P 0,70 R 0,35) |

En val (248 párrafos de plata): entidades 0,74 → 0,82; relaciones 0,19 → 0,35.

## Lectura

- Cuatro veces más plata mueve entidades de 0,79 a 0,86 y, por primera vez,
  organización (0,78 → 0,87). Persona 0,97 y lugar 0,88 superan el criterio
  del plan (P ≥ 0,80, R ≥ 0,85).
- Relaciones: el recuerdo a 0,5 es 0,71; la precisión sigue siendo el freno
  (0,22). Subiendo el umbral a 0,7 la precisión llega a 0,70 con recuerdo 0,35
  y F1 0,47: es el punto de operación razonable para la app, y el umbral
  correcto es distinto por predicado (ocupa el cargo 0,89/0,59 a 0,7).
- La mayor fuente de falsos positivos es de convención, no de modelo: el LLM
  dice «parte de» donde el oro dice «miembro de» (921 veces), «se reunió con»
  para cualquier encuentro, «ubicado en» para «de Popayán». La v3 normaliza
  «parte de» persona→organización a «miembro de» en la exportación.
- lr 2e-5 gana a 1e-5 con más datos; con 3 épocas la pérdida de validación
  sigue bajando (27,1 → 24,3 en lr 1e-5): probablemente cabe una cuarta.

## Ficheros

`evaluacion-val.json`, `evaluacion-apartado.json` (base, lr1e-5, lr2e-5),
`evaluacion-apartado-lr2e-5-u07.json`, `informe.json`, `lr*/metrics.jsonl`,
`../v2-corrida.log`. Modelo recomendado hasta ahora: `lr2e-5/final`.

## Vuelta 3: misma plata con «parte de» persona→organización normalizado a «miembro de»

| apartado | v2 lr 1e-5 | v2 lr 2e-5 | v3 lr 1e-5 | v3 lr 2e-5 |
|---|---|---|---|---|
| ENTIDADES F1 | 0,85 | 0,86 | 0,83 | **0,87** |
| RELACIONES F1, umbral 0,5 | 0,29 | **0,34** | 0,23 | 0,31 |
| RELACIONES F1, umbral 0,7 | 0,41 | **0,47** (P 0,70) | 0,32 | 0,45 (P 0,62) |
| miembro de, umbral 0,5 | 0,33 | 0,40 | 0,25 (R 0,92) | — |

La normalización no ayuda: «miembro de» pasa a tener recuerdo 0,92 y precisión
0,14, porque el LLM marca afiliación partidista («el liberal X» + «Partido
Liberal» en el párrafo) mucho más a menudo que el oro, que solo la marca cuando
el texto la afirma. El problema es de criterio de anotación y se corrige en el
prompt, no en la exportación. Las diferencias entre lr 1e-5 y 2e-5 dentro de
una misma plata (0,05) son del orden de la varianza entre semillas (medida
aparte). Umbrales por predicado elegidos en val (248) sobre v3 lr 2e-5: 0,37,
entre el global 0,5 (0,28) y el global 0,7 (0,44): val sigue siendo chico para
afinar 30 umbrales.

Modelo de referencia: `v2/lr2e-5/final`.

## Varianza entre semillas (v2 lr 2e-5, semilla 42 vs 7)

| apartado | semilla 42 | semilla 7 |
|---|---|---|
| ENTIDADES F1 | 0,86 | 0,88 |
| RELACIONES, umbral 0,5 | 0,34 | 0,28 |
| RELACIONES, umbral 0,7 | 0,47 (P 0,70) | 0,45 (P 0,56) |

Diferencias de hasta 0,06 en relaciones a umbral 0,5 con datos idénticos: a
ese nivel, ninguna de las comparaciones lr 1e-5 / 2e-5 / normalización es
concluyente por sí sola. Lo que sí es robusto: entidades 0,86–0,88 y
relaciones 0,45–0,47 a umbral 0,7 en las cuatro corridas con la plata completa,
frente a 0,75 / 0,24 del modelo base.

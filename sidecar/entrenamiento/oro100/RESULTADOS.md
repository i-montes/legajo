# Tercera vuelta: 99 artículos más de oro (lote 8)

Fecha: 2026-09-10. Datos: `~/lsv/datos/entrenamiento/plata-mm.jsonl` (MiniMax-M3,
prompt v4, 3.921 párrafos) + todo el oro de la app. El lote 8 «Oro · 100» aporta 99
artículos corregidos: 50 (`prueba.txt`) forman el conjunto `prueba`, que nunca se
entrena; los otros 49 entran a train. Export: train 5.062 (plata 3.673 · oro 1.389),
val 248, apartado 392, prueba 711 párrafos. Afinado lr 2e-5, 3 épocas, lote 8,
embeddings congelados; ~26 min por semilla (0,8 s/paso).

## Resultados (P/R/F1)

Columna «v2» = `v2/lr2e-5/final` (segunda vuelta, sin el oro nuevo); «s42»/«s7» =
`oro100/lr2e-5-s42|s7/final`.

| conjunto · umbral rel. | métrica | v2 | s42 | s7 |
|---|---|---|---|---|
| apartado · 0,5 | entidades | 0.81/0.93/**0.86** | 0.80/0.94/**0.87** | 0.80/0.93/**0.86** |
| apartado · 0,5 | relaciones | 0.22/0.71/**0.34** | 0.16/0.79/**0.26** | 0.15/0.75/**0.26** |
| apartado · 0,7 | relaciones | 0.70/0.35/**0.47** | 0.51/0.39/**0.44** | 0.59/0.41/**0.48** |
| prueba · 0,5 | entidades | 0.77/0.90/**0.83** | 0.76/0.92/**0.84** | 0.77/0.91/**0.83** |
| prueba · 0,5 | relaciones | 0.20/0.66/**0.31** | 0.14/0.70/**0.23** | 0.14/0.73/**0.24** |
| prueba · 0,7 | relaciones | 0.62/0.33/**0.43** | 0.46/0.37/**0.41** | 0.52/0.37/**0.43** |

Umbrales por predicado (elegidos en val, s42) sobre apartado: relaciones 0.27/0.56/0.36,
entidades por tipo 0.86/0.87/0.87. No superan el umbral global 0,7.

Techo del anotador (MiniMax v5 sin pistas contra el oro): apartado entidades 0,85 /
relaciones 0,47; prueba entidades 0,86 / relaciones **0,53** (P 0,56 R 0,50).

## Lectura

- Sumar 49 artículos de oro al train (27 % de los ejemplos) **no movió** ni entidades
  ni relaciones: la plata sigue mandando y el alumno queda en 0,43–0,48 con umbral 0,7,
  por debajo del techo del anotador en prueba (0,53).
- El problema es de precisión, y siempre en los mismos predicados: «miembro de»
  (P 0,15), «parte de» (0,04), «ubicado en» (0,03), «investigado por» (0,09–0,14),
  «citado en». Son justo los que el prompt v4 anota con manga ancha y el oro no.
  La regla 12 del prompt v5 los restringe; por eso la plata v5 (en curso) es la
  apuesta principal, no más oro en el train.
- Los dos conjuntos de medida coinciden (apartado 0,47 · prueba 0,43 para v2), así que
  la prueba de 50 artículos sirve como medida limpia de aquí en adelante.
- Entre semillas la diferencia sigue siendo de hasta 0,04 F1.

## Variantes

| conjunto · umbral rel. | métrica | oro100 s42 | oro ×3 en train (`oro100-x3`) |
|---|---|---|---|
| prueba · 0,5 | entidades | 0.76/0.92/0.84 | 0.79/0.93/**0.85** |
| prueba · 0,7 | relaciones | 0.46/0.37/0.41 | 0.40/0.41/**0.40** |
| apartado · 0,5 | entidades | 0.80/0.94/0.87 | 0.82/0.95/**0.88** |
| apartado · 0,7 | relaciones | 0.51/0.39/0.44 | ver `evaluacion-apartado-x3-0.7.json` |

Pesar el oro ×3 sube una centésima las entidades y no toca las relaciones (con umbral
por predicado elegido en apartado: 0,44 en prueba, y se podan «aliado de», «opositor de»
y «parte de»). El
entrenamiento solo con oro desde cero (`solo-oro`, 6 épocas) se paró: los párrafos de
oro tienen muchas más menciones (todas las apariciones marcadas) y el paso en MPS
tardaba 7 s en vez de 0,8; queda para cuando la GPU esté libre, y en su lugar se
prueba el currículo plata → oro (`cadena13.sh`). La plata v5 está en `v5/RESULTADOS.md`;
la plata de consenso v4 ∩ v5 (`sidecar/consenso.py`) en `consenso/`.

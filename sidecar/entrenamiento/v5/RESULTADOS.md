# Cuarta vuelta: plata con el prompt v5 (reglas estrictas)

Fecha: 2026-09-10. La selección completa reanotada por MiniMax-M3 con el prompt v5
(regla 12: «miembro de» solo con pertenencia explícita, «se reunió con» solo con
reunión narrada, «ubicado en» solo con sede o lugar afirmado) →
`~/lsv/datos/entrenamiento/plata-mm-v5.jsonl`, 3.975 párrafos, 2,8 s/párrafo a
1–2 hilos (la cuota de MiniMax limita por ventana, no por total). Oro: el mismo que en
la tercera vuelta (lote 8 incluido). Export: train 5.063 (plata 3.919 · oro 2.493),
val 246, apartado 392, prueba 711.

## v4 contra v5 (`acuerdo.py`)

Entidades: acuerdo F1 0,86 (persona 0,93, organización 0,84, cargo 0,80, lugar 0,73).
Relaciones: v4 11.022 · v5 10.296 · ambas 5.968 · acuerdo F1 **0,56**. Donde más
difieren: «ubicado en» 0,20, «miembro de» 0,32, «parte de» 0,34, «criticó a» 0,35,
«se reunió con» 0,42. Es decir, la regla 12 cambió justo lo que quería cambiar.

## Resultados (P/R/F1, umbral de entidades 0,5)

Columna «v2» = `v2/lr2e-5/final` (plata v4 sin el oro nuevo); «s42»/«s7» = `v5/lr2e-5-s42|s7/final`.

| conjunto · umbral rel. | métrica | v2 | s42 | s7 |
|---|---|---|---|---|
| prueba · 0,5 | entidades | 0.77/0.90/**0.83** | 0.76/0.92/**0.84** | 0.77/0.92/**0.83** |
| prueba · 0,5 | relaciones | 0.20/0.66/**0.31** | 0.17/0.72/**0.28** | 0.15/0.70/**0.24** |
| prueba · 0,7 | relaciones | 0.62/0.33/**0.43** | 0.59/0.34/**0.43** | 0.47/0.36/**0.41** |
| apartado · 0,5 | entidades | 0.81/0.93/**0.86** | 0.80/0.95/**0.87** | 0.80/0.94/**0.87** |
| apartado · 0,5 | relaciones | 0.22/0.71/**0.34** | 0.18/0.75/**0.29** | 0.17/0.77/**0.27** |
| apartado · 0,7 | relaciones | 0.70/0.35/**0.47** | 0.69/0.38/**0.49** | 0.59/0.39/**0.47** |

Techo del anotador v5 sin pistas: apartado 0,85 / **0,47**; prueba 0,86 / **0,53**.

## Lectura

- La plata v5 tampoco mueve al alumno: sigue en 0,41–0,49 con umbral 0,7, igual que
  con la plata v4 y que con más oro en train. Tres palancas distintas (más oro, oro
  ×3 en cola, plata estricta) dan el mismo número, así que el cuello ya no está en
  la etiqueta de la plata.
- La forma del error es siempre la misma: con umbral 0,5 el modelo propone
  «miembro de», «parte de», «ubicado en», «se reunió con», «citado en» para casi
  cualquier par (precisión 0,01–0,15) y con 0,7 se queda casi solo con «ocupa el
  cargo» (P 0,85–0,91). Un umbral global no sirve para 35 predicados con
  calibraciones tan distintas; el paso siguiente es el umbral por predicado elegido
  sobre oro (apartado) y medido en prueba, y podar en inferencia los predicados que
  el modelo no distingue (ver `umbrales-oro.log`).
- Con entidades a 0,83–0,87 el tope de relaciones es ~0,72 (los dos extremos deben
  acertar), así que el otro frente es la precisión de entidades: organización (P 0,76)
  y cargo (P 0,76) son las que más arrastran, y obra/ley/monto siguen flojas por
  pocos ejemplos.

## Umbral por predicado elegido sobre oro (`umbrales.py --elegir-en apartado --medir-en prueba`)

| modelo | global 0,5 | global 0,7 | global 0,8 | por predicado, resto 0,7 | podados (F1<0,2), resto 0,8 |
|---|---|---|---|---|---|
| v2 lr2e-5 | 0.19/0.64/0.29 | 0.61/0.32/0.42 | 0.91/0.12/0.21 | 0.37/0.54/**0.44** | — |
| v5 s42 | 0.16/0.70/0.26 | 0.58/0.33/0.42 | 0.88/0.13/0.23 | 0.45/0.47/**0.46** | 0.49/0.45/**0.47** |

Entidades con umbral por tipo: 0,85–0,86 (frente a 0,83–0,84 con 0,5 global). El único
predicado que no se distingue ni con su mejor umbral es «parte de». Los umbrales quedan
en `v5/umbrales-lr2e-5-s42-apartado.json`; ganan ~0,04 F1 sobre el 0,7 global y son
lo que la app debería aplicar en vez de un umbral único.

## Currículo plata → oro (`solo-oro/curriculo-lr1e-5-e2`)

El modelo v5 s42 sigue afinándose solo con los 1.389 párrafos de oro, dos épocas a
lr 1e-5 (cuatro minutos). Es la primera variante que mueve las relaciones:

| conjunto · umbral rel. | métrica | v5 s42 | currículo |
|---|---|---|---|
| prueba · 0,5 | entidades | 0.76/0.92/0.84 | 0.77/0.95/**0.85** |
| prueba · 0,7 | relaciones | 0.59/0.34/0.43 | 0.47/0.49/**0.48** |
| apartado · 0,5 | entidades | 0.80/0.95/0.87 | 0.81/0.96/**0.88** |
| apartado · 0,7 | relaciones | 0.69/0.38/0.49 | 0.53/0.52/**0.52** |

Con umbral por predicado elegido en apartado y podando lo que no distingue (aliado de,
contrató a, fundó, parte de), resto 0,8: prueba 0.48/0.50/**0.49**. La ganancia viene
de la cobertura (R 0,34 → 0,49) sin perder tanta precisión como bajar el umbral global.
Es el modelo instalado en la app desde el 2026-09-10 por la noche
(`sidecar/instalar_modelo.py --desde solo-oro/curriculo-lr1e-5-e2/final --umbral-rel 0.8`).
Queda por probar: otra semilla, 3 épocas, y el currículo sobre el modelo de consenso.

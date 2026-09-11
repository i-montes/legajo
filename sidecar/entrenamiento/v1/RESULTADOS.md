# Primeros resultados: afinado v1 (2026-09-10)

Primera vuelta completa del plan (`docs/plan-entrenamiento.md`) sobre un cuarto
de la selección. Todo en la Mac, sin nada externo.

## Datos

| | |
|---|---|
| Plata | 994 párrafos de `seleccion-025.jsonl`, anotados por gpt-oss:20b (`low`, prompt v3, con pistas de Quién-AI): 3,4 h, 9,2 s por párrafo de mediana, 0 inválidos tras la repetición |
| Oro | 679 párrafos de los 12 artículos de calibración ya revisados en la app (solo el lote más reciente; antes entraban cuatro copias) |
| Entrenamiento / validación | 1.587 / 60 ejemplos (la validación es plata de estratos F 21, PL 21, J 6, R 6, E 4, A 1, N 1) |
| Relaciones positivas | 2.386; las cinco más frecuentes: ocupa el cargo 595, parte de 298, ubicado en 175, familiar de 174, cónyuge o pareja de 170. Doce predicados con menos de 10 ejemplos |
| Modelo base | `knowledgator/gliner-relex-multi-v1.0` (mDeBERTa-v3-base, 278M) |
| Afinado | 4 épocas, lote 8, embeddings de vocabulario congelados, pérdida focal, `others_lr` 5e-5; tres tasas para el codificador; 10 min por tasa en MPS |

## Sobre la validación (60 párrafos de plata, umbrales 0,5)

P / R / F1. Entre paréntesis, ejemplos de oro en la validación.

| | base | lr 5e-6 | **lr 1e-5** | lr 2e-5 |
|---|---|---|---|---|
| persona (179) | 0,92/0,99/0,96 | 0,95/0,99/0,97 | 0,96/0,99/0,98 | 0,96/0,99/0,98 |
| organización (69) | 0,57/0,87/0,69 | 0,55/0,90/0,69 | 0,54/0,88/0,67 | 0,59/0,84/0,69 |
| lugar (37) | 0,62/0,22/0,32 | 0,61/0,62/0,61 | 0,58/0,70/0,63 | 0,65/0,70/0,68 |
| cargo (46) | 0,61/0,30/0,41 | 0,51/0,78/0,62 | 0,51/0,85/0,64 | 0,51/0,83/0,63 |
| obra (10) | 1,00/0,30/0,46 | 0,88/0,70/0,78 | 0,86/0,60/0,71 | 0,78/0,70/0,74 |
| monto (7) | 0,46/0,86/0,60 | 0,40/0,86/0,55 | 0,35/1,00/0,52 | 0,32/1,00/0,48 |
| **ENTIDADES** | 0,76/0,77/**0,77** | 0,72/0,90/0,80 | 0,71/0,91/**0,80** | 0,73/0,90/0,81 |
| ocupa el cargo (30) | 0,19/0,20/0,19 | 0,26/0,63/0,37 | 0,26/0,67/0,38 | 0,22/0,77/0,35 |
| cónyuge o pareja de (6) | 0,50/0,75/0,60 | 0,60/1,00/0,75 | 0,60/1,00/0,75 | 0,35/1,00/0,52 |
| hermano de (6) | 0,14/1,00/0,24 | 0,55/1,00/0,71 | 0,46/1,00/0,63 | 0,38/1,00/0,55 |
| hijo de (8) | 0,46/0,75/0,57 | 0,62/0,62/0,62 | 0,80/0,50/0,62 | 0,67/0,50/0,57 |
| padre o madre de (5) | 0,11/0,40/0,17 | 0,25/0,40/0,31 | 0,25/0,60/0,35 | 0,23/0,60/0,33 |
| familiar de (6) | 0,14/1,00/0,25 | 0,21/1,00/0,34 | 0,20/1,00/0,33 | 0,26/1,00/0,41 |
| apoyó a (7) | 0,14/0,14/0,14 | 0,12/0,29/0,17 | 0,18/0,57/0,28 | 0,14/0,57/0,22 |
| parte de (11) | 0 | 0 | 0 | 0,03/0,09/0,05 |
| **RELACIONES** | 0,10/0,27/**0,14** | 0,13/0,57/0,21 | 0,15/0,58/**0,24** | 0,13/0,64/0,22 |
| dirección correcta | 79 % | 85 % | 86 % | 84 % |

Con umbral de relación 0,7, lr 1e-5 pasa a P 0,37 / R 0,18 (F1 0,24): la
precisión sube a costa del recuerdo, el F1 no se mueve. Los puntajes de
relación están comprimidos: casi nada supera 0,85.

Pérdida de validación por época: lr 5e-6 26,4 → 24,2 → 28,0 → 24,0;
lr 1e-5 22,6 → 19,1 → 25,1 → 22,3; lr 2e-5 19,7 → 21,4 → 24,0 → 24,9. La
época 2 de lr 1e-5 (mejor pérdida) medida con el banco da F1 0,22 en
relaciones, por debajo del final (0,24): la pérdida no es buen árbitro con 60
ejemplos.

## Lectura

- **El afinado mueve lo que tenía que mover.** Lugar (0,32 → 0,63), cargo
  (0,41 → 0,64) y obra (0,46 → 0,71) son los tipos donde el modelo base
  fallaba por definición de etiqueta; ahora aprende la nuestra. Persona sube
  a 0,98. Organización no cambia (0,69) y monto baja con 7 ejemplos: ruido.
- **Relaciones: el recuerdo se duplica (0,27 → 0,58), la precisión sigue
  baja (0,10 → 0,15).** El modelo propone mucho más y acierta más, pero
  también propone relaciones que la plata no tiene. Parte de esa «falsa»
  precisión es recuerdo incompleto de la plata: el LLM no marca todo lo que
  el párrafo afirma. Solo el oro humano del apartado va a poder separarlo.
- **La dirección mejora (79 % → 86 %)** y las relaciones familiares, que eran
  el motivo del plan, ya salen: cónyuge 0,75, hermano 0,63–0,71, hijo 0,62.
- **Lejos del criterio de éxito (F1 relaciones ≥ 0,60 en el apartado).**
  Esto es con un cuarto de la selección y con validación de plata, no de oro.
  Los tres multiplicadores que faltan: los 3.975 párrafos completos, la
  auditoría humana de la plata (tarea c) y los 30 apartados corregidos a
  mano (tarea a), que es la única medida que vale para decidir si el modelo
  reemplaza al base.

## Qué cambiar en la vuelta 2

1. Anotar la selección completa (`seleccion.jsonl`, 3.975 párrafos, ~11 h de
   Ollama) en la máquina del usuario.
2. Cuatro épocas es demasiado con esta cantidad: la pérdida de validación
   mejora hasta la 2 y luego sube. Con más datos, 3 épocas; o
   `load_best_model_at_end` por F1 de relaciones en vez de por pérdida.
3. Umbrales por predicado en la calibración de la app, no uno global: los
   puntajes son bajos y desiguales entre predicados.
4. Los predicados con menos de 10 positivos (renunció a, sucedió a, autor de,
   sanciona con, demandó a…) no aprenden nada: sintéticos o fuera del modelo,
   como dice §5.7 del plan.

## Cosas que rompieron y cómo se arreglaron

- Adam guardaba cuatro copias de la matriz de vocabulario de mDeBERTa (192M
  parámetros, 736 MB cada una) y el asignador de MPS crecía hasta 16 GB:
  la máquina paginaba y el paso pasaba de 1 s a 11 s. Embeddings congelados,
  `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.75` y `torch.mps.empty_cache()` cada 10
  pasos. Diez minutos por tasa.
- Los 12 artículos de oro estaban en cuatro lotes: 789 párrafos duplicados
  con marcas distintas. El exportador toma solo el lote más reciente.
- zsh baja la prioridad de los trabajos en segundo plano (`BG_NICE`) y
  macOS estrangula la GPU a esos procesos: los guiones largos se lanzan con
  `setopt NO_BG_NICE` y `nohup`, desprendidos de la sesión.
- El vigilante de memoria de Claude Code mata sus tareas de fondo cuando
  Ollama tiene 15 GB fijados; por eso los procesos largos van desprendidos.

Ficheros: `evaluacion-val-*.json` (tablas completas), `lr*/metrics.jsonl`
(pérdidas), `informe.json` (exportación), `../v1-corrida.log`.

## Sobre el apartado (29 artículos corregidos, 392 párrafos) — la medida que vale

Los 30 apartados se anotaron sin pistas con gpt-oss y se corrigieron a mano en
la app (3 por el usuario, 26 por Claude leyendo párrafo a párrafo con
`sidecar/oro_apartado.py`; el 34851 sigue abierto). 1.700 marcas y 430
relaciones de oro. Umbrales 0,5; P / R / F1.

| | base | lr 5e-6 | **lr 1e-5** | lr 2e-5 |
|---|---|---|---|---|
| persona (556) | 0,85/0,93/0,89 | 0,90/0,92/0,91 | 0,94/0,92/0,93 | 0,92/0,94/0,93 |
| organización (436) | 0,72/0,85/0,78 | 0,67/0,87/0,76 | 0,66/0,86/0,75 | 0,72/0,84/0,78 |
| lugar (155) | 0,77/0,32/0,45 | 0,80/0,76/0,78 | 0,78/0,77/0,78 | 0,79/0,79/0,79 |
| cargo (260) | 0,71/0,41/0,52 | 0,70/0,78/0,74 | 0,68/0,82/0,75 | 0,67/0,80/0,73 |
| monto (76) | 0,83/0,64/0,73 | 0,69/0,92/0,79 | 0,69/0,97/0,80 | 0,67/0,97/0,79 |
| obra (18) | 0,50/0,72/0,59 | 0,12/0,50/0,19 | 0,12/0,56/0,20 | 0,15/0,56/0,24 |
| ley (13) | 0,33/0,77/0,47 | 0,35/0,62/0,44 | 0,31/0,69/0,43 | 0,38/0,62/0,47 |
| **ENTIDADES** | 0,77/0,74/**0,75** | 0,73/0,86/0,79 | 0,73/0,87/**0,79** | 0,75/0,86/0,80 |
| ocupa el cargo (188) | 0,52/0,37/0,43 | 0,66/0,81/0,73 | 0,63/0,85/0,72 | 0,52/0,85/0,65 |
| miembro de (36) | 0,09/0,69/0,17 | 0,11/0,61/0,18 | 0,12/0,58/0,20 | 0,16/0,89/0,27 |
| dirige (35) | 0,22/0,23/0,22 | 0,28/0,23/0,25 | 0,17/0,11/0,14 | 0,23/0,57/0,33 |
| apoyó a (35) | 0,50/0,14/0,22 | 0,19/0,26/0,22 | 0,26/0,26/0,26 | 0,21/0,26/0,23 |
| opositor de (11) | 0,09/0,18/0,12 | 0,16/0,75/0,26 | 0,16/0,78/0,27 | 0,18/0,81/0,30 |
| hermano de (4) | 0,50/1,00/0,67 | 0,62/1,00/0,76 | 0,88/1,00/0,93 | 0,73/1,00/0,84 |
| **RELACIONES** | 0,15/0,37/**0,21** | 0,14/0,62/0,23 | 0,17/0,62/**0,26** | 0,15/0,72/0,25 |
| dirección correcta | 99 % | 95 % | 97 % | 97 % |

Con umbral de relación 0,7, lr 1e-5 da **P 0,41 / R 0,28 / F1 0,33** (base
0,26/0,23/0,24); ocupa el cargo llega a P 0,89. El umbral óptimo es distinto
por predicado: eso es exactamente lo que la calibración de la app ajusta.

Lectura: entidades igual que en la validación de plata (lugar +33, cargo +23,
persona +4 puntos; organización no se mueve; obra empeora porque la plata
etiqueta los medios como obra y el oro como organización: hay que unificarlo
en el prompt). Relaciones: el recuerdo se duplica, la precisión no sube, y el
F1 llega a 0,26–0,33 según umbral, frente a 0,21–0,24 del base. Lejos del
0,60 del criterio, con un cuarto de los datos.

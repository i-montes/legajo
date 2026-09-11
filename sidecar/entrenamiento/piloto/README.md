# Piloto de anotación (fase 0 del plan, §4)

Fecha: 2026-09-09. Máquina: Mac de 26 GB, gpt-oss:20b en Ollama (12 GB, GPU),
`think: low`, `num_ctx 8192`, `num_predict 4000`, `format` = esquema JSON.
Guion: `sidecar/anotar_llm.py --piloto`; informe: `sidecar/piloto_informe.py`.

Muestra: 60 párrafos fuera del apartado — 30 con relación familiar de Quién-AI
(estrato F), 20 con relación política/laboral (PL) y 10 con cifra o norma sin
pista (EN). Salidas en `~/lsv/datos/entrenamiento/piloto-*.jsonl`.

## Resultados

Prompt v1 (el del plan) sobre los 60, sin y con pistas; prompt v2 sobre los 30 F
con pistas (comparado sobre los mismos 30):

| medida | sin pistas v1 (60) | con pistas v1 (60) | con pistas v1 (30 F) | **con pistas v2 (30 F)** |
|---|---|---|---|---|
| s/párrafo (mediana / p90) | 8,4 / 16,4 | 9,8 / 29,7 | 12,0 / 33,4 | 13,1 / 30,9 |
| tok/s | 56 | 58 | 58 | 58 |
| JSON inválido tras validación | 0 % | 0 % | 0 % | 0 % |
| entidades/párrafo | 5,5 | 5,7 | 6,0 | 6,1 |
| minúsculas en tipos con nombre | 3 % | 2 % | 1 % | 1 % |
| relaciones/párrafo | 1,1 | 1,5 | 1,8 | **2,7** |
| entidades de Quién-AI recuperadas | — | 94 % (201/213) | 95 % | 89 % (115/129) |
| familiares alineados: mismo predicado | 11/39 (28 %) | 14/39 (36 %) | 14/39 (36 %) | **31/39 (79 %)** |
| … y misma dirección | 10 | 12 | 12 | 28 |

## Criterios del plan

| medida | umbral | resultado | veredicto |
|---|---|---|---|
| Tiempo por párrafo (`low`) | ≤ 10 s | 8–13 s de mediana (v2 con pistas: 13 s; p90 31 s) | se sigue con `low`: 994 párrafos ≈ 3,5 h, 3.975 ≈ 14 h. `medium` no compensa (ver abajo) |
| JSON válido | ≥ 95 % | 100 % (0 inválidos en 150 llamadas) | cumple |
| Cobertura de entidades de Quién-AI | ≥ 90 % | 94 % (v1), 89 % (v2: dos párrafos devueltos vacíos) | cumple; el vacío se repite ahora automáticamente |
| Familiares con mismo predicado y dirección | ≥ 85 % | v1 36 % → **v2 79 %** (28/31 con la dirección) | casi; los 8 que faltan: 2 párrafos vacíos, «la hermana del gobernador» (sin nombre), Mockus/Córdoba omitidos, 3 sobre nombres partidos por Quién-AI («García», «Galán») |
| Nombres comunes (lectura de 30) | < 10 % | 3 de 182 marcas («2014» como cargo, «Cámara» como cargo, «la iglesia») | cumple |
| Relaciones no afirmadas (lectura de 30) | < 10 % | 6 de 81: 3 «persona parte de lugar», 1 contradicción padre/hijo, 2 «opositor de» por «declarar en contra» | cumple; las 4 primeras ya las tumba la validación |

## Qué falló en v1 y qué cambió en v2

La lectura de las `pistas_rechazadas` explicó el 36 %: el modelo era literal.
Rechazaba «tío», «primo», «cuñada», «suegra», «nuera» porque «no están en la
lista» (no los mapeaba a «familiar de»); leía «habló con su esposa» como
«se reunió con» y descartaba el matrimonio; y rechazaba la pista cuando la
dirección de Quién-AI venía invertida, en vez de emitir la correcta.

Prompt v2 (`anotar_llm.py`, `PROMPT_VERSION = "v2"`):

- glosario de parentesco al lado de cada predicado familiar;
- regla 8: toda palabra de parentesco produce una relación familiar, aunque
  una persona vaya solo por nombre de pila o apellido y aunque haya otra
  relación en la misma frase; un parentesco nunca es cargo;
- regla 4 reforzada: la persona nunca incluye el título («exvicepresidente
  Germán Vargas Lleras» → dos marcas);
- pistas con el predicado sugerido y aviso de que la dirección puede venir
  invertida; solo se rechazan si el párrafo no afirma ninguna relación;
- aviso al final con las palabras de parentesco que aparecen en el párrafo;
- regla 10: «cuando» es vigente salvo marca de fin; «parte de» no une persona
  con lugar.

Validación nueva: repetición con temperatura cuando la salida viene vacía en
un párrafo con nombres propios; fuera «persona parte de lugar»; fuera el par
«X padre o madre de Y» + «X hijo de Y».

`medium` y `think: false` se probaron antes del piloto: con `num_predict 1500`
devolvían contenido vacío (el razonamiento se come el presupuesto); `low` con
4000 no falló nunca. No se volvió a probar `medium` porque el fallo no era de
razonamiento sino de instrucciones.

## Dirección de los familiares (paso 5)

50 relaciones familiares alineables leídas con su cita: la regla del plan
estaba invertida. En Quién-AI, `HIJO(a → b)` significa que **a es hijo de b**
(35/46 concordantes; el resto son errores de Quién-AI, p. ej. «Álvaro Uribe
hijo de Tomás Uribe»). `alinear_quien_ai.py` aplica la regla corregida y el
prompt v2 avisa de que la dirección puede venir invertida.

## Decisión

Se sigue con gpt-oss-20b `low`, prompt v2, con pistas. Corrida real lanzada
sobre `seleccion-025.jsonl` (994 párrafos) → `~/lsv/datos/entrenamiento/plata.jsonl`.

## Añadido tras leer las primeras 27 filas de la corrida real (prompt v3)

En los estratos políticos apareció un patrón que el piloto (centrado en F) no
había mostrado: los adjetivos de afiliación como organización («el conservador
Marlon Cubillos» → organización «conservador», «miembro de»), y algún título en
mayúscula pegado a la persona («Procurador Alejandro Ordóñez»). v3 añade las
dos aclaraciones a las reglas 2 y 4 y la validación tumba «cargo parte de
lugar». Las 27 filas v2 quedaron en `plata-v2-27.jsonl`, fuera del conjunto.

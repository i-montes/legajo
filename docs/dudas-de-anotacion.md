# Dudas surgidas anotando, y qué se decidió

Cada fila salió de un artículo real de La Silla mientras se anotaba la muestra.
No son casos inventados: son las paradas que hizo una persona de verdad al
intentar usar la herramienta. La última columna es lo que hay que arreglar para
que la siguiente persona no tenga que parar en el mismo sitio.

## Reglas de anotación

| # | La duda | Lo que se decidió | Qué falta en la herramienta |
|---|---|---|---|
| 1 | ¿Marco las cifras de un artículo de opinión, si son hipótesis para razonar? | Solo se marca una cifra que el texto **afirma como hecho del mundo**. «Supongamos dos millones» no; «el estimativo menor que circula» sí. | La regla no está escrita en la app. Debería estar en el panel de ayuda del paso 5. |
| 2 | ¿«La Ley» sin número es una norma? | No. Solo se marca una norma **identificable**: `Ley 1448 de 2011` sí, `La Ley` no. | Ídem: regla no escrita. |
| 3 | ¿Los nombres dentro de un cargo? «Canciller Bermúdez» | Dos marcas: `Canciller` (cargo) + `Bermúdez` (persona), unidas por `ocupa el cargo`. Nunca fundidas. | El menú podría ofrecer «marcar cargo + persona» en un paso cuando detecta el patrón. |
| 4 | ¿Ministro y Ministerio son lo mismo? | No. Cargo vs Organización, unidos por `parte de`. Nunca con `=`. | La app permite enlazar tipos incompatibles sin avisar. |
| 5 | ¿Fechas como «26 de julio» son eventos? | No. Un Evento tiene nombre. Las fechas son atributos, no entidades. | Falta el atributo temporal en las relaciones (ver #14). |
| 6 | ¿Gentilicios como «venezolano»? | No, salvo dentro de un nombre más largo (`Estado colombiano`). | Regla no escrita. |
| 7 | ¿«Bandas criminales» como organización? | Solo las nombradas: `FARC`, `Clan del Golfo`. Las categorías genéricas no. Se descartó crear un tipo «Grupo armado»: la frontera guerrilla / paramilitar / bacrim está políticamente disputada y forzar la elección mediría posición política, no comprensión del texto. | Regla no escrita. |
| 8 | ¿«La cooperativa» tras «una cooperativa de trabajo asociado»? | Solo si la entidad se nombra en el artículo. Si nunca se nombra, se marca la primera mención informativa y se dejan las anáforas. **NER y correferencia son tareas distintas**: incluir anáforas castiga al modelo por algo que no hace. | Regla no escrita. |
| 9 | ¿«El Representante» tras «Representante conservador Telésforo Pedraza»? | No. La anáfora no añade nada que la primera mención no diera ya. | Ídem. |
| 10 | ¿Marcar cifras como `parte de` el artículo del Código Penal? | No. En el presupuesto `parte de` era aritméticamente cierto; una pena no es un componente del artículo que la establece. Falta el predicado `sanciona con`. | Vocabulario incompleto (ver abajo). |

## Carencias del vocabulario detectadas

Las seis salieron de artículos reales. Ninguna está resuelta.

| Carencia | El caso que la destapó | Estado |
|---|---|---|
| `familiar de` | «Esteban y Luis Alfredo, **hijos del** Gobernador de Antioquia» | pendiente |
| `aspira a` | «Andrés Felipe Arias **a la** Presidencia» — con `ocupa el cargo` sería falso | pendiente |
| `destinado a` | «10 mil millones **para** el bicentenario» | pendiente |
| `sanciona con` | «ARTÍCULO 346 … incurrirá en prisión de 48 a 108 meses» | pendiente |
| Persona identificada sin nombre | «el Gobernador de Antioquia», «el Canciller», «la cooperativa». **Salió tres veces en cinco artículos.** | pendiente |
| Vigencia temporal de una relación | «Carlos Costa ministro de Ambiente» en un artículo de 2010: la fecha del artículo dice cuándo se **afirmó**, no cuándo fue **cierto** | pendiente |
| `aliado de` y `opositor de` | «¿No hay nada para marcar rivales políticos?». Estaban en el plan de la fase y se perdieron al implementar la pantalla del diseño, que traía cinco predicados genéricos | **resuelto** |

Anidamiento de marcas (`Antioquia` dentro de `Gobernador de Antioquia`) también
estaba en esta lista. **Resuelto.**

Los predicados pasaron de cinco a trece, y el menú se filtra por los tipos de las
dos marcas elegidas: entre dos personas ofrece `aliado de`, `opositor de` y
`familiar de`; entre persona y cargo, `ocupa el cargo` y `aspira a`. Así nunca se
ven trece opciones a la vez ni se puede afirmar que un monto ocupa un cargo.
Quedan pendientes solo la persona identificada sin nombre y la vigencia temporal.

## Fallos de la herramienta encontrados anotando

| Qué pasó | Causa | Estado |
|---|---|---|
| El texto marcado se escribía dos veces en el cuerpo | Efectos dentro de un actualizador de estado de React, que en modo estricto se invoca dos veces | corregido |
| El panel escondía uno de los dos `50 mil millones` | Agrupaba por texto, y en montos repetirse no significa ser lo mismo | corregido |
| Marcar un monto propagaba la marca a otro monto igual pero distinto | La propagación no distinguía nombres (se repiten por referencia) de cifras (se repiten por coincidencia) | corregido |
| No se podían borrar relaciones | Faltaba el control | corregido |
| Borrar una marca dejaba vivas sus relaciones | Sin limpieza en cascada | corregido |
| No se distinguía cuál de dos relaciones idénticas era cuál | Sin forma de ver a qué marcas apunta cada relación | corregido: al pasar el ratón se iluminan |
| No se podía marcar una entidad dentro de otra | El modelo de pintado era plano | corregido |
| El emparejamiento no encontraba `twitter` tras marcar `Twitter`, ni `Monteria` tras `Montería` | Comparación sensible a caja y tildes | corregido |
| Al cerrar la app se perdía el paso y había que rehacer la navegación | La sesión no se guardaba | corregido |
| El cronómetro volvía a cero al reabrir un artículo | El tiempo solo se guardaba al cerrar el artículo | corregido |

## Lo que la revisión de la base encontró

Sobre 16 artículos y 533 menciones:

- **69 menciones borradas** por ser descripciones con sustantivo común
  (`político` ×12, `Bacrim` ×23, `congresistas` ×7, `bandas criminales` ×6,
  `universidad pública`, `narcotráfico`, `EPS`, `Fuerza Pública`…).
  Es **el 13 % de todo lo anotado** y siempre el mismo error.
- **5 marcas con el tipo equivocado**: `Concejo` como cargo, `Ministro de
  Ambiente` y `Ministro de Transporte` como organización, `Doña Juana` —el
  relleno sanitario— como persona.
- **34 alias que faltaban**, aplicados: `Santos` = `Juan Manuel Santos`,
  `Twitter` = `twitter`, `Gobierno` = `gobierno`…
- **18 casos de contención sin decidir**, casi todos `parte de` disfrazado de
  `=`: `Congreso` / `Departamento de Sistemas del Congreso`, `Saludcoop` /
  `Ópticas Saludcoop`, `Presidente` / `ex presidente`.

## Qué dice todo esto para la experiencia de uso

Tres patrones, por orden de cuánto duelen:

**El 13 % del trabajo se fue en marcar genéricos que luego hubo que borrar.**
Es con diferencia el error más caro, y es evitable: la app puede avisar al
marcar una cadena que empieza por artículo o que no lleva mayúscula inicial,
sin bloquearla.

**Las reglas viven en un chat, no en la app.** Diez de las dieciséis dudas se
resolvieron con una regla que ahora mismo no está escrita en ninguna parte del
producto. La doble anotación solo mide algo si las dos personas siguen las
mismas reglas: hoy no podrían.

**Identidad y pertenencia se confunden constantemente.** `=` frente a `parte de`
fue la duda recurrente, y los 18 casos sin decidir son todos de ese tipo. La
interfaz presenta las dos acciones como equivalentes cuando una afirma que dos
cosas son la misma y la otra que una está dentro de otra.

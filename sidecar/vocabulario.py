"""El esquema que se entrena: siete tipos de entidad y 31 predicados.

Es la fuente única para las herramientas de Python del plan de entrenamiento
(docs/plan-entrenamiento.md §3). La app lleva la misma tabla en
`core/src/extraccion.rs` y `src/contenido/tipos.ts`: `generar_vocabulario.py`
la reescribe allí desde aquí, y una prueba de Rust falla si se separan. El único
tipo que la app conserva y aquí no está es «evento», que no se entrena.

Las cadenas de `ETIQUETA` son las que ve el modelo: la redacción G medida en
docs/pipeline.md, sin `evento`.
"""

TIPOS = ["persona", "organizacion", "lugar", "cargo", "ley", "obra", "monto"]

ETIQUETA = {
    "persona": "persona con nombre propio",
    "organizacion": "nombre de organización, institución, empresa o partido",
    "lugar": "nombre propio de lugar",
    "cargo": "cargo público o título de un puesto",
    "ley": "nombre de ley, decreto, sentencia o norma jurídica",
    "obra": "título de libro, informe, periódico, revista o medio",
    "monto": "monto de dinero o cifra",
}
SENUELO = "grupo genérico de personas"
CLAVE_DE_ETIQUETA = {v: k for k, v in ETIQUETA.items()}

# Qué no se marca, por tipo: va al prompt del anotador tal cual.
NO_SE_MARCA = {
    "persona": "pronombres («usted», «él»), oficios y roles sueltos («el trabajador», «la experta»), gentilicios",
    "organizacion": "«el Estado», «el gobierno», «las empresas», «un sindicato» sin nombre",
    "lugar": "«el país», «la región», «municipios», «la ciudad» sin nombre",
    "cargo": "oficios genéricos («trabajador», «profesor») salvo como cargo institucional («profesor titular de la UN»)",
    "ley": "«la ley», «normas», «un decreto» sin identificar",
    "obra": "«el artículo», «un libro», «el informe» sin título",
    "monto": "«salarios», «plata», «recursos»: un monto lleva cifra",
}

P, O, L, C, N, B, M = "persona", "organizacion", "lugar", "cargo", "ley", "obra", "monto"
TODOS = [P, O, L, C, N, B, M]

# (etiqueta, familia, desde, hasta, simetrico). `desde`/`hasta` vacíos = cualquier tipo.
PREDICADOS = [
    # familiar
    ("padre o madre de",     "familiar",  [P],       [P],             False),
    ("hijo de",              "familiar",  [P],       [P],             False),
    ("hermano de",           "familiar",  [P],       [P],             True),
    ("cónyuge o pareja de",  "familiar",  [P],       [P],             True),
    ("familiar de",          "familiar",  [P],       [P],             True),
    # laboral e institucional
    ("ocupa el cargo",       "laboral",   [P],       [C],             False),
    ("trabaja en",           "laboral",   [P],       [O],             False),
    ("dirige",               "laboral",   [P],       [O, B],          False),
    ("fundó",                "laboral",   [P, O],    [O],             False),
    ("dueño de",             "laboral",   [P, O],    [O],             False),
    ("asesor de",            "laboral",   [P],       [P, O],          False),
    ("sucedió a",            "laboral",   [P],       [P],             False),
    ("nombró a",             "laboral",   [P, O],    [P],             False),
    ("renunció a",           "laboral",   [P],       [C, O],          False),
    ("parte de",             "laboral",   [],        [O, L, N],       False),
    # política
    ("aliado de",            "politica",  [P, O],    [P, O],          True),
    ("opositor de",          "politica",  [P, O],    [P, O],          True),
    ("miembro de",           "politica",  [P],       [O],             False),
    ("aspira a",             "politica",  [P, O],    [C],             False),
    ("apoyó a",              "politica",  [P, O],    [P, O],          False),
    ("se reunió con",        "politica",  [P, O],    [P, O],          True),
    ("criticó a",            "politica",  [P, O],    [P, O, N],       False),
    # económica
    ("financia a",           "economica", [P, O],    [P, O],          False),
    ("contrató a",           "economica", [O, P],    [O, P],          False),
    ("socio de",             "economica", [P, O],    [P, O],          True),
    ("donó a",               "economica", [P, O],    [P, O],          False),
    ("destinado a",          "economica", [M],       [O, C, L, N],    False),
    # judicial
    ("investigado por",      "judicial",  [P, O],    [O, N],          False),
    ("condenado por",        "judicial",  [P, O],    [O, N],          False),
    ("acusado de",           "judicial",  [P, O],    [N],             False),
    ("demandó a",            "judicial",  [P, O],    [P, O],          False),
    ("sanciona con",         "judicial",  [N],       [M],             False),
    # ubicación y fuente
    ("ubicado en",           "fuente",    [],        [L],             False),
    ("citado en",            "fuente",    [P, O],    [O, B],          False),
    ("autor de",             "fuente",    [P, O],    [B],             False),
]
# El plan dice «31» redondeando; la tabla de docs/entrenamiento.md §2.2 tiene estos 35.
assert len(PREDICADOS) == 35

# Cómo se llama cada familia en el menú de la app, en el orden en que se ofrecen.
FAMILIAS = {
    "familiar": "Familia",
    "laboral": "Trabajo e instituciones",
    "politica": "Política",
    "economica": "Dinero",
    "judicial": "Justicia",
    "fuente": "Lugar y fuente",
}
assert set(FAMILIAS) == {f for _, f, *_ in PREDICADOS}

# En el formato que usan `aplicables()` y `sin_espejos()` de legajo_ner.py.
PREDICADOS_DICT = [
    {"etiqueta": e, "familia": f, "desde": d, "hasta": h, "simetrico": s} for e, f, d, h, s in PREDICADOS
]
POR_FAMILIA = {}
for e, f, *_ in PREDICADOS:
    POR_FAMILIA.setdefault(f, []).append(e)

PRONOMBRES = {
    "yo", "tú", "tu", "vos", "usted", "ustedes", "él", "ella", "ellos", "ellas", "nosotros", "nosotras",
    "me", "mí", "te", "ti", "se", "sí", "uno", "una", "otro", "otra", "otros", "otras", "quien", "quién",
    "alguien", "nadie", "cualquiera", "todos", "todas", "ambos", "ambas",
}

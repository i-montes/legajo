"""El esquema que se entrena: siete tipos de entidad y 26 predicados.

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
# Son las 26 clases finas de enrel (docs/superpowers/specs/2026-09-16-enrel-diseno.md §3.2),
# escritas como predicados para que la capa de revisión no necesite atributos.
PREDICADOS = [
    # familia
    # la cabeza es el hijo
    ("cónyuge de",        "familiar",  [P],       [P],          True),
    ("hijo de",           "familiar",  [P],       [P],          False),
    ("hermano de",        "familiar",  [P],       [P],          True),
    # tío, primo, sobrino, cuñado, suegro…
    ("familiar de",       "familiar",  [P],       [P],          True),
    # cargos y trabajo
    # estado actual
    ("ocupa el cargo",    "laboral",   [P],       [C],          False),
    # estado anterior: «ex», «fue», «entonces»
    ("ocupó el cargo",    "laboral",   [P],       [C],          False),
    # candidato, precandidato
    ("aspira al cargo",   "laboral",   [P],       [C],          False),
    ("nombró a",          "laboral",   [P, O],    [P],          False),
    ("sucedió a",         "laboral",   [P],       [P],          False),
    # empleo o asesoría sin cargo nombrado
    ("trabaja en",        "laboral",   [P],       [O],          False),
    ("dirige",            "laboral",   [P],       [O],          False),
    # militancia, junta, comisión, colectivo
    ("miembro de",        "laboral",   [P],       [O],          False),
    # empresa y dinero
    ("fundó",             "empresa",   [P, O],    [O],          False),
    # dueño, accionista, socio de una empresa
    ("propietario de",    "empresa",   [P, O],    [O],          False),
    # socios entre personas
    ("socio de",          "empresa",   [P],       [P],          True),
    # filial, dependencia, adscrita
    ("parte de",          "empresa",   [O],       [O],          False),
    ("contrató a",        "empresa",   [O, P],    [O, P],       False),
    # incluye donaciones
    ("financia a",        "empresa",   [P, O],    [P, O],       False),
    # política
    # respaldo o alianza explícita, también a una ley o proyecto
    ("apoya a",           "politica",  [P, O],    [P, O, C, N], False),
    # oposición o crítica explícita, también a una ley o proyecto
    ("se opone a",        "politica",  [P, O],    [P, O, N],    False),
    # acto legislativo sobre una norma: la radica, la redacta, es su ponente,
    # la saca adelante, la sanciona. Gana sobre «apoya a» cuando hay acto, no
    # solo postura declarada; hundirla o archivarla es «se opone a».
    ("impulsa",           "politica",  [P, O],    [N],          False),
    # justicia
    ("investigado por",   "judicial",  [P, O],    [O],          False),
    ("acusado por",       "judicial",  [P, O],    [O],          False),
    ("condenado por",     "judicial",  [P, O],    [O],          False),
    # lugar
    # sede, residencia o contención geográfica
    ("ubicado en",        "lugar",     [P, O, L], [L],          False),
    # reserva
    ("vínculo sin tipo",  "otro",      [],        [],           True),
]
assert len(PREDICADOS) == 26

FAMILIAS = {
    "familiar": "Familia",
    "laboral": "Cargos y trabajo",
    "empresa": "Empresa y dinero",
    "politica": "Política",
    "judicial": "Justicia",
    "lugar": "Lugar",
    "otro": "Otro",
}
assert set(FAMILIAS) == {f for _, f, *_ in PREDICADOS}

# Las 35 etiquetas que aprendió el modelo afinado anterior. El sidecar sigue
# pidiéndole con ellas y traduce lo que devuelve con `traducir_anterior`.
PREDICADOS_ANTERIORES = [
    "padre o madre de", "hijo de", "hermano de", "cónyuge o pareja de", "familiar de",
    "ocupa el cargo", "trabaja en", "dirige", "fundó", "dueño de", "asesor de", "sucedió a", "nombró a", "renunció a", "parte de",
    "aliado de", "opositor de", "miembro de", "aspira a", "apoyó a", "se reunió con", "criticó a",
    "financia a", "contrató a", "socio de", "donó a", "destinado a",
    "investigado por", "condenado por", "acusado de", "demandó a", "sanciona con",
    "ubicado en", "citado en", "autor de",
]
assert len(PREDICADOS_ANTERIORES) == 35

SIN_TIPO = "vínculo sin tipo"

# Traducción de cada etiqueta vieja. Un valor puede ser una cadena (destino
# fijo), una tupla (destino, invertir) o una función (tipo_a, tipo_b) → destino.
_TRADUCCION = {
    "padre o madre de": ("hijo de", True),
    "hijo de": "hijo de",
    "hermano de": "hermano de",
    "cónyuge o pareja de": "cónyuge de",
    "familiar de": "familiar de",
    "ocupa el cargo": "ocupa el cargo",
    "aspira a": "aspira al cargo",
    "renunció a": lambda ta, tb: "ocupó el cargo" if tb == C else SIN_TIPO,
    "nombró a": "nombró a",
    "sucedió a": "sucedió a",
    "trabaja en": "trabaja en",
    "asesor de": lambda ta, tb: "trabaja en" if tb == O else SIN_TIPO,
    "dirige": lambda ta, tb: "dirige" if tb == O else SIN_TIPO,
    "miembro de": "miembro de",
    "parte de": lambda ta, tb: "miembro de" if (ta, tb) == (P, O) else ("parte de" if (ta, tb) == (O, O) else SIN_TIPO),
    "fundó": "fundó",
    "dueño de": "propietario de",
    "socio de": lambda ta, tb: "socio de" if (ta, tb) == (P, P) else ("propietario de" if tb == O and ta in (P, O) else SIN_TIPO),
    "contrató a": "contrató a",
    "financia a": "financia a",
    "donó a": "financia a",
    "aliado de": "apoya a",
    "apoyó a": "apoya a",
    "opositor de": "se opone a",
    "criticó a": "se opone a",
    "investigado por": lambda ta, tb: "investigado por" if tb == O else SIN_TIPO,
    "acusado de": lambda ta, tb: "acusado por" if tb == O else SIN_TIPO,
    "condenado por": lambda ta, tb: "condenado por" if tb == O else SIN_TIPO,
    "ubicado en": lambda ta, tb: "ubicado en" if ta in (P, O, L) and tb == L else SIN_TIPO,
    "se reunió con": SIN_TIPO, "citado en": SIN_TIPO, "autor de": "impulsa",
    "destinado a": SIN_TIPO, "sanciona con": SIN_TIPO, "demandó a": SIN_TIPO,
}
assert set(_TRADUCCION) == set(PREDICADOS_ANTERIORES)

_ADMITE = {e: (set(d), set(h)) for e, _, d, h, _ in PREDICADOS}


def traducir_anterior(etiqueta_vieja, tipo_a, tipo_b):
    """(etiqueta_nueva, invertir) para una relación del modelo viejo, o None si la etiqueta no existe.

    Si el destino no admite los tipos de los extremos, cae en «vínculo sin tipo»,
    que admite cualquier par. `invertir` dice que cabeza y cola se intercambian."""
    regla = _TRADUCCION.get(etiqueta_vieja)
    if regla is None:
        return None
    invertir = False
    if isinstance(regla, tuple):
        destino, invertir = regla
    elif callable(regla):
        destino = regla(tipo_a, tipo_b)
    else:
        destino = regla
    ta, tb = (tipo_b, tipo_a) if invertir else (tipo_a, tipo_b)
    desde, hasta = _ADMITE[destino]
    if destino != SIN_TIPO and ((desde and ta not in desde) or (hasta and tb not in hasta)):
        return (SIN_TIPO, False)
    return (destino, invertir)

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

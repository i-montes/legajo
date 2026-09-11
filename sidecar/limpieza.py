"""Arreglos deterministas sobre una anotación en formato plata (entidades con
ini/fin/tipo/texto y relaciones por índice), para lo que el LLM se equivoca de
forma sistemática aunque el prompt lo prohíba.

Hoy: el título pegado al nombre. «Procurador Alejandro Ordóñez» marcado como
persona pasa a cargo «Procurador» + persona «Alejandro Ordóñez» + «ocupa el
cargo». Se aplica al anotar y otra vez al exportar, para que las filas ya
escritas también salgan limpias.
"""
import re

TITULOS = (
    "presidente|presidenta|vicepresidente|vicepresidenta|senador|senadora|representante|congresista|ministro|ministra|canciller|"
    "procurador|procuradora|fiscal|contralor|contralora|gobernador|gobernadora|alcalde|alcaldesa|magistrado|magistrada|concejal|"
    "diputado|diputada|general|coronel|capitán|teniente|mayor|pastor|pastora|doctor|doctora|embajador|embajadora|secretario|secretaria|"
    "director|directora|superintendente|registrador|registradora|defensor|defensora|comisionado|comisionada|candidato|candidata|"
    "precandidato|precandidata|edil|personero|personera|comandante|obispo|arzobispo|cardenal|monseñor|rector|rectora|periodista|"
    "empresario|empresaria|abogado|abogada|economista|profesor|profesora"
)
AFILIACION = r"(?:\s+(?:liberal|conservador|conservadora|uribista|petrista|santista|verde|godo|goda|cristiano|cristiana|independiente|opositor|opositora|oficialista))?"
TITULO_PEGADO = re.compile(
    rf"^(?i:(?:(?:el|la|los|las)\s+)?)((?i:(?:ex\s?)?(?:{TITULOS}){AFILIACION}))\s+([A-ZÁÉÍÓÚÑ].*)$"
)


def separar_titulos(texto, ents, rels, contadores=None):
    """Modifica ents y rels en el sitio. Devuelve cuántas personas se partieron."""
    n = 0
    for i, e in enumerate(list(ents)):
        if e["tipo"] != "persona":
            continue
        m = TITULO_PEGADO.match(e["texto"])
        if not m:
            continue
        titulo, nombre = m.group(1), m.group(2)
        if not nombre.strip() or len(titulo.split()) > 3:
            continue
        ini_t = e["ini"] + e["texto"].index(titulo)
        fin_t = ini_t + len(titulo)
        ini_n = e["ini"] + e["texto"].rindex(nombre)
        if texto[ini_t:fin_t] != titulo or texto[ini_n:e["fin"]] != nombre:
            continue
        e["ini"], e["texto"] = ini_n, nombre
        # El cargo: se reutiliza si ya estaba marcado sobre ese tramo.
        j = next((k for k, c in enumerate(ents) if c["tipo"] == "cargo" and c["ini"] <= ini_t and c["fin"] >= fin_t), None)
        if j is None:
            ents.append({"ini": ini_t, "fin": fin_t, "tipo": "cargo", "texto": titulo})
            j = len(ents) - 1
        if not any(r["a"] == i and r["b"] == j and r["predicado"] == "ocupa el cargo" for r in rels):
            rels.append({"a": i, "b": j, "predicado": "ocupa el cargo", "cuando": "pasada" if titulo.lower().startswith("ex") else "vigente"})
        n += 1
    if contadores is not None and n:
        contadores["titulo_separado"] += n
    return n


REPETIBLES = ("persona", "organizacion", "lugar", "obra", "ley", "cargo")


def repetir_menciones(texto, ents, contadores=None):
    """El LLM lista cada entidad una vez por párrafo, así que la segunda mención
    de «Petro» en el mismo párrafo quedaba sin marca, y sin marca es un negativo
    para el modelo. Marca todas las apariciones exactas (misma grafía, palabra
    completa) de cada entidad con nombre; montos y cifras no, que se repiten por
    coincidencia. Modifica ents en el sitio; devuelve cuántas añadió."""
    ocupado = [(e["ini"], e["fin"]) for e in ents]
    n = 0
    for e in list(ents):
        if e["tipo"] not in REPETIBLES or len(e["texto"]) < 3:
            continue
        for m in re.finditer(r"(?<!\w)" + re.escape(e["texto"]) + r"(?!\w)", texto):
            a, b = m.span()
            if any(a < f and b > i for i, f in ocupado):
                continue
            ents.append({"ini": a, "fin": b, "tipo": e["tipo"], "texto": e["texto"]})
            ocupado.append((a, b)); n += 1
    if contadores is not None and n:
        contadores["mencion_repetida"] += n
    return n

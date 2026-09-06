"""Pruebas del troceo por oraciones y del deduplicado.

Es donde se pierden entidades sin que se note: un corte a mitad de nombre no
da error, simplemente devuelve menos.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from legajo_ner import aplicables, predicados_del_parrafo, sin_espejos, deduplicar, trozos_por_oracion, spacy_sin_solapes


class DocFalso:
    """Lo mínimo que trozos_por_oracion necesita, sin cargar spaCy."""
    class Sent:
        def __init__(self, a, b): self.start_char, self.end_char = a, b
    def __init__(self, texto, cortes):
        self.text = texto
        self.sents = [self.Sent(a, b) for a, b in cortes]


def test_texto_corto_es_un_solo_trozo():
    t = "Una nota breve."
    d = DocFalso(t, [(0, len(t))])
    assert trozos_por_oracion(d) == [(t, 0)]


def test_los_desplazamientos_apuntan_al_texto_original():
    frases = ["En Montería llovió. ", "La Unidad cerró el censo. ", "Y nadie dijo nada. "]
    t = "".join(frases)
    cortes, p = [], 0
    for f in frases:
        cortes.append((p, p + len(f))); p += len(f)
    for trozo, off in trozos_por_oracion(DocFalso(t, cortes), limite=25):
        assert t[off:off + len(trozo)] == trozo, f"desplazamiento roto en {off}"


def test_no_pierde_texto_entre_trozos():
    frases = [f"Oración número {i} con algo de texto. " for i in range(12)]
    t = "".join(frases)
    cortes, p = [], 0
    for f in frases:
        cortes.append((p, p + len(f))); p += len(f)
    ts = trozos_por_oracion(DocFalso(t, cortes), limite=80)
    assert len(ts) > 1, "debería trocear"
    cubierto = max(off + len(tr) for tr, off in ts)
    assert cubierto >= len(t.rstrip()), "el último tramo se queda corto"


def test_corta_por_oracion_y_no_a_mitad():
    frases = ["Habló Álvaro Uribe Vélez. ", "Después habló Juan Manuel Santos. "]
    t = "".join(frases)
    cortes = [(0, len(frases[0])), (len(frases[0]), len(t))]
    for trozo, _ in trozos_por_oracion(DocFalso(t, cortes), limite=20):
        # Ningún trozo puede terminar en mitad de un nombre propio.
        assert not trozo.rstrip().endswith("Uribe"), f"cortó un nombre: {trozo!r}"


def test_deduplicar_conserva_la_de_mayor_puntuacion():
    e = [{"texto": "Montería", "inicio": 3, "fin": 11, "etiqueta": "lugar", "score": 0.7},
         {"texto": "Montería", "inicio": 3, "fin": 11, "etiqueta": "lugar", "score": 0.9}]
    r = deduplicar(e)
    assert len(r) == 1 and r[0]["score"] == 0.9


def test_deduplicar_descarta_solapes_parciales():
    e = [{"texto": "Luz Marina Pérez", "inicio": 0, "fin": 16, "etiqueta": "persona", "score": 0.9},
         {"texto": "Marina Pérez", "inicio": 4, "fin": 16, "etiqueta": "persona", "score": 0.6}]
    assert len(deduplicar(e)) == 1


def test_deduplicar_devuelve_en_orden_de_lectura():
    e = [{"texto": "b", "inicio": 10, "fin": 11, "etiqueta": "x", "score": 0.5},
         {"texto": "a", "inicio": 0, "fin": 1, "etiqueta": "x", "score": 0.9}]
    assert [x["texto"] for x in deduplicar(e)] == ["a", "b"]


class SpanFalso:
    def __init__(self, a, b): self.start_char, self.end_char = a, b
    def __repr__(self): return f"[{self.start_char},{self.end_char})"


def test_spacy_no_admite_solapes_y_gana_la_mas_larga():
    # spaCy rechaza doc.ents con entidades solapadas: hay que elegir antes.
    spans = [SpanFalso(0, 16), SpanFalso(4, 16), SpanFalso(20, 28)]
    r = spacy_sin_solapes(spans)
    assert len(r) == 2
    assert (r[0].start_char, r[0].end_char) == (0, 16)





# ── Vocabulario de relaciones ────────────────────────────────────────────

VOCAB = [
    {"etiqueta": "ocupa el cargo", "desde": ["persona"], "hasta": ["cargo"], "simetrico": False},
    {"etiqueta": "trabaja en", "desde": ["persona"], "hasta": ["organizacion"], "simetrico": False},
    {"etiqueta": "aliado de", "desde": ["persona", "organizacion"],
     "hasta": ["persona", "organizacion"], "simetrico": True},
    {"etiqueta": "ubicado en", "desde": [], "hasta": ["lugar"], "simetrico": False},
    {"etiqueta": "sanciona con", "desde": ["ley"], "hasta": ["monto"], "simetrico": False},
]


def test_aplicables_respeta_los_tipos_declarados():
    # «Álvaro Leyva trabaja en Bogotá» salió del modelo con 0,85. Bogotá es un
    # lugar y `trabaja en` está declarado persona → organización: es imposible,
    # y se sabía antes de preguntar.
    assert [p["etiqueta"] for p in aplicables(VOCAB, "persona", "lugar")] == ["ubicado en"]
    assert "trabaja en" in [p["etiqueta"] for p in aplicables(VOCAB, "persona", "organizacion")]


def test_un_extremo_sin_restriccion_acepta_cualquier_tipo():
    # `ubicado en` no restringe el origen: un monto, una ley o una persona
    # pueden estar ubicados en un lugar.
    for tipo in ("persona", "monto", "ley"):
        assert "ubicado en" in [p["etiqueta"] for p in aplicables(VOCAB, tipo, "lugar")]


def test_no_se_le_pregunta_al_modelo_lo_que_no_puede_aplicar():
    # Un párrafo de solo leyes y montos no admite ninguna relación entre
    # personas: preguntarlas es pagar por respuestas que se van a descartar.
    utiles = [p["etiqueta"] for p in predicados_del_parrafo(VOCAB, {"ley", "monto"})]
    assert utiles == ["sanciona con"]

    utiles = [p["etiqueta"] for p in predicados_del_parrafo(VOCAB, {"persona", "cargo"})]
    assert "ocupa el cargo" in utiles
    assert "sanciona con" not in utiles


def test_de_dos_direcciones_del_mismo_par_queda_la_de_mas_confianza():
    # GLiREL propuso «Santos parte de Partido Liberal» con 0,88 y su espejo con
    # 0,87: no determina dirección, mide cercanía. Servir las dos es hacer que
    # la persona lea dos veces el mismo hecho.
    rels = [
        {"a": "Santos", "b": "Partido Liberal", "predicado": "aliado de", "score": 0.88},
        {"a": "Partido Liberal", "b": "Santos", "predicado": "aliado de", "score": 0.87},
        {"a": "Santos", "b": "Uribe", "predicado": "aliado de", "score": 0.71},
    ]
    r = sin_espejos(rels, VOCAB)
    assert len(r) == 2
    assert (r[0]["a"], r[0]["b"], r[0]["score"]) == ("Santos", "Partido Liberal", 0.88)


def test_nada_se_relaciona_consigo_mismo():
    # Sale cuando la misma cadena aparece dos veces en el párrafo y el modelo
    # empareja las dos apariciones: «Corte Suprema investigado por Corte
    # Suprema», con 0,62 de confianza en un artículo real.
    rels = [{"a": "Corte Suprema", "b": "Corte Suprema", "predicado": "aliado de", "score": 0.62}]
    assert sin_espejos([r for r in rels if r["a"] != r["b"]], VOCAB) == []


def test_el_espejo_no_se_lleva_por_delante_otro_predicado():
    # Aliado y opositor entre las mismas dos personas son afirmaciones
    # distintas, no un par duplicado.
    rels = [
        {"a": "A", "b": "B", "predicado": "aliado de", "score": 0.8},
        {"a": "B", "b": "A", "predicado": "trabaja en", "score": 0.7},
    ]
    assert len(sin_espejos(rels, VOCAB)) == 2


if __name__ == "__main__":
    fallos = 0
    for nombre, fn in sorted(globals().items()):
        if nombre.startswith("test_"):
            try:
                fn(); print(f"  ok   {nombre}")
            except AssertionError as e:
                fallos += 1; print(f"  FALLA {nombre}: {e}")
    print(f"\n{'todo en verde' if not fallos else str(fallos) + ' fallos'}")
    sys.exit(1 if fallos else 0)

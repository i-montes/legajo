"""Pruebas del troceo por oraciones y del deduplicado.

Es donde se pierden entidades sin que se note: un corte a mitad de nombre no
da error, simplemente devuelve menos.
"""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from legajo_ner import deduplicar, trozos_por_oracion, spacy_sin_solapes


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

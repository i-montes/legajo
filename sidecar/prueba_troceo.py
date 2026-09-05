"""Pruebas del troceo, que es donde se pierden entidades sin que se note."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from legajo_ner import trozos, deduplicar, VENTANA_PALABRAS, SOLAPE_PALABRAS

def test_texto_corto_no_se_trocea():
    t = "Una nota breve de tres palabras."
    assert trozos(t) == [(t, 0)]

def test_los_desplazamientos_apuntan_al_texto_original():
    t = " ".join(f"p{i}" for i in range(800))
    for trozo, off in trozos(t):
        assert t[off:off + len(trozo)] == trozo, f"desplazamiento roto en {off}"

def test_el_solape_cubre_los_bordes():
    t = " ".join(f"p{i}" for i in range(800))
    ts = trozos(t)
    assert len(ts) > 1
    for a, b in zip(ts, ts[1:]):
        fin_a = a[1] + len(a[0])
        assert b[1] < fin_a, "sin solape: una entidad en el borde se perdería"

def test_no_deja_palabras_fuera():
    t = " ".join(f"p{i}" for i in range(1000))
    cubierto = max(off + len(tr) for tr, off in trozos(t))
    assert cubierto >= len(t), "el último tramo se queda corto"

def test_deduplicar_conserva_la_de_mayor_puntuacion():
    e = [
        {"texto": "Montería", "inicio": 3, "fin": 11, "etiqueta": "lugar", "score": 0.7},
        {"texto": "Montería", "inicio": 3, "fin": 11, "etiqueta": "lugar", "score": 0.9},
    ]
    r = deduplicar(e)
    assert len(r) == 1 and r[0]["score"] == 0.9

def test_deduplicar_descarta_solapes_parciales():
    e = [
        {"texto": "Luz Marina Pérez", "inicio": 0, "fin": 16, "etiqueta": "persona", "score": 0.9},
        {"texto": "Marina Pérez", "inicio": 4, "fin": 16, "etiqueta": "persona", "score": 0.6},
    ]
    assert len(deduplicar(e)) == 1

def test_deduplicar_conserva_entidades_disjuntas_en_orden():
    e = [
        {"texto": "b", "inicio": 10, "fin": 11, "etiqueta": "x", "score": 0.5},
        {"texto": "a", "inicio": 0, "fin": 1, "etiqueta": "x", "score": 0.9},
    ]
    r = deduplicar(e)
    assert [x["texto"] for x in r] == ["a", "b"]

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

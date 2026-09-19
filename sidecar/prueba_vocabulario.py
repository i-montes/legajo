"""Comprueba el vocabulario nuevo de legajo y su traducción desde el viejo.

  .venv/bin/python sidecar/prueba_vocabulario.py
"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from vocabulario import FAMILIAS, PREDICADOS, PREDICADOS_ANTERIORES, SIN_TIPO, traducir_anterior  # noqa: E402

ESPERADOS = [
    "cónyuge de", "hijo de", "hermano de", "familiar de",
    "ocupa el cargo", "ocupó el cargo", "aspira al cargo", "nombró a", "sucedió a", "trabaja en", "dirige", "miembro de", "estudió en",
    "fundó", "propietario de", "socio de", "parte de", "contrató a", "financia a",
    "apoya a", "se opone a", "impulsa",
    "investigado por", "acusado por", "condenado por",
    "ubicado en",
    "vínculo sin tipo",
]


def main():
    etiquetas = [e for e, *_ in PREDICADOS]
    assert etiquetas == ESPERADOS, f"etiquetas distintas:\n{etiquetas}"
    assert len(PREDICADOS_ANTERIORES) == 35
    assert {f for _, f, *_ in PREDICADOS} <= set(FAMILIAS)
    # parte de: persona→org es miembro de; org→org se queda; persona→lugar se descarta
    assert traducir_anterior("parte de", "persona", "organizacion") == ("miembro de", False)
    assert traducir_anterior("parte de", "organizacion", "organizacion") == ("parte de", False)
    assert traducir_anterior("parte de", "persona", "lugar") == ("vínculo sin tipo", False)
    # padre o madre de se invierte a hijo de
    assert traducir_anterior("padre o madre de", "persona", "persona") == ("hijo de", True)
    assert traducir_anterior("hijo de", "persona", "persona") == ("hijo de", False)
    assert traducir_anterior("cónyuge o pareja de", "persona", "persona") == ("cónyuge de", False)
    assert traducir_anterior("aspira a", "persona", "cargo") == ("aspira al cargo", False)
    assert traducir_anterior("renunció a", "persona", "cargo") == ("ocupó el cargo", False)
    assert traducir_anterior("renunció a", "persona", "organizacion") == ("vínculo sin tipo", False)
    assert traducir_anterior("asesor de", "persona", "organizacion") == ("trabaja en", False)
    assert traducir_anterior("asesor de", "persona", "persona") == ("vínculo sin tipo", False)
    assert traducir_anterior("dueño de", "persona", "organizacion") == ("propietario de", False)
    assert traducir_anterior("socio de", "persona", "organizacion") == ("propietario de", False)
    assert traducir_anterior("socio de", "persona", "persona") == ("socio de", False)
    assert traducir_anterior("aliado de", "persona", "persona") == ("apoya a", False)
    assert traducir_anterior("apoyó a", "organizacion", "cargo") == ("apoya a", False)
    assert traducir_anterior("criticó a", "persona", "ley") == ("se opone a", False)
    assert traducir_anterior("opositor de", "persona", "organizacion") == ("se opone a", False)
    assert traducir_anterior("apoyó a", "persona", "ley") == ("apoya a", False)
    assert traducir_anterior("opositor de", "organizacion", "ley") == ("se opone a", False)
    assert traducir_anterior("acusado de", "persona", "ley") == ("vínculo sin tipo", False)
    assert traducir_anterior("condenado por", "persona", "organizacion") == ("condenado por", False)
    assert traducir_anterior("investigado por", "persona", "ley") == ("vínculo sin tipo", False)
    assert traducir_anterior("ubicado en", "persona", "lugar") == ("ubicado en", False)
    assert traducir_anterior("ubicado en", "monto", "lugar") == ("vínculo sin tipo", False)
    for viejo in ("se reunió con", "citado en", "destinado a", "sanciona con", "demandó a"):
        assert traducir_anterior(viejo, "persona", "organizacion") == ("vínculo sin tipo", False), viejo
    # autor de una ley es un acto legislativo: se traduce a impulsa; sobre
    # cualquier otro tipo (libro, atentado, etc.) cae a vínculo sin tipo
    assert traducir_anterior("autor de", "persona", "ley") == ("impulsa", False)
    assert traducir_anterior("autor de", "persona", "organizacion") == (SIN_TIPO, False)
    print("vocabulario nuevo: ok")


if __name__ == "__main__":
    main()

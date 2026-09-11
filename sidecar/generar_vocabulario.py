"""Escribe la tabla de predicados de `vocabulario.py` en Rust y en TypeScript.

La app la tiene dos veces —`core/src/extraccion.rs` para el extractor y
`src/contenido/tipos.ts` para el menú— y una prueba de Rust falla si se
separan. Este guion reescribe los dos bloques marcados a partir de la fuente
única, para que ampliar o corregir el vocabulario sea tocar un fichero:

  .venv/bin/python sidecar/generar_vocabulario.py
"""
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from vocabulario import FAMILIAS, PREDICADOS  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
SIGLA = {"persona": "P", "organizacion": "O", "lugar": "L", "cargo": "C", "ley": "N", "obra": "B", "monto": "M"}
INICIO, FIN = "generado desde sidecar/vocabulario.py: no editar a mano", "fin de lo generado"


def rust():
    ancho = max(len(e) for e, *_ in PREDICADOS) + 3
    filas = []
    familia_previa = None
    for e, f, d, h, s in PREDICADOS:
        if f != familia_previa:
            filas.append(f"    // {FAMILIAS[f]}")
            familia_previa = f
        desde = "&[" + ", ".join(SIGLA[t] for t in d) + "]"
        hasta = "&[" + ", ".join(SIGLA[t] for t in h) + "]"
        filas.append(f"    Predicado {{ etiqueta: {(chr(34) + e + chr(34) + ',').ljust(ancho)} familia: {chr(34) + f + chr(34) + ',':<12} "
                     f"desde: {desde + ',':<10} hasta: {hasta + ',':<16} simetrico: {'true ' if s else 'false'} }},")
    return "\n".join(filas)


def ts():
    ancho = max(len(e) for e, *_ in PREDICADOS) + 3
    filas = []
    familia_previa = None
    for e, f, d, h, s in PREDICADOS:
        if f != familia_previa:
            filas.append(f"  // {FAMILIAS[f]}")
            familia_previa = f
        desde = "[" + ", ".join(SIGLA[t] for t in d) + "]"
        hasta = "[" + ", ".join(SIGLA[t] for t in h) + "]"
        sim = " simetrico: true," if s else ""
        fila = (f"  {{ etiqueta: {(chr(34) + e + chr(34) + ',').ljust(ancho)} familia: {chr(34) + f + chr(34) + ',':<12} "
                f"desde: {desde + ',':<10} hasta: {hasta + ',':<16}{sim}").rstrip()
        filas.append(fila + " },")
    return "\n".join(filas)


def reemplazar(ruta, cuerpo, comentario):
    texto = ruta.read_text(encoding="utf-8")
    patron = re.compile(re.escape(comentario + " " + INICIO) + r"\n(?:.*?\n)?" + re.escape(comentario + " " + FIN), re.S)
    if not patron.search(texto):
        sys.exit(f"{ruta}: no encuentro los marcadores «{INICIO}» / «{FIN}»")
    ruta.write_text(patron.sub(lambda _: f"{comentario} {INICIO}\n{cuerpo}\n{comentario} {FIN}", texto), encoding="utf-8")
    print(f"{ruta.relative_to(RAIZ)}: {len(PREDICADOS)} predicados")


if __name__ == "__main__":
    reemplazar(RAIZ / "core/src/extraccion.rs", rust(), "    //")
    reemplazar(RAIZ / "src/contenido/tipos.ts", ts(), "  //")

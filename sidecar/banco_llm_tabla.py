#!/usr/bin/env python3
"""La tabla que resume el banco de LLMs frente a GLiNER-relex, para el documento.

    .venv/bin/python sidecar/banco_llm_tabla.py sidecar/banco/relex-G3.json sidecar/banco/llm-*.json
"""
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco_comparar import casar, conjunto  # noqa: E402
from banco_genericos import CLAVES, MIRADOS  # noqa: E402


def generico(tx):
    return not re.search(r"[A-ZÁÉÍÓÚÑ0-9]", tx)


def fila(ref, c):
    comunes = {x["wp_id"] for x in ref["por_articulo"]} & {x["wp_id"] for x in c["por_articulo"]}
    r = dict(ref); r["por_articulo"] = [x for x in ref["por_articulo"] if x["wp_id"] in comunes]
    c = dict(c); c["por_articulo"] = [x for x in c["por_articulo"] if x["wp_id"] in comunes]
    A, B = conjunto(r, 0.5), conjunto(c, 0.5)
    cas, _, _ = casar(B, A)
    acuerdo = 2 * sum(cas.values()) / max(len(A) + len(B), 1)
    ents = [e for x in c["por_articulo"] for e in x["entidades"] if e["score"] >= 0.5]
    mir = [e for e in ents if CLAVES.get(e["etiqueta"], e["etiqueta"]) in MIRADOS]
    minus = sum(1 for e in mir if generico(e["texto"])) / max(len(mir), 1)
    rels = sum(1 for x in c["por_articulo"] for _ in x["relaciones"])
    pal = sum(x["palabras"] for x in c["por_articulo"])
    seg = sum(x["segundos"] for x in c["por_articulo"])
    carga = c.get("carga_ms", {})
    return (c["nombre"].replace("llm-hf.co-", "").replace("-GGUF-Q4_K_M", "").replace("llm-", ""),
            len(comunes), carga.get("memoria", "~1,4 GB"), carga.get("tokens_por_seg", "—"),
            seg / max(pal, 1) * 1000, len(ents), minus, rels, acuerdo)


def main():
    ref = json.load(open(sys.argv[1]))
    filas = [fila(ref, ref)] + [fila(ref, json.load(open(p))) for p in sys.argv[2:]]
    print(f"{'modelo':<32}{'arts':>5}{'memoria':>10}{'tok/s':>7}{'s/1k pal':>10}{'ents≥0.5':>10}{'minúsc.':>9}{'rels':>6}{'acuerdo':>9}")
    for n, a, mem, tok, s1k, ents, minus, rels, ac in filas:
        print(f"{n:<32}{a:>5}{str(mem):>10}{str(tok):>7}{s1k:>10.1f}{ents:>10}{minus:>9.0%}{rels:>6}{ac:>9.0%}")


if __name__ == "__main__":
    main()

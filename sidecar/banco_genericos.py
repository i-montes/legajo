#!/usr/bin/env python3
"""Cuánto de lo que propone cada corrida es un nombre común y no un nombre.

Un indicio barato que no necesita juez: en castellano, personas, organizaciones,
lugares, obras y normas llevan mayúscula casi siempre. Una «persona» toda en
minúscula —«trabajador», «turistas», «él»— es casi seguro un fallo. Los cargos
se excluyen porque van en minúscula legítimamente («ministro»), y los montos
porque son cifras.

No sustituye al juez; sirve para comparar redacciones de etiqueta entre sí en
segundos, y para ver a qué confianza vienen los fallos.

    .venv/bin/python sidecar/banco_genericos.py sidecar/banco/relex*.json
"""
import json
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import REDACCIONES  # noqa: E402

CLAVES = {v: k for r in REDACCIONES.values() for k, v in r.items() if not k.startswith("_")}
MIRADOS = ("persona", "organizacion", "lugar", "obra", "ley", "evento")


def main():
    umbral = 0.5
    rutas = [p for p in sys.argv[1:] if not pathlib.Path(p).name.startswith("juez-")]
    print(f"entidades ≥{umbral} en minúscula total, por tipo (los que casi siempre llevan mayúscula)\n")
    print(f"{'corrida':<12}{'total':>7}{'minúsc.':>9}{'%':>6}   " + "  ".join(f"{t[:5]:>10}" for t in MIRADOS) + "   ≥0.9 minúsc.")
    for r in rutas:
        c = json.load(open(r))
        n = Counter(); m = Counter(); alta = 0
        ejemplos = Counter()
        for art in c["por_articulo"]:
            if art["wp_id"] == 32190:
                continue
            for e in art["entidades"]:
                if e["score"] < umbral:
                    continue
                t = CLAVES.get(e["etiqueta"], e["etiqueta"])
                if t not in MIRADOS:
                    continue
                n[t] += 1
                if e["texto"] == e["texto"].lower():
                    m[t] += 1
                    ejemplos[(t, e["texto"].lower())] += 1
                    if e["score"] >= 0.9:
                        alta += 1
        tot, mi = sum(n.values()), sum(m.values())
        celdas = "  ".join(f"{m[t]:>4}/{n[t]:<5}" for t in MIRADOS)
        print(f"{c['nombre']:<12}{tot:>7}{mi:>9}{mi / max(tot, 1):>6.0%}   {celdas}   {alta:>5}")
        print("             " + ", ".join(f"{x[1]}·{x[0][:3]}×{k}" for x, k in ejemplos.most_common(8)))


if __name__ == "__main__":
    main()

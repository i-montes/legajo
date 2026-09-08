#!/usr/bin/env python3
"""Compara dos corridas del banco: en qué coinciden y en qué no.

Sin patrón de oro suficiente, lo que sí se puede medir es cuánto se parecen dos
modelos entre sí sobre el mismo texto, y dónde discrepan: los tipos donde un
modelo ve el doble que el otro son donde hay que ir a mirar.

    .venv/bin/python sidecar/banco_comparar.py sidecar/banco/base-mps.json sidecar/banco/relex-mps.json
"""
import json
import sys
from collections import Counter

import pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import REDACCIONES  # noqa: E402

# Cada redacción de etiquetas vuelve a su clave interna, sea cual sea.
CLAVES = {v: k for r in REDACCIONES.values() for k, v in r.items() if not k.startswith("_")}


def clave(e):
    return CLAVES.get(e["etiqueta"], e["etiqueta"])


def conjunto(corrida, umbral):
    """Las entidades como (wp, pi, ini, fin, tipo) por encima del corte."""
    s = {}
    for art in corrida["por_articulo"]:
        for e in art["entidades"]:
            if e["score"] >= umbral:
                s[(art["wp_id"], e["pi"], e["inicio"], e["fin"], clave(e))] = e
    return s


def solapa(a, b):
    """Misma regla que la calibración: mismo párrafo, solape, mismo tipo."""
    return a[0] == b[0] and a[1] == b[1] and a[4] == b[4] and a[2] < b[3] and b[2] < a[3]


def casar(A, B):
    """Cuántas de A tienen una pareja en B (por solape), por tipo."""
    por_wp_pi = {}
    for k in B:
        por_wp_pi.setdefault((k[0], k[1]), []).append(k)
    casadas, sueltas = Counter(), Counter()
    ejemplos = {}
    for k, e in A.items():
        cand = por_wp_pi.get((k[0], k[1]), [])
        if any(solapa(k, c) for c in cand):
            casadas[k[4]] += 1
        else:
            sueltas[k[4]] += 1
            ejemplos.setdefault(k[4], []).append((round(e["score"], 2), e["texto"]))
    return casadas, sueltas, ejemplos


def main():
    a, b = (json.load(open(p)) for p in sys.argv[1:3])
    umbral = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
    # Solo los artículos que las dos corridas comparten: una corrida más larga
    # no «encuentra más», simplemente leyó más.
    comunes = {x["wp_id"] for x in a["por_articulo"]} & {x["wp_id"] for x in b["por_articulo"]}
    for c in (a, b):
        c["por_articulo"] = [x for x in c["por_articulo"] if x["wp_id"] in comunes]
        c["segundos_total"] = round(sum(x["segundos"] for x in c["por_articulo"]), 1)
    A, B = conjunto(a, umbral), conjunto(b, umbral)
    print(f"{len(comunes)} artículos en común")
    print(f"{a['nombre']}: {len(A)} entidades ≥{umbral} · {b['nombre']}: {len(B)}")
    print(f"tiempo: {a['segundos_total']} s frente a {b['segundos_total']} s "
          f"({a['seg_por_mil_palabras_mediana']} vs {b['seg_por_mil_palabras_mediana']} s/1k pal)\n")

    cas_a, sol_a, ej_a = casar(A, B)
    cas_b, sol_b, ej_b = casar(B, A)
    tipos = sorted(set(cas_a) | set(sol_a) | set(cas_b) | set(sol_b))
    print(f"{'tipo':<14}{a['nombre']:>14}{'solo A':>9}{b['nombre']:>14}{'solo B':>9}{'acuerdo':>9}")
    for t in tipos:
        na, nb = cas_a[t] + sol_a[t], cas_b[t] + sol_b[t]
        acuerdo = 2 * cas_a[t] / (na + nb) if na + nb else 0
        print(f"{t:<14}{na:>14}{sol_a[t]:>9}{nb:>14}{sol_b[t]:>9}{acuerdo:>8.0%}")
    tot_a, tot_b = sum(cas_a.values()) + sum(sol_a.values()), sum(cas_b.values()) + sum(sol_b.values())
    print(f"{'total':<14}{tot_a:>14}{sum(sol_a.values()):>9}{tot_b:>14}{sum(sol_b.values()):>9}"
          f"{2 * sum(cas_a.values()) / (tot_a + tot_b):>8.0%}")

    for nombre, ej in ((a["nombre"], ej_a), (b["nombre"], ej_b)):
        print(f"\nSolo en {nombre} (muestra por tipo, con su confianza):")
        for t in tipos:
            if ej.get(t):
                xs = sorted(ej[t], reverse=True)[:6]
                print(f"  {t:<13} " + " · ".join(f"{s} {x!r}" for s, x in xs))

    ra = Counter(r["predicado"] for art in a["por_articulo"] for r in art["relaciones"])
    rb = Counter(r["predicado"] for art in b["por_articulo"] for r in art["relaciones"])
    if ra or rb:
        print(f"\nrelaciones: {sum(ra.values())} frente a {sum(rb.values())}")
        for p in sorted(set(ra) | set(rb), key=lambda p: -(ra[p] + rb[p])):
            print(f"  {p:<16}{ra[p]:>5}{rb[p]:>6}")


if __name__ == "__main__":
    main()

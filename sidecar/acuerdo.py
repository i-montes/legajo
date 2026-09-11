#!/usr/bin/env python3
"""Acuerdo entre dos anotadores LLM sobre los párrafos que comparten: qué
entidades (tramo y tipo) y qué relaciones (par y predicado) marcaron los dos,
cuáles solo uno. Donde coinciden, plata de alta confianza; donde no, la lista
corta para auditar (se escribe en discrepancias.jsonl).

    .venv/bin/python sidecar/acuerdo.py --a plata.jsonl --b plata-mm.jsonl [--nombres gpt-oss,MiniMax]
"""
import argparse
import json
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import SALIDAS, CLAVE_SENUELO  # noqa: E402
from vocabulario import PREDICADOS_DICT  # noqa: E402
from limpieza import repetir_menciones  # noqa: E402

SIMETRICO = {p["etiqueta"]: p["simetrico"] for p in PREDICADOS_DICT}


def cargar(ruta):
    out = {}
    for l in open(ruta, encoding="utf-8"):
        f = json.loads(l)
        if not f.get("invalido"):
            repetir_menciones(f["texto"], f["entidades"])  # las dos platas con la misma limpieza
            out[(f["wp_id"], f["pi"])] = f
    return out


def claves(f):
    ents = {(e["ini"], e["fin"], e["tipo"]) for e in f["entidades"] if e["tipo"] != CLAVE_SENUELO}
    tramos = {(e["ini"], e["fin"]) for e in f["entidades"] if e["tipo"] != CLAVE_SENUELO}
    rels = set()
    for r in f["relaciones"]:
        a, b = f["entidades"][r["a"]], f["entidades"][r["b"]]
        par = frozenset((a["texto"].lower(), b["texto"].lower())) if SIMETRICO.get(r["predicado"]) else (a["texto"].lower(), b["texto"].lower())
        rels.add((par, r["predicado"]))
    return ents, tramos, rels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", default=str(SALIDAS / "plata.jsonl"))
    ap.add_argument("--b", default=str(SALIDAS / "plata-mm.jsonl"))
    ap.add_argument("--nombres", default="A,B")
    ap.add_argument("--salida", default=str(SALIDAS / "discrepancias.jsonl"))
    args = ap.parse_args()
    na, nb = args.nombres.split(",")
    A, B = cargar(args.a), cargar(args.b)
    comunes = sorted(set(A) & set(B))
    print(f"{len(A)} párrafos en {na}, {len(B)} en {nb}, {len(comunes)} en común")
    c = Counter(); por_tipo = Counter(); por_pred = Counter()
    disc = []
    for k in comunes:
        ea, ta, ra = claves(A[k]); eb, tb, rb = claves(B[k])
        c["ent_a"] += len(ea); c["ent_b"] += len(eb); c["ent_ambos"] += len(ea & eb)
        c["tramo_ambos"] += len(ta & tb)
        c["rel_a"] += len(ra); c["rel_b"] += len(rb); c["rel_ambos"] += len(ra & rb)
        for _, _, t in ea & eb: por_tipo[(t, "ambos")] += 1
        for _, _, t in ea ^ eb: por_tipo[(t, "uno")] += 1
        for _, p in ra & rb: por_pred[(p, "ambos")] += 1
        for _, p in ra ^ rb: por_pred[(p, "uno")] += 1
        solo_a_e, solo_b_e = ea - eb, eb - ea
        solo_a_r, solo_b_r = ra - rb, rb - ra
        if solo_a_e or solo_b_e or solo_a_r or solo_b_r:
            texto = A[k]["texto"]
            disc.append({"wp_id": k[0], "pi": k[1], "texto": texto,
                         f"solo_{na}": {"entidades": [(texto[i:f], t) for i, f, t in sorted(solo_a_e)], "relaciones": [(sorted(p) if isinstance(p, frozenset) else list(p), pr) for p, pr in solo_a_r]},
                         f"solo_{nb}": {"entidades": [(texto[i:f], t) for i, f, t in sorted(solo_b_e)], "relaciones": [(sorted(p) if isinstance(p, frozenset) else list(p), pr) for p, pr in solo_b_r]}})
    def acuerdo(ambos, a, b):
        return 2 * ambos / (a + b) if a + b else 0
    print(f"entidades (tramo+tipo): {na} {c['ent_a']} · {nb} {c['ent_b']} · ambos {c['ent_ambos']} · acuerdo F1 {acuerdo(c['ent_ambos'], c['ent_a'], c['ent_b']):.2f} (solo tramo {acuerdo(c['tramo_ambos'], c['ent_a'], c['ent_b']):.2f})")
    print(f"relaciones (par+predicado): {na} {c['rel_a']} · {nb} {c['rel_b']} · ambos {c['rel_ambos']} · acuerdo F1 {acuerdo(c['rel_ambos'], c['rel_a'], c['rel_b']):.2f}")
    print("\npor tipo (ambos / solo uno):")
    for t in sorted({t for t, _ in por_tipo}):
        print(f"  {t:<14} {por_tipo[(t, 'ambos')]:>5} / {por_tipo[(t, 'uno')]:<5} acuerdo {2 * por_tipo[(t, 'ambos')] / (2 * por_tipo[(t, 'ambos')] + por_tipo[(t, 'uno')]):.2f}")
    print("\npor predicado (ambos / solo uno), los 15 más frecuentes:")
    for p, _ in Counter({p: por_pred[(p, 'ambos')] + por_pred[(p, 'uno')] for p, _ in por_pred}).most_common(15):
        amb, uno = por_pred[(p, 'ambos')], por_pred[(p, 'uno')]
        print(f"  {p:<22} {amb:>4} / {uno:<4} acuerdo {2 * amb / (2 * amb + uno):.2f}")
    with open(args.salida, "w", encoding="utf-8") as out:
        for d in disc:
            out.write(json.dumps(d, ensure_ascii=False) + "\n")
    print(f"\n{len(disc)} párrafos con alguna discrepancia → {args.salida}")


if __name__ == "__main__":
    main()

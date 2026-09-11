#!/usr/bin/env python3
"""El techo del anotador: qué P/R/F1 saca la plata de un LLM contra el oro
humano de los mismos párrafos. El modelo afinado aprende de esa plata, así que
difícilmente la supera; si el techo es bajo, hay que mejorar al anotador
(prompt, consenso, oro) antes que entrenar más.

    .venv/bin/python sidecar/techo.py --plata ~/lsv/datos/entrenamiento/apartado-mm-v5.jsonl --oro sidecar/entrenamiento/v2/apartado.jsonl
"""
import argparse
import json
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco_relaciones import SIMETRICO, solapan  # noqa: E402
from exportar_patron import ejemplo  # noqa: E402
from limpieza import repetir_menciones, separar_titulos  # noqa: E402
from vocabulario import CLAVE_DE_ETIQUETA, SENUELO, TIPOS  # noqa: E402


def prf(v, f, n):
    p = v / (v + f) if v + f else 0.0; r = v / (v + n) if v + n else 0.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plata", required=True)
    ap.add_argument("--oro", required=True, help="conjunto en formato gliner (p. ej. apartado.jsonl); su .meta.jsonl da wp_id/pi")
    args = ap.parse_args()
    oro = [json.loads(l) for l in open(args.oro, encoding="utf-8")]
    meta = [json.loads(l) for l in open(args.oro.replace(".jsonl", ".meta.jsonl"), encoding="utf-8")]
    oro_por = {(m["wp_id"], m["pi"]): o for m, o in zip(meta, oro)}
    plata = {}
    for l in open(args.plata, encoding="utf-8"):
        f = json.loads(l)
        if f.get("invalido"):
            continue
        separar_titulos(f["texto"], f["entidades"], f["relaciones"]); repetir_menciones(f["texto"], f["entidades"])
        ej, _ = ejemplo(f["texto"], f["entidades"], f["relaciones"], Counter())
        plata[(f["wp_id"], f["pi"])] = ej
    comunes = [k for k in oro_por if k in plata]
    print(f"{len(comunes)} párrafos en común ({len(oro_por)} de oro, {len(plata)} de plata)")
    vp = Counter(); fp = Counter(); fn = Counter(); rvp = Counter(); rfp = Counter(); rfn = Counter()
    for k in comunes:
        o, p = oro_por[k], plata[k]
        oro_e = [(a, b, et) for a, b, et in o["ner"] if et != SENUELO]
        pl_e = [(a, b, et) for a, b, et in p["ner"] if et != SENUELO]
        usados = set(); casa = {}
        for i, (a, b, et) in enumerate(pl_e):
            j = next((j for j, (c, d, et2) in enumerate(oro_e) if j not in usados and et2 == et and solapan((a, b), (c, d))), None)
            if j is None: fp[CLAVE_DE_ETIQUETA[et]] += 1
            else: usados.add(j); vp[CLAVE_DE_ETIQUETA[et]] += 1; casa[i] = j
        for j, (_, _, et) in enumerate(oro_e):
            if j not in usados: fn[CLAVE_DE_ETIQUETA[et]] += 1
        def rels(ej, ents_sin_senuelo):
            idx = {}; n = 0
            for j, (_, _, et) in enumerate(ej["ner"]):
                if et != SENUELO: idx[j] = n; n += 1
            return {(frozenset((idx[a], idx[b])) if SIMETRICO.get(pr) else (idx[a], idx[b]), pr) for a, b, pr in ej["relations"] if a in idx and b in idx}
        oro_r = rels(o, oro_e); pl_r = rels(p, pl_e)
        vistas = set()
        for par, pr in pl_r:
            ids = list(par) if isinstance(par, frozenset) else par
            if not all(i in casa for i in ids): rfp[pr] += 1; continue
            clave = (frozenset(casa[i] for i in ids) if isinstance(par, frozenset) else (casa[ids[0]], casa[ids[1]]), pr)
            if clave in oro_r and clave not in vistas: rvp[pr] += 1; vistas.add(clave)
            else: rfp[pr] += 1
        for clave in oro_r - vistas: rfn[clave[1]] += 1
    print(f"\n{'':<22}{'P':>6}{'R':>6}{'F1':>6}{'oro':>6}")
    for t in TIPOS:
        P, R, F = prf(vp[t], fp[t], fn[t]); print(f"{t:<22}{P:6.2f}{R:6.2f}{F:6.2f}{vp[t] + fn[t]:6d}")
    P, R, F = prf(sum(vp.values()), sum(fp.values()), sum(fn.values())); print(f"{'ENTIDADES':<22}{P:6.2f}{R:6.2f}{F:6.2f}")
    print()
    for pr in sorted({*rvp, *rfp, *rfn}, key=lambda x: -(rvp[x] + rfn[x])):
        if rvp[pr] + rfn[pr] + rfp[pr] < 5: continue
        P, R, F = prf(rvp[pr], rfp[pr], rfn[pr]); print(f"{pr:<22}{P:6.2f}{R:6.2f}{F:6.2f}{rvp[pr] + rfn[pr]:6d}")
    P, R, F = prf(sum(rvp.values()), sum(rfp.values()), sum(rfn.values())); print(f"{'RELACIONES':<22}{P:6.2f}{R:6.2f}{F:6.2f}")


if __name__ == "__main__":
    main()

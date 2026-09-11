#!/usr/bin/env python3
"""Precisión, cobertura y F1 por tipo de entidad y por predicado, de un modelo
GLiNER-relex sobre un conjunto en formato de entrenamiento (val, apartado).

Paso 7 de docs/plan-entrenamiento.md. Casa entidades por solape de tramo y
mismo tipo; relaciones por extremos casados y predicado exacto, con las
simétricas en cualquier dirección; la dirección de las asimétricas se mide
aparte. Se usa para comparar la base contra cada checkpoint afinado.

    .venv/bin/python sidecar/banco_relaciones.py --datos sidecar/entrenamiento/v1 --conjunto val \\
        --modelo knowledgator/gliner-relex-multi-v1.0 --modelo sidecar/entrenamiento/20260909-lr1e-05/final
"""
import argparse
import json
import pathlib
import sys
import time
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from exportar_patron import PATRON, a_tokens  # noqa: E402
from vocabulario import CLAVE_DE_ETIQUETA, ETIQUETA, PREDICADOS_DICT, SENUELO, TIPOS  # noqa: E402

SIMETRICO = {p["etiqueta"]: p["simetrico"] for p in PREDICADOS_DICT}


def solapan(a, b):
    return not (a[1] < b[0] or b[1] < a[0])


def predecir(modelo, texto, etiquetas, predicados, umbral, umbral_rel):
    e, r = modelo.predict_relations(texto, etiquetas, predicados, threshold=umbral, relation_threshold=umbral_rel)
    tokens = [(m.group(), m.start(), m.end()) for m in PATRON.finditer(texto)]
    ents = []
    for c in e:
        if c["label"] not in CLAVE_DE_ETIQUETA:
            continue
        p, u = a_tokens(c["start"], c["end"], tokens, Counter())
        if p is not None:
            ents.append((p, u, c["label"], c["text"], float(c["score"])))
    idx_por_texto = defaultdict(list)
    for i, x in enumerate(ents):
        idx_por_texto[x[3]].append(i)
    rels = []
    for x in r:
        a, b = x.get("head", {}).get("text"), x.get("tail", {}).get("text")
        ia, ib = idx_por_texto.get(a, [None])[0], idx_por_texto.get(b, [None])[0]
        if ia is None or ib is None or ia == ib:
            continue
        rels.append((ia, ib, x.get("relation") or x.get("label"), float(x.get("score", 0))))
    return ents, rels


def evaluar(modelo_id, ejemplos, metas, umbral, umbral_rel):
    from gliner import GLiNER
    import torch
    m = GLiNER.from_pretrained(modelo_id)
    m.to("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu").eval()
    etiquetas = [ETIQUETA[t] for t in TIPOS] + [SENUELO]
    predicados = [p["etiqueta"] for p in PREDICADOS_DICT]
    vp = Counter(); fp = Counter(); fn = Counter()
    rvp = Counter(); rfp = Counter(); rfn = Counter(); dir_ok = dir_total = 0
    t0 = time.time()
    for ej, meta in zip(ejemplos, metas):
        ents, rels = predecir(m, meta["texto"], etiquetas, predicados, umbral, umbral_rel)
        oro_e = [(a, b, et) for a, b, et in ej["ner"] if et != SENUELO]
        usados = set()
        casa = {}
        for i, (p, u, et, _, _) in enumerate(ents):
            k = next((j for j, (a, b, et2) in enumerate(oro_e) if j not in usados and et2 == et and solapan((p, u), (a, b))), None)
            if k is None:
                fp[CLAVE_DE_ETIQUETA[et]] += 1
            else:
                usados.add(k); vp[CLAVE_DE_ETIQUETA[et]] += 1; casa[i] = k
        for j, (a, b, et) in enumerate(oro_e):
            if j not in usados:
                fn[CLAVE_DE_ETIQUETA[et]] += 1
        # Relaciones: el oro tiene índices sobre ej["ner"] (incluye señuelos); se mapean a oro_e.
        idx_oro = {}
        k = 0
        for j, (a, b, et) in enumerate(ej["ner"]):
            if et != SENUELO:
                idx_oro[j] = k; k += 1
        oro_r = set()
        for a, b, pred in ej["relations"]:
            if a in idx_oro and b in idx_oro:
                oro_r.add((idx_oro[a], idx_oro[b], pred))
        oro_r_sim = {(frozenset((a, b)) if SIMETRICO.get(p) else (a, b), p) for a, b, p in oro_r}
        pred_r_sim = set()
        for ia, ib, pred, _ in rels:
            if ia not in casa or ib not in casa:
                rfp[pred] += 1; continue
            a, b = casa[ia], casa[ib]
            clave = (frozenset((a, b)) if SIMETRICO.get(pred) else (a, b), pred)
            if clave in oro_r_sim:
                rvp[pred] += 1; pred_r_sim.add(clave)
                if not SIMETRICO.get(pred):
                    dir_total += 1; dir_ok += 1
            elif not SIMETRICO.get(pred) and ((b, a), pred) in oro_r_sim:
                rfp[pred] += 1; dir_total += 1  # dirección invertida
            else:
                rfp[pred] += 1
        for clave in oro_r_sim - pred_r_sim:
            rfn[clave[1]] += 1
    seg = time.time() - t0

    def prf(v, f, n):
        p = v / (v + f) if v + f else 0.0; r = v / (v + n) if v + n else 0.0
        return p, r, (2 * p * r / (p + r) if p + r else 0.0)
    filas = {"modelo": modelo_id, "segundos": round(seg, 1), "tipos": {}, "predicados": {}}
    for t in TIPOS:
        filas["tipos"][t] = dict(zip(("P", "R", "F1"), prf(vp[t], fp[t], fn[t]))) | {"oro": vp[t] + fn[t]}
    for p in sorted({*rvp, *rfp, *rfn}):
        filas["predicados"][p] = dict(zip(("P", "R", "F1"), prf(rvp[p], rfp[p], rfn[p]))) | {"oro": rvp[p] + rfn[p]}
    V, F, N = sum(vp.values()), sum(fp.values()), sum(fn.values())
    RV, RF, RN = sum(rvp.values()), sum(rfp.values()), sum(rfn.values())
    filas["global"] = {"entidades": dict(zip(("P", "R", "F1"), prf(V, F, N))), "relaciones": dict(zip(("P", "R", "F1"), prf(RV, RF, RN))),
                       "direccion_ok": dir_ok / dir_total if dir_total else None}
    return filas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datos", required=True)
    ap.add_argument("--conjunto", default="val")
    ap.add_argument("--modelo", action="append", required=True)
    ap.add_argument("--umbral", type=float, default=0.5)
    ap.add_argument("--umbral-rel", type=float, default=0.5)
    ap.add_argument("--limite", type=int, default=None)
    args = ap.parse_args()
    d = pathlib.Path(args.datos)
    ejemplos = [json.loads(l) for l in open(d / f"{args.conjunto}.jsonl", encoding="utf-8")]
    metas = [json.loads(l) for l in open(d / f"{args.conjunto}.meta.jsonl", encoding="utf-8")]
    if args.limite:
        ejemplos, metas = ejemplos[:args.limite], metas[:args.limite]
    resultados = [evaluar(m, ejemplos, metas, args.umbral, args.umbral_rel) for m in args.modelo]
    print(f"\n{args.conjunto}: {len(ejemplos)} párrafos · umbral {args.umbral} / relaciones {args.umbral_rel}\n")
    print(f"{'':<22}" + "".join(f"{r['modelo'].split('/')[-1][:22]:>24}" for r in resultados))
    for t in TIPOS:
        print(f"{t:<22}" + "".join(f"{r['tipos'][t]['P']:.2f}/{r['tipos'][t]['R']:.2f}/{r['tipos'][t]['F1']:.2f} ({r['tipos'][t]['oro']:>3})".rjust(24) for r in resultados))
    print(f"{'ENTIDADES':<22}" + "".join(f"{r['global']['entidades']['P']:.2f}/{r['global']['entidades']['R']:.2f}/{r['global']['entidades']['F1']:.2f}".rjust(24) for r in resultados))
    preds = sorted({p for r in resultados for p in r["predicados"]}, key=lambda p: -max(r["predicados"].get(p, {}).get("oro", 0) for r in resultados))
    for p in preds:
        print(f"{p:<22}" + "".join((f"{x['P']:.2f}/{x['R']:.2f}/{x['F1']:.2f} ({x['oro']:>3})" if (x := r["predicados"].get(p)) else "—").rjust(24) for r in resultados))
    print(f"{'RELACIONES':<22}" + "".join(f"{r['global']['relaciones']['P']:.2f}/{r['global']['relaciones']['R']:.2f}/{r['global']['relaciones']['F1']:.2f}".rjust(24) for r in resultados))
    print(f"{'dirección correcta':<22}" + "".join((f"{r['global']['direccion_ok']:.0%}" if r["global"]["direccion_ok"] is not None else "—").rjust(24) for r in resultados))
    print(f"{'segundos':<22}" + "".join(f"{r['segundos']:.0f}".rjust(24) for r in resultados))
    salida = d / f"evaluacion-{args.conjunto}.json"
    salida.write_text(json.dumps(resultados, ensure_ascii=False, indent=1))
    print(f"\n→ {salida}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""El informe del piloto (docs/plan-entrenamiento.md §4): qué tal anota el
LLM sin y con pistas, y si se cumplen los criterios para seguir.

    .venv/bin/python sidecar/piloto_informe.py [--leer 20]
"""
import argparse
import json
import pathlib
import random
import re
import statistics
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import SALIDAS, CLAVE_SENUELO  # noqa: E402
from alinear_quien_ai import DATOS  # noqa: E402

CON_NOMBRE = ("persona", "organizacion", "lugar", "obra", "ley")


def generico(tx):
    return not re.search(r"[A-ZÁÉÍÓÚÑ0-9]", tx)


def cargar(patron):
    rutas = sorted(SALIDAS.glob(patron))
    if not rutas:
        sys.exit(f"no hay {patron} en {SALIDAS}")
    filas = [json.loads(l) for l in open(rutas[-1], encoding="utf-8")]
    return rutas[-1].name, filas


def familiares_alineados():
    """Por (wp, pi): las relaciones familiares de Quién-AI con su dirección (ya corregida)."""
    out = defaultdict(list)
    for l in open(DATOS / "alineado.jsonl", encoding="utf-8"):
        f = json.loads(l)
        if f["predicado"] and f["wp_id"] is not None:
            out[(f["wp_id"], f["pi"])].append(f)
    return out


def medir(nombre, filas, fam):
    validas = [f for f in filas if not f.get("invalido")]
    seg = [f["segundos"] for f in filas]
    tok = [f["tokens"] / f["segundos"] for f in validas if f.get("tokens") and f["segundos"]]
    ents = [e for f in validas for e in f["entidades"]]
    rels = [r for f in validas for r in f["relaciones"]]
    con_nombre = [e for e in ents if e["tipo"] in CON_NOMBRE]
    minus = sum(1 for e in con_nombre if generico(e["texto"]))
    # Pistas.
    p_ents = sum(f["pistas"]["entidades"] for f in validas if f.get("pistas"))
    p_rec = sum(f["pistas"]["recuperadas"] for f in validas if f.get("pistas"))
    # Familiares: mismo predicado y misma dirección que Quién-AI (corregida).
    fam_total = fam_pred = fam_dir = 0
    for f in validas:
        for q in fam.get((f["wp_id"], f["pi"]), []):
            fam_total += 1
            a_q, b_q = q[q["cabeza"]]["texto"].lower(), q[q["cola"]]["texto"].lower()
            for r in f["relaciones"]:
                ea, eb = f["entidades"][r["a"]]["texto"].lower(), f["entidades"][r["b"]]["texto"].lower()
                par = {ea, eb} == {a_q, b_q} or (a_q in ea or ea in a_q) and (b_q in eb or eb in b_q) or (a_q in eb or eb in a_q) and (b_q in ea or ea in b_q)
                if par and r["predicado"] == q["predicado"]:
                    fam_pred += 1
                    if q["simetrico"] or (ea == a_q or a_q in ea or ea in a_q):
                        fam_dir += 1
                    break
    tipos = Counter(e["tipo"] for e in ents)
    preds = Counter(r["predicado"] for r in rels)
    return {
        "nombre": nombre, "parrafos": len(filas), "invalidos": len(filas) - len(validas),
        "seg_mediana": statistics.median(seg) if seg else 0, "seg_p90": sorted(seg)[int(len(seg) * .9)] if seg else 0,
        "tok_s": statistics.median(tok) if tok else 0,
        "entidades": len(ents), "por_parrafo": len(ents) / max(len(validas), 1), "minusculas": minus / max(len(con_nombre), 1),
        "senuelo": tipos.get(CLAVE_SENUELO, 0), "relaciones": len(rels), "rel_por_parrafo": len(rels) / max(len(validas), 1),
        "pistas_ents": p_ents, "pistas_rec": p_rec, "fam_total": fam_total, "fam_pred": fam_pred, "fam_dir": fam_dir,
        "tipos": dict(tipos.most_common()), "preds": dict(preds.most_common(12)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelo", default="gpt-oss.20b")
    ap.add_argument("--leer", type=int, default=0)
    ap.add_argument("--columna", action="append", help="nombre=patrón, p. ej. 'v2=piloto-con-pistas-*-v2.jsonl' (repetible)")
    ap.add_argument("--solo-comunes", action="store_true", help="medir solo los párrafos presentes en todas las columnas")
    args = ap.parse_args()
    fam = familiares_alineados()
    columnas = [c.split("=", 1) for c in args.columna] if args.columna else [["sin pistas", "piloto-sin-pistas-*-low.jsonl"], ["con pistas", "piloto-con-pistas-*-low.jsonl"]]
    cargadas = [(nombre, cargar(patron)[1]) for nombre, patron in columnas]
    if args.solo_comunes:
        comunes = set.intersection(*[{(f["wp_id"], f["pi"]) for f in filas} for _, filas in cargadas])
        cargadas = [(n, [f for f in filas if (f["wp_id"], f["pi"]) in comunes]) for n, filas in cargadas]
    m = [medir(nombre, filas, fam) for nombre, filas in cargadas]
    sin, con = cargadas[0][1], cargadas[-1][1]
    print(f"{'':<28}" + "".join(f"{x['nombre']:>14}" for x in m))
    for k, et in [("parrafos", "párrafos"), ("invalidos", "JSON inválidos"), ("seg_mediana", "s/párrafo (mediana)"), ("seg_p90", "s/párrafo (p90)"),
                  ("tok_s", "tok/s"), ("entidades", "entidades"), ("por_parrafo", "entidades/párrafo"), ("minusculas", "% minúscula (con nombre)"),
                  ("senuelo", "en señuelo"), ("relaciones", "relaciones"), ("rel_por_parrafo", "relaciones/párrafo")]:
        v = [x[k] for x in m]
        fmt = (lambda z: f"{z:.0%}") if k == "minusculas" else (lambda z: f"{z:.1f}") if isinstance(v[0], float) else str
        print(f"{et:<28}" + "".join(f"{fmt(z):>14}" for z in v))
    for c in m:
        if c["pistas_ents"]:
            print(f"\npistas ({c['nombre']}): entidades de Quién-AI recuperadas {c['pistas_rec']}/{c['pistas_ents']} = {c['pistas_rec']/max(c['pistas_ents'],1):.0%}")
    for x in m:
        print(f"familiares alineados en los párrafos ({x['nombre']}): {x['fam_total']} · mismo predicado {x['fam_pred']} ({x['fam_pred']/max(x['fam_total'],1):.0%}) · y misma dirección {x['fam_dir']}")
    for x in m:
        print(f"\ntipos ({x['nombre']}):", x["tipos"])
        print(f"predicados ({x['nombre']}):", x["preds"])

    if args.leer:
        random.seed(3)
        print(f"\n── {args.leer} párrafos anotados con pistas, para leer ──")
        for f in random.sample([f for f in con if not f.get("invalido")], args.leer):
            print(f"\n[{f['wp_id']} p{f['pi']} {f['estrato']}] {f['texto'][:600]}{'…' if len(f['texto']) > 600 else ''}")
            print("  ENT:", [(e["texto"], e["tipo"]) for e in f["entidades"]])
            print("  REL:", [(f["entidades"][r["a"]]["texto"], r["predicado"], f["entidades"][r["b"]]["texto"], r["cuando"]) for r in f["relaciones"]])
            if f.get("pistas_rechazadas"):
                print("  RECHAZADAS:", [(x.get("a"), x.get("b"), x.get("por_que", "")[:80]) for x in f["pistas_rechazadas"]])


if __name__ == "__main__":
    main()

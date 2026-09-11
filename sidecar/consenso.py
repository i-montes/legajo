"""Plata de consenso: lo que dos anotadores dijeron igual.

Cruza dos ficheros de plata (mismo párrafo = mismo wp_id/pi) y se queda con las
entidades que ambos marcaron con el mismo tramo y tipo, y con las relaciones cuyos
dos extremos son entidades de consenso y cuyo predicado coincide (orden indiferente
en los predicados simétricos). El «cuando» sale del segundo fichero. La idea: la
precisión de la plata sube a costa de cobertura, y el alumno deja de aprender las
relaciones de manga ancha de un solo anotador.

  .venv/bin/python sidecar/consenso.py --a plata-mm.jsonl --b plata-mm-v5.jsonl --salida plata-consenso.jsonl
"""
import argparse
import json
import pathlib
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from vocabulario import PREDICADOS_DICT  # noqa: E402

SIMETRICO = {p["etiqueta"]: p["simetrico"] for p in PREDICADOS_DICT}
SALIDAS = pathlib.Path.home() / "lsv" / "datos" / "entrenamiento"


def leer(ruta):
    filas = {}
    for l in open(ruta, encoding="utf-8"):
        d = json.loads(l)
        if "entidades" in d:  # las filas de error del anotador no traen anotación
            filas[(d["wp_id"], d["pi"])] = d
    return filas


def clave_rel(r, ents):
    a, b = ents[r["a"]], ents[r["b"]]
    ka, kb = (a["ini"], a["fin"]), (b["ini"], b["fin"])
    if SIMETRICO.get(r["predicado"]) and ka > kb:
        ka, kb = kb, ka
    return (ka, kb, r["predicado"])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--a", default=str(SALIDAS / "plata-mm.jsonl"))
    ap.add_argument("--b", default=str(SALIDAS / "plata-mm-v5.jsonl"))
    ap.add_argument("--salida", default=str(SALIDAS / "plata-consenso.jsonl"))
    args = ap.parse_args()
    A, B = leer(args.a), leer(args.b)
    c = Counter()
    with open(args.salida, "w", encoding="utf-8") as f:
        for k in sorted(set(A) & set(B)):
            a, b = A[k], B[k]
            ea = {(e["ini"], e["fin"], e["tipo"]) for e in a["entidades"]}
            ents = [e for e in b["entidades"] if (e["ini"], e["fin"], e["tipo"]) in ea]
            indice = {(e["ini"], e["fin"]): i for i, e in enumerate(ents)}
            ra = {clave_rel(r, a["entidades"]) for r in a["relaciones"]}
            rels = []
            for r in b["relaciones"]:
                x, y = b["entidades"][r["a"]], b["entidades"][r["b"]]
                kx, ky = (x["ini"], x["fin"]), (y["ini"], y["fin"])
                if kx not in indice or ky not in indice or clave_rel(r, b["entidades"]) not in ra:
                    continue
                rels.append({"a": indice[kx], "b": indice[ky], "predicado": r["predicado"], "cuando": r.get("cuando", "vigente")})
            c["parrafos"] += 1; c["ent_a"] += len(a["entidades"]); c["ent_b"] += len(b["entidades"]); c["ent"] += len(ents)
            c["rel_a"] += len(a["relaciones"]); c["rel_b"] += len(b["relaciones"]); c["rel"] += len(rels)
            fila = {**b, "entidades": ents, "relaciones": rels, "prompt": f"consenso({a.get('prompt')},{b.get('prompt')})"}
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
    print(f"{c['parrafos']} párrafos · entidades {c['ent_a']}/{c['ent_b']} → {c['ent']} · relaciones {c['rel_a']}/{c['rel_b']} → {c['rel']} → {args.salida}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Umbrales por predicado (y por tipo): se eligen sobre `val` maximizando F1 y
se miden sobre `apartado`. Es lo que la calibración de la app hace por tipo,
llevado a relaciones, y dice cuánto F1 hay disponible sin tocar el modelo.

    .venv/bin/python sidecar/umbrales.py --datos sidecar/entrenamiento/v1 --modelo sidecar/entrenamiento/v1/lr1e-5/final
"""
import argparse
import json
import pathlib
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco_relaciones import SIMETRICO, predecir, solapan  # noqa: E402
from vocabulario import CLAVE_DE_ETIQUETA, ETIQUETA, PREDICADOS_DICT, SENUELO, TIPOS  # noqa: E402

REJILLA = [round(0.3 + 0.05 * i, 2) for i in range(13)]  # 0,30 … 0,90


def leer(datos, conjunto):
    ej = [json.loads(l) for l in open(datos / f"{conjunto}.jsonl", encoding="utf-8")]
    meta = [json.loads(l) for l in open(datos / f"{conjunto}.meta.jsonl", encoding="utf-8")]
    return ej, meta


def puntuar(m, ejemplos, metas):
    """Por párrafo: lista de (predicado, score, acierto) para cada relación predicha
    con umbral bajo, y el conteo de relaciones de oro por predicado."""
    etiquetas = [ETIQUETA[t] for t in TIPOS] + [SENUELO]
    predicados = [p["etiqueta"] for p in PREDICADOS_DICT]
    predichas = []; oro_por_pred = Counter()
    ent_predichas = []; oro_por_tipo = Counter()
    for ej, meta in zip(ejemplos, metas):
        oro_e = [(a, b, et) for a, b, et in ej["ner"] if et != SENUELO]
        for _, _, et in oro_e: oro_por_tipo[CLAVE_DE_ETIQUETA[et]] += 1
        # Entidades con umbral bajo, para elegir el umbral por tipo.
        # Con umbral 0,1 el modelo devuelve cientos de candidatos y el producto de
        # pares reventaba la memoria (16 GB); 0,3 es el suelo útil.
        ents_bajo, _ = predecir(m, meta["texto"], etiquetas, predicados, 0.3, 0.99)
        usados = set()
        for i, (p, u, et, _, sc) in enumerate(ents_bajo):
            k = next((j for j, (a, b, et2) in enumerate(oro_e) if j not in usados and et2 == et and solapan((p, u), (a, b))), None)
            if k is not None:
                usados.add(k)
            ent_predichas.append((CLAVE_DE_ETIQUETA[et], sc, k is not None))
        # Relaciones sobre las entidades al umbral de trabajo (0,5), como en la app.
        ents, rels = predecir(m, meta["texto"], etiquetas, predicados, 0.5, 0.2)
        usados = set(); casa = {}
        for i, (p, u, et, _, sc) in enumerate(ents):
            k = next((j for j, (a, b, et2) in enumerate(oro_e) if j not in usados and et2 == et and solapan((p, u), (a, b))), None)
            if k is not None:
                usados.add(k); casa[i] = k
        idx_oro = {}; k = 0
        for j, (a, b, et) in enumerate(ej["ner"]):
            if et != SENUELO: idx_oro[j] = k; k += 1
        oro_r = {(frozenset((idx_oro[a], idx_oro[b])) if SIMETRICO.get(p) else (idx_oro[a], idx_oro[b]), p) for a, b, p in ej["relations"] if a in idx_oro and b in idx_oro}
        for _, p in oro_r: oro_por_pred[p] += 1
        vistas = set()
        for ia, ib, pred, sc in rels:
            ok = False
            if ia in casa and ib in casa:
                clave = (frozenset((casa[ia], casa[ib])) if SIMETRICO.get(pred) else (casa[ia], casa[ib]), pred)
                if clave in oro_r and clave not in vistas:
                    ok = True; vistas.add(clave)
            predichas.append((pred, sc, ok))
    return predichas, oro_por_pred, ent_predichas, oro_por_tipo


def f1_con(predichas, oro, umbrales, por_defecto):
    vp = Counter(); fp = Counter()
    for p, sc, ok in predichas:
        if sc >= umbrales.get(p, por_defecto):
            (vp if ok else fp)[p] += 1
    V, F, N = sum(vp.values()), sum(fp.values()), sum(oro.values()) - sum(vp.values())
    P = V / (V + F) if V + F else 0; R = V / (V + N) if V + N else 0
    return P, R, (2 * P * R / (P + R) if P + R else 0)


def elegir(predichas, oro, por_defecto, minimo=3, mejores=None):
    """Umbral por predicado que maximiza su F1 en el conjunto de elección. Si se pasa
    `mejores` (dict), guarda ahí el F1 alcanzado, para poder podar los predicados que
    el modelo no distingue ni con el mejor umbral."""
    umbrales = {}
    for p in oro:
        if oro[p] < minimo:
            continue
        mejor = (f1_con([x for x in predichas if x[0] == p], {p: oro[p]}, {p: por_defecto}, por_defecto)[2], por_defecto)
        for u in REJILLA:
            f = f1_con([x for x in predichas if x[0] == p], {p: oro[p]}, {p: u}, u)[2]
            if f > mejor[0] + 1e-9:
                mejor = (f, u)
        umbrales[p] = mejor[1]
        if mejores is not None:
            mejores[p] = mejor[0]
    return umbrales


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--datos", required=True)
    ap.add_argument("--modelo", required=True)
    ap.add_argument("--elegir-en", default="val")
    ap.add_argument("--medir-en", default="apartado")
    ap.add_argument("--dispositivo", default=None, help="cpu para no pelear la GPU con un entrenamiento en curso")
    args = ap.parse_args()
    from gliner import GLiNER
    import torch
    m = GLiNER.from_pretrained(args.modelo)
    m.to(args.dispositivo or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")).eval()
    datos = pathlib.Path(args.datos)
    pv, ov, ev, otv = puntuar(m, *leer(datos, args.elegir_en))
    pa, oa, ea, ota = puntuar(m, *leer(datos, args.medir_en))
    mejores = {}
    um_rel = elegir(pv, ov, 0.5, mejores=mejores); um_ent = elegir(ev, otv, 0.5)
    podados = {p: (1.01 if mejores[p] < 0.2 else u) for p, u in um_rel.items()}
    fuera = sorted(p for p in podados if podados[p] > 1)
    print(f"umbrales elegidos en {args.elegir_en} (predicados con ≥3 ejemplos): " + ", ".join(f"{p} {u}" for p, u in sorted(um_rel.items())))
    print("umbrales de entidad: " + ", ".join(f"{t} {u}" for t, u in sorted(um_ent.items())))
    print(f"\n{args.medir_en}: relaciones P/R/F1")
    print("podados (F1 < 0,2 aun con su mejor umbral): " + (", ".join(fuera) or "ninguno"))
    for nombre, um, defecto in (("global 0,5", {}, 0.5), ("global 0,7", {}, 0.7), ("global 0,8", {}, 0.8), ("por predicado", um_rel, 0.5),
                                ("por pred., resto 0,7", um_rel, 0.7), ("podados, resto 0,7", podados, 0.7), ("podados, resto 0,8", podados, 0.8)):
        P, R, F = f1_con(pa, oa, um, defecto); print(f"  {nombre:<22} {P:.2f}/{R:.2f}/{F:.2f}")
    print(f"{args.medir_en}: entidades P/R/F1")
    for nombre, um, defecto in (("global 0,5", {}, 0.5), ("por tipo", um_ent, 0.5)):
        P, R, F = f1_con(ea, ota, um, defecto); print(f"  {nombre:<14} {P:.2f}/{R:.2f}/{F:.2f}")
    json.dump({"relaciones": um_rel, "podados": fuera, "f1_por_predicado": mejores, "entidades": um_ent, "elegidos_en": args.elegir_en}, open(datos / f"umbrales-{pathlib.Path(args.modelo).parent.name}-{args.elegir_en}.json", "w"), indent=1)


if __name__ == "__main__":
    main()

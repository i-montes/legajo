#!/usr/bin/env python3
"""Elige los párrafos que se van a anotar, por estratos, con semilla fija.

Paso 5.3 de docs/plan-entrenamiento.md. Todos fuera del apartado, de 40–200
palabras salvo donde se indica, sin etiquetas de hablante ni párrafos de una
línea. Escribe sidecar/entrenamiento/seleccion.jsonl con (wp_id, pi, estrato) y
un resumen. `--escala 0.25` toma la cuarta parte de cada estrato, para una
primera pasada corta.

    .venv/bin/python sidecar/seleccionar.py
    .venv/bin/python sidecar/seleccionar.py --escala 0.25
"""
import argparse
import json
import pathlib
import random
import re
import sqlite3
import sys
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO  # noqa: E402
from alinear_quien_ai import DATOS, leer, oid  # noqa: E402
from apartar import apartados  # noqa: E402
from legajo_ner import ETIQUETA_HABLANTE  # noqa: E402

SALIDA = pathlib.Path(__file__).parent / "entrenamiento" / "seleccion.jsonl"
SEMILLA = 2026
CUOTAS = {"F": None, "PL": 1200, "J": 400, "E": 300, "N": 200, "A": 200, "R": 400}  # F: todos los que haya

RE_J = re.compile(r"\b(investig\w*|imput\w*|acus\w*|conden\w*|demand\w*|fiscal\w*|procurad\w*|tutela|sancion\w*)", re.I)
RE_E_MONTO = re.compile(r"\d[\d.,]*\s*(mil|millones|billones|pesos|dólares|dolares|%|por ciento)", re.I)
RE_E_VERBO = re.compile(r"\b(financ\w*|contrat\w*|don[oó]\w*|socio\w*|aport\w*|pag[oó]\w*)", re.I)
RE_N = re.compile(r"\b(Ley|Decreto|Resolución|Resolucion|Sentencia|Acto Legislativo|Acuerdo)\s+\d|\bartículo\s+\d+", re.I)
RE_A = re.compile(r"\b(aspira\w*|candidat\w*|precandidat\w*|renunci\w*|reemplaz\w*|sucedi\w*|nombr\w*|design\w*|posesion\w*)", re.I)


def valido(p, quienes):
    n = len(p.split())
    if not (40 <= n <= 200):
        return False
    if ETIQUETA_HABLANTE.match(p) and ETIQUETA_HABLANTE.match(p).group(1) in quienes:
        return False
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--escala", type=float, default=1.0)
    ap.add_argument("--validacion", type=int, default=250)
    ap.add_argument("--salida", default=None, help="por defecto sidecar/entrenamiento/seleccion.jsonl")
    args = ap.parse_args()
    global SALIDA
    if args.salida:
        SALIDA = pathlib.Path(args.salida)
    random.seed(SEMILLA)
    wps_ap, oids_ap = apartados()

    # Artículos con extracción de Quién-AI y texto en Legajo: el universo.
    con = sqlite3.connect(args.db)
    url_a_wp = {}
    for wp, link in con.execute("SELECT wp_id, link FROM census"):
        from alinear_quien_ai import normalizar_url
        url_a_wp[normalizar_url(link)] = wp
    con_extraccion = set()
    for corrida in ("gemi", "deep"):
        for d in leer(f"news_metadata_{corrida}"):
            con_extraccion.add(oid(d["news_id"]))
    wps_universo = set()
    for d in leer("news"):
        if oid(d["_id"]) in con_extraccion:
            from alinear_quien_ai import normalizar_url
            wp = url_a_wp.get(normalizar_url(d.get("url", "")))
            if wp is not None and wp not in wps_ap:
                wps_universo.add(wp)
    print(f"universo: {len(wps_universo):,} artículos con extracción, fuera del apartado", file=sys.stderr)

    # Párrafos de esos artículos, con sus hablantes.
    parrafos = {}  # wp -> lista de (pi, texto) válidos
    from legajo_ner import hablantes
    marcas = ",".join(str(w) for w in wps_universo)
    for wp, texto in con.execute(f"SELECT wp_id, text_plain FROM articles WHERE wp_id IN ({marcas}) AND text_plain IS NOT NULL"):
        ps = [p for p in texto.split("\n\n") if p.strip()]
        if not ps or sum(1 for p in ps if len(p.split()) < 12) / len(ps) > 0.6:
            continue  # transcripciones
        q = hablantes(ps)
        parrafos[wp] = [(pi, p) for pi, p in enumerate(ps) if valido(p, q)]
    todos = [(wp, pi, p) for wp, lst in parrafos.items() for pi, p in lst]
    print(f"párrafos válidos: {len(todos):,}", file=sys.stderr)

    # Pistas alineadas por párrafo.
    fam, pl = set(), set()
    for l in open(DATOS / "alineado.jsonl", encoding="utf-8"):
        f = json.loads(l)
        if f["wp_id"] is None or f["wp_id"] in wps_ap:
            continue
        (fam if f["predicado"] else pl).add((f["wp_id"], f["pi"]))
    pl -= fam
    judiciales = set()
    for d in leer("processed_news_2"):
        pass  # los apellidos por artículo se resuelven abajo por regex; la colección marca artículos con procesos
    # Artículos con procesos judiciales según Quién-AI, por URL.
    from alinear_quien_ai import normalizar_url
    wps_j = set()
    for d in leer("processed_news_2"):
        wp = url_a_wp.get(normalizar_url(d.get("new_url", "")))
        if wp is not None:
            wps_j.add(wp)

    def pool(cond):
        return [(wp, pi) for wp, pi, p in todos if cond(wp, pi, p)]

    validos = {(wp, pi) for wp, pi, _ in todos}
    estratos = {
        "F": [k for k in fam if k in validos],
        "PL": [k for k in pl if k in validos],
        "J": pool(lambda wp, pi, p: wp in wps_j and RE_J.search(p) and (wp, pi) not in fam),
        "E": pool(lambda wp, pi, p: RE_E_MONTO.search(p) and RE_E_VERBO.search(p)),
        "N": pool(lambda wp, pi, p: RE_N.search(p)),
        "A": pool(lambda wp, pi, p: RE_A.search(p)),
        "R": [(wp, pi) for wp, pi, _ in todos],
    }
    elegidos, usados = [], set()
    for e, cuota in CUOTAS.items():
        cand = [k for k in estratos[e] if k not in usados]
        random.shuffle(cand)
        n = len(cand) if cuota is None else int(round(cuota * args.escala))
        if e == "F" and args.escala < 1:
            n = int(round(len(cand) * args.escala))
        for k in cand[:n]:
            elegidos.append({"wp_id": k[0], "pi": k[1], "estrato": e}); usados.add(k)
    random.shuffle(elegidos)
    nv = int(round(args.validacion * args.escala))
    for i, f in enumerate(elegidos):
        f["conjunto"] = "val" if i < nv else "train"

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as f:
        for e in elegidos:
            f.write(json.dumps(e, ensure_ascii=False) + "\n")
    print(f"\n{len(elegidos):,} párrafos → {SALIDA}")
    print("  por estrato:", dict(Counter(e["estrato"] for e in elegidos)))
    print("  disponibles por estrato:", {k: len(v) for k, v in estratos.items()})
    print("  validación:", sum(1 for e in elegidos if e["conjunto"] == "val"))
    print("  artículos distintos:", len({e["wp_id"] for e in elegidos}))


if __name__ == "__main__":
    main()

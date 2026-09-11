#!/usr/bin/env python3
"""Corregir los 30 artículos apartados desde fuera de la app.

    hoja WP        imprime el artículo con las propuestas vigentes, párrafo a párrafo
    aplicar F.json escribe la corrección como anotaciones humanas del lote (igual que
                   hace la app al guardar y cerrar un artículo)
    estado         qué artículos del lote están cerrados

El JSON de corrección: {"wp_id": N, "parrafos": {"3": {"E": [["texto","tipo"], ...],
"R": [["a","predicado","b","cuando"], ...]}, ...}}. Un párrafo que no aparece
conserva las propuestas tal cual. Un párrafo con "E": [] queda sin marcas.
Cada texto se marca en todas sus apariciones exactas del párrafo (montos no).
Un tipo con asterisco («cargo*») marca «designa»: descripción de alguien que
el texto no nombra.
"""
import argparse
import json
import pathlib
import re
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import DB_POR_DEFECTO  # noqa: E402
from limpieza import repetir_menciones  # noqa: E402
from vocabulario import PREDICADOS_DICT, TIPOS  # noqa: E402

LOTE = 7
SIMETRICO = {p["etiqueta"]: p["simetrico"] for p in PREDICADOS_DICT}
PREDS = set(SIMETRICO)
ADMITE = {p["etiqueta"]: (set(p["desde"]), set(p["hasta"])) for p in PREDICADOS_DICT}


def admitida(pred, ta, tb):
    """Una lista vacía en el vocabulario significa «cualquier tipo»."""
    desde, hasta = ADMITE[pred]
    return (not desde or ta in desde) and (not hasta or tb in hasta)


def parrafos_de(con, wp):
    (texto,) = con.execute("SELECT text_plain FROM articles WHERE wp_id = ?", (wp,)).fetchone()
    return [p for p in texto.split("\n\n") if p.strip()]


def propuestas(con, wp):
    ents, rels = {}, {}
    for pi, ini, fin, tx, tipo in con.execute("SELECT pi, ini, fin, texto, etiqueta FROM extraidas WHERE lote_id=? AND wp_id=? ORDER BY pi, ini", (LOTE, wp)):
        ents.setdefault(pi, []).append({"ini": ini, "fin": fin, "texto": tx, "tipo": tipo})
    for pi, a, b, pred in con.execute("SELECT pi, a, b, predicado FROM relaciones_extraidas WHERE lote_id=? AND wp_id=? ORDER BY pi", (LOTE, wp)):
        rels.setdefault(pi, []).append((a, pred, b, "vigente"))
    return ents, rels


def hoja(con, wp):
    ps = parrafos_de(con, wp)
    ents, rels = propuestas(con, wp)
    fecha, titulo = con.execute("SELECT date, title FROM census WHERE wp_id = ?", (wp,)).fetchone()
    print(f"### {wp} · {fecha[:10] if fecha else '?'} · {titulo}\n")
    for pi, p in enumerate(ps):
        print(f"[{pi}] {p}")
        vistos = {}
        for e in ents.get(pi, []):
            vistos[(e["texto"], e["tipo"])] = vistos.get((e["texto"], e["tipo"]), 0) + 1
        if vistos:
            print("   E: " + " · ".join(f"{t}:{tp}" + (f"×{n}" if n > 1 else "") for (t, tp), n in vistos.items()))
        for a, pred, b, _ in rels.get(pi, []):
            print(f"   R: {a} —{pred}→ {b}")
        print()


def aplicar(con, ruta):
    spec = json.load(open(ruta, encoding="utf-8"))
    wp = spec["wp_id"]
    ps = parrafos_de(con, wp)
    ents_p, rels_p = propuestas(con, wp)
    menciones, relaciones = [], []
    problemas = []
    for pi, p in enumerate(ps):
        c = spec["parrafos"].get(str(pi))
        if c is None:
            ents = [dict(e) for e in ents_p.get(pi, [])]
            rels = rels_p.get(pi, [])
        else:
            ents = []
            # Los nombres largos primero: si «Ramírez» se marcara antes que
            # «Marta Lucía Ramírez», le robaría el tramo.
            for tx, tipo in sorted(c.get("E", []), key=lambda e: -len(e[0])):
                designa = tipo.endswith("*"); tipo = tipo.rstrip("*")
                if tipo not in TIPOS:
                    problemas.append(f"p{pi}: tipo desconocido {tipo}"); continue
                ocurrencias = [m.span() for m in re.finditer(r"(?<!\w)" + re.escape(tx) + r"(?!\w)", p)] or [m.span() for m in re.finditer(re.escape(tx), p)]
                if not ocurrencias:
                    problemas.append(f"p{pi}: no está «{tx}»"); continue
                if tipo == "monto":
                    ocurrencias = ocurrencias[:1]
                for a, b in ocurrencias:
                    if any(a < e["fin"] and b > e["ini"] for e in ents):
                        continue
                    ents.append({"ini": a, "fin": b, "texto": tx, "tipo": tipo, "designa": designa})
            rels = [tuple(r) if len(r) == 4 else (*r, "vigente") for r in c.get("R", [])]
        repetir_menciones(p, ents)
        ents.sort(key=lambda e: e["ini"])
        mids, tipos = {}, {}
        for e in ents:
            mid = f"m{pi}-{e['ini']}-{e['fin']}"
            mids.setdefault(e["texto"], mid)
            tipos.setdefault(e["texto"], e["tipo"])
            menciones.append((mid, pi, e["ini"], e["fin"], e["texto"], e["tipo"], int(e.get("designa", False))))
        for a, pred, b, cuando in rels:
            if pred not in PREDS:
                problemas.append(f"p{pi}: predicado desconocido «{pred}»"); continue
            if a not in mids or b not in mids:
                problemas.append(f"p{pi}: relación con extremo sin marca: {a} / {b}"); continue
            if not admitida(pred, tipos[a], tipos[b]):
                problemas.append(f"p{pi}: «{pred}» no admite {tipos[a]} → {tipos[b]} ({a} / {b})"); continue
            am, bm = mids[a], mids[b]
            if am == bm:
                problemas.append(f"p{pi}: relación de una marca consigo misma: {a} —{pred}→ {b}"); continue
            if SIMETRICO[pred] and am > bm:
                am, bm = bm, am
            relaciones.append((f"r{pi}-{am}-{bm}", am, bm, pred, cuando if cuando in ("vigente", "pasada", "futura") else "vigente"))
    if problemas:
        sys.exit("NO APLICADO:\n  " + "\n  ".join(problemas))
    with con:
        con.execute("DELETE FROM anotaciones WHERE lote_id=? AND wp_id=?", (LOTE, wp))
        con.execute("DELETE FROM relaciones WHERE lote_id=? AND wp_id=?", (LOTE, wp))
        con.executemany("INSERT INTO anotaciones (lote_id, wp_id, mid, pi, ini, fin, texto, tipo, auto, grupo, designa) VALUES (?,?,?,?,?,?,?,?,0,NULL,?)",
                        [(LOTE, wp, *m) for m in menciones])
        con.executemany("INSERT OR IGNORE INTO relaciones (lote_id, wp_id, rid, a_mid, b_mid, predicado, cuando) VALUES (?,?,?,?,?,?,?)",
                        [(LOTE, wp, *r) for r in relaciones])
        (orden,) = con.execute("SELECT COUNT(*) FROM tiempos WHERE lote_id=? AND cerrado=1", (LOTE,)).fetchone()
        con.execute("""INSERT INTO tiempos (lote_id, wp_id, segundos, menciones, orden, cerrado, valido) VALUES (?,?,?,?,?,1,1)
                       ON CONFLICT(lote_id, wp_id) DO UPDATE SET segundos=excluded.segundos, menciones=excluded.menciones, cerrado=1, valido=1, cerrado_at=datetime('now')""",
                    (LOTE, wp, spec.get("segundos", 0), len(menciones), orden))
    print(f"{wp}: {len(menciones)} marcas, {len(relaciones)} relaciones, cerrado")


def estado(con):
    for wp, an, rel, t in con.execute("""SELECT la.wp_id, (SELECT COUNT(*) FROM anotaciones a WHERE a.lote_id=la.lote_id AND a.wp_id=la.wp_id),
        (SELECT COUNT(*) FROM relaciones r WHERE r.lote_id=la.lote_id AND r.wp_id=la.wp_id),
        (SELECT cerrado FROM tiempos t WHERE t.lote_id=la.lote_id AND t.wp_id=la.wp_id) FROM lote_articulos la WHERE la.lote_id=? ORDER BY la.wp_id""", (LOTE,)):
        print(wp, an, rel, "cerrado" if t == 1 else "abierto" if t == 0 else "-")


def main():
    global LOTE
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("orden", choices=["hoja", "aplicar", "estado"])
    ap.add_argument("que", nargs="?")
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--lote", type=int, default=LOTE, help="lote de la app donde viven las propuestas y se escribe el oro (7 = apartado)")
    args = ap.parse_args()
    LOTE = args.lote
    con = sqlite3.connect(args.db)
    if args.orden == "hoja":
        hoja(con, int(args.que))
    elif args.orden == "aplicar":
        aplicar(con, args.que)
    else:
        estado(con)


if __name__ == "__main__":
    main()

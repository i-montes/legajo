#!/usr/bin/env python3
"""Carga una anotación (el JSONL de anotar_llm.py) en Legajo como propuestas,
para que una persona la corrija en la app como si la hubiera producido el
extractor. Es la pieza de la tarea humana (a) del plan (§6): los 30 artículos
apartados, anotados por el LLM sin pistas, corregidos a mano.

    .venv/bin/python sidecar/importar_propuestas.py --anotaciones ~/lsv/datos/entrenamiento/apartado-sin-pistas.jsonl \
        --etiqueta "Apartado · 30" [--db RUTA] [--score 0.9] [--simular]

Crea un lote nuevo con esos artículos, todos marcados para calibrar, y escribe
`extraidas` y `relaciones_extraidas` con la misma forma que deja el extractor
(párrafo, posiciones en caracteres, texto, tipo). El lote se borra desde la app
o con `DELETE FROM lotes WHERE id = ?`: todo lo demás cae en cascada.
"""
import argparse
import json
import pathlib
import sqlite3
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import DB_POR_DEFECTO, CLAVE_SENUELO  # noqa: E402
from vocabulario import PREDICADOS_DICT  # noqa: E402

SIMETRICO = {p["etiqueta"]: p["simetrico"] for p in PREDICADOS_DICT}


def canonicos(predicado, a, b):
    """Como `extremos_canonicos` en core/src/db.rs: las simétricas se guardan ordenadas."""
    if SIMETRICO.get(predicado) and a > b:
        return b, a
    return a, b


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--anotaciones", required=True)
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--etiqueta", default="Apartado · 30")
    ap.add_argument("--lote", type=int, default=None, help="lote existente en vez de crear uno")
    ap.add_argument("--score", type=float, default=0.9, help="confianza que se asigna a cada propuesta (los umbrales de la app arrancan en 0,5)")
    ap.add_argument("--simular", action="store_true", help="comprobar y contar, sin escribir")
    args = ap.parse_args()

    filas = [json.loads(l) for l in open(args.anotaciones, encoding="utf-8")]
    validas = [f for f in filas if not f.get("invalido")]
    por_wp = {}
    for f in validas:
        por_wp.setdefault(f["wp_id"], []).append(f)
    print(f"{len(filas)} párrafos anotados, {len(validas)} válidos, {len(por_wp)} artículos", file=sys.stderr)

    con = sqlite3.connect(args.db)
    con.execute("PRAGMA foreign_keys = ON")
    marcas = ",".join(str(w) for w in por_wp)
    arts = {wp: (cid, tx) for wp, cid, tx in con.execute(
        f"SELECT wp_id, connection_id, text_plain FROM articles WHERE wp_id IN ({marcas}) AND text_plain IS NOT NULL AND text_plain <> ''")}
    faltan = set(por_wp) - set(arts)
    if faltan:
        sys.exit(f"sin texto descargado en Legajo: {sorted(faltan)}")
    conexiones = {cid for cid, _ in arts.values()}
    if len(conexiones) != 1:
        sys.exit(f"los artículos pertenecen a varias conexiones: {conexiones}")
    conexion = conexiones.pop()

    # El párrafo anotado tiene que ser exactamente el párrafo pi del texto de la
    # app: si no, las posiciones señalarían a otro sitio.
    cuenta = Counter()
    ents, rels = [], []
    for wp, fs in por_wp.items():
        parrafos = [p for p in arts[wp][1].split("\n\n") if p.strip()]
        for f in fs:
            if f["pi"] >= len(parrafos) or parrafos[f["pi"]] != f["texto"]:
                sys.exit(f"el párrafo {wp}/{f['pi']} no coincide con el texto de la app; ¿cambió el limpiador?")
            for e in f["entidades"]:
                if e["tipo"] == CLAVE_SENUELO:
                    cuenta["senuelo_fuera"] += 1
                    continue
                if f["texto"][e["ini"]:e["fin"]] != e["texto"]:
                    sys.exit(f"posición rota en {wp}/{f['pi']}: «{e['texto']}»")
                ents.append((wp, f["pi"], e["ini"], e["fin"], e["texto"], e["tipo"]))
                cuenta[f"ent:{e['tipo']}"] += 1
            for r in f["relaciones"]:
                a, b = f["entidades"][r["a"]], f["entidades"][r["b"]]
                if CLAVE_SENUELO in (a["tipo"], b["tipo"]) or a["texto"] == b["texto"]:
                    cuenta["rel_descartada"] += 1
                    continue
                ta, tb = canonicos(r["predicado"], a["texto"], b["texto"])
                rels.append((wp, f["pi"], ta, tb, r["predicado"]))
                cuenta[f"rel:{r['predicado']}"] += 1
    print(f"{len(ents)} propuestas de entidad, {len(rels)} de relación", file=sys.stderr)
    print("  " + ", ".join(f"{k} {v}" for k, v in sorted(cuenta.items())), file=sys.stderr)
    if args.simular:
        print("(simulación: no se escribió nada)", file=sys.stderr)
        return

    with con:
        if args.lote is None:
            cur = con.execute("INSERT INTO lotes (connection_id, label, taxonomia, terminos_json) VALUES (?, ?, NULL, '[]')",
                              (conexion, args.etiqueta))
            lote = cur.lastrowid
        else:
            lote = args.lote
        con.executemany("INSERT OR IGNORE INTO lote_articulos (lote_id, wp_id, seccion, calibra) VALUES (?, ?, NULL, 1)",
                        [(lote, wp) for wp in por_wp])
        con.executemany("INSERT OR REPLACE INTO extraidas (lote_id, wp_id, pi, ini, fin, texto, etiqueta, score) VALUES (?,?,?,?,?,?,?,?)",
                        [(lote, *e, args.score) for e in ents])
        con.executemany("""INSERT INTO relaciones_extraidas (lote_id, wp_id, pi, a, b, predicado, score) VALUES (?,?,?,?,?,?,?)
                           ON CONFLICT(lote_id, wp_id, pi, a, b, predicado) DO UPDATE SET score = MAX(score, excluded.score)""",
                        [(lote, *r, args.score) for r in rels])
        con.executemany("UPDATE lote_articulos SET extraido_at = datetime('now') WHERE lote_id = ? AND wp_id = ?",
                        [(lote, wp) for wp in por_wp])
    print(f"→ lote {lote} «{args.etiqueta}» en {args.db}: {len(por_wp)} artículos para calibrar", file=sys.stderr)
    print(lote)


if __name__ == "__main__":
    main()

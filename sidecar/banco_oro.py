#!/usr/bin/env python3
"""Lo que la persona decidió, contra lo que cada corrida propone.

El único artículo revisado no es un patrón de oro independiente: 60 de sus 61
marcas son propuestas del modelo que la persona conservó, y añadió una sola. Lo
que sí es señal humana genuina son las **30 propuestas que borró**: cada una es
un fallo de precisión juzgado por alguien que leyó el párrafo.

Así que para cada corrida se mira: de lo que la persona **conservó**, cuánto
encuentra; y de lo que **borró**, cuánto vuelve a proponer. Un modelo mejor
encuentra lo primero y evita lo segundo. Con un artículo no es una cifra
publicable; sí sirve para ordenar candidatos.

    .venv/bin/python sidecar/banco_oro.py sidecar/banco/*.json
"""
import json
import pathlib
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO, REDACCIONES  # noqa: E402

CLAVES = {v: k for r in REDACCIONES.values() for k, v in r.items() if not k.startswith("_")}


def decisiones(db, lote=None):
    """Por artículo revisado: lo conservado (pi, ini, fin, tipo) y lo borrado."""
    con = sqlite3.connect(db)
    if lote is None:
        lote = con.execute("SELECT MAX(id) FROM lotes").fetchone()[0]
    revisados = [r[0] for r in con.execute(
        "SELECT DISTINCT wp_id FROM anotaciones WHERE lote_id = ?", (lote,))]
    out = {}
    for wp in revisados:
        oro = con.execute("SELECT pi, ini, fin, tipo FROM anotaciones WHERE lote_id=? AND wp_id=?", (lote, wp)).fetchall()
        props = con.execute("SELECT pi, ini, fin, etiqueta, texto FROM extraidas WHERE lote_id=? AND wp_id=?", (lote, wp)).fetchall()
        borradas = [(pi, ini, fin, et, tx) for pi, ini, fin, et, tx in props
                    if not any(gpi == pi and ini < gfin and gini < fin and gt == et for gpi, gini, gfin, gt in oro)]
        out[wp] = {"conservadas": oro, "borradas": borradas}
    return out


def solapa(e, pi, ini, fin, tipo):
    return e["pi"] == pi and e["inicio"] < fin and ini < e["fin"] and CLAVES.get(e["etiqueta"], e["etiqueta"]) == tipo


def medir(corrida, dec, umbral):
    filas = []
    for art in corrida["por_articulo"]:
        d = dec.get(art["wp_id"])
        if not d:
            continue
        ents = [e for e in art["entidades"] if e["score"] >= umbral]
        halladas = sum(any(solapa(e, *c) for e in ents) for c in d["conservadas"])
        repetidas = sum(any(solapa(e, pi, ini, fin, et) for e in ents) for pi, ini, fin, et, _ in d["borradas"])
        filas.append((art["wp_id"], halladas, len(d["conservadas"]), repetidas, len(d["borradas"]), len(ents)))
    return filas


def main():
    rutas = [p for p in sys.argv[1:] if not pathlib.Path(p).name.startswith("juez-")]
    dec = decisiones(str(DB_POR_DEFECTO))
    for wp, d in dec.items():
        print(f"artículo {wp}: la persona conservó {len(d['conservadas'])} y borró {len(d['borradas'])}")
        print("  borradas, muestra:", ", ".join(f"{tx!r}·{et}" for *_, et, tx in d["borradas"][:10]))
    for umbral in (0.3, 0.5):
        print(f"\numbral {umbral}")
        print(f"  {'corrida':<16}{'halla de lo conservado':>24}{'repite de lo borrado':>22}{'propone':>9}")
        for r in rutas:
            c = json.load(open(r))
            for wp, h, nh, rep, nrep, n in medir(c, dec, umbral):
                print(f"  {c['nombre']:<16}{h:>12}/{nh:<11}{rep:>12}/{nrep:<9}{n:>9}")


if __name__ == "__main__":
    main()

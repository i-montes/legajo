#!/usr/bin/env python3
"""Los 100 artículos de oro adicionales: política nacional y regional de La
Silla, repartidos por año (2009–2026), de 350 a 1.100 palabras, fuera del
apartado, de los ya revisados y de la selección de plata (así el oro no pisa
plata y la mitad de prueba queda limpia). Escribe entrenamiento/oro100.txt
(todos) y entrenamiento/prueba.txt (la mitad que solo se mide).
"""
import json
import pathlib
import random
import sqlite3
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import DB_POR_DEFECTO  # noqa: E402
from apartar import apartados  # noqa: E402

AQUI = pathlib.Path(__file__).parent / "entrenamiento"
SEMILLA = 2026
CATEGORIAS = {"Nacional", "Bogotá", "Caribe", "Santanderes", "Pacífico", "Sur", "Paisa", "Cachaca", "Silla Nacional", "Silla Caribe", "Silla Pacífico", "Silla Sur", "Silla Paisa", "Silla Cachaca", "Silla Santandereana", "Silla Llena"}


def main():
    con = sqlite3.connect(DB_POR_DEFECTO)
    ids_cat = {tid for tid, nombre in con.execute("SELECT term_id, name FROM terms WHERE connection_id=7 AND taxonomy='categories'") if nombre in CATEGORIAS}
    wps_ap, _ = apartados()
    excluidos = set(wps_ap)
    excluidos |= {w for (w,) in con.execute("SELECT DISTINCT wp_id FROM tiempos WHERE cerrado=1")}
    excluidos |= {w for (w,) in con.execute("SELECT DISTINCT wp_id FROM lote_articulos")}
    for ruta in (AQUI / "seleccion.jsonl", AQUI / "seleccion-025.jsonl"):
        if ruta.exists():
            excluidos |= {json.loads(l)["wp_id"] for l in open(ruta, encoding="utf-8")}
    candidatos = {}
    for wp, fecha, terms, texto in con.execute("SELECT cs.wp_id, cs.date, cs.terms_json, ar.text_plain FROM census cs JOIN articles ar ON ar.wp_id=cs.wp_id AND ar.connection_id=cs.connection_id WHERE ar.text_plain<>'' AND cs.date_valid=1"):
        if wp in excluidos or not fecha or fecha[:4] < "2009":
            continue
        cats = set((json.loads(terms or "{}").get("categories") or []))
        if not cats & ids_cat:
            continue
        n = len(texto.split())
        if not 350 <= n <= 1100:
            continue
        candidatos.setdefault(fecha[:4], []).append(wp)
    rnd = random.Random(SEMILLA)
    anios = sorted(candidatos)
    print("candidatos por año:", {a: len(candidatos[a]) for a in anios})
    elegidos = []
    cupo = {a: 100 // len(anios) for a in anios}
    for a in anios[-(100 - sum(cupo.values())):] if 100 - sum(cupo.values()) else []:
        cupo[a] += 1
    for a in anios:
        elegidos += rnd.sample(candidatos[a], min(cupo[a], len(candidatos[a])))
    faltan = 100 - len(elegidos)
    if faltan:
        resto = [w for a in anios for w in candidatos[a] if w not in elegidos]
        elegidos += rnd.sample(resto, faltan)
    rnd.shuffle(elegidos)
    prueba = sorted(elegidos[:50]); todos = sorted(elegidos)
    (AQUI / "oro100.txt").write_text("\n".join(map(str, todos)) + "\n")
    (AQUI / "prueba.txt").write_text("\n".join(map(str, prueba)) + "\n")
    palabras = sum(len(con.execute("SELECT text_plain FROM articles WHERE wp_id=?", (w,)).fetchone()[0].split()) for w in todos)
    print(f"{len(todos)} artículos, {palabras} palabras → oro100.txt; {len(prueba)} de prueba → prueba.txt")


def oro100():
    return {int(x) for x in (AQUI / "oro100.txt").read_text().split()}


def prueba():
    return {int(x) for x in (AQUI / "prueba.txt").read_text().split()}


if __name__ == "__main__":
    main()

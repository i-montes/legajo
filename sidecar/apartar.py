#!/usr/bin/env python3
"""Fija los 30 artículos apartados: la vara de medir, que nunca se entrena.

Paso 5.1 de docs/plan-entrenamiento.md. Se elige **antes** de mirar ningún
párrafo, con semilla fija, y se escribe en sidecar/entrenamiento/apartado.txt
con URL e identificador de Mongo. Toda herramienta que produzca datos de
entrenamiento lee ese fichero y aborta si un párrafo de esos artículos aparece
en su salida.

Criterios: artículos del censo de Legajo con texto en disco, con extracción de
Quién-AI (para poder medir también contra Gemini y DeepSeek), de 300–1.200
palabras, sin transcripciones (> 60 % de párrafos de una línea), estratificados
por tramo temporal —10 de 2009–2015, 10 de 2016–2021, 10 de 2022–2026— y con
un mínimo por sección.

    .venv/bin/python sidecar/apartar.py
"""
import gzip
import json
import os
import pathlib
import random
import re
import sqlite3
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO  # noqa: E402
from alinear_quien_ai import DATOS, leer, normalizar_url, oid  # noqa: E402

SALIDA = pathlib.Path(__file__).parent / "entrenamiento" / "apartado.txt"
SEMILLA = 2026


def seccion_de(url):
    """El primer tramo del camino: silla-nacional, en-vivo, detector-de-mentiras…"""
    m = re.match(r"https?://(?:www\.)?lasillavacia\.com/([^/]+)/", url or "")
    return m.group(1) if m and not re.match(r"^\d", m.group(1)) else "raiz"


def main():
    random.seed(SEMILLA)
    con = sqlite3.connect(str(DB_POR_DEFECTO))
    censo = {}
    for wp, link, fecha, texto in con.execute(
            "SELECT c.wp_id, c.link, c.date, a.text_plain FROM census c JOIN articles a ON a.wp_id = c.wp_id "
            "AND a.connection_id = c.connection_id WHERE a.text_plain IS NOT NULL AND c.date_valid = 1"):
        censo[normalizar_url(link)] = (wp, link, fecha or "", texto)

    # Noticias con extracción en alguna de las dos corridas.
    con_extraccion = set()
    for corrida in ("gemi", "deep"):
        for d in leer(f"relationships_{corrida}"):
            con_extraccion.add(oid(d["new_id"]))
        for d in leer(f"news_metadata_{corrida}"):
            con_extraccion.add(oid(d["news_id"]))
    candidatos = []
    for d in leer("news"):
        nid = oid(d["_id"])
        if nid not in con_extraccion:
            continue
        u = normalizar_url(d.get("url", ""))
        if u not in censo:
            continue
        wp, link, fecha, texto = censo[u]
        ps = [p for p in texto.split("\n\n") if p.strip()]
        palabras = sum(len(p.split()) for p in ps)
        if not (300 <= palabras <= 1200) or not ps:
            continue
        cortos = sum(1 for p in ps if len(p.split()) < 12) / len(ps)
        if cortos > 0.6:
            continue
        anio = int(fecha[:4]) if fecha[:4].isdigit() else 0
        tramo = "2009-2015" if anio <= 2015 else "2016-2021" if anio <= 2021 else "2022-2026"
        candidatos.append({"wp_id": wp, "oid_news": nid, "url": link, "fecha": fecha[:10], "tramo": tramo,
                           "seccion": seccion_de(link), "palabras": palabras, "parrafos": len(ps)})
    print(f"{len(candidatos):,} candidatos", file=sys.stderr)
    print("  por tramo:", dict(Counter(c["tramo"] for c in candidatos)), file=sys.stderr)
    print("  por sección:", dict(Counter(c["seccion"] for c in candidatos).most_common(12)), file=sys.stderr)

    elegidos = []
    # Mínimos por sección (si existen), repartidos entre tramos.
    minimos = [("en-vivo", 6), ("detector-de-mentiras", 3), ("silla-nacional", 18)]
    regiones = {"silla-caribe", "silla-pacifico", "silla-paisa", "silla-santandereana", "silla-cachaca", "silla-sur",
                "silla-llena", "regiones", "silla-cafetera", "red-caribe", "red-pacifico", "red-paisa"}
    usados = set()

    def toma(pool, n):
        random.shuffle(pool)
        out = []
        for c in pool:
            if c["wp_id"] in usados:
                continue
            out.append(c); usados.add(c["wp_id"])
            if len(out) == n:
                break
        return out

    for sec, n in minimos:
        pool = [c for c in candidatos if c["seccion"] == sec]
        elegidos += toma(pool, min(n, len(pool)))
    elegidos += toma([c for c in candidatos if c["seccion"] in regiones], 3)
    # Completar hasta 30 equilibrando tramos: 10 por tramo.
    for tramo in ("2009-2015", "2016-2021", "2022-2026"):
        faltan = 10 - sum(1 for c in elegidos if c["tramo"] == tramo)
        if faltan > 0:
            elegidos += toma([c for c in candidatos if c["tramo"] == tramo], faltan)
    # Si algún tramo sobra (los mínimos por sección lo llenaron de más), recortar al azar hasta 30.
    random.shuffle(elegidos)
    por_tramo = Counter()
    final = []
    for c in sorted(elegidos, key=lambda c: c["tramo"]):
        if por_tramo[c["tramo"]] < 10:
            final.append(c); por_tramo[c["tramo"]] += 1
    while len(final) < 30:
        extra = toma(candidatos, 1)
        if not extra:
            break
        final += extra
    final.sort(key=lambda c: (c["tramo"], c["fecha"]))

    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with open(SALIDA, "w", encoding="utf-8") as f:
        f.write(f"# Apartado: 30 artículos que nunca se entrenan. Semilla {SEMILLA}. Generado por sidecar/apartar.py\n")
        f.write("# wp_id\toid_news\tfecha\ttramo\tseccion\tpalabras\turl\n")
        for c in final:
            f.write(f"{c['wp_id']}\t{c['oid_news']}\t{c['fecha']}\t{c['tramo']}\t{c['seccion']}\t{c['palabras']}\t{c['url']}\n")
    print(f"\n{len(final)} apartados → {SALIDA}")
    print("  por tramo:", dict(Counter(c["tramo"] for c in final)))
    print("  por sección:", dict(Counter(c["seccion"] for c in final)))
    print("  palabras:", sum(c["palabras"] for c in final))


def apartados():
    """Los wp_id y oid de Mongo apartados, para que el resto de herramientas aborten si los tocan."""
    wps, oids = set(), set()
    if not SALIDA.exists():
        sys.exit(f"falta {SALIDA}: corre sidecar/apartar.py antes de producir datos")
    for l in SALIDA.read_text(encoding="utf-8").splitlines():
        if l.startswith("#") or not l.strip():
            continue
        wp, oidn = l.split("\t")[:2]
        if wp != "None":
            wps.add(int(wp))
        oids.add(oidn)
    return wps, oids


if __name__ == "__main__":
    main()

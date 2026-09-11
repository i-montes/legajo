"""La base de identidades: lo que ya se sabe sobre qué nombres son el mismo actor.

Junta las decisiones firmes de todos los lotes de la app («misma» y «distinta»,
de la persona, el diccionario o el juez) con los alias curados de Quién-AI, y
escribe `sidecar/identidades/colombia.jsonl`, que viaja con la app. Dos clases de
fila:

  {"tipo": "persona", "canonico": "Gustavo Petro", "formas": ["Petro", "GUSTAVO PETRO"], "fuentes": ["juez:MiniMax-M3", "regla"]}
  {"tipo": "persona", "distintas": ["Carlos Fernando Galán", "Luis Carlos Galán"], "fuentes": ["quien-ai"]}

Al abrir el grafo, la app cruza su cola de dudas con esta base y decide sola lo
que la base ya sabe (fuente «identidades»), con «deshacer» como todo lo demás. Lo
que decide una persona pesa más que lo del juez: si hay conflicto, gana la persona.
Las decisiones «posponer» no entran: son dudas, no conocimiento. Tampoco los
cargos (eso lo resuelve una regla) ni los apellidos sueltos («Galán»): a quién
designan depende del archivo, no del país.

  .venv/bin/python sidecar/exportar_identidades.py [--salida sidecar/identidades/colombia.jsonl]
"""
import argparse
import json
import pathlib
import sqlite3
import sys
from collections import defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import DB_POR_DEFECTO  # noqa: E402
from importar_alias import QUIEN_AI, leer_gz, plegar  # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PESO = {"persona": 3, "quien-ai": 2, "identidades": 0, "regla": 2}  # el juez pesa 1


def peso(fuente):
    return PESO.get(fuente, 1)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--salida", default=str(RAIZ / "sidecar" / "identidades" / "colombia.jsonl"))
    args = ap.parse_args()
    con = sqlite3.connect(args.db)

    # 1 · decisiones de la app: por par, la de más peso
    mejor = {}  # (tipo, clave) → (peso, decision, a, b, fuente)
    for a, b, tipo, decision, fuente in con.execute(
            "SELECT a_nombre, b_nombre, tipo, decision, fuente FROM resoluciones WHERE decision IN ('misma','distinta')"):
        if fuente == "identidades":
            continue  # lo que la base ya decidió no vuelve a la base
        # Solo actores. Un cargo es la misma plaza con o sin «ex» por regla, no por
        # base; y un apellido suelto («Galán») designa a uno u otro según el
        # archivo: es verdad del lote, no del país.
        if tipo not in ("persona", "organizacion", "lugar", "obra") or len(plegar(a).split()) < 2 or len(plegar(b).split()) < 2:
            continue
        k = (tipo, plegar(a) + "|" + plegar(b) if plegar(a) <= plegar(b) else plegar(b) + "|" + plegar(a))
        if k not in mejor or peso(fuente) > mejor[k][0]:
            mejor[k] = (peso(fuente), decision, a, b, fuente)

    # 2 · Quién-AI: alias curados → misma
    fuentes_par = defaultdict(set)
    grupos_qa = []
    for g in leer_gz("aliases.jsonl.gz"):
        formas = [g["main_name"]] + [x for x in (g.get("aliases") or []) if plegar(x) != plegar(g["main_name"])]
        grupos_qa.append(formas)

    # 3 · unión de conjuntos sobre lo «misma», por tipo
    padre = {}
    def raiz(x):
        while padre.get(x, x) != x:
            x = padre[x]
        return x
    def unir(a, b):
        ra, rb = raiz(a), raiz(b)
        if ra != rb:
            padre[ra] = rb
    nombres_de = {}  # (tipo, plegado) → forma más frecuente/larga vista
    def registrar(tipo, nombre):
        k = (tipo, plegar(nombre))
        if k not in nombres_de or len(nombre) > len(nombres_de[k]):
            nombres_de[k] = nombre
        padre.setdefault(k, k)
        return k
    distintas = {}
    for (tipo, _), (_, decision, a, b, fuente) in mejor.items():
        ka, kb = registrar(tipo, a), registrar(tipo, b)
        if decision == "misma":
            unir(ka, kb); fuentes_par[frozenset((ka, kb))].add(fuente)
        else:
            distintas[frozenset((ka, kb))] = fuente
    for formas in grupos_qa:
        ks = [registrar("persona", f) for f in formas]
        for k in ks[1:]:
            unir(ks[0], k); fuentes_par[frozenset((ks[0], k))].add("quien-ai")

    grupos = defaultdict(set)
    for k in list(padre):
        grupos[raiz(k)].add(k)
    filas = []
    for r, miembros in grupos.items():
        if len(miembros) < 2:
            continue
        tipo = r[0]
        formas = sorted((nombres_de[m] for m in miembros), key=lambda s: (-len(s), s))
        fuentes = sorted({f for par, fs in fuentes_par.items() if par <= miembros for f in fs})
        filas.append({"tipo": tipo, "canonico": formas[0], "formas": formas[1:], "fuentes": fuentes})
    for par, fuente in distintas.items():
        a, b = sorted(par)
        if raiz(a) == raiz(b):
            print(f"  conflicto: {nombres_de[a]} · {nombres_de[b]} es «misma» por un lado y «distinta» por otro; se deja fuera", file=sys.stderr)
            continue
        filas.append({"tipo": a[0], "distintas": [nombres_de[a], nombres_de[b]], "fuentes": [fuente]})
    filas.sort(key=lambda f: (f["tipo"], f.get("canonico") or f["distintas"][0]))
    salida = pathlib.Path(args.salida); salida.parent.mkdir(parents=True, exist_ok=True)
    with open(salida, "w", encoding="utf-8") as f:
        for fila in filas:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")
    n_g = sum(1 for f in filas if "canonico" in f); n_d = len(filas) - n_g
    print(f"{n_g} grupos de un mismo actor ({sum(len(f['formas']) + 1 for f in filas if 'canonico' in f)} formas) y {n_d} pares de homónimos → {salida}")


if __name__ == "__main__":
    main()

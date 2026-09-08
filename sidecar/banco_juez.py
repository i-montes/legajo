#!/usr/bin/env python3
"""Adjudica con un LLM local las entidades en las que dos corridas discrepan.

Con un solo artículo de oro no hay forma de saber cuál de dos modelos acierta
más cuando no coinciden. Un modelo instruido que corre en esta misma máquina
puede mirar cada discrepancia con su párrafo y decir si es una entidad de ese
tipo o no. **No es oro: es plata.** Se marca así en los resultados y sirve
para ordenar candidatos, no para publicar una cifra.

Solo se le preguntan las discrepancias, no todo: lo que los dos modelos
coinciden en marcar no distingue entre ellos.

    .venv/bin/python sidecar/banco_juez.py sidecar/banco/a.json sidecar/banco/b.json --modelo qwen3.8:27b-32k
"""
import argparse
import json
import pathlib
import random
import sqlite3
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO, articulos  # noqa: E402
from banco_comparar import casar, conjunto  # noqa: E402

DESCRIPCION = {
    "persona": "una persona concreta con nombre propio o una designación que señala a un individuo",
    "organizacion": "una organización, institución, empresa, partido, entidad pública o colectivo con nombre",
    "lugar": "un lugar geográfico o administrativo: país, ciudad, región, barrio, edificio con nombre",
    "cargo": "un cargo, rol o función que alguien ocupa: ministro, senador, alcaldesa, director",
    "ley": "una ley, norma, decreto, artículo constitucional, sentencia o acto jurídico identificable",
    "evento": "un suceso con nombre propio: elecciones, un paro, una cumbre, un escándalo nombrado",
    "obra": "una obra o publicación: libro, informe, periódico, revista, película, columna",
    "monto": "una cantidad de dinero o cifra que el texto afirma como hecho",
}


def preguntar(url, modelo, parrafo, texto, tipo):
    prompt = (
        "Eres un anotador de entidades en prosa periodística colombiana. Responde solo «sí» o «no».\n\n"
        f"Párrafo:\n«{parrafo}»\n\n"
        f"¿Es «{texto}» en este párrafo {DESCRIPCION[tipo]}? "
        "Di «no» si el tramo está mal cortado (le falta o le sobra una palabra), si es un término "
        "genérico sin referente concreto, o si su tipo correcto es otro."
    )
    cuerpo = json.dumps({
        "model": modelo, "stream": False, "think": False,
        "messages": [{"role": "user", "content": prompt}],
        "options": {"temperature": 0, "num_predict": 5},
    }).encode()
    req = urllib.request.Request(url, data=cuerpo, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        resp = json.load(r)["message"]["content"].strip().lower()
    return resp.startswith("s"), resp


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("a"); ap.add_argument("b")
    ap.add_argument("--modelo", default="qwen3.8:27b-32k")
    ap.add_argument("--url", default="http://localhost:11434/api/chat")
    ap.add_argument("--umbral", type=float, default=0.5)
    ap.add_argument("--maximo", type=int, default=120, help="discrepancias por lado, al azar")
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--semilla", type=int, default=7)
    args = ap.parse_args()

    a, b = json.load(open(args.a)), json.load(open(args.b))
    A, B = conjunto(a, args.umbral), conjunto(b, args.umbral)
    parrafos = {wp: ps for wp, ps, _ in articulos(args.db, a["config"]["lote"], not a["config"]["todo"])}

    random.seed(args.semilla)
    veredictos = {}
    for nombre, X, Y in ((a["nombre"], A, B), (b["nombre"], B, A)):
        _, _, ejemplos = casar(X, Y)
        solo = [k for k in X if not any(
            k[0] == o[0] and k[1] == o[1] and k[4] == o[4] and k[2] < o[3] and o[2] < k[3] for o in Y
            if o[0] == k[0] and o[1] == k[1])]
        random.shuffle(solo)
        solo = solo[:args.maximo]
        print(f"\n{nombre}: {len(solo)} discrepancias a juzgar", file=sys.stderr)
        si = por_tipo = {}
        por_tipo = {}
        t0 = time.time()
        for i, k in enumerate(solo):
            wp, pi, ini, fin, tipo = k
            texto = X[k]["texto"]
            try:
                ok, resp = preguntar(args.url, args.modelo, parrafos[wp][pi], texto, tipo)
            except Exception as e:  # noqa: BLE001
                print(f"  fallo en {texto!r}: {e}", file=sys.stderr)
                continue
            d = por_tipo.setdefault(tipo, {"si": 0, "no": 0, "ejemplos_no": [], "ejemplos_si": []})
            d["si" if ok else "no"] += 1
            (d["ejemplos_si"] if ok else d["ejemplos_no"]).append(texto)
            if i % 20 == 19:
                print(f"  {i + 1}/{len(solo)}  {time.time() - t0:.0f}s", file=sys.stderr)
        veredictos[nombre] = por_tipo

    print(f"\nJuez: {args.modelo} · umbral {args.umbral} · hasta {args.maximo} discrepancias por lado · PLATA, no oro")
    for nombre, pt in veredictos.items():
        tot_si = sum(d["si"] for d in pt.values()); tot = sum(d["si"] + d["no"] for d in pt.values())
        print(f"\nLo que solo encuentra {nombre}: {tot_si}/{tot} válidas ({tot_si / max(tot, 1):.0%})")
        for tipo, d in sorted(pt.items(), key=lambda kv: -(kv[1]['si'] + kv[1]['no'])):
            n = d["si"] + d["no"]
            print(f"  {tipo:<13}{d['si']:>4}/{n:<4} válidas   "
                  f"no: {', '.join(repr(x) for x in d['ejemplos_no'][:4])}")
    salida = pathlib.Path(args.a).parent / f"juez-{a['nombre']}-vs-{b['nombre']}.json"
    salida.write_text(json.dumps({"juez": args.modelo, "umbral": args.umbral, "veredictos": veredictos},
                                 ensure_ascii=False, indent=1))
    print(f"\n→ {salida}")


if __name__ == "__main__":
    main()

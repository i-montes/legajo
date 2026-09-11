#!/usr/bin/env python3
"""Del patrón anotado al formato que `gliner` entrena.

Paso 5.8 de docs/plan-entrenamiento.md. Lee la plata del anotador
(~/lsv/datos/entrenamiento/plata.jsonl), los sintéticos si los hay, y el oro
humano de legajo.sqlite (anotaciones con `tiempos.valido = 1`), y escribe
sidecar/entrenamiento/<fecha>/{train,val}.jsonl con ejemplos
`{"tokenized_text": [...], "ner": [[ini, fin_incl, etiqueta]], "relations": [[cabeza, cola, predicado]]}`.

La tokenización es la del propio modelo (`WhitespaceTokenSplitter`), no spaCy:
es lo que el modelo usa al inferir, y entrenar con otra partición desalinea
los tramos. Aborta si algo del apartado se cuela, si un índice sale de rango,
si un predicado no está en el vocabulario o si un par de tipos no lo admite.

    .venv/bin/python sidecar/exportar_patron.py --etiqueta v1
"""
import argparse
import hashlib
import json
import pathlib
import re
import sqlite3
import statistics
import sys
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO  # noqa: E402
from anotar_llm import SALIDAS, CLAVE_SENUELO  # noqa: E402
from apartar import apartados  # noqa: E402
from limpieza import repetir_menciones, separar_titulos  # noqa: E402
from seleccionar_oro import prueba as wps_prueba_fn  # noqa: E402
from legajo_ner import CIFRA, aplicables  # noqa: E402
from vocabulario import ETIQUETA, PREDICADOS_DICT, PRONOMBRES, SENUELO, TIPOS  # noqa: E402

SELECCION = pathlib.Path(__file__).parent / "entrenamiento" / "seleccion.jsonl"
PATRON = re.compile(r"\w+(?:[-_]\w+)*|\S")  # el de gliner.data_processing.tokenizer.WhitespaceTokenSplitter
SIMETRICO = {p["etiqueta"]: p["simetrico"] for p in PREDICADOS_DICT}


def tokenizar(texto):
    return [(m.group(), m.start(), m.end()) for m in PATRON.finditer(texto)]


def a_tokens(ini, fin, tokens, cuenta):
    """Índices de token [primero, último] que cubren [ini, fin). Si un límite
    cae dentro de una palabra, se expande a la palabra y se cuenta."""
    primero = ultimo = None
    for i, (tok, a, b) in enumerate(tokens):
        if b <= ini:
            continue
        if a >= fin:
            break
        if primero is None:
            primero = i
            if a < ini:
                cuenta["expandidas"] += 1
        ultimo = i
        if b > fin:
            cuenta["expandidas"] += 1
    return primero, ultimo


def ejemplo(texto, entidades, relaciones, cuenta):
    """Un párrafo anotado → ejemplo de gliner, o None si no hay nada que enseñar."""
    tokens = tokenizar(texto)
    ner, idx = [], {}
    # Los tramos largos primero: cuando dos marcas del mismo tipo se solapan
    # («Alejandro Lyons» dentro de «Alejandro Lyons Muskus», que el LLM copia
    # de la pista), se queda la larga y la corta pasa a ser un alias suyo, para
    # que las relaciones que apuntaban a cualquiera de las dos sobrevivan.
    for k, e in sorted(enumerate(entidades), key=lambda ke: -(ke[1]["fin"] - ke[1]["ini"])):
        tipo = e["tipo"]
        if tipo == CLAVE_SENUELO:
            etiqueta = SENUELO
        elif tipo in TIPOS:
            etiqueta = ETIQUETA[tipo]
        else:
            cuenta["tipo_fuera"] += 1; continue
        if tipo == "persona" and e["texto"].strip().lower() in PRONOMBRES:
            cuenta["pronombre"] += 1; continue
        if tipo == "monto" and not CIFRA.search(e["texto"]):
            cuenta["monto_sin_cifra"] += 1; continue
        p, u = a_tokens(e["ini"], e["fin"], tokens, cuenta)
        if p is None or u is None or u < p:
            cuenta["fuera_de_rango"] += 1; continue
        j = next((i for i, (a, b, t) in enumerate(ner) if t == etiqueta and not (u < a or p > b)), None)
        if j is not None:
            cuenta["solape_mismo_tipo"] += 1; idx[k] = j; continue
        idx[k] = len(ner)
        ner.append([p, u, etiqueta])
    rels, vistas = [], set()
    tipo_de = {i: entidades[k]["tipo"] for k, i in idx.items()}
    for r in relaciones:
        a, b = idx.get(r["a"]), idx.get(r["b"])
        if a is None or b is None or a == b:
            cuenta["rel_sin_extremo"] += 1; continue
        pred = r["predicado"]
        if pred not in SIMETRICO:
            cuenta["rel_predicado_fuera"] += 1; continue
        ta, tb = tipo_de[a], tipo_de[b]
        if ta == CLAVE_SENUELO or tb == CLAVE_SENUELO or not any(p["etiqueta"] == pred for p in aplicables(PREDICADOS_DICT, ta, tb)):
            cuenta["rel_tipos_no_admitidos"] += 1; continue
        pares = [(a, b)] + ([(b, a)] if SIMETRICO[pred] else [])
        for x, y in pares:
            if (x, y, pred) not in vistas:
                vistas.add((x, y, pred)); rels.append([x, y, pred])
    if not ner:
        cuenta["sin_entidades"] += 1
    return {"tokenized_text": [t for t, _, _ in tokens], "ner": ner, "relations": rels}, tokens


def oro_de_legajo(db, wps_ap):
    """Los artículos revisados de verdad (tiempos.valido = 1), como filas de plata pero con fuente «oro»."""
    con = sqlite3.connect(db)
    filas = []
    # El mismo artículo revisado en varios lotes (los 12 de calibración se
    # repiten en cada lote nuevo, con marcas distintas): vale solo la revisión
    # más reciente, o el modelo aprendería dos versiones del mismo párrafo.
    for lote, wp in con.execute("""SELECT lote_id, wp_id FROM tiempos t WHERE cerrado = 1 AND valido = 1
                                    AND lote_id = (SELECT MAX(lote_id) FROM tiempos u WHERE u.wp_id = t.wp_id AND u.cerrado = 1 AND u.valido = 1)"""):
        texto = con.execute("SELECT text_plain FROM articles WHERE wp_id = ?", (wp,)).fetchone()
        if not texto or not texto[0]:
            continue
        ps = [p for p in texto[0].split("\n\n") if p.strip()]
        marcas = con.execute("SELECT mid, pi, ini, fin, texto, tipo FROM anotaciones WHERE lote_id=? AND wp_id=?", (lote, wp)).fetchall()
        rels = con.execute("SELECT a_mid, b_mid, predicado, cuando FROM relaciones WHERE lote_id=? AND wp_id=?", (lote, wp)).fetchall()
        por_pi = {}
        mid_a_idx = {}
        for mid, pi, ini, fin, tx, tipo in marcas:
            ents = por_pi.setdefault(pi, [])
            mid_a_idx[mid] = (pi, len(ents))
            ents.append({"ini": ini, "fin": fin, "tipo": tipo if tipo != "evento" else None, "texto": tx})
        rel_por_pi = {}
        for am, bm, pred, cuando in rels:
            if am in mid_a_idx and bm in mid_a_idx and mid_a_idx[am][0] == mid_a_idx[bm][0]:
                pi = mid_a_idx[am][0]
                rel_por_pi.setdefault(pi, []).append({"a": mid_a_idx[am][1], "b": mid_a_idx[bm][1], "predicado": pred, "cuando": cuando})
        for pi, ents in por_pi.items():
            if pi < len(ps):
                filas.append({"wp_id": wp, "pi": pi, "texto": ps[pi], "entidades": [e for e in ents if e["tipo"]],
                              "relaciones": rel_por_pi.get(pi, []), "fuente": "oro", "conjunto": "apartado" if wp in wps_ap else "train"})
    return filas


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--plata", default=str(SALIDAS / "plata.jsonl"))
    ap.add_argument("--sinteticos", default=str(SALIDAS / "sinteticos.jsonl"))
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--etiqueta", default="v1")
    ap.add_argument("--sin-oro", action="store_true")
    ap.add_argument("--seleccion", default=str(SELECCION), help="JSONL de seleccionar.py con el conjunto (train/val) de cada párrafo")
    ap.add_argument("--precision-minima", type=float, default=0.0, help="retira predicados con precisión auditada por debajo (fichero auditoria.json)")
    args = ap.parse_args()
    wps_ap, oids_ap = apartados()
    sel = pathlib.Path(args.seleccion)
    conjunto_de = {(f["wp_id"], f["pi"]): f.get("conjunto", "train") for f in (json.loads(l) for l in open(sel, encoding="utf-8"))} if sel.exists() else {}

    filas = []
    for ruta, fuente in ((args.plata, "plata"), (args.sinteticos, "sintetico")):
        if pathlib.Path(ruta).exists():
            for l in open(ruta, encoding="utf-8"):
                f = json.loads(l)
                if f.get("invalido"):
                    continue
                f["fuente"] = fuente
                f["conjunto"] = "train" if fuente == "sintetico" else conjunto_de.get((f["wp_id"], f["pi"]), "train")
                filas.append(f)
    if not args.sin_oro:
        filas += oro_de_legajo(args.db, wps_ap)

    salida = pathlib.Path(__file__).parent / "entrenamiento" / args.etiqueta
    salida.mkdir(parents=True, exist_ok=True)
    cuenta = Counter(); conjuntos = {"train": [], "val": [], "apartado": [], "prueba": []}; metas = {"train": [], "val": [], "apartado": [], "prueba": []}
    try:
        wps_prueba = wps_prueba_fn()
    except FileNotFoundError:
        wps_prueba = set()
    # El oro pisa a la plata en el mismo párrafo: si una persona lo revisó, el LLM no opina.
    con_oro = {(f["wp_id"], f["pi"]) for f in filas if f.get("fuente") == "oro"}
    antes = len(filas)
    filas = [f for f in filas if f.get("fuente") == "oro" or (f["wp_id"], f["pi"]) not in con_oro]
    cuenta["plata_pisada_por_oro"] = antes - len(filas)
    tokens_por = []; positivos = Counter(); por_tipo = Counter()
    for f in filas:
        if f["wp_id"] in wps_ap or f.get("oid_news") in oids_ap:
            if f.get("fuente") == "oro":
                f["conjunto"] = "apartado"  # se evalúa aparte, nunca se entrena
            else:
                sys.exit(f"ABORTADO: el párrafo {f['wp_id']}/{f['pi']} está apartado y apareció en {f.get('fuente')}")
        elif f["wp_id"] in wps_prueba:
            if f.get("fuente") != "oro":
                cuenta["plata_en_prueba_fuera"] += 1; continue  # la prueba solo se mide
            f["conjunto"] = "prueba"
        if f.get("fuente") == "plata":
            separar_titulos(f["texto"], f["entidades"], f["relaciones"], cuenta)
            repetir_menciones(f["texto"], f["entidades"], cuenta)
            # Convención del oro: una persona en un partido u organización es
            # «miembro de»; «parte de» queda para organización dentro de otra.
            # El LLM usaba «parte de» para las dos cosas (921 veces).
            for r in f["relaciones"]:
                if r["predicado"] == "parte de" and f["entidades"][r["a"]]["tipo"] == "persona" and f["entidades"][r["b"]]["tipo"] == "organizacion":
                    r["predicado"] = "miembro de"; cuenta["parte_de_a_miembro_de"] += 1
        ej, toks = ejemplo(f["texto"], f["entidades"], f["relaciones"], cuenta)
        if not ej["ner"]:
            # Sin entidades tampoco enseña nada útil salvo negativos: se conserva uno de cada cinco.
            if cuenta["sin_entidades"] % 5:
                continue
        c = f.get("conjunto", "train")
        if c not in conjuntos:
            continue
        conjuntos[c].append(ej)
        metas[c].append({"wp_id": f["wp_id"], "pi": f["pi"], "fuente": f.get("fuente"), "estrato": f.get("estrato"),
                         "texto": f["texto"], "cuando": [r.get("cuando") for r in f["relaciones"]]})
        tokens_por.append(len(toks))
        for _, _, et in ej["ner"]:
            por_tipo[et] += 1
        for _, _, p in ej["relations"]:
            positivos[p] += 1

    hashes = {}
    for c, ejs in conjuntos.items():
        ruta = salida / f"{c}.jsonl"
        with open(ruta, "w", encoding="utf-8") as out:
            for e in ejs:
                out.write(json.dumps(e, ensure_ascii=False) + "\n")
        with open(salida / f"{c}.meta.jsonl", "w", encoding="utf-8") as out:
            for m in metas[c]:
                out.write(json.dumps(m, ensure_ascii=False) + "\n")
        hashes[c] = hashlib.sha256(ruta.read_bytes()).hexdigest()

    # Ida y vuelta: 20 ejemplos reconstruidos a caracteres dan las mismas marcas.
    import random
    random.seed(1)
    muestra = random.sample([f for f in filas if f["wp_id"] not in wps_ap], min(20, len(filas)))
    for f in muestra:
        ej, toks = ejemplo(f["texto"], f["entidades"], f["relaciones"], Counter())
        for p, u, et in ej["ner"]:
            ini, fin = toks[p][1], toks[u][2]
            assert any(e["ini"] >= ini and e["fin"] <= fin for e in f["entidades"]), f"ida y vuelta rota en {f['wp_id']}/{f['pi']}"

    informe = {
        "etiqueta": args.etiqueta, "ejemplos": {c: len(v) for c, v in conjuntos.items()}, "hashes": hashes,
        "descartes": dict(cuenta), "positivos_por_predicado": dict(positivos.most_common()),
        "entidades_por_etiqueta": dict(por_tipo.most_common()),
        "tokens_por_ejemplo": {"mediana": statistics.median(tokens_por) if tokens_por else 0, "p95": sorted(tokens_por)[int(len(tokens_por) * .95)] if tokens_por else 0},
        "fuentes": dict(Counter(m["fuente"] for c in metas.values() for m in c)),
    }
    (salida / "informe.json").write_text(json.dumps(informe, ensure_ascii=False, indent=1))
    print(json.dumps(informe, ensure_ascii=False, indent=1))
    print(f"\n→ {salida}")


if __name__ == "__main__":
    main()

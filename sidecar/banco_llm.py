#!/usr/bin/env python3
"""Banco de LLMs locales como extractor: ¿qué sacan, cuánto tardan, cuánto pesan?

La pregunta de fondo es si un modelo instruido pequeño —el que cabe en un
portátil de redacción con 8 o 16 GB— puede hacer el trabajo de GLiNER-relex
igual o mejor, y a qué velocidad. Se corre por Ollama, con el mismo esquema de
ocho tipos y trece predicados, sobre los mismos artículos que el banco de
GLiNER, y deja el mismo JSON para poder compararlos con `banco_comparar.py`
y `banco_genericos.py`.

    .venv/bin/python sidecar/banco_llm.py --modelo qwen3:4b --articulos 4

Es una medida de campo, no un paper: un prompt razonable, sin ajuste fino, con
JSON estricto. Lo que un modelo no consiga aquí lo conseguiría mejor afinado;
lo que sí consiga es el piso.
"""
import argparse
import json
import pathlib
import re
import statistics
import subprocess
import sys
import time
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO, PREDICADOS, REDACCIONES, TIPOS, articulos, oro, resumen, imprimir  # noqa: E402
import unicodedata  # noqa: E402

# Las etiquetas con que se guarda cada tipo: las mismas que usa GLiNER (G), para
# que `banco_comparar.py` y `banco_genericos.py` las entiendan sin más.
ETIQUETA_G = {k: v for k, v in REDACCIONES["G"].items() if not k.startswith("_")}


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


# El modelo escribe «organización» con tilde aunque se le pida sin ella, o
# «Persona» con mayúscula. La clave se reconoce por su forma sin tildes.
CLAVE_DE = {sin_tildes(k): k for k in TIPOS}
from legajo_ner import aplicables, hablantes, sin_hablante, sin_espejos  # noqa: E402

# La misma redacción que ve GLiNER (G), para que la comparación sea de modelo y
# no de instrucciones.
DESCRIPCION = {
    "persona": "persona con nombre propio",
    "organizacion": "organización, institución, empresa o partido, con nombre",
    "lugar": "nombre propio de lugar",
    "cargo": "cargo público o título de un puesto",
    "ley": "ley, decreto, sentencia o norma jurídica, con nombre",
    "evento": "evento o suceso con nombre propio",
    "obra": "título de libro, informe, periódico, revista o medio",
    "monto": "monto de dinero o cifra",
}

SISTEMA = (
    "Eres un anotador de prosa periodística colombiana. Extraes entidades y relaciones "
    "SOLO de lo que el texto afirma. Respondes únicamente con JSON válido, sin comentarios."
)


def prompt(parrafo):
    tipos = "\n".join(f"- {k}: {v}" for k, v in DESCRIPCION.items())
    preds = "\n".join(f"- {p['etiqueta']}: de {p['desde'] or 'cualquiera'} a {p['hasta'] or 'cualquiera'}" for p in PREDICADOS)
    return (
        f"Tipos de entidad (usa exactamente estas claves):\n{tipos}\n\n"
        f"Predicados (con los tipos que admiten):\n{preds}\n\n"
        "Reglas: no marques pronombres ni nombres comunes sin referente concreto; un monto lleva cifra; "
        "copia el texto de cada entidad EXACTAMENTE como aparece en el párrafo; una relación solo si el "
        "párrafo la afirma, con sus dos extremos entre las entidades.\n\n"
        f"Párrafo:\n«{parrafo}»\n\n"
        'Devuelve: {"entidades":[{"texto":"…","tipo":"…"}],"relaciones":[{"a":"…","predicado":"…","b":"…"}]}'
    )


def pedir(url, modelo, parrafo, ctx, cpu=False):
    opciones = {"temperature": 0, "num_ctx": ctx, "num_predict": 1500}
    if cpu:
        # Sin GPU: es el portátil de redacción sin gráfica, que es el caso que
        # importa medir. En un Mac, Ollama usaría Metal si no se le dice esto.
        opciones["num_gpu"] = 0
    cuerpo = json.dumps({
        "model": modelo, "stream": False, "think": False, "format": "json",
        "messages": [{"role": "system", "content": SISTEMA}, {"role": "user", "content": prompt(parrafo)}],
        "options": opciones,
    }).encode()
    req = urllib.request.Request(url, data=cuerpo, headers={"Content-Type": "application/json"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=600) as r:
        resp = json.load(r)
    seg = time.time() - t0
    toks = resp.get("eval_count", 0)
    return resp["message"]["content"], seg, toks


def localizar(texto, parrafo, desde=0):
    """Dónde está la entidad en el párrafo: el modelo devuelve texto, la app
    necesita posiciones. Si no está tal cual, no cuenta: copiar mal el tramo es
    un fallo del modelo, no del banco."""
    i = parrafo.find(texto, desde)
    return i


def normalizar(salida, parrafo, base):
    try:
        d = json.loads(salida)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", salida, re.S)
        if not m:
            return [], [], True
        try:
            d = json.loads(m.group(0))
        except json.JSONDecodeError:
            return [], [], True
    ents, usados = [], {}
    for e in d.get("entidades") or []:
        if not isinstance(e, dict):
            continue
        tx, tipo = str(e.get("texto", "")).strip(), CLAVE_DE.get(sin_tildes(str(e.get("tipo", "")).strip()))
        if not tx or tipo is None:
            continue
        # Cada aparición del mismo texto es una mención distinta. Si el modelo
        # no copió el tramo tal cual, se busca sin distinguir mayúsculas; si ni
        # así está, no cuenta: copiar mal es un fallo del modelo, no del banco.
        i = localizar(tx, parrafo, usados.get(tx, 0))
        if i < 0:
            i = parrafo.lower().find(tx.lower(), usados.get(tx, 0))
            if i < 0:
                continue
            tx = parrafo[i:i + len(tx)]
        usados[tx] = i + len(tx)
        ents.append({"texto": tx, "inicio": base + i, "fin": base + i + len(tx),
                     "etiqueta": ETIQUETA_G[tipo], "score": 1.0})
    tipo_de = {e["texto"]: next(k for k, v in ETIQUETA_G.items() if v == e["etiqueta"]) for e in ents}
    rels = []
    for r in d.get("relaciones") or []:
        if not isinstance(r, dict):
            continue
        a, b, p = str(r.get("a", "")).strip(), str(r.get("b", "")).strip(), str(r.get("predicado", "")).strip()
        ta, tb = tipo_de.get(a), tipo_de.get(b)
        if not a or not b or a == b or ta is None or tb is None:
            continue
        if not any(x["etiqueta"] == p for x in aplicables(PREDICADOS, ta, tb)):
            continue
        rels.append({"a": a, "b": b, "predicado": p, "score": 1.0})
    return ents, sin_espejos(rels, PREDICADOS), False


def memoria_ollama():
    """Cuánto ocupa el modelo cargado, según Ollama."""
    try:
        out = subprocess.run(["ollama", "ps"], capture_output=True, text=True, timeout=10).stdout
        for l in out.splitlines()[1:]:
            partes = l.split()
            if len(partes) >= 4:
                return f"{partes[2]} {partes[3]}"
    except Exception:  # noqa: BLE001
        pass
    return "?"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelo", required=True)
    ap.add_argument("--nombre", default=None)
    ap.add_argument("--url", default="http://localhost:11434/api/chat")
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--lote", type=int, default=None)
    ap.add_argument("--articulos", type=int, default=4)
    ap.add_argument("--ctx", type=int, default=4096)
    ap.add_argument("--cpu", action="store_true", help="sin GPU, como un portátil sin gráfica")
    ap.add_argument("--salida", default=str(pathlib.Path(__file__).parent / "banco"))
    args = ap.parse_args()
    args.nombre = args.nombre or "llm-" + re.sub(r"[^\w.]+", "-", args.modelo) + ("-cpu" if args.cpu else "")
    # Lo que `resumen` espera encontrar en la configuración.
    args.redaccion, args.dispositivo, args.dtype, args.vueltas, args.relaciones = "G", "ollama", "gguf", 1, "si"

    arts = articulos(args.db, args.lote, True, args.articulos)
    gold = oro(args.db, args.lote or 0) if args.lote else {}
    print(f"{args.modelo}: {len(arts)} artículos · {sum(w for _, _, w in arts):,} palabras", file=sys.stderr)

    # Calentar: la primera petición carga el modelo.
    pedir(args.url, args.modelo, "Prueba.", args.ctx, args.cpu)
    mem = memoria_ollama()

    resultados, tok_s, rotos = [], [], 0
    for wp, parrafos, palabras in arts:
        t0 = time.time()
        quienes = hablantes(parrafos)
        ents_art, rels_art = [], []
        for pi, texto in enumerate(parrafos):
            base = sin_hablante(texto, quienes)
            salida, seg, toks = pedir(args.url, args.modelo, texto[base:], args.ctx, args.cpu)
            if seg > 0 and toks:
                tok_s.append(toks / seg)
            ents, rels, roto = normalizar(salida, texto[base:], base)
            rotos += roto
            ents_art.extend({"pi": pi, **e} for e in ents)
            rels_art.extend({"pi": pi, **r} for r in rels)
        seg = time.time() - t0
        print(f"  {wp:>7}  {palabras:>5} pal  {seg:6.1f} s  ({seg / max(palabras, 1) * 1000:5.2f} s/1k pal)"
              f"  {len(ents_art):4} ents  {len(rels_art):3} rels", file=sys.stderr)
        resultados.append({"wp_id": wp, "parrafos": len(parrafos), "palabras": palabras,
                           "segundos": round(seg, 2), "entidades": ents_art, "relaciones": rels_art})

    s = resumen(args, {"memoria": mem, "tokens_por_seg": round(statistics.median(tok_s), 1) if tok_s else 0,
                       "respuestas_rotas": rotos}, resultados, gold)
    ruta = pathlib.Path(args.salida) / f"{args.nombre}.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(s, ensure_ascii=False, indent=1))
    imprimir(s)
    print(f"  memoria del modelo {mem} · {s['carga_ms']['tokens_por_seg']} tok/s · respuestas rotas {rotos}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Banco de pruebas del extractor: qué modelo, con qué etiquetas, en qué
dispositivo, cuánto tarda y qué devuelve, sobre artículos reales del archivo.

Existe para responder con números una pregunta que hasta ahora se respondía
ofreciendo un menú: ¿cuál de los modelos hay que usar? Un menú traslada la
decisión a quien menos información tiene para tomarla. Esto la toma midiendo.
Los resultados que decidieron el modelo actual están en docs/pipeline.md.

Corre la **misma ruta de código que la app** —`Motor.procesar` de
`legajo_ner.py`, con su troceo por oración y su filtro de tipos— y le enchufa
el modelo ya cargado, así lo que se mide es lo que se va a usar y no una
aproximación.

    .venv/bin/python sidecar/banco.py --nombre relex-mps --dispositivo mps --vueltas 2
    .venv/bin/python sidecar/banco.py --nombre otro --gliner knowledgator/gliner-relex-large-v1.0
    .venv/bin/python sidecar/banco.py --nombre etiquetas-B --redaccion B

Deja un JSON por corrida en `--salida` (por defecto `sidecar/banco/`), con cada
entidad y relación, para poder comparar dos corridas después sin repetirlas:
`banco_comparar.py`, `banco_oro.py`, `banco_genericos.py` y `banco_juez.py`.
"""
import argparse
import json
import pathlib
import sqlite3
import statistics
import sys
import time
import warnings

warnings.filterwarnings("ignore")
sys.path.insert(0, str(pathlib.Path(__file__).parent))

from legajo_ner import Motor  # noqa: E402

DB_POR_DEFECTO = pathlib.Path.home() / "Library/Application Support/com.legajo.app/legajo.sqlite"

# Los ocho tipos, con la clave interna de cada uno. La redacción que ve el
# modelo es aparte, abajo, porque es lo que se prueba.
TIPOS = ["persona", "organizacion", "lugar", "cargo", "ley", "evento", "obra", "monto"]

# Copia de `PREDICADOS` de core/src/extraccion.rs. En la app los manda Rust.
P, O, C, L, N, M, B, E = "persona", "organizacion", "cargo", "lugar", "ley", "monto", "obra", "evento"
PREDICADOS = [
    {"etiqueta": "ocupa el cargo",  "desde": [P],    "hasta": [C],             "simetrico": False},
    {"etiqueta": "aspira a",        "desde": [P, O], "hasta": [C],             "simetrico": False},
    {"etiqueta": "aliado de",       "desde": [P, O], "hasta": [P, O],          "simetrico": True},
    {"etiqueta": "opositor de",     "desde": [P, O], "hasta": [P, O],          "simetrico": True},
    {"etiqueta": "familiar de",     "desde": [P],    "hasta": [P],             "simetrico": True},
    {"etiqueta": "investigado por", "desde": [P, O], "hasta": [O, N],          "simetrico": False},
    {"etiqueta": "financia a",      "desde": [P, O], "hasta": [P, O],          "simetrico": False},
    {"etiqueta": "trabaja en",      "desde": [P],    "hasta": [O],             "simetrico": False},
    {"etiqueta": "parte de",        "desde": [],     "hasta": [O, L, N, E],    "simetrico": False},
    {"etiqueta": "citado en",       "desde": [P, O], "hasta": [O, B],          "simetrico": False},
    {"etiqueta": "ubicado en",      "desde": [],     "hasta": [L],             "simetrico": False},
    {"etiqueta": "destinado a",     "desde": [M],    "hasta": [O, C, E, L, N], "simetrico": False},
    {"etiqueta": "sanciona con",    "desde": [N],    "hasta": [M],             "simetrico": False},
]

# Redacciones de las etiquetas que se probaron, en el orden en que se probaron.
# GLiNER es de vocabulario abierto: la etiqueta es una instrucción, y «cargo o
# rol» invita a marcar «pobre» o «víctima» como si fueran cargos. Se corrieron
# todas sobre los mismos once artículos y se miró cuál producía menos nombres
# comunes con confianza alta (`banco_genericos.py`) sin perder relaciones. La
# que quedó está en `core/src/extraccion.rs`; las demás se conservan para poder
# repetir la comparación cuando cambie el modelo.
REDACCIONES = {
    # La original. Devuelve 544 nombres comunes con confianza ≥0,9 en once
    # artículos: «país», «indígenas», «libro», «niños»...
    "A": {
        "persona": "persona", "organizacion": "organización", "lugar": "lugar",
        "cargo": "cargo o rol", "ley": "ley o norma", "evento": "evento",
        "obra": "obra o publicación", "monto": "monto o cifra",
    },
    # Con «nombre de»: pide nombres propios, no categorías. Arregla
    # organización, obra y norma; empuja los nombres de grupo hacia persona.
    "B": {
        "persona": "nombre de persona",
        "organizacion": "nombre de organización, institución, empresa o partido",
        "lugar": "nombre de lugar",
        "cargo": "cargo público o título de un puesto",
        "ley": "nombre de ley, decreto, sentencia o norma jurídica",
        "evento": "nombre de evento o suceso",
        "obra": "título de libro, informe, periódico, revista o medio",
        "monto": "cantidad de dinero",
    },
    # Intermedia. «persona con nombre propio» es la mejor redacción de persona.
    "C": {
        "persona": "persona con nombre propio",
        "organizacion": "organización, institución, empresa o partido político",
        "lugar": "lugar geográfico",
        "cargo": "cargo o puesto que ocupa una persona",
        "ley": "ley, decreto, sentencia o norma",
        "evento": "evento o suceso con nombre",
        "obra": "obra, publicación o medio de comunicación",
        "monto": "monto de dinero o cifra",
    },
    # En inglés, que es el idioma en que se entrenaron casi todos. No rinde
    # mejor: 447 nombres comunes con ≥0,9.
    "D": {
        "persona": "person", "organizacion": "organization", "lugar": "location",
        "cargo": "job title or position", "ley": "law or legal norm", "evento": "event",
        "obra": "publication or creative work", "monto": "amount of money",
    },
    # La mejor redacción de cada tipo entre A, B y C: 544 → 92 nombres comunes
    # con ≥0,9. Ninguna arregla «evento»: el 90 % es nombre común en todas.
    "E": {
        "persona": "persona con nombre propio",
        "organizacion": "nombre de organización, institución, empresa o partido",
        "lugar": "nombre propio de lugar",
        "cargo": "cargo público o título de un puesto",
        "ley": "nombre de ley, decreto, sentencia o norma jurídica",
        "evento": "nombre propio de evento o suceso",
        "obra": "título de libro, informe, periódico, revista o medio",
        "monto": "monto de dinero o cifra",
    },
    # E más dos etiquetas señuelo. Un nombre de grupo —«indígenas», «niños»,
    # «empresarios»— acaba en persona o en organización según a cuál se le abra
    # más la puerta, porque el modelo le da a cada tramo la etiqueta que mejor
    # le cuadre de las que hay. Darle una que le cuadre mejor y tirarla es la
    # forma de que no acabe en ninguna de las buenas. «sustantivo común» se
    # llevaba también cosas reales: las relaciones cayeron un 30 %.
    "F": {
        **{}, "_senuelos": ["grupo genérico de personas", "sustantivo común"],
    },
    # Solo la señuelo de grupos: 92 → 44 nombres comunes con ≥0,9, y los falsos
    # de persona de 392 a 77.
    "G": {
        **{}, "_senuelos": ["grupo genérico de personas"],
    },
}
# G más señuelos para lo que en una entrevista real venía como persona con
# 0,8–0,97: pronombres («Usted», «Yo», «tu») y roles sueltos («dueño»,
# «trabajador», «experta»).
REDACCIONES["H"] = {"_senuelos": ["grupo genérico de personas", "pronombre personal",
                                  "oficio o rol genérico sin nombre propio"]}
REDACCIONES["F"] = {**REDACCIONES["E"], **REDACCIONES["F"]}
REDACCIONES["H"] = {**REDACCIONES["E"], **REDACCIONES["H"]}
REDACCIONES["G"] = {**REDACCIONES["E"], **REDACCIONES["G"]}

# Etiqueta del modelo → clave interna, para todas las redacciones. Así los
# scripts que comparan corridas entienden cualquiera de ellas.
CLAVES = {v: k for r in REDACCIONES.values() for k, v in r.items() if not k.startswith("_")}
UMBRAL, UMBRAL_REL = 0.30, 0.30


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ── Datos ────────────────────────────────────────────────────────────────

def articulos(db, lote=None, solo_calibracion=True, limite=None):
    """Los artículos del lote, partidos en párrafos exactamente como la app.

    Sin `lote`, el más reciente: los identificadores cambian cada vez que se
    rehace la base, y un número fijo apuntaba a un lote que ya no existía.
    """
    con = sqlite3.connect(db)
    if lote is None:
        lote = con.execute("SELECT MAX(id) FROM lotes").fetchone()[0]
        if lote is None:
            sys.exit("no hay ningún lote en la base: créalo en el paso 4 de la app")
    q = ("SELECT la.wp_id, a.text_plain, a.word_count FROM lote_articulos la "
         "JOIN articles a ON a.wp_id = la.wp_id "
         "JOIN lotes l ON l.id = la.lote_id AND a.connection_id = l.connection_id "
         "WHERE la.lote_id = ? " + ("AND la.calibra = 1 " if solo_calibracion else "") +
         "ORDER BY length(a.text_plain)")
    filas = con.execute(q, (lote,)).fetchall()
    if limite:
        filas = filas[:limite]
    return [(wp, [p for p in (t or "").split("\n\n") if p.strip()], wc) for wp, t, wc in filas]


def oro(db, lote):
    """Las marcas humanas, por artículo: (pi, ini, fin, tipo)."""
    con = sqlite3.connect(db)
    out = {}
    for wp, pi, ini, fin, tipo in con.execute(
            "SELECT wp_id, pi, ini, fin, tipo FROM anotaciones WHERE lote_id = ?", (lote,)):
        out.setdefault(wp, []).append((pi, ini, fin, tipo))
    return out


# ── Modelo ───────────────────────────────────────────────────────────────

def a_dispositivo(modelo, dispositivo, dtype):
    import torch
    modelo = modelo.to(dispositivo)
    if dtype == "fp16":
        modelo = modelo.to(torch.float16)
    elif dtype == "bf16":
        modelo = modelo.to(torch.bfloat16)
    modelo.eval()
    return modelo


def cargar(args):
    """El motor de la app, con el modelo en el dispositivo que se pida."""
    import spacy
    from gliner import GLiNER

    motor = Motor()
    motor.nlp = spacy.load(args.spacy, exclude=["ner", "lemmatizer", "textcat"])
    t0 = time.time()
    motor.modelo = a_dispositivo(GLiNER.from_pretrained(args.gliner), args.dispositivo, args.dtype)
    return motor, {"gliner_ms": round((time.time() - t0) * 1000)}


# ── Medir ────────────────────────────────────────────────────────────────

def correr(args):
    import torch
    torch.set_num_threads(args.hilos)

    arts = articulos(args.db, args.lote, not args.todo, args.articulos)
    if not arts or not any(ps for _, ps, _ in arts):
        sys.exit("el lote no tiene artículos con texto: ¿ya corrió el censo sobre ellos?")
    gold = oro(args.db, args.lote or max(a for a, in sqlite3.connect(args.db).execute("SELECT id FROM lotes")))
    log(f"{len(arts)} artículos · {sum(w for _, _, w in arts):,} palabras")

    redaccion = REDACCIONES[args.redaccion]
    senuelos = redaccion.get("_senuelos", [])
    motor, carga = cargar(args)
    # Las claves de esta redacción y solo de esta: lo que el modelo devuelva
    # con otra etiqueta —una señuelo— el motor lo descarta.
    motor.claves = {v: k for k, v in redaccion.items() if not k.startswith("_")}
    log(f"cargado en {carga}")
    etiquetas = [redaccion[k] for k in TIPOS] + senuelos
    predicados = PREDICADOS if args.relaciones == "si" else []

    # Calentar: la primera pasada en MPS compila kernels y no es representativa.
    motor.procesar(motor.nlp(arts[0][1][0]), etiquetas, predicados, UMBRAL, UMBRAL_REL)

    # Varias vueltas sobre los mismos artículos, y se guarda la última. En MPS
    # cada longitud de secuencia nueva paga un calentamiento (compila y cachea
    # el kernel: 212 ms la primera vez, 13 después) que sobre un archivo entero
    # se amortiza a nada y sobre doce artículos lo disfraza todo. La segunda
    # vuelta es el régimen que va a tener una extracción de verdad.
    resultados = []
    for vuelta in range(args.vueltas):
        if args.vueltas > 1:
            log(f"— vuelta {vuelta + 1} de {args.vueltas}")
        resultados = [medir_articulo(motor, wp, ps, pal, etiquetas, predicados) for wp, ps, pal in arts]

    salida = resumen(args, carga, resultados, gold)
    ruta = pathlib.Path(args.salida) / f"{args.nombre}.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(salida, ensure_ascii=False, indent=1))
    log(f"→ {ruta}")
    imprimir(salida)


def medir_articulo(motor, wp, parrafos, palabras, etiquetas, predicados):
    t0 = time.time()
    ents_art, rels_art = [], []
    por_ents, por_rels = motor.procesar_articulo(parrafos, etiquetas, predicados, UMBRAL, UMBRAL_REL)
    for pi, (ents, rels) in enumerate(zip(por_ents, por_rels)):
        ents_art.extend({"pi": pi, **e} for e in ents)
        rels_art.extend({"pi": pi, **r} for r in rels)
    seg = time.time() - t0
    log(f"  {wp:>7}  {palabras:>5} pal  {seg:6.1f} s  ({seg / max(palabras, 1) * 1000:5.2f} s/1k pal)"
        f"  {len(ents_art):4} ents  {len(rels_art):3} rels")
    return {
        "wp_id": wp, "parrafos": len(parrafos), "palabras": palabras, "segundos": round(seg, 2),
        "entidades": ents_art, "relaciones": rels_art,
    }


def resumen(args, carga, resultados, gold):
    por_mil = [r["segundos"] / max(r["palabras"], 1) * 1000 for r in resultados]
    tipos, preds = {}, {}
    for r in resultados:
        for e in r["entidades"]:
            k = CLAVES.get(e["etiqueta"], e["etiqueta"])
            tipos[k] = tipos.get(k, 0) + 1
        for x in r["relaciones"]:
            preds[x["predicado"]] = preds.get(x["predicado"], 0) + 1

    contra_oro = {
        r["wp_id"]: {str(u): evaluar(r["entidades"], gold[r["wp_id"]], u) for u in (0.3, 0.5, 0.7)}
        for r in resultados if r["wp_id"] in gold
    }
    return {
        "nombre": args.nombre,
        "config": {k: v for k, v in vars(args).items() if k not in ("db", "salida")},
        "carga_ms": carga,
        "articulos": len(resultados),
        "palabras": sum(r["palabras"] for r in resultados),
        "segundos_total": round(sum(r["segundos"] for r in resultados), 1),
        "seg_por_mil_palabras_mediana": round(statistics.median(por_mil), 3),
        "entidades_por_tipo": dict(sorted(tipos.items(), key=lambda kv: -kv[1])),
        "relaciones_por_predicado": dict(sorted(preds.items(), key=lambda kv: -kv[1])),
        "contra_oro": contra_oro,
        "por_articulo": resultados,
    }


def evaluar(ents, gold, umbral):
    """La misma regla que `calibracion.rs`: mismo párrafo, solape y mismo tipo.

    Ojo con leerla como precisión de verdad: el único artículo con marcas
    humanas se anotó **sobre propuestas del modelo** (60 de 61 con `auto=1`),
    así que mide parecido con aquella corrida, no acierto. `banco_oro.py` mira
    lo único que ahí es señal humana genuina: lo que la persona borró.
    """
    usados, vp, fp = set(), 0, 0
    for e in ents:
        if e["score"] < umbral:
            continue
        tipo = CLAVES.get(e["etiqueta"], e["etiqueta"])
        k = next((i for i, (gpi, gini, gfin, gt) in enumerate(gold)
                  if gpi == e["pi"] and e["inicio"] < gfin and gini < e["fin"] and gt == tipo), None)
        if k is None:
            fp += 1
        else:
            vp += 1
            usados.add(k)
    fn = len(gold) - len(usados)
    p = vp / (vp + fp) if vp + fp else 0.0
    r = vp / (vp + fn) if vp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"vp": vp, "fp": fp, "fn": fn, "p": round(p, 3), "r": round(r, 3), "f1": round(f, 3)}


def imprimir(s):
    print(f"\n{s['nombre']}: {s['articulos']} artículos, {s['palabras']:,} palabras")
    print(f"  carga {s['carga_ms']}")
    print(f"  total {s['segundos_total']} s · mediana {s['seg_por_mil_palabras_mediana']} s por 1.000 palabras")
    print(f"  entidades {sum(s['entidades_por_tipo'].values())}: {s['entidades_por_tipo']}")
    print(f"  relaciones {sum(s['relaciones_por_predicado'].values())}: {s['relaciones_por_predicado']}")
    for wp, ev in s["contra_oro"].items():
        print(f"  parecido con la corrida anotada de {wp}: "
              + "  ".join(f"@{u} P={v['p']} R={v['r']}" for u, v in ev.items()))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--nombre", required=True, help="cómo se llama esta corrida en los resultados")
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--lote", type=int, default=None, help="por defecto, el más reciente")
    ap.add_argument("--articulos", type=int, default=None, help="cuántos, de menor a mayor")
    ap.add_argument("--todo", action="store_true", help="el lote entero, no solo los de calibración")
    ap.add_argument("--gliner", default="knowledgator/gliner-relex-multi-v1.0")
    ap.add_argument("--spacy", default="es_core_news_sm")
    ap.add_argument("--relaciones", choices=["si", "no"], default="si")
    ap.add_argument("--redaccion", default="G", choices=sorted(REDACCIONES),
                    help="qué redacción de etiquetas se le pide al modelo")
    ap.add_argument("--dispositivo", default="cpu", choices=["cpu", "mps", "cuda"])
    ap.add_argument("--dtype", default="fp32", choices=["fp32", "fp16", "bf16"])
    ap.add_argument("--hilos", type=int, default=6)
    ap.add_argument("--vueltas", type=int, default=1, help="pasadas sobre los mismos artículos; se guarda la última")
    ap.add_argument("--salida", default=str(pathlib.Path(__file__).parent / "banco"))
    correr(ap.parse_args())


if __name__ == "__main__":
    main()

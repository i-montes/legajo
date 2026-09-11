#!/usr/bin/env python3
"""Alinea las extracciones de Quién-AI (Gemini y DeepSeek, 2025) al párrafo
exacto del archivo que Legajo tiene en disco.

Es el paso 5.2 de docs/plan-entrenamiento.md. Quién-AI dejó ~60.000
relaciones con una cita textual y sus dos extremos por nombre, pero sin
posición. Aquí cada relación se lleva al párrafo de Legajo donde está la cita
—el mismo texto, con las mismas coordenadas (wp_id, pi, ini, fin) que usan la
extracción y la revisión— o se descarta con la razón anotada. También se
localizan los cargos (`charge_or_position`) en el párrafo de la persona.

Lo que sale no es entrenamiento directo: son **pistas** para que el anotador
(gpt-oss-20b) anote el párrafo entero, y **control** para medir cuánto recupera.

    .venv/bin/python sidecar/alinear_quien_ai.py            # todo
    .venv/bin/python sidecar/alinear_quien_ai.py --muestra 30   # 30 filas al azar, con el párrafo, para mirar

Entrada: el volcado en ~/lsv/datos/quien-ai/*.jsonl.gz y legajo.sqlite.
Salida: ~/lsv/datos/quien-ai/alineado.jsonl y cargos.jsonl, más un informe.
"""
import argparse
import gzip
import json
import os
import pathlib
import random
import re
import sqlite3
import sys
import unicodedata
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO  # noqa: E402

DATOS = pathlib.Path(os.path.expanduser("~/lsv/datos/quien-ai"))

# ── Mapas del vocabulario de Quién-AI al nuestro ─────────────────────────

TIPO = {
    "PERSONA": "persona",
    "ORGANIZACION": "organizacion", "ENTIDAD GUBERNAMENTAL": "organizacion", "ENTE GUBERNAMENTAL": "organizacion",
    "PARTIDO POLITICO": "organizacion", "ENTIDAD PRIVADA": "organizacion", "INSTITUCION EDUCATIVA": "organizacion",
    "FUNDACION": "organizacion", "BANDA CRIMINAL": "organizacion", "GUERRILLA": "organizacion", "GUERRRILLA": "organizacion",
    "GRUPO PARAMILITAR": "organizacion", "ENTE DE CONTROL": "organizacion", "CORTE": "organizacion", "CONGRESO": "organizacion",
    "SINDICATO": "organizacion", "MEDIO DE COMUNICACIÓN": "organizacion", "MEDIO DE COMUNICACION": "organizacion", "ESTADO": "organizacion",
    "LUGAR": "lugar", "LUGARES": "lugar", "MUNICIPIO": "lugar", "CIUDAD": "lugar", "PAIS": "lugar", "DEPARTAMENTO": "lugar",
    "LOCALIDAD": "lugar", "BARRIO": "lugar", "REGION": "lugar", "CORREGIMIENTO": "lugar", "VEREDA": "lugar",
    "LEY": "ley", "LEYES": "ley", "DECRETO": "ley", "DECRETOS": "ley", "PROYECTO DE LEY": "ley",
}

# Familiares: predicado nuestro, simétrico, y cómo se lee el tipo de Quién-AI.
# El plan suponía que `relation_type` describía al DESTINO respecto al ORIGEN.
# Se verificó sobre 50 casos leyendo la cita (9 de septiembre de 2026): en 35 de
# los 46 claros es al revés, describe al ORIGEN: HIJO(a→b) = «a es hijo de b»
# = `hijo de` con cabeza a y cola b; PADRE(a→b) = «a es padre de b». Los 11
# restantes son errores de dirección del propio Gemini/DeepSeek. Por eso la
# dirección familiar de Quién-AI **no es verdad de entrenamiento**: viaja como
# pista sin dirección y el anotador la decide leyendo el párrafo.
FAMILIA = {
    "PADRE": ("padre o madre de", False), "MADRE": ("padre o madre de", False),
    "HIJO": ("hijo de", False), "HIJA": ("hijo de", False),
    "HERMANO": ("hermano de", True), "HERMANA": ("hermano de", True), "HERMANASTRO": ("hermano de", True),
    "ESPOSO": ("cónyuge o pareja de", True), "ESPOSA": ("cónyuge o pareja de", True),
    "RELACIÓN SENTIMENTAL": ("cónyuge o pareja de", True), "RELACION SENTIMENTAL": ("cónyuge o pareja de", True),
    "EX-ESPOSO": ("cónyuge o pareja de", True), "EX ESPOSO": ("cónyuge o pareja de", True), "EXESPOSO": ("cónyuge o pareja de", True),
    "EX-ESPOSA": ("cónyuge o pareja de", True), "EX-PAREJA": ("cónyuge o pareja de", True), "EXPAREJA": ("cónyuge o pareja de", True),
}
FAMILIAR_GENERICO = {"PRIMO", "PRIMA", "TÍO", "TIO", "TÍA", "TIA", "CUÑADO", "CUÑADA", "SOBRINO", "SOBRINA", "SUEGRO", "SUEGRA",
                     "ABUELO", "ABUELA", "YERNO", "NUERA", "NIETO", "NIETA", "BISABUELO", "AHIJADO", "PADRINO", "MADRINA",
                     "PADRASTRO", "HIJASTRO", "CONSUEGRO", "FAMILIAR"}
# Bolsas que el anotador tendrá que resolver: se conserva el par y la cita.
RECLASIFICAR = {"POLITICA", "LABORAL", "OTRO", "AMIGO", "MENTOR", "DISCIPULO"}

PARTICULAS = {"de", "del", "la", "las", "el", "los", "y", "da", "do", "dos", "das", "van", "von"}
OFICIOS_SUELTOS = {"abogado", "abogada", "periodista", "empresario", "empresaria", "político", "politico", "política",
                   "economista", "escritor", "escritora", "académico", "académica", "investigador", "investigadora",
                   "analista", "activista", "líder", "lider", "dirigente", "funcionario", "funcionaria", "experto", "experta"}


def plegar(s):
    """NFKD sin diacríticos, minúsculas, espacios colapsados, comillas rectas."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("“", '"').replace("”", '"').replace("«", '"').replace("»", '"').replace("’", "'").replace("‘", "'")
    return re.sub(r"\s+", " ", s).strip().lower()


def leer(col):
    ruta = DATOS / f"{col}.jsonl.gz"
    with gzip.open(ruta, "rt", encoding="utf-8") as f:
        for l in f:
            yield json.loads(l)


def oid(x):
    return x["$oid"] if isinstance(x, dict) else x


def normalizar_url(u):
    u = (u or "").strip().lower().replace("http://", "https://").replace("https://lasillavacia.com", "https://www.lasillavacia.com")
    return u.rstrip("/")


# ── Texto: el de Legajo, partido como la app ─────────────────────────────

def parrafos_de(texto):
    return [p for p in (texto or "").split("\n\n") if p.strip()]


def cargar_legajo(db):
    con = sqlite3.connect(db)
    por_url = {}
    for wp, link, texto in con.execute(
            "SELECT c.wp_id, c.link, a.text_plain FROM census c JOIN articles a ON a.wp_id = c.wp_id "
            "AND a.connection_id = c.connection_id WHERE a.text_plain IS NOT NULL AND a.text_plain <> ''"):
        por_url[normalizar_url(link)] = (wp, texto)
    return por_url


# ── Localizar un nombre en un párrafo ────────────────────────────────────

def variantes(nombre):
    """Del nombre completo al apellido: se busca la más específica primero."""
    n = re.sub(r"\s+", " ", nombre).strip()
    out = [n]
    sin = " ".join(t for t in n.split() if t.lower() not in PARTICULAS)
    if sin and sin != n:
        out.append(sin)
    toks = [t for t in n.split() if len(t) >= 4 and t.lower() not in PARTICULAS]
    if toks:
        out.append(toks[-1])
    return out


def localizar(nombre, parrafo, cerca=None):
    """Posición (ini, fin) de la variante más específica del nombre en el
    párrafo, con límites de palabra y, si hay varias, la más cercana a `cerca`."""
    pleg = plegar(parrafo)
    # Mapa de posiciones plegadas → originales. Plegar puede cambiar la
    # longitud (ligaduras, espacios múltiples), así que se hace carácter a carácter.
    mapa = []
    for i, ch in enumerate(parrafo):
        for _ in plegar(ch) or "":
            mapa.append(i)
    if len(mapa) != len(pleg):
        # Alguna rareza Unicode; se recurre a comparación directa.
        mapa = None
    for v in variantes(nombre):
        pv = plegar(v)
        if not pv:
            continue
        hits = [m.start() for m in re.finditer(r"(?<!\w)" + re.escape(pv) + r"(?!\w)", pleg)]
        if not hits:
            continue
        if cerca is not None and len(hits) > 1:
            hits.sort(key=lambda h: abs(h - cerca))
        h = hits[0]
        if mapa:
            ini = mapa[h]
            fin = mapa[min(h + len(pv) - 1, len(mapa) - 1)] + 1
        else:
            ini, fin = h, h + len(pv)
        return ini, fin, parrafo[ini:fin]
    return None


def hallar_cita(cita, parrafos):
    """El párrafo donde está la cita, y dónde dentro de él (plegado)."""
    pc = plegar(cita)
    if len(pc) < 20:
        return None
    candidatos = [pc]
    palabras = pc.split()
    if len(palabras) > 12:
        candidatos += [" ".join(palabras[:12]), " ".join(palabras[-12:])]
    for c in candidatos:
        for pi, p in enumerate(parrafos):
            pp = plegar(p)
            k = pp.find(c)
            if k >= 0:
                return pi, k
    return None


# ── Principal ────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--muestra", type=int, default=0, help="imprime N filas al azar con su párrafo, para mirar")
    ap.add_argument("--direccion", type=int, default=0, help="imprime N familiares para verificar la dirección")
    ap.add_argument("--semilla", type=int, default=7)
    args = ap.parse_args()
    random.seed(args.semilla)

    print("cargando Legajo…", file=sys.stderr)
    legajo = cargar_legajo(args.db)
    print(f"  {len(legajo):,} artículos con texto", file=sys.stderr)

    print("cargando Quién-AI…", file=sys.stderr)
    news = {}
    for d in leer("news"):
        news[oid(d["_id"])] = {"url": d.get("url", ""), "fecha": (d.get("published_date") or {}).get("$date", "")[:10],
                               "md": d.get("processed_content") or ""}
    print(f"  {len(news):,} noticias", file=sys.stderr)

    entidades = {}
    for corrida in ("gemi", "deep"):
        for d in leer(f"entities_{corrida}"):
            entidades[oid(d["_id"])] = (d.get("name", ""), d.get("entity_type", ""))
    print(f"  {len(entidades):,} entidades", file=sys.stderr)

    # Texto por noticia: Legajo si casa por URL; si no, el Markdown de Quién-AI.
    texto_de = {}
    sin_legajo = 0
    for nid, n in news.items():
        u = normalizar_url(n["url"])
        if u in legajo:
            wp, texto = legajo[u]
            texto_de[nid] = (wp, parrafos_de(texto), "legajo")
        else:
            sin_legajo += 1
            md = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", n["md"])
            md = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", md)
            md = re.sub(r"[*_#>]+", "", md)
            texto_de[nid] = (None, [p.strip() for p in re.split(r"\n\s*\n", md) if len(p.split()) >= 1], "quien-ai")
    print(f"  {len(news) - sin_legajo:,} casan con Legajo por URL; {sin_legajo:,} solo en Quién-AI", file=sys.stderr)

    razones = Counter()
    filas = []
    vistas = set()
    for corrida in ("gemi", "deep"):
        for d in leer(f"relationships_{corrida}"):
            razones[f"{corrida}:total"] += 1
            cita = d.get("exact_quote") or ""
            citas = [cita] + [v.get("exact_quote", "") for v in d.get("versions") or [] if isinstance(v, dict)]
            citas = [c for c in citas if c]
            if not citas:
                razones[f"{corrida}:sin_cita"] += 1
                continue
            nid = oid(d["new_id"])
            if nid not in texto_de:
                razones[f"{corrida}:sin_noticia"] += 1
                continue
            wp, parrafos, origen = texto_de[nid]
            a = entidades.get(oid(d["source"]))
            b = entidades.get(oid(d["target"]))
            if not a or not b:
                razones[f"{corrida}:sin_entidad"] += 1
                continue
            hit = None
            for c in citas:
                hit = hallar_cita(c, parrafos)
                if hit:
                    cita = c
                    break
            if not hit:
                razones[f"{corrida}:cita_no_hallada"] += 1
                continue
            pi, k = hit
            p = parrafos[pi]
            la = localizar(a[0], p, cerca=k)
            lb = localizar(b[0], p, cerca=k)
            if not la or not lb:
                razones[f"{corrida}:extremo_no_hallado"] += 1
                continue
            if la[:2] == lb[:2]:
                razones[f"{corrida}:mismo_tramo"] += 1
                continue
            rt = (d.get("relation_type") or "").strip().upper()
            ta, tb = TIPO.get(a[1]), TIPO.get(b[1])
            if rt in FAMILIA:
                pred, sim = FAMILIA[rt]
                # El origen es «rt» del destino: el origen es la cabeza (76 % de
                # los casos; el resto lo corrige el anotador con el texto).
                cabeza, cola = "a", "b"
            elif rt in FAMILIAR_GENERICO:
                pred, sim, cabeza, cola = "familiar de", True, "a", "b"
            elif rt in RECLASIFICAR:
                pred, sim, cabeza, cola = None, False, "a", "b"
            else:
                razones[f"{corrida}:tipo_desconocido:{rt}"] += 1
                continue
            clave = (wp or nid, pi, la[0], la[1], lb[0], lb[1], pred or rt)
            if clave in vistas:
                razones[f"{corrida}:duplicada"] += 1
                # Marcar la corrida en la fila existente.
                for f_ in filas:
                    if f_["_clave"] == clave and corrida not in f_["corridas"]:
                        f_["corridas"].append(corrida)
                continue
            vistas.add(clave)
            filas.append({
                "_clave": clave,
                "oid_news": nid, "wp_id": wp, "origen_texto": origen, "pi": pi, "fecha": news[nid]["fecha"],
                "predicado_qai": rt, "corridas": [corrida],
                "a": {"texto": la[2], "ini": la[0], "fin": la[1], "tipo": ta, "nombre_qai": a[0], "tipo_qai": a[1]},
                "b": {"texto": lb[2], "ini": lb[0], "fin": lb[1], "tipo": tb, "nombre_qai": b[0], "tipo_qai": b[1]},
                "cita": cita, "predicado": pred, "simetrico": sim, "cabeza": cabeza, "cola": cola,
            })
            razones[f"{corrida}:alineada"] += 1

    # ── Cargos ──────────────────────────────────────────────────────────
    cargos = []
    rc = Counter()
    vistos_c = set()
    for corrida in ("gemi", "deep"):
        for d in leer(f"properties_{corrida}"):
            cargo = (d.get("charge_or_position") or "").strip()
            if not cargo or len(cargo) < 4:
                continue
            rc[f"{corrida}:total"] += 1
            ent = entidades.get(oid(d["entitiesId"]))
            nid = oid(d["new_id"])
            if not ent or nid not in texto_de or ent[1] != "PERSONA":
                rc[f"{corrida}:sin_persona_o_noticia"] += 1
                continue
            if cargo.lower() in OFICIOS_SUELTOS or (cargo.islower() and " " not in cargo):
                rc[f"{corrida}:oficio_suelto"] += 1
                continue
            wp, parrafos, origen = texto_de[nid]
            hecho = False
            for pi, p in enumerate(parrafos):
                lc = localizar(cargo, p)
                if not lc:
                    continue
                lp = localizar(ent[0], p, cerca=lc[0])
                if not lp:
                    continue
                clave = (wp or nid, pi, lc[0], lc[1], lp[0], lp[1])
                if clave in vistos_c:
                    break
                vistos_c.add(clave)
                cargos.append({"oid_news": nid, "wp_id": wp, "origen_texto": origen, "pi": pi, "corrida": corrida,
                               "persona": {"texto": lp[2], "ini": lp[0], "fin": lp[1]},
                               "cargo": {"texto": lc[2], "ini": lc[0], "fin": lc[1], "cadena_qai": cargo}})
                rc[f"{corrida}:alineado"] += 1
                hecho = True
                break
            if not hecho:
                rc[f"{corrida}:no_hallado"] += 1

    for f_ in filas:
        f_.pop("_clave", None)

    if args.muestra:
        print(f"\n── {args.muestra} filas al azar ──")
        for f_ in random.sample(filas, min(args.muestra, len(filas))):
            wp, parrafos, _ = texto_de[f_["oid_news"]]
            p = parrafos[f_["pi"]]
            print(f"\n[{f_['wp_id']} · p{f_['pi']} · {'/'.join(f_['corridas'])}] {f_['predicado_qai']} → {f_['predicado']}")
            print(f"  A «{f_['a']['texto']}» ({f_['a']['tipo']})   B «{f_['b']['texto']}» ({f_['b']['tipo']})")
            print(f"  cita: {f_['cita'][:160]}")
            print(f"  párrafo: {p[:260]}{'…' if len(p) > 260 else ''}")
        return

    if args.direccion:
        fam = [f_ for f_ in filas if f_["predicado_qai"] in FAMILIA and not f_["simetrico"]]
        print(f"\n── {args.direccion} familiares direccionales para verificar la dirección ──")
        print("Regla aplicada: el DESTINO (B) es «tipo» del ORIGEN (A). Ej. PADRE(A→B) ⇒ B es padre de A.\n")
        for f_ in random.sample(fam, min(args.direccion, len(fam))):
            print(f"[{f_['wp_id']} p{f_['pi']}] A «{f_['a']['texto']}» —{f_['predicado_qai']}→ B «{f_['b']['texto']}»"
                  f"  ⇒ {f_['predicado']}: cabeza «{f_[f_['cabeza']]['texto']}», cola «{f_[f_['cola']]['texto']}»")
            print(f"   cita: {f_['cita'][:220]}\n")
        return

    with open(DATOS / "alineado.jsonl", "w", encoding="utf-8") as f:
        for f_ in filas:
            f.write(json.dumps(f_, ensure_ascii=False) + "\n")
    with open(DATOS / "cargos.jsonl", "w", encoding="utf-8") as f:
        for c in cargos:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")

    print("\n── relaciones ──")
    for k in sorted(razones):
        print(f"  {k:<40}{razones[k]:>8}")
    print(f"\n  alineadas totales: {len(filas):,}")
    print("  por predicado:", dict(Counter(f_["predicado"] or f_["predicado_qai"] for f_ in filas).most_common(20)))
    print("  en Legajo (con wp_id):", sum(1 for f_ in filas if f_["wp_id"]))
    print("  párrafos distintos:", len({(f_['oid_news'], f_['pi']) for f_ in filas}))
    print("  noticias distintas:", len({f_['oid_news'] for f_ in filas}))
    print("\n── cargos ──")
    for k in sorted(rc):
        print(f"  {k:<40}{rc[k]:>8}")
    print(f"  cargos alineados: {len(cargos):,} en {len({(c['oid_news'], c['pi']) for c in cargos}):,} párrafos")
    print(f"\n→ {DATOS/'alineado.jsonl'}\n→ {DATOS/'cargos.jsonl'}")


if __name__ == "__main__":
    main()

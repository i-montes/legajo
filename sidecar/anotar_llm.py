#!/usr/bin/env python3
"""Anota párrafos del archivo con un LLM local (gpt-oss-20b por Ollama), con
las pistas de Quién-AI, y valida la salida antes de guardarla.

Es el anotador de docs/plan-entrenamiento.md §5.4, y también el piloto de §4:
con `--piloto` toma 60 párrafos con pistas, los anota sin y con ellas, y mide
lo que el plan pide medir antes de gastar horas de máquina.

    .venv/bin/python sidecar/anotar_llm.py --piloto                 # fase 0
    .venv/bin/python sidecar/anotar_llm.py --seleccion sidecar/entrenamiento/seleccion.jsonl

Es reanudable: guarda cada párrafo al terminar y salta los ya hechos.
"""
import argparse
import json
import os
import pathlib
import random
import re
import sqlite3
import statistics
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from collections import Counter, defaultdict

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from banco import DB_POR_DEFECTO  # noqa: E402
from legajo_ner import CIFRA, aplicables, sin_espejos  # noqa: E402
from limpieza import repetir_menciones, separar_titulos  # noqa: E402
from vocabulario import CLAVE_DE_ETIQUETA, ETIQUETA, NO_SE_MARCA, POR_FAMILIA, PREDICADOS_DICT, PRONOMBRES, SENUELO, TIPOS  # noqa: E402
from alinear_quien_ai import DATOS  # noqa: E402

SALIDAS = pathlib.Path(os.path.expanduser("~/lsv/datos/entrenamiento"))
CLAVE_SENUELO = "grupo generico"

SISTEMA = (
    "Eres un anotador de prosa periodística colombiana para un archivo de poder político. "
    "Marcas entidades y relaciones SOLO si el párrafo las afirma, nunca lo que sabes por fuera. "
    "Respondes únicamente con el JSON pedido."
)

ESQUEMA = {
    "type": "object",
    "properties": {
        "entidades": {"type": "array", "items": {"type": "object", "properties": {
            "texto": {"type": "string"},
            "tipo": {"type": "string", "enum": TIPOS + [CLAVE_SENUELO]}}, "required": ["texto", "tipo"]}},
        "relaciones": {"type": "array", "items": {"type": "object", "properties": {
            "a": {"type": "string"}, "predicado": {"type": "string"}, "b": {"type": "string"},
            "cuando": {"type": "string", "enum": ["vigente", "pasada", "futura"]}}, "required": ["a", "predicado", "b", "cuando"]}},
        "pistas_rechazadas": {"type": "array", "items": {"type": "object", "properties": {
            "a": {"type": "string"}, "b": {"type": "string"}, "por_que": {"type": "string"}}, "required": ["a", "b", "por_que"]}},
    },
    "required": ["entidades", "relaciones", "pistas_rechazadas"],
}


def sin_tildes(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()


CLAVE_TIPO = {sin_tildes(k): k for k in TIPOS}
CLAVE_TIPO[sin_tildes(CLAVE_SENUELO)] = CLAVE_SENUELO
CLAVE_TIPO["grupo generico de personas"] = CLAVE_SENUELO
PREDICADO_POR_PLEGADO = {sin_tildes(p["etiqueta"]): p["etiqueta"] for p in PREDICADOS_DICT}


# ── Prompt ───────────────────────────────────────────────────────────────

PROMPT_VERSION = "v5"

PARENTESCO = {
    "padre o madre de": "papá, mamá, padre, madre («a» es el padre/la madre)",
    "hijo de": "hijo, hija («a» es el hijo/la hija)",
    "hermano de": "hermano, hermana, hermanastro",
    "cónyuge o pareja de": "esposo, esposa, ex esposo, pareja, compañero sentimental, novio, viudo",
    "familiar de": "cualquier otro parentesco: tío, sobrino, primo, cuñado, suegro, nuera, yerno, abuelo, nieto, tío abuelo, padrino, pariente",
}
NOMBRE_PROPIO = re.compile(r"(?<![.!?«“\"]\s)(?<!^)\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\b")
PALABRAS_PARENTESCO = re.compile(
    r"\b(pap[aá]|mam[aá]|padres?|madres?|hij[oa]s?|herman[oa]s?|hermanastr[oa]s?|espos[oa]s?|ex ?espos[oa]|pareja|compañer[oa] sentimental|novi[oa]|viud[oa]|"
    r"t[ií][oa]s?|sobrin[oa]s?|prim[oa]s?|cuñad[oa]s?|suegr[oa]s?|nuera|yerno|abuel[oa]s?|niet[oa]s?|padrino|madrina|pariente|familiar(?:es)?)\b", re.I)


def prompt_usuario(parrafo, fecha, pistas):
    tipos = "\n".join(f"- {k}: {ETIQUETA[k]}. No se marca: {NO_SE_MARCA[k]}." for k in TIPOS)
    tipos += f"\n- {CLAVE_SENUELO}: nombre de grupo sin nombre propio («los indígenas», «los empresarios», «los jóvenes»). Se pide para que no acaben en persona ni organización."
    preds = []
    for fam, lista in POR_FAMILIA.items():
        preds.append(f"[{fam}]")
        for p in PREDICADOS_DICT:
            if p["etiqueta"] in lista:
                d = "/".join(p["desde"]) or "cualquiera"
                h = "/".join(p["hasta"]) or "cualquiera"
                glosa = f" — cubre: {PARENTESCO[p['etiqueta']]}" if p["etiqueta"] in PARENTESCO else ""
                preds.append(f"- {p['etiqueta']}: de {d} a {h}" + (" (simétrica)" if p["simetrico"] else "") + glosa)
    reglas = (
        "1. Copia el texto de cada entidad EXACTAMENTE como aparece en el párrafo, sin cambiar mayúsculas ni tildes.\n"
        "2. No marques pronombres, nombres comunes, gentilicios ni fechas. Un adjetivo de afiliación o corriente («el conservador Marlon Cubillos», "
        "«uribista», «liberal», «petrista», «los verdes») no es organización ni se marca: solo se marca el nombre propio del partido o grupo («Partido Conservador», «Centro Democrático»).\n"
        "3. Un monto lleva cifra. Una norma es identificable («Ley 1448 de 2011») o no se marca.\n"
        "4. «El canciller Bermúdez» son dos marcas —cargo «canciller» y persona «Bermúdez»— unidas por «ocupa el cargo». La persona NUNCA incluye "
        "su cargo ni su título, ni siquiera en mayúscula: en «el exvicepresidente Germán Vargas Lleras» la persona es «Germán Vargas Lleras»; en «el Procurador Alejandro Ordóñez», "
        "cargo «Procurador» y persona «Alejandro Ordóñez». «Alcaldesa de Bogotá» es «ocupa el cargo» y además «dirige».\n"
        "5. Una relación solo si el párrafo la afirma; «habría», «se dice que» no cuentan. Sus dos extremos deben estar entre las entidades marcadas.\n"
        "6. «cuando»: vigente, pasada («exministro», «ex esposo») o futura, respecto a la fecha del artículo.\n"
        "7. En las relaciones asimétricas, «a» es el sujeto y «b» el objeto: «Nicolás Petro» hijo de «Gustavo Petro». Si el párrafo dice «su papá, Ricardo Romero», "
        "entonces «Ricardo Romero» padre o madre de «Camilo Romero».\n"
        "8. PARENTESCO: cada palabra de parentesco del párrafo (papá, hijo, hermano, esposa, tío, primo, sobrina, cuñada, suegra, nuera…) produce UNA relación familiar "
        "entre las dos personas que une, con el predicado de la lista que la cubre (los parentescos sin predicado propio van a «familiar de»). Se marca aunque una de las dos "
        "aparezca solo por nombre de pila («Federico», «César») o por apellido («Bonilla»), y aunque además haya otra relación en la misma frase: «Petro habló con su esposa "
        "Verónica Alcocer» es «cónyuge o pareja de» (y puede ser también «se reunió con»). Un parentesco no es un cargo: «esposa de X» nunca va en cargo.\n"
        "9. Una persona mencionada solo por nombre de pila o apodo sigue siendo persona si el párrafo la individualiza.\n"
        "10. «cuando» es «vigente» salvo que el párrafo marque que terminó («ex», «fue», «entonces», «hasta 2019»); los parentescos son vigentes. "
        "«parte de» une una organización con otra mayor (o una persona con su partido o bancada); una persona no es «parte de» un lugar.\n"
        "11. Un medio de comunicación (La Silla Vacía, El Tiempo, Blu Radio, una cuenta de Twitter de un medio) es organización; sus columnas, programas, "
        "secciones, libros y videos («Detector de Mentiras», «Huevos Revueltos») son obra. Una cuenta personal (@petrogustavo) es persona. "
        "«ocupa el cargo» exige un cargo o rol (ministro, alcaldesa, periodista, empresario); un parentesco o una relación («esposa de», «aliado de») nunca es cargo.\n"
        "12. Sé estricto con tres predicados que se marcan de más: «miembro de» solo si el párrafo dice que la persona pertenece o milita en la organización "
        "(«militante del Partido Liberal», «senador de Cambio Radical»), no porque el partido aparezca cerca ni por un adjetivo («el liberal X»); "
        "«se reunió con» solo ante una reunión, cita, cena o encuentro explícito entre los dos, no por hablar del otro ni por coincidir en un evento; "
        "«ubicado en» solo para la sede de una organización o la residencia declarada de una persona, no para el origen («el caleño X», «de Popayán») ni para el lugar de los hechos."
    )
    partes = [f"TIPOS DE ENTIDAD (usa exactamente estas claves):\n{tipos}", f"PREDICADOS (con los tipos que admiten):\n" + "\n".join(preds), f"REGLAS:\n{reglas}"]
    if pistas and (pistas.get("entidades") or pistas.get("relaciones")):
        ents = "; ".join(f"«{e['texto']}» ({e.get('tipo') or '?'})" for e in pistas.get("entidades", []))
        rels = []
        for r in pistas.get("relaciones", []):
            sug = f" (predicado sugerido: «{r['predicado']}»)" if r.get("predicado") else " (pertenece a la familia " + {"POLITICA": "[politica]", "LABORAL": "[laboral]"}.get(r["tipo_qai"], "que corresponda") + ")"
            rels.append(f"  - entre «{r['a']}» y «{r['b']}» vio «{r['tipo_qai']}»{sug}" + (f" (cita: “{r['cita'][:200]}”)" if r.get("cita") else ""))
        partes.append("PISTAS. Otro sistema ya encontró en este párrafo estas entidades: " + (ents or "ninguna") + ".\n"
                      + ("Y afirmó estas relaciones, con SU nombre de tipo, que no es el de la lista y cuya dirección puede estar invertida:\n" + "\n".join(rels) + "\n" if rels else "")
                      + "Compruébalo contra el párrafo. Traduce cada pista al predicado exacto de la lista y a la dirección que el párrafo afirma. "
                      "Rechaza una pista (en pistas_rechazadas, con el motivo) SOLO si el párrafo no afirma NINGUNA relación entre esas dos entidades; "
                      "que el nombre del tipo no esté en la lista no es motivo. Las pistas pueden estar equivocadas.")
    parentescos = sorted({m.group(0).lower() for m in PALABRAS_PARENTESCO.finditer(parrafo)})
    if parentescos:
        partes.append("AVISO: el párrafo contiene palabras de parentesco (" + ", ".join(parentescos) + "). Revisa si cada una une a dos personas marcadas y, si es así, marca la relación familiar (regla 8).")
    partes.append('FORMATO DE SALIDA (JSON, exactamente estas claves, en español): {"entidades": [{"texto": "...", "tipo": "..."}], '
                  '"relaciones": [{"a": "...", "predicado": "...", "b": "...", "cuando": "vigente|pasada|futura"}], '
                  '"pistas_rechazadas": [{"a": "...", "b": "...", "por_que": "..."}]}')
    partes.append(f"FECHA DEL ARTÍCULO: {fecha or 'desconocida'}\n\nPÁRRAFO:\n«{parrafo}»")
    return "\n\n".join(partes)


def clave_api():
    """La clave de la API, si hay: variable LEGAJO_LLM_CLAVE o ~/.config/legajo/*.key."""
    import os
    if os.environ.get("LEGAJO_LLM_CLAVE"):
        return os.environ["LEGAJO_LLM_CLAVE"]
    for ruta in sorted(pathlib.Path.home().glob(".config/legajo/*.key")):
        return ruta.read_text().strip()
    return None


def pedir(url, modelo, sistema, usuario, ctx, razonamiento, reintento=False):
    mensajes = [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]
    cabeceras = {"Content-Type": "application/json"}
    if "/chat/completions" in url:
        # Una API compatible con OpenAI (MiniMax, etc.). El razonamiento viene
        # dentro del contenido entre <think>…</think> y se quita; `razonamiento`
        # vacío lo desactiva.
        cuerpo = {"model": modelo, "messages": mensajes, "temperature": 0.2 if reintento else 0,
                  "max_tokens": 12000, "response_format": {"type": "json_object"}}
        if not razonamiento:
            cuerpo["thinking"] = {"type": "disabled"}
        clave = clave_api()
        if clave:
            cabeceras["Authorization"] = "Bearer " + clave
    else:
        cuerpo = {
            "model": modelo, "stream": False, "format": ESQUEMA, "messages": mensajes,
            # El razonamiento de gpt-oss cuenta dentro de `num_predict`: con 1.500 se
            # quedaba sin sitio para el JSON. Sin razonamiento («think: false») no
            # responde nada, así que se va con «low» y presupuesto de sobra.
            "options": {"temperature": 0.2 if reintento else 0, "num_ctx": ctx, "num_predict": 4000},
        }
        if razonamiento:
            cuerpo["think"] = razonamiento
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode(), headers=cabeceras)
    t0 = time.time()
    # Contra una API, una petición que no contesta en tres minutos se da por
    # perdida y se repite: con ocho hilos, las que se colgaban dejaban el
    # anotador parado sin error alguno.
    espera = 180 if "/chat/completions" in url else 900
    for intento in range(10):
        try:
            with urllib.request.urlopen(req, timeout=espera) as r:
                resp = json.load(r)
            break
        except urllib.error.HTTPError as e:
            # El plan de MiniMax limita tokens por ventana de tiempo (429 «rate
            # limit reached» aunque la cuota total esté al 35 %): se espera de
            # verdad en vez de insistir, que cada intento rechazado también cuenta.
            if e.code == 429 and intento < 9:
                time.sleep(min(20 * (intento + 1), 120)); continue
            if e.code in (500, 502, 503, 504) and intento < 9:
                time.sleep(5 * (intento + 1)); continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            if intento < 4:
                time.sleep(5 * (intento + 1)); continue
            raise
    if "/chat/completions" in url:
        contenido = re.sub(r"<think>.*?</think>", "", resp["choices"][0]["message"].get("content") or "", flags=re.S).strip()
        uso = resp.get("usage", {})
        return contenido, time.time() - t0, uso.get("completion_tokens", 0), uso.get("prompt_tokens", 0)
    return resp["message"]["content"], time.time() - t0, resp.get("eval_count", 0), resp.get("prompt_eval_count", 0)


# ── Validación a la salida ───────────────────────────────────────────────

def localizar(texto, parrafo, desde=0):
    i = parrafo.find(texto, desde)
    if i >= 0:
        return i, texto
    pl, tl = parrafo.lower(), texto.lower()
    i = pl.find(tl, desde)
    if i >= 0:
        return i, parrafo[i:i + len(texto)]
    # Sin tildes, con mapa de posiciones.
    ps, mapa = [], []
    for k, ch in enumerate(parrafo):
        for _ in sin_tildes(ch) or "":
            ps.append(sin_tildes(ch)); mapa.append(k)
    pj = "".join(ps)
    i = pj.find(sin_tildes(texto), desde)
    if i >= 0 and mapa:
        ini = mapa[i]; fin = mapa[min(i + len(sin_tildes(texto)) - 1, len(mapa) - 1)] + 1
        return ini, parrafo[ini:fin]
    return -1, None


def validar(salida, parrafo, contadores):
    """Del JSON crudo a entidades con posición y relaciones con índice."""
    try:
        d = json.loads(salida)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", salida, re.S)
        if not m:
            contadores["json_invalido"] += 1; return None
        try:
            d = json.loads(m.group(0))
        except json.JSONDecodeError:
            contadores["json_invalido"] += 1; return None
    # Tolerancia a claves en inglés: algún modelo las traduce aunque se le pida lo contrario.
    if "entidades" not in d and "entities" in d:
        d["entidades"] = [{"texto": e.get("text", e.get("texto")), "tipo": e.get("type", e.get("tipo"))} for e in d.get("entities") or [] if isinstance(e, dict)]
    if "relaciones" not in d and "relations" in d:
        d["relaciones"] = d.get("relations")
    for r in d.get("relaciones") or []:
        if isinstance(r, dict) and "predicado" not in r:
            r["predicado"] = r.get("pred", r.get("predicate", r.get("relation", "")))
        if isinstance(r, dict) and "cuando" not in r:
            r["cuando"] = r.get("when", "vigente")
    ents, usados, indice_de = [], {}, {}
    for e in d.get("entidades") or []:
        if not isinstance(e, dict):
            continue
        tx = str(e.get("texto", "")).strip()
        tipo = CLAVE_TIPO.get(sin_tildes(str(e.get("tipo", ""))))
        if not tx or tipo is None:
            contadores["tipo_desconocido"] += 1; continue
        i, real = localizar(tx, parrafo, usados.get(tx.lower(), 0))
        if i < 0:
            contadores["no_localizada"] += 1; continue
        usados[tx.lower()] = i + len(real)
        if tipo == "persona" and real.strip().lower() in PRONOMBRES:
            contadores["pronombre"] += 1; continue
        if tipo == "monto" and not CIFRA.search(real):
            contadores["monto_sin_cifra"] += 1; continue
        ents.append({"ini": i, "fin": i + len(real), "tipo": tipo, "texto": real})
        indice_de.setdefault(real, len(ents) - 1)
        indice_de.setdefault(tx, len(ents) - 1)
    rels = []
    for r in d.get("relaciones") or []:
        if not isinstance(r, dict):
            continue
        a, b = str(r.get("a", "")).strip(), str(r.get("b", "")).strip()
        pred = PREDICADO_POR_PLEGADO.get(sin_tildes(str(r.get("predicado", ""))))
        if not a or not b or a == b or pred is None:
            contadores["rel_predicado_desconocido" if pred is None else "rel_mal_formada"] += 1; continue
        ia, ib = indice_de.get(a), indice_de.get(b)
        if ia is None or ib is None:
            contadores["rel_extremo_no_marcado"] += 1; continue
        ta, tb = ents[ia]["tipo"], ents[ib]["tipo"]
        if ta == CLAVE_SENUELO or tb == CLAVE_SENUELO:
            contadores["rel_con_senuelo"] += 1; continue
        if not any(p["etiqueta"] == pred for p in aplicables(PREDICADOS_DICT, ta, tb)):
            contadores["rel_tipos_no_admitidos"] += 1; continue
        if pred == "parte de" and tb == "lugar" and ta not in ("organizacion", "lugar"):
            contadores["rel_parte_de_lugar"] += 1; continue
        cuando = str(r.get("cuando", "vigente")).lower()
        rels.append({"a": ents[ia]["texto"], "b": ents[ib]["texto"], "predicado": pred, "score": 1.0,
                     "cuando": cuando if cuando in ("vigente", "pasada", "futura") else "vigente", "ia": ia, "ib": ib})
    rels = sin_espejos(rels, PREDICADOS_DICT)
    # «X padre o madre de Y» y «X hijo de Y» a la vez: una es falsa y no se sabe cuál; fuera las dos.
    contradictorias = {(r["ia"], r["ib"]) for r in rels if r["predicado"] == "padre o madre de"} & {(r["ia"], r["ib"]) for r in rels if r["predicado"] == "hijo de"}
    if contradictorias:
        contadores["rel_contradictoria"] += len(contradictorias)
        rels = [r for r in rels if (r["ia"], r["ib"]) not in contradictorias or r["predicado"] not in ("padre o madre de", "hijo de")]
    rechazadas = [x for x in (d.get("pistas_rechazadas") or []) if isinstance(x, dict)]
    return ents, [{"a": r["ia"], "b": r["ib"], "predicado": r["predicado"], "cuando": r["cuando"]} for r in rels], rechazadas


# ── Datos: texto y pistas ────────────────────────────────────────────────

def cargar_textos(db, wps):
    con = sqlite3.connect(db)
    out = {}
    marcas = ",".join(str(w) for w in wps)
    for wp, fecha, texto in con.execute(f"SELECT c.wp_id, c.date, a.text_plain FROM census c JOIN articles a ON a.wp_id=c.wp_id AND a.connection_id=c.connection_id WHERE c.wp_id IN ({marcas})"):
        out[wp] = ((fecha or "")[:10], [p for p in (texto or "").split("\n\n") if p.strip()])
    return out


def cargar_pistas():
    """Pistas por (wp_id, pi): entidades (con tipo si mapea) y relaciones con su cita."""
    pistas = defaultdict(lambda: {"entidades": {}, "relaciones": []})
    for l in open(DATOS / "alineado.jsonl", encoding="utf-8"):
        f = json.loads(l)
        if f["wp_id"] is None:
            continue
        k = (f["wp_id"], f["pi"])
        for lado in ("a", "b"):
            e = f[lado]
            pistas[k]["entidades"].setdefault(e["texto"], e["tipo"])
        pistas[k]["relaciones"].append({"a": f["a"]["texto"], "b": f["b"]["texto"], "tipo_qai": f["predicado_qai"],
                                        "predicado": f["predicado"], "cabeza": f["cabeza"], "cita": f["cita"], "corridas": f["corridas"]})
    for l in open(DATOS / "cargos.jsonl", encoding="utf-8"):
        c = json.loads(l)
        if c["wp_id"] is None:
            continue
        k = (c["wp_id"], c["pi"])
        pistas[k]["entidades"].setdefault(c["persona"]["texto"], "persona")
        pistas[k]["entidades"].setdefault(c["cargo"]["texto"], "cargo")
    return {k: {"entidades": [{"texto": t, "tipo": tp} for t, tp in v["entidades"].items()], "relaciones": v["relaciones"]}
            for k, v in pistas.items()}


# ── Correr ───────────────────────────────────────────────────────────────

def anotar_uno(wp, pi, estrato, textos, pistas, args, contadores, con_pistas):
    fecha, ps = textos[wp]
    texto = ps[pi]
    p = pistas.get((wp, pi)) if con_pistas else None
    crudo, seg, tok, ptok = pedir(args.url, args.modelo, SISTEMA, prompt_usuario(texto, fecha, p), args.ctx, args.razonamiento)
    v = validar(crudo, texto, contadores)
    # Vacío sospechoso: sin entidades en un párrafo con nombres propios. gpt-oss a veces devuelve
    # las tres listas vacías en 3-4 s; una repetición con algo de temperatura suele arreglarlo.
    if v is not None and not v[0] and len(NOMBRE_PROPIO.findall(texto)) >= 2:
        contadores["vacio_reintentado"] += 1
        v = None
    if v is None:
        crudo, seg2, tok, ptok = pedir(args.url, args.modelo, SISTEMA, prompt_usuario(texto, fecha, p), args.ctx, args.razonamiento, reintento=True)
        seg += seg2
        v = validar(crudo, texto, contadores)
    if v is None:
        fila = {"wp_id": wp, "pi": pi, "estrato": estrato, "fecha": fecha, "texto": texto, "invalido": True,
                "modelo": args.modelo, "razonamiento": args.razonamiento, "segundos": round(seg, 1), "con_pistas": con_pistas}
    else:
        ents, rels, rech = v
        separar_titulos(texto, ents, rels, contadores)
        repetir_menciones(texto, ents, contadores)
        rec = conf = 0
        if p:
            textos_ents = {e["texto"].lower() for e in ents}
            rec = sum(1 for e in p["entidades"] if e["texto"].lower() in textos_ents or any(e["texto"].lower() in t or t in e["texto"].lower() for t in textos_ents))
            pares = {frozenset((ents[r["a"]]["texto"].lower(), ents[r["b"]]["texto"].lower())) for r in rels}
            conf = sum(1 for r in p["relaciones"] if frozenset((r["a"].lower(), r["b"].lower())) in pares)
        fila = {"wp_id": wp, "pi": pi, "estrato": estrato, "fecha": fecha, "texto": texto,
                "entidades": ents, "relaciones": rels, "pistas_rechazadas": rech,
                "pistas": {"entidades": len(p["entidades"]) if p else 0, "recuperadas": rec,
                           "relaciones": len(p["relaciones"]) if p else 0, "confirmadas": conf, "rechazadas": len(rech)},
                "modelo": args.modelo, "razonamiento": args.razonamiento, "segundos": round(seg, 1),
                "tokens": tok, "tokens_prompt": ptok, "con_pistas": con_pistas, "fuente": "plata", "prompt": PROMPT_VERSION}
    return fila, seg, (tok / seg if seg else 0)


def anotar(parrafos, textos, pistas, args, salida, con_pistas=True):
    """Reanudable: salta lo que ya está en `salida`. Con --paralelo N (API) lanza N
    peticiones a la vez; la salida se escribe según van terminando."""
    import concurrent.futures as cf
    hechos = set()
    if salida.exists():
        for l in open(salida, encoding="utf-8"):
            d = json.loads(l); hechos.add((d["wp_id"], d["pi"]))
    pendientes = [(wp, pi, e) for wp, pi, e in parrafos if (wp, pi) not in hechos]
    contadores = Counter(); tiempos = []; toks = []
    f = open(salida, "a", encoding="utf-8")
    hilos = max(1, getattr(args, "paralelo", 1) or 1)
    n = 0
    def volcar(fila, seg, tps):
        nonlocal n
        tiempos.append(seg); toks.append(tps); n += 1
        f.write(json.dumps(fila, ensure_ascii=False) + "\n"); f.flush()
        if n % 10 == 0 or n == len(pendientes):
            print(f"  {n}/{len(pendientes)}  {statistics.median(tiempos):.1f} s/párrafo  {statistics.median(toks):.0f} tok/s  "
                  f"inválidos {contadores['json_invalido']}", file=sys.stderr, flush=True)
    if hilos == 1:
        for wp, pi, e in pendientes:
            volcar(*anotar_uno(wp, pi, e, textos, pistas, args, contadores, con_pistas))
    else:
        with cf.ThreadPoolExecutor(hilos) as ex:
            futuros = [ex.submit(anotar_uno, wp, pi, e, textos, pistas, args, contadores, con_pistas) for wp, pi, e in pendientes]
            for fu in cf.as_completed(futuros):
                volcar(*fu.result())
    f.close()
    return contadores, tiempos, toks


def muestra_piloto(pistas, textos_disponibles, n_fam=30, n_pol=20, n_regex=10, semilla=7):
    """Los 60 párrafos del piloto: 30 con familiar, 20 con política/laboral, 10 con monto o ley."""
    random.seed(semilla)
    fam, pol = [], []
    for k, p in pistas.items():
        if k[0] not in textos_disponibles:
            continue
        tipos = {r["tipo_qai"] for r in p["relaciones"]}
        if any(r["predicado"] for r in p["relaciones"]):
            fam.append(k)
        elif tipos & {"POLITICA", "LABORAL"}:
            pol.append(k)
    random.shuffle(fam); random.shuffle(pol)
    return [(wp, pi, "F") for wp, pi in fam[:n_fam]] + [(wp, pi, "PL") for wp, pi in pol[:n_pol]]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelo", default="gpt-oss:20b")
    ap.add_argument("--url", default="http://localhost:11434/api/chat")
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--ctx", type=int, default=8192)
    ap.add_argument("--razonamiento", default="low", help="low | medium | high | '' para no mandar el parámetro")
    ap.add_argument("--piloto", action="store_true")
    ap.add_argument("--seleccion", help="JSONL con wp_id, pi, estrato")
    ap.add_argument("--apartado", action="store_true", help="anotar SIN pistas todos los párrafos de los 30 artículos apartados, para que una persona los corrija en la app")
    ap.add_argument("--articulos", help="fichero con wp_id (uno por línea): anotar SIN pistas todos sus párrafos, para corregirlos como oro")
    ap.add_argument("--apartado-con-pistas", action="store_true", help="con --apartado: usar las pistas de Quién-AI (para medir el techo del anotador tal como anota la plata)")
    ap.add_argument("--salida", default=None)
    ap.add_argument("--limite", type=int, default=None)
    ap.add_argument("--estratos", default=None, help="piloto: solo estos estratos, p. ej. F,PL")
    ap.add_argument("--pasadas", default="sin,con", help="piloto: sin | con | sin,con")
    ap.add_argument("--etiqueta", default="", help="sufijo para el archivo de salida (versión del prompt)")
    ap.add_argument("--paralelo", type=int, default=1, help="peticiones simultáneas (solo tiene sentido contra una API)")
    args = ap.parse_args()
    SALIDAS.mkdir(parents=True, exist_ok=True)

    from apartar import apartados
    wps_apartados, _ = apartados()
    pistas = cargar_pistas()

    if args.piloto:
        # Los apartados no entran ni en el piloto.
        disponibles = {k[0] for k in pistas} - wps_apartados
        textos = cargar_textos(args.db, disponibles)
        muestra = muestra_piloto(pistas, set(textos))
        # Los 10 de monto/ley: párrafos de esos mismos artículos con regex, sin pista.
        regex = re.compile(r"\d[\d.,]*\s*(mil|millones|billones|pesos|dólares|%|por ciento)|\b(Ley|Decreto|Sentencia|Acto Legislativo)\s+\d", re.I)
        extra = [(wp, pi, "EN") for wp, (fecha, ps) in textos.items() for pi, p in enumerate(ps)
                 if regex.search(p) and 40 <= len(p.split()) <= 200 and (wp, pi) not in pistas]
        random.shuffle(extra); muestra += extra[:10]
        if args.estratos:
            muestra = [m for m in muestra if m[2] in args.estratos.split(",")]
        print(f"piloto: {len(muestra)} párrafos ({Counter(e for _, _, e in muestra)})", file=sys.stderr)
        for con in [x == "con" for x in args.pasadas.split(",")]:
            sufijo = f"-{args.etiqueta}" if args.etiqueta else ""
            salida = SALIDAS / f"piloto-{'con' if con else 'sin'}-pistas-{re.sub(r'[^A-Za-z0-9.]+', '-', args.modelo)}-{args.razonamiento or 'nothink'}{sufijo}.jsonl"
            print(f"\n── {'con' if con else 'sin'} pistas → {salida.name}", file=sys.stderr)
            c, t, k = anotar(muestra, textos, pistas, args, salida, con_pistas=con)
            print(f"  descartes: {dict(c)}", file=sys.stderr)
        return

    if args.articulos:
        wps = {int(x) for x in open(args.articulos).read().split()}
        textos = cargar_textos(args.db, wps)
        muestra = [(wp, pi, "ORO") for wp in sorted(textos) for pi, p in enumerate(textos[wp][1]) if len(p.split()) >= 8]
        salida = pathlib.Path(args.salida) if args.salida else SALIDAS / (pathlib.Path(args.articulos).stem + "-sin-pistas.jsonl")
        print(f"{len(textos)} artículos, {len(muestra)} párrafos → {salida.name}", file=sys.stderr)
        c, t, k = anotar(muestra, textos, pistas, args, salida, con_pistas=False)
        print(f"descartes: {dict(c)}", file=sys.stderr)
        return

    if args.apartado:
        textos = cargar_textos(args.db, wps_apartados)
        muestra = [(wp, pi, "AP") for wp in sorted(textos) for pi, p in enumerate(textos[wp][1]) if len(p.split()) >= 8]
        salida = pathlib.Path(args.salida) if args.salida else SALIDAS / "apartado-sin-pistas.jsonl"
        print(f"apartado: {len(textos)} artículos, {len(muestra)} párrafos → {salida.name}", file=sys.stderr)
        c, t, k = anotar(muestra, textos, pistas, args, salida, con_pistas=args.apartado_con_pistas)
        print(f"descartes: {dict(c)}", file=sys.stderr)
        return

    filas = [json.loads(l) for l in open(args.seleccion, encoding="utf-8")]
    if args.limite:
        filas = filas[:args.limite]
    if any(f["wp_id"] in wps_apartados for f in filas):
        sys.exit("la selección contiene artículos apartados: abortado")
    textos = cargar_textos(args.db, {f["wp_id"] for f in filas})
    salida = pathlib.Path(args.salida) if args.salida else SALIDAS / "plata.jsonl"
    c, t, k = anotar([(f["wp_id"], f["pi"], f.get("estrato", "?")) for f in filas], textos, pistas, args, salida)
    print(f"descartes: {dict(c)}", file=sys.stderr)
    print(f"→ {salida}")


if __name__ == "__main__":
    main()

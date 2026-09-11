"""El juez de identidades: decide con los párrafos lo que las reglas no pueden.

Toma la cola de casos dudosos del lote —la misma que enseña el grafo, con las
reglas por tipo ya aplicadas y sin lo decidido— y para cada par le enseña a un
LLM los párrafos donde aparece cada nombre. Con contexto la mayoría es obvia:
«Carlos Herney Abadía» y «Juan Carlos Abadía» aparecen como padre e hijo en el
propio archivo.

Veredictos, en `resoluciones` con fuente «juez:<modelo>» y la razón:
- «misma» o «distinta» cuando el juez está seguro (confianza ≥ --umbral);
- «posponer» con la razón cuando duda o cuando un apellido suelto («Petro») se
  refiere a varias personas en el lote: fundirlo con una de ellas sería mentir.

Los casos con confianza 1 de las reglas (el mismo nombre en otra grafía) se
deciden «misma» sin preguntar, con fuente «regla». Lo que decidió una persona
no se toca. Es reanudable: lo ya decidido no se vuelve a preguntar.

  .venv/bin/python sidecar/juez_alias.py --lote 8 --paralelo 2
  .venv/bin/python sidecar/juez_alias.py --lote 8 --modelo gpt-oss:20b --url http://localhost:11434/api/chat
"""
import argparse
import json
import pathlib
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import DB_POR_DEFECTO, clave_api  # noqa: E402
from importar_alias import casos, plegar  # noqa: E402

SISTEMA = """Eres editor de un archivo periodístico colombiano. Te dan dos nombres del mismo tipo (persona, organización, cargo, lugar u obra) y párrafos del archivo donde aparece cada uno. Decide si los dos nombres designan la misma entidad.

Reglas:
- Dos personas con el mismo apellido y nombres de pila distintos son personas distintas, aunque sean familia.
- Un apellido o un nombre corto («Petro», «Galán», «la Unidad») designa a alguien concreto solo si en TODOS los párrafos dados se refiere a la misma persona u organización que el nombre completo. Si en unos se refiere a una y en otros a otra, es ambiguo: no es ni misma ni distinta.
- Un cargo es el mismo si es la misma plaza aunque cambie «ex», «entonces» o el titular.
- Decide solo con lo que dicen los párrafos y lo que sabes con certeza del país; si no alcanza, di que dudas.

Responde solo con JSON: {"veredicto": "misma" | "distinta" | "ambiguo" | "duda", "confianza": número entre 0 y 1, "razon": "una frase"}"""


def preguntar(url, modelo, usuario):
    mensajes = [{"role": "system", "content": SISTEMA}, {"role": "user", "content": usuario}]
    cabeceras = {"Content-Type": "application/json"}
    if "/chat/completions" in url:
        cuerpo = {"model": modelo, "messages": mensajes, "temperature": 0, "max_tokens": 600,
                  "response_format": {"type": "json_object"}, "thinking": {"type": "disabled"}}
        clave = clave_api()
        if clave:
            cabeceras["Authorization"] = "Bearer " + clave
    else:
        cuerpo = {"model": modelo, "stream": False, "format": "json", "messages": mensajes,
                  "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 600}, "think": "low"}
    req = urllib.request.Request(url, data=json.dumps(cuerpo).encode(), headers=cabeceras)
    for intento in range(8):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                resp = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and intento < 7:
                time.sleep(min(15 * (intento + 1), 90)); continue
            raise
        except (urllib.error.URLError, TimeoutError, OSError):
            if intento < 4:
                time.sleep(5 * (intento + 1)); continue
            raise
    if "/chat/completions" in url:
        texto = resp["choices"][0]["message"].get("content") or ""
    else:
        texto = resp["message"]["content"]
    texto = re.sub(r"<think>.*?</think>", "", texto, flags=re.S).strip()
    m = re.search(r"\{.*\}", texto, flags=re.S)
    return json.loads(m.group(0) if m else texto)


def contextos(con, lote, nombre, maximo):
    """Párrafos del lote donde aparece el nombre, recortados alrededor de él."""
    filas = con.execute(
        """SELECT DISTINCT x.wp_id, x.pi FROM (
             SELECT wp_id, pi FROM anotaciones WHERE lote_id=? AND texto=?
             UNION SELECT wp_id, pi FROM extraidas WHERE lote_id=? AND texto=?) x
           ORDER BY x.wp_id, x.pi LIMIT ?""", (lote, nombre, lote, nombre, maximo * 3)).fetchall()
    out, vistos = [], set()
    for wp, pi in filas:
        if len(out) >= maximo:
            break
        fila = con.execute("SELECT text_plain FROM articles WHERE wp_id=?", (wp,)).fetchone()
        if not fila or not fila[0]:
            continue
        parrafos = [p for p in fila[0].split("\n\n") if p.strip()]
        if pi >= len(parrafos):
            continue
        p = parrafos[pi]
        i = p.find(nombre)
        if i < 0:
            i = 0
        ini, fin = max(0, i - 260), min(len(p), i + len(nombre) + 260)
        trozo = ("…" if ini else "") + p[ini:fin] + ("…" if fin < len(p) else "")
        if trozo not in vistos:
            vistos.add(trozo); out.append((wp, trozo))
    return out


def decidir(con, lote, c, decision, confianza, fuente, motivo):
    con.execute(
        """INSERT INTO resoluciones (lote_id, clave, a_nombre, b_nombre, tipo, decision, confianza, fuente, motivo)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(lote_id, clave) DO UPDATE SET decision=excluded.decision, confianza=excluded.confianza,
             fuente=excluded.fuente, motivo=excluded.motivo, decidido_at=datetime('now')
           WHERE resoluciones.fuente <> 'persona'""",
        (lote, c["clave"], c["a"]["nombre"], c["b"]["nombre"], c["tipo"], decision, confianza, fuente, motivo))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lote", type=int, required=True)
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--modelo", default="MiniMax-M3")
    ap.add_argument("--url", default="https://api.minimax.io/v1/chat/completions")
    ap.add_argument("--paralelo", type=int, default=2)
    ap.add_argument("--umbral", type=float, default=0.75, help="confianza mínima para decidir en vez de posponer")
    ap.add_argument("--contextos", type=int, default=4, help="párrafos por nombre")
    ap.add_argument("--max", type=int, default=0, help="cuántos casos preguntar (0 = todos)")
    ap.add_argument("--simular", action="store_true", help="enseña las preguntas y no escribe")
    args = ap.parse_args()

    con = sqlite3.connect(args.db)
    cola = casos(args.lote, args.db)
    ya = {r[0] for r in con.execute("SELECT clave FROM resoluciones WHERE lote_id=?", (args.lote,))}
    cola = [c for c in cola if c["clave"] not in ya]

    # 1 · Lo seguro por regla: el mismo nombre en otra grafía, y el mismo cargo
    #     con o sin «ex», «alto», «encargado». Al juez le costaba lo segundo:
    #     decía «distinta» de «canciller» y «excanciller», que es la misma plaza.
    def por_regla(c):
        if c["confianza"] >= 0.99:
            return "el mismo nombre con otra grafía"
        if c["tipo"] == "cargo" and c["motivo"].startswith("el mismo cargo"):
            return "el mismo cargo con o sin «ex»"
        return None
    seguros = [c for c in cola if por_regla(c)]
    for c in seguros:
        if not args.simular:
            decidir(con, args.lote, c, "misma", 1.0 if c["confianza"] >= 0.99 else 0.85, "regla", por_regla(c))
    con.commit()
    dudosos = [c for c in cola if not por_regla(c)]
    if args.max:
        dudosos = dudosos[:args.max]
    print(f"lote {args.lote}: {len(seguros)} decididos por regla · {len(dudosos)} para el juez ({args.modelo})", flush=True)

    def preparar(c):
        a, b = c["a"]["nombre"], c["b"]["nombre"]
        corto = min((a, b), key=lambda n: len(plegar(n).split()))
        n_ctx = args.contextos + (3 if len(plegar(corto).split()) == 1 else 0)
        ca, cb = contextos(con, args.lote, a, n_ctx), contextos(con, args.lote, b, n_ctx)
        partes = [f"Tipo: {c['tipo']}", f"Nombre A: «{a}» ({c['a']['menciones']} menciones en {c['a']['articulos']} artículos)",
                  f"Nombre B: «{b}» ({c['b']['menciones']} menciones en {c['b']['articulos']} artículos)", "",
                  "Párrafos con A:"] + [f"- [art. {wp}] {t}" for wp, t in ca] + ["", "Párrafos con B:"] + [f"- [art. {wp}] {t}" for wp, t in cb]
        return "\n".join(partes)

    preguntas = [(c, preparar(c)) for c in dudosos]  # sqlite: solo el hilo principal
    if args.simular:
        for c, q in preguntas[:3]:
            print("\n" + q)
        return

    def juzgar(par):
        c, q = par
        try:
            return c, preguntar(args.url, args.modelo, q), None
        except Exception as e:  # noqa: BLE001
            return c, None, f"{type(e).__name__}: {e}"

    t0 = time.time(); hechos = 0; cuenta = {"misma": 0, "distinta": 0, "posponer": 0, "error": 0}
    fuente = f"juez:{args.modelo}"
    with ThreadPoolExecutor(max_workers=max(1, args.paralelo)) as ex:
        for c, v, err in ex.map(juzgar, preguntas):
            hechos += 1
            if err or not isinstance(v, dict):
                cuenta["error"] += 1
                print(f"  ! {c['a']['nombre']} · {c['b']['nombre']}: {err or v}", flush=True)
                continue
            ver = str(v.get("veredicto", "duda")).lower()
            conf = float(v.get("confianza") or 0)
            razon = str(v.get("razon") or "")[:300]
            if ver in ("misma", "distinta") and conf >= args.umbral:
                decision = ver
            else:
                decision = "posponer"
                razon = (("ambiguo: " if ver == "ambiguo" else "duda: ") + razon)[:300]
            decidir(con, args.lote, c, decision, conf, fuente, razon)
            cuenta[decision] += 1
            if hechos % 20 == 0 or hechos == len(preguntas):
                con.commit()
                print(f"  {hechos}/{len(preguntas)} · {(time.time() - t0) / hechos:.1f} s/caso · {cuenta}", flush=True)
    con.commit()
    print(f"fin: {cuenta} en {(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()

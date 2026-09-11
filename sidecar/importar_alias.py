"""Las identidades curadas de Quién-AI, aplicadas a un lote de Legajo.

Dos cosas del volcado (`~/lsv/datos/quien-ai/`) sirven para resolver nombres:

- `aliases.jsonl.gz`: 47 grupos «nombre principal + alias» curados a mano
  («Fico Gutiérrez» = «Federico Andrés Gutiérrez Zuluaga»). Cada par de nombres
  del grupo que aparezca en el lote se decide «misma».
- `profiles.jsonl.gz`: 21.000 perfiles de personas distintas. Si un caso dudoso
  del lote une dos nombres que son dos perfiles distintos, se decide «distinta»:
  «Carlos Fernando Galán» y «Luis Carlos Galán» son dos fichas en Quién-AI.
- `entities_*.jsonl.gz`: cada mención de persona en las noticias de Quién-AI con
  el perfil al que se resolvió. Es el diccionario grande: todas las formas con que
  se ha nombrado a cada perfil («Petro», «Gustavo Petro», «Gustavo Petro Urrego»).
  Dos nombres del lote que siempre resolvieron al mismo perfil se deciden «misma»;
  dos nombres completos que resolvieron a perfiles distintos, «distinta».

Con `--comparar` no escribe: cruza sus veredictos con lo que ya hay en `resoluciones`
(p. ej. lo del juez) y dice en cuántos coinciden. Es la forma de medir al juez con
una fuente curada independiente.

Escribe en `resoluciones` con fuente «quien-ai» y el motivo. Lo que ya decidió
una persona no se toca.

  .venv/bin/python sidecar/importar_alias.py --lote 8 [--simular]
"""
import argparse
import gzip
import json
import os
import pathlib
import sqlite3
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from anotar_llm import DB_POR_DEFECTO, sin_tildes  # noqa: E402

QUIEN_AI = pathlib.Path.home() / "lsv" / "datos" / "quien-ai"
RAIZ = pathlib.Path(__file__).resolve().parent.parent


def plegar(s):
    """Igual que `resolucion::plegar` en Rust: minúsculas, sin tildes, solo alfanumérico."""
    return " ".join("".join(c if c.isalnum() else " " for c in sin_tildes(s).lower()).split())


def subsecuencia(corto, largo):
    """Las palabras de `corto` aparecen en `largo` en el mismo orden."""
    j = 0
    for w in corto:
        while j < len(largo) and largo[j] != w:
            j += 1
        if j == len(largo):
            return False
        j += 1
    return True


def clave_par(a, b):
    x, y = plegar(a), plegar(b)
    return f"{x}|{y}" if x <= y else f"{y}|{x}"


def leer_gz(nombre):
    with gzip.open(QUIEN_AI / nombre, "rt", encoding="utf-8") as f:
        for l in f:
            if l.strip():
                yield json.loads(l)


def casos(lote, db):
    """La cola de casos dudosos, tal como la calcula la app."""
    bin_ = RAIZ / "target" / "debug" / "casos"
    if not bin_.exists():
        subprocess.run(["cargo", "build", "-q", "-p", "legajo-core", "--bin", "casos"], cwd=RAIZ, check=True)
    salida = subprocess.run([str(bin_), str(lote), str(db)], capture_output=True, text=True, cwd=RAIZ)
    if salida.returncode != 0:
        sys.exit(f"casos falló: {salida.stderr.strip()}")
    return json.loads(salida.stdout)


def nombres_del_lote(con, lote):
    """Texto → tipos con que aparece, entre lo anotado y lo extraído."""
    nombres = {}
    for texto, tipo in con.execute("SELECT DISTINCT texto, tipo FROM anotaciones WHERE lote_id=? UNION SELECT DISTINCT texto, etiqueta FROM extraidas WHERE lote_id=?", (lote, lote)):
        nombres.setdefault(texto, set()).add(tipo)
    return nombres


def decidir(con, lote, clave, a, b, tipo, decision, confianza, motivo, simular):
    if simular:
        return
    con.execute(
        """INSERT INTO resoluciones (lote_id, clave, a_nombre, b_nombre, tipo, decision, confianza, fuente, motivo)
           VALUES (?,?,?,?,?,?,?,'quien-ai',?)
           ON CONFLICT(lote_id, clave) DO UPDATE SET decision=excluded.decision, confianza=excluded.confianza,
             fuente=excluded.fuente, motivo=excluded.motivo, decidido_at=datetime('now')
           WHERE resoluciones.fuente <> 'persona'""",
        (lote, clave, a, b, tipo, decision, confianza, motivo))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lote", type=int, required=True)
    ap.add_argument("--db", default=str(DB_POR_DEFECTO))
    ap.add_argument("--simular", action="store_true")
    ap.add_argument("--comparar", action="store_true", help="no escribe: compara con las decisiones ya guardadas")
    args = ap.parse_args()
    if args.comparar:
        args.simular = True
    con = sqlite3.connect(args.db)
    nombres = nombres_del_lote(con, args.lote)
    por_plegado = {}
    for n in nombres:
        por_plegado.setdefault(plegar(n), []).append(n)

    # 1 · alias curados → «misma»
    mismas = 0
    for g in leer_gz("aliases.jsonl.gz"):
        grupo = [g["main_name"]] + list(g.get("aliases") or [])
        presentes = []
        for nombre in grupo:
            for real in por_plegado.get(plegar(nombre), []):
                if "persona" in nombres[real] and real not in presentes:
                    presentes.append(real)
        for i in range(len(presentes)):
            for j in range(i + 1, len(presentes)):
                a, b = presentes[i], presentes[j]
                decidir(con, args.lote, clave_par(a, b), a, b, "persona", "misma", 0.95,
                        f"alias curado en Quién-AI de «{g['main_name']}»", args.simular)
                mismas += 1
    con.commit()  # el binario de casos abre la misma base: nada pendiente al llamarlo
    # 2 · dos perfiles distintos → «distinta» sobre los casos dudosos
    perfiles = {}
    for p in leer_gz("profiles.jsonl.gz"):
        n = plegar(p.get("normalized_name") or p.get("name") or "")
        if n:
            perfiles.setdefault(n, str(p["_id"].get("$oid", p["_id"]) if isinstance(p["_id"], dict) else p["_id"]))
    # 3 · el diccionario de menciones: nombre → perfiles a los que resolvió
    perfil_de_mencion = {}
    for corrida in ("deep", "gemi"):
        for e in leer_gz(f"entities_{corrida}.jsonl.gz"):
            if (e.get("entity_type") or "").upper() != "PERSONA" or not e.get("profile_id"):
                continue
            pid = e["profile_id"].get("$oid") if isinstance(e["profile_id"], dict) else str(e["profile_id"])
            n = plegar(e.get("normalized_name") or e.get("name") or "")
            if n and pid:
                perfil_de_mencion.setdefault(n, {}).setdefault(pid, 0)
                perfil_de_mencion[n][pid] += 1

    def perfil_unico(nombre, minimo=2):
        """El único perfil al que resolvió el nombre, si lo hay y con al menos `minimo` menciones."""
        d = perfil_de_mencion.get(plegar(nombre)) or {}
        if len(d) != 1:
            return None
        (pid, n), = d.items()
        return pid if n >= minimo else None

    veredictos = {}  # clave → (decision, motivo)
    distintas = mismas_dic = 0
    todos = casos(args.lote, args.db)
    if args.comparar:
        # con --comparar la cola ya está decidida: se leen los pares de resoluciones
        todos = [{"clave": r[0], "tipo": r[3], "a": {"nombre": r[1]}, "b": {"nombre": r[2]}}
                 for r in con.execute("SELECT clave, a_nombre, b_nombre, tipo FROM resoluciones WHERE lote_id=?", (args.lote,))]
    for c in todos:
        if c["tipo"] != "persona":
            continue
        a, b = c["a"]["nombre"], c["b"]["nombre"]
        ua, ub = perfil_unico(a), perfil_unico(b)
        if ua and ub and ua == ub:
            veredictos[c["clave"]] = ("misma", f"las dos formas resolvieron al mismo perfil en Quién-AI ({perfil_de_mencion[plegar(a)][ua]} y {perfil_de_mencion[plegar(b)][ub]} menciones)")
            decidir(con, args.lote, c["clave"], a, b, "persona", "misma", 0.9, veredictos[c["clave"]][1], args.simular)
            mismas_dic += 1
            continue
        # Solo nombres completos: Quién-AI tiene fichas que son un apellido o
        # un nombre de pila sueltos («Acosta», «Andrés»), y esos no distinguen
        # a nadie: «Acosta» bien puede ser «Nubia Orozco Acosta».
        ta, tb = plegar(a).split(), plegar(b).split()
        if len(ta) < 2 or len(tb) < 2 or subsecuencia(ta, tb) or subsecuencia(tb, ta):
            # Quién-AI también tiene fichas repetidas con la forma corta («Vargas
            # Lleras» y «Germán Vargas Lleras»): cuando un nombre está dentro del
            # otro, dos fichas no prueban que sean dos personas.
            continue
        pa, pb = perfiles.get(plegar(a)) or ua, perfiles.get(plegar(b)) or ub
        if pa and pb and pa != pb:
            veredictos[c["clave"]] = ("distinta", "dos perfiles distintos en Quién-AI")
            decidir(con, args.lote, c["clave"], a, b, "persona", "distinta", 0.9,
                    "dos perfiles distintos en Quién-AI", args.simular)
            distintas += 1
    con.commit()
    print(f"lote {args.lote}: {mismas} pares «misma» por alias, {mismas_dic} «misma» por el diccionario de menciones, "
          f"{distintas} «distinta» por perfiles distintos" + (" (simulado)" if args.simular else ""))
    if args.comparar:
        guardadas = {r[0]: (r[1], r[2]) for r in con.execute("SELECT clave, decision, fuente FROM resoluciones WHERE lote_id=?", (args.lote,))}
        acuerdo = desacuerdo = 0
        for clave, (dec, _) in veredictos.items():
            g = guardadas.get(clave)
            if not g or g[0] == "posponer":
                continue
            if g[0] == dec:
                acuerdo += 1
            else:
                desacuerdo += 1
                fila = con.execute("SELECT a_nombre, b_nombre, motivo FROM resoluciones WHERE lote_id=? AND clave=?", (args.lote, clave)).fetchone()
                print(f"  desacuerdo: «{fila[0]}» · «{fila[1]}»: Quién-AI dice {dec}, {g[1]} dijo {g[0]} ({(fila[2] or '')[:90]})")
        print(f"comparación con lo guardado: {acuerdo} de acuerdo, {desacuerdo} en desacuerdo, sobre {len(veredictos)} veredictos del diccionario")


if __name__ == "__main__":
    main()

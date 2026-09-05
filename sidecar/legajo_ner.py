"""Extractor de entidades de Legajo.

Habla con la app por líneas JSON en stdin/stdout. No abre puertos ni escucha en
la red: la promesa de la app es que el archivo no sale del computador, y un
proceso hijo con tuberías es la forma más simple de cumplirla y de demostrarlo.

Protocolo, una petición por línea:
    {"op":"cargar","modelo":"...","dispositivo":"cpu"}
    {"op":"extraer","id":1,"parrafos":["...","..."],"etiquetas":[...],"umbral":0.5}
    {"op":"salir"}

Cada respuesta es otra línea JSON con "ok" y, si falla, "error".
El registro de diagnóstico va a stderr para no ensuciar el canal.
"""

import json
import sys
import time

MODELO_POR_DEFECTO = "urchade/gliner_multi-v2.1"

# GLiNER trabaja con una ventana corta. Se trocea por palabras con solape y se
# vuelven a mapear las posiciones al texto original: sin el solape, toda entidad
# que caiga en un borde se pierde.
VENTANA_PALABRAS = 300
SOLAPE_PALABRAS = 60


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def responder(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def trozos(texto):
    """Trozos (texto, desplazamiento) con solape, cortando por palabras."""
    palabras = []
    i = 0
    for token in texto.split(" "):
        palabras.append((i, token))
        i += len(token) + 1

    if not palabras:
        return []
    if len(palabras) <= VENTANA_PALABRAS:
        return [(texto, 0)]

    out = []
    paso = VENTANA_PALABRAS - SOLAPE_PALABRAS
    for ini in range(0, len(palabras), paso):
        grupo = palabras[ini:ini + VENTANA_PALABRAS]
        if not grupo:
            break
        desde = grupo[0][0]
        hasta = grupo[-1][0] + len(grupo[-1][1])
        out.append((texto[desde:hasta], desde))
        if ini + VENTANA_PALABRAS >= len(palabras):
            break
    return out


def deduplicar(entidades):
    """Quita las repetidas que produce el solape y los solapamientos parciales.

    Se conserva la de mayor puntuación; a igualdad, la más larga. Un mismo
    nombre marcado dos veces con límites distintos ensuciaría la evaluación
    tanto como no marcarlo.
    """
    entidades.sort(key=lambda e: (-e["score"], -(e["fin"] - e["inicio"])))
    aceptadas = []
    for e in entidades:
        if any(e["inicio"] < a["fin"] and e["fin"] > a["inicio"] for a in aceptadas):
            continue
        aceptadas.append(e)
    aceptadas.sort(key=lambda e: e["inicio"])
    return aceptadas


class Motor:
    def __init__(self):
        self.modelo = None
        self.nombre = None
        self.dispositivo = "cpu"

    def cargar(self, nombre, dispositivo):
        from gliner import GLiNER

        t0 = time.time()
        log(f"cargando {nombre} en {dispositivo}…")
        self.modelo = GLiNER.from_pretrained(nombre)
        if dispositivo != "cpu":
            self.modelo = self.modelo.to(dispositivo)
        self.modelo.eval()
        self.nombre = nombre
        self.dispositivo = dispositivo
        return round((time.time() - t0) * 1000)

    def extraer(self, texto, etiquetas, umbral):
        salida = []
        for trozo, desplazamiento in trozos(texto):
            crudas = self.modelo.predict_entities(trozo, etiquetas, threshold=umbral)
            for c in crudas:
                salida.append({
                    "texto": c["text"],
                    "inicio": c["start"] + desplazamiento,
                    "fin": c["end"] + desplazamiento,
                    "etiqueta": c["label"],
                    "score": round(float(c["score"]), 4),
                })
        return deduplicar(salida)


def main():
    motor = Motor()
    responder({"ok": True, "evento": "arrancado", "python": sys.version.split()[0]})

    for linea in sys.stdin:
        linea = linea.strip()
        if not linea:
            continue
        try:
            pet = json.loads(linea)
        except json.JSONDecodeError as e:
            responder({"ok": False, "error": f"JSON inválido: {e}"})
            continue

        op = pet.get("op")
        try:
            if op == "salir":
                responder({"ok": True, "evento": "fin"})
                return

            if op == "cargar":
                ms = motor.cargar(
                    pet.get("modelo") or MODELO_POR_DEFECTO,
                    pet.get("dispositivo") or "cpu",
                )
                responder({
                    "ok": True, "evento": "listo", "modelo": motor.nombre,
                    "dispositivo": motor.dispositivo, "ms": ms,
                })

            elif op == "extraer":
                if motor.modelo is None:
                    responder({"ok": False, "id": pet.get("id"), "error": "el modelo no está cargado"})
                    continue
                t0 = time.time()
                etiquetas = pet.get("etiquetas") or []
                umbral = float(pet.get("umbral", 0.5))
                # Se extrae párrafo a párrafo, no sobre el texto entero: la
                # anotación manual guarda las posiciones dentro del párrafo, y
                # comparar las dos cosas exige el mismo sistema de coordenadas.
                # Se pierde algo de contexto entre párrafos, y a cambio la
                # medición de precisión es exacta en vez de aproximada.
                por_parrafo = [
                    motor.extraer(par, etiquetas, umbral)
                    for par in (pet.get("parrafos") or [])
                ]
                responder({
                    "ok": True, "id": pet.get("id"), "parrafos": por_parrafo,
                    "ms": round((time.time() - t0) * 1000),
                })

            else:
                responder({"ok": False, "error": f"operación desconocida: {op!r}"})

        except Exception as e:  # noqa: BLE001 — cualquier fallo se devuelve, no tumba el proceso
            responder({"ok": False, "id": pet.get("id"), "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()

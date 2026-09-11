"""Extractor de Legajo: spaCy + GLiNER-relex en un solo proceso.

Habla con la app por líneas JSON en stdin/stdout. No abre puertos ni escucha en
la red: la promesa de la app es que el archivo no sale del computador, y un
proceso hijo con tuberías es la forma más simple de cumplirla y de demostrarlo.

El reparto de trabajo:

- **spaCy** tokeniza y segmenta oraciones. Es lo que le da al modelo trozos con
  sentido gramatical en vez de ventanas de N palabras cortadas a ciegas: una
  entidad partida por la mitad no da error, simplemente no aparece.
- **GLiNER-relex** extrae entidades y relaciones de vocabulario abierto en una
  sola pasada. Las etiquetas y los predicados son instrucciones en lenguaje
  natural, no clases aprendidas, así que cómo se redacten cambia el resultado;
  la redacción vive en `core/src/extraccion.rs`, que es quien la manda.

Antes eran tres modelos —GLiNER para entidades, GLiREL para relaciones y spaCy
de puente para alinear caracteres a tokens— y un menú con cuatro variantes del
primero. Se midió sobre artículos reales (docs/pipeline.md) y se quedó uno: el
conjunto hace las dos cosas en menos tiempo del que GLiREL tardaba solo en las
relaciones, y devuelve el vocabulario que un grafo de poder necesita —«ocupa el
cargo», «aliado de», «opositor de»—, del que GLiREL devolvía uno o ninguno por
lote. El menú se fue con él: elegir modelo era trasladar la decisión a quien
menos información tenía para tomarla, y dejaba corridas incomparables sin que
nadie supiera con qué se hizo cada una.

Protocolo, una petición por línea:
    {"op":"cargar","gliner":"...","spacy":"es_core_news_sm"}
    {"op":"procesar","id":1,"parrafos":[...],"etiquetas":[...],"claves":{...},"predicados":[...]}
    {"op":"salir"}
"""

import json
import os
import re
import sys
import time
from collections import Counter

GLINER_POR_DEFECTO = "knowledgator/gliner-relex-multi-v1.0"
SPACY_POR_DEFECTO = "es_core_news_sm"

# Techo de caracteres por trozo que se le pasa al modelo de una vez. Agrupar
# oraciones hasta este límite aprovecha el contexto sin pasarse de su ventana.
CARACTERES_POR_TROZO = 1200

# «Adriana Camacho: No necesariamente.» Una etiqueta de hablante: hasta seis
# palabras con mayúscula inicial (o artículos y «de»), dos puntos y espacio, al
# principio del párrafo.
ETIQUETA_HABLANTE = re.compile(
    r"^\s*((?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.\-]*|de|del|la|las|el|los|y)"
    r"(?:\s+(?:[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ.\-]*|de|del|la|las|el|los|y)){0,5}):\s+"
)

# Un monto tiene una cifra. «salarios», «plata» y «chequeras» hablan de dinero
# pero no son una cantidad, y el modelo los devolvía como monto con 0,8 de
# confianza: un umbral no los separa de «10 mil millones de pesos».
# Un pronombre no es una persona con nombre propio, y el modelo devolvía
# «Usted», «Yo», «tu» como persona con 0,8 de confianza —por encima de muchos
# nombres reales—, con lo que ningún umbral los separa. Es una lista cerrada,
# no un juicio: ninguna de estas palabras es jamás un nombre.
PRONOMBRES = {
    "yo", "tú", "tu", "vos", "usted", "ustedes", "él", "ella", "ellos", "ellas",
    "nosotros", "nosotras", "vosotros", "vosotras", "me", "mí", "te", "ti", "se", "sí",
    "uno", "una", "otro", "otra", "otros", "otras", "quien", "quién", "alguien", "nadie",
    "cualquiera", "todos", "todas", "ambos", "ambas",
}

CIFRA = re.compile(r"\d|%|\$|\b(mil|millón|millones|billón|billones|ciento|cientos|por ciento|centavos?)\b", re.I)


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def dispositivo():
    """Dónde corre el modelo: el GPU de la máquina si lo hay, si no la CPU.

    Medido sobre esta misma ruta de código y doce artículos reales, en un M5
    Pro: 392 s en CPU y 129 s en MPS, con las 3.124 entidades y las 1.464
    relaciones idénticas. En MPS la primera pasada con cada longitud de
    secuencia nueva paga un calentamiento —212 ms frente a 13 después—, que
    sobre doce artículos disfraza la ganancia y sobre un archivo entero se
    amortiza a nada: el extractor es un solo proceso de larga vida y las
    longitudes posibles son finitas.

    fp16 daba un 10 % más y cambiaba tres entidades de tres mil: no compensa
    perder que dos corridas sean comparables. `LEGAJO_DISPOSITIVO=cpu` fuerza
    la CPU, para medir o para descartar el GPU como causa de algo.
    """
    forzado = os.environ.get("LEGAJO_DISPOSITIVO")
    if forzado:
        return forzado
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def responder(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def trozos_por_oracion(doc, limite=CARACTERES_POR_TROZO):
    """Agrupa oraciones en trozos que quepan en la ventana del modelo.

    Cortar por oración y no por número de palabras evita partir una entidad por
    la mitad, que es de donde salían los fallos de borde del troceo anterior.
    """
    trozos, actual, ini = [], [], None
    for sent in doc.sents:
        if ini is None:
            ini = sent.start_char
        if actual and (sent.end_char - ini) > limite:
            trozos.append((doc.text[ini:actual[-1]], ini))
            actual, ini = [], sent.start_char
        actual.append(sent.end_char)
    if actual and ini is not None:
        trozos.append((doc.text[ini:actual[-1]], ini))
    return trozos or ([(doc.text, 0)] if doc.text else [])


def hablantes(parrafos):
    """Las etiquetas de hablante de una entrevista: «Nombre: » al principio de
    dos o más párrafos del mismo artículo.

    En una entrevista el nombre de quien habla encabeza cada respuesta —23 veces
    en un artículo real— y el modelo lo tomaba como una mención más, y peor:
    relacionaba a la entrevistada con todo lo que mencionaba en su respuesta,
    «Adriana Camacho trabaja en sindicato». La etiqueta no es parte del texto
    que se analiza; es quién lo dice. Se exige que se repita para no confundir
    un titular con dos puntos —«Colombia: un país…»— con un hablante.
    """
    cuenta = Counter()
    for p in parrafos:
        m = ETIQUETA_HABLANTE.match(p)
        if m:
            cuenta[m.group(1)] += 1
    return {k for k, n in cuenta.items() if n >= 2}


def sin_hablante(texto, quienes):
    """Dónde empieza lo dicho, saltando la etiqueta de hablante si la hay."""
    m = ETIQUETA_HABLANTE.match(texto)
    return m.end() if m and m.group(1) in quienes else 0


def deduplicar(entidades):
    """Quita repetidas y solapamientos parciales entre trozos.

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
        self.nlp = None
        self.modelo = None
        self.nombres = {}
        # Etiqueta del modelo → clave interna. La manda el programa, que es
        # donde vive el vocabulario. Lo que el modelo devuelva con una etiqueta
        # que no esté aquí es una señuelo y se descarta.
        self.claves = {}

    def cargar(self, cfg):
        import spacy

        t0 = time.time()
        nombre_spacy = cfg.get("spacy") or SPACY_POR_DEFECTO
        log(f"cargando spaCy {nombre_spacy}…")
        # Sin NER propio ni etiquetador: solo hace falta segmentar y tokenizar,
        # y desactivar el resto ahorra la mitad del tiempo por artículo.
        try:
            self.nlp = spacy.load(nombre_spacy, exclude=["ner", "lemmatizer", "textcat"])
        except OSError:
            # El OSError crudo de spaCy dice «no parece un paquete de Python»,
            # que no le sirve a nadie que no sepa qué es un paquete de Python.
            # El modelo se instala aparte del programa y puede no estar.
            hay = ", ".join(modelos_spacy_instalados()) or "ninguno"
            raise RuntimeError(
                f"falta el modelo de spaCy «{nombre_spacy}». Instalados: {hay}. "
                f"Se descarga con: python -m spacy download {nombre_spacy}"
            ) from None

        from gliner import GLiNER

        dev = dispositivo()
        nombre = cfg.get("gliner") or GLINER_POR_DEFECTO
        log(f"cargando {nombre} en {dev}…")
        self.modelo = GLiNER.from_pretrained(nombre).to(dev)
        self.modelo.eval()
        if not hasattr(self.modelo, "predict_relations"):
            raise RuntimeError(
                f"«{nombre}» no extrae relaciones. Legajo necesita un GLiNER de la familia "
                f"relex, que haga entidades y relaciones en la misma pasada."
            )

        self.nombres = {"spacy": nombre_spacy, "gliner": nombre, "relaciones": True, "dispositivo": dev}
        return round((time.time() - t0) * 1000)

    def clave(self, etiqueta):
        return self.claves.get(etiqueta, etiqueta)

    def procesar_articulo(self, parrafos, etiquetas, predicados, umbral, umbral_rel, umbrales_rel=None):
        """Todos los párrafos de un artículo, con lo que solo se sabe viéndolos
        juntos: quién habla, si es una entrevista."""
        quienes = hablantes(parrafos)
        ents_por_parrafo, rels_por_parrafo = [], []
        for texto in parrafos:
            base = sin_hablante(texto, quienes)
            ents, rels = self.procesar(self.nlp(texto[base:]), etiquetas, predicados, umbral, umbral_rel, umbrales_rel)
            if base:
                # Las posiciones vuelven al sistema de coordenadas del párrafo
                # entero, que es donde la revisión las busca.
                for e in ents:
                    e["inicio"] += base
                    e["fin"] += base
            ents_por_parrafo.append(ents)
            rels_por_parrafo.append(rels)
        return ents_por_parrafo, rels_por_parrafo

    def procesar(self, doc, etiquetas, predicados, umbral, umbral_rel, umbrales_rel=None):
        """Entidades y relaciones de un párrafo, en una pasada por trozo.

        Se le piden todos los predicados siempre. Antes se filtraban por los
        tipos presentes en el párrafo, pero eso exigía conocer las entidades
        antes de pedir las relaciones, y aquí salen juntas. Lo que vuelve mal
        unido —un predicado entre tipos que no admite— se descarta igual.
        """
        pedir = [p["etiqueta"] for p in predicados]
        ents, crudas = [], []
        for trozo, desplazamiento in trozos_por_oracion(doc):
            if not trozo.strip():
                continue
            if pedir:
                # Al modelo se le pide con el corte más bajo de todos y se filtra
                # después por predicado: cada uno tiene el suyo.
                piso = min([umbral_rel] + [u for u in (umbrales_rel or {}).values() if u <= 1])
                e, r = self.modelo.predict_relations(
                    trozo, etiquetas, pedir, threshold=umbral, relation_threshold=piso
                )
            else:
                e, r = self.modelo.predict_entities(trozo, etiquetas, threshold=umbral), []
            for c in e:
                # Lo que cayó en una etiqueta señuelo no es una entidad: la
                # señuelo existe para que un nombre de grupo —«indígenas»,
                # «niños»— tenga dónde caer que no sea «persona».
                if self.claves and c["label"] not in self.claves:
                    continue
                clave = self.clave(c["label"])
                if clave == "monto" and not CIFRA.search(c["text"]):
                    continue
                if clave == "persona" and c["text"].strip().lower() in PRONOMBRES:
                    continue
                # Una persona es un nombre propio: lleva mayúscula en alguna
                # parte, o es una cuenta («@petrogustavo»). «papá», «mamá»,
                # «investigador», «hijo» salían con confianza 0,6–0,7 y son
                # roles, no personas.
                if clave == "persona" and not c["text"].lstrip().startswith("@") and c["text"] == c["text"].lower():
                    continue
                ents.append({
                    "texto": c["text"],
                    "inicio": c["start"] + desplazamiento,
                    "fin": c["end"] + desplazamiento,
                    "etiqueta": c["label"],
                    "score": round(float(c["score"]), 4),
                })
            crudas.extend(r or [])
        ents = deduplicar(ents)
        return ents, self.relaciones(crudas, ents, predicados, umbral_rel, umbrales_rel)

    def relaciones(self, crudas, ents, predicados, umbral, umbrales=None):
        """Las relaciones que sobreviven al vocabulario y a su umbral.

        `umbrales` es el corte por predicado que trae el modelo afinado; el que
        no esté usa `umbral`, y uno mayor que 1 poda el predicado. Con 35
        predicados no hay corte único que valga: «ocupa el cargo» acierta a
        0,65 lo que «parte de» no acierta a ningún umbral.

        El modelo devuelve cada relación con el texto de sus dos extremos. Se
        les busca el tipo entre las entidades que quedaron —si un extremo cayó
        en una señuelo o lo quitó el deduplicado, la relación se va con él— y
        se comprueba que el predicado admita esos tipos: «Álvaro Leyva trabaja
        en Bogotá» con Bogotá como lugar es imposible por definición, y servirlo
        a revisar es gastar atención humana en descartarlo.
        """
        tipo_de = {e["texto"]: self.clave(e["etiqueta"]) for e in ents}
        umbrales = umbrales or {}
        out = []
        for r in crudas:
            score = float(r.get("score", 0))
            etiqueta = r.get("relation") or r.get("label") or ""
            if score < umbrales.get(etiqueta, umbral):
                continue
            a, b = _texto(r, "head"), _texto(r, "tail")
            # Nada se relaciona consigo mismo. Sale cuando la misma cadena
            # aparece dos veces en el párrafo y el modelo empareja las dos.
            if not a or not b or a == b:
                continue
            ta, tb = tipo_de.get(a), tipo_de.get(b)
            if ta is None or tb is None:
                continue
            if not any(p["etiqueta"] == etiqueta for p in aplicables(predicados, ta, tb)):
                continue
            out.append({"a": a, "b": b, "predicado": etiqueta, "score": round(score, 4)})
        return sin_espejos(out, predicados)


def _texto(r, lado):
    """El texto de un extremo, venga como diccionario, lista de tokens o cadena."""
    v = r.get(lado)
    if v is None:
        v = r.get(f"{lado}_text")
    if isinstance(v, dict):
        v = v.get("text")
    if isinstance(v, list):
        v = " ".join(map(str, v))
    return str(v) if v else ""


def modelos_spacy_instalados():
    """Los modelos de spaCy presentes en este entorno."""
    try:
        import spacy.util

        return sorted(spacy.util.get_installed_models())
    except Exception:
        return []


def aplicables(predicados, tipo_a, tipo_b):
    """Los predicados que pueden unir estos dos tipos.

    `desde` o `hasta` vacíos significan «cualquier tipo».
    """
    return [
        p for p in predicados
        if (not p.get("desde") or tipo_a in p["desde"])
        and (not p.get("hasta") or tipo_b in p["hasta"])
    ]


def sin_espejos(relaciones, predicados):
    """Se queda con una sola dirección de cada par.

    Los modelos de relaciones proponen casi siempre los dos sentidos con
    puntuaciones casi iguales —«Santos parte de Partido Liberal» 0,88 y su
    espejo 0,87—, porque no están determinando dirección sino midiendo
    cercanía. Servir las dos a revisar es hacer que la persona lea dos veces el
    mismo hecho.

    Se aplica a todos los predicados, no solo a los simétricos: para los
    asimétricos, la restricción de tipos ya habrá matado la dirección
    imposible, así que lo que llegue aquí en dos sentidos es genuinamente
    ambiguo y la puntuación es lo único que hay para desempatar.
    """
    mejor = {}
    for r in relaciones:
        clave = (r["predicado"], *sorted((r["a"], r["b"])))
        previa = mejor.get(clave)
        if previa is None or r["score"] > previa["score"]:
            mejor[clave] = r
    # Se devuelve en el orden en que llegaron, que es el de lectura.
    conservadas = {id(r) for r in mejor.values()}
    return [r for r in relaciones if id(r) in conservadas]


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

            if op == "disponibles":
                responder({"ok": True, "spacy": modelos_spacy_instalados()})

            elif op == "cargar":
                ms = motor.cargar(pet)
                responder({"ok": True, "evento": "listo", "ms": ms, **motor.nombres})

            elif op == "procesar":
                if motor.modelo is None:
                    responder({"ok": False, "id": pet.get("id"), "error": "el modelo no está cargado"})
                    continue
                t0 = time.time()
                etiquetas = pet.get("etiquetas") or []
                motor.claves = pet.get("claves") or {}
                predicados = pet.get("predicados") or []
                umbral = float(pet.get("umbral", 0.35))
                umbral_rel = float(pet.get("umbral_rel", 0.5))
                umbrales_rel = {k: float(v) for k, v in (pet.get("umbrales_rel") or {}).items()}

                # Párrafo a párrafo: la anotación manual guarda las posiciones
                # dentro del párrafo, y comparar las dos cosas exige el mismo
                # sistema de coordenadas.
                ents_por_parrafo, rels_por_parrafo = motor.procesar_articulo(
                    pet.get("parrafos") or [], etiquetas, predicados, umbral, umbral_rel, umbrales_rel
                )

                responder({
                    "ok": True, "id": pet.get("id"),
                    "parrafos": ents_por_parrafo,
                    "relaciones": rels_por_parrafo,
                    "ms": round((time.time() - t0) * 1000),
                })

            else:
                responder({"ok": False, "error": f"operación desconocida: {op!r}"})

        except Exception as e:  # noqa: BLE001 — cualquier fallo se devuelve, no tumba el proceso
            responder({"ok": False, "id": pet.get("id"), "error": f"{type(e).__name__}: {e}"})


if __name__ == "__main__":
    main()

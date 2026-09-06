"""Extractor de Legajo: spaCy + GLiNER + GLiREL en un solo proceso.

Habla con la app por líneas JSON en stdin/stdout. No abre puertos ni escucha en
la red: la promesa de la app es que el archivo no sale del computador, y un
proceso hijo con tuberías es la forma más simple de cumplirla y de demostrarlo.

El reparto de trabajo:

- **spaCy** tokeniza y segmenta oraciones. Es lo que le da a GLiNER trozos con
  sentido gramatical en vez de ventanas de N palabras cortadas a ciegas, y lo
  que permite alinear las entidades a límites de token antes de pasárselas a
  GLiREL.
- **GLiNER** extrae entidades de vocabulario abierto: las etiquetas son
  instrucciones en lenguaje natural, no clases aprendidas.
- **GLiREL** extrae relaciones sobre las entidades ya encontradas, también de
  vocabulario abierto.

Protocolo, una petición por línea:
    {"op":"cargar","gliner":"...","spacy":"es_core_news_sm","relaciones":true}
    {"op":"procesar","id":1,"parrafos":[...],"etiquetas":[...],"predicados":[...]}
    {"op":"salir"}
"""

import json
import sys
import time

GLINER_POR_DEFECTO = "urchade/gliner_multi-v2.1"
SPACY_POR_DEFECTO = "es_core_news_sm"
GLIREL_POR_DEFECTO = "jackboyla/glirel-large-v0"

# Techo de oraciones por lote que se le pasa a GLiNER de una vez. Su ventana es
# corta; agrupar oraciones hasta este límite aprovecha el contexto sin pasarse.
CARACTERES_POR_TROZO = 1200


def log(msg):
    print(msg, file=sys.stderr, flush=True)


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
        self.gliner = None
        self.glirel = None
        self.nombres = {}
        # Etiqueta del modelo → clave interna. La manda el programa, que es
        # donde vive el vocabulario.
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

        nombre_gliner = cfg.get("gliner") or GLINER_POR_DEFECTO
        log(f"cargando GLiNER {nombre_gliner}…")
        self.gliner = GLiNER.from_pretrained(nombre_gliner)
        self.gliner.eval()

        if cfg.get("relaciones"):
            nombre_glirel = cfg.get("glirel") or GLIREL_POR_DEFECTO
            log(f"cargando GLiREL {nombre_glirel}…")
            self.glirel = cargar_glirel(nombre_glirel)

        self.nombres = {
            "spacy": nombre_spacy,
            "gliner": nombre_gliner,
            "glirel": (cfg.get("glirel") or GLIREL_POR_DEFECTO) if self.glirel else None,
        }
        return round((time.time() - t0) * 1000)

    def entidades(self, doc, etiquetas, umbral):
        salida = []
        for trozo, desplazamiento in trozos_por_oracion(doc):
            if not trozo.strip():
                continue
            for c in self.gliner.predict_entities(trozo, etiquetas, threshold=umbral):
                salida.append({
                    "texto": c["text"],
                    "inicio": c["start"] + desplazamiento,
                    "fin": c["end"] + desplazamiento,
                    "etiqueta": c["label"],
                    "score": round(float(c["score"]), 4),
                })
        return deduplicar(salida)

    def clave(self, etiqueta):
        return self.claves.get(etiqueta, etiqueta)

    def relaciones(self, doc, ents, predicados, umbral):
        """Relaciones entre las entidades ya encontradas.

        GLiREL no trabaja sobre cadenas sino sobre **tokens**: quiere el texto
        como lista de tokens y las entidades como índices de token. Aquí es
        donde spaCy paga su sitio en el pipeline — alinear los desplazamientos
        de carácter que devuelve GLiNER a límites de token es exactamente lo
        que hace falta, y hacerlo a mano con expresiones regulares sería
        frágil en español.
        """
        if not self.glirel or len(ents) < 2 or not predicados:
            return []

        # Solo lo que puede aplicar a los tipos que hay en este párrafo.
        tipos = {self.clave(e["etiqueta"]) for e in ents}
        utiles = predicados_del_parrafo(predicados, tipos)
        if not utiles:
            return []
        etiquetas_utiles = [p["etiqueta"] for p in utiles]

        tokens = [t.text for t in doc]
        spans = []
        for e in ents:
            span = doc.char_span(e["inicio"], e["fin"], label=e["etiqueta"], alignment_mode="expand")
            if span is not None and span.end > span.start:
                spans.append(span)
        spans = spacy_sin_solapes(spans)
        if len(spans) < 2:
            return []

        # Formato de GLiREL: [inicio_token, fin_token_inclusive, etiqueta, texto]
        ner = [[s.start, s.end - 1, s.label_, s.text] for s in spans]

        try:
            crudas = self.glirel.predict_relations(
                tokens, etiquetas_utiles, threshold=umbral, ner=ner, top_k=1
            )
        except Exception as e:  # noqa: BLE001
            log(f"GLiREL falló: {type(e).__name__}: {e}")
            return []

        # El tipo de cada mención, para poder descartar lo que su propio
        # predicado no admite. Se toma del span alineado y no de la entidad
        # original porque es lo que GLiREL vio.
        tipo_de = {s.text: self.clave(s.label_) for s in spans}

        out = []
        for r in crudas or []:
            score = float(r.get("score", 0))
            if score < umbral:
                continue
            cabeza = r.get("head_text")
            cola = r.get("tail_text")
            a = " ".join(cabeza) if isinstance(cabeza, list) else str(cabeza or "")
            b = " ".join(cola) if isinstance(cola, list) else str(cola or "")
            etiqueta = r.get("label", "")

            # Nada se relaciona consigo mismo. Sale cuando la misma cadena
            # aparece dos veces en el párrafo y el modelo empareja las dos
            # apariciones: «Corte Suprema investigado por Corte Suprema».
            if a == b:
                continue

            # Lo que une tipos que el predicado no admite es imposible, y
            # servirlo a revisar es gastar atención humana en descartarlo.
            ta, tb = tipo_de.get(a), tipo_de.get(b)
            if ta is None or tb is None:
                continue
            if not any(p["etiqueta"] == etiqueta for p in aplicables(utiles, ta, tb)):
                continue

            out.append({"a": a, "b": b, "predicado": etiqueta, "score": round(score, 4)})
        return sin_espejos(out, utiles)


def modelos_spacy_instalados():
    """Los modelos de spaCy presentes en este entorno.

    Ofrecer en la interfaz tres modelos cuando solo hay uno instalado convierte
    una elección en una trampa: se elige el grande, se espera, y lo que llega es
    un error de Python en mitad de la extracción.
    """
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


def predicados_del_parrafo(predicados, tipos):
    """Lo único que tiene sentido preguntar de este párrafo.

    Pedirle a GLiREL los trece predicados cuando en el párrafo solo hay montos y
    leyes es pagar por respuestas que se van a descartar: medido sobre un lote
    real, de trece solo ocho aplicaban de media.
    """
    utiles = []
    for p in predicados:
        desde = set(p.get("desde") or tipos)
        hasta = set(p.get("hasta") or tipos)
        if tipos & desde and tipos & hasta:
            utiles.append(p)
    return utiles


def sin_espejos(relaciones, predicados):
    """Se queda con una sola dirección de cada par.

    GLiREL propone casi siempre los dos sentidos con puntuaciones casi iguales
    —«Santos parte de Partido Liberal» 0,88 y su espejo 0,87—, porque no está
    determinando dirección sino midiendo cercanía. Servir las dos a revisar es
    hacer que la persona lea dos veces el mismo hecho.

    En las simétricas —aliado, opositor, familiar— da igual cuál se conserve. En
    las demás gana la de más confianza, que es lo único que hay para elegir.
    """
    # Se aplica a todos los predicados, no solo a los simétricos: para los
    # asimétricos, la restricción de tipos ya habrá matado la dirección
    # imposible, así que lo que llegue aquí en dos sentidos es genuinamente
    # ambiguo y la puntuación es lo único que hay para desempatar.
    mejor = {}
    for r in relaciones:
        clave = (r["predicado"], *sorted((r["a"], r["b"])))
        previa = mejor.get(clave)
        if previa is None or r["score"] > previa["score"]:
            mejor[clave] = r
    # Se devuelve en el orden en que llegaron, que es el de lectura.
    conservadas = {id(r) for r in mejor.values()}
    return [r for r in relaciones if id(r) in conservadas]


def cargar_glirel(nombre):
    """Carga GLiREL sorteando el desajuste con huggingface_hub.

    Su `_from_pretrained` exige `proxies` y `resume_download`, argumentos que
    las versiones nuevas del hub ya no le pasan. Se llama directamente con los
    valores por defecto en vez de esperar a que el paquete se actualice.
    """
    try:
        from glirel import GLiREL
    except Exception as e:  # noqa: BLE001
        log(f"GLiREL no importable ({type(e).__name__}: {e}); se sigue sin relaciones")
        return None

    try:
        m = GLiREL.from_pretrained(nombre)
    except TypeError:
        try:
            m = GLiREL._from_pretrained(
                model_id=nombre, revision=None, cache_dir=None, force_download=False,
                proxies=None, resume_download=False, local_files_only=False, token=None,
                map_location="cpu", strict=False,
            )
        except Exception as e:  # noqa: BLE001
            log(f"GLiREL no disponible ({type(e).__name__}: {e}); se sigue sin relaciones")
            return None
    except Exception as e:  # noqa: BLE001
        log(f"GLiREL no disponible ({type(e).__name__}: {e}); se sigue sin relaciones")
        return None

    m.eval()
    return m


def spacy_sin_solapes(spans):
    """spaCy no admite entidades solapadas: gana la más larga."""
    spans = sorted(spans, key=lambda s: (s.start_char, -(s.end_char - s.start_char)))
    out = []
    for s in spans:
        if any(s.start_char < o.end_char and s.end_char > o.start_char for o in out):
            continue
        out.append(s)
    return out


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
                if motor.gliner is None:
                    responder({"ok": False, "id": pet.get("id"), "error": "el modelo no está cargado"})
                    continue
                t0 = time.time()
                etiquetas = pet.get("etiquetas") or []
                motor.claves = pet.get("claves") or {}
                predicados = pet.get("predicados") or []
                umbral = float(pet.get("umbral", 0.35))
                umbral_rel = float(pet.get("umbral_rel", 0.5))

                # Párrafo a párrafo: la anotación manual guarda las posiciones
                # dentro del párrafo, y comparar las dos cosas exige el mismo
                # sistema de coordenadas.
                ents_por_parrafo, rels_por_parrafo = [], []
                for texto in pet.get("parrafos") or []:
                    doc = motor.nlp(texto)
                    ents = motor.entidades(doc, etiquetas, umbral)
                    ents_por_parrafo.append(ents)
                    rels_por_parrafo.append(motor.relaciones(doc, ents, predicados, umbral_rel))

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

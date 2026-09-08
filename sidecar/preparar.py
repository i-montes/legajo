#!/usr/bin/env python3
"""Descarga los modelos que la extracción va a necesitar.

Existe porque descubrir a mitad de una extracción que falta un modelo es un
fallo de diseño y no un percance: para entonces ya se esperó la carga, ya se
eligió el lote, y lo que llega es un error de Python. Los modelos se traen
antes, con su tamaño dicho de antemano y una barra que avanza.

Habla el mismo dialecto que el extractor —una línea de JSON por mensaje, por la
salida estándar— para que el programa no tenga que aprender dos protocolos.

Esto sí sale a la red, y es lo único que lo hace: baja pesos de modelos de
repositorios públicos. Ningún texto del archivo se envía a ninguna parte, ni
aquí ni en la extracción.
"""
import json
import subprocess
import sys


def decir(**kw):
    sys.stdout.write(json.dumps(kw, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# Tamaño en disco de cada modelo de spaCy, para poder avisar antes de bajarlo.
# Son aproximados y solo sirven para que nadie empiece una descarga de medio
# giga creyendo que son diez megas.
TAMANOS = {
    "es_core_news_sm": "13 MB",
    "es_core_news_md": "42 MB",
    "es_core_news_lg": "545 MB",
}


def spacy_instalados():
    try:
        import spacy.util

        return sorted(spacy.util.get_installed_models())
    except Exception:
        return []


def instalar_spacy(nombre):
    """Baja un modelo de spaCy con el propio descargador de spaCy.

    Se lanza como proceso aparte y no con `spacy.cli.download` en este mismo
    intérprete porque ese camino instala el paquete y deja el intérprete con una
    idea vieja de lo que hay instalado: el modelo estaría en disco y `spacy.load`
    seguiría sin encontrarlo hasta reiniciar.
    """
    if nombre in spacy_instalados():
        decir(ok=True, evento="ya_estaba", modelo=nombre)
        return 0

    decir(ok=True, evento="bajando", modelo=nombre, tamano=TAMANOS.get(nombre, "?"))
    r = subprocess.run(
        [sys.executable, "-m", "spacy", "download", nombre],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    if r.returncode != 0:
        cola = "\n".join(r.stdout.strip().splitlines()[-3:])
        decir(ok=False, modelo=nombre, error=f"no se pudo bajar {nombre}: {cola}")
        return r.returncode
    decir(ok=True, evento="listo", modelo=nombre)
    return 0


def instalar_hf(nombre):
    """Trae un modelo de Hugging Face al caché local.

    GLiNER baja sus pesos la primera vez que se usa. Que eso pase durante la
    primera extracción hace que parezca colgada cuando en realidad está bajando
    un giga.
    """
    decir(ok=True, evento="bajando", modelo=nombre, tamano="~1,3 GB")
    try:
        from gliner import GLiNER

        GLiNER.from_pretrained(nombre)
    except Exception as e:
        decir(ok=False, modelo=nombre, error=f"no se pudo bajar {nombre}: {e}")
        return 1
    decir(ok=True, evento="listo", modelo=nombre)
    return 0


# Lo que hace falta para que la app funcione recién instalada, sin que la
# primera extracción se convierta en una descarga de un giga con la barra
# quieta. Tiene que coincidir con `Modelos::default()` en core/src/extraccion.rs.
PREDETERMINADOS = [
    "spacy:es_core_news_sm",
    "gliner:knowledgator/gliner-relex-multi-v1.0",
]


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--estado":
        decir(ok=True, evento="estado", spacy=spacy_instalados(), tamanos=TAMANOS)
        return 0

    args = sys.argv[1:]
    if not args or args[0] == "--predeterminados":
        args = PREDETERMINADOS

    fallos = 0
    for arg in args:
        clase, _, nombre = arg.partition(":")
        if clase == "spacy":
            fallos += instalar_spacy(nombre)
        elif clase == "gliner":
            fallos += instalar_hf(nombre)
        else:
            decir(ok=False, error=f"no sé qué es «{arg}»")
            fallos += 1
    decir(ok=(fallos == 0), evento="fin", fallos=fallos)
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())

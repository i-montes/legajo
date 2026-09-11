"""Instala en la máquina el modelo afinado de Legajo, con sus umbrales.

La app usa el afinado si lo encuentra en `<datos de la app>/modelos/legajo-relex`
(ver `modelo_afinado` en core/src/extraccion.rs); si no, el GLiNER base. Este
guion copia allí los pesos de una corrida de `entrenar.py` y deja a su lado:

- `umbrales.json`: corte por predicado y por tipo, elegidos sobre el oro con
  `umbrales.py --elegir-en apartado --medir-en prueba`, y los predicados podados.
- `modelo.json`: de qué corrida salió, cuándo, y lo que midió.

  .venv/bin/python sidecar/instalar_modelo.py \\
      --desde sidecar/entrenamiento/v5/lr2e-5-s42/final \\
      --umbrales sidecar/entrenamiento/v5/umbrales-lr2e-5-s42-apartado.json \\
      --nota "plata v5 + oro lotes 1-8; prueba: entidades 0,86, relaciones 0,47"

Con `--destino` se instala en otro sitio (p. ej. `sidecar/modelos`, que en
desarrollo también se mira). `--quitar` borra el instalado y la app vuelve al base.
"""
import argparse
import json
import pathlib
import platform
import shutil
import sys
import time

NOMBRE = "legajo-relex"
BLOQUEADAS = [
    ["organizacion", "estado"],
    ["organizacion", "el estado"],
    ["organizacion", "gobierno"],
    ["organizacion", "el gobierno"],
    ["organizacion", "gobierno nacional"],
    ["organizacion", "la nación"],
    ["organizacion", "nación"],
    ["organizacion", "las empresas"],
    ["organizacion", "la administración"],
    ["organizacion", "administración"],
    ["lugar", "país"],
    ["lugar", "el país"],
    ["lugar", "región"],
    ["lugar", "la región"],
    ["lugar", "municipio"],
    ["lugar", "ciudad"],
    ["lugar", "la ciudad"],
    ["lugar", "río"],
    ["lugar", "departamento"],
    ["lugar", "zona"],
    ["ley", "ley"],
    ["ley", "la ley"],
    ["ley", "decreto"],
    ["ley", "norma"],
    ["ley", "reforma"],
    ["ley", "la reforma"],
    ["ley", "proyecto de ley"],
    ["ley", "el proyecto"],
    ["obra", "el artículo"],
    ["obra", "informe"],
    ["obra", "el informe"],
    ["obra", "libro"],
    ["persona", "…"],
    ["persona", "el"],
    ["persona", "la"],
    ["persona", "autor"],
    ["persona", "autora"],
    ["monto", "plata"],
    ["monto", "recursos"],
    ["monto", "salarios"],
    ["persona", "dios"],
    ["persona", "papá"],
    ["persona", "mamá"],
    ["persona", "papa"],
    ["persona", "señor"],
    ["persona", "señora"],
]


def datos_de_la_app():
    """El directorio de datos de Tauri para `com.legajo.app`, por sistema."""
    casa = pathlib.Path.home()
    if sys.platform == "darwin":
        return casa / "Library" / "Application Support" / "com.legajo.app"
    if sys.platform.startswith("win"):
        import os
        return pathlib.Path(os.environ.get("APPDATA", casa / "AppData" / "Roaming")) / "com.legajo.app"
    import os
    return pathlib.Path(os.environ.get("XDG_DATA_HOME", casa / ".local" / "share")) / "com.legajo.app"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--desde", help="directorio `final/` de una corrida de entrenar.py")
    ap.add_argument("--umbrales", help="fichero de umbrales.py (relaciones, podados, entidades)")
    ap.add_argument("--umbral-rel", type=float, default=0.7, help="corte para los predicados sin umbral propio")
    ap.add_argument("--nota", default="", help="qué es este modelo, para modelo.json")
    ap.add_argument("--destino", help="directorio de modelos; por defecto el de datos de la app")
    ap.add_argument("--quitar", action="store_true", help="borra el afinado instalado")
    args = ap.parse_args()

    destino = pathlib.Path(args.destino) if args.destino else datos_de_la_app() / "modelos"
    carpeta = destino / NOMBRE
    if args.quitar:
        if carpeta.exists():
            shutil.rmtree(carpeta); print(f"quitado {carpeta}")
        else:
            print(f"no había nada en {carpeta}")
        return
    if not args.desde:
        ap.error("falta --desde (o --quitar)")
    origen = pathlib.Path(args.desde)
    if not (origen / "gliner_config.json").exists():
        sys.exit(f"{origen} no parece un GLiNER guardado (falta gliner_config.json)")

    umbrales = {"relaciones": {}, "podados": [], "entidades": {}, "umbral_rel": args.umbral_rel,
                # Lo genérico que el modelo marca con confianza alta y la convención de
                # anotación no marca (vocabulario.NO_SE_MARCA): entra en la lista de bloqueo
                # inicial de cada lote, que la persona puede vaciar desde la calibración.
                "bloqueadas": BLOQUEADAS}
    if args.umbrales:
        u = json.load(open(args.umbrales, encoding="utf-8"))
        umbrales.update({k: u[k] for k in ("relaciones", "podados", "entidades") if k in u})
        umbrales["elegidos_en"] = u.get("elegidos_en")

    if carpeta.exists():
        shutil.rmtree(carpeta)
    carpeta.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(origen, carpeta)
    (carpeta / "umbrales.json").write_text(json.dumps(umbrales, ensure_ascii=False, indent=1), encoding="utf-8")
    meta = {
        "nombre": NOMBRE, "desde": str(origen.resolve()), "instalado": time.strftime("%Y-%m-%d %H:%M"),
        "maquina": platform.node(), "nota": args.nota,
        "args_entrenamiento": json.load(open(origen.parent / "args.json")) if (origen.parent / "args.json").exists() else None,
    }
    (carpeta / "modelo.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    peso = sum(f.stat().st_size for f in carpeta.rglob("*") if f.is_file()) / 1e6
    print(f"instalado {carpeta} ({peso:.0f} MB) · {len(umbrales['relaciones'])} umbrales de relación, "
          f"{len(umbrales['podados'])} podados, {len(umbrales['entidades'])} de entidad")


if __name__ == "__main__":
    main()

#!/bin/zsh
# Primera corrida completa (plan §5.8–§7): exportar la plata, afinar con tres
# tasas de aprendizaje y medir contra el modelo base sobre la validación.
#
#   zsh sidecar/entrenamiento/primera_corrida.sh v1 sidecar/entrenamiento/seleccion-025.jsonl
set -euo pipefail
cd "$(dirname "$0")/../.."
ETIQUETA=${1:-v1}
SELECCION=${2:-sidecar/entrenamiento/seleccion.jsonl}
PY=.venv/bin/python
DATOS=sidecar/entrenamiento/$ETIQUETA
BASE=knowledgator/gliner-relex-multi-v1.0

echo "── exportar → $DATOS"
$PY sidecar/exportar_patron.py --etiqueta "$ETIQUETA" --seleccion "$SELECCION"
$PY -c "import json;i=json.load(open('$DATOS/informe.json'));print(json.dumps({k:i[k] for k in ('ejemplos','fuentes','descartes','tokens_por_ejemplo')},ensure_ascii=False));print(i['positivos_por_predicado'])"

MODELOS=(--modelo "$BASE")
for LR in 5e-6 1e-5 2e-5; do
  SALIDA=$DATOS/lr$LR
  if [ ! -d "$SALIDA/final" ]; then
    echo "── entrenar lr=$LR → $SALIDA"
    $PY sidecar/entrenar.py --datos "$DATOS" --lr "$LR" --epocas 4 --lote 8 --salida "$SALIDA" 2>&1 | grep -v -E "Warning|warn|UNEXPECTED|MISSING|^Notes|it/s\]|s/it\]" || true
  fi
  MODELOS+=(--modelo "$SALIDA/final")
done

echo "── evaluar sobre val"
$PY sidecar/banco_relaciones.py --datos "$DATOS" --conjunto val "${MODELOS[@]}" 2>&1 | grep -v -E "Warning|warn|UNEXPECTED|MISSING|^Notes|Fetching"

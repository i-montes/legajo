#!/bin/zsh
# Segunda vuelta: plata de MiniMax-M3 sobre la selección completa + oro de la app,
# 3 épocas, dos tasas; medida en val y en el apartado; umbrales por predicado.
#   zsh sidecar/entrenamiento/segunda_corrida.sh v2 ~/lsv/datos/entrenamiento/plata-mm.jsonl
set -euo pipefail
cd "$(dirname "$0")/../.."
ETIQUETA=${1:-v2}; PLATA=${2:-$HOME/lsv/datos/entrenamiento/plata-mm.jsonl}
PY=.venv/bin/python; DATOS=sidecar/entrenamiento/$ETIQUETA; BASE=knowledgator/gliner-relex-multi-v1.0
echo "── exportar → $DATOS"
$PY sidecar/exportar_patron.py --etiqueta "$ETIQUETA" --plata "$PLATA" --seleccion sidecar/entrenamiento/seleccion.jsonl
$PY -c "import json;i=json.load(open('$DATOS/informe.json'));print(json.dumps({k:i[k] for k in ('ejemplos','fuentes','descartes','tokens_por_ejemplo')},ensure_ascii=False))"
MODELOS=(--modelo "$BASE")
for LR in 1e-5 2e-5; do
  SALIDA=$DATOS/lr$LR
  if [ ! -d "$SALIDA/final" ]; then
    echo "── entrenar lr=$LR → $SALIDA"
    $PY sidecar/entrenar.py --datos "$DATOS" --lr "$LR" --epocas 3 --lote 8 --salida "$SALIDA" 2>&1 | grep -E "^\{'(eval_loss|train_runtime)|entrenado|Traceback|Error" || true
  fi
  MODELOS+=(--modelo "$SALIDA/final")
done
for C in val apartado; do
  echo "── evaluar sobre $C"
  $PY sidecar/banco_relaciones.py --datos "$DATOS" --conjunto $C "${MODELOS[@]}" 2>&1 | grep -v -E "Warning|warn|UNEXPECTED|MISSING|^Notes|Fetching" | grep -vE "^\S.*\(  0\)"
done
echo "── umbrales por predicado (lr1e-5)"
$PY sidecar/umbrales.py --datos "$DATOS" --modelo "$DATOS/lr1e-5/final" 2>&1 | grep -v -E "Warning|warn|UNEXPECTED|MISSING|^Notes|Fetching"

#!/usr/bin/env bash
# Installs (first run on a pod) and starts FlowAI Faceswap (inswapper_128 + GFPGAN 1.4, ONNX) on port 8005.
# Safe to re-run: restarts it.
#     bash setup.sh
# A venv on top of the image's PyTorch 2.8 (cu128, only for the CUDA libraries onnxruntime loads), with
# insightface and onnxruntime-gpu, and app.py served by uvicorn. This folder is on the network volume
# (/workspace/flowai/faceswap); the venv and models go on the container disk ($APP), so a new pod installs
# them again on its first run (a minute or two, plus about 1.2 GB of models).
# Settings: ../env: FACESWAP_API_KEY=... (the assistant's FACESWAP_API_KEY).
set -e
KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname "$KIT")
APP=${APP:-/opt/faceswap}
PORT=${PORT:-8005}
VENV=$APP/venv
mkdir -p "$APP/models"
RUNPOD_POD_ID=${RUNPOD_POD_ID:-$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^RUNPOD_POD_ID=//p')}
if [ -f "$ROOT/env" ]; then set -a; . <(tr -d '\r' < "$ROOT/env"); set +a; fi
if [ -z "$FACESWAP_API_KEY" ]; then
  echo "FACESWAP_API_KEY is not set in $ROOT/env: the API would be open to anyone with the pod's URL" >&2
  exit 1
fi

# Package caches on the container disk: the image puts them on the network volume, which is slow and costly
export UV_CACHE_DIR=/opt/flowai/cache/uv PIP_CACHE_DIR=/opt/flowai/cache/pip

pkill -f "[u]vicorn app:app.*--port $PORT" || true

command -v ffmpeg > /dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg > /dev/null)

# A venv that reuses the image's torch, held there, and numpy below 2 (insightface)
if [ ! -f "$VENV/.installed" ]; then
  python3 -m venv --system-site-packages "$VENV"
  { cat "$KIT/constraints.txt"
    python3 -c "import torch; print(f'torch=={torch.__version__}')"
  } > "$APP/constraints.txt"
  export PIP_CONSTRAINT=$APP/constraints.txt
  "$VENV/bin/pip" install -q -r "$KIT/requirements.txt"
  "$VENV/bin/pip" install -q cython==3.0.11
  "$VENV/bin/pip" install -q --no-build-isolation insightface==0.7.3
  "$VENV/bin/python" -c "import numpy, insightface.app, onnxruntime; assert numpy.__version__ == '1.26.4', numpy.__version__"
  touch "$VENV/.installed"
fi

export PYTHONUNBUFFERED=1 MODELS=$APP/models WORK_DIR=$APP/work
setsid nohup "$VENV/bin/python" -m uvicorn app:app --app-dir "$KIT" --host 0.0.0.0 --port "$PORT" --workers 1 \
  > "$APP/server.log" 2>&1 < /dev/null &
echo "Faceswap starting: https://${RUNPOD_POD_ID}-${PORT}.proxy.runpod.net  (log: $APP/server.log, key: FACESWAP_API_KEY in $ROOT/env)"
echo "The first start downloads inswapper_128, GFPGAN and buffalo_l (about 1.2 GB): GET /health says \"ok\" when it's ready"

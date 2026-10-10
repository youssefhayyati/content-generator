#!/usr/bin/env bash
# Installs (first run on a pod) and starts FlowAI Lipsync (LatentSync) on port 8004. Safe to re-run: restarts it.
#     bash setup.sh
# Mirrors ../Dockerfile (Docker can't run inside a RunPod pod): LatentSync's code at the same commit, its
# inference packages in a venv on top of the image's PyTorch 2.8 (cu128), and app.py served by uvicorn.
# The kit is this folder on the pod (/workspace/lipsync-kit): setup.sh, app.py, requirements.txt,
# constraints.txt and env. Code, venv and models go on the container disk ($APP); a new pod installs
# them again on its first run (a few minutes, plus about 5 GB of model on the first dub's start).
# Settings: env next to this script: LIPSYNC_API_KEY=... (the assistant's LIPSYNC_API_KEY), and
# optionally LATENTSYNC_VERSION (1.6 here, the sharper model, for a GPU with 18 GB or more; 1.5 needs 8).
set -e
KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
APP=${APP:-/opt/lipsync}
PORT=${PORT:-8004}
REF=a229c3948406bc2cf6eaf4873e662e70c6a04746  # github.com/bytedance/LatentSync, as in ../Dockerfile
SRC=$APP/LatentSync
VENV=$APP/venv
mkdir -p "$APP/models/checkpoints" "$APP/models/hf"
RUNPOD_POD_ID=${RUNPOD_POD_ID:-$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^RUNPOD_POD_ID=//p')}
if [ -f "$KIT/env" ]; then set -a; . <(tr -d '\r' < "$KIT/env"); set +a; fi
if [ -z "$LIPSYNC_API_KEY" ]; then
  echo "LIPSYNC_API_KEY is not set in $KIT/env: the API would be open to anyone with the pod's URL" >&2
  exit 1
fi

pkill -f "[u]vicorn app:app.*--port $PORT" || true

if [ ! -f "$SRC/configs/scheduler_config.json" ]; then
  rm -rf "$SRC" && mkdir -p "$SRC" && cd "$SRC"
  git init -q . && git remote add origin https://github.com/bytedance/LatentSync
  git fetch -q --depth 1 origin "$REF" && git checkout -q FETCH_HEAD && rm -rf .git
fi
# LatentSync reads its checkpoints relative to its folder
rm -rf "$SRC/checkpoints" && ln -s "$APP/models/checkpoints" "$SRC/checkpoints"

command -v ffmpeg > /dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg > /dev/null)

# (The image turns on hf_transfer for every download, which this venv doesn't have: off below.)
# A venv that reuses the image's torch and torchvision, held there, and numpy below 2 (decord, insightface)
if [ ! -f "$VENV/.installed" ]; then
  python3 -m venv --system-site-packages "$VENV"
  { cat "$KIT/constraints.txt"
    python3 -c "import torch, torchvision; print(f'torch=={torch.__version__}'); print(f'torchvision=={torchvision.__version__}')"
  } > "$APP/constraints.txt"
  export PIP_CONSTRAINT=$APP/constraints.txt
  "$VENV/bin/pip" install -q -r "$KIT/requirements.txt"
  "$VENV/bin/pip" install -q cython==3.0.11
  "$VENV/bin/pip" install -q --no-build-isolation insightface==0.7.3
  "$VENV/bin/python" -c "import numpy, insightface.app, decord; assert numpy.__version__ == '1.26.4', numpy.__version__"
  touch "$VENV/.installed"
fi

export PYTHONUNBUFFERED=1 PYTHONPATH=$SRC LATENTSYNC_DIR=$SRC MODELS=$APP/models HF_HOME=$APP/models/hf \
  HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_ENABLE_HF_TRANSFER=0 WORK_DIR=$APP/work \
  PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  LATENTSYNC_VERSION=${LATENTSYNC_VERSION:-1.6}
setsid nohup "$VENV/bin/python" -m uvicorn app:app --app-dir "$KIT" --host 0.0.0.0 --port "$PORT" --workers 1 \
  > "$APP/server.log" 2>&1 < /dev/null &
echo "Lipsync starting: https://${RUNPOD_POD_ID}-${PORT}.proxy.runpod.net  (log: $APP/server.log, key: LIPSYNC_API_KEY in $KIT/env)"
echo "The first start downloads LatentSync $LATENTSYNC_VERSION (about 5 GB): GET /health says \"ok\" when it's ready"

#!/usr/bin/env bash
# Installs (first run on a pod) and starts FlowAI Music (ACE-Step 1.5, MIT) on port 8003. Safe to re-run: restarts it.
#     bash setup.sh
# Mirrors Dockerfile (Docker can't run inside a RunPod pod): ACE-Step at the same commit, installed with uv from
# its lockfile (its own PyTorch, so its own venv), and its REST API: POST /release_task, POST /query_result,
# GET /v1/audio, GET /health. This folder is on the network volume (/workspace/flowai/music); the code, venv
# and models go on the container disk ($APP), so a new pod installs them again on its first run (a few
# minutes, plus a few GB of models on the first start). Settings: ../env: ACESTEP_API_KEY=... (the assistant's
# MUSIC_API_KEY).
set -e
KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname "$KIT")
APP=${APP:-/opt/music}
PORT=${PORT:-8003}
REF=ca1e85fe9430179831e6bc6be790c332190a3866  # github.com/ace-step/ACE-Step-1.5, as in Dockerfile
SRC=$APP/ACE-Step
mkdir -p "$APP"
RUNPOD_POD_ID=${RUNPOD_POD_ID:-$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^RUNPOD_POD_ID=//p')}
if [ -f "$ROOT/env" ]; then set -a; . <(tr -d '\r' < "$ROOT/env"); set +a; fi
if [ -z "$ACESTEP_API_KEY" ]; then
  echo "ACESTEP_API_KEY is not set in $ROOT/env: the API would be open to anyone with the pod's URL" >&2
  exit 1
fi

# Package caches on the container disk: the image puts them on the network volume, which is slow and costly
export UV_CACHE_DIR=/opt/flowai/cache/uv PIP_CACHE_DIR=/opt/flowai/cache/pip

pkill -f "[a]cestep.api_server.*--port $PORT" || true

if [ ! -f "$SRC/pyproject.toml" ]; then
  rm -rf "$SRC" && mkdir -p "$SRC" && cd "$SRC"
  git init -q . && git remote add origin https://github.com/ace-step/ACE-Step-1.5
  git fetch -q --depth 1 origin "$REF" && git checkout -q FETCH_HEAD && rm -rf .git
fi
cd "$SRC"
command -v uv > /dev/null || pip install -q uv
command -v ffmpeg > /dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg libsndfile1 > /dev/null)

# Exact versions from its lockfile, in .venv next to it
if [ ! -f "$SRC/.venv/.installed" ]; then
  UV_LINK_MODE=copy uv sync --frozen --no-dev --python python3.11
  touch "$SRC/.venv/.installed"
fi
mkdir -p checkpoints .cache output

# As the Dockerfile: the music model alone (the assistant writes the description), moved to the CPU between
# songs so the GPU stays free for the others. The image turns on hf_transfer, which this venv doesn't have.
export PYTHONUNBUFFERED=1 TOKENIZERS_PARALLELISM=false HF_HOME=$APP/hf HF_HUB_DISABLE_TELEMETRY=1 HF_HUB_ENABLE_HF_TRANSFER=0 \
  ACESTEP_API_HOST=0.0.0.0 ACESTEP_API_PORT=$PORT ACESTEP_CONFIG_PATH=acestep-v15-turbo ACESTEP_INIT_LLM=false \
  ACESTEP_LM_BACKEND=pt ACESTEP_OFFLOAD_TO_CPU=true ACESTEP_OFFLOAD_DIT_TO_CPU=true
setsid nohup uv run --no-sync python -m acestep.api_server --host 0.0.0.0 --port "$PORT" \
  > "$APP/server.log" 2>&1 < /dev/null &
echo "Music starting: https://${RUNPOD_POD_ID}-${PORT}.proxy.runpod.net  (log: $APP/server.log, key: ACESTEP_API_KEY in $ROOT/env)"
echo "The first start downloads ACE-Step's models (a few GB): GET /health answers when it's ready"

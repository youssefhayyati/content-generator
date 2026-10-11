#!/usr/bin/env bash
# Installs (first run on a pod) and starts VoiceStudio on port 8002. Safe to re-run: restarts it.
#     bash setup.sh
# Mirrors deploy/Dockerfile of the repo (Docker can't run inside a RunPod pod): the web UI is built
# with bun, the backend is installed on top of the image's PyTorch 2.8 (cu128) and served by uvicorn.
# Secrets: ../env (OMNIVOICE_API_KEY=..., optional HF_TOKEN=...).
set -e
KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(dirname "$KIT")
APP=${APP:-/opt/voicestudio}
PORT=${PORT:-8002}
REF=06c6e077f0fc35149efefc3561e9be5ae835d916  # github.com/debpalash/VoiceStudio, the one tested here (2026-10-07)
SRC=$APP/VoiceStudio
VENV=$APP/venv
mkdir -p "$APP"
RUNPOD_POD_ID=${RUNPOD_POD_ID:-$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^RUNPOD_POD_ID=//p')}
if [ -f "$ROOT/env" ]; then set -a; . <(tr -d '\r' < "$ROOT/env"); set +a; fi

# Package caches on the container disk: the image puts them on the network volume, which is slow and costly
export UV_CACHE_DIR=/opt/flowai/cache/uv PIP_CACHE_DIR=/opt/flowai/cache/pip

pkill -f "[u]vicorn backend.main:app.*--port $PORT" || true

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC" && git -C "$SRC" remote add origin https://github.com/debpalash/VoiceStudio
  git -C "$SRC" fetch -q --depth 1 origin "$REF" && git -C "$SRC" checkout -q FETCH_HEAD
fi
cd "$SRC"

apt-get update -qq && apt-get install -y -qq --no-install-recommends ffmpeg libsndfile1 build-essential unzip > /dev/null

# Web UI -> frontend/dist
if [ ! -f frontend/dist/index.html ]; then
  export BUN_INSTALL=$APP/bun PATH=$APP/bun/bin:$PATH
  command -v bun > /dev/null || curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"
  bun install --frozen-lockfile
  bun run --cwd electron build:web
fi

# Backend: venv that reuses the image's torch/torchaudio/torchvision (the constraints file pins them)
if [ ! -f "$VENV/.installed" ]; then
  python3 -m venv --system-site-packages "$VENV"
  uv pip install --python "$VENV/bin/python" --constraint deploy/torch-constraints.txt .
  target=$("$VENV/bin/python" -c "import os, sys; print(os.path.join(sys.prefix, 'lib', 'python%d.%d' % sys.version_info[:2], 'site-packages', 'cudnn8_compat'))")
  uv pip install --python "$VENV/bin/python" --no-deps --target "$target" nvidia-cudnn-cu12==8.9.7.29
  touch "$VENV/.installed"
fi

export PYTHONUNBUFFERED=1 PYTHONPATH=$SRC/backend OMNIVOICE_SERVER_MODE=1 \
  OMNIVOICE_DATA_DIR=$APP/data HF_HOME=$APP/data/huggingface \
  OMNIVOICE_ALLOWED_HOSTS="*" \
  OMNIVOICE_ALLOWED_ORIGINS="https://${RUNPOD_POD_ID}-${PORT}.proxy.runpod.net,http://localhost:${PORT},http://127.0.0.1:${PORT}"
mkdir -p "$OMNIVOICE_DATA_DIR"
setsid nohup "$VENV/bin/python" -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT" \
  > "$APP/server.log" 2>&1 < /dev/null &
# Speech recognition: Whisper large-v3 (faster-whisper, 2.9 GB, once). FlowAI hears with it since FlowAI Sound
# stopped running locally: Creative Lab's transcripts, captions and found moments, and the assistant's dubs. Asked
# for in the background once the server answers; already installed, it's a no-op.
(
  for _ in $(seq 1 120); do
    curl -sf "http://127.0.0.1:${PORT}/health" > /dev/null && break
    sleep 5
  done
  curl -s -X POST "http://127.0.0.1:${PORT}/models/install" -H "Authorization: Bearer ${OMNIVOICE_API_KEY:-}" \
    -H 'Content-Type: application/json' -d '{"repo_id":"Systran/faster-whisper-large-v3"}' >> "$APP/server.log" 2>&1
) > /dev/null 2>&1 &
echo "VoiceStudio starting: https://${RUNPOD_POD_ID}-${PORT}.proxy.runpod.net  (log: $APP/server.log, key: OMNIVOICE_API_KEY in $ROOT/env)"

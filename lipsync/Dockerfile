# FlowAI Lipsync: LatentSync (ByteDance, Apache-2.0) behind a small job API, for the assistant's dubs
# (assistant/backend/lipsync.py). Its own container because it pins its own transformers, diffusers
# and numpy. The same image runs on a bigger GPU (RunPod) by pointing the assistant's LIPSYNC_URL
# there; set LATENTSYNC_VERSION=1.6 for the sharper model on a GPU with 18 GB or more.
#   API: POST /v1/lipsync, GET /v1/lipsync/{id}, GET /v1/lipsync/{id}/video, GET /health (port 8000)
# Models are not baked in: the first start downloads them (about 5.5 GB) into /models (a volume).
FROM python:3.11-slim-bookworm

# The upstream commit this is built from (github.com/bytedance/LatentSync)
ARG LATENTSYNC_REF=a229c3948406bc2cf6eaf4873e662e70c6a04746
# PyTorch for CUDA 12.8: GTX 16xx up to RTX 50xx, like the assistant's
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu128

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HOME=/models/hf \
    MODELS=/models \
    LATENTSYNC_DIR=/opt/LatentSync \
    PYTHONPATH=/opt/LatentSync

RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg build-essential libglib2.0-0 curl \
 && rm -rf /var/lib/apt/lists/*

RUN pip install torch==2.8.0 torchvision==0.23.0 --index-url "$TORCH_INDEX"
COPY requirements.txt constraints.txt /tmp/
ENV PIP_CONSTRAINT=/tmp/constraints.txt
RUN pip install -r /tmp/requirements.txt
# insightface (LatentSync's face detector) builds a Cython part against the numpy above
RUN pip install cython==3.0.11 && pip install --no-build-isolation insightface==0.7.3 \
 && python -c "import numpy, insightface.app, decord; assert numpy.__version__ == '1.26.4', numpy.__version__"

# Its own user; the model folders are its, so the volume mounted there is too
RUN useradd --create-home --uid 1000 lipsync \
 && mkdir -p /opt/LatentSync /models/checkpoints /models/hf && chown -R lipsync /opt/LatentSync /models
USER lipsync
WORKDIR /opt/LatentSync
RUN git init -q . && git remote add origin https://github.com/bytedance/LatentSync \
 && git fetch -q --depth 1 origin "$LATENTSYNC_REF" && git checkout -q FETCH_HEAD && rm -rf .git \
 && rm -rf checkpoints && ln -s /models/checkpoints checkpoints

# Less memory lost to fragments on a small GPU
ENV PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
COPY --chown=lipsync app.py /app/app.py
EXPOSE 8000
# The first start downloads the models (about 5.5 GB), so give it time
HEALTHCHECK --interval=30s --timeout=5s --start-period=30m \
  CMD curl -sf http://localhost:8000/health | grep -q '"status":"ok"' || exit 1
CMD ["uvicorn", "app:app", "--app-dir", "/app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]

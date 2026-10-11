# FlowAI Music: ACE-Step 1.5 (MIT, trained on licensed music) behind its own REST API, for the
# assistant's videos (assistant/backend/music.py). Its own container because it pins its own torch
# and transformers, which the assistant's can't share. The same API runs on a bigger GPU (RunPod)
# by pointing the assistant's MUSIC_URL there.
#   API: POST /release_task, POST /query_result, GET /v1/audio, GET /health (port 8000 here)
# Models are not baked in: the first start downloads them into /app/checkpoints (a volume).
FROM python:3.11-slim-bookworm

# The upstream commit this is built from (github.com/ace-step/ACE-Step-1.5)
ARG ACESTEP_REF=ca1e85fe9430179831e6bc6be790c332190a3866

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_NO_CACHE=1 \
    UV_LINK_MODE=copy \
    TOKENIZERS_PARALLELISM=false \
    HF_HUB_DISABLE_TELEMETRY=1

RUN apt-get update && apt-get install -y --no-install-recommends git build-essential libsndfile1 ffmpeg curl \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8.13 /uv /usr/local/bin/uv

# Installed as its user, so nothing needs a chown (that would copy the whole environment again)
RUN useradd --create-home --uid 1000 music && mkdir /app && chown music /app
USER music
WORKDIR /app
RUN git init -q . && git remote add origin https://github.com/ace-step/ACE-Step-1.5 \
 && git fetch -q --depth 1 origin "$ACESTEP_REF" && git checkout -q FETCH_HEAD && rm -rf .git
# Exact versions from its lockfile
RUN uv sync --frozen --no-dev --python /usr/local/bin/python3.11 \
 && mkdir -p checkpoints .cache output

# Videos are instrumental and short: the music model alone (no 5 Hz LM; the assistant writes the
# description), moved to the CPU between songs so the GPU stays free for speech recognition
ENV ACESTEP_API_HOST=0.0.0.0 \
    ACESTEP_API_PORT=8000 \
    ACESTEP_CONFIG_PATH=acestep-v15-turbo \
    ACESTEP_INIT_LLM=false \
    ACESTEP_LM_BACKEND=pt \
    ACESTEP_OFFLOAD_TO_CPU=true \
    ACESTEP_OFFLOAD_DIT_TO_CPU=true

EXPOSE 8000
# The first start downloads the models (a few GB), so give it time
HEALTHCHECK --interval=30s --timeout=5s --start-period=20m \
  CMD curl -sf http://localhost:8000/health > /dev/null || exit 1
CMD ["uv", "run", "--no-sync", "python", "-m", "acestep.api_server", "--host", "0.0.0.0", "--port", "8000"]

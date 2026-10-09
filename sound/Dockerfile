# FlowAI Sound: voices (Kokoro), listening (Whisper) and the composer, on CPU.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MODELS=/models HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --only-binary=:all: -r requirements.txt

# The models are baked in, so a deploy never waits on a download: Kokoro v1.0 (Apache-2.0)
# and Whisper base, int8.
RUN mkdir -p /models/whisper \
 && python -c "import urllib.request as u; base='https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'; [u.urlretrieve(base + f, '/models/' + f) for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin')]" \
 && python -c "from faster_whisper import WhisperModel; WhisperModel('base', device='cpu', compute_type='int8', download_root='/models/whisper')" \
 && useradd --system --uid 10001 sound && chown -R sound /models

COPY *.py ./
USER sound
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--timeout-keep-alive", "30"]

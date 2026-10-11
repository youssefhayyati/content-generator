# VoiceStudio on the pod

Speech and voices for FlowAI (port 8002): the assistant's voice, the voices that read videos, cloned voices, and
**speech recognition**. `setup.sh` installs and starts it; `../deploy.sh` runs that on a new pod.

## Whisper large-v3 is required

Since FlowAI Sound (the local `sound` service) no longer runs, FlowAI hears speech here, through VoiceStudio's
OpenAI-style `POST /v1/audio/transcriptions` (`response_format=verbose_json`, word timestamps):

- Creative Lab: the **Transcript** node, **Captions** (burned word by word), **Find moments** (YouTube clipping)
  and the **Reel look** captions of uploaded sound.
- The assistant: the words of a dub's speaker, cloned voices' reference text.

VoiceStudio ships without a speech-to-text model. `setup.sh` asks for **Whisper large-v3**
(`Systran/faster-whisper-large-v3`, faster-whisper, 2.9 GB, 99 languages) once the server answers; the download
then takes a few minutes. To do it by hand, or to check:

```bash
curl -X POST https://<pod-id>-8002.proxy.runpod.net/models/install \
  -H "Authorization: Bearer $OMNIVOICE_API_KEY" -H 'Content-Type: application/json' \
  -d '{"repo_id":"Systran/faster-whisper-large-v3"}'
curl https://<pod-id>-8002.proxy.runpod.net/models/install/status -H "Authorization: Bearer $OMNIVOICE_API_KEY"
```

Until it's installed, transcriptions answer `asr_model_missing`, and FlowAI's Transcript nodes say so.

## Who uses it

| Setting | Where | Value |
|---|---|---|
| `VOICESTUDIO_URL`, `VOICESTUDIO_KEY` | FlowAI's `.env` (the repo root) | `https://<pod-id>-8002.proxy.runpod.net`, `OMNIVOICE_API_KEY`: FlowAI's voices (`vs:` ids) and Whisper, and the assistant's voice |

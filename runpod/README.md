# The RunPod pod

Everything FlowAI runs on a GPU lives here, so the rest (the dashboard, the API, the assistant, FlowAI Sound)
can run on a plain CPU server. One folder, one key file, one command to put it on a pod:

| Service | Port | What | Folder | The assistant's settings (`assistant/.env`) |
|---|---|---|---|---|
| ComfyUI | 8001 | pictures and videos: its manager API in front of ComfyUI (8000; 8001 through the image's nginx) | `comfyui/` | `COMFYUI_URL`, `COMFYUI_API_KEY` = `MANAGER_API_KEY` |
| VoiceStudio | 8002 | speech and voices (OmniVoice): the assistant's voice, videos' voices, cloned voices; speech recognition (Whisper large-v3, installed by `setup.sh`: see `voicestudio/README.md`) | `voicestudio/` | `TTS_URL`, `TTS_API_KEY` = `OMNIVOICE_API_KEY`; FlowAI's API: `VOICESTUDIO_URL`, `VOICESTUDIO_KEY` |
| Music | 8003 | instrumental songs under videos (ACE-Step 1.5, MIT) | `music/` | `MUSIC_URL`, `MUSIC_API_KEY` = `ACESTEP_API_KEY` |
| Lipsync | 8004 | a video's mouth redrawn to say new words (LatentSync 1.6, Apache-2.0) | `lipsync/` | `LIPSYNC_URL`, `LIPSYNC_API_KEY` |
| Faceswap | 8005 | a face from one picture put on someone in a picture or video (inswapper_128 and GFPGAN 1.4, ONNX) | `faceswap/` | `FACESWAP_URL`, `FACESWAP_API_KEY` |

URLs are `https://<pod-id>-<port>.proxy.runpod.net`. Every API but `/health` needs its key.

```
runpod/
  deploy.sh        from this PC: puts the folder on a pod and starts everything (or pulls workflows back)
  setup.sh         on the pod: installs (first run) and starts all the services, or the ones named
  env.example      every key, one file: on the pod it's env next to setup.sh
  comfyui/         manager.py (the API), start.sh, restore.sh, setup.sh, workflows/*.json, API.md
  voicestudio/     setup.sh, README.md (Whisper large-v3 for speech recognition)
  music/           setup.sh, Dockerfile (the same service in docker compose: --profile music)
  lipsync/         setup.sh, app.py, requirements.txt, constraints.txt, Dockerfile (--profile lipsync)
  faceswap/        setup.sh, app.py, requirements.txt, constraints.txt
```

## Deploying

```bash
runpod/deploy.sh <pod-id>-<n>@ssh.runpod.io
```

The target is the user@host of the pod's **SSH** line (pod page → Connect). The script packs this folder, sends
it through RunPod's SSH gateway (which only takes a terminal, so it goes over as base64 lines), unpacks it into
`/workspace/flowai`, runs `setup.sh --background`, and follows the five URLs until each answers. On a new pod
that's 10 to 30 minutes: each service installs into `/opt/<service>` and downloads its models (ComfyUI's
workflows about 40 GB, LatentSync about 5 GB, ACE-Step a few GB, the face swap's 1.2 GB, VoiceStudio its voice
model).

Deploying again replaces the scripts and restarts the services; nothing is installed twice. The pod's keys
(`env`) and its workflow bundles (`comfyui/workflows/`, which the manager writes) are kept: only bundles it
lacks are added. `runpod/deploy.sh <target> pull` copies the pod's bundles back here, e.g. after adding a
workflow through the API.

**Keys.** The first deploy to a pod (a new network volume) needs `runpod/env` here: copy `env.example` and fill it
in (git ignores it). Each key also goes into `assistant/.env` under the name in the table above. After that the
pod's `env` is the one used; change a key there (`nano /workspace/flowai/env`) and re-run `setup.sh`.

### By hand on the pod

```bash
bash /workspace/flowai/setup.sh                 # install and start all, then check each one
bash /workspace/flowai/setup.sh lipsync music   # only these
bash /workspace/flowai/setup.sh --background    # start all and return (log: /opt/flowai/setup.log)
bash /workspace/flowai/comfyui/setup.sh         # ComfyUI alone, following its model downloads
```

The services don't start by themselves after the pod restarts unless you set the pod's **Container Start
Command** (Edit Pod) to:
```
bash -c "bash /workspace/flowai/setup.sh --background; /start.sh"
```
Keep `; /start.sh`: it's RunPod's own startup (SSH, Jupyter).

## How it's split

| Where | What | Survives a new pod |
|---|---|---|
| Network volume, `/workspace/flowai/` | this folder: the scripts, `app.py`, `manager.py`, `env` (keys), ComfyUI's workflow bundles | yes |
| Container disk, `/opt/<service>/` | the code, the Python venvs, the **models**, generated files, logs | no: `setup.sh` installs it again |

The kit is kilobytes. Models are deliberately not on the volume: it's S3-backed and slow with large files, so
they're downloaded again on each new pod (about 50 MB/s).

**New ComfyUI workflows follow automatically.** When a workflow added through the API (template install, POST,
editor save) is ready, or its mapping changes, the manager saves its bundle into `comfyui/workflows/` on the
volume, and a new pod registers it. `DELETE /workflows/{name}` removes it there too. See `comfyui/API.md`.

## A new pod

Console → **Pods → Deploy**:

1. **Network volume**: yours first. It lives in one datacenter (EU-SE-1), so only GPUs there are listed.
2. **GPU**: 48 GB or more (an A40 runs all five; LatentSync 1.6 alone needs 18 GB). Under *Additional Filters*,
   **CUDA 12.8 or newer**.
3. **Template**: **Runpod PyTorch 2.8** (PyTorch 2.8, CUDA 12.8, Ubuntu 24.04, Python 3.12). VoiceStudio,
   Lipsync and Faceswap reuse its PyTorch; ComfyUI installs on top of it; Music brings its own.
4. **Edit Template**:
   - **Container Disk**: **300 GB** (models and venvs live here: about 40 GB for ComfyUI's workflows, 25 GB for the rest).
   - **Expose HTTP Ports**: `8001,8002,8003,8004,8005` (plus `8888` for Jupyter, optional). Not `8188`, the ComfyUI
     editor: it has no password.
   - **Container Start Command**: the line above, to start everything with the pod.
5. **SSH key**: your `~/.ssh/id_ed25519.pub` in RunPod → *Settings → SSH Public Keys*.
6. Deploy (tip: **Save as template** after step 4), then run `runpod/deploy.sh` with the new pod's SSH target.

**The URLs change with every new pod; the keys don't.** Put the new pod id in `assistant/.env` (`COMFYUI_URL`,
`TTS_URL`, `MUSIC_URL`, `LIPSYNC_URL`, `FACESWAP_URL`) and restart the assistant.

## Day to day

- **Logs**: `/opt/flowai/setup.log` (the background start), `/opt/comfy/manager.log` and `restore.log`,
  `/opt/voicestudio/server.log`, `/opt/music/server.log`, `/opt/lipsync/server.log`, `/opt/faceswap/server.log`.
- **Health**: `curl https://<pod-id>-<port>.proxy.runpod.net/health` for each port. The assistant's own
  `/health` says what it sees of ComfyUI, Lipsync and Faceswap.
- **Memory**: Music and Lipsync move their models to the CPU between jobs, Faceswap lets its own go after 10 idle
  minutes, and ComfyUI unloads its own, so the GPU is shared; heavy jobs at the same moment can still run out (Wan
  video and a dub together need about 40 GB).
- **Face swap licence**: InsightFace's models (inswapper_128, buffalo_l) are for non-commercial research use.
- **Voices**: VoiceStudio's voices (picked catalog voices, cloned ones) live on the container disk and go with
  the pod. Catalog voices come back by themselves when picked again; cloned ones have to be cloned again.
- **Stop vs terminate**: either way the container disk starts empty next time, so `setup.sh` reinstalls.
  Terminating doesn't touch the volume.
- **Disk**: `df -h /`. Generated files pile up in `/opt/comfy/ComfyUI/output`; the assistant downloads what it needs.

## Bigger GPU, better video models

| VRAM | GPUs on RunPod | Good for |
|---|---|---|
| 48 GB | A40 (current), RTX A6000, L40S | everything installed today; Wan 2.2 14B fits, but it's slow |
| 80 GB | A100 80GB, **H100** | Wan 2.2 14B, LTX-2.5 and HunyuanVideo 1.5 at 720p, several times faster than an A40 |
| 96–141 GB | **RTX PRO 6000** (96 GB), H200 (141 GB) | the same with room for longer clips and several models loaded at once |

Check the pod's **system RAM (64 GB or more)** too: big video models move between RAM and VRAM. Bigger ComfyUI
models are built-in templates, installed with one API call (`POST /templates/<template>/install {"as": "<name>"}`,
`comfyui/API.md` Recipe A), and are saved to the volume like any other workflow:

| Model | Templates | Download | Notes |
|---|---|---|---|
| **Wan 2.2 14B** | `video_wan2_2_14B_t2v`, `video_wan2_2_14B_i2v` (also `_flf2v`, `_s2v`) | ~38 GB each, sharing a 7 GB text encoder | clearly better motion and detail than Wan 5B; ships with 4-step LoRAs |
| **LTX-2.5** (22B) | `video_ltx2_5_t2v`, `video_ltx2_5_i2v`, `video_ltx2_5_flf2v` | ~40 GB | video with synchronized audio. Gated: accept the license on huggingface.co/Lightricks/LTX-2.5 with the HF token's account first |
| **HunyuanVideo 1.5** | `video_hunyuan_video_1.5_720p_t2v`, `..._i2v` | ~46 GB each | 720p with a 1080p upscaler stage |

Every workflow on the volume is downloaded on each new pod, so `DELETE` the ones you no longer use.

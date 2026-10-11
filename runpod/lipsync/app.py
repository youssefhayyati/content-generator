"""FlowAI Lipsync: a video's mouth redrawn to say new speech (LatentSync by ByteDance, Apache-2.0).

  GET    /health                 the model, whether it's loaded and ready, the jobs waiting
  POST   /v1/lipsync             multipart: video (MP4), audio (WAV) [, steps, guidance, seed]
                                 -> {"id", "status": "queued"}
  GET    /v1/lipsync/{id}        {"status": queued | running | done | failed | cancelled,
                                  "stage", "progress" (0..1), "error"}
  GET    /v1/lipsync/{id}/video  the made video (MP4: H.264 and AAC), once done
  DELETE /v1/lipsync/{id}        cancel it (a running one stops at its next step) and forget it

Jobs run one at a time in the background, so no request waits on the model: behind RunPod's proxy,
which cuts a request at about 100 seconds, the same API works by polling. The result lasts as long as
the audio: a video shorter than it plays back and forth under it, a longer one is cut (pad the audio
with silence to keep all of the video). Every frame needs a visible face.

LATENTSYNC_VERSION picks the model: 1.5 (faces at 256 px, 8 GB of GPU memory) or 1.6 (512 px, sharper
teeth and lips, 18 GB: a RunPod GPU). The checkpoints download on the first start into MODELS (a
volume). The model loads on the first job and waits on the CPU between jobs (OFFLOAD), so the GPU
it shares with the assistant's speech recognition and the music model is free meanwhile. With
LIPSYNC_API_KEY set, every call but /health needs it as a bearer token.
"""

from __future__ import annotations

import gc
import math
import os
import shutil
import threading
import time
import uuid
import wave
from pathlib import Path
from queue import Queue

import torch  # before onnxruntime, so its CUDA libraries are the ones loaded
from diffusers.utils import logging as diffusers_logging
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

diffusers_logging.set_verbosity_error()  # it warns on every move to the CPU, where the model only waits

REPO = Path(os.environ.get("LATENTSYNC_DIR", "/opt/LatentSync"))
MODELS = Path(os.environ.get("MODELS", "/models"))
VERSION = os.environ.get("LATENTSYNC_VERSION", "1.5")
API_KEY = os.environ.get("LIPSYNC_API_KEY", "")
OFFLOAD = os.environ.get("OFFLOAD", "true").lower() != "false"
DEEPCACHE = os.environ.get("DEEPCACHE", "true").lower() != "false"  # about twice as fast, as upstream runs it
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "120"))  # of audio
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "200")) * 2**20
KEEP_SECONDS = 3600  # finished jobs and their files

CONFIGS = {"1.5": "configs/unet/stage2.yaml", "1.6": "configs/unet/stage2_512.yaml"}
VRAM_GB = {"1.5": 8, "1.6": 18}
if VERSION not in CONFIGS:
    raise SystemExit(f"LATENTSYNC_VERSION must be one of {', '.join(CONFIGS)}, not {VERSION}")

CHECKPOINTS = REPO / "checkpoints"  # -> MODELS/checkpoints: LatentSync reads it relative to its folder
UNET = CHECKPOINTS / f"v{VERSION}" / "latentsync_unet.pt"
UNET_HALF = UNET.with_name("latentsync_unet.fp16.pt")  # half the memory to load, made on the first load
WORK = Path(os.environ.get("WORK_DIR", "/tmp/lipsync"))

app = FastAPI(title="FlowAI Lipsync")
jobs: dict[str, dict] = {}
waiting: Queue[str] = Queue()
state = {"ready": False, "error": None, "loaded": False}


class Cancelled(Exception):
    pass


def auth(authorization: str = Header(default="")):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(401, "a bearer token (LIPSYNC_API_KEY) is needed")


# --- the model ------------------------------------------------------------------------------

def download():
    """The checkpoints this version needs, once: the U-Net, Whisper tiny for the audio, and the
    VAE. insightface fetches its face detector (buffalo_l) by itself on the first job."""
    from huggingface_hub import hf_hub_download, snapshot_download

    repo = f"ByteDance/LatentSync-{VERSION}"
    if not UNET.exists() and not UNET_HALF.exists():
        print(f"Downloading {repo} (about 5 GB)...", flush=True)
        hf_hub_download(repo, "latentsync_unet.pt", local_dir=UNET.parent)
    if not (CHECKPOINTS / "whisper" / "tiny.pt").exists():
        hf_hub_download(repo, "whisper/tiny.pt", local_dir=CHECKPOINTS)
    snapshot_download("stabilityai/sd-vae-ft-mse", allow_patterns=["config.json", "*.safetensors"])


class Model:
    """The pipeline, loaded on first use and moved to the CPU between jobs (OFFLOAD)."""

    def __init__(self):
        self.pipe = None
        self.config = None
        self.dtype = torch.float16

    def load(self):
        from diffusers import AutoencoderKL, DDIMScheduler
        from omegaconf import OmegaConf

        from latentsync.models.unet import UNet3DConditionModel
        from latentsync.pipelines.lipsync_pipeline import LipsyncPipeline
        from latentsync.whisper.audio2feature import Audio2Feature

        if torch.cuda.get_device_capability()[0] <= 7:  # no fast float16 (as upstream decides)
            self.dtype = torch.float32
        self.config = config = OmegaConf.load(REPO / CONFIGS[VERSION])
        audio_encoder = Audio2Feature(model_path=str(CHECKPOINTS / "whisper" / "tiny.pt"), device="cuda",
                                      num_frames=config.data.num_frames,
                                      audio_feat_length=config.data.audio_feat_length)
        vae = AutoencoderKL.from_pretrained("stabilityai/sd-vae-ft-mse", torch_dtype=self.dtype)
        vae.config.scaling_factor = 0.18215
        vae.config.shift_factor = 0
        unet = UNet3DConditionModel.from_config(OmegaConf.to_container(config.model)).to(self.dtype)
        unet.load_state_dict(self.weights(), strict=False)
        pipe = LipsyncPipeline(vae=vae, audio_encoder=audio_encoder, unet=unet,
                               scheduler=DDIMScheduler.from_pretrained(str(REPO / "configs")))
        if DEEPCACHE:
            from DeepCache import DeepCacheSDHelper

            helper = DeepCacheSDHelper(pipe=pipe)
            helper.set_params(cache_interval=3, cache_branch_id=0)
            helper.enable()
        # A small GPU (8 GB, shared) runs out where the VAE takes 16 frames at once, between chunks: one at a
        # time costs little. And the face detector's memory goes back once every frame's face is found.
        pipe.enable_vae_slicing()
        find_faces = pipe.affine_transform_video

        def find_faces_then_free(frames):
            found = find_faces(frames)
            pipe.image_processor.face_detector = None
            gc.collect()
            torch.cuda.empty_cache()
            return found

        pipe.affine_transform_video = find_faces_then_free
        self.pipe = pipe
        state["loaded"] = True
        print(f"LatentSync {VERSION} loaded ({self.dtype})", flush=True)

    def weights(self) -> dict:
        """The U-Net's weights in half precision. The download is in full precision: loading it next
        to the model needs about 10 GB of memory, so the first load keeps a half copy (2.5 GB)."""
        if not UNET_HALF.exists():
            full = torch.load(UNET, map_location="cpu", weights_only=True, mmap=True)["state_dict"]
            part = UNET_HALF.with_suffix(".part")
            torch.save({"state_dict": {k: v.to(torch.float16) for k, v in full.items()}}, part)
            del full
            part.rename(UNET_HALF)
            UNET.unlink()  # 5 GB nobody reads again
        return torch.load(UNET_HALF, map_location="cpu", weights_only=True, mmap=True)["state_dict"]

    def to(self, device: str):
        self.pipe.to(device)
        self.pipe.audio_encoder.model.to(device)
        if device == "cpu":
            self.pipe.image_processor = None  # its face detector holds GPU memory too
            gc.collect()
            torch.cuda.empty_cache()

    def run(self, job: dict, video: Path, audio: Path, out: Path):
        if self.pipe is None:
            job["stage"] = "loading the model"
            self.load()
        self.to("cuda")
        cfg = self.config
        steps = job["steps"]
        chunks = math.ceil(job["seconds"] * cfg.data.video_fps / cfg.data.num_frames)
        done = [0]

        def step(i, t, latents):  # after every denoising step
            if job["cancel"]:
                raise Cancelled()
            done[0] += 1
            job["stage"] = "syncing the lips"
            job["progress"] = round(min(done[0] / (chunks * steps), 1) * 0.9 + 0.05, 3)

        job["stage"] = "finding the face in every frame"
        torch.manual_seed(job["seed"])
        try:
            self.pipe(video_path=str(video), audio_path=str(audio), video_out_path=str(out),
                      num_frames=cfg.data.num_frames, num_inference_steps=steps,
                      guidance_scale=job["guidance"], weight_dtype=self.dtype,
                      width=cfg.data.resolution, height=cfg.data.resolution,
                      mask_image_path=str(REPO / cfg.data.mask_image_path), temp_dir=str(out.parent / "work"),
                      callback=step, callback_steps=1)
        finally:
            if OFFLOAD:
                self.to("cpu")


model = Model()


def worker():
    try:
        download()
        state["ready"] = True
    except Exception as exc:  # noqa: BLE001 - shown on /health
        state["error"] = f"the checkpoints couldn't be downloaded: {exc}"
        print(state["error"], flush=True)
        return
    while True:
        jid = waiting.get()
        job = jobs.get(jid)
        if not job or job["cancel"]:
            continue
        job.update(status="running", started=time.time())
        folder = WORK / jid
        try:
            os.chdir(REPO)  # LatentSync reads its configs and writes temp/ relative to its folder
            model.run(job, folder / "in.mp4", folder / "in.wav", folder / "out.mp4")
            if not (folder / "out.mp4").exists():
                raise RuntimeError("no video came out (is ffmpeg there?)")
            job.update(status="done", progress=1.0, stage="done")
        except Cancelled:
            job.update(status="cancelled", stage="cancelled")
        except torch.cuda.OutOfMemoryError:
            job.update(status="failed", error=f"the GPU ran out of memory: LatentSync {VERSION} needs about "
                                              f"{VRAM_GB[VERSION]} GB free")
        except RuntimeError as exc:
            text = str(exc)
            if "Face not detected" in text:
                text = "a frame has no face that can be found: every frame needs one, clearly visible"
            job.update(status="failed", error=text)
        except Exception as exc:  # noqa: BLE001 - reported to the caller
            job.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            job["finished"] = time.time()
            if job["status"] != "done":
                print(f"lipsync {jid} {job['status']}: {job.get('error', '')}", flush=True)
            gc.collect()
            torch.cuda.empty_cache()
        forget_old()


def forget_old():
    for jid, job in list(jobs.items()):
        if job.get("finished") and time.time() - job["finished"] > KEEP_SECONDS:
            jobs.pop(jid, None)
            shutil.rmtree(WORK / jid, ignore_errors=True)


@app.on_event("startup")
def start():
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True, exist_ok=True)
    threading.Thread(target=worker, daemon=True).start()


# --- the API --------------------------------------------------------------------------------

def _seconds(path: Path) -> float:
    try:
        with wave.open(str(path)) as w:
            return w.getnframes() / w.getframerate()
    except (wave.Error, EOFError):
        raise HTTPException(422, "the audio must be a WAV file") from None


async def _save(upload: UploadFile, path: Path):
    size = 0
    with path.open("wb") as f:
        while chunk := await upload.read(1 << 20):
            size += len(chunk)
            if size > MAX_UPLOAD:
                raise HTTPException(413, f"{upload.filename} is over {MAX_UPLOAD >> 20} MB")
            f.write(chunk)
    if not size:
        raise HTTPException(422, f"{upload.filename or 'a file'} is empty")


@app.get("/health")
def health():
    gpu = {}
    if state["loaded"]:  # asking any sooner would take GPU memory just to answer
        gpu = {"gpu": torch.cuda.get_device_name(0), "gpu_free_gb": round(torch.cuda.mem_get_info()[0] / 2**30, 1)}
    running = next((j["id"] for j in jobs.values() if j["status"] == "running"), None)
    return {"status": "ok" if state["ready"] else "error" if state["error"] else "downloading",
            "error": state["error"], "model": f"LatentSync {VERSION}", "loaded": state["loaded"],
            "needs_gb": VRAM_GB[VERSION], **gpu, "running": running,
            "queued": sum(j["status"] == "queued" for j in jobs.values())}


@app.post("/v1/lipsync", dependencies=[Depends(auth)])
async def start_job(video: UploadFile = File(...), audio: UploadFile = File(...), steps: int = Form(20),
                    guidance: float = Form(1.5), seed: int = Form(1247)):
    if state["error"]:
        raise HTTPException(503, state["error"])
    if not torch.cuda.is_available():
        raise HTTPException(503, "there is no GPU: LatentSync needs one")
    jid = uuid.uuid4().hex[:12]
    folder = WORK / jid
    folder.mkdir(parents=True)
    try:
        await _save(video, folder / "in.mp4")
        await _save(audio, folder / "in.wav")
        seconds = _seconds(folder / "in.wav")
        if not 0.5 <= seconds <= MAX_SECONDS:
            raise HTTPException(422, f"the audio is {seconds:.1f} seconds long; 0.5 to {MAX_SECONDS:.0f} it can be")
    except HTTPException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    jobs[jid] = {"id": jid, "status": "queued", "stage": "waiting its turn", "progress": 0.0, "seconds": seconds,
                 "steps": max(1, min(int(steps), 50)), "guidance": max(1.0, min(float(guidance), 3.0)),
                 "seed": int(seed), "cancel": False, "created": time.time()}
    waiting.put(jid)
    return {"id": jid, "status": "queued", "position": sum(j["status"] == "queued" for j in jobs.values())}


def _job(jid: str) -> dict:
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "no such job (finished ones are kept for an hour)")
    return job


@app.get("/v1/lipsync/{jid}", dependencies=[Depends(auth)])
def job_status(jid: str):
    job = _job(jid)
    return {k: job.get(k) for k in ("id", "status", "stage", "progress", "error", "seconds")}


@app.get("/v1/lipsync/{jid}/video", dependencies=[Depends(auth)])
def job_video(jid: str):
    job = _job(jid)
    if job["status"] != "done":
        raise HTTPException(409, f"the job is {job['status']}")
    return FileResponse(WORK / jid / "out.mp4", media_type="video/mp4", filename=f"lipsync-{jid}.mp4")


@app.delete("/v1/lipsync/{jid}", dependencies=[Depends(auth)])
def cancel(jid: str):
    job = _job(jid)
    job["cancel"] = True
    if job["status"] == "queued":
        job.update(status="cancelled", stage="cancelled", finished=time.time())
    elif job["status"] != "running":
        jobs.pop(jid, None)
        shutil.rmtree(WORK / jid, ignore_errors=True)
    return {"id": jid, "status": job["status"]}

"""FlowAI Faceswap: the face from one picture put on the person in another picture or in a video, with
InsightFace's inswapper_128 (ONNX) and GFPGAN 1.4 (ONNX) to restore the swapped face.

  GET    /health                   the models, whether they're loaded, the jobs waiting
  POST   /v1/faceswap              multipart: face (a picture with the face to use), target (a picture or a video)
                                   [, faces: largest | all, enhance: true | false] -> {"id", "status": "queued"}
  GET    /v1/faceswap/{id}         {"status": queued | running | done | failed | cancelled, "stage",
                                    "progress" (0..1), "error", "kind": image | video}
  GET    /v1/faceswap/{id}/result  the made picture (PNG) or video (MP4: H.264, the target's sound kept)
  DELETE /v1/faceswap/{id}         cancel it (a running video stops at its next frame) and forget it

Jobs run one at a time in the background, like the lip sync service's, so no request waits on them behind
RunPod's proxy (which cuts a request at about 100 seconds). A picture takes about a second; a video goes
frame by frame, decoded and encoded by ffmpeg as it goes, so a long one never sits in memory whole.

How: buffalo_l finds the faces (RetinaFace) and describes the source face (ArcFace); inswapper_128 redraws
each target face as the source's at 128 px and pastes it back, which looks soft on a big picture, so
GFPGAN 1.4 then restores it at 512 px and is blended over it (ENHANCE_BLEND). By default only the largest
face in each picture or frame is changed (the person the post is about); faces=all changes every face.
InsightFace's models (inswapper, buffalo_l) are licensed for non-commercial research only.

The models download on the first start into MODELS (about 1.2 GB), load on the first job and are let go
after IDLE_UNLOAD_SECONDS without one, so the GPU they share is free. With FACESWAP_API_KEY set, every call
but /health needs it as a bearer token.
"""

from __future__ import annotations

import gc
import json
import os
import shutil
import subprocess
import threading
import time
import urllib.request
import uuid
from pathlib import Path
from queue import Queue

try:
    import torch  # noqa: F401  the image's: it loads the CUDA libraries onnxruntime's CUDA provider needs
except ImportError:
    pass
import cv2
import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse

MODELS = Path(os.environ.get("MODELS", "/models"))
API_KEY = os.environ.get("FACESWAP_API_KEY", "")
WORK = Path(os.environ.get("WORK_DIR", "/tmp/faceswap"))
MAX_SECONDS = float(os.environ.get("MAX_SECONDS", "120"))  # of video
MAX_UPLOAD = int(os.environ.get("MAX_UPLOAD_MB", "200")) * 2**20
IDLE = int(os.environ.get("IDLE_UNLOAD_SECONDS", "600"))
BLEND = float(os.environ.get("ENHANCE_BLEND", "0.8"))  # how much of GFPGAN's face shows over inswapper's
KEEP_SECONDS = 3600  # finished jobs and their files

FILES = {  # downloaded once into MODELS
    "inswapper_128.onnx": "https://huggingface.co/datasets/Gourieff/ReActor/resolve/main/models/inswapper_128.onnx",
    "gfpgan_1.4.onnx": "https://huggingface.co/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx",
}
PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
# Where the eyes, nose and mouth corners go in the 512 px face GFPGAN was trained on (FFHQ, as facexlib)
FFHQ_512 = np.array([[192.98138, 239.94708], [318.90277, 240.1936], [256.63416, 314.01935],
                     [201.26117, 371.41043], [313.08905, 371.15118]], dtype=np.float32)

app = FastAPI(title="FlowAI Faceswap")
jobs: dict[str, dict] = {}
waiting: Queue[str] = Queue()
state = {"ready": False, "error": None, "loaded": False}


class Cancelled(Exception):
    pass


class Unusable(Exception):
    """The inputs can't make a face swap (no face found...): said to the caller as it is."""


def auth(authorization: str = Header(default="")):
    if API_KEY and authorization != f"Bearer {API_KEY}":
        raise HTTPException(401, "a bearer token (FACESWAP_API_KEY) is needed")


# --- the models -----------------------------------------------------------------------------

def download():
    """inswapper and GFPGAN, and buffalo_l (insightface fetches and unpacks that one itself)."""
    from insightface.utils.storage import ensure_available

    MODELS.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        dest = MODELS / name
        if not dest.exists():
            print(f"Downloading {name}...", flush=True)
            part = dest.with_suffix(".part")
            urllib.request.urlretrieve(url, part)
            part.rename(dest)
    ensure_available("models", "buffalo_l", root=str(MODELS))


class Models:
    def __init__(self):
        self.analyser = self.swapper = self.enhancer = None
        self.used = 0.0
        self.lock = threading.Lock()
        mask = np.zeros((512, 512), np.float32)
        mask[24:488, 24:488] = 1
        self.mask = cv2.GaussianBlur(mask, (0, 0), 14)  # GFPGAN's face fades into the frame at its edges

    def load(self):
        import onnxruntime as ort
        from insightface.app import FaceAnalysis
        from insightface.model_zoo import get_model

        # Detection finds the faces and their five points; recognition describes the source face
        self.analyser = FaceAnalysis(name="buffalo_l", root=str(MODELS), allowed_modules=["detection", "recognition"],
                                     providers=PROVIDERS)
        self.analyser.prepare(ctx_id=0, det_size=(640, 640))
        self.swapper = get_model(str(MODELS / "inswapper_128.onnx"), providers=PROVIDERS)
        self.enhancer = ort.InferenceSession(str(MODELS / "gfpgan_1.4.onnx"), providers=PROVIDERS)
        state["loaded"] = True
        print(f"models loaded on {self.enhancer.get_providers()[0]}", flush=True)

    def unload(self):
        self.analyser = self.swapper = self.enhancer = None
        state["loaded"] = False
        gc.collect()

    def faces(self, img: np.ndarray) -> list:
        """The faces in a picture, the largest first."""
        found = self.analyser.get(img)
        return sorted(found, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]), reverse=True)

    def source(self, img: np.ndarray):
        found = self.faces(img)
        if not found:
            raise Unusable("no face was found in the face picture: use one where the face is clear and facing the camera")
        return found[0]

    def swap(self, frame: np.ndarray, source, every: bool, enhance: bool) -> tuple[np.ndarray, int]:
        """The frame with its largest face (or all of them) swapped; and how many were. Each face is swapped
        and restored in a crop around it (twice its size: room for GFPGAN's 512 px face and its soft edge),
        not in the whole frame, which made a 1080 x 1920 video several times slower."""
        from insightface.app.common import Face

        targets = self.faces(frame)
        targets = targets if every else targets[:1]
        h, w = frame.shape[:2]
        for face in targets:
            x1, y1, x2, y2 = face.bbox
            cx, cy, half = (x1 + x2) / 2, (y1 + y2) / 2, max(x2 - x1, y2 - y1)
            left, top = max(int(cx - half), 0), max(int(cy - half), 0)
            right, bottom = min(int(cx + half), w), min(int(cy + half), h)
            local = Face(kps=face.kps - np.array([left, top], np.float32))
            crop = self.swapper.get(frame[top:bottom, left:right].copy(), local, source, paste_back=True)
            if enhance:
                crop = self.restore(crop, local.kps)
            frame[top:bottom, left:right] = crop
        return frame, len(targets)

    def restore(self, frame: np.ndarray, kps: np.ndarray) -> np.ndarray:
        """GFPGAN over the swapped face: aligned to its 512 px face, restored, and blended back."""
        m, _ = cv2.estimateAffinePartial2D(kps.astype(np.float32), FFHQ_512, method=cv2.LMEDS)
        if m is None:
            return frame
        crop = cv2.warpAffine(frame, m, (512, 512), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        x = (crop[:, :, ::-1].astype(np.float32) / 255.0 - 0.5) / 0.5
        y = self.enhancer.run(None, {self.enhancer.get_inputs()[0].name: np.ascontiguousarray(x.transpose(2, 0, 1)[None])})[0][0]
        face = (np.clip((y.transpose(1, 2, 0) + 1) / 2, 0, 1)[:, :, ::-1] * 255).astype(np.float32)
        h, w = frame.shape[:2]
        inv = cv2.invertAffineTransform(m)
        back = cv2.warpAffine(face, inv, (w, h), flags=cv2.INTER_LINEAR)
        weight = cv2.warpAffine(self.mask, inv, (w, h), flags=cv2.INTER_LINEAR)[:, :, None] * BLEND
        return (back * weight + frame.astype(np.float32) * (1 - weight)).clip(0, 255).astype(np.uint8)


models = Models()


# --- pictures and videos ------------------------------------------------------------------------

def probe(path: Path) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
                         capture_output=True, text=True, timeout=60)
    try:
        return json.loads(out.stdout or "{}")
    except ValueError:
        return {}


def seconds_of(info: dict) -> float:
    try:
        return float(info.get("format", {}).get("duration") or 0)
    except ValueError:  # "N/A"
        return 0.0


def kind_of(path: Path) -> str:
    """image or video, from what ffprobe makes of the file (a picture is one video frame without duration)."""
    info = probe(path)
    video = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if not video:
        raise Unusable("the target is neither a picture nor a video")
    seconds = seconds_of(info)
    still = video.get("codec_name") in ("png", "mjpeg", "webp", "bmp", "tiff", "gif") and seconds < 0.5
    return "image" if still or not seconds else "video"


def swap_image(job: dict, folder: Path):
    face, target = cv2.imread(str(folder / "face")), cv2.imread(str(folder / "target"))
    if face is None or target is None:
        raise Unusable("a picture couldn't be read")
    job["stage"] = "swapping the face"
    made, count = models.swap(target, models.source(face), job["every"], job["enhance"])
    if not count:
        raise Unusable("no face was found in the picture to change")
    cv2.imwrite(str(folder / "result.png"), made)
    job["faces"] = count


def swap_video(job: dict, folder: Path):
    face = cv2.imread(str(folder / "face"))
    if face is None:
        raise Unusable("the face picture couldn't be read")
    source = models.source(face)
    src = folder / "target"
    info = probe(src)
    video = next(s for s in info["streams"] if s.get("codec_type") == "video")
    w, h = int(video["width"]), int(video["height"])
    rotation = int((video.get("side_data_list") or [{}])[0].get("rotation", video.get("tags", {}).get("rotate", 0)) or 0)
    if abs(rotation) in (90, 270):  # ffmpeg turns the frames upright as it decodes them
        w, h = h, w
    fps = video.get("avg_frame_rate") or video.get("r_frame_rate") or "25/1"
    if fps.startswith("0"):
        fps = video.get("r_frame_rate") or "25/1"
    seconds = seconds_of(info)
    if seconds > MAX_SECONDS:
        raise Unusable(f"the video is {seconds:.0f} seconds long; {MAX_SECONDS:.0f} at most")
    num, _, den = fps.partition("/")
    total = max(1, round(seconds * float(num) / float(den or 1)))

    reader = subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                              stdout=subprocess.PIPE)
    writer = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
                               "-r", fps, "-i", "-", "-i", str(src), "-map", "0:v", "-map", "1:a?", "-c:v", "libx264",
                               "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
                               "-shortest", "-movflags", "+faststart", str(folder / "result.mp4")],
                              stdin=subprocess.PIPE)
    size, done, with_face = w * h * 3, 0, 0
    try:
        while True:
            raw = reader.stdout.read(size)
            if len(raw) < size:
                break
            if job["cancel"]:
                raise Cancelled()
            frame = np.frombuffer(raw, np.uint8).reshape(h, w, 3).copy()
            frame, count = models.swap(frame, source, job["every"], job["enhance"])
            with_face += bool(count)
            writer.stdin.write(frame.tobytes())
            done += 1
            job["stage"], job["progress"] = "swapping the face, frame by frame", round(min(done / total, 0.99), 3)
    finally:
        reader.kill()
        writer.stdin.close()
        writer.wait(timeout=300)
    if not done or writer.returncode != 0:
        raise RuntimeError("the video couldn't be read or written")
    if not with_face:
        raise Unusable("no face was found in the video")
    job["faces"] = f"{with_face} of {done} frames"


def worker():
    try:
        download()
        state["ready"] = True
    except Exception as exc:  # noqa: BLE001 - shown on /health
        state["error"] = f"the models couldn't be downloaded: {exc}"
        print(state["error"], flush=True)
        return
    while True:
        jid = waiting.get()
        job = jobs.get(jid)
        if not job or job["cancel"]:
            continue
        job.update(status="running", started=time.time(), stage="loading the models" if not state["loaded"] else "starting")
        try:
            with models.lock:
                models.used = time.time()
                if not state["loaded"]:
                    models.load()
                (swap_image if job["kind"] == "image" else swap_video)(job, WORK / jid)
                models.used = time.time()
            job.update(status="done", progress=1.0, stage="done")
        except Cancelled:
            job.update(status="cancelled", stage="cancelled")
        except Unusable as exc:
            job.update(status="failed", error=str(exc))
        except Exception as exc:  # noqa: BLE001 - reported to the caller
            job.update(status="failed", error=f"{type(exc).__name__}: {exc}")
        finally:
            job["finished"] = time.time()
            if job["status"] != "done":
                print(f"faceswap {jid} {job['status']}: {job.get('error', '')}", flush=True)
        forget_old()


def unloader():
    """Lets go of the models (and the GPU memory they hold) when no job has come for a while."""
    while True:
        time.sleep(30)
        with models.lock:
            if state["loaded"] and waiting.empty() and time.time() - models.used > IDLE:
                models.unload()
                print("models let go after being idle", flush=True)


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
    threading.Thread(target=unloader, daemon=True).start()


# --- the API --------------------------------------------------------------------------------

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
    running = next((j["id"] for j in jobs.values() if j["status"] == "running"), None)
    return {"status": "ok" if state["ready"] else "error" if state["error"] else "downloading",
            "error": state["error"], "model": "inswapper_128 + GFPGAN 1.4 (ONNX)", "loaded": state["loaded"],
            "running": running, "queued": sum(j["status"] == "queued" for j in jobs.values())}


@app.post("/v1/faces", dependencies=[Depends(auth)])
def find_faces(frames: list[UploadFile] = File(...)):
    """Where the faces are in a few frames (Creative Lab reframes a clip on its speaker): per frame, the faces
    as fractions of its size (x, y, w, h), the largest first. Waits up to 30 s if a swap is running."""
    if state["error"]:
        raise HTTPException(503, state["error"])
    if not models.lock.acquire(timeout=30):
        raise HTTPException(503, "busy with a face swap; try again in a moment")
    try:
        models.used = time.time()
        if not state["loaded"]:
            models.load()
        out = []
        for f in frames[:16]:
            img = cv2.imdecode(np.frombuffer(f.file.read(), np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                out.append([])
                continue
            h, w = img.shape[:2]
            out.append([{"x": round(float(b.bbox[0]) / w, 4), "y": round(float(b.bbox[1]) / h, 4),
                         "w": round(float(b.bbox[2] - b.bbox[0]) / w, 4), "h": round(float(b.bbox[3] - b.bbox[1]) / h, 4),
                         "score": round(float(b.det_score), 3)} for b in models.faces(img)])
        models.used = time.time()
        return {"frames": out}
    finally:
        models.lock.release()


@app.post("/v1/faceswap", dependencies=[Depends(auth)])
async def start_job(face: UploadFile = File(...), target: UploadFile = File(...), faces: str = Form("largest"),
                    enhance: bool = Form(True)):
    if state["error"]:
        raise HTTPException(503, state["error"])
    if faces not in ("largest", "all"):
        raise HTTPException(422, "faces is largest or all")
    jid = uuid.uuid4().hex[:12]
    folder = WORK / jid
    folder.mkdir(parents=True)
    try:
        await _save(face, folder / "face")
        await _save(target, folder / "target")
        kind = kind_of(folder / "target")
    except Unusable as exc:
        shutil.rmtree(folder, ignore_errors=True)
        raise HTTPException(422, str(exc)) from None
    except HTTPException:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    jobs[jid] = {"id": jid, "status": "queued", "stage": "waiting its turn", "progress": 0.0, "kind": kind,
                 "every": faces == "all", "enhance": bool(enhance), "cancel": False, "created": time.time()}
    waiting.put(jid)
    return {"id": jid, "status": "queued", "kind": kind}


def _job(jid: str) -> dict:
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "no such job (finished ones are kept for an hour)")
    return job


@app.get("/v1/faceswap/{jid}", dependencies=[Depends(auth)])
def job_status(jid: str):
    job = _job(jid)
    return {k: job.get(k) for k in ("id", "status", "stage", "progress", "error", "kind", "faces")}


@app.get("/v1/faceswap/{jid}/result", dependencies=[Depends(auth)])
def job_result(jid: str):
    job = _job(jid)
    if job["status"] != "done":
        raise HTTPException(409, f"the job is {job['status']}")
    name = "result.png" if job["kind"] == "image" else "result.mp4"
    return FileResponse(WORK / jid / name, media_type="image/png" if job["kind"] == "image" else "video/mp4",
                        filename=f"faceswap-{jid}{Path(name).suffix}")


@app.delete("/v1/faceswap/{jid}", dependencies=[Depends(auth)])
def cancel(jid: str):
    job = _job(jid)
    job["cancel"] = True
    if job["status"] == "queued":
        job.update(status="cancelled", stage="cancelled", finished=time.time())
    elif job["status"] != "running":
        jobs.pop(jid, None)
        shutil.rmtree(WORK / jid, ignore_errors=True)
    return {"id": jid, "status": job["status"]}

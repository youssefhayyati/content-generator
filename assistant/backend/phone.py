"""The team's Android phone: posting from its Instagram and X apps, and reading back how posts do.

The phone is driven through the hackathon Phone API (PHONE_API_URL, e.g. https://172.26.0.32/hack/v1, with
the team key in PHONE_API_KEY), which runs an agent of its own on the phone: POST /tasks with a goal in plain
words and it taps, swipes and types through the phone's input board, telling what it does as it goes
(GET /tasks/{id}/stream). After its result a task waits, idle, for a follow-up (POST /tasks/{id}/messages)
until it times out. One task runs on the phone at a time, whoever starts it.

Posting dependably isn't left to the phone's agent. Before it starts, the post's files are uploaded to the
phone, last one first, so its gallery shows them newest first in slide order; the caption is made typable
(the input board types printable ASCII only, and no line breaks); and its goal is a phone skill
(skills/phone/*.md) with the post's details filled in, saying where to tap in that app. While it posts, the
phone asks an OK for plain input it can't check (an Enter in a field it can't read): that's part of the post
the user asked for, so it's given (PHONE_AUTO_APPROVE_POSTS); anything else waits for the user. When the phone
drops out (its link, its input board) before the post was shared, it's given the job again (RETRIES), told to
carry on from where the app is. Whatever the outcome, the screenshot it ended on is kept as proof
(MEDIA_DIR/phone/<task>.jpg, shown to the user), and the task is closed so the phone is free at once.

Feedback is a phone task too: it opens the post in the app and returns its numbers as JSON (output_schema).
Every check is kept with the post, so the next one says what changed; one runs by itself
PHONE_FEEDBACK_AFTER_MINUTES after posting.

PhoneWork is all of that; two things use it. PhoneSession posts a conversation's drafts when the user says
so (post_on_phone; several are posted one after another), tells the user how it goes, and puts each one on
FlowAI's record (its post and the run, with the proof), so FlowAI's calendar shows it went up;
backend/publisher.py publishes the posts FlowAI schedules, when their time comes, and reports to FlowAI.
"""

import asyncio
import base64
import json
import logging
import mimetypes
import re
import time
import unicodedata
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import aclosing
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from . import platforms
from .skills import Skill, load_skills
from .studio import StudioError

if TYPE_CHECKING:
    from .flowai import FlowAISession
    from .phone_direct import DirectDriver
    from .publisher import Publisher
    from .studio import Draft, StudioSession

log = logging.getLogger(__name__)

TERMINAL = {"succeeded", "failed", "cancelled"}
UPLOAD_GAP_S = 1.2  # the phone's gallery orders by the second a file was added
FEEDBACK_RETRY_S = 60  # an automatic check waits this long when the phone is busy
FEEDBACK_TRIES = 10
COMMENTS_KEPT = 5
STREAM_QUIET_S = 60  # a task stream silent this long is checked on (a dead phone can leave it hanging)
STATUS_TRIES = 5  # a task's status is asked this many times before giving up on it
RETRIES = 2  # a job the phone dropped is given to it again this many times
RETRY_WAIT_S = 15
RETRY_MIN_STEPS = 12  # a FlowAI run retries only with this much of its step budget left
FEEDBACK_MAX_STEPS = 20  # reading a post's numbers takes about ten; a lost agent holds the phone no longer
QUEUE_POLL_S = 5  # posts waiting their turn check this often whether the phone is free
STEPS_KEPT = 80  # of a post's steps, for FlowAI's record
PROOF_URL = "media/phone/"  # where the proofs in MEDIA_DIR/phone are served (next to the page, like all media)

# The phone dropping out, not the job going wrong: worth another try, if nothing public happened yet
DROPPED = re.compile(r"PolicyViolation|TargetLost|unreachable|DEVICE_ERROR|can't be reached|answered 5\d\d|"
                     r"RATE_LIMIT|\bBUSY\b", re.I)
# A tap meant to publish: "Tap the blue Share button", "Tap 'Post' (top right)", or a button that says so
SHARE_TAP = re.compile(r"\b(tap|press|click|hit)\b\W+(?:\w+\W+){0,3}?(share|post|publish|tweet|your story)\b"
                       r"(?![\s'\"]*\(?(the pen|pen|screen|box|text|caption|field|tab|type|picker|menu|options))", re.I)
SHARE_ELEMENT = re.compile(r"^\W*(share|post|publish|tweet|your story)\W*$", re.I)
# Plain input the phone wants an OK for while posting (e.g. Enter in a field it can't read): part of the post
INPUT_ACTIONS = {"tap", "key", "type", "swipe", "long_press", "scroll", "wait", "back"}
RETRY_NOTE = ("Note: an earlier try at this stopped halfway because the phone lost its connection, so the app "
              "may still show where it got to. If it shows this same post half made, carry on from there; "
              "otherwise start from the beginning. Never share it a second time.\n\n")

# Characters the input board can't type, as the nearest ones it can
ASCII = str.maketrans({"‘": "'", "’": "'", "‚": "'", "“": '"', "”": '"', "„": '"', "–": "-", "—": "-",
                       "‐": "-", "…": "...", "•": "-", "·": "-", "×": "x", " ": " ", " ": " ",
                       "€": "EUR", "£": "GBP", "©": "(c)", "®": "(R)", "™": "TM", "ß": "ss", "æ": "ae",
                       "Æ": "AE", "œ": "oe", "Œ": "OE", "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d"})

FEEDBACK_SCHEMA = {
    "type": "object",
    "properties": {
        "found": {"type": "boolean", "description": "Whether the post was found and opened"},
        "likes": {"type": ["integer", "null"]},
        "comments": {"type": ["integer", "null"], "description": "Comments (Instagram) or replies (X)"},
        "shares": {"type": ["integer", "null"], "description": "Shares (Instagram) or reposts plus quotes (X)"},
        "saves": {"type": ["integer", "null"], "description": "Saves (Instagram) or bookmarks (X)"},
        "views": {"type": ["integer", "null"], "description": "Views, plays or impressions"},
        "latest_comments": {"type": "array", "items": {"type": "object", "properties": {
            "author": {"type": "string"}, "text": {"type": "string"}}}},
        "notes": {"type": "string", "description": "Anything else worth knowing, e.g. a warning shown on the post"},
    },
    "required": ["found"],
}
NUMBERS = ("likes", "comments", "shares", "saves", "views")


class PhoneError(Exception):
    pass


def _iso(t: datetime | None = None) -> str:
    return (t or datetime.now(timezone.utc)).isoformat(timespec="seconds")


def typable(text: str) -> tuple[list[str], list[str]]:
    """The caption as lines the input board can type, and what had to be left out (emoji, symbols)."""
    lines, dropped = [], []
    for line in str(text or "").replace("\r", "").split("\n"):
        line = unicodedata.normalize("NFKD", line.translate(ASCII))
        out = []
        for ch in line:
            if unicodedata.combining(ch):
                continue  # é -> e
            if " " <= ch <= "~":
                out.append(ch)
            elif ch == "\t":
                out.append(" ")
            elif not unicodedata.category(ch).startswith(("M", "C")) and ch not in dropped:
                dropped.append(ch)  # ️ and joiners are part of an emoji, not worth naming
        lines.append(re.sub(r" {2,}", " ", "".join(out)).strip())
    while lines and not lines[-1]:
        lines.pop()
    return lines, dropped


def _count(value) -> int | None:
    """12, "1,204", "3.4K", "2M" -> a number."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    m = re.fullmatch(r"([\d.,]+)\s*([KkMm]?)", str(value).strip())
    if not m:
        return None
    digits, unit = m.groups()
    try:
        n = float(digits.replace(",", "")) if unit else float(digits.replace(",", "").replace(".", ""))
    except ValueError:
        return None
    return int(n * {"": 1, "k": 1_000, "m": 1_000_000}[unit.lower()])


def _shares(intent: str, params: dict) -> bool:
    """Whether a tap was meant to publish the post (FlowAI's tap:post-button): the button it read says so
    ("TextView 'Share'"), or what the phone's agent said it would do ("Tap the blue Share button")."""
    element = re.search(r"'([^']*)'", str(params.get("element") or ""))
    return bool((element and SHARE_ELEMENT.search(element.group(1))) or SHARE_TAP.search(intent or ""))


# --- the API --------------------------------------------------------------------

class PhoneClient:
    def __init__(self, base_url: str, key: str, verify: bool = True):
        self.base_url = base_url.rstrip("/")
        self.http = httpx.AsyncClient(base_url=self.base_url, headers={"Authorization": f"Bearer {key}"},
                                      verify=verify, timeout=httpx.Timeout(30, connect=10))
        self.job: "PhoneJob | None" = None  # the one the phone is doing (or idle after), whoever started it
        self.publisher: "Publisher | None" = None  # publishes FlowAI's scheduled posts, when it's on
        self.device = ""  # its ID (heracles-phone): FlowAI's phone with that ID is the one that posted
        # Our own agent on its direct controls (backend/phone_direct.py, PHONE_DRIVER=direct); None: the API's
        self.driver: "DirectDriver | None" = None

    async def close(self):
        await self.http.aclose()

    async def call(self, method: str, path: str, **kw):
        try:
            r = await self.http.request(method, path, **kw)
        except httpx.HTTPError as exc:
            raise PhoneError(f"the phone API can't be reached ({exc.__class__.__name__})") from exc
        try:
            body = r.json()
        except ValueError:
            raise PhoneError(f"the phone API answered {r.status_code}") from None
        if isinstance(body, dict) and body.get("ok"):
            return body.get("data")
        err = body.get("error") if isinstance(body, dict) else None
        if isinstance(err, dict):
            raise PhoneError(f"{err.get('code', r.status_code)}: {err.get('message', '')}")
        raise PhoneError(f"the phone API answered {r.status_code}: {json.dumps(body)[:300]}")

    async def status(self) -> dict:
        return await self.call("GET", "/phone/status")

    async def upload(self, path: Path) -> dict:
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        data = await asyncio.to_thread(path.read_bytes)
        return await self.call("POST", "/phone/media", files={"file": (path.name, data, mime)},
                               timeout=httpx.Timeout(300, connect=10))

    async def start(self, goal: str, mode: str, max_steps: int, output_schema: dict | None = None) -> dict:
        body = {"goal": goal, "mode": mode, "max_steps": max_steps}
        if output_schema:
            body |= {"output_format": "json", "output_schema": output_schema}
        return await self.call("POST", "/tasks", json=body)

    async def task(self, task_id: str) -> dict:
        return await self.call("GET", f"/tasks/{task_id}")

    async def cancel(self, task_id: str):
        await self.call("POST", f"/tasks/{task_id}/cancel")

    async def message(self, task_id: str, text: str):
        await self.call("POST", f"/tasks/{task_id}/messages", json={"text": text})

    async def approvals(self, task_id: str) -> list[dict]:
        return [a for a in await self.call("GET", "/approvals", params={"status": "pending"})
                if a.get("task_id") == task_id]

    async def decide(self, approval_id: str, approved: bool, note: str | None = None):
        await self.call("POST", f"/approvals/{approval_id}", json={"approved": approved, "note": note})

    async def screenshot(self, task_id: str, n: int) -> bytes | None:
        """A step's screenshot (JPEG), or None."""
        return await self._image(f"/tasks/{task_id}/screenshots/{n}")

    async def proof(self, task_id: str, last_step: int | None) -> bytes | None:
        """The screenshot that shows how a task ended: the one its run record names as evidence (what a pro
        run's check looked at), else its last step's, else the screen now. Never raises."""
        n = last_step
        try:
            record = await self.call("GET", f"/tasks/{task_id}/run-record")
            m = re.search(r"/screenshots/(\d+)$", str(((record or {}).get("evidence") or {}).get("ref") or ""))
            n = int(m.group(1)) if m else n
        except PhoneError:
            pass
        shot = await self.screenshot(task_id, n) if n else None
        return shot or await self._image("/phone/screenshot", params={"format": "jpeg", "max_width": 1080})

    async def _image(self, path: str, **kw) -> bytes | None:
        try:
            r = await self.http.get(path, **kw)
        except httpx.HTTPError:
            return None
        return r.content if r.status_code == 200 and r.headers.get("content-type", "").startswith("image") else None

    async def events(self, task_id: str, after: int = 0) -> AsyncIterator[dict]:
        """The task's events after seq `after`, live, until the task ends; a dropped stream is picked up again."""
        while True:
            try:
                async with self.http.stream("GET", f"/tasks/{task_id}/stream",
                                            headers={"Last-Event-ID": str(after)} if after else None,
                                            timeout=httpx.Timeout(30, read=STREAM_QUIET_S)) as r:
                    if r.status_code != 200:
                        raise PhoneError(f"the task's events answered {r.status_code}")
                    data: list[str] = []
                    async for line in r.aiter_lines():
                        if line.startswith("data:"):
                            data.append(line[5:].strip())
                        elif not line and data:
                            event, data = json.loads("\n".join(data)), []
                            if event.get("seq", 0) > after:  # a reconnect may replay from the start
                                after = event["seq"]
                                yield event
            except (httpx.HTTPError, ValueError, PhoneError) as exc:
                log.info("phone task %s: event stream dropped (%s)", task_id, exc.__class__.__name__)
            if await self._task_status(task_id) in TERMINAL:
                for event in await self.call("GET", f"/tasks/{task_id}/events", params={"after_seq": after}):
                    yield event
                return
            await asyncio.sleep(2)

    async def _task_status(self, task_id: str) -> str:
        """The task's status, asked again on a hiccup: one failed call isn't a failed task."""
        for attempt in range(1, STATUS_TRIES + 1):
            try:
                return (await self.task(task_id))["status"]
            except PhoneError as exc:
                if attempt == STATUS_TRIES:
                    raise
                log.info("phone task %s: status not known yet (%s); asking again", task_id, exc)
                await asyncio.sleep(5 * attempt)


# --- jobs and posts ----------------------------------------------------------------

@dataclass
class PhonePost:
    id: int
    platform: str
    placement: str
    caption: str  # as typed
    draft: int | None = None  # the conversation's draft it was
    version: int | None = None  # that draft's version, as posted
    flowai_post: int | None = None  # FlowAI's post: the scheduled one it published, or the draft's there
    title: str = ""
    status: str = "posting"  # posting | posted | failed | unsure
    waiting: bool = False  # posting, once the phone is free (posts go one after another)
    at: str | None = None  # when it went up
    task: str | None = None
    detail: str = ""
    proof: str | None = None  # the screenshot it ended on (PROOF_URL...): the post up, or where it stopped
    proof_note: str = ""  # what that shows: the phone's independent check, else its own words
    run: dict = field(default_factory=dict)  # started, ended, steps, attempts: how it was posted (FlowAI's record)
    recorded: bool = False  # on FlowAI's record, with its run
    record_error: str = ""  # why it isn't yet (it's tried again when the conversation is on screen)
    feedback: list[dict] = field(default_factory=list)  # every check, oldest first
    check_at: str | None = None  # the next automatic check

    @property
    def label(self) -> str:
        return platforms.label(self.platform, self.placement)

    @property
    def name(self) -> str:
        return f"FlowAI post {self.flowai_post}" if self.flowai_post and self.draft is None else f"post {self.id}"

    def info(self) -> dict:
        """For the assistant."""
        last = self.feedback[-1] if self.feedback else None
        return {"post": self.id, **({"draft": self.draft} if self.draft else {}),
                **({"flowai_post": self.flowai_post} if self.flowai_post else {}),
                **({"title": self.title} if self.title else {}), "what": self.label,
                "status": "waiting its turn" if self.waiting else self.status,
                **({"posted": self.at} if self.at else {}), **({"detail": self.detail} if self.detail else {}),
                **({"last_check": last} if last else {}), **({"next_check": self.check_at} if self.check_at else {})}

    def event(self) -> dict:
        """For the page: what the assistant knows, and the proof."""
        return {**self.info(), "status": self.status, "waiting": self.waiting, "platform": self.platform,
                "placement": self.placement, "proof": self.proof, "proof_note": self.proof_note,
                "recorded": self.recorded, "attempts": self.run.get("attempts", 0)}

    @classmethod
    def load(cls, data: dict) -> "PhonePost":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class PhoneJob:
    id: int
    kind: str  # post | publish (a FlowAI run) | feedback | task
    what: str  # what it does, in words
    post: PhonePost | None = None  # the post it's for
    task: str | None = None  # the API's task id (the latest attempt's)
    status: str = "starting"  # starting | running | awaiting approval | waiting (answered; can be told more) |
    #                           done | failed | cancelled
    seq: int = 0  # the last event seen
    intent: str = ""  # what the phone's agent said it would do next
    steps: list[str] = field(default_factory=list)
    actions: list[dict] = field(default_factory=list)  # the same for FlowAI's record: action, ok, ms, note
    last_step: int | None = None  # its number, for the screenshot
    last_at: float = field(default_factory=time.monotonic)  # when the last action came, to time the next
    result: str | None = None
    data: object = None  # the JSON result, for feedback
    snapshot: dict | None = None  # what a feedback check read (None: found nothing)
    success: bool | None = None
    verdict: str | None = None
    approval: dict | None = None  # waiting for the user's OK on this
    before: "PhoneJob | None" = None  # the phone's job before this one (closed first if it's idle)
    attempts: int = 1
    tapped_post: bool = False  # a tap meant to share it went through: it may be up, so never again
    direct: bool = False  # run by our own agent on the direct controls, not the API's agent
    run_args: tuple = ()  # direct: the goal, max steps and schema it runs
    proof: str | None = None  # the screenshot it ended on, as kept (PROOF_URL...)
    shot: bytes | None = field(default=None, repr=False)  # the same, for FlowAI
    run: str | None = None  # publish: FlowAI's run
    budget: int = 40  # publish: FlowAI's step budget
    started_at: str = field(default_factory=_iso)
    started: float = field(default_factory=time.monotonic)
    runner: asyncio.Task | None = None

    @property
    def active(self) -> bool:
        return self.status in ("starting", "running", "awaiting approval")

    def act(self, action: str, ok: bool, note: str = ""):
        """One thing done, timed since the one before."""
        now = time.monotonic()
        self.actions.append({"action": action, "ok": ok, "ms": round((now - self.last_at) * 1000), "note": note[:200]})
        self.last_at = now


@dataclass
class PostPlan:
    """A post made ready for the phone: its goal, from the skill for that kind of post."""
    goal: str
    caption: str  # as it will be typed
    dropped: list[str]  # what the phone can't type
    media: str  # e.g. "3 pictures"


class PhoneWork:
    """Runs jobs on the phone and follows them. The hooks (on_...) say where steps, questions and results go."""

    def __init__(self, client: PhoneClient | None, skills_dir: Path, mode: str = "flash", post_mode: str = "pro",
                 max_steps: int = 40, feedback_after_min: float = 60, proof_dir: Path | None = None,
                 auto_approve: bool = True):
        self.client, self.skills_dir = client, skills_dir
        self.mode, self.post_mode, self.max_steps = mode, post_mode, max_steps
        self.feedback_after = feedback_after_min * 60
        self.proof_dir, self.auto_approve = proof_dir, auto_approve
        self.jobs: dict[int, PhoneJob] = {}
        self.timers: dict[int, asyncio.Task] = {}  # post id -> its automatic check

    # --- hooks ----------------------------------------------------------------------

    async def on_started(self, job: PhoneJob):
        pass

    async def on_step(self, job: PhoneJob, name: str, params: dict, ok: bool, result: str):
        """One thing it did (also transfer, approval and retry, which aren't the phone agent's)."""

    async def on_approval(self, job: PhoneJob, approval: dict):
        """Nobody to ask: say no."""
        await self.answer_approval(job, False, "nobody is there to approve it")

    async def on_retry(self, job: PhoneJob, why: str):
        pass

    def on_question(self, job: PhoneJob, text: str):
        pass

    async def on_finished(self, job: PhoneJob):
        pass

    def on_changed(self, post: PhonePost | None = None):
        """A post changed: keep it."""

    # --- making ready ---------------------------------------------------------------

    def skills(self) -> dict[str, Skill]:
        return load_skills(self.skills_dir)

    def plan_post(self, platform: str, placement: str, caption: str, kinds: list[str]) -> PostPlan:
        """The goal for posting this, from skills/phone/post-<platform>-<placement>.md (or post-<platform>.md)."""
        skills = self.skills()
        skill = skills.get(f"post-{platform}-{placement}") or skills.get(f"post-{platform}")
        if not skill:
            raise PhoneError(f"there is no phone skill for {platform} {placement} posts "
                             f"(skills/phone/post-{platform}-{placement}.md)")
        lines, dropped = typable(caption)
        kind = "video" if "video" in kinds else "picture"
        n = len(kinds)
        media = f"{n} {kind}{'s' if n != 1 else ''}" if n else "no pictures (text only)"
        goal = _fill(skill, {"count": str(n), "media": media, "kind": kind, "placement": placement,
                             "caption": _caption_block(lines), "first_words": _first_words(lines)})
        return PostPlan(goal, "\n".join(lines), dropped, media)

    def busy_error(self) -> dict | None:
        job = self.client.job
        if job and job.active:
            return {"error": f"the phone is still {job.what}; wait for it or cancel it first"}
        return None

    def new_job(self, kind: str, what: str, post: PhonePost | None = None) -> PhoneJob:
        job = PhoneJob(len(self.jobs) + 1, kind, what, post, before=self.client.job)
        self.jobs[job.id] = job
        self.client.job = job  # now, so a second call right after finds the phone busy
        return job

    # --- running a job --------------------------------------------------------------

    async def post_files(self, job: PhoneJob, files: list[Path], plan: PostPlan, max_steps: int | None = None):
        """Puts the files on the phone (last first: the gallery then shows the first one first) and posts."""
        await self.started(job)
        try:
            for i, path in enumerate(reversed(files)):
                if i:
                    await asyncio.sleep(UPLOAD_GAP_S)
                await self.client.upload(path)
            done = f"put {plan.media} on the phone" + (f"; it can't type {''.join(plan.dropped)}" if plan.dropped else "")
            job.steps.append(done)
            job.act("transfer", True, done)
            await self.on_step(job, "transfer", {}, True, done)
        except PhoneError as exc:
            job.act("transfer", False, str(exc))
            return await self.failed(job, f"the files couldn't be put on the phone: {exc}")
        await self.run(job, plan.goal, self.post_mode, started=True, max_steps=max_steps)

    async def started(self, job: PhoneJob):
        old, job.before = job.before, None
        if old and old.task and old.status == "waiting":
            # A task that answered stays idle, holding the phone, until it times out: end it first
            try:
                await self.client.cancel(old.task)
            except PhoneError:
                pass
            old.status = "done"
        await self.on_started(job)

    async def failed(self, job: PhoneJob, why: str):
        job.status, job.result, job.success = "failed", why, False
        await self.finished(job)

    async def run(self, job: PhoneJob, goal: str | None, mode: str | None, schema: dict | None = None,
                  started: bool = False, max_steps: int | None = None):
        """Starts the task (goal) or follows it further after a message (goal None), until it answers or ends.
        A phone that drops out before anything public happened is given the job again (up to RETRIES)."""
        try:
            if goal is not None and not started:
                await self.started(job)
            new = goal is not None
            while True:
                try:
                    if new:
                        await self._start(job, RETRY_NOTE + goal if job.attempts > 1 else goal, mode, schema,
                                          self._steps_left(job, max_steps))
                    answered = await (self._follow_direct(job) if job.direct else self._follow(job))
                    if answered:
                        break
                    why = job.result or "the phone stopped without an answer"
                except PhoneError as exc:
                    log.warning("phone job %s: %s", job.id, exc)
                    why = f"the phone couldn't do it: {exc}"
                if goal is None or not self._may_retry(job, why, max_steps):
                    return await self.failed(job, why)
                new = await self._again(job, why)
            await self.finished(job)
        except asyncio.CancelledError:
            job.status, job.result = "cancelled", "cancelled"
            if job.post and job.kind in ("post", "publish") and job.post.status == "posting":
                job.post.status, job.post.detail = "unsure", "the posting was stopped"
                self.on_changed(job.post)
            await self.on_finished(job)
            raise
        except Exception as exc:
            log.exception("phone job %s failed", job.id)
            await self.failed(job, f"it failed with an error: {exc}")

    async def _start(self, job: PhoneJob, goal: str, mode: str | None, schema: dict | None, steps: int):
        """A task for the goal: our own agent's on the direct controls (PHONE_DRIVER=direct), else the API's."""
        if self.client.driver:
            job.direct, job.task = True, f"direct-{uuid.uuid4().hex[:16]}"
            job.run_args = (goal, steps, schema)
        else:
            task = await self.client.start(goal, mode, steps, schema)
            job.task = task["id"]
        job.status, job.seq = "running", 0
        if job.post and job.kind in ("post", "publish"):
            job.post.task = job.task  # it may go up from now on
            self.on_changed(job.post)
        log.info("phone job %s (%s): %s %s%s", job.id, job.what, "our agent, run" if job.direct else "task",
                 job.task, f", attempt {job.attempts}" if job.attempts > 1 else "")

    async def _follow_direct(self, job: PhoneJob) -> bool:
        """Our own agent on the direct controls: its events, taken in like the API agent's."""
        goal, steps, schema = job.run_args
        check = None
        if job.post and job.kind in ("post", "publish"):
            lines = job.post.caption.split("\n") if job.post.caption else []
            check = f"a new {job.post.label}" + (f" whose caption starts with {_first_words(lines)}" if lines else "")
        answered = False
        async with aclosing(self.client.driver.run(job, goal, steps, schema, check)) as events:
            async for event in events:
                await self._event(job, event, answered)
                answered = answered or event.get("type") == "result"
        return answered

    def _steps_left(self, job: PhoneJob, max_steps: int | None) -> int:
        """The new task's max_steps. A FlowAI run's steps, all attempts' together, stay within its budget."""
        limit = min(max_steps or self.max_steps, self.max_steps)
        if job.kind == "publish":
            limit = min(limit, job.budget - len(job.actions))
        return max(1, limit)

    def _may_retry(self, job: PhoneJob, why: str, max_steps: int | None) -> bool:
        """The phone dropped out (not the job going wrong), and trying again can't post it twice."""
        return (job.kind in ("post", "publish", "feedback") and job.attempts <= RETRIES and not job.tapped_post
                and bool(DROPPED.search(why)) and self._steps_left(job, max_steps) >= RETRY_MIN_STEPS)

    async def _again(self, job: PhoneJob, why: str) -> bool:
        """Before another try: True to start the task over, False when the phone carried on with it (only our
        link to it dropped) and it's followed again."""
        job.attempts += 1
        note = f"the phone dropped out ({why}); trying again"
        job.steps.append(note)
        job.act("retry", False, why)
        log.info("phone job %s: %s in %d s", job.id, note, RETRY_WAIT_S)
        await self.on_step(job, "retry", {}, False, why)
        await self.on_retry(job, why)
        await asyncio.sleep(RETRY_WAIT_S)
        if job.task and not job.direct:
            try:
                status = (await self.client.task(job.task))["status"]
            except PhoneError:
                status = None
            if status in ("queued", "starting", "running", "awaiting_approval", "idle", "succeeded"):
                log.info("phone job %s: task %s is %s after all; following it again", job.id, job.task, status)
                job.status = "running"
                return False
            if status not in TERMINAL:  # unknown: make sure it doesn't go on beside the new one
                try:
                    await self.client.cancel(job.task)
                except PhoneError:
                    pass
        job.task, job.last_step, job.result, job.success, job.data, job.verdict = None, None, None, None, None, None
        job.status = "running"
        return True

    async def cancel_job(self, job: PhoneJob):
        if job.task and not job.direct:
            try:
                await self.client.cancel(job.task)
            except PhoneError as exc:
                log.warning("phone task %s could not be cancelled: %s", job.task, exc)
        if job.runner and not job.runner.done():
            job.runner.cancel()

    async def answer_approval(self, job: PhoneJob, approve: bool, note: str | None = None):
        a, job.approval = job.approval, None
        if a:
            await self.client.decide(a["id"], approve, note)
            job.status = "running"

    async def _follow(self, job: PhoneJob) -> bool:
        """Reads the task's events until it answers (True) or ends without an answer (False)."""
        answered = False
        async with aclosing(self.client.events(job.task, job.seq)) as events:
            async for event in events:
                if await self._event(job, event, answered):
                    return True
                answered = answered or event.get("type") == "result"
                if job.status == "done":
                    return answered
        return answered

    async def _event(self, job: PhoneJob, event: dict, answered: bool) -> bool:
        """Takes in one event; True once the task has answered and waits for more."""
        job.seq = event.get("seq", job.seq)
        kind, data = event.get("type"), event.get("data") or {}
        if kind == "step":
            job.intent = str(data.get("next_goal") or "")
        elif kind == "action":
            name = data.get("name", "")
            params = {k: v for k, v in (data.get("params") or {}).items() if k not in ("transport", "perception")}
            ok = bool(data.get("ok"))
            result = "ok" if ok else f"failed: {data.get('error')}"
            if name == "tap" and ok and job.kind in ("post", "publish") and _shares(job.intent, params):
                name, job.tapped_post = "tap:post-button", True  # FlowAI's name for it
            job.steps.append(f"{name} {json.dumps(params, ensure_ascii=False)[:120]}: {result}")
            job.last_step = data.get("n") or job.last_step
            job.act(name, ok, job.intent or result)
            await self.on_step(job, name, params, ok, result)
        elif kind == "result":
            job.result = str(data.get("text") or "").strip() or None
            job.data, job.success = data.get("data"), data.get("success")
        elif kind == "message" and data.get("kind") in ("question", "ask", "ask_user"):
            self.on_question(job, str(data.get("text")))
        elif kind == "approval" or (kind == "status" and data.get("status") == "awaiting_approval"):
            await self._approval(job)
        elif kind == "status":
            status = data.get("status")
            if status == "running" and job.status == "awaiting approval":
                job.status, job.approval = "running", None
            elif status == "idle" and answered:
                job.status = "waiting"
                return True
            elif status in TERMINAL:
                if status != "succeeded" and not answered:
                    job.result = job.result or f"the task {status}" + (f" ({data['detail']})"
                                                                        if data.get("detail") else "")
                job.status = "done"
        return False

    async def _approval(self, job: PhoneJob):
        try:
            pending = await self.client.approvals(job.task)
        except PhoneError as exc:
            log.warning("phone approvals: %s", exc)
            return
        if not pending or (job.approval and job.approval["id"] == pending[0]["id"]):
            return
        a = pending[0]
        job.approval = {"id": a["id"], "action": a.get("action"), "params": a.get("params"),
                        "reason": a.get("reason"), "expires": a.get("expires_at")}
        # Publishing a post FlowAI has approved, or the post the user just asked for: plain input is part of it
        if self.auto_approve and (job.kind == "publish" or (job.kind == "post" and a.get("action") in INPUT_ACTIONS)):
            what = f"{a.get('action')} {json.dumps(a.get('params') or {}, ensure_ascii=False)[:80]}"
            job.steps.append(f"OK given for {what} ({a.get('reason')})")
            job.act("approval", True, f"the phone asked: {a.get('reason') or what}")
            log.info("phone job %s: OK given for %s (%s)", job.id, what, a.get("reason"))
            await self.on_step(job, "approval", {"action": a.get("action")}, True, str(a.get("reason") or what))
            try:
                await self.answer_approval(job, True, "part of the post that was asked for")
            except PhoneError as exc:
                log.warning("phone job %s: the OK couldn't be given: %s", job.id, exc)
            return
        job.status = "awaiting approval"
        await self.on_approval(job, job.approval)

    async def finished(self, job: PhoneJob):
        if job.task and job.success is not None and not job.direct:
            try:  # pro runs add an independent verdict (ours makes its own, phone_direct.py)
                task = await self.client.task(job.task)
                job.verdict = task.get("verdict") if task.get("verified") is not None else None
                if task.get("verified") is False:
                    job.success = False
            except PhoneError:
                pass
        if job.task:
            await self._keep_proof(job)
        if job.active:
            job.status = "done"
        if job.kind == "post" and job.post:
            self.posted(job, job.post)
        elif job.kind == "feedback" and job.post and job.status != "failed":
            job.snapshot = self.checked(job, job.post)
        if job.kind in ("publish", "feedback") or (job.kind == "post" and job.success):
            await self._close(job)  # nothing more to tell it: the phone is free at once
        log.info("phone job %s (%s) %s in %d s%s: %s", job.id, job.what, job.status,
                 round(time.monotonic() - job.started), f" after {job.attempts} tries" if job.attempts > 1 else "",
                 job.result)
        await self.on_finished(job)

    async def _keep_proof(self, job: PhoneJob):
        """The screenshot it ended on, kept as MEDIA_DIR/phone/<task>.jpg (our agent took it itself)."""
        if not (job.direct and job.shot):
            job.shot = await self.client.proof(job.task, job.last_step)
        if not job.shot or not self.proof_dir:
            return
        path = self.proof_dir / f"{job.task}.jpg"

        def write():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(job.shot)

        try:
            await asyncio.to_thread(write)
            job.proof = PROOF_URL + path.name
        except OSError as exc:
            log.warning("the phone's screenshot couldn't be kept: %s", exc)

    async def _close(self, job: PhoneJob):
        if job.task and job.status == "waiting":
            try:
                await self.client.cancel(job.task)
                job.status = "done"
            except PhoneError:
                pass  # it times out by itself; the next job closes it first

    def proof_file(self, post: PhonePost) -> Path | None:
        if not (post.proof and self.proof_dir and post.proof.startswith(PROOF_URL)):
            return None
        path = self.proof_dir / post.proof[len(PROOF_URL):]
        return path if path.is_file() else None

    # --- posts and their feedback ---------------------------------------------------

    def posted(self, job: PhoneJob, post: PhonePost, up: bool | None = None):
        """Where the post stands after the phone's answer (up: decided by the caller)."""
        post.task = job.task
        up = job.success if up is None else up
        if up:
            post.status, post.at = "posted", _iso()
            if self.feedback_after > 0:
                self.plan_check(post, datetime.now(timezone.utc) + timedelta(seconds=self.feedback_after))
        else:  # it may be up anyway if it said so, or got as far as sharing
            post.status = "failed" if job.status == "failed" and not job.tapped_post else "unsure"
        post.detail = job.result or ""
        post.proof, post.proof_note = job.proof or post.proof, (job.verdict or job.result or "")[:600]
        post.run = {"started": job.started_at, "ended": _iso(), "attempts": job.attempts,
                    "steps": job.actions[-STEPS_KEPT:]}
        post.recorded, post.record_error = False, ""
        self.on_changed(post)

    def checked(self, job: PhoneJob, post: PhonePost) -> dict | None:
        """Keeps what the check read; None when it found nothing."""
        data = job.data if isinstance(job.data, dict) else _json(job.result)
        if not isinstance(data, dict) or not data.get("found", True):
            return None
        snap = {"at": _iso(), **{k: _count(data.get(k)) for k in NUMBERS}}
        snap["latest_comments"] = [{"author": str(c.get("author", "")), "text": str(c.get("text", ""))}
                                   for c in (data.get("latest_comments") or [])[:COMMENTS_KEPT] if isinstance(c, dict)]
        if data.get("notes"):
            snap["notes"] = str(data["notes"])
        if job.proof:
            snap["proof"] = job.proof
        post.feedback.append(snap)
        self.on_changed(post)
        return snap

    def check_feedback(self, post: PhonePost, auto: bool = False) -> PhoneJob:
        """Starts reading the post's numbers on the phone (skills/phone/feedback-<platform>.md)."""
        if post.status not in ("posted", "unsure"):
            raise PhoneError(f"{post.name} isn't up ({post.status})")
        skill = self.skills().get(f"feedback-{post.platform}")
        if not skill:
            raise PhoneError(f"there is no phone skill feedback-{post.platform} in skills/phone")
        if busy := self.busy_error():
            raise PhoneError(busy["error"])
        lines = post.caption.split("\n") if post.caption else []
        goal = _fill(skill, {"first_words": _first_words(lines), "placement": post.placement,
                             "posted": post.at or "recently", "comments_kept": str(COMMENTS_KEPT)})
        job = self.new_job("feedback", f"checking how {post.name} ({post.label}) is doing"
                           + (", as planned after posting" if auto else ""), post)
        job.runner = asyncio.create_task(self.run(job, goal, self.mode, FEEDBACK_SCHEMA,
                                                  max_steps=FEEDBACK_MAX_STEPS))
        return job

    def plan_check(self, post: PhonePost, at: datetime):
        post.check_at = _iso(at)
        if old := self.timers.get(post.id):
            old.cancel()
        self.timers[post.id] = asyncio.get_running_loop().create_task(self._check_later(post, at))

    def replan_checks(self, posts):
        """Checks that were due while nothing was running (a restart, a closed conversation)."""
        for post in posts:
            if post.check_at:
                try:
                    self.plan_check(post, datetime.fromisoformat(post.check_at))
                except (ValueError, RuntimeError):
                    post.check_at = None

    async def _check_later(self, post: PhonePost, at: datetime):
        await asyncio.sleep(max(0.0, (at - datetime.now(timezone.utc)).total_seconds()))
        for _ in range(FEEDBACK_TRIES):
            try:
                self.check_feedback(post, auto=True)
                break
            except PhoneError as exc:
                why = str(exc)
                if "still" not in why:  # not just busy: trying again won't help
                    log.warning("%s: the automatic check couldn't start: %s", post.name, why)
                    break
            await asyncio.sleep(FEEDBACK_RETRY_S)
        post.check_at = None
        self.on_changed(post)

    async def close(self):
        for t in self.timers.values():
            t.cancel()


def feedback_note(post: PhonePost, snap: dict | None, result: str | None, data=None) -> str:
    """What a check found, for the assistant."""
    if snap is None:
        why = (data.get("notes") if isinstance(data, dict) else None) or result or "no answer"
        return f"Checking {post.name} ({post.label}) didn't find it: {why}"
    before = post.feedback[-2] if len(post.feedback) > 1 else None
    numbers = {k: v for k, v in snap.items() if k in NUMBERS and v is not None}
    changes = {k: v - before[k] for k, v in numbers.items() if before and before.get(k) is not None and v != before[k]}
    return (f"How {post.name} ({post.label}, posted {post.at}) is doing: {json.dumps(numbers)}"
            + (f"; since the last check at {before['at']}: {json.dumps(changes)}" if before else "")
            + (f". Latest comments: {json.dumps(snap['latest_comments'], ensure_ascii=False)}"
               if snap["latest_comments"] else ". No comments yet")
            + (f". Notes: {snap['notes']}" if snap.get("notes") else "")
            + "\nSum it up for the user in a sentence or two: what stands out, and one idea for the next "
              "post if the comments suggest one.")


# --- a conversation's work on the phone -------------------------------------------

class PhoneSession(PhoneWork):
    """Posts the conversation's drafts when the user says so (one after another), tells the user how it goes,
    and puts each one on FlowAI's record."""

    def __init__(self, client: PhoneClient | None, studio: "StudioSession", skills_dir: Path,
                 send: Callable[..., Awaitable[None]], notify: Callable[[str], None],
                 remember: Callable[[str], None], changed: Callable[[], None],
                 mode: str = "flash", post_mode: str = "pro", max_steps: int = 40, feedback_after_min: float = 60,
                 proof_dir: Path | None = None, auto_approve: bool = True):
        super().__init__(client, skills_dir, mode, post_mode, max_steps, feedback_after_min, proof_dir, auto_approve)
        self.studio = studio
        self.send, self.notify, self.remember, self.changed = send, notify, remember, changed
        self.posts: dict[int, PhonePost] = {}
        self.queue: list[tuple[PhonePost, list[Path], PostPlan, str]] = []  # waiting for the phone, in order
        self.draining: asyncio.Task | None = None
        # FlowAI, while this conversation is on screen in a page signed in to it (FlowAISession.attach)
        self.recorder: "FlowAISession | None" = None
        self.recording: set[asyncio.Task] = set()
        self.on_record: set[int] = set()  # posts being put on FlowAI's record right now (once at a time)

    @property
    def busy(self) -> bool:
        """Something still runs or is due for it, so the conversation stays in memory."""
        return any(j.runner and not j.runner.done() for j in self.jobs.values()) or bool(self.queue) or \
            any(not t.done() for t in self.timers.values()) or any(not t.done() for t in self.recording)

    @property
    def job(self) -> PhoneJob | None:
        return self.jobs[max(self.jobs)] if self.jobs else None

    # --- what the tools do ----------------------------------------------------------

    async def post(self, refs=None, again: bool = False) -> dict:
        """Posts drafts, one after another: the first now if the phone is free, the others when it is."""
        replies = [self._post_one(ref, again) for ref in (refs if isinstance(refs, list) and refs else [refs])]
        if len(replies) == 1:
            return replies[0]
        return {"posts": replies, "note": "they go up one after another, by themselves; you are told as each "
                                          "one is up, so there is nothing to check on meanwhile"}

    def _post_one(self, ref, again: bool) -> dict:
        try:
            d = self.studio.get(ref)
        except StudioError as exc:
            return {"error": str(exc)}
        if d.check and not d.check.get("ok", True):
            fails = [c["detail"] for c in d.check.get("checks", []) if c["status"] == "fail"]
            return {"error": f"draft {d.id} doesn't pass {d.label}'s check: {' '.join(fails)} Fix it first"}
        files = [path for path, _ in d.files]
        if not files and platforms.spec(d.platform, d.placement)["items"][0] > 0:
            return {"error": f"draft {d.id} has no pictures yet"}
        if missing := [p.name for p in files if not p.exists()]:
            return {"error": f"draft {d.id}'s files are gone ({', '.join(missing)}); show it again to redraw it"}
        try:
            plan = self.plan_post(d.platform, d.placement, d.caption, [f.kind for _, f in d.files])
        except PhoneError as exc:
            return {"error": str(exc)}
        last = max((p for p in self.posts.values() if p.draft == d.id), key=lambda p: p.id, default=None)
        if last and last.status == "posting":
            return {"error": f"draft {d.id} is already being posted (post {last.id})"
                    + (", waiting its turn" if last.waiting else "")}
        if last and last.status in ("posted", "unsure") and not again:
            return {"error": f"draft {d.id} is already {'up' if last.status == 'posted' else 'maybe up'} (post "
                             f"{last.id}{', ' + last.at if last.at else ''}). Post it once more only if the user "
                             "says so, with again true" + (", after checking it with post_feedback"
                                                           if last.status == "unsure" else "")}
        if last and last.status == "failed":  # trying it again: the same post, another attempt
            post = last
            post.status, post.task, post.detail, post.at, post.proof, post.proof_note = "posting", None, "", None, None, ""
            post.flowai_post = None  # where this try goes on FlowAI's record is decided anew (FlowAISession)
            post.caption, post.version, post.title, post.placement = plan.caption, d.version, d.title, d.placement
        else:
            post = PhonePost(max(self.posts, default=0) + 1, d.platform, d.placement, plan.caption, draft=d.id,
                             version=d.version, title=d.title)
            self.posts[post.id] = post
        reply: dict = {"post": post.id, "draft": d.id}
        if not self.queue and not self.busy_error():
            job = self._start_post(post, files, plan, f"posting draft {d.id} as {d.a_label}")
            reply |= {"phone_job": job.id, "status": "started: uploading "
                      + (f"the {plan.media} to the phone, then posting from the app" if files else "nothing; posting "
                         "from the app")}
        else:
            post.waiting = True
            self.queue.append((post, files, plan, f"posting draft {d.id} as {d.a_label}"))
            reply["status"] = f"waiting its turn ({len(self.queue)} in line): it starts by itself when the phone is free"
            if not self.draining or self.draining.done():
                self.draining = asyncio.create_task(self._drain())
        reply["note"] = "you are told when it's up (the user sees the screenshot it ends on); don't check on it"
        if plan.dropped:
            reply["left_out_of_caption"] = "".join(plan.dropped)
            reply["why"] = "the phone types plain letters only (no emoji)"
        self.on_changed(post)
        self._track(self.send(type="phone_post", **post.event()))
        return reply

    def _start_post(self, post: PhonePost, files: list[Path], plan: PostPlan, what: str) -> PhoneJob:
        post.waiting = False
        job = self.new_job("post", what, post)
        job.runner = asyncio.create_task(self.post_files(job, files, plan))
        self._track(self._prepare_record(post))
        return job

    async def _drain(self):
        """The posts waiting their turn, one at a time, as the phone gets free (from anyone's job)."""
        while self.queue:
            if self.busy_error():
                await asyncio.sleep(QUEUE_POLL_S)
                continue
            post, files, plan, what = self.queue.pop(0)
            job = self._start_post(post, files, plan, what)
            await asyncio.wait({job.runner})

    async def feedback(self, ref=None, flowai_post=None) -> dict:
        if flowai_post not in (None, ""):
            try:
                n = int(str(flowai_post).strip().lstrip("#"))
            except ValueError:
                raise PhoneError(f"{flowai_post!r} isn't a FlowAI post number") from None
            mine = [p for p in self.posts.values() if p.flowai_post == n]
            if mine:
                post = max(mine, key=lambda p: (p.status in ("posted", "unsure"), p.id))
            elif self.client.publisher:
                post = self.client.publisher.find(n)
            else:
                return {"error": f"FlowAI post {n} wasn't published from the phone"}
        else:
            post = self._post_ref(ref)
        job = self.check_feedback(post)
        return {"phone_job": job.id, "status": "started: opening the post in the app to read its numbers",
                "note": "you are told what it finds"}

    async def task(self, instruction: str, skill: str | None = None) -> dict:
        goal = instruction.strip()
        if skill:
            found = self.skills().get(str(skill).strip())
            if not found:
                return {"error": f"there is no phone skill {skill!r}. Skills: {', '.join(self.skills()) or 'none'}"}
            if found.name.startswith("post-"):
                return {"error": "posting a draft is post_on_phone's job (also to try a failed one again): it puts "
                                 "the files on the phone and keeps the post's record"}
            goal = f"{found.instructions}\n\nThe task: {goal}"
        if busy := self.busy_error():
            return busy
        job = self.new_job("task", instruction.strip())
        job.runner = asyncio.create_task(self.run(job, goal, self.mode))
        return {"phone_job": job.id, "status": "started", "note": "you are told the result"}

    def status(self) -> dict:
        job = self.job
        out: dict = {}
        if job:
            out["job"] = {"phone_job": job.id, "doing": job.what, "status": job.status,
                          "seconds": round(time.monotonic() - job.started), "recent_steps": job.steps[-3:],
                          **({"tries": job.attempts} if job.attempts > 1 else {}),
                          **({"result": job.result} if job.result else {}),
                          **({"needs_approval": job.approval} if job.approval else {})}
            if job.active:
                out["note"] = "still going: you are told when it's done, so don't check on it again"
        else:
            out["job"] = "nothing done on the phone yet in this conversation"
        if self.queue:
            out["waiting_their_turn"] = [p.id for p, *_ in self.queue]
        if self.posts:
            out["posts"] = [p.info() for p in self.posts.values()]
        other = self.client.job if self.client else None
        if other and other.active and other is not job:
            out["phone"] = f"busy: {other.what}"
        if self.client.publisher:
            out["flowai_scheduled_posts"] = self.client.publisher.recent()
        return out

    async def cancel(self) -> dict:
        job, dropped = self.job, [p for p, *_ in self.queue]
        self.queue.clear()
        for p in dropped:
            p.status, p.waiting, p.detail = "failed", False, "not posted: stopped before its turn"
            self.on_changed(p)
            await self.send(type="phone_post", **p.event())
        if not job or not job.active:
            if dropped:
                return {"stopped": f"posts {', '.join(str(p.id) for p in dropped)} won't be posted"}
            return {"error": "nothing this conversation started is running on the phone"}
        await self.cancel_job(job)
        return {"phone_job": job.id, "status": "cancelled",
                **({"not_posted": [p.id for p in dropped]} if dropped else {})}

    async def answer(self, text: str | None = None, approve: bool | None = None) -> dict:
        job = self.job
        if not job or not job.task:
            return {"error": "nothing has been asked on the phone"}
        if approve is not None and job.approval:
            await self.answer_approval(job, bool(approve), text or None)
            return {"phone_job": job.id, "approval": "given" if approve else "refused"}
        if not text:
            return {"error": "say what to tell the phone, or approve true or false"
                             + ("" if job.approval else " (nothing waits for an approval)")}
        if job.status != "waiting" or self.client.job is not job:
            return {"error": f"the phone is {job.status}; it can be told more once it has answered"
                    if job.active else "that task on the phone is over; start a new one with phone_task"}
        await self.client.message(job.task, text)
        job.status, job.result, job.success, job.verdict = "running", None, None, None
        job.runner = asyncio.create_task(self.run(job, None, None))
        return {"phone_job": job.id, "status": "told; it goes on"}

    def _post_ref(self, ref) -> PhonePost:
        if not self.posts:
            raise PhoneError("nothing has been posted from the phone in this conversation")
        if ref in (None, ""):
            return self.posts[max(self.posts)]
        try:
            return self.posts[int(str(ref).strip().lstrip("#"))]
        except (KeyError, ValueError):
            raise PhoneError(f"there is no post {ref}; the posts are {', '.join(map(str, self.posts))}") from None

    # --- hooks: the page and the assistant ------------------------------------------

    async def on_started(self, job: PhoneJob):
        await self.send(type="phone_task", id=job.id, kind=job.kind, status="started", text=job.what,
                        **({"post": job.post.id} if job.post else {}))
        if job.post:
            await self.send(type="phone_post", **job.post.event())

    async def on_step(self, job: PhoneJob, name: str, params: dict, ok: bool, result: str):
        own = name in ("transfer", "approval", "retry")  # ours, not the phone agent's: no screenshot of its own
        if job.direct:
            shot = None if own else job.shot  # what our agent looked at for this step
        else:
            shot = await self.client.screenshot(job.task, job.last_step) if job.last_step and not own else None
        await self.send(type="phone_step", id=job.id, step=job.last_step, action=name, args=params,
                        result=result[:300], intent=job.intent[:200],
                        screenshot=base64.b64encode(shot).decode() if shot else None)

    async def on_retry(self, job: PhoneJob, why: str):
        await self.send(type="phone_task", id=job.id, kind=job.kind, status="trying again",
                        text=f"the phone dropped out ({why}); trying again")

    async def on_approval(self, job: PhoneJob, a: dict):
        await self.send(type="phone_task", id=job.id, kind=job.kind, status="awaiting approval",
                        text=a.get("reason") or a.get("action"))
        self.notify(f"The phone (job {job.id}, {job.what}) wants the user's OK before it does this: "
                    f"{a.get('action')} {json.dumps(a.get('params') or {}, ensure_ascii=False)[:200]}. Its reason: "
                    f"{a.get('reason')}. Ask the user in one short sentence, then call answer_phone with approve "
                    "true or false.")

    def on_question(self, job: PhoneJob, text: str):
        self.notify(f"The phone (job {job.id}, {job.what}) asks: {text}\nAsk the user, then pass the answer on "
                    "with answer_phone (text).")

    def on_changed(self, post: PhonePost | None = None):
        publisher = self.client.publisher if self.client else None
        if post and publisher and publisher.posts.get(post.id) is post:
            publisher.save_soon()  # FlowAI's scheduled post, checked from here
        self.changed()

    async def on_finished(self, job: PhoneJob):
        status = {"failed": "failed", "cancelled": "cancelled"}.get(job.status, "done")
        await self.send(type="phone_task", id=job.id, kind=job.kind, status=status, text=job.result,
                        proof=job.proof, **({"post": job.post.id} if job.post else {}))
        if job.status == "cancelled":
            if job.post and job.kind == "post":
                await self.send(type="phone_post", **job.post.event())
            return
        tell = "\nTell the user the outcome in one or two short spoken sentences."
        if job.kind == "post":
            note = self._posted_note(job) + tell
        elif job.kind == "feedback" and job.status != "failed":
            note = feedback_note(job.post, job.snapshot, job.result, job.data)
        else:
            note = (f"Phone job {job.id} ({job.what}) has finished. Result: {job.result}"
                    + (f"\nVerdict: {job.verdict}" if job.verdict else "")
                    + ("\nThe user sees the screenshot it ended on." if job.proof else ""))
            if job.success is False and job.status != "failed":
                note += ("\nIf it says what it needs, ask the user and pass the answer on with answer_phone "
                         "(text); the phone keeps the task open for a few minutes.")
            note += tell
        if job.post:
            await self.send(type="phone_post", **job.post.event())
        if job.kind == "post" and job.post:
            self._track(self._record(job.post))
        self.changed()
        self.notify(note)

    def _posted_note(self, job: PhoneJob) -> str:
        post = job.post
        when = (f" Its numbers will be checked by themselves at {post.check_at} (UTC); post_feedback checks "
                "them now." if post.check_at else " post_feedback checks how it's doing.")
        proof = " The user sees the screenshot it ended on, as proof." if post.proof else ""
        tries = f" It took {job.attempts} tries: the phone dropped out first." if job.attempts > 1 else ""
        coming = [p.id for p in self.posts.values() if p.status == "posting" and p is not post]
        later = f" Still to go, by themselves: posts {', '.join(map(str, coming))}." if coming else ""
        if post.status == "posted":
            return (f"Draft {post.draft} is now posted from the phone as an {post.label} (post {post.id})."
                    + proof + tries + when + (f" Verdict: {job.verdict}" if job.verdict else "")
                    + f" The phone said: {job.result}" + later)
        return (f"Posting draft {post.draft} as {post.label} from the phone didn't go through "
                f"({post.status}): {job.result}" + (f"\nVerdict: {job.verdict}" if job.verdict else "") + proof + tries
                + ("\nIt never got as far as sharing, so post_on_phone can try it again when the user wants."
                   if post.status == "failed" and not job.tapped_post else
                   "\nIt may be up anyway: say so, and offer to check with post_feedback before posting it again "
                   "(again true), so it doesn't go up twice.") + later)

    # --- FlowAI's record ------------------------------------------------------------

    def _track(self, coro):
        t = asyncio.get_running_loop().create_task(coro)
        self.recording.add(t)
        t.add_done_callback(self.recording.discard)

    def _flowai(self) -> "FlowAISession | None":
        """FlowAI, if this conversation is the one it works on now."""
        rec = self.recorder
        return rec if rec and rec.conv.phone is self else None

    async def _prepare_record(self, post: PhonePost):
        """While the phone posts: the draft saved as a FlowAI post, so the record only adds the run."""
        if rec := self._flowai():
            try:
                await rec.save_for_phone(post)
            except Exception as exc:
                log.info("post %d: not saved to FlowAI yet: %s", post.id, exc)

    async def _record(self, post: PhonePost):
        """The post and its run, with the proof, on FlowAI's record: the calendar shows it went up."""
        rec = self._flowai()
        if post.recorded or post.status not in ("posted", "unsure", "failed") or not post.draft or \
                post.id in self.on_record:
            return
        if not rec:
            post.record_error = "FlowAI isn't open in this conversation's page"
            return
        self.on_record.add(post.id)
        try:
            shot = None
            if path := self.proof_file(post):
                shot = await asyncio.to_thread(path.read_bytes)
            out = await rec.record_phone(post, shot, self.client.device)
        except Exception as exc:
            log.warning("post %d couldn't be put on FlowAI's record: %s", post.id, exc)
            post.record_error = str(exc)
            self.on_changed(post)
            return
        finally:
            self.on_record.discard(post.id)
        post.recorded, post.record_error = True, ""
        post.flowai_post = out["post"] or post.flowai_post
        self.on_changed(post)
        await self.send(type="phone_post", **post.event())
        if out["post"]:
            self.remember(f"Post {post.id} is on FlowAI's record as post {out['post']} ({out['status']}), with the "
                          "screenshot it ended on: FlowAI's calendar shows it.")

    def flush_records(self):
        """The posts FlowAI hasn't heard of yet (it wasn't there when they finished): now that it is."""
        for post in self.posts.values():
            if not post.recorded and post.status in ("posted", "unsure", "failed") and post.run:
                self._track(self._record(post))

    # --- kept with the conversation -------------------------------------------------

    def events(self) -> list[dict]:
        """For a page that has just opened the conversation."""
        out = [{"type": "phone_post", **p.event()} for p in self.posts.values()]
        job = self.job
        if job and job.active:
            out.append({"type": "phone_task", "id": job.id, "kind": job.kind, "status": job.status, "text": job.what,
                        "seconds": round(time.monotonic() - job.started),
                        **({"post": job.post.id} if job.post else {})})
        return out

    def dump(self) -> dict:
        return {"posts": [asdict(p) for p in self.posts.values()]}

    def restore(self, data: dict):
        self.posts = {p["id"]: PhonePost.load(p) for p in data.get("posts", [])}
        for p in self.posts.values():
            if p.status == "posting":  # the assistant stopped meanwhile
                if p.waiting or not p.task:
                    p.status, p.waiting, p.detail = "failed", False, "not posted: the assistant restarted before its turn"
                else:
                    p.status, p.detail = "unsure", "the assistant restarted while posting it; check before posting again"
        if self.client:
            self.replan_checks(self.posts.values())

    async def close(self):
        await super().close()
        if self.draining:
            self.draining.cancel()


def _fill(skill: Skill, values: dict[str, str]) -> str:
    text = skill.instructions
    for k, v in values.items():
        text = text.replace("{{" + k + "}}", v)
    return text


def _caption_block(lines: list[str]) -> str:
    if not lines:
        return "(no caption: leave the text box empty)"
    return "\n".join(f"{i}. {json.dumps(line)}" if line else f"{i}. (empty line)" for i, line in enumerate(lines, 1))


def _first_words(lines: list[str]) -> str:
    words = " ".join(" ".join(lines).split()[:8])
    return f'"{words}"' if words else "(no caption)"


def _json(text: str | None):
    try:
        return json.loads(text or "")
    except ValueError:
        m = re.search(r"\{.*\}", text or "", re.S)
        try:
            return json.loads(m.group(0)) if m else None
        except ValueError:
            return None

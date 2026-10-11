"""Our own agent for the team's phone: it looks at the screen and drives the phone itself.

The hackathon Phone API runs an agent of its own (POST /tasks), on the organisers' model account. This one
needs only the phone's direct controls (GET /phone/screenshot, POST /phone/tap, /phone/type, /phone/key,
/phone/swipe, /phone/app-start) and a vision model on our own Ollama account (PHONE_VISION_MODEL): each step
it takes a screenshot, asks the model what to do next towards the goal (the same phone skills,
skills/phone/*.md), and does it. No approvals stand in the way (we are the ones deciding), typing a line and
pressing Enter is one step, and a step takes a few seconds.

It speaks the API agent's language: run() yields the same events (step, action, result, status), so
backend/phone.py follows either one the same way (PHONE_DRIVER: direct, or agent for the API's).

A post it says is up is checked once more, independently, on the screen it ended on (like the API's pro
mode). If that look can't tell, it opens the profile and finds the post, only looking (CONFIRM), and that
screen is checked and kept as the proof; a post it can't find there is unsure rather than posted. Going back
and forth (the same few moves over and over) gets it told to try another way or stop (STUCK).
"""

import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncIterator
from typing import TYPE_CHECKING

from ollama import AsyncClient

if TYPE_CHECKING:
    from .phone import PhoneClient, PhoneJob

log = logging.getLogger(__name__)

SHOT_WIDTH = 720  # the model's view of the screen: legible, and a third of the pixels of the real one
PROOF_WIDTH = 1080
HISTORY = 14  # steps the model is reminded of
SETTLE_S = {"tap": 1.6, "long_press": 1.6, "open_app": 3.0, "key": 1.2, "swipe": 1.2, "type": 0.4}
INPUT_TRIES = 3
ACTION_GAP_S = 5.0  # at least this long between two inputs to the phone (PHONE_ACTION_GAP_SECONDS): one at a time
MODEL_TRIES = 3
KEYS = {"enter", "back", "home", "tab", "esc", "search"}
# Apps that, if the phone won't start them by name (it once allowed only a few system apps), are opened from the
# app list instead
APP_NAMES = {"com.instagram.android": "Instagram", "com.twitter.android": "X"}

FIND_APP = """This is an Android phone's app list. Where is the icon of the app named "{name}" (its label under it \
is exactly "{name}")? Reply with JSON only: {{"found": true or false, "x": 0.0, "y": 0.0}}, x and y as fractions of \
the screenshot's width and height (0.5, 0.5 is the centre)."""
SCREEN_CHANGERS = {"tap", "long_press", "open_app", "swipe"}  # the screen may be another one after these

SYSTEM = """You operate an Android phone to do a task, one step at a time. Each turn you get the task, what \
you did so far, and a screenshot of the phone's screen now.

Reply with one JSON object and nothing else:
{"evaluation": "did the last step work, in a few words",
 "next_goal": "what you do now, in a few words",
 "actions": [ ...1 to 6 actions, done in this order... ]}

Actions:
{"tap": [x, y], "label": "the text or icon you tap"}   x and y as fractions of the screenshot's width and
                                                      height, 0.0 to 1.0, three decimals (0.5, 0.5 is the centre)
{"long_press": [x, y], "label": "..."}
{"type": "text"}            types into the field that has the keyboard; plain ASCII only, no line breaks
{"key": "enter"}            or "back", "home", "tab", "esc", "search"
{"swipe": "up", "distance": "medium"}   up, down, left or right; short, medium or long (up scrolls the content down)
{"open_app": "com.instagram.android"}   opens an app by its package name (com.twitter.android is X)
{"wait": 2}                 seconds, at most 10, e.g. while something uploads
{"done": true, "success": true, "text": "your report", "data": {}}   when the task is finished, or can't be done

Rules:
- Tap only what you can see on this screenshot, at its centre.
- A tap that opens something ends the list: you see the new screen next turn. Tapping a text field and then
  typing in it, or several lines of typing with "enter" between them, can go in one list.
- If a pop-up or dialog is in the way, deal with it first ("Not now", "Cancel", "OK", the X), unless the task
  says otherwise.
- While making a post, press "back" only where the task says to (in an editor it can close the post); to get
  past a suggestion list, keep going or tap another part of the screen. A dialog asking to save or discard the
  post or a draft ("Save post?", "Discard?") means you left it by mistake: tap "Cancel" or "Keep editing",
  never Save or Discard.
- Do only what the task asks, in the apps it names. Never type a password. Never buy or pay for anything, delete
  anything, change settings or account details, or send messages, comments, likes or follows, unless the task
  says exactly that. If the task needs one of these and doesn't say so, or something needs a login, stop: report
  it with done and success false.
- Check the screen before reporting: success true only when the screen shows the task is done.
- Be quick: no extra steps once the task is done."""

VERIFY = """This is the screen of the team's phone right after it was asked to publish {what}. Does this screen \
show that it is published? Yes when it shows that post itself, out of the editor: in the feed, the Reels feed, \
the profile or the post's own page, under the phone's own account with the caption's first words (a reel may be \
playing); or a "Posted", "Your reel was shared" or "Your post was sent" message; or an upload bar that finished. \
No when it shows a compose, caption, editing or share screen, an upload still going, an error, or another post.
Reply with JSON only: {{"verified": true or false, "why": "what the screen shows, in one sentence"}}"""

# When that look can't tell: find the post on the profile, only looking
CONFIRM = """Check that {what} is now published on this phone's account, only by looking. Open the app's profile \
(Instagram: your profile picture at the far right of the bottom bar; X: your picture at the top left, then \
Profile). For a reel, open the Reels tab (the film icon above the grid). The newest one should be it: open it and \
check its caption's first words. Never tap Share, Post or anything that publishes, likes, comments or changes \
something. Report with done: success true if you found it published (and leave it open on screen), false if not."""
CONFIRM_STEPS = 8
STUCK = ("Note: your last steps went back and forth without getting anywhere. Look at the screen afresh and try "
         "another way; if what you need isn't there, report done with success false and say what you see.\n")


class VisionModel:
    """A vision model on Ollama (our account), asked for one JSON answer about a screenshot."""

    def __init__(self, host: str, api_key: str, model: str):
        self.client = AsyncClient(host=host, headers={"Authorization": f"Bearer {api_key}"} if api_key else None)
        self.model = model

    async def ask(self, system: str | None, text: str, image: bytes) -> dict:
        messages = ([{"role": "system", "content": system}] if system else []) + \
                   [{"role": "user", "content": text, "images": [image]}]
        last = None
        for attempt in range(1, MODEL_TRIES + 1):
            try:
                r = await self.client.chat(model=self.model, messages=messages, think=False,
                                           options={"temperature": 0.1})
                answer = _json(r.message.content or "")
                if isinstance(answer, dict):
                    return answer
                last = f"no JSON in its answer: {(r.message.content or '')[:120]!r}"
                messages.append({"role": "assistant", "content": r.message.content or ""})
                messages.append({"role": "user", "content": "Answer with the one JSON object only."})
            except Exception as exc:  # the model's service: busy, down, out of quota
                last = f"{exc.__class__.__name__}: {exc}"[:300]
                await asyncio.sleep(2 * attempt)
        raise RuntimeError(f"the vision model ({self.model}) didn't answer: {last}")


class DirectDriver:
    """Runs a goal on the phone with its direct controls, one look and a few actions at a time."""

    def __init__(self, client: "PhoneClient", model: VisionModel, verify_posts: bool = True,
                 gap_s: float | None = None):
        self.client, self.model, self.verify_posts = client, model, verify_posts
        self.gap_s = ACTION_GAP_S if gap_s is None else gap_s
        self.size = (1080, 2400)  # the screen, in pixels (GET /phone/geometry)
        self.last_input = 0.0  # when the last input went to the phone (monotonic)

    async def ready(self):
        try:
            g = await self.client.call("GET", "/phone/geometry")
            self.size = (int(g["w"]), int(g["h"]))
        except Exception as exc:
            log.warning("the phone's screen size isn't known (%s); taking %sx%s", exc, *self.size)

    # --- the phone's controls ---------------------------------------------------------

    async def shot(self, width: int = SHOT_WIDTH) -> bytes:
        from .phone import PhoneError
        for attempt in range(1, INPUT_TRIES + 2):
            image = await self.client._image("/phone/screenshot", params={"format": "jpeg", "max_width": width})
            if image:
                return image
            await asyncio.sleep(1.1 * attempt)  # one screenshot a second, and the odd 502
        raise PhoneError("the phone's screen can't be read (GET /phone/screenshot keeps failing)")

    async def input(self, path: str, body: dict) -> dict:
        """One input, at least gap_s after the one before (the phone gets one thing at a time, calmly), tried
        again on a hiccup; a PhoneError that stays is the phone dropping out."""
        from .phone import PhoneError
        for attempt in range(1, INPUT_TRIES + 1):
            if (wait := self.last_input + self.gap_s - time.monotonic()) > 0:
                await asyncio.sleep(wait)
            self.last_input = time.monotonic()
            try:
                return await self.client.call("POST", path, json=body) or {}
            except PhoneError as exc:
                if attempt == INPUT_TRIES or "VALIDATION" in str(exc).upper() or "422" in str(exc):
                    raise
                log.info("phone %s %s: %s; again", path, body, exc)
                await asyncio.sleep(1.5 * attempt)
        return {}

    def _point(self, xy) -> tuple[int, int]:
        """The model's point on the screen, in pixels. Asked for fractions, it sometimes drifts to thousandths
        or to the screenshot's pixels: each is told apart by its range."""
        x, y = (float(v) for v in xy[:2])
        w, h = self.size
        shot_w, shot_h = SHOT_WIDTH, SHOT_WIDTH * h / w
        if x <= 1 and y <= 1:
            fx, fy = x, y
        elif x <= 1000 and y <= 1000 and not (y > shot_h * 0.7 and x <= shot_w):
            fx, fy = x / 1000, y / 1000
        else:
            fx, fy = x / shot_w, y / shot_h
        return max(0, min(w - 1, round(fx * w))), max(0, min(h - 1, round(fy * h)))

    async def act(self, a: dict) -> tuple[str, dict, str]:
        """Does one action: its name, its params (for the record) and what it settled for."""
        if "tap" in a or "long_press" in a:
            name = "tap" if "tap" in a else "long_press"
            x, y = self._point(a[name])
            label = str(a.get("label") or "")[:80]
            if name == "tap":
                await self.input("/phone/tap", {"x": x, "y": y})
            else:
                await self.input("/phone/long-press", {"x": x, "y": y, "ms": 1000})
            return name, {"x": x, "y": y, **({"element": f"'{label}'"} if label else {})}, name
        if "type" in a:
            text = str(a["type"])[:1000]
            if text:
                await self.input("/phone/type", {"text": text})
            return "type", {"text": text}, "type"
        if "key" in a:
            key = str(a["key"]).lower()
            if key not in KEYS:
                raise ValueError(f"no key {key!r}")
            await self.input("/phone/key", {"key": key})
            return "key", {"key": key}, "key"
        if "swipe" in a:
            direction = str(a["swipe"]).lower()
            distance = str(a.get("distance") or "medium").lower()
            await self.input("/phone/swipe", {"direction": direction,
                                              "distance": distance if distance in ("short", "medium", "long") else "medium"})
            return "swipe", {"direction": direction, "distance": distance}, "swipe"
        if "open_app" in a:
            package = str(a["open_app"])
            await self.open_app(package)
            return "open_app", {"package": package}, "open_app"
        if "wait" in a:
            seconds = max(0.0, min(float(a["wait"] or 0), 10.0))
            await asyncio.sleep(seconds)
            return "wait", {"seconds": seconds}, ""
        raise ValueError(f"unknown action {json.dumps(a)[:100]}")

    async def open_app(self, package: str):
        """By its package name when the phone allows it, else from the app list: home, swipe up, its icon."""
        from .phone import DROPPED, PhoneError
        name = APP_NAMES.get(package)
        try:
            await self.input("/phone/app-start", {"package": package})
            return
        except PhoneError as exc:
            if not name or DROPPED.search(str(exc)):
                raise
            log.info("the phone won't start %s by name (%s): opening it from the app list", package, exc)
        await self.input("/phone/key", {"key": "home"})
        await asyncio.sleep(1.0)
        for swipe in ("medium", "long"):
            await self.input("/phone/swipe", {"direction": "up", "distance": swipe})
            await asyncio.sleep(1.4)
            found = await self.model.ask(None, FIND_APP.format(name=name), await self.shot())
            if found.get("found") and found.get("x") is not None:
                x, y = self._point([found["x"], found["y"]])
                await self.input("/phone/tap", {"x": x, "y": y})
                return
            await self.input("/phone/key", {"key": "home"})
            await asyncio.sleep(1.0)
        raise PhoneError(f"VALIDATION: the {name} app isn't in the phone's app list")

    # --- a goal -------------------------------------------------------------------------

    async def run(self, job: "PhoneJob", goal: str, max_steps: int, schema: dict | None = None,
                  check: str | None = None) -> AsyncIterator[dict]:
        """The goal, done on the phone: yields the API agent's events. check: what a post that went up looks
        like. The screen it ended on is looked at once more, independently; if that look can't tell, it opens
        the profile to find the post (CONFIRM), so the proof shows the post itself."""
        from .phone import PhoneError
        seq = 0

        def event(kind: str, **data) -> dict:
            nonlocal seq
            seq += 1
            return {"seq": seq, "type": kind, "data": data}

        task = goal + ("\n\nWhen you report with done, put the answer in data, as JSON matching this schema:\n"
                       + json.dumps(schema) if schema else "")
        started = time.monotonic()
        try:
            end: dict = {}
            async for e in self._loop(job, task, max_steps, event, end):
                yield e
            finish, n = end.get("done"), end.get("n", max_steps)
            if finish is None:
                job.shot = await self.shot(PROOF_WIDTH)
                yield event("status", status="failed", detail=f"it ran out of steps ({max_steps}) before the task "
                                                               "was done")
                return
            success = bool(finish.get("success", True))
            text = str(finish.get("text") or "").strip() or ("done" if success else "it couldn't be done")
            data = finish.get("data") if isinstance(finish.get("data"), dict) else None
            if success and check and self.verify_posts and not await self._verify(job, check):
                first = job.verdict
                looked: dict = {}
                async for e in self._loop(job, CONFIRM.format(what=check), CONFIRM_STEPS, event, looked, n):
                    yield e
                n = looked.get("n", n)
                found = bool((looked.get("done") or {}).get("success"))
                success = found and await self._verify(job, check)
                if not found:
                    job.shot = await self.shot(PROOF_WIDTH)
                if not success:
                    job.verdict = f"{first} Then on the profile: {job.verdict if found else 'not found'}"
            elif not (success and check and self.verify_posts):
                job.shot = await self.shot(PROOF_WIDTH)
            yield event("result", success=success, text=text, data=data)
            yield event("status", status="succeeded")
            log.info("direct phone run: %s in %d steps, %d s", "done" if success else "not done", n,
                     round(time.monotonic() - started))
        except PhoneError as exc:
            yield event("status", status="failed", detail=str(exc))
        except RuntimeError as exc:  # the vision model
            yield event("status", status="failed", detail=str(exc))

    async def _loop(self, job: "PhoneJob", task: str, max_steps: int, event, end: dict,
                    first: int = 0) -> AsyncIterator[dict]:
        """Look, decide, act, until the model reports done (end["done"], at step end["n"]) or the steps run out.
        Steps are numbered on from `first`; after the task's own (a CONFIRM), its actions are marked as looking."""
        from .phone import DROPPED, PhoneError
        history: list[str] = []
        moves: list[str] = []  # each step's actions in short, to notice going back and forth
        for i in range(1, max_steps + 1):
            n = first + i
            screen = await self.shot()
            job.shot = screen
            so_far = "\n".join(history[-HISTORY:]) or "(nothing yet: this is the first step)"
            stuck = STUCK if len(moves) >= 4 and len(set(moves[-4:])) <= 2 else ""
            reply = await self.model.ask(SYSTEM, f"The task:\n{task}\n\nWhat you did so far:\n{so_far}\n{stuck}\n"
                                                 f"Step {i} of at most {max_steps}. The screen now (points as "
                                                 "fractions, 0.0 to 1.0):", screen)
            goal_now = str(reply.get("next_goal") or "")[:300]
            yield event("step", n=n, next_goal=goal_now, evaluation=str(reply.get("evaluation") or "")[:300])
            actions = reply.get("actions")
            actions = actions if isinstance(actions, list) else [reply] if "done" in reply else []
            done_list, finish, move = [], None, []
            for a in actions[:6]:
                if not isinstance(a, dict):
                    continue
                if a.get("done"):
                    finish = a
                    break
                try:
                    name, params, settle = await self.act(a)
                    ok, error = True, None
                except (ValueError, TypeError, KeyError) as exc:
                    name, params, settle, ok, error = str(next(iter(a), "?")), {}, "", False, str(exc)
                except PhoneError as exc:
                    if DROPPED.search(str(exc)):
                        raise
                    name, params, settle, ok, error = str(next(iter(a), "?")), {}, "", False, str(exc)
                yield event("action", n=n, name=name, params=params, ok=ok, error=error, **({"look": True} if first else {}))
                done_list.append(f"{name} {json.dumps(params)[:90]}" + ("" if ok else f" FAILED: {error}"))
                move.append(_move(name, params))
                if settle:
                    await asyncio.sleep(SETTLE_S.get(settle, 1.0))
                if not ok or name in SCREEN_CHANGERS and not _typing_follows(actions, a):
                    break  # the screen may have changed: look again before doing more
            history.append(f"{i}. {goal_now} -> " + ("; ".join(done_list) or "no action"))
            moves.append(" ".join(move))
            if finish is not None:
                end["done"], end["n"] = finish, n
                return
        end["n"] = first + max_steps

    async def _verify(self, job: "PhoneJob", check: str) -> bool:
        """An independent look at the screen it ended on, like the API's pro mode: job.verdict says what it saw."""
        await asyncio.sleep(2)  # the upload's last moment
        job.shot = await self.shot(PROOF_WIDTH)
        try:
            answer = await self.model.ask(None, VERIFY.format(what=check), job.shot)
        except RuntimeError as exc:
            job.verdict = f"not checked: {exc}"
            return True  # the agent's word stands
        job.verdict = str(answer.get("why") or "")[:500]
        return bool(answer.get("verified"))


def _move(name: str, params: dict) -> str:
    """An action in short (taps to the nearest 100 px), to tell when the same few repeat."""
    if name in ("tap", "long_press"):
        return f"{name}@{round(params.get('x', 0), -2)},{round(params.get('y', 0), -2)}"
    return f"{name}:{params.get('direction') or params.get('key') or params.get('package') or ''}"


def _typing_follows(actions: list, a: dict) -> bool:
    """A tap on a text field followed by typing: the typing goes with it."""
    i = actions.index(a)
    rest = actions[i + 1:i + 2]
    return "tap" in a and bool(rest) and isinstance(rest[0], dict) and ("type" in rest[0] or "key" in rest[0])


def _json(text: str):
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```\w*\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except ValueError:
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            return json.loads(text[start:end + 1])
        except ValueError:
            return None

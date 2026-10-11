"""Reposts from X to Instagram: a post on X, redesigned here, and posted on Instagram from the team's phone.

FlowAI's Reposts (RepostController) reads a post by its link: its author, text and pictures, saved to the
gallery. The assistant brings those here, makes a new picture from the post's (redesign_picture: an image
model in FlowAI, given the post's picture as its reference; it runs in the background and the assistant is
told when it's ready), writes a fresh caption in the account's voice, and puts both in an Instagram draft.

Nothing goes anywhere until the person says so. repost_to_instagram uploads the draft's slides and asks on
screen (an Approval of kind repost). The Approve click, made by the page with the person's own session,
records that reusing the post is allowed (POST /api/reposts/{id}/permission, never the assistant's) and
books it (POST /api/reposts/{id}/schedule): an approved post on the Instagram account, credited to the
author, which the phone publishes at its time (backend/publisher.py).
"""

import asyncio
import logging
import mimetypes
from datetime import datetime, timedelta, timezone

from .comfyui import ComfyError
from .flowai import Approval, FlowAIError, FlowAISession, _slug
from .studio import StudioError, _number

log = logging.getLogger(__name__)

READ_SECONDS = 90  # how long FlowAI gets to read a post
REDESIGN_MINUTES = 8  # how long an image model gets for a picture
MODEL = "higgsfield/grok-image-2"  # takes the post's picture as a reference
MODELS = {"higgsfield/grok-image-2": "3:4", "higgsfield/ideogram-4": "4:5", "higgsfield/soul": "3:4"}  # -> its shape
NOW_WORDS = ("", "now", "asap", "right away", "immediately", "soon", "queue", "slot")
SOON = timedelta(minutes=2)  # "now": the phone takes it at FlowAI's next round

_tasks: set[asyncio.Task] = set()  # redesigns being waited on


def prompt(fa: FlowAISession) -> str:
    if not any(a["platform"] == "instagram" for a in fa.accounts.values()):
        return ""
    picked = [f"- repost {i}: @{r['author']}'s X post, {r['status']}" for i, r in fa.reposts.items()]
    return (
        "\n\nReposting from X: when the user wants a post from X on Instagram, call fetch_x_post with its link "
        "(x.com/…/status/…). If they only describe it, find it in the phone's X app with phone_task and ask it for "
        "the post's link first. Then redesign it, never repost it as it is: make a new picture from the post's "
        "picture with redesign_picture (say what the new visual looks like, keeping what the post is about; with no "
        "picture it makes one from your words), and write a fresh Instagram caption in the account's voice from "
        "what the post says, not a copy of it. Leave out any credit line: FlowAI adds “Credit: @author on X” "
        "itself. When the picture is ready, put it and the caption in an Instagram feed draft (create_draft), "
        "add text on it if it helps, and show it. After the user's changes, call repost_to_instagram with the "
        "repost and the draft: the user approves it on screen, which also records that reusing the post is "
        "allowed. Nothing is booked or posted before that. Once approved, the team's phone posts it on Instagram "
        "by itself at its time."
        + ("\nPicked in this conversation:\n" + "\n".join(picked) if picked else "")
    )


# --- tools --------------------------------------------------------------------------

async def fetch(fa: FlowAISession, url: str, account=None) -> dict:
    """An X post read by FlowAI, its pictures brought here, numbered like the others."""
    try:
        if account in (None, ""):  # several Instagram accounts: the one the phone posts from, when only one does
            ready = [a for a in fa.accounts.values() if a["platform"] == "instagram" and _posts_from_phone(a)]
            account = ready[0]["id"] if len(ready) == 1 else None
        acct = fa._account("instagram", account)
        r = await fa.client.request("POST", "/api/reposts", json={"account_id": acct["id"], "source_url": str(url).strip()})
        r = await _read(fa, r)
    except (StudioError, FlowAIError) as exc:
        return {"error": str(exc)}
    fa.reposts[r["id"]] = {"author": r.get("author") or "?", "status": "picked"}
    if r["status"] == "fetching":
        return {"error": f"FlowAI is still reading the post (repost {r['id']}); ask again in a minute"}
    if r["status"] == "failed":
        fa.reposts[r["id"]]["status"] = "couldn't be read"
        return {"error": f"FlowAI couldn't read that post: {r.get('error')}"}
    numbers = []
    try:
        for i, m in enumerate(r.get("media") or [], 1):
            data = await fa.client.request("GET", m["url"])
            item = await fa.media.add(data, f"x-{r['author'] or 'post'}-{i}{_ext(data, m['kind'])}", m["kind"], "flowai")
            item.meta = {"asset": m["id"]}
            numbers.append(f"{m['kind']} number {item.id}")
    except FlowAIError as exc:
        return {"error": f"the post's pictures couldn't be brought here: {exc}"}
    reply = {"repost": r["id"], "author": f"@{r.get('author')}", "text": r.get("source_text") or "(no text)",
             "media": numbers or "none: redesign_picture makes one from your words",
             "to": f"Instagram @{acct['handle']}",
             "next": "redesign the picture and write a new caption, then an Instagram draft; the user approves it"}
    if not _posts_from_phone(acct):
        reply["warning"] = (f"@{acct['handle']} has no phone with automation on in FlowAI, so it won't go out by "
                            "itself: tell the user to link the phone on the Accounts page")
    return reply


async def redesign(fa: FlowAISession, instruction: str, media=None, model: str | None = None) -> dict:
    """A new picture from a picture here (or from words alone), made by an image model in FlowAI."""
    model = model if model in MODELS else MODEL
    try:
        item = fa.media.item(media, "image") if media not in (None, "") else None
        asset = ((item.meta or {}).get("asset") or await _upload(fa, item)) if item else None
        gen = await fa.client.request("POST", "/api/generations", json={
            "kind": "image", "model": model, "prompt": str(instruction)[:4000],
            "params": {"aspect_ratio": MODELS[model]}, **({"input_asset_ids": [asset]} if asset else {})})
    except (ComfyError, FlowAIError) as exc:
        return {"error": str(exc)}
    gen = gen.get("data", gen)
    task = asyncio.create_task(_wait(fa, gen["id"], item.id if item else None))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return {"redesign": gen["id"], "status": f"being made in the background with {gen.get('model_label') or model}, "
                                             "usually under a minute",
            "note": "you are told when it's ready and its number; don't check on it"}


async def ask(fa: FlowAISession, repost, draft=None, when=None) -> dict:
    """The Approve card: reuse allowed, and the draft booked on Instagram at a time."""
    try:
        d = fa.studio.get(draft)
        if d.platform != "instagram":
            raise StudioError(f"draft {d.id} is {d.a_label}; a repost goes to Instagram, so make an Instagram draft")
        fails = [c["detail"] for c in d.check.get("checks", []) if c["status"] == "fail"]
        if fails:
            raise StudioError(f"{d.a_label} can't be posted until this is fixed: {'; '.join(fails)}")
        if not d.caption.strip():
            raise StudioError(f"draft {d.id} has no caption yet")
        if not d.files:
            raise StudioError("Instagram needs a picture or video: put the redesigned picture in the draft")
        at = _at(fa, when)
        r = await _get(fa, _number(repost))
        if r["status"] == "scheduled":
            raise StudioError(f"repost {r['id']} is already booked, as post {r.get('post_id')}")
        if r["status"] != "captured":
            raise StudioError(f"repost {r['id']} is {r['status']}, so it can't be booked")
        ids, previews = await _upload_draft(fa, d)
    except (StudioError, FlowAIError) as exc:
        return {"error": str(exc)}
    author, handle = r.get("author") or "the author", (r.get("account") or {}).get("handle", "")
    text = (f"Repost @{author}’s X post on Instagram" + (f" @{handle}" if handle else "") + f", {fa._local(at)}. "
            f"Approving also records that you may reuse it; the caption credits @{author}.")
    if not (r.get("account") or {}).get("posts_from_phone", True):
        text += f" Heads up: @{handle} has no phone with automation on, so it won't go out until you link one on Accounts."
    a = await fa._approval(d, text, kind="repost", repost=r["id"], when=at, payload={
        "caption": d.caption, "asset_ids": ids, "previews": previews, "author": author, "placement": d.placement,
        "source_url": r.get("source_url"), "note": f"Approved in the assistant: @{author}’s post, redesigned and credited"})
    fa.reposts[r["id"]] = {"author": author, "status": "waiting for the user's approval"}
    return {"approval": a.id, "status": "waiting for the user to approve it on screen", "asks": text,
            "note": "nothing is booked until the user presses Approve; you will be told"}


async def decide(fa: FlowAISession, a: Approval, done: bool):
    """The person approved the repost; the page already allowed it and booked it with their session."""
    if not done:
        a.status, a.detail = "failed", "Approve it on FlowAI's page: allowing the reuse is yours, not the assistant's."
        await fa._send_approval(a)
        return
    try:
        r = await _get(fa, a.repost)
        if r["status"] != "scheduled" or not r.get("post_id"):
            raise FlowAIError(f"repost {a.repost} is {r['status']}, not booked")
        post = await fa.client.get(f"/api/posts/{r['post_id']}")
    except FlowAIError as exc:
        a.status, a.detail = "failed", str(exc)
        await fa._send_approval(a)
        fa.notify(f"Booking the repost failed: {exc}. Tell the user briefly.")
        return
    post = post.get("data", post)
    when = fa._local(post.get("scheduled_at"))
    a.post, a.status, a.detail = r["post_id"], "approved", f"Booked for {when}"
    fa.reposts[r["id"]] = {"author": r.get("author") or "?", "status": f"booked as post {a.post} for {when}"}
    await fa._send_approval(a)
    await fa.send_posts()
    fa.notify(f"The user approved the repost: it is post {a.post} on Instagram, booked for {when}; the team's phone "
              "posts it then by itself. Tell them in a few words.")


# --- helpers ------------------------------------------------------------------------

async def _get(fa: FlowAISession, repost: int) -> dict:
    found = next((r for r in await fa.client.get("/api/reposts") or [] if r["id"] == repost), None)
    if not found:
        raise FlowAIError(f"there is no repost {repost} in FlowAI")
    return found


async def _read(fa: FlowAISession, r: dict) -> dict:
    """Until FlowAI has read the post (or given up)."""
    deadline = asyncio.get_running_loop().time() + READ_SECONDS
    while r["status"] == "fetching" and asyncio.get_running_loop().time() < deadline:
        await asyncio.sleep(2)
        r = await _get(fa, r["id"])
    return r


async def _wait(fa: FlowAISession, generation: int, source: int | None):
    """A redesign until it's made: the new picture here, and the assistant told."""
    conv, media = fa.conv, fa.media  # the conversation it was asked in, even if another opens meanwhile
    deadline = asyncio.get_running_loop().time() + REDESIGN_MINUTES * 60
    what = f"number {source}" if source else "your words"
    try:
        while True:
            await asyncio.sleep(4)
            g = await fa.client.get(f"/api/generations/{generation}")
            g = g.get("data", g)
            if g["status"] in ("failed", "cancelled"):
                raise FlowAIError(g.get("error") or g["status"])
            if g["status"] == "succeeded":
                break
            if asyncio.get_running_loop().time() > deadline:
                raise FlowAIError(f"it took more than {REDESIGN_MINUTES} minutes")
        made = []
        for out in g.get("outputs") or []:
            if out.get("kind") != "image":
                continue
            data = await fa.client.request("GET", out["url"])
            ext = mimetypes.guess_extension(out.get("mime") or "") or _ext(data, "image")
            item = await media.add(data, f"redesign-{generation}{'.jpg' if ext == '.jpe' else ext}", "image", "generated")
            item.meta = {"asset": out["id"]}
            made.append(item.id)
        if not made:
            raise FlowAIError("the model gave back no picture")
    except FlowAIError as exc:
        conv.notify(f"Redesigning the picture from {what} failed: {exc}. Tell the user briefly; you can try "
                    f"another model ({', '.join(m for m in MODELS)}) or keep the post's own picture.")
        return
    except Exception:
        log.exception("redesign %s", generation)
        conv.notify(f"Redesigning the picture from {what} failed with an error. Tell the user briefly.")
        return
    numbers = " and ".join(map(str, made))
    conv.notify(f"The redesigned picture from {what} is ready: number {numbers}. Put it in the Instagram draft "
                f"(create_draft, or update_draft with media [{made[0]}]) with your caption, and show the user.")


async def _upload(fa: FlowAISession, item) -> int:
    """A picture made or attached here, into the FlowAI gallery, for an image model to start from."""
    data = await asyncio.to_thread(item.path.read_bytes)
    mime = mimetypes.guess_type(item.path.name)[0] or "image/png"
    uploaded = await fa.client.request("POST", "/api/assets", files=[("files[]", (item.path.name, data, mime))])
    fa.uploaded.add(uploaded[0]["id"])
    item.meta = {**(item.meta or {}), "asset": uploaded[0]["id"]}
    return uploaded[0]["id"]


async def _upload_draft(fa: FlowAISession, d) -> tuple[list[int], list[str]]:
    """The draft's slides as drawn: their asset ids and addresses, for the card to show what's approved."""
    files = []
    for i, (path, _) in enumerate(d.files, 1):
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        files.append(("files[]", (f"{_slug(d.title or 'repost')}-{i}{path.suffix}",
                                  await asyncio.to_thread(path.read_bytes), mime)))
    uploaded = await fa.client.request("POST", "/api/assets", files=files)
    ids = [a["id"] for a in uploaded]
    fa.uploaded.update(ids)
    return ids, [a.get("poster_url") or a["url"] for a in uploaded]


def _posts_from_phone(account: dict) -> bool:
    """FlowAI publishes an account's scheduled posts only from its linked phone, with automation on."""
    return bool(account.get("device_id") and account.get("automation"))


def _at(fa: FlowAISession, when) -> datetime:
    if str(when or "").strip().lower() in NOW_WORDS:
        return datetime.now(timezone.utc) + SOON
    return fa._when(when)


def _ext(data: bytes, kind: str) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ".webp"
    if data[4:8] == b"ftyp":
        return ".mp4"
    return ".jpg" if kind == "image" else ".mp4"

"""Creative Lab tools: the assistant builds and runs node graphs in FlowAI, on the canvas the user sees.

A Creative Lab project (FlowAI, App\\Services\\Lab) is a graph: nodes (a brief, media, a YouTube video, a writer,
a picture model, a cut, captions, a post...) joined from an output port to an input port. The page and the
assistant change it the same way, with operations (POST /api/projects/{id}/lab/ops), so whatever the assistant
adds or runs appears on the user's canvas as it happens. Running a node runs the nodes before it that need to
run first. The assistant's token only ever saves Post nodes as drafts: scheduling stays the user's, and so does
recording the permission to use someone's video.
"""

import json
import mimetypes

from .tools import tool

_PROJECT = {"type": "integer", "description": "The Creative Lab project's id; leave it out for the one open on screen"}


def _client(session):
    if not session.flowai:
        raise LabError("FlowAI isn't connected, so Creative Lab can't be reached")
    return session.flowai.client


class LabError(Exception):
    pass


def _project(session, project) -> int:
    pid = project or (getattr(session, "lab", None) or {}).get("project") or session.conv.project
    if not pid:
        raise LabError("no Creative Lab project is open: ask the user to open one (Creative Lab, then a project), "
                       "or pass project")
    return int(pid)


def _value(v: dict) -> str:
    """One output, in a few words."""
    t = v.get("type")
    if t == "text" and len(v.get("items") or []) > 1:
        return f"{len(v['items'])} pieces: " + json.dumps([i[:160] for i in v["items"][:6]], ensure_ascii=False)
    if t == "text":
        return json.dumps((v.get("text") or "")[:400], ensure_ascii=False)
    if t in ("image", "video", "audio"):
        ids = v.get("assets") or []
        return f"{len(ids)} {t}{'s' if len(ids) != 1 else ''} (assets {', '.join(map(str, ids[:6]))})" if ids else "empty"
    if t == "moments":
        return "; ".join(f"{m['n']}. {m['title']} ({m['start']:.0f}-{m['end']:.0f} s, score {m['score']})"
                         for m in (v.get("moments") or [])[:8])
    if t == "brief":
        b = v.get("brief") or {}
        return ", ".join(f"{k}: {b[k]}" for k in ("product", "offer", "cta", "tone", "style") if b.get(k)) or "empty"
    if t == "transcript":
        return f"{v.get('words')} words, {v.get('language') or '?'}"
    if t == "source":
        return f"video {v.get('title')!r}"
    if t == "post":
        return f"post {v.get('post_id')} ({v.get('status')})"
    return t or "?"


def _picked(edge: dict) -> str:
    """Which piece of text written in several (versions, lines) a line takes."""
    if edge.get("pick") is None:
        return ""
    return " (takes all)" if edge["pick"] == 0 else f" (takes #{edge['pick']})"


def _summary(payload: dict) -> dict:
    canvas, states = payload["canvas"], payload.get("nodes") or {}
    nodes = []
    for n in canvas["nodes"]:
        s = states.get(n["id"]) or {}
        item = {"id": n["id"], "type": n["type"], "status": s.get("status"), "runs": s.get("policy")}
        if n.get("label"):
            item["label"] = n["label"]
        params = {k: v for k, v in (n.get("params") or {}).items() if v not in (None, "", [], False)}
        if params:
            item["settings"] = params
        outs = {k: _value(v) for k, v in (s.get("outputs") or {}).items() if v}
        if outs:
            item["made"] = outs
        if s.get("status") == "failed" and s.get("failed"):
            item["error"] = s["failed"].get("error")
        if s.get("missing"):
            item["missing"] = s["missing"]
        if s.get("active"):
            item["progress"] = s["active"].get("stage")
        if s.get("post"):
            p = s["post"]
            item["post"] = {k: p.get(k) for k in ("id", "status", "scheduled_at", "post_url", "error")}
        nodes.append(item)
    edges = [f"{e['from']}.{e['out']} -> {e['to']}.{e['in']}{_picked(e)}" for e in canvas["edges"]]
    return {"project": payload["project"], "nodes": nodes, "lines": edges}


@tool(
    "lab_nodes",
    "The kinds of Creative Lab nodes: each one's type, what it does, its inputs (and the types they take), its outputs "
    "(and their types) and its settings. Read it before building a graph.",
    {"type": "object", "properties": {"group": {"type": "string", "description": "Only this group: source, text, image, "
                                                "video, audio, people, clip, finish"}}},
)
async def lab_nodes(session, group: str = ""):
    try:
        cat = getattr(session, "_lab_catalog", None) or await _client(session).get("/api/lab/catalog")
        session._lab_catalog = cat
    except Exception as exc:
        return {"error": str(exc)}
    out = {}
    for t, k in cat["nodes"].items():
        if group and k["group"] != group:
            continue
        out[t] = {
            "does": k["detail"], "runs": k["run"],
            "in": {p["name"]: "|".join(p["accepts"]) + ("*" if p.get("required") else "") + ("[]" if p.get("multi") else "")
                   for p in k["inputs"]},
            "out": {p["name"]: p["type"] for p in k["outputs"]},
            "settings": {f["key"]: (list(f["options"]) if f.get("options") else f["kind"]) for f in k["fields"]
                         if f["kind"] != "hidden"},
        }
    return {"nodes": out, "note": "in: * required, [] takes several. runs: auto (by itself), manual (Run), "
                                  "post (Save/Schedule), none (holds what it's given)"}


@tool(
    "lab_templates",
    "Ready-made Creative Lab graphs (Instagram post, carousel, talking reel, YouTube clips, dub, campaign pack...): "
    "their keys and what they make.",
)
async def lab_templates(session):
    try:
        cat = getattr(session, "_lab_catalog", None) or await _client(session).get("/api/lab/catalog")
        session._lab_catalog = cat
    except Exception as exc:
        return {"error": str(exc)}
    return {"templates": [{"key": t["key"], "name": t["name"], "makes": t["tagline"], "nodes": t["nodes"]}
                          for t in cat["templates"]]}


@tool(
    "lab_projects",
    "The user's Creative Lab projects (id, name, how many nodes), newest first.",
)
async def lab_projects(session):
    try:
        projects = await _client(session).get("/api/projects")
    except Exception as exc:
        return {"error": str(exc)}
    return {"projects": [{"id": p["id"], "name": p["name"], "nodes": p["nodes"]} for p in projects[:20]],
            "open": (getattr(session, "lab", None) or {}).get("project")}


_BRIEF_FIELDS = ("focus (a person, a product or a business), business, offer, usp (what makes it different), goal, "
                 "audience, pains (their problems and wishes), competitors, story, moments (real-life moments of use), "
                 "proof, faces (who appears), tone, wording (words to use or avoid), language, look (visual style and "
                 "colours), photos, channels, formats, cta, timing, rhythm, keydates, approval, budget")


@tool(
    "lab_new_project",
    "Start a Creative Lab project: a blank canvas guided by a campaign, opened on the user's screen. Run the campaign "
    "questions first (the creative-lab skill says how: 5 or 10 short questions, like a marketing agency), then pass "
    "interview with the answers, and photos with the pictures the user shared in this chat (their logo, the product, "
    "the people). The brief becomes the Brief node at the start, the photos Media nodes under it. Or campaign_id for "
    "a campaign that exists. template only when the user asks for one of lab_templates.",
    {"type": "object", "properties": {
        "name": {"type": "string", "description": "Leave it out to name it after what's promoted"},
        "interview": {"type": "object", "description": "The campaign questions' answers", "properties": {
            "depth": {"type": "string", "enum": ["quick", "full"], "description": "quick: 5 questions, full: 10"},
            "fields": {"type": "object", "description": "Short values (max 15 words) for these keys: " + _BRIEF_FIELDS +
                       ". Fill every key: what the user didn't say, suggest, ending the value with \" (suggested)\"."}},
            "required": ["fields"]},
        "photos": {"type": "array", "description": "Pictures shared in this chat", "items": {"type": "object", "properties": {
            "media": {"type": "integer", "description": "The picture's number in this conversation"},
            "kind": {"type": "string", "enum": ["logo", "product", "person", "place", "other"]}},
            "required": ["media", "kind"]}},
        "campaign_id": {"type": "integer", "description": "An existing FlowAI campaign"},
        "brief": {"type": "object", "description": "The brand's look, if the user gave more than the answers hold", "properties": {
            "palette": {"type": "array", "items": {"type": "string"}, "description": "Hex colours"},
            "style": {"type": "string", "description": "Visual style words"}, "avoid": {"type": "string"}}},
        "template": {"type": "string", "description": "A template key (lab_templates), only when asked for"},
    }},
)
async def lab_new_project(session, name: str = "", template: str = "", campaign_id: int | None = None,
                          interview: dict | None = None, photos: list | None = None, brief: dict | None = None,
                          campaign: dict | None = None):
    try:
        client = _client(session)
        shared = []
        for p in photos or []:
            item = session.media.items.get(int(p.get("media") or 0))
            if not item or item.kind != "image" or not item.path:
                return {"error": f"there is no picture {p.get('media')} in this conversation"}
            mime = mimetypes.guess_type(item.path.name)[0] or "image/png"
            up = await client.request("POST", "/api/assets", files=[("files[]", (item.name or item.path.name,
                                                                                 item.path.read_bytes(), mime))])
            shared.append({"asset_id": up[0]["id"], "kind": p.get("kind") or "other"})
        p = await client.request("POST", "/api/lab/projects", json={
            "name": name or None, "template": template or None, "campaign_id": campaign_id,
            "interview": interview or None, "photos": shared or None, "campaign": campaign or None,
            "brief": brief or None})
    except Exception as exc:
        return {"error": str(exc)}
    session.lab = {**(session.lab or {}), "project": p["project"]["id"], "node": None}
    session.conv.project = p["project"]["id"]
    session.conv.changed()
    await session.try_send(type="lab_open", project=p["project"]["id"])
    return {**_summary(p), "campaign": p.get("campaign_id"), "opened": "on the user's screen, in Creative Lab"}


@tool(
    "lab_graph",
    "The open Creative Lab project as it is: every node (its type, settings, status, what it made, why it can't run) "
    "and every line. Look before changing it, and after running to see results.",
    {"type": "object", "properties": {"project": _PROJECT}},
)
async def lab_graph(session, project: int | None = None):
    try:
        payload = await _client(session).get(f"/api/projects/{_project(session, project)}/lab")
    except Exception as exc:
        return {"error": str(exc)}
    out = _summary(payload)
    if (sel := (getattr(session, "lab", None) or {}).get("node")):
        out["selected_on_screen"] = sel
    return out


@tool(
    "lab_edit",
    "Change the Creative Lab graph, in operations applied in order (the user sees them on the canvas). Operations:\n"
    "- {\"op\":\"add\",\"node\":{\"id\":\"caption\",\"type\":\"text.write\",\"x\":400,\"y\":80,\"params\":{...},"
    "\"label\":\"...\"}} (id optional; x/y optional: a node is never put on top of another; end with a tidy)\n"
    "- {\"op\":\"set\",\"id\":\"caption\",\"params\":{\"task\":\"hook\"}} (merges settings)\n"
    "- {\"op\":\"connect\",\"from\":\"brief\",\"out\":\"brief\",\"to\":\"caption\",\"in\":\"brief\"} (out/in optional: "
    "the first that fits; pick optional, see below)\n"
    "- {\"op\":\"pick\",\"from\":\"captions\",\"to\":\"channel-2\",\"in\":\"caption\",\"pick\":2} (which piece of text "
    "written in several a line takes: 1, 2…, 0 all of it)\n"
    "- {\"op\":\"tidy\"} (lays the whole graph out in columns, chains on one row: do it after building)\n"
    "- {\"op\":\"disconnect\",\"to\":\"caption\",\"in\":\"brief\"}  {\"op\":\"remove\",\"id\":\"caption\"}\n"
    "- {\"op\":\"label\",\"id\":...,\"label\":...}  {\"op\":\"move\",\"id\":...,\"x\":..,\"y\":..}\n"
    "- {\"op\":\"branch\",\"id\":\"picture-1\"} (a copy of it and everything after it, to try another option)\n"
    "- {\"op\":\"pin\",\"id\":...,\"run\":<run id>|null} (use an older version)\n"
    "- {\"op\":\"insert\",\"template\":\"youtube-clips\",\"x\":80,\"y\":600} (a template's nodes, added)\n"
    "Several of a kind (three posts, three pictures): ONE Write node with params variants: 3 writes three different "
    "versions; each line out of it takes its own, #1, #2, #3 in the order you connect them (lines show '(takes #n)'). "
    "Asking a Write node with variants 1 for 'three captions' in its instructions gives one caption, not three. "
    "A video's lines (task lines) flow on whole; a line can pick one (pick: 2).\n"
    "Nothing runs by itself: nodes wait for Run (lab_run, once the user agrees, or yourself when they handed you control).",
    {"type": "object", "properties": {
        "ops": {"type": "array", "items": {"type": "object"}, "description": "The operations"},
        "project": _PROJECT,
    }, "required": ["ops"]},
)
async def lab_edit(ops: list, session, project: int | None = None):
    try:
        client = _client(session)
        pid = _project(session, project)
        expanded = []
        for op in ops:
            if op.get("op") == "insert" and op.get("template") and not op.get("graph"):
                cat = getattr(session, "_lab_catalog", None) or await client.get("/api/lab/catalog")
                session._lab_catalog = cat
                found = next((t for t in cat["templates"] if t["key"] == op["template"]), None)
                if not found:
                    return {"error": f"there is no template {op['template']!r}; see lab_templates"}
                op = {**op, "graph": found["graph"]}
            expanded.append(op)
        payload = await client.request("POST", f"/api/projects/{pid}/lab/ops", json={"ops": expanded})
    except Exception as exc:
        return {"error": str(exc)}
    await session.try_send(type="lab_changed", project=pid)  # the canvas shows it now, not at its next look
    out = _summary(payload)
    out["results"] = payload.get("results")
    return out


@tool(
    "lab_run",
    "Run a Creative Lab node (and the nodes before it that need to run first). Unless the user approved your plan "
    "or handed you control, it shows them a Run card on screen (what runs, how long, what it costs) and runs once "
    "they approve it: you are told. A Post node you run is saved as a draft only (a scheduled one goes back to a draft): "
    "lab_schedule asks to schedule it.",
    {"type": "object", "properties": {"node": {"type": "string"}, "project": _PROJECT}, "required": ["node"]},
)
async def lab_run(node: str, session, project: int | None = None):
    try:
        client = _client(session)
        pid = _project(session, project)
        plan = await client.get(f"/api/projects/{pid}/lab/nodes/{node}/plan")
        names = [n.get("label") or n.get("id") for n in plan.get("nodes") or []]
        takes, cost = f"about {plan.get('seconds')} seconds", plan.get("cost")
        if not (session.lab or {}).get("control") and not session.conv.plan_ok:
            a = await session.flowai.ask("run", f"Run {node}" + (f" and the {len(names) - 1} before it" if len(names) > 1 else ""),
                                         project=pid, node=node, items=names, takes=takes,
                                         cost=str(cost) if cost else "")
            return {"approval": a.id, "status": "waiting for the user to approve running it on screen",
                    "runs": names, "takes": takes, "cost": cost,
                    "note": "nothing runs until they press Approve; you are told"}
        await session.flowai.run_node(pid, node)
    except Exception as exc:
        return {"error": str(exc)}
    await session.try_send(type="lab_changed", project=pid)
    return {"started": names, "takes": takes, "cost": cost, "note": "it runs in the background, live on the canvas; you are told when it ends"}


@tool(
    "lab_schedule",
    "Ask the user to approve scheduling a Post node's post: it shows the post (picture or video, caption, account) "
    "in their review queue, and once they approve it, it is scheduled. The node must have run (saved as a draft) "
    "first. Ask again after changing a post the user asked to change.",
    {"type": "object", "properties": {
        "node": {"type": "string", "description": "The Post node"},
        "when": {"type": "string", "description": "Date and time in the user's time zone, e.g. 2026-10-16T09:00, or "
                                                  "\"queue\" for the account's next free posting time"},
        "project": _PROJECT,
    }, "required": ["node", "when"]},
)
async def lab_schedule(node: str, when: str, session, project: int | None = None):
    try:
        client = _client(session)
        pid = _project(session, project)
        at = session.flowai._when(when)
        payload = await client.get(f"/api/projects/{pid}/lab")
        n = next((n for n in payload["canvas"]["nodes"] if n["id"] == node), None)
        if not n or n["type"] != "finish.post":
            return {"error": f"{node} isn't a Post node in project {pid}; see lab_graph"}
        post_id = ((payload.get("nodes") or {}).get(node, {}).get("post") or {}).get("id")
        if not post_id:
            return {"error": f"{node} hasn't saved its post yet: run it first (lab_run), then ask again"}
        post = await client.get(f"/api/posts/{post_id}")
        post = post.get("data", post)
    except Exception as exc:
        return {"error": str(exc)}
    asset = next(iter(post.get("assets") or []), None)
    acct = post.get("account") or {}
    what = (n.get("label") or post.get("title") or node) + (f" (@{acct['handle']})" if acct.get("handle") else "")
    text = f"Schedule “{post.get('title') or what}”" + (f" for @{acct['handle']}" if acct.get("handle") else "") + \
           f" for {session.flowai._local(at) if at else 'the next free time in the queue'}"
    preview = {"url": asset and asset.get("url"), "poster": asset and asset.get("poster_url"),
               "kind": asset and asset.get("kind"),
               "caption": (post.get("body") or "").strip()[:400], "what": what, "post": post_id}
    a = await session.flowai.ask("lab_post", text, project=pid, node=node, when=at, post=post_id, preview=preview)
    return {"approval": a.id, "status": "waiting for the user to approve it on screen", "asks": text,
            "note": "nothing is booked until the user presses Approve; you are told"}


@tool(
    "lab_stop",
    "Stop a Creative Lab node that is running.",
    {"type": "object", "properties": {"node": {"type": "string"}, "project": _PROJECT}, "required": ["node"]},
)
async def lab_stop(node: str, session, project: int | None = None):
    try:
        pid = _project(session, project)
        await _client(session).request("POST", f"/api/projects/{pid}/lab/nodes/{node}/stop")
    except Exception as exc:
        return {"error": str(exc)}
    await session.try_send(type="lab_changed", project=pid)
    return {"stopped": node}


@tool(
    "lab_youtube",
    "Read a YouTube video's details (title, channel, length, licence) without downloading it, for a YouTube node. "
    "Then set the node's url and source_id. Recording the permission to use it is the user's, on the node.",
    {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
)
async def lab_youtube(url: str, session):
    try:
        s = await _client(session).request("POST", "/api/lab/youtube/inspect", json={"url": url})
    except Exception as exc:
        return {"error": str(exc)}
    return {"source_id": s["id"], "title": s["title"], "channel": s["channel"], "seconds": s["duration"],
            "licence": s["license"], "permission": s["permission"],
            "note": "set the YouTube node's params url and source_id; the user records whose video it is on the node"}

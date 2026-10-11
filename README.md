# FlowAI — the AI Publishing Studio

Plan a campaign with AI agents, approve it at two human gates, and have it published
automatically from real phones — with proof every post went live.

The split: this repo is the **studio** (Laravel API + React dashboard). The
[publishing-agent](publishing-agent/) is the **automation worker** that drives the phones,
built on the [publishing-studio](publishing-studio/) device layer (adb or simulator).

## Run it (~5 minutes)

Needs Docker, an Ollama Cloud key (text) and the RunPod pod (`runpod/`: pictures, videos, voices,
transcripts, songs, lip sync, face swaps). Phones can be simulated end-to-end and still produce run records
with proof.

```sh
# 1. The stack: the dashboard (:5173), the API (Laravel, :8002), queue worker, scheduler,
#    the voice assistant (:8003, also the engine Creative Lab runs the pod's models through), Mailpit (:8025)
docker compose up -d

# 2. Demo data: demo user, two phones, Instagram + X accounts, photos
docker compose exec api php artisan db:seed --class=DemoSeeder

# 3. The two phone agents (simulator driver), each in its own shell
cd publishing-agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
FLOWAI_URL=http://127.0.0.1:8002 AGENT_TOKEN=demo-agent-token DEVICE_REF=ig-phone DRIVER=simulator .venv/bin/python agent.py
FLOWAI_URL=http://127.0.0.1:8002 AGENT_TOKEN=demo-agent-token DEVICE_REF=x-phone  DRIVER=simulator .venv/bin/python agent.py
```

Settings: one file, `.env` next to `docker-compose.yml` (`cp .env.example .env`), for the API, the worker, the
scheduler and the assistant alike. It takes `OLLAMA_CLOUD_API_KEY` (FlowAI's writer and the assistant's own model,
with `AI_DEFAULT_TEXT` and `AI_AGENTS_MODEL` set to an Ollama Cloud model, e.g. `ollama_cloud/glm-5.3-flash`),
`VOICESTUDIO_URL` and `VOICESTUDIO_KEY` (the pod's VoiceStudio: voices, the assistant's voice and, with Whisper
large-v3, transcripts), the pod's other URLs and keys (`COMFYUI_*`, `MUSIC_*`, `LIPSYNC_*`, `FACESWAP_*`), and
`ENGINE_URL` / `ENGINE_KEY` (the assistant's engine, `http://assistant:8000`; both sides read the same key).
docker compose mounts it into the API as `backend/.env`. The Models page (`/dashboard/models`) shows each
connector's settings, which are filled in, and whether the assistant has picked them up.

The first `up` takes a while: it builds the assistant (PyTorch) and downloads its speech models,
and the dashboard installs its packages. The assistant runs on the CPU. The GPU models run on a RunPod pod, deployed from `runpod/` in one command (`runpod/README.md`).
FlowAI Sound and local Ollama are off by default (`--profile local-sound`, `--profile local-ollama` to run them
here anyway). To run the dashboard outside Docker instead: `docker compose stop frontend`, then
`cd frontend && npm install && API_ORIGIN=http://localhost:8002 npm run dev`.

Sign in at http://localhost:5173 as **demo@flowai.test / password**.

## The full cycle, one command

Brief → agents plan → **gate 6A** → production → adaptation + QA → **gate 6B** →
schedule → phones publish → proof:

```sh
cd demo
../publishing-agent/.venv/bin/python run-demo.py            # fresh cycle (~5–10 min on CPU)
RESUME_CAMPAIGN=<id> ../publishing-agent/.venv/bin/python   # resume from gate 6B
```

Every stage is visible live in the dashboard: Campaigns (brief, plan, review), Calendar,
**Publishing** (run history, steps, evidence, JSON records), Phones, Inbox.

## Creative Lab

**Creative Lab** (`/dashboard/studio`, the only tab under Create) is where all content is made: every project is a
canvas of **nodes** joined from an output (right) to an input (left), with typed ports (picture, video, sound,
text, brief, moments, transcript, online video, where it goes, post), so only what fits connects.

- **Campaign first.** A new project starts with a short brief, asked like a marketing agency would: **Quick** (5
  questions) or **Thorough** (10), picked by the AI for what's promoted, the rest suggested. It asks for the logo
  and photos of the product and the people. Or start from a campaign you have, or a blank canvas. The brief
  becomes the **Brief** node at the start (its style goes into picture and video prompts, the Design node's
  colours and font, and how words are written; `{product}`, `{offer}`, `{cta}`… fill any prompt), and the photos
  Media nodes under it (Logo, The product, People).
- **The assistant** sits beside the home page and every canvas: it can ask the same questions in its chat (photos
  dropped there come along), make the project and build its nodes.
- **Nodes**: Media, Text, Brief, YouTube video; Write, Translate; Picture, Edit picture, Paint to change, Frame
  from video; Video, Animate picture, Moving pictures (zoom and pan with a voice), Reel look, Cut & reframe,
  Captions, Add sound, Join; Voiceover, Music, Transcript; Face swap, Dub (lip sync); Find moments; Design (words
  on pictures), **Where it goes** (an account and a kind of post: the media fitted to its shape and length, the
  caption to its rules) and **Post** (a draft, a date, the queue or now, from a phone; the run, its screenshot,
  the post's link and its numbers come back to the node).
- **Every model**: the pod's (Z-Image, FLUX.2 Klein, Wan 2.2, ACE-Step, LatentSync, inswapper, VoiceStudio and its
  Whisper) and the cloud's (Higgsfield, Gemini, Veo, the text models) in one picker per node, with its time and
  cost. Pod models run through the assistant's engine (`assistant/backend/engine.py`).
- **Running**: nothing runs until you press **Run** (each node says how long it takes and what it costs);
  **Run all** runs everything out of date. **Keep up to date** (per project, off by default) lets the quick, free
  nodes you've run once run again by themselves when what they use changes. Every run is kept as a version (pin
  an older one); **Branch** copies a node and everything after it to try another option.
- **Templates** by kind of content (a picture from a prompt across models, a picture with words, moving
  pictures, an animated picture, a talking portrait, dubbing, clips from a long video…), never by platform:
  where it goes is a node of its own before posting. **Save as template** keeps your own.
- **The assistant** is beside the canvas from the start and works on the same graph (`lab_` tools); **Let it take
  control** lets it build and run on its own. Scheduling, permissions and consent stay a person's.
- **YouTube clipping**: a YouTube node reads the video's details, and nothing downloads until a person records
  whose video it is (theirs, with permission, or Creative Commons; the credit goes into every caption). Then its
  sound and YouTube's captions (or Whisper on the pod), **Find moments** (the model quotes each moment; the
  times come from the timed words), and **Cut & reframe** downloads only that part (yt-dlp), crops it vertical
  around the speaker, and cuts out silences; Captions burn the words in as they're said.

## Flows and Storm Guard

**Flows** (`/dashboard/flows`) are automations on a canvas: one trigger (a schedule, an RSS
feed, a post going live or failing, a comment, Storm Guard tripping), then AI steps (write,
rewrite, score, draft a reply), logic (if, wait, bring back a past post), an **Ask me first**,
and actions (schedule a post, reply, freeze an account, stop button, teach the account, Inbox
note, webhook to Slack/Discord/Zapier). Start from one of six recipes, draw your own, or type
what you want in plain words and the AI builds it. **Run now** tests a flow with real data while
the canvas lights up step by step. The promise holds: a flow only schedules a post a person
approved in that run (one tap, from the Inbox); anything else is saved as a draft.

**Storm Guard** (on the Comments page) reads every comment's mood the moment it lands. When an
account's recent comments turn negative fast (default: 60%+ of 5+ comments in an hour), it
freezes that account's publishing on its own, puts it at the top of the Inbox, and starts any
flow listening for storms. Posts approved before the storm wait for your all clear; what you
approve during it (a holding statement) still goes out.

The scheduler runs `flows:tick` every minute (scheduled flows, finished waits, feeds every
15 minutes); flow runs go through the queue worker on the `agents` queue.

## Sound, reels and Mission Control

**FlowAI Sound** (`sound/`, a small Python service in both compose stacks) gives the studio a
voice and a soundtrack, on this server, with no keys:

- **Voiceovers** in 22 natural voices across English, French, Spanish, Italian, Portuguese and
  Hindi (Kokoro, Apache-2.0). Every word comes back timed (Whisper aligns the script), so captions
  follow the speech exactly.
- **Original music**: a generative composer writes and plays a new, licence-free track in one of
  six moods (Golden hour, Linen, Atelier, Pulse, Night drive, Bloom) every time.
- **Listening**: transcripts of podcasts, voice memos and videos (Whisper), then *Turn into
  posts* drafts the moments worth sharing; the mic button dictates anywhere you type.

**Reels** (Studio → Reels): a voice and/or a track, a photo, a video or a moving gradient, and a
look — *Bold* (big words that light up), *Editorial* (a magazine page you read along with) or
*Pulse* (an audiogram) — previewed live in a phone frame, then rendered with ffmpeg at
1080 × 1920 with the music stepping aside whenever the voice speaks.

**Clip from link** (`/dashboard/clips`) turns a public YouTube video or readable article into one
to eight captioned 1080 × 1920 TikTok or Instagram Reel drafts. It downloads and analyzes the
source once, then selects distinct 15–60 second video moments or writes several factual article
angles. Processing stays in the background, every source URL remains attached for review, and the
form requires confirmation that you have permission to republish it. No cloud API key is required:
ffmpeg, yt-dlp, FlowAI Sound, and the local model do the work.

Each account has a **sound** (voice, pace, signature music, reel accent; Accounts → Voice →
Sound). Flows use it in three new steps — *Read it aloud*, *Compose music*, *Make a reel* — and
the *Talking reel* recipe ties them together; a reel made in a run comes along when the post is
scheduled. The campaign media team uses it too: a video post with no video model becomes a
narrated, scored, captioned reel, and a film joined from shots gets the same sound pass.

**VoiceStudio** voices join in as an alternative to the local ones: point `VOICESTUDIO_URL` at a
VoiceStudio server (plus `VOICESTUDIO_KEY` when it isn't on loopback) and its cloned and designed
voices appear in every voice picker next to Kokoro's, with a `vs:` prefix on their ids. Anything
that reads a script — the Sound tab, flows, reels, campaign videos — routes a `vs:` voice to
VoiceStudio automatically; the local service stays the fallback and keeps the composer and the
listener. VoiceStudio doesn't time words, so captions for its voices are aligned by the listener
when a reel is rendered, the same way uploaded audio is treated.

**Mission Control** (`/dashboard/live`) is the wall: a split-flap departures board for the next
48 hours, the phones and what they're doing, flows at work, Storm Guard weather and the studio's
latest work, polled every few seconds, with a fullscreen mode for a screen in the room.

The Sound service is off by default now: voices come from VoiceStudio on the pod, transcripts from its
Whisper large-v3, and songs from ACE-Step. To run it here anyway: `docker compose --profile local-sound up -d sound`
and `SOUND_URL=http://sound:8000` in `.env`. It keeps one model in memory at a time and unloads when idle.

## The assistant

**Assistant** (`/dashboard/assistant`) is a voice agent you talk to, or type to. It makes Instagram and X
posts as drafts you watch take shape, changes them when you ask ("make the headline gold", "now
the same for X"), saves them as FlowAI drafts and books them once you approve. Everything it makes
can also be changed by hand on the page:
- **Draft:** the post as the platform shows it. Click a text to select it ("make this bigger"),
  double-click to rewrite it, drag slides to reorder them, drop a picture on a slide. The caption,
  styles and placement are in the panel beside it. Fonts come by style (modern, poster, elegant,
  handwritten, playful, retro, mono), each previewed in your words. A text's colours start with the picture's own,
  and the ones that would be hard to read where it sits are marked, next to looks that read well.
- **Part of a picture:** **Paint to change part of it**, paint over something, then remove it,
  replace it, change it or improve it, or just say "remove this". Only the painted part changes.
- **Video with voice:** a draft's pictures, one or several, become a reel. They slowly zoom and
  pan while a voice that suits the post reads a line over each, with captions, an instrumental
  song written for it (ACE-Step 1.5, `music/`; describe another, or pick one of FlowAI Sound's
  moods) and an end card ("Order now"). It's kept as its own draft, which can be made again.
- **Media:** the conversation's numbered pictures and your gallery.
- **Calendar:** your week. Drop a draft on a slot to book it there, or click an empty slot to ask for
  a post at that time.

The conversation stays open while you visit other pages, with a small dock to come back.

**Conversations are kept**, so you can run one per campaign or per client:
- **The list:** the icon at the top of the conversation lists them all, newest first. Start a
  new one, open, rename, delete or search them there.
- **Picking one up again:** each keeps its drafts, pictures and history. After a reload, or
  coming back days later, you're back where you were. A picture still being made lands in its
  own conversation, even after you've switched.
- **Open a campaign** (on the Assistant page, or **Open in the assistant** on a campaign) brings
  a campaign's posts in as drafts, one for each account's version. Change them by voice ("make
  every caption shorter") or by hand, then save. Saving changes the campaign itself. A changed
  version goes back to gate 6B, and you approve it right there; its booked times take the new
  version.

**The voice** is yours to pick, under the message box: any voice ready on the voice server, or one
of its catalog of over a thousand, searched by words like “british”, “deep” or “narration”, with ▶
to hear it first. Every sentence is said in that voice, in all your conversations, and it stays
picked after a reload.

It is its own service (`assistant/`, Python, on the CPU) and starts with the rest:

```sh
cp .env.example .env                          # once: OLLAMA_CLOUD_API_KEY at least
docker compose up -d                          # with VOICESTUDIO_URL set
```

The first start downloads its speech recognition model; its voice comes from VoiceStudio on the pod. The Vite proxy serves it at
`/assistant/`. It works as whoever opens the page: the page gets it a token
(`POST /api/assistant/session`) that can save drafts but not schedule. Approving on the page books
the post with your own session.

## Real phones

Same loop with a physical Android phone: log a **test** account into the app on the phone,
register the phone in the dashboard (HTTP phone, ref = `adb devices` serial), link the account
to it, then run the agent where the phone is reachable:

```sh
FLOWAI_URL=http://<studio>:8002 AGENT_TOKEN=… DEVICE_REF=<serial> DRIVER=adb .venv/bin/python agent.py
```

(On a remote VM, run the agent on the laptop the phone plugs into and tunnel the API:
`ssh -L 8002:127.0.0.1:8002 <server>`.)

**Scan and drive by hand.** With the phone plugged in (USB debugging on) and `adb start-server`
running on the machine, *Phones → Scan for phones* lists it and adds it in one click. **Live**
shows its screen and lets you touch, swipe, scroll and type into it. The live video comes from the
`phone-bridge` service: run `docker compose up -d phone-bridge`. It uses scrcpy's server (bundled
as `phone-bridge/scrcpy-server-v4.1`), runs at up to 60 fps, and sends touches straight to the
phone. Without the bridge, the view falls back to screenshots, about one a second. The controls
are locked while a publishing run is driving the phone. Both reach the host's adb server at
`host.docker.internal:5037`.

## Real models

Keys go in `.env`, then `docker compose restart api worker scheduler` (and `docker compose up -d` for the assistant):

| Provider | Variable | Notes |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | composer, campaign agents, intake are tuned for Claude |
| Groq | `GROQ_API_KEY` | free at console.groq.com/keys |
| OpenRouter | `OPENROUTER_API_KEY` | free at openrouter.ai/keys; picker lists `:free` models |
| Ollama Cloud | `OLLAMA_CLOUD_API_KEY` | the default writer (`ollama_cloud/glm-5.3-flash`); local Ollama: `--profile local-ollama` and `OLLAMA_URL` |
| Higgsfield | `HIGGSFIELD_KEY_ID` / `HIGGSFIELD_KEY_SECRET` | image + video generation |
| VoiceStudio | `VOICESTUDIO_URL` / `VOICESTUDIO_KEY` | the pod's voices, and transcripts once Whisper large-v3 is installed (`runpod/voicestudio/README.md`) |
| The assistant's engine | `ENGINE_URL` / `ENGINE_KEY` | Creative Lab's pod models and drawing (`http://assistant:8000`) |
| yt-dlp | `YTDLP_COOKIES` | optional: a cookies file, when YouTube asks the server to sign in |

`AI_DEFAULT_TEXT` and `AI_AGENTS_MODEL` choose which registry model writes and plans
(both point at `ollama_cloud/glm-5.3-flash`).

## Everyday commands

```sh
docker compose exec api php artisan test --testsuite=Feature   # backend tests (210)
docker compose exec api vendor/bin/pint         # PHP style
npm run build                                   # in frontend/: type-check + build
docker compose logs -f worker                   # queue log (agents, media, publishing)
docker compose exec api php artisan migrate     # after adding a migration
```

## Layout

- `backend/` — Laravel 13 API: campaigns, agents, scheduling, publishing engine, agent API (`/api/agent/*`)
- `frontend/` — React + Vite dashboard (`src/dashboard`)
- `publishing-agent/` — the phone-driving worker (`agent.py`, Python)
- `publishing-studio/` — the device layer it uses (adb + simulator, Instagram/X recipes, named targets)
- `sound/` — FlowAI Sound: voices, listening and the composer (Python, CPU; off by default, `--profile local-sound`)
- `runpod/` — everything on the GPU pod, deployed in one command (`runpod/deploy.sh`): ComfyUI (pictures and videos),
  VoiceStudio (voices), ACE-Step 1.5 (songs under videos; MIT), LatentSync (dubbed videos' lips; Apache-2.0) and
  face swaps (inswapper_128 and GFPGAN, ONNX).
  Music and lip sync also run here on a local GPU: `docker compose --profile music` / `--profile lipsync`
- `assistant/` — the voice assistant behind the Assistant page (Python, CPU; copied from the gamechange repo, where it's developed)
- `demo/` — the one-command full cycle
- `deploy/` — production stack for the VPS (nginx + PHP-FPM + Postgres)

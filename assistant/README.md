# Voice Agent

A real-time conversational agent: you talk, it listens, thinks, can operate your
website in a real browser (Playwright), makes pictures and videos with ComfyUI on a
RunPod GPU pod, makes and edits Instagram and X posts as drafts, saves and schedules them in
FlowAI (`content-generator/`), and answers out loud. It has its own page, where all of that is
done by talking.

```
browser mic ──PCM16 16k──▶ WebSocket ──▶ Silero VAD ──▶ Nemotron 3.5 ASR (streaming, local GPU)
                                                              │ transcript
browser speaker ◀──PCM16 24k── OmniVoice TTS (local GPU) ◀── GLM 5.3 Flash (Ollama cloud) ⇄ tools
                                                                                   │ browser_task
                                                         browser agent (LLM loop) ◀┘ + skills/*.md
                                                                   │ click / type / read      │ generate_media
                                                              Chromium (Playwright)           ▼
                                                                          ComfyUI manager API on a RunPod pod
                                                                          (images/videos shown in the web UI)
```

| Stage | Model | Runs on |
|---|---|---|
| ASR | `nvidia/nemotron-3.5-asr-streaming-0.6b` (cache-aware streaming RNNT) | this PC |
| LLM | `glm-5.3-flash` via Ollama cloud API | ollama.com |
| TTS | `k2-fsa/OmniVoice` | this PC, or a VoiceStudio server (`VOICESTUDIO_URL`) |
| VAD | Silero VAD | this PC (CPU) |
| Pictures / video | ComfyUI workflows (Z-Image Turbo, FLUX.2 Klein, Wan 2.2, ...) | RunPod GPU pod (`content-generator/runpod/`) |

## Setup

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv -r requirements.txt
.venv/bin/playwright install chromium
sudo .venv/bin/playwright install-deps chromium   # system libraries Chromium needs (once)
cp ../.env.example ../.env   # FlowAI's one settings file; put your key from https://ollama.com/settings/keys in OLLAMA_CLOUD_API_KEY
```

## Run

```bash
.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000 (the agent page, see [below](#the-agent-page-and-flowai)) and tap the
mic. http://localhost:8000/console.html is the test console: it shows every event, tool calls and
browser steps included. The first start downloads the models (~6 GB) and designs the assistant's
voice once (cached in `voices/`). Voice design is checked with the ASR and retried with new seeds if
the result isn't intelligible.

Use headphones, or untick **Interrupt by voice**; otherwise the assistant can hear itself
through your speakers and interrupt itself.

## Docker

The same app as an image, to run as a service. Settings come from FlowAI's `.env` (the repo root), as above;
an `assistant/.env`, if there is one, overrides it. FlowAI runs
the same image as its `assistant` service; see [Inside FlowAI](#inside-flowai).

```bash
docker compose up -d --build        # NVIDIA GPU: recognition and OmniVoice on the card
docker compose logs -f agent        # wait for "Ready"
```

The agent page is on http://localhost:8000 (`AGENT_PORT` to change). The first start downloads
the models (5.8 GB) into the `models` volume, which takes a few minutes. After that, a start
takes seconds. Drawn and attached files are kept in the `media` volume, conversations in `data`,
and OmniVoice's designed voice in `voices`.

- **FlowAI from the container.** Inside it, `localhost` is the container itself. For the local
  FlowAI stack, set `FLOWAI_URL=http://host.docker.internal:8002`.
- **No GPU.** `docker compose --profile cpu up -d --build agent-cpu` builds a CPU-only image
  and runs recognition on the CPU. Set `VOICESTUDIO_URL` so speech comes from VoiceStudio, because
  OmniVoice on a CPU takes seconds per sentence.
- **Website tools** are off in the container: the image has no Chromium. Build with
  `--build-arg BROWSER=true` and set `BROWSER_ENABLED` to `true` in `docker-compose.yml` to
  use them.
- **Under a path.** The page, its media links and its WebSocket are all relative, so it works
  behind a proxy at `/assistant/` (nginx settings in `FLOWAI_INTEGRATION.md`, change 4).

| Image | Size | Recognition, after you stop talking | Memory |
|---|---|---|---|
| `flowai-agent` (GPU, RTX 5060 Ti) | 12.6 GB | 0.55 s | not measured |
| `flowai-agent:cpu` | 2.8 GB | 2.0 to 2.3 s, using about one core | under 0.5 GB of RAM |

Measured by speaking a 6-second request into the WebSocket the way the page does. The time
includes the 0.6 s of silence that ends a turn. The GPU image's PyTorch (CUDA 12.8) runs on
GTX 16xx up to RTX 50xx cards.

## How a turn works

1. The browser streams mic audio continuously over `/ws`.
2. Silero VAD detects speech start, which opens a streaming ASR session. Partial
   transcripts are sent back live. If the assistant was talking, it stops (barge-in).
3. After `VAD_MIN_SILENCE_MS` of silence the transcript is finalized and sent to the LLM.
4. LLM tokens stream back. Every complete sentence goes to TTS immediately, so the
   assistant starts speaking before the LLM has finished.
5. If the LLM calls tools, they run (`backend/tools.py`), results go back to the LLM,
   and it continues.

Audio frames from the server carry a turn id, so audio from an interrupted turn is dropped.

## The engine (Creative Lab)

FlowAI's Creative Lab runs the nodes that need the GPU pod or this service's drawing here, one job each, over
HTTP (`backend/engine.py`, mounted at `/engine`, with `X-Engine-Key` = `ENGINE_KEY`): ComfyUI workflows (pictures,
edits, videos), ACE-Step songs, dubs (the speaker's voice cloned, LatentSync lips), face swaps, words drawn on
pictures and videos (`studio.py`'s drawing), pictures made into a video with a voice (`reel.py`), and painting
over part of a picture (`retouch.py`). `GET /engine/catalog` says what's ready. The assistant also builds and runs
Creative Lab graphs itself, on the canvas the user sees (`backend/lab_tools.py`, the `creative-lab` skill).

## Browser agent

The voice assistant doesn't click things itself. It hands a whole task in plain language to a
**browser agent** with `browser_task("add eggs and bread to my todo list")`:

1. The task runs **in the background**. The assistant says "On it" and you can keep talking,
   ask something else, or interrupt its voice without stopping the task. Say "how's it going?"
   (`browser_task_status`) or "stop that" (`cancel_browser_task`), or press **Cancel task**.
2. The browser agent is its own LLM loop (`backend/browser_agent.py`). Each turn it sees the page
   as text: the URL, every visible interactive element with a number, and the page text:
   ```
   [4] checkbox "Toggle Todo" in row "buy milk" unchecked
   [5] button "Delete" in row "buy milk"
   ```
   It then calls one of its tools: `click`, `type`, `select`, `hover`, `press`, `scroll`, `goto`,
   `back`, `read_page`, `load_skill`, `finish`. Only the newest page state is kept in its context.
3. When it calls `finish(result)`, the result goes back to the voice assistant, which tells you
   the outcome as soon as nobody is talking.

The web UI shows the task, each step, and a screenshot after every step. With
`BROWSER_HEADLESS=false` you also see the real Chromium window. Its profile is kept in
`browser-profile/`, so if your site needs a login, log in once in that window and it sticks.

The agent stops and asks instead of acting when it would do something irreversible the
task didn't ask for (paying, deleting, sending), or when it needs information it doesn't have.

### Skills

A skill teaches the agent how to do something on **your** site. It's a markdown file in `skills/`:

```markdown
---
name: add-todos
description: Add one or more items to the todo list on the TodoMVC demo site.
---
1. If the page is not the TodoMVC app, open https://demo.playwright.dev/todomvc/.
2. For each item, type it into the textbox "What needs to be done?" with submit set to true.
3. Check that every item now appears in the list, then finish and say how many were added.
```

The agent always sees every skill's name and description, and loads the steps with `load_skill` when
a task matches. The voice assistant sees the list too, so it can say what it's able to do. Skills
are re-read for every task, so you can edit them without restarting. Start from `skills/_template.md`.
Files starting with `_` are ignored.

Write the steps using the labels visible on the page, and mention anything tricky, such as controls
that only appear on hover, confirmation dialogs, or how to tell it worked. The agent can usually
manage without a skill, but a skill makes it faster and more reliable.

### Pointing it at your website

Set `WEBSITE_URL` in `.env`, replace the two TodoMVC skills with skills for your site, and restart.

## Pictures and videos (ComfyUI on RunPod)

ComfyUI runs on the RunPod pod with FlowAI's other GPU services, all in one folder, `content-generator/runpod/`
(its README says how to deploy it). Its part is a small API (`runpod/comfyui/manager.py`) in front of ComfyUI that
installs workflows and runs them from simple JSON (see `runpod/comfyui/API.md`).
The voice assistant talks to that API directly. It doesn't use the browser for this, which is faster
and more reliable than clicking through the ComfyUI editor.

### Connecting it

1. Deploy the pod (`runpod/deploy.sh <its SSH target>`, see `runpod/README.md`).
2. In `.env`, set `COMFYUI_URL=https://<pod-id>-8001.proxy.runpod.net` (it changes with every new pod)
   and `COMFYUI_API_KEY` to `MANAGER_API_KEY` from the pod's `env` (that one doesn't change).
3. Restart the server. The log says `ComfyUI at ...: z_image_turbo, flux2_klein_edit, ...`, and
   http://localhost:8000/health shows `"comfyui": "ok, 4 workflows"`.

With `COMFYUI_URL` empty, the feature is off and the assistant doesn't offer it.

### What you can say

| You say | What happens |
|---|---|
| "Make me a picture of a lighthouse at dusk" | `generate_media(z_image_turbo, <a detailed English prompt>)`, about 10 s |
| "Make it night time" / "Edit picture two: add snow" | `flux2_klein_edit` with that picture as input (the latest by default) |
| "Animate it" / "Make a three second video of a koi pond" | `wan_i2v` / `wan_t2v`, several minutes; you can keep talking meanwhile |
| "How's the video going?" / "Stop it" | `media_status` / `cancel_media` |
| "Which workflows do you have?" | `list_media_workflows` |
| "Add the Wan 2.2 14B image to video template" | `search_workflow_templates`, then (after you confirm) `add_media_workflow`. Custom nodes and model downloads run on the pod in the background; you're told when it's ready |
| Attach a workflow `.json`, then "add this as my_flux" | `add_media_workflow(file=<its number>)`. A URL of a workflow JSON works too |

Generation runs in the background like browser tasks: the assistant says "On it", and when the
files are ready they appear in the chat and it tells you. Every picture, video and attached file
gets a number (`#3`) that you can refer to ("animate number three"). Attach your own pictures
with 📎, or by pasting or dropping them on the page. Large pictures are scaled down to 2048 px first.

Results are downloaded to `media/` (the pod's disk is not permanent) and served at `/media/...`.

### Telling the assistant what each workflow is for

`workflows/descriptions.yaml` has one line per workflow (what it does, how long it takes, input quirks such as
Wan's 4n+1 frame counts). The assistant sees these lines with each workflow's inputs and defaults. Workflows
it adds get a line automatically. Workflows without one are described from their inputs ("Image to video.").
The list is refreshed from the pod every minute, so workflows saved in the ComfyUI editor show up too.

**Cancelling** needs the `POST /cancel/{prompt_id}` endpoint, which was added to `runpod/comfyui/manager.py` with
this integration; a pod deployed with `runpod/deploy.sh` has it. Without it, "stop" only stops waiting, and the pod
finishes the job.

### Dubbing a video and swapping faces

The assistant can make the person in a video say other words, in their own voice and with lips that match,
and put a face from one picture onto someone in another picture or a video. `backend/dub.py` does the
ffmpeg steps here; the models run elsewhere:

| What | Model | Runs on |
|---|---|---|
| Lip sync | LatentSync 1.6 (ByteDance, Apache-2.0) | a service of its own on the RunPod pod, `content-generator/runpod/lipsync/` (`LIPSYNC_URL`) |
| Face swap | InsightFace's `inswapper_128.onnx`, GFPGAN 1.4 to restore the face (both ONNX) | a service of its own on the RunPod pod, `content-generator/runpod/faceswap/` (`FACESWAP_URL`) |

| You say | What happens |
|---|---|
| (attach a video) "Make him say: the sale ends Friday" | `transcribe_media` (what's said now, how many words fit), then `dub_video` |
| "Same, but in Spanish" / "in a deeper voice" | `dub_video` again, with the new words, or with `voice` |
| "Put the face from picture 2 on video 5" | `swap_face(face=2, target=5)` |
| "Put my face on the post's picture" | `swap_face(face=<the face picture>, draft=1, slide=1)`: the result takes the slide's place |
| "Clone my voice from this recording" | `clone_voice` (see [Voice](#voice)) |

A dub follows the usual recipe: the video's sound is taken out (24 kHz mono) and its speaker's voice is
cloned from the first 20 seconds of it, as a voice of the same TTS the assistant speaks with (kept with the
video, so a second dub reuses it). The new words are read in that voice and asked to last as long as the
video (VoiceStudio's `duration`); a read that still runs long is sped up by at most 1.3×, a short one is padded
with silence. The video goes to the lip sync service at 25 fps (what LatentSync works at), at most 1920 px,
with the speech; it redraws the mouth (a longer speech plays the video back and forth), and the sound is laid
under the result if it comes back without. Videos are 60 seconds at most, and every frame needs a face.

**The lip sync service** (`content-generator/runpod/lipsync/`) is LatentSync behind a job API: `POST /v1/lipsync` (the
video and the speech), then `GET /v1/lipsync/{id}` until it's done, and `GET /v1/lipsync/{id}/video`. Jobs run
one at a time and nothing waits on a long request, so it works behind RunPod's proxy. It runs on the RunPod pod,
next to ComfyUI and VoiceStudio, on port 8004 (`LIPSYNC_URL=https://<pod-id>-8004.proxy.runpod.net` and
`LIPSYNC_API_KEY` in `.env`), deployed with the others by `runpod/deploy.sh` (on the pod: `/workspace/flowai/lipsync`,
its key in `/workspace/flowai/env`). On the pod's A40 it runs LatentSync 1.6 (faces at 512 px,
18 GB of GPU memory); `LATENTSYNC_VERSION=1.5` (256 px, 8 GB) is the smaller one. The first start downloads the
model (about 5 GB); it loads on the first dub and waits on the CPU between dubs, so the GPU it shares is free
meanwhile. Its `/health` says whether it's ready, and so does the agent's (`"lipsync"`). The same service also
runs on this machine's GPU (`docker compose --profile lipsync up -d lipsync`, `LIPSYNC_URL=http://lipsync:8000`),
but it needs about 8 GB free: on a 6 GB card next to the speech recognition, Windows lets the GPU borrow system
memory and a 10-second dub takes most of an hour. Without `LIPSYNC_URL` the assistant doesn't offer dubbing.

**The face swap service** (`content-generator/runpod/faceswap/`, port 8005; `FACESWAP_URL` and `FACESWAP_API_KEY`
in `.env`) has the same job API as the lip sync: `POST /v1/faceswap` with the face picture and the target (a
picture or a video), then `GET /v1/faceswap/{id}` and `GET /v1/faceswap/{id}/result`. InsightFace's buffalo_l
finds the faces and describes the source face, `inswapper_128.onnx` swaps the largest face (or every face, with
`every`), and GFPGAN 1.4 restores it at 512 px, blended over it (128 px looks soft on a big picture). Each face
is done in a crop around it, so a 10-second 1080 x 1920 video takes about a minute on the A40 (a picture,
seconds), frame by frame with its sound kept. `swap_face` sends a video at most 1920 px and 60 seconds long; with
`draft` (and `slide`), the result replaces that slide's picture or video, and Undo goes back. The content skill
`skills/content/face-swap.md` gives the assistant the steps (consent, the face picture, the target, a dub after).
InsightFace's models are licensed for non-commercial research only. Without `FACESWAP_URL` the assistant doesn't
offer face swaps.

**Transcripts.** Cloning needs the words of the recording. They come from VoiceStudio's speech recognition
when it has a speech-to-text model, else from FlowAI Sound's Whisper (`SOUND_URL`; both understand any
language), else from this machine's ASR, which only knows English.

Clone a voice, dub someone or swap a face only for people who agreed to it. The assistant is told the same.

## Content studio (posts for Instagram and X)

The assistant makes posts as **drafts** and changes them when you ask. A draft is shaped like a
FlowAI post (`content-generator/`): one platform and placement, a caption, and slides. A slide is
a picture or video with texts drawn on top. Every change makes a new version. The version is
drawn, checked against the platform's specs (the same table and check as FlowAI's pre-export
check, plus one of ours: no `[placeholder]` left in), and shown on the page with its problems.

| You say | What happens |
|---|---|
| "Make an Instagram post for our linen shirt launch" | one `create_draft` with the caption, the texts and a picture prompt; the picture is made in the draft's 4:5 shape and drops in when ready |
| "Remove the cup on the table" | `generate_media(flux2_klein_edit, draft=1)`: edits that slide's current picture and puts the result back in the draft |
| (paint over the cup on the slide) "remove this" / "make it gold" / "put a vase there" | `edit_area`: only the painted part changes, the rest of the picture stays exactly as it was (see [Changing part of a picture](#changing-part-of-a-picture)) |
| "Make it a reel with a voiceover and an Order now button" | `make_video`: the pictures move, a voice that suits the post reads a line over each, captions, music, an end card (see [Videos with the voice](#videos-with-the-voice)) |
| "Make the headline yellow and move it to the bottom" / "Drop the second line" | `edit_text` / `remove_text` |
| (click a text on the page) "make this bigger" | the click tells the assistant which text "this" is |
| "Shorter caption, fewer hashtags" | `update_draft(caption=...)` |
| "Go back" | `undo_draft`, as many steps as you like (or the Undo button) |
| "Now the same for X" | `create_draft(platform=x, from_draft=1)`, re-cropped to 16:9, caption rewritten for 280 characters |
| "A five-slide carousel on how to care for linen" | one `create_draft` with a text set and a picture prompt per slide, the same style on every slide |

Text is drawn with Pillow, never by the image model, so it is spelled right and easy to change.
Texts wrap and shrink to fit. Texts at the same position stack instead of overlapping. On stories
and reels they keep clear of Instagram's buttons. Rendered files go to `media/` like everything
else. Text on videos isn't drawn yet.

### Fonts

24 fonts in seven styles, listed in `fonts/fonts.yaml`:

| Style | Fonts |
|---|---|
| Modern | `bold` (Geist, the default), `semibold`, `montserrat`, `poppins`, `syne` |
| Poster | `anton`, `bebas`, `archivo` |
| Elegant | `serif` (Instrument Serif), `playfair`, `dm-serif`, `cormorant`, `fraunces` |
| Handwritten | `caveat`, `pacifico`, `dancing`, `great-vibes` |
| Playful | `fredoka`, `lilita` |
| Retro | `righteous`, `abril`, `typewriter` |
| Mono | `mono` (Geist Mono), `space-mono` |

- **What each suits:** every font has a line saying what it's for ("high-contrast serif: luxury,
  beauty, editorial"). The assistant gets the list by style, so "more elegant" or "like a sale
  poster" picks a font from the right style, at most two per post. A font can also be named by its
  label ("Playfair Display").
- **Same size in every font:** each font has a scale, so a size looks about the same in any of
  them. Thin scripts are drawn bigger, tall condensed fonts a little smaller.
- **On the page:** the text editor's Font picker has a tab per style. Each font is previewed in the
  text's own words, from the same file the assistant draws with (served at `/fonts`).
- **Source and licences:** all but Geist and Instrument Serif come from Google Fonts. The
  licences sit next to the files: `OFL-*.txt` for the SIL Open Font License, and
  `LICENSE-SpecialElite.txt` for Apache 2.0.
- **Adding a font:** drop its `.ttf`/`.otf` in `fonts/` and add a line to `fonts.yaml`. Any file
  there can also be used by its file name. Changes apply without a restart.

### Colours and readability

Every slide comes with its picture's colours: a pale tint of its main colour, up to three of its
vivid colours made bright enough to read, and a deep shade for panels (`picture_colours` in
`studio.py`). The assistant sees them as `picture_colours`, and the page shows them first in the
text's colour picker, before a curated set (cream, sand, ink, sun, coral, sky, forest, navy...).

Each text also gets a readability score where it sits: a contrast ratio of its colour against the
darkest and lightest parts of the picture behind it, or against its panel, with credit for an
outline or a shadow. Under 2.2:1 the draft's check warns ("hard to read on the picture behind")
and the assistant is told. The page works the score out the same way, so the colour picker marks
the colours that would be hard to read on that spot before you pick them. It also offers a few
ready-made looks that read well there (a tint on a deep panel, ink on a pale panel, a vivid colour
outlined...), one click each.

### Changing part of a picture

On the page, **Paint to change part of it** under a slide puts a brush on the picture. Paint over
what to change (S/M/L brush, eraser, undo), then pick **Remove**, **Replace** (with what),
**Change** (how) or **Improve**, or just say it ("remove this", "make it navy blue"). After each
stroke the page sends the painted area (`{"type": "mask"}`), and the assistant is told where it is
("the upper left, 9% of the picture"), so "this" means that area.

`edit_area` (`retouch.py`) never sends the whole picture to the editing model, which redraws all
of it and shifts what it keeps. It cuts out the painted area with some room around it, sends that
alone (the model also works at a higher resolution there), and pastes the result back through the
painted area with a soft edge. Outside it, the picture is pixel for pixel what it was. The model
shifts colours a little, so the difference along the area's edge is measured and carried smoothly
into it, and the patch meets the old picture without a seam. To remove or replace something, the
area is filled with flat magenta first, so the model fills in that patch from what is around it.
Told only to "remove the thing in the middle", FLUX.2 Klein kept the thing, or took half of it, in
our tests. The result is a new numbered picture that replaces the slide's own, so Undo goes back.
Results vary from run to run: if a removal leaves a smudge, run it again or paint a little wider.

### Videos with the voice

`make_video` (`reel.py`) turns a draft's pictures, one or several, into a short video:

- **Voice:** the assistant writes a line per picture, read by a voice of the video's own, not the
  one the assistant speaks in. A line of several sentences is a shot per sentence. See
  [The video's voice](#the-videos-voice).
- **Motion:** each shot moves the whole time it's on screen (a slow zoom in or out, or a pan), so a
  still looks filmed. A new picture fades in over the last one. The same picture again comes in
  with a straight cut and a new framing, like an edit.
- **On screen:** the slide's texts fade in over it, and captions show the spoken words in the
  lower third (or above the texts, if they're there).
- **End card:** optionally, the call to action on a button in the post's colour that pops in
  ("Order now"), over the last picture blurred, with the voice saying it ("Order yours today, the
  link is in our bio").
- **Music:** a song written for the video (`MUSIC_URL`, see [The video's music](#the-videos-music)),
  or one of FlowAI Sound's six moods (`SOUND_URL`), or none. It steps aside whenever the voice speaks
  (sidechain compression), and the mix is levelled to -14 LUFS for social video.

Frames are drawn with Pillow and encoded by ffmpeg (`imageio-ffmpeg` brings a static build) as
H.264 + AAC at the placement's size (1080 × 1920 for a reel). A 15-second video takes about
15 seconds. It's made in the background into a draft of its own (an Instagram reel by default,
story or feed on request; an X post for X), which passes the platform check (size and length are
known). Asked again, of either draft ("other music", "say it shorter", "the button says Shop
now"), that same video draft is made again with the changes, and Undo goes back to the previous
video. On the page, the draft's **Video with voice** section does the same by hand: a line per
picture, the end card, music, motion, captions, format and voice, with a progress bar while it's made.

#### The video's voice

With VoiceStudio (`VOICESTUDIO_URL`), each video is read by the voice that suits it:

- **Cast for the post:** the first time, if nobody named a voice, the LLM reads the post (platform,
  title, caption, words on the pictures, the lines) and describes its narrator in the catalog's
  words, e.g. "male, middle-aged, low pitch, british accent, calm, narration", plus the language.
  `VoiceStudioTTS.match` then finds the closest voice among the ready profiles and the catalog. A
  gender asked for is a must, the language is a must when some voices speak it, and every other word
  counts towards the fit. The description is asked once per content, so asking again costs nothing.
- **Asked for:** `make_video`'s `voice` is a description ("upbeat young woman for an ad"), a voice id
  (`find_voices` lists the ones that fit a description), or "mine" for the assistant's own voice.
- **Kept:** the voice goes into the video's recipe, so making the video again uses it until it's changed.

On the page, the **Voice** row of the Video section shows who reads it, with a sample to hear.
**Change** lists the voices that suit the post (with the description they were matched to), or the
closest to words you type, and the assistant's own voice. The voice you pick is used on the next
**Make the video**. With the local OmniVoice there is one voice, so videos use it.

#### The video's music

With a music model (`MUSIC_URL`: ACE-Step 1.5, MIT, trained on licensed music; it runs on the RunPod pod,
port 8003, from `content-generator/runpod/music/`), each video gets an instrumental song written for it:

- **Written for the post:** the casting call that describes the voice also describes the music, for
  the music model: genre, two or three instruments, mood and energy, tempo, e.g. "upbeat acoustic
  pop, bright ukulele, hand claps and shaker, feel-good and catchy, 112 bpm" for a bakery, "dark
  cinematic trap, deep 808 bass, sharp hi-hats, 140 bpm" for a gym. No vocals: it sits under the voice.
- **Asked for:** `make_video`'s `music` is a description of the music, `song` for a new one written
  for the post, a mood for the composer's, or none.
- **Kept:** the description and the seed go into the recipe, so making the video again with other
  words keeps the same song (its length follows the voiceover). A new description, or `song`, is a
  new song.
- **Fallback:** if the music service doesn't answer, the composer's Golden hour plays instead.

`backend/music.py` talks to ACE-Step's own API (`/release_task`, `/query_result`, `/v1/audio`), so
the same code works with ACE-Step on a RunPod pod: point `MUSIC_URL` there (plus `MUSIC_API_KEY`
if it has `ACESTEP_API_KEY` set). On the page, the Music menu's **A song written for it** shows the
description, which you can change; **New take** makes the same description again with another seed.

### Content skills

`skills/content/*.md` say how to make each kind of post: an Instagram post, carousel and story,
and an X post. While they total under 8000 characters (about 2,000 tokens), they go in the prompt
whole, which saves the assistant a round of reading one before every new post. Past that, it sees
each skill's name and description and loads the steps with `load_skill`, like the browser agent's
skills. Copy `skills/content/_template.md` to add one (a brand's rules, a recurring format, a
client's house style). Edits apply on the next turn, without a restart.

## Posting from the team's phone

With `PHONE_API_URL` and `PHONE_API_KEY` set (the hackathon Phone API and the team key), the assistant
publishes drafts for real from the Instagram and X apps on the team's Android phone, and reads back how
they do. The phone has an agent of its own; `backend/phone.py` makes its job easy and checks on it:

1. **The media goes first.** The draft's slides, as rendered (texts drawn on), are uploaded to the
   phone last slide first, a second apart, so the app's gallery shows them newest first in slide order:
   the agent just picks the first N.
2. **The caption is made typable.** The phone's input board types printable ASCII only, with no line
   breaks: accents become plain letters, curly quotes straight ones, and emoji are left out (the
   assistant says which). The agent gets the caption as numbered lines to type, with enter between them.
3. **A phone skill is the goal.** `skills/phone/post-<platform>-<placement>.md` (or `post-<platform>.md`)
   says where to tap in that app, step by step, with the draft's details filled in (`{{caption}}`,
   `{{count}}`, ... see `skills/phone/_template.md`). Edits apply to the next post, without a restart.
4. **It is followed live.** Every step and the phone's screen show on the Assistant page (above the
   composer, with a Stop button) and in the test console's task panel. Posting runs in the phone's
   `pro` mode, which checks independently that the post went up.
5. **Plain input needs no one.** While typing a caption the phone asks an OK for Enter in a field it
   can't read; inside a post you asked for, that (and other plain input: taps, typing, keys) is given
   by itself (`PHONE_AUTO_APPROVE_POSTS`). Anything else, and every OK in other phone tasks, waits for
   you: the assistant asks and passes your answer on (`answer_phone`).
6. **A phone that drops out is tried again.** If the phone's link or input board fails (`TargetLost`,
   `PolicyViolation`, the API down) before the post was shared, the same job goes to it again, twice
   at most, told to carry on from where the app is; the files are already on the phone. If it dropped
   after the share tap, it's never tried again: the post is *unsure* (it may be up), so it never goes
   up twice. When only our link to the API dropped and the phone carried on, it's followed again.
7. **The screen it ended on is the proof.** The screenshot the phone's run names as its evidence (what
   `pro`'s check looked at; else its last step's, else the screen then) is kept in
   `media/phone/<task>.jpg`. The Assistant page shows it in the conversation when the post is up (and
   on the draft), and so does FlowAI.
8. **It goes on FlowAI's record.** While the phone posts, the draft is saved as a FlowAI post (with the
   platform's account when FlowAI has exactly one; else without one); when it's done, the run is added
   with its steps and the screenshot (`POST /api/posts/{post}/phone-run`). Confirmed, the post is
   **published at the time it went up**, so FlowAI's calendar (and the Assistant page's Calendar tab)
   shows it there, with the screenshot; unsure, FlowAI's Inbox asks a person to check; failed, it stays
   a draft with the reason. If FlowAI isn't open in the conversation's page when it finishes, it's
   recorded the next time it is.

**Several at once.** "Post them all now" posts the drafts one after another (`post_on_phone` with
`drafts`): each starts by itself when the phone is free, and the assistant is told as each one is up,
so it never has to keep checking. A failed post is tried again with `post_on_phone`; one that's up
(or may be) is posted again only when you say so.

**Feedback.** `post_feedback` opens the post in the app (by its caption's first words) and returns its
likes, comments, shares, saves, views and latest comments as JSON (`feedback-<platform>.md`); every
check is kept with the post, so the next one says what changed. One runs by itself
`PHONE_FEEDBACK_AFTER_MINUTES` after posting (60 by default; it keeps the conversation in memory until
then, and a restart re-plans it when the conversation is opened again).

What you can say: "post draft two on Instagram now", "how is my last post doing?", "what's the phone
doing?", "check which accounts the phone is logged in to" (the `check-accounts` skill), "stop the phone".
Publishing is public, so the assistant only posts when you have said to post that draft now.

Before the first post, Instagram (com.instagram.android) and X (com.twitter.android) must be installed
and logged in on the phone: do that yourself (the console at https://172.26.0.32/team shows the phone
live); the agent never types passwords. One task runs on the phone at a time, from any conversation.

**When the phone's agent is out of service.** The phone's agent runs on the organisers' model account;
when that runs dry, its tasks hang with no steps or fail with `LLM error ... 429 ... insufficient
balance`. Who drives the phone is a switch on the Assistant page, in each draft's **From the phone**
panel (next to its **Post now** button, which asks once more before posting publicly): **Phone agent**
(with a box for direct control to take over if it fails) or **Direct control**. It applies to every
post from the phone from the next job on, FlowAI's scheduled ones too, and stays set across restarts
(`data/phone/driver.json`). Until it's first used, `PHONE_DRIVER` decides:

- `agent` (the default): only the phone's agent.
- `auto`: the phone's agent starts each job. If it fails, or sends nothing for 75 s, before anything
  public happened, its task is stopped (and must have ended) and **our own agent**
  (`backend/phone_direct.py`) takes the job over from where the app is.
  - It works on the phone's direct controls: it takes a screenshot, asks a vision model on our Ollama
    account (`PHONE_VISION_MODEL`, `kimi-k3` by default) what to do, then taps, types, presses keys or
    swipes, and looks again.
  - It uses the same skills. Apps the phone won't start by name (Instagram, X) are opened from the app
    list.
  - Before a post counts as up, it checks the screen it ended on once more (`PHONE_VERIFY_POSTS`). If
    that look can't tell, it opens the profile and finds the post, only looking; that screen is the proof.
    A post it can't find there is *unsure*, and the assistant asks before checking it. A later check
    (`post_feedback`) that finds it makes it posted, and FlowAI's record follows.
  - It sends the phone one thing at a time, at least `PHONE_ACTION_GAP_SECONDS` (5) apart: a tap, a key,
    a swipe or a line of typing.
  - Going back and forth (the same few moves again and again) gets it told to try another way or stop.
  - If the phone's agent had no model to think with, ours starts every job for the next
    `PHONE_AGENT_RETRY_MINUTES` (30); after that the phone's agent gets the next one again.
  - No handover after a share tap (the post may be up), after someone stopped the task, or when the phone
    itself dropped out (that's a retry, as above).
- `direct`: always our own agent.

Our agent needs no OK for Enter. It doesn't do anything the task doesn't ask for: no payments, deletions,
settings changes, messages, likes or follows, and no passwords. When a task would need one, it stops and
says so. The Assistant page and `phone_status` say which agent drives the phone.

### FlowAI's scheduled posts

The assistant is also FlowAI's automation service (`backend/publisher.py`): when an approved post's
time comes, FlowAI books a run on the phone, and the assistant picks it up
(`GET /api/agent/next-job`) and posts it **the same way, with the same phone skills** as
`post_on_phone`: the post's media from FlowAI onto the phone, the caption made typable,
`post-<platform>-<placement>.md` as the goal. Change how posting works in one place, the skill,
and both paths follow.

- Every action of the phone's agent is a step on FlowAI's run record (within its 40-step budget);
  a tap meant to share the post is recorded as `tap:post-button`.
- The run ends **confirmed** with the screenshot the phone ended on as proof (the calendar shows it on
  the post), **failed** if it never got as far as sharing (FlowAI tries again after 5, 15 and 30
  minutes), or **uncertain** if it may be up (FlowAI's Inbox asks a person to look), so a post never
  goes up twice. A run seen again after a restart is ended uncertain for the same reason (runs taken are
  kept in `data/phone/published.json`). A phone that drops out before sharing is given the run again,
  within what's left of its step budget.
- If the phone asks for an OK while publishing, it is given: the post was approved in FlowAI.
- Its numbers are checked like a draft's: `PHONE_FEEDBACK_AFTER_MINUTES` later, and whenever you ask
  ("how is FlowAI post 12 doing?": `post_feedback` with `flowai_post`). `phone_status` lists the latest.

Setting it up, once:
1. In FlowAI's **Phones** page, add a phone: *Automation service*, device ID `heracles-phone`.
2. On each Instagram and X account, pick that phone and turn automation on.
3. Copy the token from the Phones page into `FLOWAI_AGENT_TOKEN` in `.env` (or leave it empty and set
   `FLOWAI_EMAIL` and `FLOWAI_PASSWORD`: the assistant fetches it), and restart the assistant.
   `/health` says whether it's publishing.

Then schedule as usual (`schedule_post`, the Composer, a campaign): the post publishes itself from the
phone at its time. While the phone is busy with something the assistant asked for, a due post waits;
if it waits over 10 minutes FlowAI counts it as failed and tries again later.

## The agent page and FlowAI

`web/index.html` is the agent's own page, in FlowAI's dashboard style. FlowAI has its own version,
the Assistant tab (see [Inside FlowAI](#inside-flowai)).
- **Left:** the conversation, with the mic.
- **Middle:** the current draft as it will look on Instagram or X: carousel arrows, story bars,
  X's picture grid, a caption past the limit highlighted, and the platform check.
- **Right:** the session's drafts, the latest FlowAI posts and the numbered pictures.

On a phone the panes stack and the mic stays at the bottom.

With `FLOWAI_URL` set, the assistant works in FlowAI. At the start of a session it reads the
user's Instagram and X accounts and each account's voice (profile and memory), and writes in it.

| You say or do | What happens |
|---|---|
| "Save it" / **Save to FlowAI** | `save_draft`: the slides are uploaded as assets and the post is saved with status draft; saving again updates the same post |
| "What do we have scheduled?" / "Find the linen post" | `find_posts` |
| "Open it" / click a post in the list | `open_post`: the post becomes a draft here; saving updates it |
| "Use the autumn photo from the gallery" | `find_assets`, `use_assets`: gallery pictures get numbers to use in drafts |
| "Open the autumn launch campaign" | `find_campaigns`, `open_campaign`: each of its posts becomes a draft, linked to the campaign (see [Campaigns](#campaigns)) |
| "Schedule it for Friday at 9" | `schedule_post`: an approval card appears; only **Approve** books it |
| click a text on the picture | that text is selected: "make this gold" means it |
| **Undo** / **Save** / a post in the list | done directly, in a fraction of a second, without the assistant; it is told what happened |

Nothing is scheduled without a person's click. Changing a scheduled post makes it a draft
again, and the approval card comes back for the same time. On this page, the assistant signs in
to FlowAI as `FLOWAI_EMAIL` with `FLOWAI_PASSWORD`. Use the local stack's demo user
(`demo@flowai.test` / `password`). `FLOWAI_DASHBOARD_URL` must be one of FlowAI's
`SANCTUM_STATEFUL_DOMAINS`.

### Conversations

Every conversation is kept, so it can be listed, switched to and picked up again later, or after
a restart. Each one has its own history, numbered pictures, drafts (with their undo steps),
saved posts, campaign links and approvals. `backend/conversations.py` writes it to
`DATA_DIR/conversations/<owner>/<id>.json`, with an `index.json` per owner for the list. The
owner is the FlowAI user (`local` when `FLOWAI_URL` is empty). While FlowAI can't say who the
user is, nothing is kept, so no one's conversations end up in a shared folder.

- **Reconnecting.** The connection shows one conversation at a time, and the conversation
  outlives it. A page that reconnects with the conversation's id in its `hello` gets it back
  whole, in one `conversation` event.
- **Switching.** What the assistant is saying stops, but what it's making doesn't: a picture still
  being made lands in its draft in the conversation it was asked for. That conversation stays in
  memory until the picture is in and saved.
- **Messages.** `new`, `open`, `rename`, `delete` and `conversations` (listed at the top of
  `backend/session.py`). This repo's page starts a new conversation on each load; FlowAI's tab
  has the list.
- **Deleting** removes its file, its pictures and every drawn version of its slides. Drawn files
  are named after the conversation for that reason.

### Campaigns

`open_campaign` (or **Open a campaign** in FlowAI's tab) brings a FlowAI campaign into the
conversation. Its brief and big idea go into the assistant's instructions, and each of its posts
becomes a draft, linked to the campaign rather than to a single FlowAI post:
- one draft for each account's version of a post (FlowAI's *variants*), with that version's
  caption, placement and pictures;
- before the versions exist (while the plan is still being made), one draft per post, showing
  the post itself.

Saving a linked draft changes the campaign through FlowAI's own campaign endpoints:
- **A version:** its caption and placement. Its slides are uploaded only if they changed, and
  become that account's own pictures.
- **A post without versions:** its title and caption, and its pictures.

FlowAI then sends a changed version back to review (gate 6B). The assistant asks on screen for
the person's approval, and approving it updates the times already booked for that version too.
A version that is approved can get another time with `schedule_post`, also approved on screen.
The assistant's token can't approve anything itself.

### Voice

Every sentence is spoken in the same voice. OmniVoice makes up a new voice for each request
unless it is given a recording to clone, so the agent always passes one:
- **Locally**, the voice designed once from `TTS_VOICE_INSTRUCT` (or `TTS_REF_AUDIO`), which is
  the only one.
- **With VoiceStudio**, a voice profile on the server. The user picks one on the page: the
  profiles ready to use (a fresh pod has its demo voice), or one of the server's 1,126 catalog
  voices, described by gender, age, pitch and accent and searched by those words. A catalog voice
  becomes a profile the first time it is picked (about 3 s), and picking it again gives the same
  profile.

**Cloning a voice.** Under the ready voices, **Clone a voice** records 5 to 20 seconds with the mic, or
takes an audio or video file, and makes a voice of it once you confirm it's yours or the person agreed (the
`clone_voice` message, answered with `cloned`). The same is in the video's **Voice** panel, where the clone
then reads the video. By voice, `clone_voice` clones from a file in the conversation. With VoiceStudio, a
clone is a profile of kind `clone`; locally, OmniVoice keeps it in `voices/` (`cloned-<key>.pt`). Either way
it's one of the ready voices from then on, to speak in, to read videos, or to dub with.

The pick is kept per user in `prefs.json`, next to their conversations, so it's the voice in all
of them and after a reload. If the pod is replaced and the profile is gone, the agent sets the
catalog voice up again on the next connection, and it sounds the same, because VoiceStudio
renders catalog voices with a fixed seed. Until the user picks, it's `TTS_VOICE`. The messages
are `voices` (what to pick from, with a search), `voice` (pick one) and `preview_voice` (play
its sample, which stops what is being said).

### Inside FlowAI

FlowAI (`content-generator/`) has a copy of this repo in `assistant/`. It runs as its `assistant`
service, which `docker compose up -d` starts with the rest (without a GPU:
`docker compose --profile assistant-cpu up -d --scale assistant=0`).
Its page is the dashboard's **Assistant** tab (`frontend/src/dashboard/assistant/`), served
through the Vite proxy at `/assistant/`. Beyond this page, it adds:
- **Sign-in as the person who opened it.** The tab asks FlowAI for a token
  (`POST /api/assistant/session`) and sends it in its `hello`. That token can save drafts but
  not schedule, and reaches only the routes the tools use. **Approve** books the post with the
  person's own session.
- **Editing by hand without the model:** captions, titles, placement, text words and styles,
  slide order, removing slides, adding pictures. These are the `action` messages listed at the
  top of `backend/session.py`. The assistant is told about each change.
- **A calendar:** drop a draft on a slot to book it there.
- **A conversation that survives page changes:** it stays open from page to page, with a dock to
  come back.
- **Conversations and campaigns:** a list over the conversation panel (new, open, rename,
  delete, search), **Open a campaign**, and an **Open in the assistant** button on each campaign
  in FlowAI's Campaigns page. A draft from a campaign shows which post and account it is, where
  it stands at gate 6B, and its booked times. The last conversation opens again after a reload.

After changing the agent here, copy it over and rebuild:

```bash
rsync -a --delete --exclude __pycache__ \
  backend web skills fonts workflows requirements.txt Dockerfile .dockerignore .gitignore README.md \
  content-generator/assistant/
cd content-generator && docker compose up -d --build assistant
```

## Adding plain tools

Quick actions that don't need a browser go straight in `backend/tools.py`:

```python
@tool("get_weather", "Get the weather for a city.", {
    "type": "object",
    "properties": {"city": {"type": "string"}},
    "required": ["city"],
})
async def get_weather(city: str):
    ...
```

## Layout

```
Dockerfile     the agent as an image (GPU, or CPU with TORCH=cpu)
docker-compose.yml  runs it: agent (GPU) or agent-cpu, with volumes for models and media
backend/
  main.py      FastAPI app, model loading, /ws endpoint, serves web/
  session.py   per-connection pipeline: VAD → ASR → LLM/tools → TTS, barge-in
  vad.py       Silero VAD turn detector
  asr.py       Nemotron 3.5 ASR (streaming + offline fallback)
  llm.py       Ollama cloud client
  tts.py       OmniVoice + sentence chunker
  voicestudio.py  speech from a VoiceStudio server instead (VOICESTUDIO_URL), its voices and catalog
  tools.py     tool registry (incl. browser_task / status / cancel)
  browser.py   shared Playwright browser + text view of the page
  browser_agent.py  the browser agent's LLM loop and tools
  skills.py    loads skills/*.md
  comfyui.py   client for the ComfyUI manager API on the pod
  media.py     per-conversation generation jobs, numbered media, uploads, adding workflows
  studio.py    post drafts: slides, texts drawn with Pillow, colours and readability, versions and undo
  retouch.py   changing only the painted part of a picture (cut out, edited, pasted back seamlessly)
  reel.py      a draft's pictures as a video: motion, the voice, captions, end card, music, ffmpeg
  dub.py       dubbing (sound out, speech fitted, lips synced, sound back in) and face swaps
  podjobs.py   the pod's job services: lip sync for dubs (LIPSYNC_URL) and face swaps (FACESWAP_URL)
  music.py     songs written for videos by ACE-Step (MUSIC_URL)
  platforms.py Instagram and X specs and the pre-export check (mirrors FlowAI's)
  flowai.py    FlowAI: accounts and voice, saving, finding, opening and scheduling posts, campaigns
  phone.py     the team's phone (hackathon Phone API): posting from its apps, feedback checks
  publisher.py FlowAI's automation service: publishes scheduled posts from the phone, with the same skills
  conversations.py  conversations kept on disk: list, reopen, switch, delete
skills/        browser agent skills (markdown)
  content/     content skills: how to make each kind of post
  phone/       phone skills: how to post and read feedback in the Instagram and X apps
fonts/         fonts for text on pictures, by style (fonts.yaml), with their licences
workflows/     what each ComfyUI workflow is for (descriptions.yaml); the pod itself (ComfyUI, VoiceStudio,
               songs, lip sync, face swaps) is content-generator/runpod/
media/         generated and attached files (served at media/, next to the page)
data/          conversations and each user's voice (not served)
web/           the agent page (index.html, agent.js), the test console (console.html, app.js),
               the protocol client both use (voice.js), mic-worklet.js
```

## Tuning (`.env`)

- `ASR_LOOKAHEAD`: 0 / 3 / 6 / 13, which is 80 / 320 / 560 / 1120 ms of ASR latency. Higher is more accurate.
- `ASR_MODE=offline` transcribes the whole utterance after you stop talking (no partials).
- `VAD_MIN_SILENCE_MS`: how long a pause ends your turn. Lower is snappier but may cut you off.
- `TTS_NUM_STEP`: OmniVoice diffusion steps. The default of 8 ran at about 0.67× realtime on a GTX 1660 Ti, with no intelligibility
  loss vs 16 in tests. Raise it if you have a faster GPU.
- `TTS_DTYPE`: keep `float32` on GTX 16xx cards. They have no tensor cores, so fp16 is about 6× slower there, and
  OmniVoice produces garbled audio in fp16. `float16` is fine on RTX cards.
- `LLM_THINK`: keep `low`. With `false`, GLM 5.3 Flash leaks its reasoning into the reply and it gets spoken.
- `LLM_MODEL`: Ollama cloud models compared as the content-studio agent (October 2026). Each ran the same scripted
  seven-turn conversation three times, through the real agent loop with stand-in pictures: a post, removing an
  object, recolouring the headline, a shorter caption, undo, the X version, and a carousel.

  | Model | `LLM_THINK` | Tasks right (of 6) | Malformed tool calls | Spoken reply | Notes |
  |---|---|---|---|---|---|
  | `deepseek-v4.1-flash` | `low` | 5, 6, 6 | none | ~200 chars | steadiest time to first word (worst 2 s); best captions |
  | `gemma4:31b` | `false` | 5, 5, 6 | none | ~120 chars | shortest replies, the best fit for speech; sometimes changes both lines when asked for "the headline" |
  | `glm-5.3-flash` | `low` | 6, 6, 6 | 1 to 5 a run | ~190 chars | most precise edits; recovers from its bad calls, which costs a round each |
  | `gpt-oss:120b` | `low` | — | — | — | not usable here: described drafts it never made, left captions empty |

  Qwen3.6 35B-A3B isn't on Ollama cloud. Locally it is a 22.6 GB download, more than a 16 GB card holds next
  to the ASR and TTS models.

  Since then a post is made in one `create_draft` call and the content skills sit in the prompt, so every
  request in the script takes one tool round (two model calls), where a new post used to take five. Rerun on
  that code, both models got all seven requests right with no tool errors. Time for the reply itself:

  | Model | New post | Edits | Carousel |
  |---|---|---|---|
  | `gemma4:31b` | 2.1 s | 0.5 to 1.4 s | 4.8 s |
  | `deepseek-v4.1-flash` | 4.8 s | 1.0 to 3.3 s | 8.2 s |

  Gemma 4 is now the faster fit for a voice agent; DeepSeek still writes the stronger captions. DeepSeek
  writes `&` as `&amp;` in tool calls, which the studio turns back into `&`. Prompt length barely matters: on
  both models, going from 2k to 15k tokens of prompt added 0 to 0.4 s before the first word.
- `TTS_REF_AUDIO` / `TTS_REF_TEXT`: clone a specific voice instead of the designed one.
- `VOICESTUDIO_URL`, `VOICESTUDIO_KEY`, `TTS_VOICE`: speech from a VoiceStudio server (the same OmniVoice model, e.g. on a RunPod
  GPU) instead of this PC. FlowAI's API reads the same two for its voices; `TTS_URL` and `TTS_API_KEY` still work
  and win when set. On an L40, a 5.8-second sentence came back in about 0.4 s, against about 4 s with
  OmniVoice on a GTX 1660 Ti. The first request after VoiceStudio starts loads the model (about a minute); the agent
  makes it at startup. `TTS_VOICE` is the voice until the user picks one on the page (see [Voice](#voice)): a
  VoiceStudio profile's name or id, or a catalog voice's id such as `feat_04_the_neighbor`; empty means the
  server's oldest profile. Don't use an OpenAI name like `alloy`: VoiceStudio maps those to OmniVoice's default,
  which is a new random voice for every request, so the voice changed from one sentence to the next (measured:
  233, 121, 123 and 110 Hz median pitch over four sentences, against 197, 198, 200 and 179 Hz with a profile).
- `BROWSER_LLM_MODEL`: a different (e.g. bigger) model for the browser agent; each step is
  one LLM call, about 1 s with `glm-5.3-flash`.
- `BROWSER_MAX_STEPS`: the agent gives up after this many steps.
- `COMFYUI_TIMEOUT_MINUTES`: how long to wait for one generation (a video queued behind others can take a while).
- `SOUND_URL`: FlowAI Sound (e.g. `http://sound:8000`, set in FlowAI's compose) for music under the videos
  `make_video` makes. Empty: the videos have only the voice.
- `MUSIC_URL`, `MUSIC_API_KEY`: an ACE-Step 1.5 API (`http://music:8000` in FlowAI's compose, or a pod's) for a
  song written for each video. Empty: the composer's moods only. `MUSIC_TIMEOUT_SECONDS` (default 300) covers
  the first song, which also loads the model.
- `LLM_MAX_TOOL_ROUNDS`: tool-calling rounds per reply (default 12). A post or a carousel takes one; the rest is
  room for longer chains (find a post, open it, change it, save it).

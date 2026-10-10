---
name: browser-testing
description: "How to run headless browser tests of FlowAI/the agent on this machine (WSL + Docker Desktop, no host Chromium libs)"
metadata:
  node_type: memory
  type: reference
  originSessionId: aaf2cdd8-38b5-45b2-92f1-403a218fae10
  modified: 2026-10-10T09:17:10.180Z
---

Host Chromium can't start (libnss3 missing, needs sudo). Docker is Docker Desktop, so `--network host` is the Desktop VM, not WSL.

What works (2026-10-10):
- Image `mcr.microsoft.com/playwright:v1.49.1-jammy` (already pulled) + `npm i playwright@1.49.1` in a scratch dir (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1), run `node script.mjs` in it.
- Run Vite with `--host 0.0.0.0`; in the script, a Node `net` server on 127.0.0.1:5173 forwarding to the WSL eth0 IP, so the page keeps the `localhost:5173` origin Sanctum's stateful cookies need. Add socket error handlers and close the server at the end, or node hangs.
- Fake mic: launch flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=/e2e/say.wav`; make the WAV with the assistant container's OmniVoice.
- Never `pkill -f vite`: the pattern matches the harness's own bash and kills it; use `ps ... | grep "[v]ite"`.

Related: [[flowai-read-only]]

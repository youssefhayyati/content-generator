#!/usr/bin/env bash
# Every FlowAI model service on a RunPod pod, from this one folder (on the network volume: /workspace/flowai).
#     bash /workspace/flowai/setup.sh                  install (first run on a pod) and start all, then check them
#     bash /workspace/flowai/setup.sh lipsync music    only these (each restarts if it was running)
#     bash /workspace/flowai/setup.sh --background     start all and return at once (the pod's Container Start Command)
#
#   service      port  what                                               the assistant's settings
#   comfyui      8001  pictures and videos (ComfyUI and its manager API)  COMFYUI_URL, COMFYUI_API_KEY = MANAGER_API_KEY
#   voicestudio  8002  speech and voices (VoiceStudio: OmniVoice)         VOICESTUDIO_URL, VOICESTUDIO_KEY = OMNIVOICE_API_KEY
#   music        8003  songs under videos (ACE-Step 1.5)                  MUSIC_URL, MUSIC_API_KEY = ACESTEP_API_KEY
#   lipsync      8004  lips redrawn for dubbed videos (LatentSync 1.6)    LIPSYNC_URL, LIPSYNC_API_KEY
#   faceswap     8005  a face put on someone else (inswapper_128, ONNX)   FACESWAP_URL, FACESWAP_API_KEY
#
# Each is <service>/setup.sh, which can also be run on its own. The keys are in env next to this script
# (see env.example). Installs, models and logs go on the container disk, under /opt/<service>.
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ALL=(comfyui voicestudio music lipsync faceswap)
declare -A PORT=([comfyui]=8000 [voicestudio]=8002 [music]=8003 [lipsync]=8004 [faceswap]=8005)  # comfyui: 8001 via nginx
declare -A PUBLIC=([comfyui]=8001 [voicestudio]=8002 [music]=8003 [lipsync]=8004 [faceswap]=8005)
declare -A LOG=([comfyui]=/opt/comfy/manager.log [voicestudio]=/opt/voicestudio/server.log
                [music]=/opt/music/server.log [lipsync]=/opt/lipsync/server.log [faceswap]=/opt/faceswap/server.log)
LOGS=/opt/flowai
mkdir -p "$LOGS"

background=false now=false chosen=()
for a in "$@"; do
  case $a in
    --background) background=true ;;
    --now) now=true ;;  # (the background run itself)
    *) [ -n "${PORT[$a]}" ] || { echo "no service named $a (there are: ${ALL[*]})" >&2; exit 1; }; chosen+=("$a") ;;
  esac
done
[ ${#chosen[@]} -gt 0 ] || chosen=("${ALL[@]}")
if [ ! -f "$ROOT/env" ]; then
  echo "$ROOT/env is missing: copy env.example there and fill in the keys" >&2
  exit 1
fi

if $background; then
  setsid nohup bash "$ROOT/setup.sh" --now "${chosen[@]}" > "$LOGS/setup.log" 2>&1 < /dev/null &
  echo "starting ${chosen[*]} in the background; follow it with: tail -f $LOGS/setup.log"
  exit 0
fi

failed=()
for s in "${chosen[@]}"; do
  echo "== $s"
  # ComfyUI's own script follows its model downloads (tens of GB on a new pod): not here
  if [ "$s" = comfyui ]; then bash "$ROOT/comfyui/setup.sh" --background; else bash "$ROOT/$s/setup.sh"; fi \
    || failed+=("$s")
done
$now && exit 0

pod=${RUNPOD_POD_ID:-$(tr '\0' '\n' < /proc/1/environ | sed -n 's/^RUNPOD_POD_ID=//p')}
echo
echo "== waiting for them to answer (a new pod also downloads their models: several minutes)"
for s in "${chosen[@]}"; do
  [[ " ${failed[*]} " == *" $s "* ]] && { echo "  $s: its setup failed (see above)"; continue; }
  for _ in $(seq 120); do
    health=$(curl -s -m 5 "http://127.0.0.1:${PORT[$s]}/health") && [ -n "$health" ] && break
    sleep 5
  done
  echo "  $s: ${health:-not answering yet (log: ${LOG[$s]})}" | cut -c1-200
  echo "      https://$pod-${PUBLIC[$s]}.proxy.runpod.net"
  health=
done
[ ${#failed[@]} -eq 0 ]

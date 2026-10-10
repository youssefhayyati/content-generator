#!/usr/bin/env bash
# From this PC: puts this folder on a RunPod pod's network volume (/workspace/flowai) and starts every service.
#     runpod/deploy.sh <pod-id>-<n>@ssh.runpod.io            deploy, start, and follow until each one answers
#     runpod/deploy.sh <pod-id>-<n>@ssh.runpod.io pull       copy the pod's workflow bundles back into comfyui/workflows/
# The target is the user@host of the pod's "SSH" line (pod page -> Connect). RunPod's SSH gateway only takes an
# interactive terminal (no scp, no remote commands), so the folder goes over as base64 lines and a script is
# typed in. Your public key must be in RunPod -> Settings -> SSH Public Keys (SSH_KEY: another key file).
# On the pod the scripts are replaced; comfyui/workflows/ keeps the pod's bundles (the manager writes them) and
# only gets the ones it lacks; env is kept, or made from runpod/env here (git-ignored) the first time.
set -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TARGET=${1:?usage: deploy.sh <pod-id>-<n>@ssh.runpod.io [pull]}
KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519}
POD=${TARGET%%-*}
DEST=/workspace/flowai

# Lines typed into the pod's shell on stdin; prints only what the pod prints between the markers
remote() {
  { echo 'stty -echo'; cat; echo 'exit'; } \
    | ssh -tt -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o LogLevel=ERROR -i "$KEY" "$TARGET" 2>&1 \
    | tr -d '\r' | sed -E 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b\][^\x07]*\x07//g' \
    | sed -n '/^=====BEGIN$/,/^=====END$/p' | sed '1d;$d'
}

if [ "$2" = pull ]; then
  echo "copying the pod's workflow bundles into $HERE/comfyui/workflows/ ..."
  echo "echo =====BEGIN; tar -C $DEST/comfyui -czf - workflows | base64 -w 1000; echo =====END" \
    | remote | base64 -d | tar -C "$HERE/comfyui" -xzvf -
  exit
fi

# The kit, without what only this PC uses (the Dockerfiles run the same services in docker compose)
pack=$(mktemp)
trap 'rm -f "$pack"' EXIT
tar -C "$HERE" -czf "$pack" --exclude=__pycache__ --exclude=deploy.sh --exclude=Dockerfile . || exit 1
# What the pod runs once the kit is there (sent as base64, so nothing in it is taken as typing)
install=$(base64 -w0 <<SCRIPT
rm -rf /tmp/flowai.new && mkdir -p /tmp/flowai.new $DEST/comfyui/workflows || exit 1
base64 -d /tmp/flowai.tgz.b64 | tar -C /tmp/flowai.new -xzf - || { echo "the kit didn't arrive whole"; exit 1; }
cp -n /tmp/flowai.new/comfyui/workflows/*.json $DEST/comfyui/workflows/ 2>/dev/null
[ -f /tmp/flowai.new/env ] && cp -n /tmp/flowai.new/env $DEST/env
rm -rf /tmp/flowai.new/comfyui/workflows /tmp/flowai.new/env && cp -r /tmp/flowai.new/. $DEST/
chmod +x $DEST/*.sh $DEST/*/*.sh; rm -rf /tmp/flowai.new /tmp/flowai.tgz.b64
[ -f $DEST/env ] || { echo NO_ENV; exit 1; }
chmod 600 $DEST/env && bash $DEST/setup.sh --background
SCRIPT
)
echo "deploying $(du -h "$pack" | cut -f1) to $TARGET:$DEST ..."
out=$({ echo 'rm -f /tmp/flowai.tgz.b64'
        base64 -w 1000 "$pack" | sed 's/^/echo /; s/$/ >> \/tmp\/flowai.tgz.b64/'
        echo "echo $install | base64 -d > /tmp/flowai-install.sh; echo =====BEGIN; bash /tmp/flowai-install.sh 2>&1; echo =====END"
      } | remote)
echo "$out" | sed 's/^/  pod: /'
if grep -q NO_ENV <<<"$out"; then
  echo "the pod has no $DEST/env: make runpod/env here from env.example and run this again" >&2
  exit 1
fi
grep -q "in the background" <<<"$out" || { echo "the kit couldn't be put on the pod" >&2; exit 1; }

echo "following them (the first start on a pod installs everything and downloads the models: 10 to 30 minutes)"
declare -A NAME=([8001]=comfyui [8002]=voicestudio [8003]=music [8004]=lipsync [8005]=faceswap)
waiting=(8001 8002 8003 8004 8005)
for _ in $(seq 240); do
  left=()
  for port in "${waiting[@]}"; do
    reply=$(curl -s -m 10 -w '\n%{http_code}' "https://$POD-$port.proxy.runpod.net/health")
    code=${reply##*$'\n'} body=$(tr -d '\n' <<<"${reply%$'\n'*}")
    # Only the service's own JSON counts: while one restarts, RunPod's proxy answers 200 with an HTML page
    if [ "$code" = 200 ] && [ "${body:0:1}" = "{" ] && ! grep -q '"status":"downloading"' <<<"$body"; then
      echo "  ${NAME[$port]} is up: https://$POD-$port.proxy.runpod.net  ${body:0:110}"
    else
      left+=("$port")
    fi
  done
  waiting=("${left[@]}")
  [ ${#waiting[@]} -eq 0 ] && { echo "all up"; exit 0; }
  sleep 15
done
echo "still not answering: $(for p in "${waiting[@]}"; do printf '%s ' "${NAME[$p]}"; done)(on the pod: tail /opt/flowai/setup.log)"
exit 1

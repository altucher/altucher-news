#!/usr/bin/env bash
# Fetch the current KING checkpoint (your training base) onto a Lium pod.
# Run ON THE POD — this is ~220GB for the 110B Teutonic II model.
#
# The king lives in the PUBLIC R2 bucket teutonic-models-enam ("Genesis and
# promoted immutable models", per the repo's DEPLOY.md). Resolve the current
# king's object path from dashboard state (bucket teutonic-dash-enam) before
# each run — the king changes whenever someone is crowned.
#
# Usage (pick one source mode):
#   ./00_fetch_king.sh --dest /workspace/models/king --manifest https://.../manifest.json
#   ./00_fetch_king.sh --dest /workspace/models/king --s3 s3://teutonic-models-enam/<prefix> \
#                      --endpoint https://<account>.r2.cloudflarestorage.com
#   ./00_fetch_king.sh --dest /workspace/models/genesis --hf dendriteholdings/teutonic-II-110B-genesis
set -euo pipefail

DEST=""; MANIFEST=""; S3_URI=""; ENDPOINT=""; HF_REPO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dest)     DEST="$2"; shift 2 ;;
    --manifest) MANIFEST="$2"; shift 2 ;;
    --s3)       S3_URI="$2"; shift 2 ;;
    --endpoint) ENDPOINT="$2"; shift 2 ;;
    --hf)       HF_REPO="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done
[ -n "$DEST" ] || { echo "ERROR: --dest is required"; exit 1; }

# --- disk check: a 110B bf16 checkpoint is ~220GB; training needs far more ---
MOUNT="$(df -P "$(dirname "$DEST")" 2>/dev/null | awk 'NR==2{print $6}')" || MOUNT="/"
AVAIL_GB="$(df -PBG "$(dirname "$DEST")" 2>/dev/null | awk 'NR==2{gsub("G","",$4); print $4}')"
echo "==> Destination ${DEST} is on ${MOUNT} with ${AVAIL_GB}G available"
if [ "${AVAIL_GB:-0}" -lt 300 ]; then
  echo "ERROR: need ~220GB for the checkpoint alone (300G floor here)."
  echo "       Run 'df -h' and target the pod's large NVMe volume, not the root disk."
  exit 1
fi

# Keep the HF cache off the root disk too.
export HF_HOME="${HF_HOME:-$(dirname "$DEST")/hf}"
mkdir -p "$HF_HOME" "$DEST"
echo "==> HF_HOME=${HF_HOME}"

if [ -n "$HF_REPO" ]; then
  echo "==> Downloading ${HF_REPO} from HuggingFace (materialized, no symlinks)"
  command -v hf >/dev/null 2>&1 || pip install -q "huggingface_hub[cli]"
  hf download "$HF_REPO" --local-dir "$DEST"

elif [ -n "$S3_URI" ]; then
  [ -n "$ENDPOINT" ] || { echo "ERROR: --s3 requires --endpoint"; exit 1; }
  echo "==> Syncing ${S3_URI} from R2"
  command -v aws >/dev/null 2>&1 || pip install -q awscli
  # Public bucket: anonymous. If this 403s, the bucket needs credentials —
  # ask in the SN3 Discord rather than guessing at auth.
  aws s3 sync "$S3_URI" "$DEST" --no-sign-request --endpoint-url "$ENDPOINT"

elif [ -n "$MANIFEST" ]; then
  echo "==> Reading manifest ${MANIFEST}"
  BASE="${MANIFEST%/*}"
  curl -fsSL "$MANIFEST" -o "$DEST/.manifest.json"
  # Manifest schema is not documented; handle the common shapes and fail loudly.
  FILES="$(python3 - "$DEST/.manifest.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
items = m.get("files") if isinstance(m, dict) else m
if not items:
    sys.exit("Could not find a file list in the manifest — inspect it by hand.")
for it in items:
    print(it if isinstance(it, str) else (it.get("path") or it.get("name") or it.get("key")))
PY
)" || { echo "ERROR: unrecognized manifest schema; inspect $DEST/.manifest.json"; exit 1; }
  for f in $FILES; do
    echo "    fetching $f"
    curl -fsSL --retry 5 --retry-delay 10 "$BASE/$f" -o "$DEST/$f" --create-dirs
  done
  rm -f "$DEST/.manifest.json"

else
  echo "ERROR: pick a source — --manifest, --s3, or --hf"; exit 1
fi

# --- submission-shape checks (same rules 02_submit_checkpoint.sh enforces) ---
echo "==> Verifying checkpoint shape"
find "$DEST" -type l | grep -q . && { echo "ERROR: symlinks present — Teutonic rejects them."; exit 1; }
[ -f "$DEST/manifest.json" ] && echo "NOTE: manifest.json present — remove it before submitting (the CLI generates it)."
ls "$DEST"/*.safetensors >/dev/null 2>&1 || echo "WARNING: no .safetensors found — incomplete download?"

echo
echo "==> Done. $(du -sh "$DEST" | cut -f1) in ${DEST}"
echo "    Train from THIS directory. Keep config/tokenizer/MIMO files byte-identical:"
echo "    they are SHA-256 pinned in chain.toml and only weights may change."

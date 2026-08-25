#!/usr/bin/env bash
# Submit a challenger checkpoint to Teutonic (SN3).
# Run from the machine holding your (ed25519) hotkey.
#
# WARNING — `ready` is IRREVERSIBLE: it consumes your hotkey's single
# submission slot, revokes upload credentials, and closes the mailbox.
# Only run this when the checkpoint you uploaded is final.
#
# Usage: ./02_submit_checkpoint.sh <HOTKEY> <MODEL_NAME> <MODEL_DIR>
#
# Teutonic II round: MODEL_NAME must satisfy the chain.toml repo pattern
# ^[^/]+/teutonic-II-110B-.+$ when published (e.g. teutonic-II-110B-mychallenger),
# and the checkpoint must keep every pinned file (config, tokenizer, MIMO
# implementation) byte-identical to genesis — only weights may change.
set -euo pipefail

HOTKEY="${1:?Usage: $0 <HOTKEY> <MODEL_NAME> <MODEL_DIR>}"
MODEL_NAME="${2:?Usage: $0 <HOTKEY> <MODEL_NAME> <MODEL_DIR>}"
MODEL_DIR="${3:?Usage: $0 <HOTKEY> <MODEL_NAME> <MODEL_DIR>}"

case "$MODEL_NAME" in
  teutonic-II-110B-*) ;;
  *) echo "WARNING: '$MODEL_NAME' does not match the Teutonic II naming pattern"
     echo "         (teutonic-II-110B-<something>). Check chain.toml for the live round." ;;
esac

[ -d "$MODEL_DIR" ] || { echo "No such directory: $MODEL_DIR"; exit 1; }

# Checkpoint rules: complete model files, no symlinks, and no manifest.json
# (the CLI generates it).
if find "$MODEL_DIR" -type l | grep -q .; then
  echo "ERROR: $MODEL_DIR contains symlinks — validators reject them."
  echo "If this came from a HuggingFace cache, materialize it first:"
  echo "  huggingface-cli download <repo> --local-dir <dir>  (no symlinks)"
  exit 1
fi
[ -f "$MODEL_DIR/manifest.json" ] && { echo "ERROR: remove manifest.json — the CLI auto-generates it."; exit 1; }
ls "$MODEL_DIR"/*.safetensors >/dev/null 2>&1 || echo "WARNING: no .safetensors files found in $MODEL_DIR — is this a complete checkpoint?"

. "$HOME/teutonic/.venv/bin/activate"

echo "==> Uploading ${MODEL_DIR} as '${MODEL_NAME}' for hotkey ${HOTKEY}"
teutonic-miner upload --hotkey "$HOTKEY" --name "$MODEL_NAME" "$MODEL_DIR"

echo
read -r -p "Upload complete. Finalize submission now? This is IRREVERSIBLE for this hotkey. [y/N] " ok
if [ "${ok:-n}" = "y" ] || [ "${ok:-n}" = "Y" ]; then
  teutonic-miner ready --hotkey "$HOTKEY"
  echo "Submitted. The validator will run paired cross-entropy scoring vs the"
  echo "current king; if you win, 100% of SN3 emissions flow to this hotkey"
  echo "until someone dethrones you."
else
  echo "Not finalized. Re-run 'teutonic-miner ready --hotkey ${HOTKEY}' when ready."
fi

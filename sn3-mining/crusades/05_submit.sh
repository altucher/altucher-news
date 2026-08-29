#!/usr/bin/env bash
# Submit your hosted train.py URL to SN3 (Crusades) on-chain.
# Run from YOUR machine — the one holding your Bittensor wallet.
# The URL is encrypted and committed via set_reveal_commitment; after the
# reveal period validators fetch it, run it 3x, and score the median MFU.
# Usage: ./05_submit.sh <raw-code-url>
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

: "${WALLET_NAME:?Set WALLET_NAME in .env}"
: "${WALLET_HOTKEY:?Set WALLET_HOTKEY in .env}"
NETWORK="${NETWORK:-finney}"

CODE_URL="${1:?Usage: $0 <raw-code-url> (e.g. https://huggingface.co/you/repo/resolve/main/train.py)}"

echo "==> Sanity check: URL must serve raw python anonymously"
curl -fsSL "$CODE_URL" | grep -q "def inner_steps" \
  || { echo "ERROR: $CODE_URL does not serve a train.py with inner_steps()"; exit 1; }

# Needs a local crusades checkout for the miner CLI (no GPU required).
if [ ! -d "$HOME/crusades" ]; then
  echo "==> Cloning crusades for the miner CLI"
  git clone https://github.com/one-covenant/crusades "$HOME/crusades"
fi
cd "$HOME/crusades"
command -v uv >/dev/null 2>&1 || { curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"; }
uv sync

echo "==> Submitting to netuid 3 on ${NETWORK} as ${WALLET_NAME}/${WALLET_HOTKEY}"
uv run -m neurons.miner submit "$CODE_URL" \
    --wallet.name "$WALLET_NAME" \
    --wallet.hotkey "$WALLET_HOTKEY" \
    --network "$NETWORK"

cat <<'EOF'

Submitted. Track your standing on the leaderboard:
    uv run -m crusades.tui --url http://69.19.136.171:8080

Don't forget to stop the Lium pod if you're done iterating:  lium rm <POD>
EOF

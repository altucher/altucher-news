#!/usr/bin/env bash
# Teutonic (SN3) miner setup — clone the miner CLI and configure it.
# Run on YOUR machine (registration/submission) and/or on the Lium pod
# (training). The wallet only ever lives on your machine.
set -euo pipefail

WALLET_PATH="${WALLET_PATH:-$HOME/.bittensor/wallets}"

echo "==> Cloning unarbos/teutonic"
cd "$HOME"
if [ ! -d teutonic ]; then
  git clone https://github.com/unarbos/teutonic.git
fi
cd teutonic

echo "==> Installing miner CLI (needs Python 3.11+)"
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e '.[miner]'

echo "==> Configuring (wallet path: ${WALLET_PATH})"
teutonic-miner configure --wallet-path "$WALLET_PATH"

cat <<'EOF'

Setup done. IMPORTANT: Teutonic requires an ED25519 hotkey (the btcli
default is sr25519 — a default hotkey will NOT work):

    btcli wallet new-hotkey --wallet-name <WALLET> --hotkey <HOTKEY> \
        --wallet-path ~/.bittensor/wallets --crypto-type ed25519

Then register on netuid 3 and authorize:

    source ~/teutonic/.venv/bin/activate
    teutonic-miner register --wallet-name <WALLET> --hotkey-name <HOTKEY> \
        --network finney --netuid 3
    teutonic-miner auth --hotkey <HOTKEY>

Train your challenger checkpoint (see ../README.md), then submit with
02_submit_checkpoint.sh.
EOF

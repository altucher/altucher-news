#!/usr/bin/env bash
# Rent a GPU pod on Lium (Bittensor SN51). Run from YOUR machine.
# Default: 2x A100 80GB (Crusades' validator hardware). For Teutonic
# (continued pretraining of the 110B MoE Teutonic II) you'll want much more, e.g.:
#   GPU_TYPE=H200 GPU_COUNT=8 ./01_rent_lium_pod.sh
set -euo pipefail

cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a

if ! command -v lium >/dev/null 2>&1; then
  echo "==> Installing Lium CLI"
  pip install lium.io || curl -fsSL https://lium.io/install.sh | bash
fi

# First-time setup: API key (from lium.io) + SSH key registration.
if [ ! -f "$HOME/.lium/config.ini" ] && [ -z "${LIUM_API_KEY:-}" ]; then
  echo "==> First-time Lium setup (needs your lium.io API key)"
  lium init
fi

GPU_TYPE="${GPU_TYPE:-A100}"
GPU_COUNT="${GPU_COUNT:-2}"

echo "==> Available ${GPU_TYPE} executors (star = best value):"
lium ls "$GPU_TYPE"

cat <<EOF

Fund your Lium balance with TAO if needed:
    lium fund

Renting ${GPU_COUNT}x ${GPU_TYPE}. Auto-selecting best match...
EOF

lium up --gpu "$GPU_TYPE" --count "$GPU_COUNT"

echo
echo "==> Active pods:"
lium ps
cat <<'EOF'

Next steps:
  Teutonic (current SN3): lium ssh <POD>, train your challenger checkpoint
      there (see teutonic/ and README.md), lium scp the checkpoint back down.
  Crusades (legacy):      lium scp <POD> ./crusades/02_setup_pod.sh
                          then on the pod: HF_TOKEN=hf_xxx bash 02_setup_pod.sh

Remember: the pod bills hourly — `lium rm <POD>` when you stop iterating.
EOF

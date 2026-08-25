#!/usr/bin/env bash
# Rent a 2x A100 80GB pod on Lium (Bittensor SN51) — the exact hardware
# Crusades validators score on. Run from YOUR machine.
set -euo pipefail

cd "$(dirname "$0")/.."
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

echo "==> Available A100 executors (star = best value):"
lium ls A100

cat <<'EOF'

Fund your Lium balance with TAO if needed:
    lium fund

Renting: Crusades benchmarks on 2x A100 80GB. Auto-selecting best match...
EOF

lium up --gpu A100 --count 2

echo
echo "==> Active pods:"
lium ps
cat <<'EOF'

Next steps:
  lium scp <POD> ./scripts/02_setup_pod.sh     # copy setup script to the pod
  lium ssh <POD>                               # then on the pod:
      HF_TOKEN=hf_xxx bash 02_setup_pod.sh

Remember: the pod bills hourly — `lium rm <POD>` when you stop iterating.
EOF

#!/usr/bin/env bash
# Run ON THE LIUM POD. Sets up the Crusades (SN3) development environment:
# repo, deps, HuggingFace benchmark assets, and the validator Docker image.
# Usage: HF_TOKEN=hf_xxx bash 02_setup_pod.sh
set -euo pipefail

: "${HF_TOKEN:?Set HF_TOKEN=hf_... (https://huggingface.co/settings/tokens)}"

echo "==> GPUs on this pod (need 2x A100 80GB to match the leaderboard):"
nvidia-smi --query-gpu=name,memory.total --format=csv || true

echo "==> Cloning crusades"
cd "$HOME"
if [ ! -d crusades ]; then
  git clone https://github.com/one-covenant/crusades
fi
cd crusades

echo "==> Installing uv + syncing dependencies"
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi
uv sync

echo "==> Writing .env (HuggingFace token for benchmark model/data)"
echo "HF_TOKEN=${HF_TOKEN}" > .env

echo "==> Downloading benchmark model + data from HuggingFace"
uv run local_test/setup_benchmark.py

echo "==> Building the validator's evaluation Docker image"
docker build --network=host -f environments/templar/Dockerfile \
    --no-cache -t templar-eval:latest .

cat <<'EOF'

Pod ready. Develop your train.py (start from local_test/train_fsdp.py),
then evaluate it exactly like a validator will:

    bash 03_test_local.sh ./my_train.py

EOF

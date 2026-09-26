#!/usr/bin/env bash
# Run ON THE LIUM POD from ~/crusades. Evaluates a train.py inside the exact
# Docker container production validators use: security scan, baseline
# comparison, warmup, timed evaluation, MFU calculation.
# Usage: bash 03_test_local.sh [path/to/train.py]   (default: local_test/train_fsdp.py)
set -euo pipefail

TRAIN_PY="${1:-local_test/train_fsdp.py}"
[ -f "$TRAIN_PY" ] || { echo "No such file: $TRAIN_PY"; exit 1; }
[ -f hparams/hparams.json ] || { echo "Run from the crusades repo root (~/crusades)"; exit 1; }

echo "==> Evaluating $TRAIN_PY in templar-eval:latest (validator-identical)"
docker run --gpus 2 -it --rm \
    --ipc=host \
    --ulimit memlock=-1:-1 \
    -e NCCL_P2P_LEVEL=NVL \
    -e NCCL_SHM_USE_CUDA_MEMCPY=1 \
    -e NCCL_NVLS_ENABLE=1 \
    -e NCCL_IB_DISABLE=1 \
    -e PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
    -v "$(pwd)/${TRAIN_PY}":/test/train.py:ro \
    -v "$(pwd)/local_test/simulate_validator.py":/test/simulate.py:ro \
    -v "$(pwd)/hparams/hparams.json":/app/hparams.json:ro \
    -v "$(pwd)/environments/templar/env.py":/app/env.py:ro \
    -v "$(pwd)/src/crusades/core/security_defs.py":/app/crusades/core/security_defs.py:ro \
    -e PYTHONPATH=/app \
    templar-eval:latest \
    python3 /test/simulate.py

cat <<'EOF'

Compare your MFU against the leaderboard:
    uv run -m crusades.tui --url http://69.19.136.171:8080

Happy with the number? Host it (04_host_on_hf.sh) and submit (05_submit.sh)
from YOUR machine — not from this pod.
EOF

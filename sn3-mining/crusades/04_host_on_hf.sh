#!/usr/bin/env bash
# Host your train.py on HuggingFace Hub and print the raw URL validators
# will fetch. Run from YOUR machine.
# Usage: ./04_host_on_hf.sh path/to/train.py [repo-name]
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

: "${HF_TOKEN:?Set HF_TOKEN in .env (write scope)}"
: "${HF_USERNAME:?Set HF_USERNAME in .env}"

TRAIN_PY="${1:?Usage: $0 path/to/train.py [repo-name]}"
[ -f "$TRAIN_PY" ] || { echo "No such file: $TRAIN_PY"; exit 1; }

# Random suffix: the repo must be PUBLIC for validators to fetch it, so an
# unguessable name is the only obscurity you get pre-reveal. Push late.
REPO_NAME="${2:-sn3-crusades-$(head -c4 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
REPO_ID="${HF_USERNAME}/${REPO_NAME}"

pip show -q huggingface_hub 2>/dev/null || pip install -q "huggingface_hub[cli]"

echo "==> Creating public HF repo ${REPO_ID} and uploading ${TRAIN_PY} as train.py"
python3 - "$TRAIN_PY" "$REPO_ID" <<'PY'
import sys, os
from huggingface_hub import HfApi
train_py, repo_id = sys.argv[1], sys.argv[2]
api = HfApi(token=os.environ["HF_TOKEN"])
api.create_repo(repo_id=repo_id, repo_type="model", private=False, exist_ok=True)
api.upload_file(path_or_fileobj=train_py, path_in_repo="train.py",
                repo_id=repo_id, repo_type="model")
print(f"\nRaw URL for submission:\n  https://huggingface.co/{repo_id}/resolve/main/train.py")
PY

RAW_URL="https://huggingface.co/${REPO_ID}/resolve/main/train.py"
echo "==> Verifying the URL serves raw code anonymously"
curl -fsSL "$RAW_URL" | head -5

cat <<EOF

Hosted. Submit it on-chain with:
    ./crusades/05_submit.sh ${RAW_URL}
EOF

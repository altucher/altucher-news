# SN3 (Templar / Crusades) Mining — HuggingFace storage + Lium compute

End-to-end setup for mining Bittensor **subnet 3 (netuid 3)** using
**HuggingFace** for model/code storage and **Lium** (lium.io, Bittensor SN51)
for GPU compute.

> **Read this first — what SN3 mining is right now.**
> Templar's decentralized-training protocol is currently **dormant**. Subnet 3
> instead runs **Crusades** (https://github.com/one-covenant/crusades), an
> **MFU optimization tournament**: you submit a single optimized `train.py`,
> validators execute it inside a fixed Docker container on **2x A100 80GB**,
> and your reward is driven by the **median MFU** (Model FLOPs Utilization)
> your code achieves training the benchmark model (Qwen2.5-3B). You are not
> running a 24/7 miner daemon — you iterate on training code, test it locally
> on a rented GPU pod, and submit a URL on-chain.

## Architecture

```
┌─────────────────┐     lium up --gpu A100 --count 2      ┌──────────────────────┐
│  Your machine    │ ────────────────────────────────────▶ │  Lium pod (2x A100)  │
│  (wallet lives   │                                       │  - clone crusades     │
│   ONLY here)     │      lium ssh / lium scp              │  - HF_TOKEN pulls     │
│                 │ ◀────────────────────────────────────  │    Qwen2.5-3B + data  │
│  btcli register  │                                       │  - Docker simulation  │
│  submit URL ─────┼──▶ Bittensor chain (netuid 3)         │    of the validator   │
└─────────────────┘                                        └──────────────────────┘
        │
        └──▶ HuggingFace Hub repo hosts train.py
             (https://huggingface.co/<you>/<repo>/resolve/main/train.py)
             Validators fetch it after the on-chain reveal period.
```

**Security rule that matters:** your **coldkey never touches the Lium pod**.
Rented GPU boxes are for developing and benchmarking `train.py` only.
Registration and submission are cheap CPU-side chain calls — do them from your
own machine.

## Prerequisites

| What | Why | Where |
|------|-----|-------|
| TAO in a Bittensor wallet | Registration burn on netuid 3 + Lium pod rental | any exchange → `btcli` wallet |
| HuggingFace account + token (`hf_...`) | Pull benchmark model/data; host your `train.py` | https://huggingface.co/settings/tokens |
| Lium account / API key | Rent the 2x A100 80GB pod | https://lium.io |
| Python 3.10+, `btcli`, Docker (on the pod) | tooling | scripts below install these |

## Step-by-step

### 0. Configure

```bash
cd sn3-mining
cp .env.example .env   # fill in HF_TOKEN, HF_USERNAME, WALLET_NAME, WALLET_HOTKEY
```

### 1. Wallet + registration (your machine, NOT the pod)

```bash
pip install bittensor-cli
btcli wallet new_coldkey --wallet.name sn3miner
btcli wallet new_hotkey  --wallet.name sn3miner --wallet.hotkey miner1
# fund the coldkey with TAO, then check the current registration burn:
btcli subnet show --netuid 3 --network finney
# register the hotkey on SN3:
btcli subnet register --netuid 3 --wallet.name sn3miner --wallet.hotkey miner1 --network finney
```

### 2. Rent compute on Lium

```bash
./scripts/01_rent_lium_pod.sh
```

This installs the Lium CLI, walks you through `lium init` (API key + SSH key),
funds from your TAO wallet if needed (`lium fund`), then rents a **2x A100
80GB** pod — the exact hardware validators score on, so your local MFU numbers
match the leaderboard.

### 3. Set up the pod

```bash
lium scp <POD> ./scripts/02_setup_pod.sh
lium ssh <POD>
# on the pod:
HF_TOKEN=hf_xxx bash 02_setup_pod.sh
```

Clones `one-covenant/crusades`, installs `uv`, syncs deps, writes the pod-side
`.env`, downloads the benchmark model + data from HuggingFace, and builds the
validator's evaluation Docker image.

### 4. Write and test your `train.py` (the actual mining)

Your submission is one file exporting two functions:

```python
def get_strategy():
    # literal dict only — computed values are rejected by the validator
    return {"dp_size": 2, "tp_size": 1}

def inner_steps(model, data_iterator, optimizer, num_steps, device, num_gpus=1):
    # optimizer arrives as None — create your own (e.g. fused AdamW)
    # wrap model (FSDP/DDP/TP), run num_steps training iterations
    return InnerStepsResult(
        final_logits=...,   # (batch, seq_len-1, vocab) from final forward
        total_tokens=...,   # sum across all steps
        final_loss=...,     # positive, non-NaN scalar
        final_state=...,    # full CPU state_dict (weight verification)
    )
```

Start from the reference implementations in the crusades repo
(`local_test/train_fsdp.py`, `train_tp.py`, `train_mixed.py`) and optimize.
**Allowed:** `torch.compile`, Flash Attention, Triton kernels, CUDA graphs,
fused optimizers. **Blocked** (static security scan): forbidden imports
(`inspect`, `pickle`, ...), monkey-patching torch internals, timer
manipulation, freezing parameters. Blocklist: `src/crusades/core/security_defs.py`.

Test inside the exact validator container:

```bash
# on the pod, in ~/crusades:
bash 03_test_local.sh ./my_train.py
```

This runs security scan → baseline comparison → warmup → timed eval → MFU,
matching what the tournament will report. Iterate until your MFU beats the
leaderboard (`uv run -m crusades.tui --url http://69.19.136.171:8080`).

### 5. Host `train.py` on HuggingFace

```bash
./scripts/04_host_on_hf.sh path/to/train.py
```

Creates a HF Hub repo (random suffix, public — see note), uploads `train.py`,
and prints the raw URL validators will fetch:
`https://huggingface.co/<you>/<repo>/resolve/main/train.py`

> **Privacy note:** validators must be able to fetch the URL anonymously, so
> the HF repo must be **public** at reveal time. Your submitted URL is
> encrypted on-chain (`set_reveal_commitment`) until the reveal period, but a
> public HF repo is browsable — the script uses a random repo name and you
> should push as late as possible. If you want maximum secrecy pre-reveal, a
> GitHub **secret gist** raw URL is the community-recommended alternative;
> the submit script accepts any URL.

### 6. Submit on-chain (your machine)

```bash
./scripts/05_submit.sh https://huggingface.co/<you>/<repo>/resolve/main/train.py
```

Runs `uv run -m neurons.miner submit <URL> --wallet.name ... --wallet.hotkey
... --network finney` from the crusades checkout. After the reveal period,
validators download your code, run it 3x in the container, take the median
MFU, and set weights → you earn TAO emissions proportional to your ranking.

### 7. Stop paying for the pod

The pod bills while it runs. When you're done iterating:

```bash
lium rm <POD>
```

Re-rent with `01_rent_lium_pod.sh` whenever you want to test a new iteration —
setup takes minutes and your `train.py` lives in git/HF, not on the pod.

## Cost model

- **Registration:** one-time burn on netuid 3 (check `btcli subnet show --netuid 3`).
- **Compute:** Lium 2x A100 80GB billed per hour in TAO — rent only while
  actively optimizing; there is no uptime requirement for Crusades miners.
- **Emissions:** paid to your hotkey based on MFU ranking; this is a
  competition — a stock `train_fsdp.py` submission will score, but rewards go
  to whoever squeezes out the most MFU.

## Files

- `scripts/01_rent_lium_pod.sh` — install Lium CLI, rent 2x A100 80GB pod
- `scripts/02_setup_pod.sh` — run **on the pod**: crusades checkout, deps, HF benchmark download, Docker image
- `scripts/03_test_local.sh` — run **on the pod**: validator-identical Docker evaluation of your train.py
- `scripts/04_host_on_hf.sh` — upload train.py to a HuggingFace Hub repo, print raw URL
- `scripts/05_submit.sh` — commit the URL on-chain for netuid 3
- `.env.example` — configuration template

## References

- Crusades (SN3 mechanism): https://github.com/one-covenant/crusades
- Templar: https://github.com/one-covenant/templar · https://tplr.ai
- Lium CLI: https://github.com/Datura-ai/lium · https://docs.lium.io
- Bittensor CLI: https://docs.bittensor.com

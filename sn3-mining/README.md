# SN3 Mining — HuggingFace storage + Lium compute

End-to-end setup for mining Bittensor **subnet 3 (netuid 3)** using
**HuggingFace** for model storage and **Lium** (lium.io, Bittensor SN51) for
GPU compute.

## Which mechanism is live? (SN3 changed hands in 2026)

SN3's mechanism has changed twice this year — **verify which is live before
spending TAO** (SN3 Discord / [taostats.io](https://taostats.io) / recent
subnet weight activity):

| Era | Mechanism | Status |
|-----|-----------|--------|
| → early 2026 | **Templar** decentralized training (Covenant AI) — trained Covenant-72B | dormant |
| spring 2026 | **Crusades** — MFU optimization tournament (Covenant AI) | legacy — Covenant AI exited Bittensor |
| May 2026 → | **Teutonic** ([teutonic.io](https://teutonic.io), [unarbos/teutonic](https://github.com/unarbos/teutonic)) — king-of-the-hill pretraining of the 80B **Teutonic-LXXX** model | **current** |

This directory supports both: **`teutonic/`** (current) and **`crusades/`**
(legacy, kept in case the mechanism rotates back or you're on testnet).

---

## Teutonic (current SN3): king-of-the-hill pretraining

**How it works:** miners submit immutable model checkpoints as *challengers*.
The validator sends the challenger and the current *king* to a remote GPU
evaluator for paired cross-entropy scoring on held-out samples. Beat the king
→ **100% of SN3 emissions flow to your hotkey every epoch** until someone
dethrones you.

**Read that again — it's winner-take-all.** Second place earns nothing.

### Current round: Teutonic II (per the repo's live `chain.toml`)

The round parameters live in
[`chain.toml`](https://github.com/unarbos/teutonic/blob/main/chain.toml) —
**always re-read it before training; rounds rotate.** As of Aug 2026:

- **Model:** Teutonic II — **110B-parameter mixture-of-experts** transformer
  (256 experts, top-8 routing; custom `teutonic.archs.mimo` architecture).
- **Start from the KING, not genesis.** See "Where to get the king" below.
  Genesis (`dendriteholdings/teutonic-II-110B-genesis`) is only the base for
  the round's *first* challenger.
- **Checkpoint naming is enforced:** your HF repo must match
  `^[^/]+/teutonic-II-110B-.+$` (e.g. `yourname/teutonic-II-110B-challenger1`),
  safetensors weights.
- **Locked files:** the config pins architecture/config/tokenizer/MIMO
  implementation files by SHA-256 — you may only train the *weights*.
  Changing architecture, config, or tokenizer files disqualifies the
  checkpoint. Continue-pretrain from genesis (or the current king); don't
  restructure the model.
- **Evaluation:** cross-entropy on **finewebedu**, 2,000 samples
  (`[evaluation] dataset_label="finewebedu", n=2000, delta_threshold=0.5`).
  Match your training data to this eval (a FineWeb-Edu-style mix).
- **`delta_threshold = 0.5` is 0.5 NATS of cross-entropy** (confirmed via SN3
  Discord, Aug 2026). This is a deliberately chunky bar, not a
  statistical-significance margin: your challenger must cut perplexity by
  ~39% versus the king (`e^0.5 = 1.65x`). For scale, the loss gap between a
  well-trained 7B and 70B is typically only ~0.2-0.3 nats.

  **Consequence — viability is a property of where the king sits on its loss
  curve, and the architecture is FIXED (weights only), so there is a floor
  below which no budget wins.** Measure before spending:

  | King's CE on FineWeb-Edu | Read | Action |
  |---|---|---|
  | > ~3.0 | early on the curve, still dropping fast | 0.5 nats is a normal increment — proceed to cost the run |
  | ~2.5-3.0 | marginal | run the slope probe below before deciding |
  | < ~2.5 | near this architecture's asymptote | 0.5 nats likely unreachable at ANY budget — walk away |

  **Slope probe (the actual go/no-go, ~2-3 TAO):** measure the king's CE,
  then train for a few hours and measure dCE/dToken. Extrapolate the tokens
  needed for 0.5 nats. If the extrapolation exceeds what you can fund, stop
  there — that is the cheapest possible answer to this question.

Because only weights float and the eval set is known, the competition is:
who can continue-pretraining a 110B MoE on FineWeb-Edu-like data most
effectively. MoE helps you — ~110B total but far fewer active parameters per
token than a dense 80B — but this is still a multi-node-scale training job.
Budget accordingly: serious-compute competition, not a set-and-forget miner.

### Where to get the king (train from this, not genesis)

Teutonic runs three Cloudflare R2 buckets (see the repo's `DEPLOY.md`):

| Bucket | Access | Contents |
|--------|--------|----------|
| `teutonic-private-models-enam` | private, one prefix per registration | your challenger while it awaits evaluation |
| `teutonic-models-enam` | **public** | "Genesis and promoted immutable models" — i.e. genesis plus every crowned king |
| `teutonic-dash-enam` | public read | dashboard/leaderboard state + encrypted credential mailboxes |

A "Promotion worker" handles "private-to-public model promotion and
crowning": when a challenger wins, its checkpoint is copied from the private
bucket into the **public** bucket and it becomes the king. So the reigning
king's weights are publicly downloadable, and that is your training base.

**Why this matters economically:** the win threshold is a delta > 0.5 against
the *king*. Start from the king and you need to add 0.5 of improvement. Start
from genesis and you must first re-derive every token of training the king
already accumulated, *then* add 0.5 — you'd be paying for the whole
lineage's compute to reach parity. Cumulative building is the design intent
of king-of-the-hill; genesis is only the base for a round's first challenger.

Resolve the current king's object path from the dashboard state (the
`teutonic-dash-enam` public base URL) before each run — the king changes
whenever someone is crowned, and the checkpoint is immutable per crowning.

### Steps

1. **Wallet — Teutonic requires an ed25519 hotkey** (btcli's default sr25519
   will not work; the validator uses it for credential encryption):

   ```bash
   pip install bittensor-cli
   btcli wallet new_coldkey --wallet.name sn3miner
   btcli wallet new-hotkey --wallet-name sn3miner --hotkey teuton1 \
       --wallet-path ~/.bittensor/wallets --crypto-type ed25519
   ```

2. **Install + register** (your machine — coldkey never touches rented compute):

   ```bash
   ./teutonic/01_setup_miner.sh        # clone, venv, pip install -e '.[miner]', configure
   source ~/teutonic/.venv/bin/activate
   teutonic-miner register --wallet-name sn3miner --hotkey-name teuton1 \
       --network finney --netuid 3
   teutonic-miner auth --hotkey teuton1
   ```

3. **Rent training compute on Lium.** An 80B model needs far more than a dev
   box — e.g. an 8x H200 pod:

   ```bash
   GPU_TYPE=H200 GPU_COUNT=8 ./01_rent_lium_pod.sh
   ```

4. **Train your challenger** on the pod: download the **current king** from
   the public bucket `teutonic-models-enam` (see "Where to get the king" —
   not genesis, unless no king has been crowned this round), continue
   pretraining on FineWeb-Edu-style data (any hardware, any approach is
   allowed — but keep every pinned file byte-identical), and save a full
   safetensors checkpoint named `teutonic-II-110B-<name>`. Then
   `lium scp` it back (or run the submit step from the pod *without* your
   coldkey — only the miner CLI auth is needed post-registration).

5. **Submit** (irreversible per hotkey — the `ready` step consumes your one
   submission slot and revokes upload credentials):

   ```bash
   ./teutonic/02_submit_checkpoint.sh teuton1 my-challenger /path/to/checkpoint
   ```

   Checkpoint rules: complete model files, **no symlinks** (materialize HF
   downloads with `--local-dir`), and **no `manifest.json`** (auto-generated).

6. **Shut the pod down** when training ends: `lium rm <POD>`.

---

## Crusades (legacy): MFU tournament

Kept in `crusades/` — the mechanism SN3 ran before the Teutonic handover.
You submit one optimized `train.py`; validators execute it on 2x A100 80GB in
a fixed Docker container and score median MFU training Qwen2.5-3B.

```bash
./01_rent_lium_pod.sh                      # default 2x A100 80GB
lium scp <POD> ./crusades/02_setup_pod.sh  # pod: crusades repo, HF benchmark, eval image
# on pod:  HF_TOKEN=hf_xxx bash 02_setup_pod.sh
# on pod:  bash 03_test_local.sh ./my_train.py      # validator-identical eval
./crusades/04_host_on_hf.sh my_train.py    # host on a HF Hub repo, prints raw URL
./crusades/05_submit.sh <raw-url>          # on-chain submit to netuid 3
```

Details (train.py contract — `get_strategy()` / `inner_steps()` — security
scanner rules, allowed optimizations) are documented in the script headers and
at https://github.com/one-covenant/crusades.

---

## Where HuggingFace and Lium fit

- **HuggingFace**: pulling the king/benchmark checkpoints (`HF_TOKEN`), and —
  under Crusades — hosting your submitted `train.py` via a Hub repo's
  `/resolve/main/` raw URL. Community Teutonic checkpoints are published on
  the Hub.
- **Lium**: TAO-funded GPU rental for all training/benchmarking. Pods bill
  hourly; there is no uptime requirement in either mechanism, so rent only
  while actively training.

## Files

- `01_rent_lium_pod.sh` — install Lium CLI, rent a pod (`GPU_TYPE`/`GPU_COUNT` env vars)
- `teutonic/00_fetch_king.sh` — fetch the king (or genesis) onto the pod: disk check, symlink-free download, submission-shape verification
- `teutonic/01_setup_miner.sh` — install + configure the Teutonic miner CLI
- `teutonic/02_submit_checkpoint.sh` — validate, upload, and finalize a challenger checkpoint
- `crusades/02_setup_pod.sh` … `crusades/05_submit.sh` — legacy Crusades flow
- `.env.example` — configuration template (real `.env` is git-ignored)

## References

- Teutonic (current SN3): https://github.com/unarbos/teutonic · https://teutonic.io
- Crusades (legacy): https://github.com/one-covenant/crusades
- Templar history: https://github.com/one-covenant/templar
- Lium CLI: https://github.com/Datura-ai/lium · https://docs.lium.io
- Bittensor CLI: https://docs.bittensor.com

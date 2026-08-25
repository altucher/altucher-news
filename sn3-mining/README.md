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

**Read that again — it's winner-take-all.** Second place earns nothing. The
current king is a checkpoint of an 80B-parameter pretraining run; to dethrone
it you continue-pretraining from the best public checkpoint (community
checkpoints are published on HuggingFace — this is where **HF storage** comes
in) with enough compute/data to lower cross-entropy. Budget accordingly: this
is a serious-compute competition, not a set-and-forget miner.

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

4. **Train your challenger** on the pod: pull the current king / best public
   checkpoint from HuggingFace, continue pretraining (any hardware, any
   approach is allowed), and save a full safetensors checkpoint. Then
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

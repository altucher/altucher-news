# James-parity router on kev: train on James's own routing decisions

Status: **code written and offline-tested; nothing has run against a GPU or an API yet.**
Direction from the brief follow-up: skip RouterBench and Kimi-generated data and train on the
routing decisions James has already made in production. Upstream pin: `jaredpalmer/kev@cc954f2`.

## The data

Every James-served chat is logged by `app/api/chat/route.ts` into the Supabase table
`analytics_events` as `event_type = chat_query` with:

| column | content |
|---|---|
| `prompt` | the user's last message, cut at 500 characters |
| `model` | the cell James chose, from the `x-james-route` header: `james/<provider>/<model>`, or `james/<harness>` when only a harness was reported, or `james/james` when the header was absent |
| `used_desearch` | whether James's harness searched |
| `created_at` | when |

Labels are **James's decisions, not outcomes**. The trained model imitates James's policy, and the
evaluation measures agreement with James, for our model and for Jev alike. That is the right
target for "a small model that routes like James"; it says nothing about whether James was right.

Logging started 2026-09-17, so volume is whatever has accumulated. The export script prints the
count and the per-cell breakdown first; **fewer than about 500 usable rows is a smoke run, not a
study**, and the freezer refuses below 50.

## Conversion (kev's renderer, `api.to_record` via `data.materialize`)

One state, two questions, packed in one request:

| id | type | instructions | criteria | label |
|---|---|---|---|---|
| `route` | choice | "Which provider and model should serve this chat request?" | every cell James chose at least `--min-count` (20) times, with a one-line description 70% of the time, plus a real `other` option | the cell James chose; rarer cells become `other` |
| `search` | noul | "Does answering this request need a live web search first?" | yes/no descriptions | `used_desearch` |

State rendering reuses kev's variation (`{"document"}`, ticket, chat-turn wrappers). Prompts are
≤500 chars so kev's 384-token state limit holds; nothing is truncated, oversize records are counted
and dropped at freeze time. Generic `james/james` rows carry no decision and are dropped.

## Splits (v3 rules)

- Exact normalised-prompt dedup; when the same prompt was routed differently over time the latest
  decision wins and the conflict is counted in the manifest (that count is James's own
  inconsistency, a floor on any model's disagreement with it).
- **Transfer** = the most recent 20% of decisions by time, development/test alternating. For a
  production router this is the honest held-out set: what James decided after everything the
  model saw. Source name `james_routing_recent`, eval-only.
- **Decision** = the earlier 80%, stratified by cell into train / calibration / development / test
  at 70 / 10 / 10 / 10. Source `james_routing`, trainable.
- Contrast variants (`permuted`, `none_present`, `none_absent`) on development and test, up to 12
  per cell, exactly as kev's freezer does, so none-of-the-above mass and permutation flip rate are
  measured on this data.
- Manifest pins Qwen3-4B-Base and Qwen3-0.6B-Base at the v3 revisions; no Hub API call at freeze.

## Files (overlay on the kev checkout)

```
research/kev-routing/
  bootstrap.sh                       clone kev @ cc954f2 into ./kev and copy overlay/ over it
  scripts/export-james-routing.mjs   Supabase -> data/james_routing.jsonl (prompt, cell, search flag only)
  overlay/kev/james_routing.py       export -> evals/<name>/{decision,transfer} frozen suites
  overlay/kev/typesafe_ref.py        Jev predictor via typesafe-sdk (TYPESAFE_API_KEY, model jev-latest)
  overlay/scripts/runpod_launch.py   pod create -> rsync -> kev.experiment + kev.benchmark -> pull runs/ -> terminate
  overlay/experiments/james-4b.json  Qwen3-4B-Base, 2 epochs, bf16, batch 4 x accum 2, checkpointing
  overlay/experiments/james-smoke.json  Qwen3-0.6B-Base, 1 epoch
```

`james_routing.py` was tested offline against a synthetic export (dedup, conflict counting,
time-ordered transfer, no prompt in two partitions, contrast relabelling, every record renders
through the serving path). The tokenizer admission step, the RunPod launcher and the TypeSafe
predictor could not be exercised here: this session's network policy blocks HuggingFace, RunPod,
Supabase and TypeSafe, and none of the keys are in this environment. Both SDKs were installed
from PyPI and the code is written against their real signatures (`runpod.create_pod`,
`TypeSafeClient.system_one`, `NoulAnswer.noul`, `ChoiceAnswer.probabilities`).

## Run sequence (from your machine, where the keys live)

```bash
# 0. one-time
research/kev-routing/bootstrap.sh
cd research/kev-routing/kev && uv sync --extra serve && cd -

# 1. export James's decisions (prints count and per-cell breakdown; decide smoke vs study from it)
node research/kev-routing/scripts/export-james-routing.mjs

# 2. freeze suites (downloads the two tokenizers from the Hub)
cd research/kev-routing/kev
uv run python -m kev.james_routing --export ../data/james_routing.jsonl --out evals/james-v1-smoke --limit 200 --min-count 5
uv run python -m kev.james_routing --export ../data/james_routing.jsonl --out evals/james-v1

# 3. smoke on RunPod (~10 min, 0.6B), then the real trial
RUNPOD_API_KEY=... uv run python scripts/runpod_launch.py --smoke
RUNPOD_API_KEY=... uv run python scripts/runpod_launch.py --name james-4b-s0

# 4. Jev on the same transfer development split (temperature fit on the decision calibration partition)
TYPESAFE_API_KEY=... uv run python -m kev.typesafe_ref --suite evals/james-v1/transfer --out runs/james-jev-v1 \
    --calibration-suite evals/james-v1/decision

# 5. paired comparison: acc / NLL / Brier deltas with 95% CI, NLL floor sensitivity, none-of-the-above mass
uv run python -m kev.compare --candidate runs/james-4b-s0/transfer-benchmark --reference runs/james-jev-v1 \
    --out runs/kev-vs-jev-james-v1.json
```

ECE raw and after temperature scaling, permutation flip rate, confident-error rate and latency
are in `runs/james-4b-s0/00-trial-0/result.json` (`transfer` block, temperature from calibration)
and in `runs/james-jev-v1/report.json` (`clean` / `calibrated_clean`).

## Cost and safety rails

- RunPod: on-demand secure-cloud H100 80GB. The launcher terminates the pod in a `finally` unless
  `--keep`, and kills the run at `--max-hours` (default 8, smoke 1). At a few thousand records x
  2 epochs the 4B trial is well under an hour; the v3 study did 6.9k record-passes in 13.5 min.
  Expect **under $5** for the trial plus the smoke run.
- TypeSafe: capped at 2,000 calls and 2M input tokens by default; transfer development is a few
  hundred to a couple thousand questions.
- No Kimi spend at all.
- Prerequisites: `RUNPOD_API_KEY`, an SSH public key registered on the RunPod account (private key
  at `--ssh-key`, default `~/.ssh/id_ed25519`), `TYPESAFE_API_KEY`, and Supabase
  `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in the environment or `.env.local`.

## Known limits

- The prompt is the last user turn only, truncated to 500 chars; James saw the whole conversation
  and the persona metadata. Some of James's decisions are therefore not recoverable from the state
  we have, which caps agreement below 100% for any model, Jev included.
- The Docker image tag in the launcher (`KEV_RUNPOD_IMAGE`) is a best guess; RunPod's catalog
  changes. If `create_pod` rejects it, pick any current CUDA 12 PyTorch image; kev installs its own
  Python and deps with `uv`.
- kev's trainer has no mid-run checkpointing; a pod lost mid-trial reruns from the start. At this
  data size that is minutes, not hours.
- Per kev's PLAN.md, a Jev-vs-kev interval that includes zero is "no detectable difference at this
  n", not equivalence. The label-conflict count in the manifest is the natural ceiling to compare
  both against.

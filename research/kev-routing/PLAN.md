# Jev-parity routing model on kev: data conversion plan (for confirmation)

Status: **awaiting confirmation before any GPU or API spend.** Written after reading kev's
README.md, MODEL_CARD.md, PLAN.md, AGENTS.md and the code paths the brief names
(`kev/api.py`, `kev/data.py`, `kev/model.py`, `kev/train.py`, `kev/suite.py`, `kev/study_v3.py`,
`kev/contrastive.py`, `kev/experiment.py`, `kev/benchmark.py`, `kev/jev.py`, `kev/compare.py`,
`modal_app.py`). Upstream pin: `jaredpalmer/kev@cc954f2`.

## What kev already gives us

- **Renderer.** `data.materialize()` turns a labelled TypeSafe-shaped request into the packed
  record through `api.to_record()`, so train and serve text are identical. New sources only
  need to emit labelled requests with a `_meta` block (`source`, `id`, `group_id`, `variant`,
  `text_sha256`, `row_sha256`, optional `pair_id`/`sibling`/`family`).
- **Recipe.** LoRA r=16 on all projection matrices + a 256-d pointer head, cross-entropy per
  question, `--perm_kl 0`, `--ord_w 0` defaults. The v3 study already trained Qwen3-4B-Base
  on an H100 with `batch 4, accum 2, dtype bf16, checkpointing 1` in ~13.5 min for 3.4k records
  x 2 epochs, so the 4B path is proven on CUDA.
- **v3 protocol.** Frozen, checksummed suites with train / calibration / development / locked
  test; grouped splits where minimal-pair siblings share `group_id` and are one bootstrap unit;
  temperature fit on calibration only; `validate_training` refuses eval-only sources and
  held-out structures.
- **Comparison harness.** `runs/kev-vs-jev-transfer-v1.json` came from
  `kev.benchmark` (our model, `rows.json`) + `kev.jev` (Jev, same suite) + `kev.compare`
  (record-clustered paired bootstrap on acc / NLL / Brier, NLL floor sensitivity,
  none-of-the-above mass). `benchmark.summarize` also reports ECE raw and after the
  calibration temperature, permutation flip rate from the `permuted` variant, confident-error
  rate, selective accuracy, and latency. Everything the brief asks for is already computed;
  the only missing piece is a predictor that talks to TypeSafe directly (see Eval).

## Blockers found in this environment

1. **No API keys are present here.** `env` shows nothing for RunPod, Kimi, TypeSafe or
   HuggingFace. The brief says they are "in my env"; they are in your local shell, not in this
   remote container.
2. **The network policy blocks every host the plan needs.** `huggingface.co`,
   `api.runpod.io`, `rest.runpod.io`, `api.kimi.ai`/`api.moonshot.ai`, `api.typesafe.ai` all
   fail at the proxy (403 CONNECT). Only PyPI, npm and GitHub are reachable. Consequences:
   RouterBench cannot be inspected from here, kev's tests cannot run here (they download a
   tokenizer), and the RunPod launcher cannot be exercised here.
3. **Python here is 3.11; kev needs 3.12+.** `uv` is present and can fetch 3.12, but see 2.

So this container can write and commit code; the data build, the RunPod launch, the Kimi
generation and the Jev scoring must run from your machine (or on the pod itself, which has
open egress). The launcher will be written so the pod does the heavy work and the local side
only needs `runpod`, `ssh` and `rsync`.

## Code layout proposal

The designated branch is in `altucher/altucher-news`, which is a Next.js app; `jaredpalmer/kev`
is not in this session's push scope and its `evals/` tree is 66 MB. Proposal: keep everything
under `research/kev-routing/` in this repo as an **overlay** on a pinned kev checkout:

```
research/kev-routing/
  PLAN.md                 this document
  bootstrap.sh            clone kev @ cc954f2 into research/kev-routing/kev and copy the overlay in
  overlay/kev/routing.py            RouterBench -> labelled requests
  overlay/kev/synth_routing.py      Kimi-generated minimal pairs -> labelled requests
  overlay/kev/study_routing.py      freeze evals/routing-v1/{decision,transfer} suites
  overlay/kev/typesafe_ref.py       direct TypeSafe predictor (model jev-latest)
  overlay/scripts/runpod_launch.py  pod create, rsync, run, pull runs/ back
  overlay/experiments/routing-4b.json
```

The kev checkout itself is gitignored; only the overlay is committed. Alternative: fork kev under
your GitHub account and add it to the session with `add_repo`. Say which you prefer.

## Data source 1: RouterBench (`withmartian/routerbench`)

What I remember about the dataset (**unverified from here, verify on first load**): two pickled
DataFrames, `routerbench_0shot.pkl` and `routerbench_5shot.pkl`, ~36.5k prompts over 8 eval
families (`mmlu`, `hellaswag`, `gsm8k`, `arc-challenge`, `winogrande`, `mbpp`, `mt-bench`,
`rag`), 11 candidate models (gpt-4-1106-preview, gpt-3.5-turbo-1106, claude-v1, claude-v2,
claude-instant-v1, llama-2-70b-chat, mixtral-8x7b-chat, mistral-7b-chat,
code-llama-34b-instruct, WizardLM-13B-V1.2, Yi-34B-Chat). Columns: `sample_id`, `eval_name`,
`prompt`, `oracle_model_to_route_to`, and per model `<model>` (performance, 0/1 for most
families, graded for mt-bench and rag), `<model>|model_response`, `<model>|total_cost`.

### Conversion (one state, three question kinds, all packed in one request)

State: the prompt, rendered as `{"task": <prompt>}` or the plain string with kev's usual
~32% structured wrapping. **Use the 0-shot file as the primary source**; 5-shot prompts run to
1k+ tokens and would either be rejected by strict encoding or force a much larger state budget.

| id | type | instructions | criteria | label |
|---|---|---|---|---|
| `route` | choice | "Which model should handle this request?" | the 11 models with one-line descriptions (size, cost tier, strengths), plus a real none option | cheapest model whose performance >= pass threshold; **none** when no model passed |
| `small_ok` | noul | "Can a small, cheap model handle this correctly?" | true/false descriptions | any model in the small tier passed |
| `difficulty` | score | "How hard is this request for current models?" | 4 ordered levels: all pass / most pass / few pass / none pass | from the fraction of the 11 that passed |
| `pass_<model>` | noul | "Would <model> answer this correctly?" | none | that model's pass/fail |

Notes and decisions to confirm:

- **Pass threshold.** Binary families are exact (performance == 1). For mt-bench and rag the
  score is graded; proposal: pass = score >= 0.5 of the family's max. Alternative: drop the
  two graded families from the outcome questions.
- **Choice label rule.** "Cheapest passing model" is the routing decision with a cost table;
  ties broken by cost from the row's own `|total_cost`. If you prefer the dataset's
  `oracle_model_to_route_to` column verbatim, say so. Either way the none option is real: it is
  the label when no model passed, and kev's none-present / none-absent variants then measure
  something meaningful.
- **Small tier.** Proposal: `mistral-7b-chat`, `WizardLM-13B-V1.2`, `gpt-3.5-turbo-1106`,
  `claude-instant-v1`. Confirm or edit.
- **Per-model Nouls.** 11 per state costs nothing at inference (one prefill) but 11 correlated
  branches dominate the loss average per record. Proposal: all 11 in the frozen suite, and a
  `--max_pass_questions 4` sampling knob at training time (fresh sample per epoch, same as kev's
  augmentation). Alternative: drop them from training and keep only `route`, `small_ok`,
  `difficulty`.
- **Context budget.** kev encodes at 384 state / 1,024 branch tokens and rejects longer states
  when strict. Even 0-shot prompts (rag, mt-bench) exceed 384. Proposal: make the limits suite
  properties (`manifest.context`) and set 1,536 state / 2,048 branch / 4,096 packed for the
  routing suites. `train.py` and `LocalPredictor` will read them from the manifest instead of the
  module constants, so a trial config still cannot change the evaluator. Records that do not fit
  are rejected at freeze time and counted in the manifest, never truncated.
- **Rendering variation.** Reuse kev's `_wrap_state`, `_instr`, `_desc` rates so the routing
  data does not sit in one template.
- **Provenance.** `_meta.id = routerbench/0shot/<sample_id>`, `text_sha256` over the
  normalised prompt for exact-match dedup across partitions, `group_id = sample_id`.

### Splits

Group = `sample_id`; stratify train / calibration / development / test by `eval_name`;
exact-state dedup across partitions (kev's `select_unique`). Calibration is stratified by family
with groups intact (v3 rule).

## Data source 2: synthetic routing states labelled by Kimi K3

Generator: Kimi K3 via the OpenAI-compatible API at platform.kimi.ai. **I need the env var
name for the key, the base URL and the exact model id** (`KIMI_API_KEY`,
`https://api.moonshot.ai/v1`, `kimi-k3` are my guesses; all three will be configurable).

Template families (proposal, 8): `coding_agent_trace`, `tool_call_sequence`,
`multi_turn_support`, `data_extraction`, `long_context_summary`, `math_reasoning`,
`creative_rewrite`, `safety_sensitive`. Each item = a rule-like routing situation rendered as
an agent transcript / tool-call trace / multi-turn ask, ~10k items total (~1,250 per family).

Questions per state (same three kinds; the option vocabulary is routing tiers rather than the
RouterBench model list, and the two vocabularies deliberately coexist so the Choice head does
not memorise one option set):

- `route` choice over `{small_fast, mid_general, frontier, code_specialist, needs_tool_or_human}`
  plus a none option
- `small_ok` noul
- `difficulty` score, same 4 levels

Minimal pairs per PLAN.md / `contrastive.check_pair`, applied to LLM data:

1. Kimi writes the base state **and declares the decisive fact** as a structured field.
2. Kimi produces the relevant sibling (one decisive fact changed) and the irrelevant sibling (one
   routing-irrelevant detail changed, e.g. a name, a timestamp, a tool id).
3. A **separate** Kimi call labels each of the three states independently, blind to the others.
4. Keep the group only if: relevant sibling's `route` label differs from the base, irrelevant
   sibling's labels all match the base, and re-labelling the base a second time agrees. Rejection
   reasons are recorded in the manifest like `contrastive.generate` does.
5. All siblings share `group_id`, sit in one split, and form one bootstrap unit.

Two template families are held out entirely and appear only in the transfer suite.

**Honest caveat, per kev's PLAN.md:** these labels are Kimi's judgement, not outcomes.
Independent labelling calls reduce but do not remove correlated label error, and a
"parity with Jev" result on this slice means agreement with Kimi, not correctness. The
RouterBench held-out slice, which has real pass/fail outcomes, should carry the primary parity
claim; the synthetic transfer slice measures template transfer.

Budget: roughly 10k groups x (1 generation + 4 labelling calls) ≈ 50k calls; token volume
depends on transcript length, ballpark 60–100M tokens. **Give me a hard USD cap** for the Kimi
run; the generator will stop at the cap and freeze what it has.

## Suites

`evals/routing-v1/decision`: RouterBench trainable families + 6 synthetic families; partitions
train / calibration / development / test, contrast variants (`permuted`, `none_present`,
`none_absent`) on development and test as kev does.

`evals/routing-v1/transfer`: development + test only, from
**2 held-out RouterBench families** and **2 held-out synthetic template families**.
Proposal for the RouterBench holdouts: `mbpp` (code) and `rag` (retrieval), the two most unlike
the rest. Alternative: hold out only synthetic families and train on all RouterBench families.
The brief says "hold out 2 template families"; confirm whether that means synthetic only.

Manifest pins `Qwen/Qwen3-4B-Base` at `906bfd4b4dc7f14ee4320094d8b41684abff8539` (the v3
revision), the RouterBench dataset revision, the Kimi model id, and the context limits above.

## Training

One trial in `experiments/routing-4b.json`:

```json
[{"base": "Qwen/Qwen3-4B-Base", "seed": 0, "epochs": 2, "batch": 4, "accum": 2,
  "dtype": "bf16", "checkpointing": 1}]
```

`perm_kl` and `ord_w` stay at their defaults (0). Estimated wall time on one H100 80GB: the v3
4B trial did ~6.9k record-passes in 13.5 min at ≤2k packed tokens (~0.12 s/record). Here:
~46k records x 2 epochs = 92k passes at up to 4k tokens; assume 2–3x per record → **4–7 hours
of training plus ~30 min of evaluation**. At RunPod's H100 80GB on-demand rate that is
roughly $15–30. Two mitigations I will build in: an end-of-epoch checkpoint so a lost pod costs
at most one epoch, and a `--smoke` path (200 records, ~5 min) that runs first.

## RunPod launcher (`scripts/runpod_launch.py`)

Mirrors `modal_app.py`'s contract: hash `kev/*.py` locally, refuse to overwrite an existing
study, record the git commit, pull `runs/<study>` back and rank with
`kev.experiment --aggregate`. Mechanics: `runpod` SDK creates an on-demand (secure cloud, not
spot) pod from a CUDA 12 PyTorch image with a persistent volume for the HF cache, exposes SSH,
waits for the runtime port, `rsync`s the kev checkout + `evals/routing-v1`, runs
`uv sync && python -m kev.experiment --suite ... --plan ... --transfer ...` under `nohup` with the
log tailed, `rsync`s `runs/<study>` back, and **terminates the pod** in a `finally` (this is the
step that prevents the money leak; a `--keep` flag disables it). Needs `RUNPOD_API_KEY` and an
SSH public key registered in your RunPod account.

## Eval

1. Our model on `evals/routing-v1/transfer` development: produced inside the trial by
   `--transfer` (temperature from the calibration partition is applied unchanged).
2. Jev on the same suite via a new `kev/typesafe_ref.py`: a predictor with the same interface as
   `JevPredictor` but using `typesafe-sdk` directly (`TypeSafeClient(api_key, model="jev-latest")`),
   budget-capped, raw responses preserved. `kev.jev` goes through Vercel AI Gateway and expects
   `AI_GATEWAY_API_KEY`, which is not what you have. **Confirm the env var name for the TypeSafe
   key** (`TYPESAFE_API_KEY`?). Jev's temperature will also be fit on the calibration partition so
   the "ECE after scaling" column is like-for-like; raw ECE is reported too.
3. `kev.compare --candidate <trial>/transfer --reference runs/routing-jev-v1 --out
   runs/kev-vs-jev-routing-v1.json` → paired bootstrap acc / NLL / Brier deltas with 95% CI,
   NLL floor sensitivity, none-of-the-above mass on none-present / none-absent. The report
   already carries ECE raw and calibrated, permutation flip rate, and latency (local GPU vs
   hosted, not comparable hardware; kev's caveat stands).

Target as stated: accuracy CI overlapping Jev's on the transfer split. Per kev's PLAN.md, an
interval that includes zero is not evidence of equivalence; I will report it as "no detectable
difference at n=…" and also report the width.

## Questions that gate spending

1. Code location: overlay in this repo (proposed) or a kev fork added to the session?
2. RouterBench: 0-shot only (proposed) or both files? Pass threshold for mt-bench / rag?
   Choice label = cheapest passing (proposed) or the dataset's oracle column? Small-tier
   membership?
3. Per-model Nouls: keep with per-epoch subsampling (proposed), or drop from training?
4. Context limits 1,536 / 2,048 / 4,096 as suite properties: ok?
5. Transfer holdouts: 2 RouterBench families (`mbpp`, `rag`) **and** 2 synthetic families
   (proposed), or synthetic only?
6. Kimi: env var, base URL, model id, hard USD cap.
7. TypeSafe: env var name for the key. Budget cap for Jev calls (transfer dev is ~1.5–2k
   questions; kev's default was $0.10 at $0.042/M input tokens, so a $1 cap is ample).
8. RunPod: confirm on-demand secure cloud H100 80GB, ~$30 training budget, and that an SSH key
   is registered on the account.

Nothing runs against an API or a GPU until these are answered.

"""James's routing decisions -> kev training suites.

Source: research/kev-routing/data/james_routing.jsonl, exported from analytics_events by
scripts/export-james-routing.mjs. Each row is one James-served chat: the user's last message
(cut at 500 chars by the app) and the cell James chose, recorded as "james/<provider>/<model>"
or "james/<harness>" from the x-james-route header, plus whether James searched.

Labels are James's decisions, not outcomes. A model trained here imitates James's routing
policy; the evaluation measures agreement with James, for kev and for Jev alike.

    uv run python -m kev.james_routing --export ../data/james_routing.jsonl --out evals/james-v1
    uv run python -m kev.james_routing --export ../data/james_routing.jsonl --out evals/james-v1-smoke --limit 200

Writes <out>/decision (train / calibration / development / test, stratified by cell, groups
intact) and <out>/transfer (development / test only) from the most recent records by time.
The transfer partition is the honest held-out set for a production router: it is what James
decided after everything the model saw.
"""
import argparse
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

SOURCE, RECENT = "james_routing", "james_routing_recent"
# Pinned base revisions (the v3 study's); freezing does not call the Hub API.
BASE_REVISIONS = {"Qwen/Qwen3-0.6B-Base": "da87bfb608c14b7cf20ba1ce41287e8de496c0cd",
                  "Qwen/Qwen3-4B-Base": "906bfd4b4dc7f14ee4320094d8b41684abff8539"}
OTHER = ("other", "A provider or model not listed here")
PROVIDERS = {"engy": "Engy verified inference", "chutes": "Chutes TEE inference", "saygm": "Saygm", "gateway": "Vercel AI Gateway",
             "openai": "OpenAI", "anthropic": "Anthropic", "google": "Google", "moonshot": "Moonshot", "deepseek": "DeepSeek"}


def parse_cell(model):
    """'james/engy/glm-5.2' -> 'engy/glm-5.2'; 'james/search-harness' -> 'harness:search-harness'; generic -> None."""
    parts = (model or "").split("/")
    if len(parts) < 2 or parts[0] != "james":
        return None
    if len(parts) >= 3:
        return f"{parts[1]}/{'/'.join(parts[2:])}"
    return None if parts[1] in ("james", "") else f"harness:{parts[1]}"


def cell_description(cell):
    if cell.startswith("harness:"):
        return f"James's {cell.split(':', 1)[1]} harness"
    provider, _, model = cell.partition("/")
    return f"{model} on {PROVIDERS.get(provider, provider)}"


def text_hash(prompt):
    return hashlib.sha256(" ".join(prompt.casefold().split()).encode()).hexdigest()


def load_export(path):
    rows = [json.loads(line) for line in Path(path).read_text().splitlines() if line.strip()]
    kept, report = [], Counter()
    for r in rows:
        report["rows"] += 1
        cell = parse_cell(r.get("model"))
        prompt = (r.get("prompt") or "").strip()
        if not cell:
            report["no_cell"] += 1; continue
        if len(prompt) < 3:
            report["no_prompt"] += 1; continue
        kept.append({**r, "prompt": prompt, "cell": cell})
    return kept, report


def dedupe(rows):
    """One record per normalised prompt; the latest decision wins. Conflicts (same prompt, different cell) are counted."""
    by_hash = {}
    conflicts = 0
    for r in sorted(rows, key=lambda r: r["created_at"]):
        h = text_hash(r["prompt"])
        prev = by_hash.get(h)
        if prev and prev["cell"] != r["cell"]:
            conflicts += 1
        by_hash[h] = r
    return list(by_hash.values()), conflicts


def vocabulary(rows, min_count):
    counts = Counter(r["cell"] for r in rows)
    return sorted(c for c, n in counts.items() if n >= min_count), counts


def to_request(row, vocab, rng, source=SOURCE):
    from kev.data import _instr, _wrap_state

    criteria = {c: (cell_description(c) if rng.random() < 0.7 else None) for c in vocab}
    criteria[OTHER[0]] = OTHER[1]
    label = row["cell"] if row["cell"] in criteria else OTHER[0]
    questions = {"route": {"type": "choice", "instructions": _instr("Which provider and model should serve this chat request?", rng),
                           "criteria": criteria, "label": label, "src": "james_route"},
                 "search": {"type": "noul", "instructions": "Does answering this request need a live web search first?",
                            "criteria": {"true": "Depends on current prices, news, or recent events", "false": "Answerable without looking anything up"},
                            "label": bool(row.get("used_desearch")), "src": "james_search"}}
    h = text_hash(row["prompt"])
    return {"state": _wrap_state(row["prompt"], rng), "questions": questions,
            "_meta": {"source": source, "repo": None, "revision": None, "split": "export", "row": str(row["id"]),
                      "id": f"{source}/{row['id']}", "group_id": f"{source}/{row['id']}", "variant": "clean",
                      "text_sha256": h, "row_sha256": hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest(),
                      "created_at": row["created_at"], "cell": row["cell"]}}


def stratified(rows, fractions, seed):
    """Split rows by cell into partitions with the given fractions (train, calibration, development, test)."""
    parts = defaultdict(list)
    by_cell = defaultdict(list)
    for r in rows:
        by_cell[r["cell"]].append(r)
    names = ("train", "calibration", "development", "test")
    for cell in sorted(by_cell):
        items = by_cell[cell]
        random.Random(f"{seed}:{cell}").shuffle(items)
        n = len(items)
        cuts, start = [], 0
        for f in fractions[:-1]:
            end = start + round(n * f); cuts.append((start, end)); start = end
        cuts.append((start, n))
        for name, (a, b) in zip(names, cuts):
            parts[name].extend(items[a:b])
    return parts


def freeze(export, out, seed=20260919, min_count=20, transfer_fraction=0.2, limit=0, contrast_per_cell=12, admission=True):
    from kev.data import materialize
    from kev.model import encode, load_tokenizer
    from kev.suite import SPLITS, contrast_cases, digest, write_json

    out = Path(out)
    if out.exists():
        raise FileExistsError(f"refusing to overwrite frozen suite {out}")
    rows, report = load_export(export)
    rows, conflicts = dedupe(rows)
    rows.sort(key=lambda r: r["created_at"])
    if limit:
        rows = rows[-limit:]
    if len(rows) < 50:
        raise ValueError(f"only {len(rows)} usable James decisions; need at least 50")
    vocab, counts = vocabulary(rows, min_count)
    if len(vocab) < 2:
        raise ValueError(f"fewer than two cells reach min_count={min_count}: {dict(counts)}")
    cut = int(len(rows) * (1 - transfer_fraction))
    past, recent = rows[:cut], rows[cut:]
    tokenizers = [load_tokenizer(b, revision=r) for b, r in BASE_REVISIONS.items()] if admission else []

    def admit(records):
        kept, rejected = [], 0
        for r in records:
            try:
                rec = materialize(r)
                for tok in tokenizers:
                    if len(encode(tok, rec, strict=True)["ids"]) > 2048:
                        raise ValueError("packed")
                kept.append(r)
            except ValueError:
                rejected += 1
        return kept, rejected

    rng = random.Random(seed)
    parts = stratified(past, (0.7, 0.1, 0.1, 0.1), seed)
    decision = {s: [to_request(r, vocab, rng) for r in parts[s]] for s in SPLITS}
    recent_reqs = [to_request(r, vocab, rng, source=RECENT) for r in recent]
    transfer = {"train": [], "calibration": [], "development": recent_reqs[0::2], "test": recent_reqs[1::2]}
    admission_report = {}
    for name, partitions in (("decision", decision), ("transfer", transfer)):
        for split in SPLITS:
            partitions[split], rejected = admit(partitions[split])
            admission_report[f"{name}/{split}"] = {"records": len(partitions[split]), "context_rejected": rejected}
        for split in ("development", "test"):
            extras, per_cell = [], Counter()
            for r in partitions[split]:
                cell = r["_meta"]["cell"]
                if per_cell[cell] < contrast_per_cell:
                    variants = contrast_cases(r, seed)
                    variants, _ = admit(variants)
                    extras.extend(variants); per_cell[cell] += bool(variants)
            partitions[split].extend(extras)

    common = {"version": 3, "seed": seed, "base_revisions": BASE_REVISIONS, "dataset_revisions": {},
              "export": {"path": str(export), "sha256": digest(export), **report, "deduplicated": len(rows), "label_conflicts": conflicts,
                         "limit": limit, "cells": dict(counts), "vocabulary": vocab, "min_count": min_count},
              "context": {"max_state": 384, "max_branch": 1024, "max_packed": 2048, "truncate": False},
              "labels": "James's routing decisions (x-james-route), not outcomes; agreement with James is what is measured.",
              "selection": "Exact normalised-prompt dedup, latest decision wins; transfer = most recent fraction by time; decision stratified by cell.",
              "admission": admission_report, "files": {}}
    for name, partitions, manifest in (
            ("decision", decision, {**common, "holdout_sources": [], "trainable_sources": [SOURCE], "eval_only_sources": []}),
            ("transfer", transfer, {**common, "holdout_sources": [RECENT], "trainable_sources": [], "eval_only_sources": [RECENT],
                                     "transfer_fraction": transfer_fraction, "cutoff": recent[0]["created_at"] if recent else None})):
        folder = out / name
        folder.mkdir(parents=True, exist_ok=False)
        for split in SPLITS:
            path = folder / f"{split}.jsonl"
            path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in partitions[split]))
            manifest["files"][path.name] = {"sha256": digest(path), "records": len(partitions[split]),
                                            "questions": sum(len(r["questions"]) for r in partitions[split])}
        manifest["code_hashes"] = {p.name: digest(p) for p in Path(__file__).parent.glob("*.py")}
        write_json(folder / "manifest.json", manifest)
        print(name, json.dumps(manifest["files"]), flush=True)
    print(json.dumps({"cells": dict(counts), "vocabulary": vocab, "label_conflicts": conflicts, "admission": admission_report}, indent=2))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--export", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=20260919)
    ap.add_argument("--min-count", type=int, default=20, help="cells chosen fewer times collapse into 'other'")
    ap.add_argument("--transfer-fraction", type=float, default=0.2, help="most recent fraction of decisions held out as transfer")
    ap.add_argument("--limit", type=int, default=0, help="use only the N most recent decisions (smoke suites)")
    ap.add_argument("--no-admission", action="store_true", help="skip tokenizer context admission (offline tests only)")
    a = ap.parse_args()
    if not 0 < a.transfer_fraction < 0.5:
        ap.error("transfer fraction must be in (0, 0.5)")
    freeze(a.export, a.out, a.seed, a.min_count, a.transfer_fraction, a.limit, admission=not a.no_admission)


if __name__ == "__main__":
    main()

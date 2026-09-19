"""Score a frozen suite with TypeSafe's Jev through the official SDK (direct API, not the Vercel gateway).

    TYPESAFE_API_KEY=... uv run python -m kev.typesafe_ref --suite evals/james-v1/transfer --out runs/james-jev-v1

Same predictor contract as kev.jev.JevPredictor, so kev.benchmark.evaluate_records and kev.compare work
unchanged. Raw responses are kept in predictions.jsonl. Calls and input tokens are capped.
"""
import argparse
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from kev.benchmark import api_request, evaluate_records, fit_temperature
from kev.suite import digest, load_split, write_json


class TypeSafePredictor:
    def __init__(self, model="jev-latest", max_calls=2000, max_input_tokens=2_000_000, timeout=30.0):
        from typesafe_sdk import RetryPolicy, TypeSafeClient

        self.model, self.max_calls, self.max_input_tokens = model, max_calls, max_input_tokens
        self.calls = self.input_tokens = self.output_tokens = 0
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.client = TypeSafeClient(model=model, timeout=timeout, retry=RetryPolicy(max_retries=3))

    def close(self):
        self.client.close()

    def __call__(self, record):
        from typesafe_sdk import Choice, Noul, Score

        if self.calls >= self.max_calls or self.input_tokens >= self.max_input_tokens:
            raise RuntimeError("TypeSafe evaluation reached the call or token cap")
        request = api_request(record)
        questions = {}
        for qid, q in request["questions"].items():
            if q["type"] == "noul":
                questions[qid] = Noul(instructions=q["instructions"], criteria=q.get("criteria"))
            elif q["type"] == "choice":
                questions[qid] = Choice(instructions=q["instructions"], criteria=q["criteria"])
            else:
                questions[qid] = Score(instructions=q["instructions"], criteria=q["criteria"])
        start = time.perf_counter()
        response = self.client.system_one(state=request["state"], questions=questions)
        latency_ms = 1000 * (time.perf_counter() - start)
        self.calls += 1
        self.input_tokens += response.usage.input_tokens
        self.output_tokens += response.usage.output_tokens
        probabilities, raw = {}, {}
        for qid, q in record["questions"].items():
            answer = response.answers[qid]
            raw[qid] = answer.model_dump()
            if q["type"] == "noul":
                probabilities[qid] = {"false": 1 - answer.noul, "true": answer.noul}
            elif q["type"] == "choice":
                probabilities[qid] = dict(answer.probabilities)
            else:
                probabilities[qid] = {str(k): v for k, v in answer.probabilities.items()}
        return {"probabilities": probabilities, "answers": raw, "model": response.model, "latency_ms": latency_ms,
                "usage": response.usage.model_dump()}

    def accounting(self):
        return {"model": self.model, "provider": "TypeSafe direct API via typesafe-sdk", "started_at": self.started_at,
                "calls": self.calls, "input_tokens": self.input_tokens, "output_tokens": self.output_tokens,
                "max_calls": self.max_calls, "max_input_tokens": self.max_input_tokens}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=os.environ.get("TYPESAFE_DEFAULT_MODEL", "jev-latest"))
    ap.add_argument("--max-calls", type=int, default=2000)
    ap.add_argument("--max-input-tokens", type=int, default=2_000_000)
    ap.add_argument("--calibration-suite", help="frozen suite whose calibration partition fits a temperature for the reference (like-for-like ECE)")
    a = ap.parse_args()
    if Path(a.out).exists():
        ap.error("output directory already exists")
    if not os.environ.get("TYPESAFE_API_KEY"):
        ap.error("TYPESAFE_API_KEY is not set")
    manifest = json.loads((Path(a.suite) / "manifest.json").read_text())
    predictor = TypeSafePredictor(a.model, a.max_calls, a.max_input_tokens)
    try:
        temperature = 1.0
        if a.calibration_suite:
            _, rows = evaluate_records(load_split(a.calibration_suite, "calibration"), predictor, Path(a.out) / "calibration")
            temperature = fit_temperature(rows)
        records = load_split(a.suite, "development")
        report, _ = evaluate_records(records, predictor, Path(a.out) / "development", temperature,
                                     heldout_sources=tuple(manifest.get("holdout_sources", [])))
        # kev.compare pairs <dir>/report.json with <dir>/rows.json; keep them at the top level like kev.benchmark does
        for name in ("rows.json", "predictions.jsonl"):
            (Path(a.out) / name).write_bytes((Path(a.out) / "development" / name).read_bytes())
        report.update(suite_sha256=digest(Path(a.suite) / "manifest.json"), split="development", run=a.model,
                      calibration_applied=bool(a.calibration_suite), provider=predictor.accounting())
        write_json(Path(a.out) / "report.json", report)
        print(json.dumps({"clean": report["clean"], "calibrated_clean": report["calibrated_clean"], "temperature": temperature,
                          "permutation": report["permutation"], "latency_ms": report["latency_ms"], "provider": report["provider"]}, indent=2))
    finally:
        predictor.close()
        if Path(a.out).exists():
            write_json(Path(a.out) / "usage.json", predictor.accounting())


if __name__ == "__main__":
    main()

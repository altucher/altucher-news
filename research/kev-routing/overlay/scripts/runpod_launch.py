"""Run one kev study on a RunPod H100, the way modal_app.py runs one on Modal.

    RUNPOD_API_KEY=... uv run python scripts/runpod_launch.py --smoke                      # 0.6B, 1 epoch, ~10 min end to end
    RUNPOD_API_KEY=... uv run python scripts/runpod_launch.py --suite evals/james-v1/decision \\
        --plan experiments/james-4b.json --transfer evals/james-v1/transfer --name james-4b-s0

Steps: create an on-demand secure-cloud pod with SSH, rsync this checkout (kev/, evals/, experiments/, lock files),
run `kev.experiment` under nohup, poll until it writes a done marker, run `kev.benchmark` on the transfer suite for
the trained checkpoint (rows.json for kev.compare), rsync runs/<name> back, and terminate the pod in a `finally`.
Provenance matches the Modal path: KEV_GIT_COMMIT is exported into the pod and kev/*.py hashes are checked there.

Needs: RUNPOD_API_KEY, an SSH public key registered in the RunPod account (Settings -> SSH Public Keys) whose
private key is at --ssh-key, and `rsync` + `ssh` locally. Nothing is spent until create_pod returns.
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOTE = "/workspace/kev"
GPU = "NVIDIA H100 80GB HBM3"
IMAGE = os.environ.get("KEV_RUNPOD_IMAGE", "runpod/pytorch:2.8.0-py3.11-cuda12.8.1-cudnn-devel-ubuntu22.04")
RATE_USD_PER_HOUR = 3.0   # on-demand secure H100 80GB, upper bound as of 2026-09; the pod's costPerHr is printed at launch


def sh(*args, check=True, capture=False):
    print("$", " ".join(shlex.quote(a) for a in args), flush=True)
    return subprocess.run(args, check=check, text=True, capture_output=capture)


def ssh_target(pod):
    for p in (pod.get("runtime") or {}).get("ports") or []:
        if p.get("privatePort") == 22 and p.get("isIpPublic"):
            return p["ip"], int(p["publicPort"])
    return None


def wait_for_ssh(runpod, pod_id, key, timeout=900):
    start = time.time()
    while time.time() - start < timeout:
        pod = runpod.get_pod(pod_id)
        target = ssh_target(pod)
        if target:
            ip, port = target
            probe = subprocess.run(["ssh", *ssh_opts(key, port), f"root@{ip}", "true"], capture_output=True)
            if probe.returncode == 0:
                return ip, port
        time.sleep(10)
    raise TimeoutError("pod did not become reachable over SSH")


def ssh_opts(key, port):
    return ["-i", key, "-p", str(port), "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR", "-o", "ServerAliveInterval=30"]


def remote(ip, port, key, script, check=True):
    return sh("ssh", *ssh_opts(key, port), f"root@{ip}", "bash", "-lc", script, check=check)


def rsync(src, dst, key, port, excludes=()):
    args = ["rsync", "-az", "--delete", "-e", f"ssh {' '.join(ssh_opts(key, port))}"]
    for e in excludes:
        args += ["--exclude", e]
    sh(*args, src, dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", default="evals/james-v1/decision")
    ap.add_argument("--plan", default="experiments/james-4b.json")
    ap.add_argument("--transfer", default="evals/james-v1/transfer")
    ap.add_argument("--name", help="study name; results land in runs/<name>")
    ap.add_argument("--smoke", action="store_true", help="0.6B, one epoch, on the smoke suites")
    ap.add_argument("--gpu", default=GPU)
    ap.add_argument("--max-hours", type=float, default=8.0, help="terminate the pod after this many hours no matter what")
    ap.add_argument("--ssh-key", default=os.path.expanduser("~/.ssh/id_ed25519"))
    ap.add_argument("--keep", action="store_true", help="leave the pod running afterwards (you pay for it)")
    ap.add_argument("--volume-gb", type=int, default=100)
    a = ap.parse_args()

    if a.smoke:
        a.suite, a.plan, a.transfer = "evals/james-v1-smoke/decision", "experiments/james-smoke.json", "evals/james-v1-smoke/transfer"
        a.name = a.name or "james-smoke"
        a.max_hours = min(a.max_hours, 1.0)
    if not a.name or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", a.name):
        ap.error("--name must be a simple unique identifier")
    if (ROOT / "runs" / a.name).exists():
        ap.error("choose a new study name; existing results are immutable")
    for p in (a.suite, a.plan, a.transfer):
        if not (ROOT / p).exists():
            ap.error(f"missing: {p} (freeze the suites first: python -m kev.james_routing ...)")
    if not Path(a.ssh_key).exists():
        ap.error(f"SSH private key not found: {a.ssh_key}")
    if not os.environ.get("RUNPOD_API_KEY"):
        ap.error("RUNPOD_API_KEY is not set")

    sys.path.insert(0, str(ROOT))
    from kev.experiment import load_plan, source_hashes
    trials = load_plan(ROOT / a.suite, ROOT / a.plan)          # validates the plan against the suite before any spend
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    hashes = source_hashes()
    print(f"{len(trials)} trial(s); compute upper bound ${RATE_USD_PER_HOUR * a.max_hours:.2f} at {a.max_hours}h cap", flush=True)

    import runpod
    runpod.api_key = os.environ["RUNPOD_API_KEY"]
    pod = runpod.create_pod(name=f"kev-{a.name}", image_name=IMAGE, gpu_type_id=a.gpu, cloud_type="SECURE",
                            container_disk_in_gb=60, volume_in_gb=a.volume_gb, volume_mount_path="/workspace",
                            ports="22/tcp", min_vcpu_count=8, min_memory_in_gb=48,
                            env={"HF_HOME": "/workspace/hf", "HF_HUB_DISABLE_PROGRESS_BARS": "1", "TOKENIZERS_PARALLELISM": "false"})
    pod_id = pod["id"]
    started = time.time()
    print(f"pod {pod_id} created", flush=True)
    try:
        ip, port = wait_for_ssh(runpod, pod_id, a.ssh_key)
        info = runpod.get_pod(pod_id)
        print(f"ssh root@{ip} -p {port}; {info.get('machine', {}).get('gpuDisplayName')} at ${info.get('costPerHr')}/h", flush=True)
        remote(ip, port, a.ssh_key, f"mkdir -p {REMOTE} /workspace/hf && command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh")
        rsync(f"{ROOT}/", f"root@{ip}:{REMOTE}/", a.ssh_key, port,
              excludes=[".git", "runs", "playground/node_modules", "playground/.next", ".venv", "__pycache__", "*.pyc"])
        marker = f"{REMOTE}/runs/{a.name}.done"
        job = " && ".join([
            f"cd {REMOTE}", "export PATH=$HOME/.local/bin:$PATH", f"export KEV_GIT_COMMIT={commit}",
            "uv sync --extra serve",
            f"uv run python -m kev.experiment --suite {a.suite} --plan {a.plan} --transfer {a.transfer} --out runs/{a.name} --device cuda",
            f"ckpt=$(ls -d runs/{a.name}/*/checkpoint | head -1)",
            f"uv run python -m kev.benchmark --run $ckpt --suite {a.transfer} --out runs/{a.name}/transfer-benchmark --device cuda",
        ])
        remote(ip, port, a.ssh_key, f"mkdir -p {REMOTE}/runs && nohup bash -c {shlex.quote(job + f'; echo $? > {marker}')} > {REMOTE}/runs/{a.name}.log 2>&1 &")
        seen, status = 0, ""
        while not status:
            if time.time() - started > a.max_hours * 3600:
                raise TimeoutError(f"--max-hours {a.max_hours} reached; terminating")
            time.sleep(60)
            probe = subprocess.run(["ssh", *ssh_opts(a.ssh_key, port), f"root@{ip}",
                                    f"tail -c +{seen + 1} {REMOTE}/runs/{a.name}.log | head -c 20000; printf '\\n@@marker '; cat {marker} 2>/dev/null"],
                                   capture_output=True, text=True)
            if probe.returncode != 0:
                print("ssh poll failed; retrying", flush=True); continue
            log, _, status = probe.stdout.rpartition("\n@@marker ")
            status = status.strip()
            if log:
                seen += len(log.encode()); sys.stdout.write(log); sys.stdout.flush()
        (ROOT / "runs").mkdir(exist_ok=True)
        rsync(f"root@{ip}:{REMOTE}/runs/{a.name}/", f"{ROOT}/runs/{a.name}/", a.ssh_key, port)
        rsync(f"root@{ip}:{REMOTE}/runs/{a.name}.log", f"{ROOT}/runs/{a.name}.log", a.ssh_key, port)
        if status != "0":
            raise SystemExit(f"remote job exited {status}; see runs/{a.name}.log")
        ledger = ROOT / "runs" / a.name / "results.jsonl"
        print(ledger.read_text() if ledger.exists() else "no ledger written", flush=True)
        print(f"provenance: commit {commit}, {len(hashes)} source hashes; wall {(time.time() - started) / 3600:.2f}h", flush=True)
    finally:
        if a.keep:
            print(f"--keep: pod {pod_id} left running; terminate it yourself", flush=True)
        else:
            runpod.terminate_pod(pod_id)
            print(f"pod {pod_id} terminated", flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""In-container sandbox runner — the Daytona-equivalent lifecycle.

This is the operational dispatcher for environments where app.daytona.io is
unreachable (this build container; user directive: no additional access). It
performs exactly what convex/daytona.ts does in production, step for step:

    due search -> isolated child process running scrapers/run.py ("sandbox")
              -> scraper POSTs to /ingest -> markRun(lastRunAt/lastError)
              -> process torn down (kill on timeout; never left running)

One failed search never blocks the others: each runs in its own process with
its own markRun, and dispatch uses a pool capped at 3 (ARCHITECTURE §8).

    python3 scripts/dispatch_local.py --once [--items-file fixtures.json]
    python3 scripts/dispatch_local.py --loop 60      # poll every 60s
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUN_PY = ROOT / "scrapers" / "run.py"
CONCURRENCY_CAP = 3
SANDBOX_TIMEOUT_SECONDS = 120

log = logging.getLogger("carhunter.dispatch")


def convex_run(function: str, args_json: str = "{}") -> dict | list | None:
    result = subprocess.run(
        ["npx", "convex", "run", function, args_json],
        capture_output=True,
        text=True,
        cwd=ROOT,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"convex run {function} failed: {result.stderr[:300]}")
    return json.loads(result.stdout) if result.stdout.strip() else None


def build_config(search: dict, ingest_url: str, ingest_secret: str) -> dict:
    # mirrors the config convex/daytona.ts hands to the sandbox
    return {
        "searchId": search["_id"],
        "sources": search["sources"],
        "makes": search["makes"],
        "models": search["models"],
        "yearMin": search["yearMin"],
        "yearMax": search["yearMax"],
        "mileageMin": search["mileageMin"],
        "mileageMax": search["mileageMax"],
        "priceMin": search["priceMin"],
        "priceMax": search["priceMax"],
        "zip": search["zip"],
        "radiusMiles": search["radiusMiles"],
        "cleanTitleOnly": search["cleanTitleOnly"],
        "ingestUrl": ingest_url,
        "ingestSecret": ingest_secret,
    }


def run_one_search(search: dict, args: argparse.Namespace, ingest_url: str, ingest_secret: str) -> dict:
    """The 'sandbox' lifecycle for one search. Always reaps the process."""
    name = search["name"]
    cmd = [
        sys.executable,
        str(RUN_PY),
        "--config",
        json.dumps(build_config(search, ingest_url, ingest_secret)),
    ]
    if args.items_file:
        # run.py executes with cwd=scrapers/ — relative fixture paths must
        # be resolved from the caller's cwd, not the sandbox cwd
        cmd += ["--items-file", str(Path(args.items_file).resolve())]
    if args.max_pages:
        cmd += ["--max-pages", str(args.max_pages)]

    error: str | None = None
    new_deals: int | None = None
    process = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd=ROOT / "scrapers"
    )
    try:
        stdout, stderr = process.communicate(timeout=SANDBOX_TIMEOUT_SECONDS)
        if process.returncode != 0:
            error = f"run.py exited {process.returncode}: {stderr.strip().splitlines()[-1][:300] if stderr.strip() else 'no stderr'}"
        else:
            try:
                summary = json.loads(stdout.strip().splitlines()[-1])
                new_deals = (summary.get("ingest") or {}).get("inserted")
            except (json.JSONDecodeError, IndexError):
                pass
    except subprocess.TimeoutExpired:
        process.kill()  # teardown: a hung sandbox never outlives its slot
        process.communicate()
        error = f"sandbox timed out after {SANDBOX_TIMEOUT_SECONDS}s (killed)"
    finally:
        if process.poll() is None:
            process.kill()

    mark_args: dict = {"searchId": search["_id"]}
    if error is not None:
        mark_args["error"] = error
    if new_deals is not None:
        mark_args["newDeals"] = new_deals
    convex_run("searches:markRun", json.dumps(mark_args))

    status = "FAIL" if error else "ok"
    log.info("%s: %s%s", name, status, f" ({error})" if error else f" (+{new_deals} new)" if new_deals is not None else "")
    return {"name": name, "ok": error is None, "error": error, "newDeals": new_deals}


def dispatch_once(args: argparse.Namespace) -> dict:
    ingest_url = os.environ.get("INGEST_URL", "http://127.0.0.1:3211/ingest")
    ingest_secret = os.environ.get("INGEST_SECRET", "")
    if not ingest_secret:
        # .env.local is the dev source of truth
        for line in (ROOT / ".env.local").read_text().splitlines():
            if line.startswith("INGEST_SECRET="):
                ingest_secret = line.split("=", 1)[1].strip().strip("'\"")
    if not ingest_secret:
        raise SystemExit("INGEST_SECRET not found (env or .env.local)")

    due = convex_run("searches:listDue", json.dumps({"now": int(time.time() * 1000)})) or []
    log.info("due searches: %d", len(due))
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY_CAP) as pool:
        for result in pool.map(
            lambda s: run_one_search(s, args, ingest_url, ingest_secret), due
        ):
            results.append(result)
    summary = {
        "due": len(due),
        "ok": sum(1 for r in results if r["ok"]),
        "failed": sum(1 for r in results if not r["ok"]),
        "results": results,
    }
    print(json.dumps(summary))
    return summary


def main() -> int:
    logging.basicConfig(stream=sys.stderr, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--once", action="store_true", help="one dispatch pass (default)")
    parser.add_argument("--loop", type=int, metavar="SECONDS", help="poll forever at this interval")
    parser.add_argument("--items-file", help="offline raw-items source (live KSL is proxy-blocked in-container)")
    parser.add_argument("--max-pages", type=int)
    args = parser.parse_args()

    if args.loop:
        while True:
            try:
                dispatch_once(args)
            except Exception:
                log.exception("dispatch pass failed; continuing")
            time.sleep(args.loop)
    else:
        dispatch_once(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())

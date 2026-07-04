"""KSL listing DETAIL fetcher — pulls the seller description past PerimeterX.

The KSL *search* page (ksl_unlocker.py) omits the seller description, so the
recon classifier never sees "needs engine", "blown motor", "won't start", etc.
Those phrases only live on the individual listing page. This module fetches a
listing's detail page through the same Bright Data Web Unlocker path and extracts
the description from the Next.js RSC stream, then classifies the drivetrain issue
with the SAME rules as convex/lib/reconRules.ts (kept in sync by hand).

Env:
    BRIGHTDATA_API_TOKEN   Bright Data API token (Bearer)         [required]
    BRIGHTDATA_ZONE        Web Unlocker zone name (default: web_unlocker1)

Usage (standalone):
    BRIGHTDATA_API_TOKEN=... python ksl_detail.py 10602407 10545956 ...
    echo '["https://cars.ksl.com/listing/10602407"]' | BRIGHTDATA_API_TOKEN=... python ksl_detail.py -
Emits a JSON array of {id, url, description, issue, matched} to stdout.
"""
from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from typing import Any

# Reuse the Web Unlocker fetch + RSC decode already written for the search path.
from ksl_unlocker import _fetch_page_html, _decode_rsc_stream, _extract_object

log = logging.getLogger("carhunter.ksl_detail")

# --- drivetrain classifier, ported 1:1 from convex/lib/reconRules.ts ----------
ENGINE_RE = re.compile(
    r"\b(blown (engine|motor)|needs? (an? )?(new )?(engine|motor)|engine (is )?"
    r"(blown|bad|gone|shot|knocking|seized)|motor (is )?(blown|bad|gone|shot|seized)|"
    r"rod knock|knocking|no compression|spun bearing|cracked block|blown head ?gasket)\b",
    re.I,
)
TRANS_RE = re.compile(
    r"\b(bad trans(mission)?|bad tranny|needs? (a )?(new )?(trans(mission)?|tranny)|"
    r"(trans(mission)?|tranny) (is )?(bad|gone|out|slipping|slips|shot)|tranny slips|"
    r"trans slips|slipping|slips when|won'?t shift|no (reverse|3rd|third) gear)\b",
    re.I,
)
GENERIC_BROKEN_RE = re.compile(
    r"\b(mechanic'?s? special|doesn'?t run|does not run|won'?t start|doesn'?t start|"
    r"not running|non.?running|won'?t run|as.?is,? broken|"
    r"dead(?!\s*(battery|batteries|key|fob|remote|spot|pixel|pedal))|needs? work to run)\b",
    re.I,
)
ENGINE_CONTEXT_RE = re.compile(r"\b(engine|motor)\b", re.I)


def classify_drivetrain(text: str) -> str | None:
    """engine | transmission | generic | None — mirrors reconRules.classifyDrivetrain."""
    if ENGINE_RE.search(text):
        return "engine"
    if TRANS_RE.search(text):
        return "transmission"
    if GENERIC_BROKEN_RE.search(text):
        return "engine" if ENGINE_CONTEXT_RE.search(text) else "generic"
    return None


_DESC_KEY_RE = re.compile(r'"description":"((?:[^"\\]|\\.)*)"')


def extract_description(html: str) -> str | None:
    """Pull the seller description out of a KSL detail page's RSC stream."""
    stream = _decode_rsc_stream(html) or html
    # Prefer the CAR listing record (full object), else fall back to any
    # "description":"..." key in the decoded stream.
    for m in re.finditer(r'\{"id":\d+,"listingType":"CAR"', stream):
        obj_txt = _extract_object(stream, m.start())
        if not obj_txt:
            continue
        try:
            rec = json.loads(obj_txt)
        except ValueError:
            continue
        desc = rec.get("description")
        if isinstance(desc, str) and desc.strip():
            return desc
    # Fallback: longest "description" string literal in the stream.
    best: str | None = None
    for m in _DESC_KEY_RE.finditer(stream):
        try:
            val = json.loads('"' + m.group(1) + '"')
        except ValueError:
            continue
        if val and (best is None or len(val) > len(best)):
            best = val
    return best


def listing_url(id_or_url: str) -> str:
    s = str(id_or_url).strip()
    if s.startswith("http"):
        return s
    return f"https://cars.ksl.com/listing/{s}"


def fetch_detail(id_or_url: str) -> dict[str, Any]:
    url = listing_url(id_or_url)
    lid = url.rstrip("/").split("/")[-1]
    try:
        html = _fetch_page_html(url)
    except Exception as exc:  # UnlockerError or network
        return {"id": lid, "url": url, "description": None, "issue": None, "error": str(exc)[:160]}
    desc = extract_description(html)
    issue = classify_drivetrain(desc or "") if desc else None
    return {"id": lid, "url": url, "description": desc, "issue": issue, "matched": issue is not None}


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr,
                        format='{"ts":"%(asctime)s","level":"%(levelname)s","logger":"%(name)s","msg":%(message)r}')
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ids", nargs="*", help="listing ids or URLs; use '-' to read a JSON array from stdin")
    args = ap.parse_args()

    ids: list[str]
    if args.ids == ["-"] or (not args.ids and not sys.stdin.isatty()):
        ids = [str(x) for x in json.load(sys.stdin)]
    else:
        ids = args.ids
    if not ids:
        ap.error("no listing ids provided")

    out = []
    for i, x in enumerate(ids, 1):
        rec = fetch_detail(x)
        flag = rec.get("issue") or ("ERR" if rec.get("error") else "-")
        log.info("[%d/%d] %s -> %s", i, len(ids), rec["id"], flag)
        out.append(rec)
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

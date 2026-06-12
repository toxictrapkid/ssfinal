"""M3 gate: ksl.py runs locally and emits ≥1 listing matching the §5 normalized
shape exactly (validated against listing.schema.json). Network layer is
exercised against a fake session (the egress proxy of the build container
blocks cars.ksl.com — see PROGRESS.md BLOCKED); the request envelope itself is
asserted against the reference hax.py contract."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

HERE = Path(__file__).parent
SCRAPERS = HERE.parent
sys.path.insert(0, str(SCRAPERS))

from ksl import (  # noqa: E402
    API_ENDPOINT,
    KslApiError,
    PROXY_URL,
    build_search_segments,
    fetch_all_items,
    _request_page,
)

SCHEMA = json.loads((HERE / "listing.schema.json").read_text())
FIXTURE = HERE / "fixtures" / "ksl_items.json"

TRAVERSE_CONFIG = {
    "makes": ["Chevrolet"],
    "models": ["Traverse"],
    "yearMin": 2019,
    "yearMax": 2024,
    "mileageMin": 30000,
    "mileageMax": 110000,
    "priceMin": 2000,
    "priceMax": 28000,
    "zip": "84104",
    "radiusMiles": 150,
    "cleanTitleOnly": True,
}


# ------------------------------------------------------------ segment builder


def test_segments_follow_reference_grammar():
    segments = build_search_segments(TRAVERSE_CONFIG)
    assert segments == [
        "make", "Chevrolet",
        "model", "Traverse",
        "yearFrom", "2019",
        "yearTo", "2024",
        "mileageFrom", "30000",
        "mileageTo", "110000",
        "priceFrom", "2000",
        "priceTo", "28000",
        "zip", "84104",
        "miles", "150",
        "titleType", "Clean Title",
        "sellerType", "For Sale By Owner",
    ]


def test_multi_value_segments_joined_with_semicolon():
    segments = build_search_segments(
        {"makes": ["GMC", "Chevrolet"], "models": ["Terrain", "Equinox"]}
    )
    assert segments[:4] == ["make", "GMC;Chevrolet", "model", "Terrain;Equinox"]


def test_fsbo_filter_always_present_and_title_filter_optional():
    no_title = build_search_segments({"cleanTitleOnly": False})
    assert "titleType" not in no_title
    assert no_title[-2:] == ["sellerType", "For Sale By Owner"]


def test_broad_arbitrage_scan_omits_make_and_model_segments():
    # standing user override 2026-06-12: all-makes scans; the scoring engine
    # finds the arbitrage, not the search filter
    segments = build_search_segments(
        {
            "makes": [],
            "models": [],
            "priceMin": 2000,
            "priceMax": 12000,
            "zip": "84104",
            "radiusMiles": 150,
            "cleanTitleOnly": False,
        }
    )
    assert "make" not in segments
    assert "model" not in segments
    assert segments == [
        "priceFrom", "2000",
        "priceTo", "12000",
        "zip", "84104",
        "miles", "150",
        "sellerType", "For Sale By Owner",
    ]


def test_reference_main_url_segments_round_trip():
    """The builder must speak the exact grammar of the reference main_url."""
    from urllib.parse import unquote_plus

    reference_main_url = (
        "https://cars.ksl.com/search/make/Acura;Ford/model/TL;Fiesta"
        "/mileageTo/160000/priceTo/5000/zip/84123/miles/25/priceFrom/2000"
        "/titleType/Clean+Title/yearFrom/1995"
    )
    reference_segments = unquote_plus(
        reference_main_url.removeprefix("https://cars.ksl.com/search/")
    ).split("/")
    ours = build_search_segments(
        {
            "makes": ["Acura", "Ford"],
            "models": ["TL", "Fiesta"],
            "mileageMax": 160000,
            "priceMin": 2000,
            "priceMax": 5000,
            "zip": "84123",
            "radiusMiles": 25,
            "yearMin": 1995,
            "cleanTitleOnly": True,
        }
    )
    # same name/value pairs (order differs; the API takes alternating pairs)
    ref_pairs = dict(zip(reference_segments[::2], reference_segments[1::2]))
    our_pairs = dict(zip(ours[::2], ours[1::2]))
    del our_pairs["sellerType"]  # our hard FSBO addition
    assert our_pairs == ref_pairs


# ------------------------------------------------------- network layer (fake)


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeSession:
    """Scripted session: pops one canned response (or exception) per call."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []

    def post(self, url, headers=None, json=None, timeout=None):
        self.calls.append({"url": url, "headers": headers, "json": json})
        action = self.script.pop(0)
        if isinstance(action, Exception):
            raise action
        return action

    def close(self):
        pass


def _items_payload(items):
    return {"data": {"items": items}}


def test_request_envelope_matches_reference_contract():
    raw = json.loads(FIXTURE.read_text())
    session = FakeSession([FakeResponse(payload=_items_payload(raw))])
    _request_page(session, build_search_segments(TRAVERSE_CONFIG), page=1)
    call = session.calls[0]
    assert call["url"] == PROXY_URL
    assert call["json"]["endpoint"] == API_ENDPOINT
    body = call["json"]["options"]["body"]
    assert body[-6:] == ["perPage", 24, "page", 1, "es_query_group", None]
    assert call["headers"]["Host"] == "cars.ksl.com"
    assert call["headers"]["Origin"] == "https://cars.ksl.com"
    # the reference never sends Referer on the wire (hax.py builds
    # adjusted_headers but posts the original dict) — neither do we
    assert "Referer" not in call["headers"]


def test_retry_on_malformed_json_body(monkeypatch):
    import ksl as ksl_module

    monkeypatch.setattr(ksl_module.time, "sleep", lambda s: None)
    raw = json.loads(FIXTURE.read_text())
    session = FakeSession(
        [
            FakeResponse(status_code=200, payload=None, text="<html>not json</html>"),
            FakeResponse(payload=_items_payload(raw)),
        ]
    )
    items = _request_page(session, [], page=1)
    assert len(items) == len(raw)
    assert len(session.calls) == 2


def test_retry_then_success(monkeypatch):
    import ksl as ksl_module
    import requests as requests_module

    monkeypatch.setattr(ksl_module.time, "sleep", lambda s: None)
    raw = json.loads(FIXTURE.read_text())
    session = FakeSession(
        [
            requests_module.ConnectionError("boom"),
            FakeResponse(status_code=503, text="upstream sad"),
            FakeResponse(payload=_items_payload(raw)),
        ]
    )
    items = _request_page(session, [], page=1)
    assert len(items) == len(raw)
    assert len(session.calls) == 3


def test_exhausted_retries_raise_typed_error(monkeypatch):
    import ksl as ksl_module

    monkeypatch.setattr(ksl_module.time, "sleep", lambda s: None)
    session = FakeSession([FakeResponse(status_code=403, text="blocked")] * 3)
    with pytest.raises(KslApiError, match="after 3 attempts"):
        _request_page(session, [], page=1)


def test_pagination_stops_on_empty_page(monkeypatch):
    raw = json.loads(FIXTURE.read_text())
    session = FakeSession(
        [
            FakeResponse(payload=_items_payload(raw)),
            FakeResponse(payload=_items_payload([])),
        ]
    )
    items = fetch_all_items(TRAVERSE_CONFIG, max_pages=5, session=session)
    assert len(items) == len(raw)
    assert len(session.calls) == 2  # did not burn pages 3..5


# ----------------------------------------------------------- THE GATE (emit)


def test_cli_emits_schema_valid_listings_from_local_run():
    """Gate: `python ksl.py` runs locally and emits ≥1 §5-shaped listing."""
    result = subprocess.run(
        [
            sys.executable,
            str(SCRAPERS / "ksl.py"),
            "--config", json.dumps(TRAVERSE_CONFIG),
            "--items-file", str(FIXTURE),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stderr
    listings = json.loads(result.stdout)
    assert len(listings) >= 1
    validator = Draft202012Validator(SCHEMA)
    for listing in listings:
        errors = list(validator.iter_errors(listing))
        assert not errors, f"{listing['sourceListingId']}: {[e.message for e in errors]}"
    # stdout is pure JSON; logs went to stderr
    assert '"level"' in result.stderr


def test_facebook_stub_is_disabled_not_broken():
    from facebook import ScraperDisabled, run as fb_run

    with pytest.raises(ScraperDisabled, match="user override"):
        fb_run({})

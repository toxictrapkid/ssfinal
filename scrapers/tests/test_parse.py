"""M2 gate: parse.py extracts every §5 field from saved KSL API fixtures and
hard-filters dealers. Fixtures are saved-response JSON shaped exactly per the
reference KSLHax data_types/car.py (KSL's search endpoint returns structured
JSON, not HTML — spec §5). Facebook fixtures are deferred with the FB scraper
(standing user override 2026-06-12, see PROGRESS.md)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from parse import (  # noqa: E402
    detect_title_status,
    distance_miles,
    looks_like_dealer,
    normalize_ksl,
    normalize_ksl_batch,
    parse_mileage_text,
    parse_title,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def ksl_items() -> list[dict]:
    return json.loads((FIXTURES / "ksl_items.json").read_text())


@pytest.fixture(scope="module")
def normalized(ksl_items) -> dict[str, dict]:
    listings, _ = normalize_ksl_batch(ksl_items, search_zip="84104")
    return {l["sourceListingId"]: l for l in listings}


# ------------------------------------------------------- per-field extraction


def test_happy_path_extracts_every_gate_field(normalized):
    l = normalized["9210001"]
    assert l["year"] == 2021
    assert l["make"] == "Chevrolet"
    assert l["model"] == "Traverse"
    assert l["trim"] == "LT"
    assert l["mileage"] == 78214
    assert l["price"] == 19500
    assert l["titleStatus"] == "clean"
    assert l["sellerType"] == "private"
    assert l["vin"] == "1GNERGKW5MJ100001"
    assert l["url"] == "https://cars.ksl.com/listing/9210001"
    assert l["location"] == "Sandy, UT"
    assert l["photoUrl"].startswith("https://img.ksl.com/")
    assert len(l["photos"]) == 2
    assert l["postedAt"] == 1749350000 * 1000  # epoch s -> ms, displayTime wins


def test_salvage_title_from_structured_field(normalized):
    assert normalized["9210003"]["titleStatus"] == "salvage"


def test_rebuilt_title_detected_from_description(normalized):
    assert normalized["9210004"]["titleStatus"] == "rebuilt"


def test_unknown_vin_normalized_to_null(normalized):
    assert normalized["9210003"]["vin"] is None


def test_mileage_parsed_from_description_when_structured_missing(normalized):
    assert normalized["9210006"]["mileage"] == 87000


def test_photo_as_json_string_entry_is_parsed(normalized):
    assert normalized["9210006"]["photos"] == [
        "https://img.ksl.com/mx/mplace-cars.ksl.com/9210006-1717100005-100007.jpeg"
    ]


def test_title_parse_fallback_fills_missing_structured_fields(normalized):
    l = normalized["9210008"]  # makeYear 0, model "", make "chevy"
    assert l["year"] == 2016
    assert l["make"] == "Chevrolet"
    assert l["model"] == "Equinox"
    assert l["trim"] == "LT"
    assert l["titleStatus"] == "unknown"  # structured "Unknown", no title keywords in text
    assert l["mileage"] == 132000
    assert l["title"] == "2016 Chevrolet Equinox LT"


def test_mechanic_special_keeps_description_for_recon(normalized):
    l = normalized["9210005"]
    assert "needs engine" in l["description"].lower()
    assert l["titleStatus"] == "clean"


def test_distance_computed_from_search_zip(normalized):
    sandy = normalized["9210001"]["distanceMiles"]
    logan = normalized["9210008"]["distanceMiles"]
    assert sandy is not None and 5 < sandy < 25
    assert logan is not None and 60 < logan < 110
    assert normalized["9210001"]["zip"] == "84070"


# ------------------------------------------------------------- dealer filter


def test_dealership_seller_type_filtered(normalized):
    assert "9210002" not in normalized


def test_dealer_phrases_in_description_filtered(normalized):
    assert "9210007" not in normalized


def test_batch_stats_account_for_every_input(ksl_items):
    listings, stats = normalize_ksl_batch(ksl_items, search_zip="84104")
    assert stats["input"] == 8
    assert stats["kept"] == len(listings) == 6
    assert stats["dealers_filtered"] == 2
    assert stats["malformed"] == 0
    assert all(l["sellerType"] == "private" for l in listings)


def test_looks_like_dealer_unit():
    assert looks_like_dealer("Dealership", None)
    assert looks_like_dealer("For Sale By Owner", "visit our dealership today")
    assert looks_like_dealer(None, "Stock #1234")
    assert not looks_like_dealer("For Sale By Owner", "one owner, garage kept")


def test_dealer_serviced_private_listing_is_not_filtered():
    # "dealer serviced" is a private-party quality signal, not a dealer tell
    # (M2 reviewer advisory A3)
    assert not looks_like_dealer("For Sale By Owner", "always dealer serviced, records since new")
    assert not looks_like_dealer("For Sale By Owner", "priced below dealer retail")


def test_unknown_seller_type_kept_as_private_but_logged(ksl_items, caplog):
    import logging

    item = dict(ksl_items[0])
    item["sellerType"] = "Unkown"  # the reference dataclass default spelling
    with caplog.at_level(logging.WARNING, logger="carhunter.parse"):
        normalized_item = normalize_ksl(item, search_zip="84104")
    assert normalized_item is not None
    assert normalized_item["sellerType"] == "private"
    assert any("no usable sellerType" in r.message for r in caplog.records)


def test_epoch_ms_passthrough():
    from parse import _epoch_ms

    assert _epoch_ms(1749350000) == 1749350000 * 1000  # seconds -> ms
    assert _epoch_ms(1749350000123) == 1749350000123  # already ms
    assert _epoch_ms(0) is None
    assert _epoch_ms(None) is None


def test_epoch_ms_iso_and_numeric_strings():
    from parse import _epoch_ms

    # ISO-8601 (the Web Unlocker RSC form) must parse, not fall to None
    assert _epoch_ms("2024-06-07T12:00:00Z") == 1717761600000
    assert _epoch_ms("2024-06-07T12:00:00+00:00") == 1717761600000
    # numeric epochs delivered as strings
    assert _epoch_ms("1749350000") == 1749350000 * 1000
    assert _epoch_ms("1749350000123") == 1749350000123
    # garbage / empty -> None (never a bogus daysListed anchor)
    assert _epoch_ms("not a date") is None
    assert _epoch_ms("") is None
    assert _epoch_ms(True) is None  # bool is an int subclass — reject it


def test_coerce_mileage_accepts_float_and_string():
    from parse import _coerce_mileage

    assert _coerce_mileage(78000) == 78000
    assert _coerce_mileage(78000.0) == 78000  # RSC often serializes numbers as floats
    assert _coerce_mileage("78,000") == 78000  # or as strings with separators
    assert _coerce_mileage("78000") == 78000
    assert _coerce_mileage(0) is None
    assert _coerce_mileage(-5) is None
    assert _coerce_mileage(None) is None
    assert _coerce_mileage("n/a") is None
    assert _coerce_mileage(True) is None  # bool must never read as a mileage


def test_float_mileage_survives_into_dedupe_component(ksl_items):
    # A float mileage must reach the normalized output (it's a dedupe-key input),
    # not get dropped to None and force the source:id fallback key.
    item = dict(ksl_items[0])
    item["mileage"] = 78214.0
    normalized_item = normalize_ksl(item, search_zip="84104")
    assert normalized_item["mileage"] == 78214


def test_looks_like_dealer_catches_dealer_variants():
    # broadened structured check: any sellerType containing "dealer" is a dealer,
    # not just the exact tokens — the live path has no description to fall back on
    assert looks_like_dealer("Certified Dealer", None)
    assert looks_like_dealer("Franchise Dealer", None)
    assert looks_like_dealer("DEALERSHIP INC", None)
    assert looks_like_dealer("dealer", None)
    # a genuine FSBO value contains no "dealer" and stays private
    assert not looks_like_dealer("For Sale By Owner", "one owner, clean")


def test_make_extraction_prefers_earliest_brand_in_title():
    # "seat"/"smart" are real (foreign) marques in the dictionary; a real make
    # appearing EARLIER in the string must win over them, not lose on dict order.
    assert parse_title("2018 Honda Accord with new leather seat")["make"] == "Honda"
    assert parse_title("2019 Ford Escape, smart key included")["make"] == "Ford"
    # the multi-word / genuine cases still resolve correctly
    assert parse_title("2020 Toyota Camry SE")["make"] == "Toyota"


def test_unknown_make_model_strings_trigger_title_fallback(ksl_items):
    item = dict(ksl_items[0])
    item.update(make="Unknown", model="Unknown", trim=None, makeYear=0,
                description="2016 Chevy Equinox LT awd runs great")
    normalized_item = normalize_ksl(item, search_zip="84104")
    assert normalized_item["make"] == "Chevrolet"
    assert normalized_item["model"] == "Equinox"
    assert normalized_item["year"] == 2016


# ----------------------------------------------------------- helpers (units)


@pytest.mark.parametrize(
    ("title", "expect"),
    [
        ("2021 Chevrolet Traverse LT AWD", (2021, "Chevrolet", "Traverse", "LT")),
        ("2019 Jeep Wrangler Unlimited Sport", (2019, "Jeep", "Wrangler Unlimited", "Sport")),
        ("2016 chevy Equinox LT", (2016, "Chevrolet", "Equinox", "LT")),
        ("2020 VW Tiguan SE", (2020, "Volkswagen", "Tiguan", "SE")),
        ("Mazda CX-5 Touring 2018, clean", (2018, "Mazda", "CX-5", "Touring")),
        ("just a couch", (None, None, None, None)),
    ],
)
def test_parse_title(title, expect):
    parsed = parse_title(title)
    assert (parsed["year"], parsed["make"], parsed["model"], parsed["trim"]) == expect


@pytest.mark.parametrize(
    ("text", "expect"),
    [
        ("Only 87K miles", 87000),
        ("87,432 miles on it", 87432),
        ("123456 mi, runs great", 123456),
        ("no mileage mentioned", None),
        ("", None),
    ],
)
def test_parse_mileage_text(text, expect):
    assert parse_mileage_text(text) == expect


def test_detect_title_status_priorities():
    assert detect_title_status("Clean Title", "salvage history") == "clean"
    assert detect_title_status("Not Specified", "rebuilt title") == "rebuilt"
    assert detect_title_status(None, None) == "unknown"


def test_distance_miles_unknown_zip_degrades_to_none():
    assert distance_miles("84104", "00000") is None


# -------------------------------------------------- facebook (deferred scope)


@pytest.mark.skip(reason="Facebook scraping deferred by standing user override 2026-06-12 (KSL-only scope; no FB credentials). Re-enable with facebook.py.")
def test_facebook_fixture_parsing():
    ...

"""Pin the normalized listing contract: §5 keys + the three documented extras
(zip, postedAt, distanceMiles), nothing else. M3's emit gate reuses this
schema against live scraper output."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from parse import normalize_ksl_batch  # noqa: E402

HERE = Path(__file__).parent
SCHEMA = json.loads((HERE / "listing.schema.json").read_text())
SPEC_S5_KEYS = {
    "source", "sourceListingId", "url", "title", "price", "mileage", "year",
    "make", "model", "trim", "vin", "titleStatus", "sellerType", "location",
    "photoUrl", "photos", "description",
}
DOCUMENTED_EXTRAS = {"zip", "postedAt", "distanceMiles"}


def test_schema_is_exactly_spec_keys_plus_documented_extras():
    assert set(SCHEMA["properties"]) == SPEC_S5_KEYS | DOCUMENTED_EXTRAS
    assert set(SCHEMA["required"]) == SPEC_S5_KEYS | DOCUMENTED_EXTRAS
    assert SCHEMA["additionalProperties"] is False


def test_every_normalized_fixture_listing_validates():
    items = json.loads((HERE / "fixtures" / "ksl_items.json").read_text())
    listings, _ = normalize_ksl_batch(items, search_zip="84104")
    assert listings, "fixtures produced no listings"
    validator = Draft202012Validator(SCHEMA)
    for listing in listings:
        errors = list(validator.iter_errors(listing))
        assert not errors, f"{listing['sourceListingId']}: {[e.message for e in errors]}"


@pytest.mark.parametrize("missing_key", sorted(SPEC_S5_KEYS))
def test_schema_rejects_listings_missing_spec_keys(missing_key):
    items = json.loads((HERE / "fixtures" / "ksl_items.json").read_text())
    listings, _ = normalize_ksl_batch(items, search_zip="84104")
    broken = dict(listings[0])
    del broken[missing_key]
    assert list(Draft202012Validator(SCHEMA).iter_errors(broken))

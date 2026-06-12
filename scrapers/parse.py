"""Shared listing normalizer: raw scraper output -> spec §5 normalized shape.

Every scraper feeds its raw items through here. Responsibilities (spec §5):
  - year/make/model/trim extraction from titles (car_brands dictionary, reused
    from the reference car-brands.js per RULES #2)
  - mileage parsing ("87K" -> 87000 — reused from reference search.py)
  - title-status keyword detection
  - seller type + the PRIVATE-PARTY HARD FILTER (RULES #4: dealers never pass)
  - location -> distanceMiles from the search zip

Output contract (§5 keys + three documented extras, pinned by
tests/test_normalized_shape.py):
  source, sourceListingId, url, title, price, mileage, year, make, model,
  trim, vin, titleStatus, sellerType, location, photoUrl, photos, description
  + zip      (dedupe key needs zip3 — §5 dedupe formula)
  + postedAt (epoch ms; ingest computes daysListed — §3 field)
  + distanceMiles (spec §3 field, computed here per §5)

Scoring, dedupe, and price history are NOT done here — Convex owns those.
"""
from __future__ import annotations

import json
import logging
import math
import re
from typing import Any

from car_brands import BRAND_ALIASES, CAR_BRANDS

log = logging.getLogger("carhunter.parse")

# ---------------------------------------------------------------- constants

KSL_LISTING_URL = "https://cars.ksl.com/listing/{id}"

# KSL titleType values (reference data_types/car.py) -> normalized titleStatus
KSL_TITLE_STATUS = {
    "clean title": "clean",
    "salvage title": "salvage",
    "rebuilt/reconstructed title": "rebuilt",
    "rebuilt title": "rebuilt",
    "reconstructed title": "rebuilt",
    "not specified": "unknown",
    "unknown": "unknown",
}

# Description phrases that reveal a branded title when the structured field is silent
TITLE_KEYWORDS = [
    ("rebuilt", "rebuilt"),
    ("reconstructed", "rebuilt"),
    ("salvage", "salvage"),
    ("branded title", "salvage"),
    ("clean title", "clean"),
]

# Phrases that out a "private" listing as a dealer (RULES #4 hard filter).
# Deliberately seller-side signals only: bare "dealer" is NOT here because
# private sellers say "dealer serviced"/"priced below dealer" constantly
# (M2 reviewer advisory A3).
DEALER_PHRASES = [
    "dealership",
    "stock #",
    "stock#",
    "stk #",
    "stk#",
    "dl #",
    "dl#",
    "dlr",
    "our inventory",
    "our showroom",
    "financing available",
    "we finance",
    "buy here pay here",
    "trade-ins welcome",
    "call our sales",
]

# Trim noise: drivetrain/condition tokens that are not a trim level
_TRIM_NOISE = {"awd", "4wd", "4x4", "fwd", "rwd", "2wd", "low", "miles", "clean", "title"}

_MILEAGE_TEXT_RE = re.compile(
    r"(\d{1,3}(?:[,.]\d{3})+|\d+(?:\.\d+)?\s*k|\d{4,7})\s*(?:miles|mile|mi\b)",
    re.IGNORECASE,
)
_YEAR_RE = re.compile(r"\b(19[5-9]\d|20[0-4]\d)\b")

# --------------------------------------------------------------- title parse


def _normalize_brand(token: str) -> str | None:
    t = token.lower().strip()
    if t in BRAND_ALIASES:
        return BRAND_ALIASES[t]
    for brand in CAR_BRANDS:
        if brand.lower() == t:
            return brand
    return None


def parse_title(title: str) -> dict[str, Any]:
    """Extract year/make/model/trim from a free-text listing title.

    Longest-model-first matching so "Wrangler Unlimited" beats "Wrangler".
    Returns None values for whatever can't be determined — callers prefer
    structured source fields and use this as the fallback.
    """
    out: dict[str, Any] = {"year": None, "make": None, "model": None, "trim": None}
    if not title:
        return out
    text = title.strip()

    year_match = _YEAR_RE.search(text)
    if year_match:
        out["year"] = int(year_match.group(1))

    # find the make anywhere in the title
    rest = ""
    lowered = f" {text.lower()} "
    for token, brand in [(b.lower(), b) for b in CAR_BRANDS] + list(
        (a, b) for a, b in BRAND_ALIASES.items()
    ):
        idx = lowered.find(f" {token} ")
        if idx >= 0:
            out["make"] = brand if brand in CAR_BRANDS else _normalize_brand(brand)
            rest = text[idx + len(token) + 1 :].strip()
            break
    if not out["make"]:
        return out

    # longest model name first so multi-word models win
    models = sorted(CAR_BRANDS.get(out["make"], []), key=len, reverse=True)
    rest_lower = f" {rest.lower()} "
    for model in models:
        idx = rest_lower.find(f" {model.lower()} ")
        if idx >= 0:
            out["model"] = model
            tail = rest[idx + len(model) :].strip()
            trim_tokens: list[str] = []
            for token in re.split(r"[\s,/|]+", tail):
                if not token or token.lower() in _TRIM_NOISE or token.isdigit():
                    continue
                # trims read like badges (LT, SE, Touring); a plain lowercase
                # word means we've drifted into prose ("runs great")
                if token[0].islower():
                    break
                trim_tokens.append(token)
                if len(trim_tokens) == 2:
                    break
            if trim_tokens:
                out["trim"] = " ".join(trim_tokens)
            break
    return out


def parse_mileage_text(text: str) -> int | None:
    """ "87K miles" -> 87000; "87,432 mi" -> 87432 (reference search.py logic)."""
    if not text:
        return None
    m = _MILEAGE_TEXT_RE.search(text)
    if not m:
        return None
    raw = m.group(1).lower().replace(",", "").replace(" ", "")
    if raw.endswith("k"):
        return int(float(raw[:-1]) * 1000)
    try:
        value = int(float(raw))
    except ValueError:
        return None
    return value if 100 <= value <= 1_500_000 else None


def detect_title_status(structured: str | None, description: str | None) -> str:
    """Structured field wins; description keywords fill the gaps; else unknown."""
    if structured:
        mapped = KSL_TITLE_STATUS.get(structured.strip().lower())
        if mapped and mapped != "unknown":
            return mapped
    text = (description or "").lower()
    for phrase, status in TITLE_KEYWORDS:
        if phrase in text:
            return status
    if structured and structured.strip().lower() in KSL_TITLE_STATUS:
        return KSL_TITLE_STATUS[structured.strip().lower()]
    return "unknown"


def looks_like_dealer(seller_type: str | None, description: str | None) -> bool:
    """RULES #4: private-party only. Structured sellerType plus phrase heuristics."""
    if seller_type and seller_type.strip().lower() in ("dealership", "dealer"):
        return True
    text = (description or "").lower()
    return any(phrase in text for phrase in DEALER_PHRASES)


# ----------------------------------------------------------------- distance

_zip_cache: dict[str, tuple[float, float] | None] = {}


def _zip_latlng(zip_code: str) -> tuple[float, float] | None:
    if not zip_code:
        return None
    zip5 = str(zip_code).strip()[:5]
    if zip5 in _zip_cache:
        return _zip_cache[zip5]
    coords: tuple[float, float] | None = None
    try:
        import zipcodes  # pure-python US zip database

        matches = zipcodes.matching(zip5)
        if matches:
            coords = (float(matches[0]["lat"]), float(matches[0]["long"]))
    except Exception as exc:  # missing package or malformed zip — degrade, log
        log.warning("zip lookup failed for %s: %s", zip5, exc)
    _zip_cache[zip5] = coords
    return coords


def distance_miles(zip_a: str, zip_b: str) -> float | None:
    """Great-circle distance between two US zips; None when either is unknown."""
    a, b = _zip_latlng(zip_a), _zip_latlng(zip_b)
    if not a or not b:
        return None
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return round(3958.8 * 2 * math.asin(math.sqrt(h)), 1)


# -------------------------------------------------------------- KSL adapter


def _ksl_photos(raw_photo: Any) -> list[str]:
    """KSL photo entries are dicts (sometimes JSON strings) whose `id` is the
    full img.ksl.com URL (reference hax.py format_car)."""
    photos: list[str] = []
    if not raw_photo:
        return photos
    entries = raw_photo if isinstance(raw_photo, list) else [raw_photo]
    for entry in entries:
        if isinstance(entry, str):
            try:
                entry = json.loads(entry)
            except (ValueError, TypeError):
                if entry.startswith("http"):
                    photos.append(entry)
                continue
        if isinstance(entry, dict):
            url = entry.get("id") or entry.get("url")
            if isinstance(url, str) and url.startswith("http"):
                photos.append(url)
    return photos


def _epoch_ms(value: Any) -> int | None:
    """KSL timestamps appear as epoch seconds or ms; normalize to ms."""
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return int(value if value > 1_000_000_000_000 else value * 1000)


def normalize_ksl(item: dict, search_zip: str = "84104") -> dict | None:
    """One raw KSL API item -> §5 normalized listing. None = filtered out.

    Field map per reference data_types/car.py: makeYear->year,
    titleType->titleStatus, sellerType Dealership/For Sale By Owner,
    photo[].id -> img URLs, createTime/displayTime -> postedAt, id -> sourceListingId.
    """
    description = item.get("description") or None
    seller_raw = item.get("sellerType")

    if looks_like_dealer(seller_raw, description):
        log.info("filtered dealer listing %s", item.get("id"))
        return None
    if not seller_raw or seller_raw.strip().lower() in ("unkown", "unknown"):
        # KSL search results normally carry sellerType; keeping these relies on
        # the URL-level For+Sale+By+Owner filter, so make it auditable.
        log.warning(
            "listing %s has no usable sellerType (%r); keeping as private "
            "(server-side FSBO filter is the backstop)",
            item.get("id"), seller_raw,
        )

    listing_id = item.get("id")
    price = item.get("price")
    if listing_id is None or not isinstance(price, (int, float)) or price <= 0:
        log.warning("skipping malformed KSL item (id=%s, price=%s)", listing_id, price)
        return None

    def _field(name: str) -> str | None:
        """Structured field, with the API's 'Unknown'/'Unkown' defaults
        treated as missing so the title/description fallback can fill them."""
        value = item.get(name)
        if isinstance(value, str) and value.strip().lower() in ("", "unknown", "unkown"):
            return None
        return value

    make_raw = _field("make")
    model_raw = _field("model")
    trim_raw = _field("trim")
    title_bits = [
        str(item.get("makeYear") or ""),
        make_raw or "",
        model_raw or "",
        trim_raw or "",
    ]
    title = " ".join(b for b in title_bits if b).strip() or f"KSL listing {listing_id}"
    parsed = parse_title(title)
    # Junk structured fields (makeYear 0, empty model) leave the constructed
    # title useless — the seller's text is then the best source of truth.
    if (not parsed["year"] or not parsed["model"]) and description:
        from_desc = parse_title(description)
        for field in ("year", "make", "model", "trim"):
            parsed[field] = parsed[field] or from_desc[field]
        if from_desc["year"] and from_desc["model"]:
            rebuilt = [str(parsed["year"] or ""), parsed["make"] or "",
                       parsed["model"] or "", parsed["trim"] or ""]
            title = " ".join(b for b in rebuilt if b).strip()

    mileage = item.get("mileage")
    if not isinstance(mileage, int) or mileage <= 0:
        mileage = parse_mileage_text(description or "")

    year = item.get("makeYear") or parsed["year"]
    vin = item.get("vin")
    if isinstance(vin, str) and (len(vin.strip()) < 11 or vin.strip().lower() == "unknown"):
        vin = None

    city = (item.get("city") or "").strip().title()
    state = (item.get("state") or "").strip().upper()
    location = ", ".join(b for b in (city, state) if b) or None
    listing_zip = str(item.get("zip") or "").strip() or None

    photos = _ksl_photos(item.get("photo"))
    posted_at = _epoch_ms(item.get("displayTime")) or _epoch_ms(item.get("createTime"))

    return {
        "source": "ksl",
        "sourceListingId": str(listing_id),
        "url": KSL_LISTING_URL.format(id=listing_id),
        "title": title,
        "price": int(price),
        "mileage": mileage,
        "year": int(year) if year else None,
        "make": (_normalize_brand(str(make_raw)) if make_raw else None)
        or make_raw
        or parsed["make"],
        "model": model_raw or parsed["model"],
        "trim": trim_raw or parsed["trim"],
        "vin": vin,
        "titleStatus": detect_title_status(item.get("titleType"), description),
        "sellerType": "private",
        "location": location,
        "photoUrl": photos[0] if photos else None,
        "photos": photos,
        "description": description,
        "zip": listing_zip,
        "postedAt": posted_at,
        "distanceMiles": distance_miles(search_zip, listing_zip) if listing_zip else None,
    }


def normalize_ksl_batch(items: list[dict], search_zip: str = "84104") -> tuple[list[dict], dict]:
    """Normalize a page of KSL items. Returns (listings, stats)."""
    out: list[dict] = []
    stats = {"input": len(items), "kept": 0, "dealers_filtered": 0, "malformed": 0}
    for item in items:
        try:
            normalized = normalize_ksl(item, search_zip)
        except Exception:
            log.exception("normalize_ksl crashed on item id=%s", item.get("id"))
            stats["malformed"] += 1
            continue
        if normalized is None:
            if looks_like_dealer(item.get("sellerType"), item.get("description")):
                stats["dealers_filtered"] += 1
            else:
                stats["malformed"] += 1
            continue
        out.append(normalized)
        stats["kept"] += 1
    return out, stats

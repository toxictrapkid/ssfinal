#!/usr/bin/env python3
"""Generate scrapers/car_brands.py from the reference make/model dictionary.

Base data: reference/facebook-marketplace-scraper-1.1.0/web/js/car-brands.js
(reused per RULES #2). The reference list is euro-leaning, so we merge a
US-market supplement covering the §2 buy-box and common KSL-region models —
the reference entries are kept verbatim and the supplement only adds.

Run from repo root: python3 scripts/build_car_brands.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "reference/facebook-marketplace-scraper-1.1.0/web/js/car-brands.js"
DEST = ROOT / "scrapers/car_brands.py"

# US-market additions (brand -> models). Merged on top of the reference data.
SUPPLEMENT: dict[str, list[str]] = {
    "GMC": ["Acadia", "Canyon", "Sierra 1500", "Sierra 2500", "Terrain", "Yukon", "Yukon XL"],
    "Chevrolet": ["Traverse", "Equinox", "Tahoe", "Suburban", "Silverado 1500",
                  "Silverado 2500", "Colorado", "Trax", "Blazer", "Bolt"],
    "Volkswagen": ["Tiguan", "Atlas", "Taos", "ID.4"],
    "Mazda": ["CX-5", "CX-9", "CX-30", "CX-50", "Mazda3", "Mazda6"],
    "Jeep": ["Wrangler Unlimited", "Grand Cherokee", "Cherokee", "Gladiator",
             "Compass", "Renegade", "Patriot"],
    "Ford": ["Edge", "Escape", "Explorer", "Expedition", "F-150", "F-250",
             "F-350", "Bronco", "Bronco Sport", "Maverick"],
    "Acura": ["MDX", "RDX", "TLX", "ILX", "Integra"],
    "Chrysler": ["Pacifica", "300", "Town & Country"],
    "Ram": ["1500", "2500", "3500", "ProMaster"],
    "Subaru": ["Outback", "Forester", "Crosstrek", "Impreza", "Legacy", "Ascent", "WRX"],
    "Tesla": ["Model 3", "Model Y", "Model S", "Model X"],
}

# Common abbreviations sellers use in titles -> canonical brand
ALIASES: dict[str, str] = {
    "chevy": "Chevrolet",
    "vw": "Volkswagen",
    "mercedes": "Mercedes-Benz",
    "benz": "Mercedes-Benz",
    "landrover": "Land Rover",
}


def parse_reference_js(text: str) -> dict[str, list[str]]:
    """Parse the carBrands JS array without a JS runtime.

    The file is a JS literal: turn it into JSON by quoting bare keys and
    stripping trailing commas, then json.loads it.
    """
    body = text[text.index("[") :].strip().rstrip(";")
    body = re.sub(r"(\w+)\s*:", r'"\1":', body)  # brand: -> "brand":
    body = re.sub(r",\s*([\]}])", r"\1", body)  # trailing commas
    entries = json.loads(body)
    return {e["brand"]: list(e["models"]) for e in entries}


def main() -> None:
    brands = parse_reference_js(SRC.read_text(encoding="utf-8"))
    for brand, models in SUPPLEMENT.items():
        existing = {m.lower() for m in brands.get(brand, [])}
        brands.setdefault(brand, []).extend(
            m for m in models if m.lower() not in existing
        )

    lines = [
        '"""Make/model dictionary for title parsing. GENERATED — do not edit.',
        "",
        "Source: reference car-brands.js (facebook-marketplace-scraper-1.1.0)",
        "+ US-market supplement. Regenerate: python3 scripts/build_car_brands.py",
        '"""',
        "",
        "CAR_BRANDS: dict[str, list[str]] = " + json.dumps(brands, indent=2, ensure_ascii=False),
        "",
        "BRAND_ALIASES: dict[str, str] = " + json.dumps(ALIASES, indent=2),
        "",
    ]
    DEST.write_text("\n".join(lines), encoding="utf-8")
    n_models = sum(len(m) for m in brands.values())
    print(f"wrote {DEST}: {len(brands)} brands, {n_models} models")


if __name__ == "__main__":
    main()

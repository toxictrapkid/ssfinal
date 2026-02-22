#!/usr/bin/env python3
"""
Car-Part.com Used Auto Parts Price Scraper v2
Scrapes Engine and Transmission prices for specified vehicles (2012-2023).
Fully autonomous — zero human input required after launch.

Flow:
  1. Fill homepage form: year, make/model, part, zip, location, sort
  2. Submit → lands on variant selection page (radio buttons) OR direct results
  3. For each variant radio button: select it, submit, scrape prices
  4. Aggregate all prices per make/model/year/part across all variants
"""

import subprocess
import sys
import importlib
import os
import csv
import json
import time
import random
import logging
import re
import traceback
from datetime import datetime
from pathlib import Path

# ─── Auto-install missing dependencies ───────────────────────────────────────

REQUIRED = {"playwright": "playwright", "numpy": "numpy"}

def auto_install():
    for import_name, pip_name in REQUIRED.items():
        try:
            importlib.import_module(import_name)
        except ImportError:
            print(f"[SETUP] Installing {pip_name}...")
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", pip_name, "--quiet",
                 "--break-system-packages"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
    print("[SETUP] Ensuring Playwright Chromium is installed...")
    subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

auto_install()

import numpy as np
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# ─── Configuration ────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
RAW_CSV        = SCRIPT_DIR / "carpart_results_raw.csv"
FILTERED_CSV   = SCRIPT_DIR / "carpart_under_1500.csv"
PROGRESS_FILE  = SCRIPT_DIR / "carpart_progress.txt"
LOG_FILE       = SCRIPT_DIR / "carpart_scraper.log"
ERROR_LOG      = SCRIPT_DIR / "carpart_errors.log"

ZIP_CODE         = "64106"
MIN_DELAY        = 4
MAX_DELAY        = 9
MAX_RETRIES      = 3
RETRY_WAIT       = 30
PAGE_TIMEOUT     = 45000
PROGRESS_EVERY   = 10

# The exact <option> values from the car-part.com form
PARTS = ["Engine", "Transmission"]

# ─── Vehicle definitions ──────────────────────────────────────────────────────
# Format: (make_model_dropdown_value, display_make, display_model, year_start, year_end)
# The first element is EXACTLY what appears in the <select name="userModel"> dropdown.

VEHICLES = [
    # HONDA
    ("Honda Civic",          "Honda", "Civic",          2012, 2023),
    ("Honda Accord",         "Honda", "Accord",         2012, 2023),
    ("Honda CR-V",           "Honda", "CR-V",           2012, 2023),
    ("Honda Odyssey",        "Honda", "Odyssey",        2012, 2023),
    ("Honda Pilot",          "Honda", "Pilot",          2012, 2023),
    ("Honda Fit",            "Honda", "Fit",            2012, 2019),
    ("Honda HR-V",           "Honda", "HR-V",           2016, 2023),
    ("Honda Ridgeline",      "Honda", "Ridgeline",      2012, 2023),
    # TOYOTA
    ("Toyota Camry",         "Toyota", "Camry",         2012, 2023),
    ("Toyota Corolla",       "Toyota", "Corolla",       2012, 2023),
    ("Toyota RAV4",          "Toyota", "RAV4",          2012, 2023),
    ("Toyota Tacoma",        "Toyota", "Tacoma",        2012, 2023),
    ("Toyota Tundra",        "Toyota", "Tundra",        2012, 2023),
    ("Toyota Highlander",    "Toyota", "Highlander",    2012, 2023),
    ("Toyota Sienna",        "Toyota", "Sienna",        2012, 2023),
    ("Toyota 4 Runner",      "Toyota", "4Runner",       2012, 2023),
    ("Toyota Avalon",        "Toyota", "Avalon",        2012, 2022),
    # NISSAN
    ("Nissan Altima",        "Nissan", "Altima",        2012, 2023),
    ("Nissan Sentra",        "Nissan", "Sentra",        2012, 2023),
    ("Nissan Rogue",         "Nissan", "Rogue",         2014, 2023),
    ("Nissan Frontier",      "Nissan", "Frontier",      2012, 2023),
    ("Nissan Pathfinder",    "Nissan", "Pathfinder",    2012, 2023),
    ("Nissan Maxima",        "Nissan", "Maxima",        2012, 2023),
    ("Nissan Murano",        "Nissan", "Murano",        2012, 2023),
    ("Nissan Armada",        "Nissan", "Armada",        2012, 2023),
    # FORD
    ("Ford F150 Pickup",     "Ford", "F-150",           2012, 2023),
    ("Ford F250 Super Duty Pickup", "Ford", "F-250 SD", 2012, 2023),
    ("Ford F350 Super Duty Pickup", "Ford", "F-350 SD", 2012, 2023),
    ("Ford Fusion",          "Ford", "Fusion",          2012, 2020),
    ("Ford Explorer",        "Ford", "Explorer",        2012, 2023),
    ("Ford Escape",          "Ford", "Escape",          2012, 2023),
    ("Ford Edge",            "Ford", "Edge",            2012, 2023),
    ("Ford Expedition",      "Ford", "Expedition",      2012, 2023),
    ("Ford Ranger",          "Ford", "Ranger",          2012, 2023),
    ("Ford Mustang",         "Ford", "Mustang",         2012, 2023),
    ("Ford Focus",           "Ford", "Focus",           2012, 2018),
    ("Ford Taurus",          "Ford", "Taurus",          2012, 2019),
    # CHEVROLET
    ("Chevrolet Silverado 1500 Pickup", "Chevrolet", "Silverado 1500", 2012, 2023),
    ("Chevrolet Silverado 2500 Pickup", "Chevrolet", "Silverado 2500", 2012, 2023),
    ("Chevrolet Equinox",    "Chevrolet", "Equinox",    2012, 2023),
    ("Chevrolet Traverse",   "Chevrolet", "Traverse",   2012, 2023),
    ("Chevrolet Tahoe",      "Chevrolet", "Tahoe",      2012, 2023),
    ("Chevrolet Suburban",   "Chevrolet", "Suburban",   2012, 2023),
    ("Chevrolet Malibu",     "Chevrolet", "Malibu",     2012, 2023),
    ("Chevrolet Colorado",   "Chevrolet", "Colorado",   2012, 2023),
    ("Chevrolet Cruze",      "Chevrolet", "Cruze",      2012, 2019),
    ("Chevrolet Camaro",     "Chevrolet", "Camaro",     2012, 2023),
    ("Chevrolet Trax",       "Chevrolet", "Trax",       2015, 2023),
    ("Chevrolet Sonic",      "Chevrolet", "Sonic",      2012, 2020),
    # GMC
    ("GMC Sierra 1500 Pickup", "GMC", "Sierra 1500",    2012, 2023),
    ("GMC Sierra 2500 Pickup", "GMC", "Sierra 2500",    2012, 2023),
    ("GMC Terrain",          "GMC", "Terrain",          2012, 2023),
    ("GMC Acadia",           "GMC", "Acadia",           2012, 2023),
    ("GMC Yukon",            "GMC", "Yukon",            2012, 2023),
    ("GMC Canyon",           "GMC", "Canyon",           2015, 2023),
    # DODGE / RAM
    ("Dodge Ram 1500 Pickup","Dodge", "Ram 1500",       2012, 2023),
    ("Dodge Ram 2500 Pickup","Dodge", "Ram 2500",       2012, 2023),
    ("Dodge Charger",        "Dodge", "Charger",        2012, 2023),
    ("Dodge Challenger",     "Dodge", "Challenger",     2012, 2023),
    ("Dodge Durango",        "Dodge", "Durango",        2012, 2023),
    ("Dodge Journey",        "Dodge", "Journey",        2012, 2020),
    ("Dodge Dart",           "Dodge", "Dart",           2013, 2016),
    ("Dodge Grand Caravan",  "Dodge", "Grand Caravan",  2012, 2020),
    # JEEP
    ("Jeep Grand Cherokee",  "Jeep", "Grand Cherokee",  2012, 2023),
    ("Jeep Cherokee",        "Jeep", "Cherokee",        2014, 2023),
    ("Jeep Wrangler",        "Jeep", "Wrangler",        2012, 2023),
    ("Jeep Compass",         "Jeep", "Compass",         2012, 2023),
    ("Jeep Patriot",         "Jeep", "Patriot",         2012, 2017),
    ("Jeep Renegade",        "Jeep", "Renegade",        2015, 2023),
    ("Jeep Gladiator",       "Jeep", "Gladiator",       2020, 2023),
    # HYUNDAI
    ("Hyundai Sonata",       "Hyundai", "Sonata",       2012, 2023),
    ("Hyundai Elantra",      "Hyundai", "Elantra",      2012, 2023),
    ("Hyundai Santa Fe",     "Hyundai", "Santa Fe",     2012, 2023),
    ("Hyundai Tucson",       "Hyundai", "Tucson",       2012, 2023),
    ("Hyundai Accent",       "Hyundai", "Accent",       2012, 2023),
    ("Hyundai Veloster",     "Hyundai", "Veloster",     2012, 2017),
    ("Hyundai Genesis",      "Hyundai", "Genesis",      2012, 2016),
    # KIA
    ("Kia Optima",           "Kia", "Optima",           2012, 2020),
    ("Kia Sorento",          "Kia", "Sorento",          2012, 2023),
    ("Kia Sportage",         "Kia", "Sportage",         2012, 2023),
    ("Kia Soul",             "Kia", "Soul",             2012, 2023),
    ("Kia Forte",            "Kia", "Forte",            2012, 2023),
    ("Kia Telluride",        "Kia", "Telluride",        2020, 2023),
    ("Kia Stinger",          "Kia", "Stinger",          2018, 2023),
    # SUBARU
    ("Subaru Outback",       "Subaru", "Outback",       2012, 2023),
    ("Subaru Forester",      "Subaru", "Forester",      2012, 2023),
    ("Subaru Impreza",       "Subaru", "Impreza",       2012, 2023),
    ("Subaru Legacy",        "Subaru", "Legacy",        2012, 2023),
    ("Subaru Crosstrek",     "Subaru", "Crosstrek",     2013, 2023),
    ("Subaru Ascent",        "Subaru", "Ascent",        2019, 2023),
    ("Subaru WRX",           "Subaru", "WRX",           2015, 2023),
    # MAZDA
    ("Mazda Mazda3",         "Mazda", "Mazda3",         2012, 2023),
    ("Mazda Mazda6",         "Mazda", "Mazda6",         2012, 2021),
    ("Mazda CX-5",           "Mazda", "CX-5",           2013, 2023),
    ("Mazda CX-9",           "Mazda", "CX-9",           2012, 2023),
    ("Mazda CX-3",           "Mazda", "CX-3",           2016, 2021),
    # VOLKSWAGEN
    ("Volkswagen Jetta",     "Volkswagen", "Jetta",     2012, 2023),
    ("Volkswagen Passat",    "Volkswagen", "Passat",    2012, 2022),
    ("Volkswagen Tiguan",    "Volkswagen", "Tiguan",    2012, 2023),
    ("Volkswagen Atlas",     "Volkswagen", "Atlas",     2018, 2023),
    ("Volkswagen Golf",      "Volkswagen", "Golf",      2012, 2019),
    ("Volkswagen GTI",       "Volkswagen", "GTI",       2012, 2023),
    # LUXURY
    ("BMW 328i",             "BMW", "328i",             2012, 2019),
    ("BMW 330i",             "BMW", "330i",             2016, 2023),
    ("BMW X3",               "BMW", "X3",               2012, 2023),
    ("BMW X5",               "BMW", "X5",               2012, 2023),
    ("Mercedes C-Class",     "Mercedes", "C-Class",     2012, 2023),
    ("Mercedes E-Class",     "Mercedes", "E-Class",     2012, 2023),
    ("Mercedes ML350",       "Mercedes", "ML350",       2012, 2023),
    ("Lexus RX 350",         "Lexus", "RX 350",         2012, 2023),
    ("Lexus ES 350",         "Lexus", "ES 350",         2012, 2023),
    ("Acura MDX",            "Acura", "MDX",            2012, 2023),
    ("Acura RDX",            "Acura", "RDX",            2013, 2023),
    ("Infiniti Q50",         "Infiniti", "Q50",         2014, 2023),
    ("Infiniti QX60",        "Infiniti", "QX60",        2013, 2023),
]

# ─── Logging ──────────────────────────────────────────────────────────────────

def setup_logging():
    for name in ("activity", "errors"):
        logger = logging.getLogger(name)
        logger.setLevel(logging.DEBUG if name == "activity" else logging.ERROR)
        fh = logging.FileHandler(LOG_FILE if name == "activity" else ERROR_LOG, mode="a")
        fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(fh)
    return logging.getLogger("activity"), logging.getLogger("errors")

# ─── Progress / Resume ───────────────────────────────────────────────────────

def load_progress():
    done = set()
    if PROGRESS_FILE.exists():
        for line in PROGRESS_FILE.read_text().splitlines():
            if line.strip():
                done.add(line.strip())
    return done

def save_progress(key):
    with open(PROGRESS_FILE, "a") as f:
        f.write(key + "\n")

def make_key(make, model, year, part):
    return f"{make}|{model}|{year}|{part}"

# ─── CSV ──────────────────────────────────────────────────────────────────────

RAW_FIELDS = [
    "year", "make", "model", "part", "variant", "num_listings", "prices",
    "avg_price", "median_price", "min_price", "max_price",
    "filter_note", "timestamp",
]
FINAL_FIELDS = [
    "year", "make", "model", "engine_variant", "engine_avg", "engine_listings",
    "trans_variant", "trans_avg", "trans_listings",
    "combined_avg", "confidence",
]

def init_raw_csv():
    if not RAW_CSV.exists():
        with open(RAW_CSV, "w", newline="") as f:
            csv.DictWriter(f, fieldnames=RAW_FIELDS).writeheader()

def write_raw_row(row):
    with open(RAW_CSV, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=RAW_FIELDS)
        w.writerow(row)
        f.flush()
        os.fsync(f.fileno())

def load_raw_results():
    """Load raw CSV, keeping each variant as its own entry."""
    # Returns: { (year, make, model): { "Engine": [ {variant, prices, ...}, ... ], "Transmission": [...] } }
    results = {}
    if not RAW_CSV.exists():
        return results
    with open(RAW_CSV, "r") as f:
        for row in csv.DictReader(f):
            key = (int(row["year"]), row["make"], row["model"])
            part = row["part"]
            if key not in results:
                results[key] = {}
            if part not in results[key]:
                results[key][part] = []
            try:
                prices = json.loads(row["prices"]) if row["prices"] else []
                results[key][part].append({
                    "variant": row.get("variant", "unknown"),
                    "prices": prices,
                    "num_listings": int(row["num_listings"] or 0),
                })
            except Exception:
                pass
    return results

def generate_filtered_csv():
    """
    Generate filtered CSV pairing each engine variant with each transmission variant.
    Each row = one specific engine variant + one specific transmission variant.
    Only includes combos where BOTH avg ≤ $1,500, each has 3+ listings.
    """
    raw = load_raw_results()
    rows = []

    for (year, make, model), parts in raw.items():
        engine_variants = parts.get("Engine", [])
        trans_variants = parts.get("Transmission", [])

        if not engine_variants or not trans_variants:
            continue

        # Calculate stats for each engine variant
        eng_stats = []
        for ev in engine_variants:
            avg, _, _, _, n = calc_stats(ev["prices"])
            if avg is not None and n >= 3:
                eng_stats.append((ev["variant"], avg, n))

        # Calculate stats for each transmission variant
        trn_stats = []
        for tv in trans_variants:
            avg, _, _, _, n = calc_stats(tv["prices"])
            if avg is not None and n >= 3:
                trn_stats.append((tv["variant"], avg, n))

        # Pair each engine variant with each transmission variant
        for e_var, e_avg, e_n in eng_stats:
            for t_var, t_avg, t_n in trn_stats:
                if e_avg > 1500 or t_avg > 1500:
                    continue

                combined = round(e_avg + t_avg, 2)
                total = e_n + t_n
                confidence = "High" if total >= 40 else ("Medium" if total >= 20 else "Low")

                if confidence == "Low":
                    continue

                # Clean up variant names for display
                e_label = e_var.strip('"[] ') if e_var else "standard"
                t_label = t_var.strip('"[] ') if t_var else "standard"

                rows.append({
                    "year": year, "make": make, "model": model,
                    "engine_variant": e_label,
                    "engine_avg": round(e_avg, 2),
                    "engine_listings": e_n,
                    "trans_variant": t_label,
                    "trans_avg": round(t_avg, 2),
                    "trans_listings": t_n,
                    "combined_avg": combined,
                    "confidence": confidence,
                })

    rows.sort(key=lambda r: r["combined_avg"])
    with open(FILTERED_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FINAL_FIELDS)
        w.writeheader()
        for row in rows:
            w.writerow(row)
        f.flush()
        os.fsync(f.fileno())
    return rows

# ─── Statistics ───────────────────────────────────────────────────────────────

def calc_stats(prices):
    if not prices:
        return None, None, None, None, 0
    arr = np.array(prices, dtype=float)
    if len(arr) == 1:
        v = float(arr[0])
        return v, v, v, v, 1
    if len(arr) == 2:
        return float(np.mean(arr)), float(np.median(arr)), float(np.min(arr)), float(np.max(arr)), 2
    mean, std = np.mean(arr), np.std(arr)
    if std > 0:
        filtered = arr[np.abs(arr - mean) <= 2 * std]
        if len(filtered) == 0:
            filtered = arr
    else:
        filtered = arr
    return (float(np.mean(filtered)), float(np.median(filtered)),
            float(np.min(filtered)), float(np.max(filtered)), int(len(filtered)))

# ─── Price extraction ─────────────────────────────────────────────────────────

PRICE_RE = re.compile(r'\$\s*([\d,]+(?:\.\d{1,2})?)')

# Pattern to match a listing block from the results page text.
# Each listing in the body text looks roughly like:
#   [year]\n[Part Type]\n[Model]\t[Description]\n...\n[miles]\t[grade]\t[stock#]\t$[price]\t[dealer]
# We parse line-by-line looking for price lines that also contain grade and miles.

# Regex to find a line/block with:  miles(number)  grade(A/B/C/X)  stock#  $price
LISTING_RE = re.compile(
    r'([\d,]+)\s+'           # miles (captured group 1)
    r'([ABCX])\s+'           # grade (captured group 2)
    r'\S+\s+'                # stock number
    r'\$([\d,]+(?:\.\d{1,2})?)',  # price (captured group 3)
    re.IGNORECASE
)

# Some listings show grade X with no miles — pattern: [grade] [stock] $[price]
LISTING_NO_MILES_RE = re.compile(
    r'\b([ABCX])\s+'          # grade
    r'\S+\s+'                  # stock
    r'\$([\d,]+(?:\.\d{1,2})?)',   # price
    re.IGNORECASE
)

def extract_filtered_prices(text, max_miles=100000, target_grade="A"):
    """
    Parse results page text and extract prices ONLY from listings that are:
      - Grade A
      - Under 100,000 miles
    Returns list of qualifying price floats.
    """
    prices = []

    for match in LISTING_RE.finditer(text):
        miles_str = match.group(1).replace(",", "")
        grade = match.group(2).upper()
        price_str = match.group(3).replace(",", "")

        try:
            miles = int(miles_str)
            price = float(price_str)
        except ValueError:
            continue

        if grade == target_grade and miles <= max_miles and 50 <= price <= 25000:
            prices.append(price)

    return prices

def extract_all_prices(text):
    """Fallback: extract ALL prices from page regardless of grade/miles."""
    prices = []
    for m in PRICE_RE.findall(text):
        try:
            p = float(m.replace(",", ""))
            if 50 <= p <= 25000:
                prices.append(p)
        except ValueError:
            pass
    return prices

def is_variant_page(page):
    """Check if current page is the variant-selection (radio button) page."""
    radios = page.query_selector_all('input[name="dummyVar"]')
    return len(radios) > 0

def scrape_results_page(page, log):
    """
    Extract prices from results page.
    Primary: Grade A, under 100k miles only.
    Fallback: all prices if no Grade A under 100k found.
    """
    time.sleep(2)
    text = page.inner_text("body")

    # Primary: filtered by grade A + under 100k miles
    prices = extract_filtered_prices(text, max_miles=100000, target_grade="A")
    if prices:
        log.info(f"  Extracted {len(prices)} Grade-A <100k prices")
        return prices

    # Fallback: if no grade A under 100k, try all prices
    prices = extract_all_prices(text)
    if prices:
        log.info(f"  Fallback: extracted {len(prices)} total prices (no Grade-A <100k found)")
    else:
        log.info(f"  No prices found on results page")
    return prices

# ─── Core search logic ────────────────────────────────────────────────────────

def fill_and_submit_homepage(page, year, model_value, part, log):
    """Fill the homepage form and submit. Returns True on success."""
    page.goto("https://www.car-part.com/index.htm", timeout=PAGE_TIMEOUT,
              wait_until="domcontentloaded")
    time.sleep(2)

    # Year
    page.select_option('select[name="userDate"]', str(year))
    time.sleep(0.5)

    # Make/Model — try exact value first, then fuzzy match
    try:
        page.select_option('select[name="userModel"]', model_value)
    except Exception:
        # Try fuzzy: find option whose text contains our value
        options = page.query_selector_all('select[name="userModel"] option')
        matched = False
        model_lower = model_value.lower()
        for opt in options:
            opt_text = (opt.inner_text() or "").strip()
            opt_val  = (opt.get_attribute("value") or "").strip()
            if model_lower in opt_text.lower() or model_lower in opt_val.lower():
                page.select_option('select[name="userModel"]', value=opt_val)
                log.info(f"  Fuzzy matched model: {opt_val}")
                matched = True
                break
        if not matched:
            log.warning(f"  Could not find model '{model_value}' in dropdown")
            return False
    time.sleep(0.5)

    # Part
    page.select_option('select[name="userPart"]', part)
    time.sleep(0.5)

    # Location & sort
    page.select_option('select[name="userLocation"]', "USA")
    page.select_option('select[name="userPreference"]', "price")

    # Zip code
    zi = page.query_selector('input[name="userZip"]')
    if zi:
        zi.fill(ZIP_CODE)

    time.sleep(0.5)

    # Submit
    btn = page.query_selector('input[type="submit"]') or page.query_selector('input[type="image"]')
    if btn:
        btn.click()
    else:
        page.evaluate("document.forms[0].submit()")

    page.wait_for_load_state("domcontentloaded", timeout=PAGE_TIMEOUT)
    time.sleep(3)
    return True

def scrape_all_variants(page, log):
    """
    On the variant page, iterate through each radio button variant:
      - check it, submit the form, scrape prices, go back, repeat.
    Returns dict: {variant_label: [prices]}
    """
    results = {}

    # Gather variant info
    radios = page.query_selector_all('input[name="dummyVar"]')
    variant_count = len(radios)

    if variant_count == 0:
        return results

    # Get labels for each radio
    variant_info = []
    for i, r in enumerate(radios):
        val = r.get_attribute("value") or ""
        # Skip the "None" value radio (it's usually a catch-all)
        if val == "None" or val == "":
            continue
        try:
            label = r.evaluate(
                "el => { let sib = el.nextSibling; return sib ? sib.textContent.trim() : ''; }"
            )
            if not label:
                label = r.evaluate("el => el.parentElement.innerText.trim()")
        except Exception:
            label = f"variant_{i}"
        variant_info.append((i, val, label[:120]))

    log.info(f"  Found {len(variant_info)} variants to scrape")

    for idx, (radio_idx, radio_val, label) in enumerate(variant_info):
        try:
            log.info(f"  Variant {idx+1}/{len(variant_info)}: {label}")

            # Re-query radios (page may have reloaded)
            radios = page.query_selector_all('input[name="dummyVar"]')
            if radio_idx >= len(radios):
                log.warning(f"  Radio index {radio_idx} out of range, skipping")
                continue

            # Check this radio button
            radios[radio_idx].check()
            time.sleep(0.5)

            # Submit the form
            form = page.query_selector('#MainForm')
            if form:
                submit_btn = form.query_selector('input[type="submit"]')
                if submit_btn:
                    submit_btn.click()
                else:
                    page.evaluate("document.getElementById('MainForm').submit()")
            else:
                page.evaluate("document.forms[0].submit()")

            page.wait_for_load_state("domcontentloaded", timeout=PAGE_TIMEOUT)
            time.sleep(3)

            # Now we should be on the results page — scrape prices
            prices = scrape_results_page(page, log)
            results[label] = prices

            # Go back to variant page for next variant
            if idx < len(variant_info) - 1:
                page.go_back(timeout=PAGE_TIMEOUT)
                page.wait_for_load_state("domcontentloaded", timeout=PAGE_TIMEOUT)
                time.sleep(2)

            # Polite delay between variant requests
            time.sleep(random.uniform(2, 4))

        except Exception as e:
            log.warning(f"  Error on variant {label}: {e}")
            # Try to get back to variant page
            try:
                page.go_back(timeout=PAGE_TIMEOUT)
                time.sleep(2)
            except Exception:
                pass

    return results

def perform_search(page, year, model_value, part, display_make, display_model, log, error_log):
    """
    Full search flow:
      1. Fill homepage → submit
      2. If variant page → scrape each variant
      3. If direct results → scrape prices
    Returns: (all_prices_list, variant_details_dict)
    """
    all_prices = []
    variant_details = {}

    try:
        ok = fill_and_submit_homepage(page, year, model_value, part, log)
        if not ok:
            return all_prices, variant_details

        # Check what page we landed on
        if is_variant_page(page):
            log.info(f"  Variant selection page detected")
            variant_details = scrape_all_variants(page, log)
            for label, prices in variant_details.items():
                all_prices.extend(prices)
        else:
            # Might be direct results or no-results page
            text = page.inner_text("body")
            prices = extract_prices_from_text(text)
            if prices:
                log.info(f"  Direct results: {len(prices)} prices")
                all_prices = prices
                variant_details["direct"] = prices
            else:
                log.info(f"  No prices found (no results or unrecognized page)")

    except PlaywrightTimeout as e:
        log.warning(f"  Timeout: {e}")
        error_log.error(f"Timeout: {year} {display_make} {display_model} {part}: {e}")
    except Exception as e:
        log.warning(f"  Error: {e}")
        error_log.error(
            f"Error: {year} {display_make} {display_model} {part}: {e}\n"
            f"{traceback.format_exc()}"
        )

    return all_prices, variant_details

# ─── Build task list ──────────────────────────────────────────────────────────

def build_tasks():
    tasks = []
    for model_val, make, model, y_start, y_end in VEHICLES:
        for year in range(y_start, y_end + 1):
            for part in PARTS:
                tasks.append((model_val, make, model, year, part))
    return tasks

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    log, error_log = setup_logging()
    log.info("=" * 60)
    log.info("Car-Part.com Scraper v2 starting")
    log.info("=" * 60)

    completed = load_progress()
    init_raw_csv()

    tasks = build_tasks()
    total = len(tasks)
    remaining = [t for t in tasks if make_key(t[1], t[2], t[3], t[4]) not in completed]
    done_count = total - len(remaining)

    print(f"\n{'='*60}")
    print(f"  CAR-PART.COM USED AUTO PARTS PRICE SCRAPER v2")
    print(f"{'='*60}")
    print(f"  Total search tasks:    {total}")
    print(f"  Already completed:     {done_count}")
    print(f"  Remaining:             {len(remaining)}")
    print(f"  Est. time (@ ~15s avg): {len(remaining) * 15 / 3600:.1f} hours")
    print(f"{'='*60}\n")

    if not remaining:
        print("All searches complete! Generating filtered CSV...")
        filtered = generate_filtered_csv()
        print_final(total, filtered, 0)
        return

    start = time.time()
    searches = 0
    qualifying = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
                  "--disable-gpu", "--no-zygote", "--disable-blink-features=AutomationControlled"],
        )
        ctx = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
        )
        ctx.route("**/*.{png,jpg,jpeg,gif,svg,ico,woff,woff2,ttf,eot}",
                   lambda route: route.abort())
        page = ctx.new_page()
        page.set_default_timeout(PAGE_TIMEOUT)

        for model_val, make, model, year, part in remaining:
            key = make_key(make, model, year, part)
            log.info(f"Searching: {year} {make} {model} - {part}")

            all_prices = []
            variant_details = {}

            for attempt in range(1, MAX_RETRIES + 1):
                try:
                    all_prices, variant_details = perform_search(
                        page, year, model_val, part, make, model, log, error_log
                    )
                    break
                except Exception as e:
                    error_log.error(
                        f"Attempt {attempt}/{MAX_RETRIES}: {year} {make} {model} {part}: "
                        f"{e}\n{traceback.format_exc()}"
                    )
                    if attempt < MAX_RETRIES:
                        log.info(f"  Retrying in {RETRY_WAIT}s...")
                        time.sleep(RETRY_WAIT)
                        try:
                            page.close()
                        except Exception:
                            pass
                        page = ctx.new_page()
                        page.set_default_timeout(PAGE_TIMEOUT)

            # Write ONE ROW PER VARIANT so each engine/trans type has its own average
            if variant_details:
                for variant_label, prices in variant_details.items():
                    avg, med, mn, mx, count = calc_stats(prices)
                    filter_note = "Grade-A <100k" if prices else "no results"
                    row = {
                        "year": year, "make": make, "model": model, "part": part,
                        "variant": variant_label,
                        "num_listings": count,
                        "prices": json.dumps(prices[:100]),
                        "avg_price": round(avg, 2) if avg is not None else "",
                        "median_price": round(med, 2) if med is not None else "",
                        "min_price": round(mn, 2) if mn is not None else "",
                        "max_price": round(mx, 2) if mx is not None else "",
                        "filter_note": filter_note,
                        "timestamp": datetime.now().isoformat(),
                    }
                    write_raw_row(row)
            else:
                # No variants found (no results page) — write a single empty row
                row = {
                    "year": year, "make": make, "model": model, "part": part,
                    "variant": "none",
                    "num_listings": 0,
                    "prices": "[]",
                    "avg_price": "", "median_price": "", "min_price": "", "max_price": "",
                    "filter_note": "no results",
                    "timestamp": datetime.now().isoformat(),
                }
                write_raw_row(row)

            save_progress(key)

            # For logging/progress, compute overall stats
            avg, med, mn, mx, count = calc_stats(all_prices)

            searches += 1
            total_done = done_count + searches

            # Qualifying count — check if any engine+trans variant combo qualifies
            raw = load_raw_results()
            qualifying = 0
            for (y, mk, md), pd in raw.items():
                eng_list = pd.get("Engine", [])
                trn_list = pd.get("Transmission", [])
                found = False
                for ev in eng_list:
                    ea, _, _, _, en = calc_stats(ev["prices"])
                    if not ea or en < 3 or ea > 1500:
                        continue
                    for tv in trn_list:
                        ta, _, _, _, tn = calc_stats(tv["prices"])
                        if ta and tn >= 3 and ta <= 1500:
                            found = True
                            break
                    if found:
                        break
                if found:
                    qualifying += 1

            # Progress
            if searches % PROGRESS_EVERY == 0:
                elapsed = time.time() - start
                avg_t = elapsed / searches
                rem = len(remaining) - searches
                est_h = (rem * avg_t) / 3600

                print(f"\n--- Progress [{total_done}/{total}] ---")
                print(f"  Remaining:  {rem}")
                print(f"  Est. left:  {est_h:.1f} hours")
                print(f"  Qualifying: {qualifying}")
                if avg is not None:
                    print(f"  Last: {year} {make} {model} {part} → {count} listings, avg=${avg:.0f}")
                else:
                    print(f"  Last: {year} {make} {model} {part} → no results")
                print(f"---\n")

            if avg is not None:
                log.info(f"Result: {year} {make} {model} {part} → {count} listings, avg=${avg:.0f}")
            else:
                log.info(f"Result: {year} {make} {model} {part} → no results")

            # Delay
            time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))

        browser.close()

    print("\nGenerating filtered CSV...")
    filtered = generate_filtered_csv()
    elapsed = time.time() - start
    print_final(total, filtered, elapsed)

def print_final(total, rows, elapsed):
    h = int(elapsed // 3600) if elapsed else 0
    m = int((elapsed % 3600) // 60) if elapsed else 0

    print(f"\n{'='*60}")
    print(f"  SCRAPER COMPLETE")
    print(f"{'='*60}")
    print(f"  Total searches:     {total}")
    print(f"  Qualifying (≤$1500): {len(rows)}")
    print(f"  Time:               {h}h {m}m")
    print(f"  Raw CSV:            {RAW_CSV}")
    print(f"  Filtered CSV:       {FILTERED_CSV}")

    if rows:
        print(f"\n  TOP 10 CHEAPEST (each row = specific engine + trans variant):")
        print(f"  {'Year':<6}{'Make':<12}{'Model':<16}{'Eng$':>7}{'Trans$':>8}{'Comb$':>8}")
        print(f"  {'-'*57}")
        for r in rows[:10]:
            print(f"  {r['year']:<6}{r['make']:<12}{r['model']:<16}"
                  f"${r['engine_avg']:>6.0f}${r['trans_avg']:>7.0f}"
                  f"${r['combined_avg']:>7.0f}")
            ev = r.get('engine_variant', '')[:50]
            tv = r.get('trans_variant', '')[:50]
            print(f"      Eng: {ev}")
            print(f"      Trans: {tv}")
    else:
        print(f"\n  No vehicles with both engine + trans avg ≤ $1,500")

    print(f"{'='*60}\n")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
AI Deal Finder ("smart deal finder") for CarHunter.

Port of the AI listing-evaluation feature of BoPeng/ai-marketplace-monitor
(https://github.com/BoPeng/ai-marketplace-monitor), adapted for this repo:

  1. PREFILTER  — keywords / antikeywords (boolean expressions supported),
                  price range, excluded sellers. Cheap filters run before AI.
  2. AI RATING  — an LLM rates each surviving listing 1-5 against the user's
                  criteria and must conclude with `Rating <1-5>: <summary>`.
                  Backends ([ai.*] config sections) are tried in order;
                  first success wins. All-fail => fail-open, marked
                  "Not evaluated by AI" (same as upstream).
  3. GATE       — listings scoring below the item's `rating` threshold
                  (default 3) are dropped.
  4. OUTPUT     — qualifying deals are written to a results JSON along with
                  Slack alert DRAFTS. Nothing is sent anywhere: CarHunter is
                  Level 2 (draft + alert humans), so drafts must pass the
                  Evaluator before any real alert goes out.

CarHunter-specific addition: if the carpart_scraper.py output CSV is present,
listings are enriched with known Grade-A engine/transmission replacement
costs for the matching year/make/model, and the AI is asked to weigh
repair/flip margin ("mechanic special" evaluation).

Rating rubric (verbatim from upstream):
  1 - No match, 2 - Potential match, 3 - Poor match, 4 - Good match,
  5 - Great deal.

Usage:
  python3 ai_deal_finder.py --demo                     # offline demo, no API key
  python3 ai_deal_finder.py --listings listings.json   # rate real listings
  python3 ai_deal_finder.py --listings l.json --item mechanic_special --min-rating 4

Config: deal_finder_config.toml (see deal_finder_config.example.toml).
API keys are read from environment variables by default
(ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY) — do not commit keys.
"""

import argparse
import csv
import hashlib
import json
import logging
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    import tomllib  # Python 3.11+
except ModuleNotFoundError:  # pragma: no cover
    try:
        import tomli as tomllib
    except ModuleNotFoundError:
        tomllib = None

SCRIPT_DIR = Path(__file__).resolve().parent

DEFAULT_CONFIG_PATH = SCRIPT_DIR / "deal_finder_config.toml"
DEFAULT_CACHE_PATH = SCRIPT_DIR / "deal_finder_cache.json"
DEFAULT_RESULTS_PATH = SCRIPT_DIR / "deal_finder_results.json"
DEFAULT_PARTS_CSV = SCRIPT_DIR / "carpart_under_1500.csv"

DEFAULT_RATING_THRESHOLD = 3
RETRY_WAIT = 5

# ─── Rating rubric & prompt text (kept verbatim from ai-marketplace-monitor) ──

RATING_RUBRIC = """\
1 - No match: Missing key details, wrong category/brand, or suspicious activity
2 - Potential match: Lacks essential info; needs clarification
3 - Poor match: Some mismatches or missing details; acceptable but not ideal
4 - Good match: Mostly meets criteria with clear, relevant details
5 - Great deal: Fully matches criteria, with excellent condition or price"""

DEFAULT_EVAL_PROMPT = (
    "Evaluate how well this listing matches the user's criteria. "
    "Assess the description, MSRP, model year, condition, and seller's credibility."
)

DEFAULT_RATING_PROMPT = (
    'Conclude your response with "Rating <1-5>: <brief summary of 30 words or less>".'
)

SYSTEM_PROMPT = (
    "You are a helpful assistant that can confirm if a user's search criteria "
    "matches the item he is interested in."
)

CONCLUSION_LABELS = {
    1: "No match",
    2: "Potential match",
    3: "Poor match",
    4: "Good match",
    5: "Great deal",
}

# ─── Logging ──────────────────────────────────────────────────────────────────

def get_logger():
    logger = logging.getLogger("ai_deal_finder")
    if not logger.handlers:
        h = logging.StreamHandler()
        h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
        logger.addHandler(h)
        logger.setLevel(logging.INFO)
    return logger

# ─── Listing ──────────────────────────────────────────────────────────────────

@dataclass
class Listing:
    title: str
    price: str = ""
    description: str = ""
    location: str = ""
    seller: str = ""
    condition: str = ""
    post_url: str = ""
    image: str = ""
    marketplace: str = "marketplace"
    id: str = ""
    year: Optional[int] = None
    make: str = ""
    model: str = ""

    @classmethod
    def from_dict(cls, d):
        known = {f: d.get(f) for f in cls.__dataclass_fields__ if d.get(f) is not None}
        if "year" in known:
            try:
                known["year"] = int(known["year"])
            except (TypeError, ValueError):
                del known["year"]
        listing = cls(**{k: v for k, v in known.items()})
        if not listing.id:
            listing.id = listing.hash
        return listing

    @property
    def hash(self):
        """Stable identity: post URL without query params; falls back to
        title|price|description. The image is excluded (as upstream)."""
        base = self.post_url.split("?")[0] if self.post_url else ""
        if not base:
            base = f"{self.title}|{self.price}|{self.description}"
        return hashlib.sha256(base.encode("utf-8")).hexdigest()[:16]

    def price_value(self):
        digits = re.sub(r"[^\d.]", "", str(self.price))
        try:
            return float(digits) if digits else None
        except ValueError:
            return None

    def render(self):
        lines = [f"Title: {self.title}"]
        if self.condition:
            lines.append(f"Condition: {self.condition}")
        lines.append(f"Price: {self.price or 'not listed'}")
        if self.location:
            lines.append(f"Location: {self.location}")
        if self.seller:
            lines.append(f"Seller: {self.seller}")
        if self.description:
            lines.append(f"Description: {self.description}")
        return "\n".join(lines)

# ─── Item criteria (an [item.X] config section) ───────────────────────────────

@dataclass
class ItemConfig:
    name: str
    search_phrases: list = field(default_factory=list)
    description: str = ""
    keywords: object = None       # str expression or list of terms
    antikeywords: object = None   # str expression or list of terms
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    exclude_sellers: list = field(default_factory=list)
    rating: int = DEFAULT_RATING_THRESHOLD
    prompt: str = ""
    extra_prompt: str = ""
    rating_prompt: str = ""
    ai: list = field(default_factory=list)  # backend names, in priority order

    @classmethod
    def from_config(cls, name, section):
        rating = section.get("rating", DEFAULT_RATING_THRESHOLD)
        if isinstance(rating, list):  # upstream allows a list; use the first
            rating = rating[0] if rating else DEFAULT_RATING_THRESHOLD
        phrases = section.get("search_phrases", [])
        if isinstance(phrases, str):
            phrases = [phrases]

        def num(key):
            v = section.get(key)
            return float(v) if v is not None else None

        return cls(
            name=name,
            search_phrases=phrases,
            description=section.get("description", ""),
            keywords=section.get("keywords"),
            antikeywords=section.get("antikeywords"),
            min_price=num("min_price"),
            max_price=num("max_price"),
            exclude_sellers=section.get("exclude_sellers", []) or [],
            rating=int(rating),
            prompt=section.get("prompt", ""),
            extra_prompt=section.get("extra_prompt", ""),
            rating_prompt=section.get("rating_prompt", ""),
            ai=section.get("ai", []) or [],
        )

    @property
    def hash(self):
        """Changes whenever any prompt-affecting criterion changes, which
        invalidates cached AI evaluations (mirrors upstream's item hash)."""
        payload = json.dumps(
            {k: getattr(self, k) for k in (
                "name", "search_phrases", "description", "keywords",
                "antikeywords", "min_price", "max_price",
                "prompt", "extra_prompt", "rating_prompt",
            )},
            sort_keys=True, default=str,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]

# ─── Keyword boolean expressions ──────────────────────────────────────────────
# Supports the upstream syntax:  keywords = "('Go Pro' OR gopro) AND (11 OR 12)"
# Terms are case-insensitive substring matches against title + description.

_TOKEN_RE = re.compile(r"""\s*(?:('(?:[^'\\]|\\.)*')|("(?:[^"\\]|\\.)*")|(\()|(\))|([^\s()]+))""")


def _tokenize(expr):
    tokens, pos = [], 0
    while pos < len(expr):
        m = _TOKEN_RE.match(expr, pos)
        if not m or m.end() == pos:
            raise ValueError(f"Cannot tokenize keyword expression at: {expr[pos:]!r}")
        pos = m.end()
        if m.group(1) or m.group(2):
            quoted = m.group(1) or m.group(2)
            tokens.append(("TERM", quoted[1:-1].replace("\\'", "'").replace('\\"', '"')))
        elif m.group(3):
            tokens.append(("LPAREN", "("))
        elif m.group(4):
            tokens.append(("RPAREN", ")"))
        else:
            word = m.group(5)
            upper = word.upper()
            if upper in ("AND", "OR", "NOT"):
                tokens.append((upper, word))
            else:
                tokens.append(("TERM", word))
    return tokens


class _ExprParser:
    """expr := and_expr (OR and_expr)* ; and_expr := not_expr (AND not_expr)* ;
    not_expr := NOT not_expr | atom ; atom := '(' expr ')' | TERM"""

    def __init__(self, tokens, text):
        self.tokens = tokens
        self.pos = 0
        self.text = text.lower()

    def peek(self):
        return self.tokens[self.pos][0] if self.pos < len(self.tokens) else None

    def take(self):
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def parse(self):
        result = self.expr()
        if self.pos != len(self.tokens):
            raise ValueError("Unexpected trailing tokens in keyword expression")
        return result

    def expr(self):
        result = self.and_expr()
        while self.peek() == "OR":
            self.take()
            result = self.and_expr() or result
        return result

    def and_expr(self):
        result = self.not_expr()
        while self.peek() == "AND":
            self.take()
            result = self.not_expr() and result
        return result

    def not_expr(self):
        if self.peek() == "NOT":
            self.take()
            return not self.not_expr()
        return self.atom()

    def atom(self):
        kind, value = self.take()
        if kind == "LPAREN":
            result = self.expr()
            if self.peek() != "RPAREN":
                raise ValueError("Missing ')' in keyword expression")
            self.take()
            return result
        if kind == "TERM":
            return value.lower() in self.text
        raise ValueError(f"Unexpected token {value!r} in keyword expression")


def matches_keywords(spec, text):
    """True if `text` matches the keyword spec (str expression or list of
    terms; a list matches when ANY term is present, as upstream)."""
    if spec is None:
        return True
    if isinstance(spec, str):
        spec = [spec]
    low = text.lower()
    for entry in spec:
        entry = str(entry)
        if re.search(r"\b(AND|OR|NOT)\b|[()]", entry, re.IGNORECASE):
            try:
                if _ExprParser(_tokenize(entry), text).parse():
                    return True
                continue
            except ValueError:
                pass  # not a valid expression — treat as a plain term
        if entry.lower() in low:
            return True
    return False

# ─── Prefilter (runs before any AI call) ──────────────────────────────────────

def prefilter(listing, item):
    """Returns None if the listing passes, otherwise the exclusion reason."""
    text = f"{listing.title}\n{listing.description}"

    price = listing.price_value()
    if price is not None:
        if item.min_price is not None and price < item.min_price:
            return f"price ${price:.0f} below min_price ${item.min_price:.0f}"
        if item.max_price is not None and price > item.max_price:
            return f"price ${price:.0f} above max_price ${item.max_price:.0f}"

    if item.keywords is not None and not matches_keywords(item.keywords, text):
        return "keywords not found in title/description"

    if item.antikeywords is not None and matches_keywords(item.antikeywords, text):
        return "antikeyword found in title/description"

    if item.exclude_sellers and listing.seller:
        seller = listing.seller.lower()
        for excluded in item.exclude_sellers:
            if str(excluded).lower() in seller:
                return f"seller excluded ({listing.seller})"

    return None

# ─── Parts-price enrichment (CarHunter integration) ───────────────────────────

def load_parts_data(csv_path):
    """Load carpart_scraper.py's filtered CSV: (year, make, model) -> best
    (cheapest combined) engine+transmission variant row."""
    data = {}
    path = Path(csv_path)
    if not path.exists():
        return data
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            try:
                key = (int(row["year"]), row["make"].strip(), row["model"].strip())
                combined = float(row["combined_avg"])
            except (KeyError, TypeError, ValueError):
                continue
            if key not in data or combined < float(data[key]["combined_avg"]):
                data[key] = row
    return data


def match_parts_row(listing, parts_data):
    """Find the parts-cost row for a listing via explicit year/make/model
    fields, else by scanning the title. Longest model name wins ties."""
    if not parts_data:
        return None
    if listing.year and listing.make and listing.model:
        for (year, make, model), row in parts_data.items():
            if (year == listing.year
                    and make.lower() == listing.make.lower()
                    and model.lower() == listing.model.lower()):
                return row
    title = listing.title.lower()
    best = None
    for (year, make, model), row in parts_data.items():
        if str(year) in title and make.lower() in title and model.lower() in title:
            if best is None or len(model) > len(best[0]):
                best = (model, row)
    return best[1] if best else None


def render_parts_context(row):
    return (
        f"Known replacement part costs from car-part.com for this vehicle "
        f"({row['year']} {row['make']} {row['model']}):\n"
        f"- Used Grade-A engine: avg ${float(row['engine_avg']):.0f} "
        f"({row['engine_listings']} listings), variant: {row['engine_variant']}\n"
        f"- Used transmission: avg ${float(row['trans_avg']):.0f} "
        f"({row['trans_listings']} listings), variant: {row['trans_variant']}\n"
        f"- Combined engine + transmission: ${float(row['combined_avg']):.0f} "
        f"(confidence: {row.get('confidence', 'unknown')})\n"
        f"If the listing needs an engine or transmission, factor these repair "
        f"costs into whether the asking price still leaves a profitable margin."
    )

# ─── Prompt construction (mirrors upstream get_prompt) ────────────────────────

def build_prompt(listing, item, parts_context=""):
    parts = [f"A user wants to buy a {item.name} from {listing.marketplace} "
             f"with the following requirements:"]
    if item.description:
        parts.append(item.description)
    if item.search_phrases:
        parts.append("The user searched for: " + "; ".join(item.search_phrases))

    if item.min_price is not None and item.max_price is not None:
        parts.append(f"The price of the item should be between "
                     f"${item.min_price:.0f} and ${item.max_price:.0f}.")
    elif item.max_price is not None:
        parts.append(f"The price of the item should be no more than ${item.max_price:.0f}.")
    elif item.min_price is not None:
        parts.append(f"The price of the item should be at least ${item.min_price:.0f}.")

    if item.antikeywords:
        anti = item.antikeywords
        anti_text = anti if isinstance(anti, str) else ", ".join(str(a) for a in anti)
        parts.append(f"Exclude listings with the following keywords in the "
                     f"title or description: {anti_text}.")

    parts.append("Here is the listing found:\n" + listing.render())

    if parts_context:
        parts.append(parts_context)

    parts.append(item.prompt or DEFAULT_EVAL_PROMPT)
    parts.append("Rate the listing on a scale of 1 to 5 based on the "
                 "following criteria:\n" + RATING_RUBRIC)
    if item.extra_prompt:
        parts.append(item.extra_prompt)
    parts.append(item.rating_prompt or DEFAULT_RATING_PROMPT)

    return "\n\n".join(parts)

# ─── AI response ──────────────────────────────────────────────────────────────

NOT_EVALUATED = "Not evaluated by AI"

# Upstream parsing regex: last line matching "... Rating <1-5>: comment" wins.
RATING_RE = re.compile(r".*Rating[^1-5]*([1-5])[:\s]*(.*)", re.IGNORECASE)


@dataclass
class AIResponse:
    score: int
    comment: str
    backend: str = ""
    cached: bool = False

    @property
    def conclusion(self):
        return CONCLUSION_LABELS.get(self.score, "Unknown")

    @property
    def not_evaluated(self):
        return self.comment == NOT_EVALUATED

    def to_dict(self):
        return {
            "score": self.score,
            "comment": self.comment,
            "conclusion": self.conclusion,
            "backend": self.backend,
            "cached": self.cached,
            "not_evaluated": self.not_evaluated,
        }


def parse_ai_response(text):
    """Extract (score, comment) from the model's reply. If the comment on the
    rating line is too short, use the preceding non-empty line (as upstream)."""
    score, comment, prev = None, "", ""
    for line in text.splitlines():
        m = RATING_RE.match(line)
        if m:
            score = int(m.group(1))
            comment = m.group(2).strip()
            if len(comment) < 5 and prev:
                comment = prev
        if line.strip():
            prev = line.strip()
    if score is None:
        return None
    comment = " ".join(x for x in comment.split() if x.strip()).strip()
    return score, comment

# ─── AI backends ──────────────────────────────────────────────────────────────

PROVIDER_DEFAULTS = {
    # provider: (default model, default base_url, api-key env var)
    "anthropic": ("claude-sonnet-5", "https://api.anthropic.com", "ANTHROPIC_API_KEY"),
    "openai": ("gpt-4o", "https://api.openai.com/v1", "OPENAI_API_KEY"),
    "deepseek": ("deepseek-chat", "https://api.deepseek.com", "DEEPSEEK_API_KEY"),
    "ollama": ("deepseek-r1:14b", "http://localhost:11434/v1", ""),
}


def resolve_api_key(raw, env_var):
    """api_key may be a literal, 'env:VAR_NAME', or omitted (falls back to the
    provider's default environment variable). Never commit literal keys."""
    if raw:
        if isinstance(raw, str) and raw.startswith("env:"):
            return os.environ.get(raw[4:], "")
        return raw
    return os.environ.get(env_var, "") if env_var else ""


class AIBackend:
    def __init__(self, name, section, logger):
        self.name = name
        self.logger = logger
        provider = (section.get("provider") or name).lower()
        if provider not in PROVIDER_DEFAULTS:
            raise ValueError(
                f"[ai.{name}] unknown provider {provider!r} "
                f"(supported: {', '.join(PROVIDER_DEFAULTS)})")
        self.provider = provider
        default_model, default_base, env_var = PROVIDER_DEFAULTS[provider]
        self.model = section.get("model") or default_model
        self.base_url = (section.get("base_url") or default_base).rstrip("/")
        self.api_key = resolve_api_key(section.get("api_key"), env_var)
        if provider == "ollama" and not self.api_key:
            self.api_key = "ollama"
        self.max_retries = int(section.get("max_retries", 10))
        self.timeout = int(section.get("timeout", 120))
        if not self.api_key:
            raise ValueError(
                f"[ai.{name}] no API key: set api_key or the "
                f"{env_var} environment variable")

    def _post(self, url, headers, payload):
        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", **headers},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _complete(self, prompt):
        if self.provider == "anthropic":
            data = self._post(
                f"{self.base_url}/v1/messages",
                {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"},
                {
                    "model": self.model,
                    "max_tokens": 1024,
                    "system": SYSTEM_PROMPT,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            return "".join(
                block.get("text", "") for block in data.get("content", []))
        # openai / deepseek / ollama all speak the chat-completions protocol
        data = self._post(
            f"{self.base_url}/chat/completions",
            {"Authorization": f"Bearer {self.api_key}"},
            {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        return data["choices"][0]["message"]["content"]

    def evaluate(self, prompt):
        """Call the model with retries; returns AIResponse or raises."""
        last_error = None
        for attempt in range(1, self.max_retries + 1):
            try:
                text = self._complete(prompt)
                parsed = parse_ai_response(text)
                if parsed is None:
                    raise ValueError(
                        f"no 'Rating <1-5>:' line in response: {text[:200]!r}")
                score, comment = parsed
                return AIResponse(score=score, comment=comment, backend=self.name)
            except KeyboardInterrupt:
                raise
            except Exception as e:  # noqa: BLE001 — mirror upstream catch-all retry
                last_error = e
                self.logger.warning(
                    "[ai.%s] attempt %d/%d failed: %s",
                    self.name, attempt, self.max_retries, e)
                if attempt < self.max_retries:
                    time.sleep(RETRY_WAIT)
        raise RuntimeError(f"[ai.{self.name}] all retries failed: {last_error}")

# ─── Evaluation cache & notified-tracking ─────────────────────────────────────

class DealCache:
    """JSON-file cache: AI evaluations keyed by (item criteria, listing,
    model) so nothing is re-evaluated or re-alerted across runs."""

    def __init__(self, path, enabled=True):
        self.path = Path(path)
        self.enabled = enabled
        self.data = {"ai": {}, "notified": {}}
        if enabled and self.path.exists():
            try:
                loaded = json.loads(self.path.read_text())
                if isinstance(loaded, dict):
                    self.data["ai"] = loaded.get("ai", {})
                    self.data["notified"] = loaded.get("notified", {})
            except (json.JSONDecodeError, OSError):
                pass

    @staticmethod
    def ai_key(item, listing, model):
        return hashlib.sha256(
            f"ai_inquiry|{item.hash}|{listing.hash}|{model}".encode()).hexdigest()[:32]

    def get_ai(self, item, listing, model):
        if not self.enabled:
            return None
        hit = self.data["ai"].get(self.ai_key(item, listing, model))
        if not hit:
            return None
        return AIResponse(score=hit["score"], comment=hit["comment"],
                          backend=hit.get("backend", ""), cached=True)

    def put_ai(self, item, listing, model, response):
        if not self.enabled or response.not_evaluated:
            return
        self.data["ai"][self.ai_key(item, listing, model)] = {
            "score": response.score,
            "comment": response.comment,
            "backend": response.backend,
            "listing": listing.title,
            "item": item.name,
        }

    def was_notified(self, item, listing):
        return self.enabled and f"{item.name}|{listing.hash}" in self.data["notified"]

    def mark_notified(self, item, listing):
        if self.enabled:
            self.data["notified"][f"{item.name}|{listing.hash}"] = time.strftime(
                "%Y-%m-%dT%H:%M:%S")

    def save(self):
        if self.enabled:
            self.path.write_text(json.dumps(self.data, indent=1))

# ─── Slack draft (Level 2: drafts only, never sent by this script) ───────────

def render_slack_draft(listing, item, response, parts_row=None):
    lines = [
        f"*[AI DEAL FINDER — DRAFT]* {response.conclusion} "
        f"({response.score}/5) — {listing.title} — {listing.price or 'no price'}",
    ]
    meta = " | ".join(x for x in (listing.location, listing.marketplace,
                                  f"seller: {listing.seller}" if listing.seller else "") if x)
    if meta:
        lines.append(meta)
    lines.append(f"AI: {response.comment}")
    if parts_row is not None:
        lines.append(
            f"Parts (car-part.com): engine avg ${float(parts_row['engine_avg']):.0f}, "
            f"trans avg ${float(parts_row['trans_avg']):.0f}, "
            f"combined ${float(parts_row['combined_avg']):.0f}")
    if listing.post_url:
        lines.append(f"Link: {listing.post_url}")
    if response.not_evaluated:
        lines.append("⚠ NOT AI-EVALUATED (all AI backends failed) — needs manual review")
    lines.append("Status: DRAFT — requires carhunter-evaluator pass before sending (Level 2)")
    return "\n".join(lines)

# ─── The deal finder ──────────────────────────────────────────────────────────

class SmartDealFinder:
    def __init__(self, config, logger=None, cache_path=DEFAULT_CACHE_PATH,
                 parts_csv=DEFAULT_PARTS_CSV, use_cache=True, backends=None):
        self.logger = logger or get_logger()
        self.items = {
            name: ItemConfig.from_config(name, section)
            for name, section in (config.get("item") or {}).items()
        }
        if not self.items:
            raise ValueError("config has no [item.X] sections — nothing to search for")

        if backends is not None:  # injected (tests / demo)
            self.backends = backends
        else:
            self.backends = []
            for name, section in (config.get("ai") or {}).items():
                try:
                    self.backends.append(AIBackend(name, section or {}, self.logger))
                except ValueError as e:
                    self.logger.warning("Skipping AI backend: %s", e)
        if not self.backends:
            self.logger.warning(
                "No usable [ai.X] backends — listings will pass through "
                "UNRATED (fail-open, marked '%s')", NOT_EVALUATED)

        self.cache = DealCache(cache_path, enabled=use_cache)
        self.parts_data = load_parts_data(parts_csv)
        if self.parts_data:
            self.logger.info("Loaded parts prices for %d vehicles from %s",
                             len(self.parts_data), parts_csv)

    def backends_for(self, item):
        if item.ai:
            chosen = [b for name in item.ai for b in self.backends if b.name == name]
            return chosen or self.backends
        return self.backends

    def evaluate_listing(self, listing, item):
        """Prefilter -> cache -> AI (first backend to succeed) -> fail-open."""
        reason = prefilter(listing, item)
        if reason is not None:
            return None, reason

        parts_row = match_parts_row(listing, self.parts_data)
        parts_context = render_parts_context(parts_row) if parts_row else ""
        prompt = build_prompt(listing, item, parts_context)

        backends = self.backends_for(item)
        for backend in backends:
            cached = self.cache.get_ai(item, listing, backend.model)
            if cached:
                return cached, None

        for backend in backends:
            try:
                response = backend.evaluate(prompt)
                self.cache.put_ai(item, listing, backend.model, response)
                return response, None
            except KeyboardInterrupt:
                raise
            except Exception as e:  # noqa: BLE001
                self.logger.warning("[ai.%s] backend failed: %s", backend.name, e)

        # Fail-open (as upstream): score 5, clearly marked as not evaluated.
        return AIResponse(score=5, comment=NOT_EVALUATED), None

    def run(self, listings, item_names=None, min_rating=None, renotify=False):
        results = []
        items = [self.items[n] for n in item_names] if item_names else list(self.items.values())

        for item in items:
            threshold = min_rating if min_rating is not None else item.rating
            for listing in listings:
                if not renotify and self.cache.was_notified(item, listing):
                    self.logger.info("[%s] already notified, skipping: %s",
                                     item.name, listing.title)
                    continue

                response, excluded = self.evaluate_listing(listing, item)
                record = {
                    "item": item.name,
                    "listing_id": listing.id,
                    "title": listing.title,
                    "price": listing.price,
                    "location": listing.location,
                    "marketplace": listing.marketplace,
                    "post_url": listing.post_url,
                }
                if excluded:
                    record.update(status="excluded_prefilter", reason=excluded)
                    self.logger.info("[%s] prefilter excluded (%s): %s",
                                     item.name, excluded, listing.title)
                elif response.score < threshold:
                    record.update(status="below_threshold", ai=response.to_dict(),
                                  threshold=threshold)
                    self.logger.info("[%s] %s (%d/5) < %d, dropped: %s",
                                     item.name, response.conclusion,
                                     response.score, threshold, listing.title)
                else:
                    parts_row = match_parts_row(listing, self.parts_data)
                    record.update(
                        status="qualifying",
                        ai=response.to_dict(),
                        threshold=threshold,
                        slack_draft=render_slack_draft(listing, item, response, parts_row),
                    )
                    if parts_row:
                        record["parts"] = {
                            "engine_avg": float(parts_row["engine_avg"]),
                            "trans_avg": float(parts_row["trans_avg"]),
                            "combined_avg": float(parts_row["combined_avg"]),
                            "confidence": parts_row.get("confidence", ""),
                        }
                    self.cache.mark_notified(item, listing)
                    self.logger.info("[%s] QUALIFYING %s (%d/5): %s — %s",
                                     item.name, response.conclusion,
                                     response.score, listing.title, response.comment)
                results.append(record)

        self.cache.save()
        return results

# ─── Input loading ────────────────────────────────────────────────────────────

def load_listings_json(path):
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        data = data.get("listings", [])
    return [Listing.from_dict(d) for d in data]


def load_listings_csv(path):
    with open(path, newline="") as f:
        return [Listing.from_dict(row) for row in csv.DictReader(f)]


def load_config(path):
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"Config not found: {path}. Copy deal_finder_config.example.toml "
            f"to {path.name} and edit it.")
    if path.suffix == ".json":
        return json.loads(path.read_text())
    if tomllib is None:
        raise RuntimeError("TOML support needs Python 3.11+ or `pip install tomli` "
                           "(or use a .json config).")
    with open(path, "rb") as f:
        return tomllib.load(f)

# ─── Demo (offline, no API key needed) ────────────────────────────────────────

class MockBackend:
    """Deterministic offline stand-in for an LLM: scores by crude heuristics
    so the full pipeline can be exercised without network or keys."""

    name = "mock"
    model = "mock-model"

    def evaluate(self, prompt):
        # Heuristics must only see the listing (+ parts context), not the
        # criteria/rubric boilerplate, which contains trigger words itself.
        low = prompt.lower()
        if "here is the listing found:" in low:
            low = low.split("here is the listing found:", 1)[1]
            low = low.split("rate the listing on a scale", 1)[0]
        score = 3
        if "engine" in low and ("blown" in low or "needs" in low or "bad" in low):
            score = 4
        if "combined engine + transmission" in low:
            score = 5  # we know the repair cost — best-informed rating
        if "flood" in low or "no engine" in low:
            score = 2
        return AIResponse(
            score=score,
            comment=f"[mock evaluation] heuristic score {score} — "
                    f"replace with a real [ai.X] backend for production",
            backend=self.name)


DEMO_CONFIG = {
    "item": {
        "mechanic_special": {
            "search_phrases": ["mechanic special", "needs engine", "blown motor"],
            "description": (
                "A 2012-2023 mainstream vehicle (Honda, Toyota, Ford, ...) that "
                "needs an engine or transmission, priced low enough that after "
                "installing used Grade-A parts it can be resold at a profit. "
                "Clean title strongly preferred."),
            "antikeywords": ["parts only", "scrap", "crushed"],
            "min_price": 200,
            "max_price": 4000,
            "rating": 4,
        },
    },
}

DEMO_LISTINGS = [
    {
        "title": "2015 Honda Accord - blown engine, body clean, clean title",
        "price": "$1,400",
        "description": "Engine knocking, needs replacement. Transmission fine. "
                       "Clean title in hand. 128k miles.",
        "location": "Kansas City, MO",
        "seller": "Private",
        "condition": "For parts or repair",
        "post_url": "https://example.com/listing/accord-1",
        "marketplace": "facebook",
        "year": 2015, "make": "Honda", "model": "Accord",
    },
    {
        "title": "2014 Toyota Camry flood car, no engine",
        "price": "$900",
        "description": "Flood damage, engine removed, parts only.",
        "location": "Topeka, KS",
        "seller": "Private",
        "condition": "For parts",
        "post_url": "https://example.com/listing/camry-1",
        "marketplace": "facebook",
    },
    {
        "title": "2018 Ford F-150 needs transmission, runs and drives short distances",
        "price": "$5,500",
        "description": "Transmission slipping badly. Otherwise solid truck.",
        "location": "Olathe, KS",
        "seller": "KC Auto Group",
        "condition": "Needs repair",
        "post_url": "https://example.com/listing/f150-1",
        "marketplace": "craigslist",
    },
]


def run_demo(logger):
    logger.info("Running OFFLINE demo with a mock AI backend (no network/API key).")
    finder = SmartDealFinder(
        DEMO_CONFIG, logger=logger, use_cache=False, backends=[MockBackend()])
    listings = [Listing.from_dict(d) for d in DEMO_LISTINGS]
    return finder.run(listings)

# ─── CLI ──────────────────────────────────────────────────────────────────────

def print_summary(results):
    qualifying = [r for r in results if r["status"] == "qualifying"]
    dropped = [r for r in results if r["status"] == "below_threshold"]
    excluded = [r for r in results if r["status"] == "excluded_prefilter"]

    print(f"\n{'=' * 64}")
    print("  AI DEAL FINDER — RESULTS")
    print(f"{'=' * 64}")
    print(f"  Evaluated: {len(results)}   Qualifying: {len(qualifying)}   "
          f"Below threshold: {len(dropped)}   Prefiltered: {len(excluded)}")
    for r in qualifying:
        ai = r["ai"]
        flag = " [NOT AI-EVALUATED]" if ai["not_evaluated"] else ""
        print(f"\n  ★ [{ai['conclusion']} ({ai['score']}/5)]{flag} "
              f"{r['title']} — {r['price'] or 'no price'}")
        print(f"    {ai['comment']}")
        if r.get("parts"):
            p = r["parts"]
            print(f"    Parts: engine ${p['engine_avg']:.0f} + "
                  f"trans ${p['trans_avg']:.0f} = ${p['combined_avg']:.0f} "
                  f"({p['confidence']})")
        if r.get("post_url"):
            print(f"    {r['post_url']}")
    print(f"{'=' * 64}\n")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="AI smart deal finder (port of ai-marketplace-monitor's "
                    "AI evaluation) for CarHunter.")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH),
                        help="TOML (or JSON) config path")
    parser.add_argument("--listings", help="JSON file with a list of listings")
    parser.add_argument("--csv", help="CSV file with listing rows")
    parser.add_argument("--item", action="append",
                        help="only evaluate against this [item.X] (repeatable)")
    parser.add_argument("--min-rating", type=int, choices=range(1, 6),
                        help="override every item's rating threshold")
    parser.add_argument("--parts-csv", default=str(DEFAULT_PARTS_CSV),
                        help="carpart_scraper filtered CSV for repair-cost context")
    parser.add_argument("--output", default=str(DEFAULT_RESULTS_PATH),
                        help="results JSON output path")
    parser.add_argument("--renotify", action="store_true",
                        help="re-process listings already marked notified")
    parser.add_argument("--no-cache", action="store_true",
                        help="disable the evaluation/notified cache")
    parser.add_argument("--demo", action="store_true",
                        help="run an offline demo with a mock AI backend")
    args = parser.parse_args(argv)

    logger = get_logger()

    if args.demo:
        results = run_demo(logger)
    else:
        if not args.listings and not args.csv:
            parser.error("provide --listings or --csv (or --demo for an offline demo)")
        config = load_config(args.config)
        finder = SmartDealFinder(
            config, logger=logger,
            parts_csv=args.parts_csv,
            use_cache=not args.no_cache)
        listings = []
        if args.listings:
            listings.extend(load_listings_json(args.listings))
        if args.csv:
            listings.extend(load_listings_csv(args.csv))
        unknown = set(args.item or []) - set(finder.items)
        if unknown:
            parser.error(f"unknown --item name(s): {', '.join(sorted(unknown))} "
                         f"(config has: {', '.join(finder.items)})")
        results = finder.run(listings, item_names=args.item,
                             min_rating=args.min_rating, renotify=args.renotify)

    Path(args.output).write_text(json.dumps(results, indent=2))
    logger.info("Wrote %d result records to %s", len(results), args.output)
    print_summary(results)
    return 0


if __name__ == "__main__":
    sys.exit(main())

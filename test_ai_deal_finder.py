#!/usr/bin/env python3
"""Offline tests for ai_deal_finder.py — no network, no API keys.

Run:  python3 -m unittest test_ai_deal_finder -v
"""

import json
import tempfile
import unittest
from pathlib import Path

from ai_deal_finder import (
    AIResponse,
    DealCache,
    ItemConfig,
    Listing,
    MockBackend,
    NOT_EVALUATED,
    SmartDealFinder,
    build_prompt,
    load_parts_data,
    match_parts_row,
    matches_keywords,
    parse_ai_response,
    prefilter,
    render_slack_draft,
)


def make_listing(**overrides):
    base = {
        "title": "2015 Honda Accord blown engine",
        "price": "$1,400",
        "description": "Needs engine, clean title, 128k miles",
        "location": "Kansas City, MO",
        "seller": "Private",
        "condition": "For parts or repair",
        "post_url": "https://example.com/listing/1?ref=share",
        "marketplace": "facebook",
    }
    base.update(overrides)
    return Listing.from_dict(base)


def make_item(**overrides):
    section = {
        "search_phrases": ["mechanic special"],
        "description": "Vehicle needing engine or transmission",
        "min_price": 200,
        "max_price": 4000,
        "rating": 4,
    }
    section.update(overrides)
    return ItemConfig.from_config("mechanic_special", section)


class TestResponseParsing(unittest.TestCase):
    def test_standard_format(self):
        self.assertEqual(
            parse_ai_response("Rating 4: Solid match with clear details."),
            (4, "Solid match with clear details."))

    def test_rating_with_colon_variants(self):
        self.assertEqual(parse_ai_response("Rating: 5 great deal here")[0], 5)
        self.assertEqual(parse_ai_response("**Rating 3:** acceptable")[0], 3)

    def test_multiline_uses_last_rating_line(self):
        text = ("The listing describes a car needing an engine.\n"
                "It is priced fairly.\n"
                "Rating 4: Good match, priced below repair-adjusted value.")
        self.assertEqual(
            parse_ai_response(text),
            (4, "Good match, priced below repair-adjusted value."))

    def test_sparse_comment_uses_preceding_line(self):
        text = "This is a great deal on a clean car.\nRating 5:"
        score, comment = parse_ai_response(text)
        self.assertEqual(score, 5)
        self.assertEqual(comment, "This is a great deal on a clean car.")

    def test_no_rating_returns_none(self):
        self.assertIsNone(parse_ai_response("I cannot evaluate this listing."))

    def test_whitespace_normalized(self):
        score, comment = parse_ai_response("Rating 2:   too   many\tspaces  ")
        self.assertEqual((score, comment), (2, "too many spaces"))


class TestKeywordExpressions(unittest.TestCase):
    TEXT = "2015 Honda Accord blown engine, needs replacement, clean title"

    def test_plain_list_any_match(self):
        self.assertTrue(matches_keywords(["missing", "blown engine"], self.TEXT))
        self.assertFalse(matches_keywords(["missing", "flood"], self.TEXT))

    def test_single_string_term(self):
        self.assertTrue(matches_keywords("clean title", self.TEXT))

    def test_boolean_and_or(self):
        expr = "('blown engine' OR 'bad transmission') AND 'clean title'"
        self.assertTrue(matches_keywords(expr, self.TEXT))
        expr = "('bad transmission' OR flood) AND 'clean title'"
        self.assertFalse(matches_keywords(expr, self.TEXT))

    def test_not(self):
        self.assertTrue(matches_keywords("Accord AND NOT flood", self.TEXT))
        self.assertFalse(matches_keywords("Accord AND NOT engine", self.TEXT))

    def test_case_insensitive(self):
        self.assertTrue(matches_keywords("HONDA and ACCORD", self.TEXT))

    def test_none_matches_everything(self):
        self.assertTrue(matches_keywords(None, self.TEXT))

    def test_unparseable_expression_falls_back_to_substring(self):
        # parens but not a valid boolean expression -> plain substring match
        self.assertTrue(matches_keywords(
            "engine, needs replacement", self.TEXT.replace(
                "blown engine, needs replacement",
                "blown engine, needs replacement")))
        self.assertTrue(matches_keywords("title (clean)",
                                         "car with title (clean) in hand"))
        self.assertFalse(matches_keywords("title (clean)", self.TEXT))


class TestPrefilter(unittest.TestCase):
    def test_passes(self):
        self.assertIsNone(prefilter(make_listing(), make_item()))

    def test_price_too_high(self):
        reason = prefilter(make_listing(price="$5,500"), make_item())
        self.assertIn("above max_price", reason)

    def test_price_too_low(self):
        reason = prefilter(make_listing(price="$100"), make_item())
        self.assertIn("below min_price", reason)

    def test_unparseable_price_passes(self):
        self.assertIsNone(prefilter(make_listing(price="make offer"), make_item()))

    def test_keywords_required(self):
        item = make_item(keywords=["transmission"])
        self.assertIn("keywords not found", prefilter(make_listing(), item))
        self.assertIsNone(prefilter(
            make_listing(description="needs transmission"), item))

    def test_antikeywords_exclude(self):
        item = make_item(antikeywords=["parts only", "no title"])
        self.assertIsNone(prefilter(make_listing(), item))
        reason = prefilter(
            make_listing(description="selling for parts only"), item)
        self.assertIn("antikeyword", reason)

    def test_exclude_sellers(self):
        item = make_item(exclude_sellers=["KC Auto Group"])
        reason = prefilter(make_listing(seller="kc auto group llc"), item)
        self.assertIn("seller excluded", reason)


class TestPromptConstruction(unittest.TestCase):
    def test_contains_rubric_and_conclusion_instruction(self):
        prompt = build_prompt(make_listing(), make_item())
        self.assertIn("1 - No match", prompt)
        self.assertIn("5 - Great deal", prompt)
        self.assertIn('Rating <1-5>', prompt)
        self.assertIn("Title: 2015 Honda Accord blown engine", prompt)
        self.assertIn("between $200 and $4000", prompt)

    def test_price_variants(self):
        only_max = build_prompt(make_listing(), make_item(min_price=None))
        self.assertIn("no more than $4000", only_max)
        only_min = build_prompt(make_listing(), make_item(max_price=None))
        self.assertIn("at least $200", only_min)

    def test_custom_prompts_override(self):
        item = make_item(prompt="CUSTOM EVAL", extra_prompt="EXTRA NOTES",
                         rating_prompt="CUSTOM CONCLUSION")
        prompt = build_prompt(make_listing(), item)
        self.assertIn("CUSTOM EVAL", prompt)
        self.assertIn("EXTRA NOTES", prompt)
        self.assertIn("CUSTOM CONCLUSION", prompt)
        self.assertNotIn("Evaluate how well this listing", prompt)

    def test_parts_context_included(self):
        prompt = build_prompt(make_listing(), make_item(),
                              parts_context="PARTS DATA HERE")
        self.assertIn("PARTS DATA HERE", prompt)


class TestPartsEnrichment(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(
            "w", suffix=".csv", delete=False)
        self.tmp.write(
            "year,make,model,engine_variant,engine_avg,engine_listings,"
            "trans_variant,trans_avg,trans_listings,combined_avg,confidence\n"
            "2015,Honda,Accord,2.4L,850.0,12,AT,600.0,9,1450.0,Medium\n"
            "2015,Honda,Accord,3.5L,1200.0,5,AT,700.0,15,1900.0,Medium\n")
        self.tmp.close()
        self.data = load_parts_data(self.tmp.name)

    def tearDown(self):
        Path(self.tmp.name).unlink(missing_ok=True)

    def test_cheapest_variant_wins(self):
        row = self.data[(2015, "Honda", "Accord")]
        self.assertEqual(float(row["combined_avg"]), 1450.0)

    def test_match_by_explicit_fields(self):
        listing = make_listing(year=2015, make="Honda", model="Accord")
        self.assertIsNotNone(match_parts_row(listing, self.data))

    def test_match_by_title_scan(self):
        listing = make_listing(title="2015 honda accord blown engine")
        self.assertIsNotNone(match_parts_row(listing, self.data))

    def test_no_match(self):
        listing = make_listing(title="2019 Kia Soul needs motor")
        self.assertIsNone(match_parts_row(listing, self.data))

    def test_missing_csv_is_empty(self):
        self.assertEqual(load_parts_data("/nonexistent/file.csv"), {})


class TestCache(unittest.TestCase):
    def test_roundtrip_and_invalidation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "cache.json"
            cache = DealCache(path)
            item, listing = make_item(), make_listing()
            resp = AIResponse(score=4, comment="good", backend="claude")
            cache.put_ai(item, listing, "model-x", resp)
            cache.save()

            cache2 = DealCache(path)
            hit = cache2.get_ai(item, listing, "model-x")
            self.assertIsNotNone(hit)
            self.assertEqual(hit.score, 4)
            self.assertTrue(hit.cached)

            # different model => miss; changed criteria => miss
            self.assertIsNone(cache2.get_ai(item, listing, "model-y"))
            changed = make_item(max_price=9999)
            self.assertIsNone(cache2.get_ai(changed, listing, "model-x"))

    def test_not_evaluated_is_never_cached(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = DealCache(Path(tmp) / "cache.json")
            item, listing = make_item(), make_listing()
            cache.put_ai(item, listing, "m",
                         AIResponse(score=5, comment=NOT_EVALUATED))
            self.assertIsNone(cache.get_ai(item, listing, "m"))

    def test_notified_tracking(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = DealCache(Path(tmp) / "cache.json")
            item, listing = make_item(), make_listing()
            self.assertFalse(cache.was_notified(item, listing))
            cache.mark_notified(item, listing)
            self.assertTrue(cache.was_notified(item, listing))

    def test_listing_hash_ignores_query_params(self):
        a = make_listing(post_url="https://x.com/l/1?ref=share")
        b = make_listing(post_url="https://x.com/l/1?ref=email")
        self.assertEqual(a.hash, b.hash)


class TestEndToEnd(unittest.TestCase):
    def _finder(self, tmp, config=None):
        config = config or {
            "item": {
                "mechanic_special": {
                    "description": "car needing engine",
                    "min_price": 200,
                    "max_price": 4000,
                    "antikeywords": ["parts only"],
                    "rating": 4,
                }
            }
        }
        return SmartDealFinder(
            config,
            cache_path=Path(tmp) / "cache.json",
            parts_csv=Path(tmp) / "missing.csv",
            backends=[MockBackend()])

    def test_pipeline_statuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            finder = self._finder(tmp)
            listings = [
                make_listing(),                                    # qualifies (mock->4)
                make_listing(title="2014 Camry parts only",
                             post_url="https://x.com/2"),          # prefiltered
                make_listing(title="2018 F-150 runs great",
                             description="nothing wrong",
                             post_url="https://x.com/3"),          # mock->3 < 4
            ]
            results = finder.run(listings)
            statuses = {r["post_url"].split("/")[-1].split("?")[0]: r["status"]
                        for r in results}
            self.assertEqual(statuses["1"], "qualifying")
            self.assertEqual(statuses["2"], "excluded_prefilter")
            self.assertEqual(statuses["3"], "below_threshold")

            qualifying = [r for r in results if r["status"] == "qualifying"][0]
            self.assertIn("DRAFT", qualifying["slack_draft"])
            self.assertIn("carhunter-evaluator", qualifying["slack_draft"])

    def test_notified_dedup_across_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            finder = self._finder(tmp)
            first = finder.run([make_listing()])
            self.assertEqual(first[0]["status"], "qualifying")
            finder2 = self._finder(tmp)
            second = finder2.run([make_listing()])
            self.assertEqual(second, [])  # already notified -> skipped
            third = finder2.run([make_listing()], renotify=True)
            self.assertEqual(third[0]["status"], "qualifying")

    def test_min_rating_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            finder = self._finder(tmp)
            results = finder.run([make_listing(
                title="2018 F-150 runs great", description="nothing wrong",
                post_url="https://x.com/3")], min_rating=3)
            self.assertEqual(results[0]["status"], "qualifying")

    def test_fail_open_when_no_backends(self):
        with tempfile.TemporaryDirectory() as tmp:
            finder = SmartDealFinder(
                {"item": {"x": {"description": "anything", "rating": 3}}},
                cache_path=Path(tmp) / "cache.json",
                parts_csv=Path(tmp) / "missing.csv",
                backends=[])
            results = finder.run([make_listing()])
            self.assertEqual(results[0]["status"], "qualifying")
            self.assertTrue(results[0]["ai"]["not_evaluated"])
            self.assertEqual(results[0]["ai"]["score"], 5)
            self.assertIn("NOT AI-EVALUATED", results[0]["slack_draft"])

    def test_results_are_json_serializable(self):
        with tempfile.TemporaryDirectory() as tmp:
            finder = self._finder(tmp)
            json.dumps(finder.run([make_listing()]))


class TestSlackDraft(unittest.TestCase):
    def test_draft_never_reads_as_sent(self):
        draft = render_slack_draft(
            make_listing(), make_item(),
            AIResponse(score=5, comment="excellent margin", backend="claude"))
        self.assertIn("DRAFT", draft)
        self.assertIn("Great deal (5/5)", draft)
        self.assertIn("Level 2", draft)


if __name__ == "__main__":
    unittest.main(verbosity=2)

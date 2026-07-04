"""Unit tests for carpart_scraper's pure logic (no network, no browser).

Run with:  python3 -m unittest discover -s tests -v
"""

import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import carpart_scraper as cs


SAMPLE_RESULTS_TEXT = """
2015 Honda Civic
Engine 1.8L VIN R
84,000 A ST12345 $850 ABC Auto Parts
120,500 A ST22222 $600 Cheap Yard
55,321 B ST33333 $700 Grade B Yard
40,000 A ST44444 $1,200 Good Yard
Shipping: $45
Core charge $30,000
"""


class TestExtractFilteredPrices(unittest.TestCase):
    def test_grade_a_under_100k_only(self):
        prices = cs.extract_filtered_prices(SAMPLE_RESULTS_TEXT)
        # 850 (A, 84k) and 1200 (A, 40k) qualify;
        # 600 is A but 120k miles; 700 is grade B.
        self.assertEqual(sorted(prices), [850.0, 1200.0])

    def test_price_bounds(self):
        text = "10,000 A ST1 $49 x\n10,000 A ST2 $26,000 y\n10,000 A ST3 $50 z"
        self.assertEqual(cs.extract_filtered_prices(text), [50.0])

    def test_empty_text(self):
        self.assertEqual(cs.extract_filtered_prices(""), [])


class TestExtractAllPrices(unittest.TestCase):
    def test_bounds_applied(self):
        text = "$49 $50 $25,000 $25,001 $1,234.56"
        self.assertEqual(cs.extract_all_prices(text), [50.0, 25000.0, 1234.56])


class TestExtractPricesFromText(unittest.TestCase):
    def test_primary_path_note(self):
        prices, note = cs.extract_prices_from_text(SAMPLE_RESULTS_TEXT)
        self.assertEqual(note, "Grade-A <100k")
        self.assertEqual(sorted(prices), [850.0, 1200.0])

    def test_fallback_is_labeled_honestly(self):
        # No grade/miles structure — only bare prices → fallback path
        prices, note = cs.extract_prices_from_text("special deal $500 and $900")
        self.assertEqual(note, "unfiltered fallback")
        self.assertEqual(sorted(prices), [500.0, 900.0])

    def test_no_prices(self):
        prices, note = cs.extract_prices_from_text("nothing to see here")
        self.assertEqual(prices, [])
        self.assertEqual(note, "no results")


class TestCalcStats(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(cs.calc_stats([]), (None, None, None, None, 0))

    def test_single(self):
        self.assertEqual(cs.calc_stats([100]), (100.0, 100.0, 100.0, 100.0, 1))

    def test_two(self):
        mean, med, mn, mx, n = cs.calc_stats([100, 200])
        self.assertEqual((mean, med, mn, mx, n), (150.0, 150.0, 100.0, 200.0, 2))

    def test_outlier_dropped(self):
        prices = [100.0] * 10 + [10000.0]
        mean, med, mn, mx, n = cs.calc_stats(prices)
        self.assertEqual(n, 10)          # the 10000 outlier is filtered out
        self.assertEqual(mean, 100.0)
        self.assertEqual(mx, 100.0)

    def test_no_variance(self):
        mean, med, mn, mx, n = cs.calc_stats([500, 500, 500])
        self.assertEqual((mean, n), (500.0, 3))


class TestProgressKey(unittest.TestCase):
    def test_format(self):
        self.assertEqual(cs.make_key("Honda", "Civic", 2015, "Engine"),
                         "Honda|Civic|2015|Engine")


class CsvFixtureMixin:
    """Point the module's file constants at a temp dir for the test."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        self._saved = (cs.RAW_CSV, cs.FILTERED_CSV, cs.PROGRESS_FILE)
        cs.RAW_CSV = tmp / "raw.csv"
        cs.FILTERED_CSV = tmp / "filtered.csv"
        cs.PROGRESS_FILE = tmp / "progress.txt"

    def tearDown(self):
        cs.RAW_CSV, cs.FILTERED_CSV, cs.PROGRESS_FILE = self._saved
        self._tmp.cleanup()

    def add_raw_row(self, year, make, model, part, variant, prices):
        cs.init_raw_csv()
        avg, med, mn, mx, count = cs.calc_stats(prices)
        cs.write_raw_row({
            "year": year, "make": make, "model": model, "part": part,
            "variant": variant, "num_listings": count,
            "prices": json.dumps(prices),
            "avg_price": avg or "", "median_price": med or "",
            "min_price": mn or "", "max_price": mx or "",
            "filter_note": "test", "timestamp": "2026-01-01T00:00:00",
        })


class TestRawCsvRoundTrip(CsvFixtureMixin, unittest.TestCase):
    def test_round_trip(self):
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "1.8L", [800, 900, 1000])
        raw = cs.load_raw_results()
        entry = raw[(2015, "Honda", "Civic")]["Engine"][0]
        self.assertEqual(entry["variant"], "1.8L")
        self.assertEqual(entry["prices"], [800, 900, 1000])

    def test_rescrape_dedupes_keeping_latest(self):
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "1.8L", [800])
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "1.8L", [900, 950, 975])
        raw = cs.load_raw_results()
        variants = raw[(2015, "Honda", "Civic")]["Engine"]
        self.assertEqual(len(variants), 1)           # not double-counted
        self.assertEqual(variants[0]["prices"], [900, 950, 975])  # latest wins

    def test_progress_save_load(self):
        cs.save_progress("Honda|Civic|2015|Engine")
        cs.save_progress("Honda|Civic|2015|Transmission")
        self.assertEqual(cs.load_progress(),
                         {"Honda|Civic|2015|Engine", "Honda|Civic|2015|Transmission"})


class TestGenerateFilteredCsv(CsvFixtureMixin, unittest.TestCase):
    def test_qualifying_pair_included(self):
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "1.8L",
                         [1000.0] * 25)
        self.add_raw_row(2015, "Honda", "Civic", "Transmission", "CVT",
                         [400.0] * 25)
        rows = cs.generate_filtered_csv()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["combined_avg"], 1400.0)
        self.assertEqual(rows[0]["confidence"], "High")

    def test_over_1500_excluded(self):
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "big", [2000.0] * 25)
        self.add_raw_row(2015, "Honda", "Civic", "Transmission", "CVT", [400.0] * 25)
        self.assertEqual(cs.generate_filtered_csv(), [])

    def test_low_confidence_excluded(self):
        # 3 + 3 listings = Low confidence → dropped
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "1.8L", [1000.0] * 3)
        self.add_raw_row(2015, "Honda", "Civic", "Transmission", "CVT", [400.0] * 3)
        self.assertEqual(cs.generate_filtered_csv(), [])

    def test_csv_file_written_sorted(self):
        self.add_raw_row(2015, "Honda", "Civic", "Engine", "e1", [1000.0] * 25)
        self.add_raw_row(2015, "Honda", "Civic", "Transmission", "t1", [400.0] * 25)
        self.add_raw_row(2016, "Kia", "Soul", "Engine", "e2", [500.0] * 25)
        self.add_raw_row(2016, "Kia", "Soul", "Transmission", "t2", [300.0] * 25)
        cs.generate_filtered_csv()
        with open(cs.FILTERED_CSV) as f:
            rows = list(csv.DictReader(f))
        self.assertEqual([r["combined_avg"] for r in rows], ["800.0", "1400.0"])


class TestCountQualifying(unittest.TestCase):
    def test_counts_only_full_pairs(self):
        raw = {
            (2015, "Honda", "Civic"): {
                "Engine": [{"variant": "e", "prices": [1000.0] * 5, "num_listings": 5}],
                "Transmission": [{"variant": "t", "prices": [400.0] * 5, "num_listings": 5}],
            },
            (2016, "Kia", "Soul"): {  # engine too expensive
                "Engine": [{"variant": "e", "prices": [2000.0] * 5, "num_listings": 5}],
                "Transmission": [{"variant": "t", "prices": [400.0] * 5, "num_listings": 5}],
            },
            (2017, "Ford", "Focus"): {  # missing transmission data
                "Engine": [{"variant": "e", "prices": [900.0] * 5, "num_listings": 5}],
            },
        }
        self.assertEqual(cs.count_qualifying(raw), 1)


class TestWriteTaskRows(CsvFixtureMixin, unittest.TestCase):
    def test_error_row_distinct_from_no_results(self):
        cs.init_raw_csv()
        cs.write_task_rows(2015, "Honda", "Civic", "Engine", {},
                           "error - all retries failed (see error log)")
        cs.write_task_rows(2015, "Honda", "Civic", "Transmission", {}, None)
        with open(cs.RAW_CSV) as f:
            rows = list(csv.DictReader(f))
        self.assertEqual(rows[0]["filter_note"], "error - all retries failed (see error log)")
        self.assertEqual(rows[1]["filter_note"], "no results")

    def test_variant_rows_carry_their_note(self):
        cs.init_raw_csv()
        details = {
            "1.8L": {"prices": [800.0, 900.0, 950.0], "note": "Grade-A <100k"},
            "2.0L": {"prices": [700.0], "note": "unfiltered fallback"},
        }
        entries = cs.write_task_rows(2015, "Honda", "Civic", "Engine", details, None)
        self.assertEqual(len(entries), 2)
        with open(cs.RAW_CSV) as f:
            rows = {r["variant"]: r for r in csv.DictReader(f)}
        self.assertEqual(rows["1.8L"]["filter_note"], "Grade-A <100k")
        self.assertEqual(rows["2.0L"]["filter_note"], "unfiltered fallback")


class TestParseArgs(unittest.TestCase):
    def test_defaults(self):
        args = cs.parse_args([])
        self.assertEqual(args.limit, 0)
        self.assertFalse(args.regen_only)
        self.assertFalse(args.headful)

    def test_flags(self):
        args = cs.parse_args(["--limit", "5", "--regen-only", "--headful"])
        self.assertEqual(args.limit, 5)
        self.assertTrue(args.regen_only)
        self.assertTrue(args.headful)


if __name__ == "__main__":
    unittest.main()

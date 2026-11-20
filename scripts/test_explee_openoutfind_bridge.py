from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("explee_bridge", HERE / "explee_openoutfind_bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_prepare_real_campaign_shape(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            result = bridge.prepare(HERE / "fixtures" / "openoutfind-explee-input.json", target, 0)
            product = (target / "product.md").read_text()
            campaign = (target / "target.md").read_text()
            self.assertEqual(result["campaign_name"], "Independent Consulting Practices")
            self.assertIn("Calendly", product)
            self.assertIn("consulting firm", campaign)
            self.assertIn("not verified buyers", campaign.lower())
            rules = (target / "rules.md").read_text()
            self.assertIn("conservative", rules)
            self.assertIn("Count as fit only", rules)
            self.assertIn("When in doubt, choose no-fit", rules)

    def test_no_silent_missing_campaign_or_made_up_profile(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            with self.assertRaises(ValueError):
                bridge.prepare(HERE / "fixtures" / "openoutfind-explee-input.json", target, 6)
            (target / "empty.json").write_text('{"company": {}, "campaigns": [{"name":"Buyer"}]}')
            with self.assertRaises(ValueError):
                bridge.prepare(target / "empty.json", target, 0)

    def test_normalize_marks_all_prospects_unverified_and_deduplicates(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp)
            bridge.prepare(HERE / "fixtures" / "openoutfind-explee-input.json", target, 0)
            lead_fixture = (HERE / "fixtures" / "openoutfind-leads.jsonl").read_text()
            leads = target / "input.jsonl"
            leads.write_text(lead_fixture + lead_fixture + "{invalid json}\n")
            summary = bridge.normalize(leads, target / "campaign.json", target)
            self.assertEqual(summary["returned_leads"], 1)
            self.assertEqual(summary["invalid_rows"], 1)
            self.assertEqual(summary["independently_verified_people"], 0)
            self.assertEqual(summary["email_purchases"], 0)
            data = json.loads((target / "openoutfind-leads.json").read_text())
            self.assertEqual(data["leads"][0]["email"], None)
            self.assertEqual(data["leads"][0]["checks"]["company_employment"], "not_independently_verified")
            self.assertEqual(data["leads"][0]["checks"]["campaign_fit"], "llm_assessed_not_verified")
            public = json.loads((target / "openoutfind-summary.json").read_text())
            self.assertNotIn("Avery", json.dumps(public))
            self.assertNotIn("LinkedIn", json.dumps(public))

    def test_bad_urls_not_promoted_to_evidence(self):
        self.assertIsNone(bridge.public_url("javascript:alert(1)"))
        self.assertIsNone(bridge.public_url("https://user:pass@company.com"))
        self.assertEqual(bridge.public_url("company.com"), "https://company.com")


if __name__ == "__main__":
    unittest.main()

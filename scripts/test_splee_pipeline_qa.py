"""Offline tests for the Splee API -> Explee quality benchmark.

All names and profiles in fixtures are synthetic. No network calls.
"""
from __future__ import annotations
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from urllib.error import HTTPError
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("splee_qa", ROOT / "splee_pipeline_qa.py")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)
SAMPLE = json.loads((ROOT / "fixtures" / "splee-qa-synthetic.json").read_text(encoding="utf-8"))


class SpleeQAContractTests(unittest.TestCase):
    def snapshot(self):
        return copy.deepcopy(SAMPLE)

    def test_sample_is_honest_read_only_benchmark(self):
        output = qa.evaluate(self.snapshot(), "calendly.com")
        self.assertEqual(output["schema_version"], "explee.splee.qa.v1")
        self.assertFalse(output["quality_verified"])
        self.assertFalse(output["sending_performed"])
        self.assertEqual(output["stages"]["campaigns"]["inspected"], 1)
        self.assertEqual(output["stages"]["buyer_companies"]["inspected"], 1)
        self.assertEqual(output["stages"]["decision_makers"]["inspected"], 1)
        self.assertEqual(output["stages"]["email_drafts"]["inspected"], 1)
        self.assertEqual(output["stages"]["competitor_research"]["state"], "not_exposed_by_api_v1")

    def test_personal_data_never_written_to_aggregates(self):
        source = self.snapshot()
        source["leads"]["items"][0]["lead"]["full_name"] = "SYNTHETIC SECRET PERSON"
        source["emails"]["items"][0]["body"] = "PRIVATE BODY VALUE"
        report = json.dumps(qa.evaluate(source))
        self.assertNotIn("SYNTHETIC SECRET PERSON", report)
        self.assertNotIn("PRIVATE BODY VALUE", report)
        self.assertNotIn("example-consultants.test", report)

    def test_buyer_company_filters_self_matches_and_bad_sources(self):
        source = self.snapshot()
        source["companies"]["items"] += [
            {"company": {"name": "Own product", "domain": "calendly.com", "source_url": "https://calendly.com"}},
            {"company": {"name": "Directory article", "domain": "example-consultants.test", "source_url": "https://example.com/blog/post"}},
            {"company": {"name": "Bad source", "domain": "missing.example", "source_url": "javascript:alert(1)"}},
        ]
        flags = qa.evaluate(source)["stages"]["buyer_companies"]["flags"]
        self.assertEqual(flags["self_match"], 1)
        self.assertEqual(flags["duplicate_domain"], 1)
        self.assertEqual(flags["unrelated_page_url"], 1)
        self.assertEqual(flags["missing_evidence_url"], 1)

    def test_lead_missing_employer_and_title_not_marked_verified(self):
        source = self.snapshot()
        lead = source["leads"]["items"][0]["lead"]
        lead["title"] = ""
        lead["company_domain"] = ""
        lead["company_name"] = ""
        lead["linkedin_url"] = ""
        report = qa.evaluate(source)
        flags = report["stages"]["decision_makers"]["flags"]
        self.assertEqual(flags["missing_role"], 1)
        self.assertEqual(flags["missing_employer"], 1)
        self.assertEqual(flags["missing_source"], 1)
        self.assertEqual(report["stages"]["decision_makers"]["state"], "review_unverified")

    def test_unfilled_email_templates_not_published_as_quality(self):
        source = self.snapshot()
        source["emails"]["items"][0]["body"] = "Hi {{first_name}}; TBD"
        flags = qa.evaluate(source)["stages"]["email_drafts"]["flags"]
        self.assertEqual(flags["unfilled_template"], 1)

    def test_wrong_project_emails_flagged_not_echoed(self):
        source = self.snapshot()
        source["emails"]["items"][0]["project_id"] = "00000000-0000-4000-8000-000000000000"
        flags = qa.evaluate(source)["stages"]["email_drafts"]["flags"]
        self.assertEqual(flags["not_in_project"], 1)

    def test_normalization_rejects_bad_shapes(self):
        source = self.snapshot()
        source["leads"] = {"not_items": []}
        with self.assertRaisesRegex(ValueError, "invalid_list_shape"):
            qa.evaluate(source)
        source = self.snapshot()
        source["research"] = {"questions": "invalid"}
        with self.assertRaisesRegex(ValueError, "invalid_research_grid"):
            qa.evaluate(source)

    def test_no_phantom_stages_for_empty_project(self):
        source = self.snapshot()
        source["campaigns"] = []
        source["companies"] = {"items": [], "total": 0}
        source["leads"] = {"items": [], "total": 0}
        source["emails"] = {"items": [], "total": 0}
        result = qa.evaluate(source)
        self.assertEqual(result["stages"]["decision_makers"]["state"], "missing")
        self.assertEqual(result["stages"]["email_drafts"]["state"], "missing")
        self.assertIn("campaigns.missing_fields", result["issues"])

    def test_explee_comparison_does_not_claim_fit(self):
        result = qa.evaluate(self.snapshot(), explee={
            "website": "https://calendly.com", "campaigns": [{}, {}]})
        comp = result["comparison"]
        self.assertTrue(comp["company_domain_matches"])
        self.assertEqual(comp["explee_campaigns"], 2)
        self.assertEqual(comp["splee_campaigns"], 1)
        self.assertFalse(result["quality_verified"])

    def test_https_required_no_secrets_in_url(self):
        for url in ("http://splee.example", "https://user:pass@splee.example",
                    "https://splee.example?token=secret", "https://127.0.0.1"):
            with self.assertRaisesRegex(ValueError, "invalid_splee_base_url"):
                qa.valid_base_url(url)
        self.assertEqual(qa.valid_base_url("https://splee.example"), "https://splee.example")

    def test_redirects_are_refused_not_forwarded_with_bearer(self):
        self.assertIsNone(qa.NoRedirects().redirect_request(None, None, 302, "Moved", {}, "https://attacker.example"))

    def test_untrusted_http_error_body_not_logged(self):
        class Failure:
            def open(self, request, timeout):
                raise HTTPError(request.full_url, 403, "PERSONAL SECRET BODY", {}, None)
        with self.assertRaisesRegex(ValueError, "^splee_http_403$"):
            qa.get_json(Failure(), "https://splee.example", "my_fake_token", "/api/v1/projects")

    def test_pagination_reads_all_pages_and_warns_if_truncated(self):
        records = [{"company": {"name": "Synthetic", "domain": f"sample{i}.example", "source_url": "https://sample.example"}} for i in range(101)]
        class Response:
            status = 200
            def __init__(self, payload): self.payload = payload
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def read(self, n): return json.dumps(self.payload).encode()
        class Opener:
            def open(self, request, timeout):
                from urllib.parse import parse_qs, urlsplit
                q = parse_qs(urlsplit(request.full_url).query)
                page = int(q["page"][0])
                return Response({"items": records[(page - 1) * 100:page * 100], "total": 101})
        result = qa.paginated(Opener(), "https://splee.example", "secret", "/api/v1/projects/x/companies")
        self.assertEqual(len(result["items"]), 101)
        self.assertFalse(result["truncated"])

        sample = self.snapshot()
        sample["companies"] = {**result, "truncated": True}
        report = qa.evaluate(sample)
        self.assertIn("not_all_records_scanned", report["stages"]["buyer_companies"]["flags"])

    def test_mock_read_only_endpoints(self):
        class Response:
            status = 200
            def __init__(self, data):
                self.data = data
            def __enter__(self):
                return self
            def __exit__(self, *args):
                return False
            def read(self, n):
                return json.dumps(self.data).encode()
        seen = []
        source = self.snapshot()
        project_id = source["project"]["id"]
        paths = {
            "/api/v1/projects": [source["project"]],
            f"/api/v1/projects/{project_id}/campaigns": source["campaigns"],
            f"/api/v1/projects/{project_id}/companies?page=1&per_page=100": source["companies"],
            f"/api/v1/projects/{project_id}/leads?page=1&per_page=100": source["leads"],
            f"/api/v1/projects/{project_id}/research?page=1&per_page=100": source["research"],
            f"/api/v1/emails?project_id={project_id}&status=draft&page=1&per_page=100": source["emails"],
        }
        class Opener:
            def open(self, req, timeout):
                seen.append((req.get_method(), req.full_url, req.get_header("Authorization")))
                return Response(paths[req.full_url.removeprefix("https://splee.example")])
        with patch.object(qa, "build_opener", return_value=Opener()):
            result = qa.live_snapshot("https://splee.example", "test_token", project_id)
        self.assertEqual(result["mode"], "live_read_only")
        self.assertEqual(len(seen), 6)
        self.assertTrue(all(method == "GET" for method, _, _ in seen))
        self.assertTrue(all(header == "Bearer test_token" for _, _, header in seen))
        self.assertEqual(result["research"], source["research"])


if __name__ == "__main__":
    unittest.main()

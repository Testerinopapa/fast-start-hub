"""Offline tests for on-demand Splee GitHub Actions, no network or paid AI."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch
import unittest

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("splee_actions_runner", BASE / "splee_actions_run.py")
qa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qa)


class EphemeralRunnerTests(unittest.TestCase):
    def test_smoke_only_reads_health_and_creates_local_qa_account(self):
        calls = []
        def fake(opener, method, path, payload=None, token=None):
            calls.append((method, path))
            if path == "/api/health":
                return {"ok": True}
            if path == "/api/auth/signup":
                self.assertNotIn("smtp", str(payload).lower())
                return {"ok": True}
            if path == "/api/organization/api-keys":
                return {"secret": "synthetic_key"}
            if path == "/api/v1/projects":
                self.assertEqual(token, "synthetic_key")
                return []
            self.fail("Unexpected path " + path)
        with patch.object(qa, "request_json", side_effect=fake):
            result = qa.run("smoke", "calendly.com", 20)
        self.assertEqual(result["status"], "healthy")
        self.assertFalse(result["ai_calls_attempted"])
        self.assertFalse(result["sending_performed"])
        self.assertEqual([p for m,p in calls if m == "POST"],
                         ["/api/auth/signup", "/api/organization/api-keys"])
        self.assertNotIn("/api/projects", [p for _, p in calls])

    def test_research_uses_real_enqueue_route_and_sanitizes_results(self):
        calls = []
        pid = "11111111-1111-4111-8111-111111111111"
        def fake(opener, method, path, payload=None, token=None):
            calls.append((method, path))
            if path == "/api/health": return {"ok": True}
            if path == "/api/auth/signup": return {}
            if path == "/api/organization/api-keys": return {"secret":"ephemeral"}
            if path == "/api/v1/projects": return []
            if path == "/api/projects":
                self.assertEqual(payload["domain"], "calendly.com")
                return {"id":pid}
            self.fail("Unexpected route " + path)
        snapshot = {"leads":[{"full_name":"PRIVATE SYNTHETIC PERSON",
                               "email":"private@example.com"}]}
        metrics = {"stages": {
            "company_research":{"state":"review","inspected":1,"flags":{}},
            "decision_makers":{"state":"review_unverified","inspected":1,"flags":{}},
        }, "issues":["decision_makers.quality_flags"]}
        with patch.object(qa, "request_json", side_effect=fake), \
             patch.object(qa, "wait_for_run", return_value=("succeeded", 6)), \
             patch.object(qa, "live_snapshot", return_value=snapshot), \
             patch.object(qa, "evaluate", return_value=metrics):
            result = qa.run("research","calendly.com",20)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["last_step"], 6)
        self.assertIn(("POST","/api/projects"),calls)
        self.assertNotIn("PRIVATE SYNTHETIC PERSON",json.dumps(result))
        self.assertNotIn("private@example.com",json.dumps(result))
        self.assertFalse(result["sending_performed"])
        self.assertFalse(result["output_quality_verified"])

    def test_invalid_domain_is_rejected(self):
        with patch.object(qa, "request_json", return_value={"ok":True}), \
             patch.object(qa, "bootstrap", return_value="key"):
            with self.assertRaisesRegex(qa.SafeFailure, "invalid_research_domain"):
                qa.run("research","https://calendly.com/?token=secret",20)

    def test_typed_http_failure_hides_response_contents(self):
        class Fails:
            def open(self, req, timeout):
                raise HTTPError(req.full_url, 401, "SECRET EXTERNAL BODY", {}, None)
        with self.assertRaisesRegex(qa.SafeFailure, "^local_api_http_401$"):
            qa.request_json(Fails(),"GET","/api/health")

    def test_wait_for_run_does_not_claim_queued_as_pass(self):
        def request(opener, method, path, payload=None, token=None):
            self.assertIn("/runs",path)
            return [{"kind":"explore","status":"queued","step":0}]
        with patch.object(qa, "request_json", side_effect=request):
            state,step = qa.wait_for_run(None,"some-id",0)
        self.assertEqual(state,"timed_out")
        self.assertEqual(step,0)

    def test_research_failed_is_aggregate_only(self):
        with patch.object(qa, "request_json",side_effect=[
            {"ok":True}, {}, {"secret":"key"}, [], {"id":"11111111-1111-4111-8111-111111111111"}
        ]), patch.object(qa,"wait_for_run",return_value=("failed",2)), \
             patch.object(qa,"safe_agent_diagnostic",return_value="ai_request_rejected"), \
             patch.object(qa,"live_snapshot",side_effect=ValueError("private source content")):
            result=qa.run("research","calendly.com",20)
        self.assertEqual(result["status"],"failed")
        self.assertEqual(result["agent_error_category"],"ai_request_rejected")
        self.assertEqual(result["diagnostic"],"read_only_quality_snapshot_unavailable")
        self.assertNotIn("private source content",json.dumps(result))

    def test_agent_error_is_classified_without_copying_raw_provider_text(self):
        self.assertEqual(
            qa.classify_agent_error("429 private credential = SECRET"),
            "ai_rate_or_budget_limit",
        )
        self.assertEqual(
            qa.classify_agent_error("WebFetch unsupported: private URL"),
            "web_tool_protocol_incompatibility",
        )
        self.assertEqual(qa.classify_agent_error(""), "agent_error_not_reported")

    def test_workflow_keeps_sending_off_and_research_manual(self):
        workflow = (BASE.parent / ".github/workflows/splee-actions-ephemeral.yml").read_text()
        self.assertIn("SENDING_ENABLED: 'false'",workflow)
        self.assertIn("PUBLIC_AGENT: 'false'",workflow)
        self.assertIn("OPEN_SIGNUP: 'false'",workflow)
        self.assertIn("type: choice",workflow)
        self.assertIn("options: ['smoke', 'research']",workflow)
        self.assertIn("postgres:17",workflow)
        self.assertIn("OPENOUTFIND_LLM_API_KEY",workflow)
        self.assertNotIn("smtp.gmail.com",workflow)

    def test_gateway_enforces_existing_run_admission_header(self):
        config = (BASE.parent / "deploy/splee/actions/litellm.yaml").read_text()
        self.assertIn("x-explee-run-id: os.environ/EXPLEE_AI_RUN_ID",config)
        self.assertIn("os.environ/OPENOUTFIND_LLM_API_KEY",config)
        self.assertIn("os.environ/OPENOUTFIND_AI_API_BASE",config)
        self.assertIn("max_retries: 0",config)


if __name__ == "__main__":
    unittest.main()

"""Offline contract tests for Explee's QA budget, phase metrics, and partial outcomes."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def module(name, file):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


runner = module("qa_runner", "run_openoutfind.py")
reporter = module("qa_reporter", "explee_qa_report.py")


class FakeConnectError(Exception):
    def __init__(self, message, request=None):
        self.request = request
        super().__init__(message)


class BudgetTests(unittest.TestCase):
    def test_http_cap_blocks_before_ever_sending_extra_request(self):
        budget = runner.QABudget(3)
        fake_httpx = types.SimpleNamespace(ConnectError=FakeConnectError)
        with patch.dict(sys.modules, {"httpx": fake_httpx}):
            budget.phase = "lead_qualification"
            for i in range(3):
                asyncio.run(budget.before_request(object()))
            with self.assertRaisesRegex(FakeConnectError, "EXPLEE_LOCAL_AI_REQUEST_CAP"):
                asyncio.run(budget.before_request(object()))
        metric = budget.summary()
        self.assertEqual(metric["ai_requests_sent"], 3)
        self.assertTrue(metric["local_ai_cap_hit"])
        self.assertEqual(metric["requests_blocked_locally"], 1)
        self.assertEqual(metric["requests_by_phase"], {"lead_qualification": 3})

    def test_invalid_cap_rejected(self):
        for maximum in (-1, 0, 25, 1000):
            with self.assertRaises(ValueError):
                runner.QABudget(maximum)

    def test_phase_count_is_restored_after_success_or_error(self):
        budget = runner.QABudget(4)
        self.assertEqual(budget.run_agent(lambda arg: "ok", None, "brief"), "ok")
        self.assertEqual(budget.phase, "other")
        def broken(arg):
            raise RuntimeError("model failed")
        with self.assertRaises(RuntimeError):
            budget.run_agent(broken, None, "lead_qualification")
        self.assertEqual(budget.phase, "other")

    def test_model_parameter_validation_needs_no_http(self):
        # Do not construct any external SDK objects in an offline CI test.
        budget = runner.QABudget(2)
        self.assertEqual(budget.maximum, 2)
        self.assertEqual(budget.summary()["ai_requests_sent"], 0)


class QAReportTests(unittest.TestCase):
    AGG = {
        "schema_version": "explee.openoutfind.summary.v1",
        "returned_leads": 2,
        "complete_profiles": 1,
    }
    METRICS = {
        "schema_version": "explee.openoutfind.qa-metrics.v1",
        "max_ai_requests": 12,
        "ai_requests_sent": 12,
        "requests_blocked_locally": 1,
        "local_ai_cap_hit": True,
        "requests_by_phase": {"lead_qualification": 10, "initial_searches_and_anchors": 2},
    }

    def test_partial_local_cap_is_not_reported_as_success(self):
        result = reporter.summarize(self.AGG, self.METRICS, "", 1, 3)
        self.assertEqual(result["result"], "partial")
        self.assertEqual(result["reason"], "local_ai_budget")
        self.assertEqual(result["ai_requests_per_returned_lead"], 6)
        self.assertEqual(result["independently_verified_people"], 0)

    def test_upstream_typed_refusal_without_revealing_message(self):
        private = "Privately Named Person at Actual Corp"
        stderr = json.dumps({"error":{"type":"provider_rate_limited","message":private}})
        metrics = {"schema_version": "explee.openoutfind.qa-metrics.v1",
                   "max_ai_requests": 12, "ai_requests_sent": 2,
                   "requests_by_phase":{"brief":2}}
        result = reporter.summarize(
            {**self.AGG, "returned_leads": 0, "complete_profiles": 0},
            metrics, stderr, 1, 3)
        self.assertEqual(result["result"], "no_leads")
        self.assertEqual(result["reason"], "provider_rate_limited")
        self.assertNotIn(private, json.dumps(result))

    def test_success_requires_exit_zero_and_goal_count(self):
        metrics = {"max_ai_requests": 12, "ai_requests_sent": 3,
                   "requests_by_phase": {"lead_qualification": 3}}
        self.assertEqual(reporter.summarize(
            {**self.AGG, "returned_leads": 3, "complete_profiles": 2},
            metrics, "", 0, 3)["result"], "goal_met")
        self.assertEqual(reporter.summarize(self.AGG, metrics, "", 0, 3)["result"], "partial")

    def test_phase_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            reporter.summarize(self.AGG, {**self.METRICS, "ai_requests_sent": 8}, "", 1, 3)

    def test_schema_and_goal_are_validated(self):
        with self.assertRaises(ValueError):
            reporter.summarize({}, {}, "", 1, 3)
        with self.assertRaises(ValueError):
            reporter.summarize(self.AGG, {}, "", 1, 6)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path
from urllib.error import HTTPError

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("lovable_proxy_check", HERE / "check_lovable_proxy.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
BASE = "https://example.supabase.co/functions/v1/openoutfind-ai/v1"


class Response:
    status = 200
    def __init__(self, data):
        self.data = data
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self, size=-1):
        return json.dumps(self.data).encode("utf-8")


class ProxyCheckTests(unittest.TestCase):
    def test_no_inference_made_only_get_models(self):
        calls = []
        def fetch(request, timeout):
            calls.append((request.get_method(), request.full_url, timeout))
            self.assertEqual(request.headers["Authorization"], "Bearer private-test-token")
            return Response({"object": "list", "data": [{"id": "openai/gpt-6-luna"}]})
        msg = module.check(BASE, "private-test-token", fetch)
        self.assertIn("PASS", msg)
        self.assertEqual(calls, [("GET", BASE + "/models", 12)])

    def test_missing_secret_exits_before_http(self):
        with self.assertRaisesRegex(RuntimeError, "OPENOUTFIND_LLM_API_KEY"):
            module.check(BASE, "", lambda *_a, **_k: self.fail("should not fetch"))

    def test_redirect_and_insecure_url_rejected(self):
        for url in [
            "http://example.supabase.co/functions/v1/openoutfind-ai/v1",
            "https://user:pass@example.supabase.co/functions/v1/openoutfind-ai/v1",
            "https://example.supabase.co/functions/v1/openoutfind-ai/v1?token=secret",
            "https://example.supabase.co/functions/v1/not-the-proxy/v1",
        ]:
            with self.assertRaises(ValueError, msg=url):
                module.validated_url(url)

    def test_auth_failure_does_not_reveal_provider_body(self):
        def fetch(req, timeout):
            raise HTTPError(req.full_url, 401, "private_provider_detail", None, None)
        with self.assertRaisesRegex(RuntimeError, "does not match") as context:
            module.check(BASE, "secret-not-printed", fetch)
        self.assertNotIn("secret-not-printed", str(context.exception))
        self.assertNotIn("private_provider_detail", str(context.exception))

    def test_wrong_model_fails_safely(self):
        with self.assertRaisesRegex(RuntimeError, "did not advertise"):
            module.check(BASE, "test", lambda req, timeout: Response({"data": [{"id": "wrong-model"}]}))


if __name__ == "__main__":
    unittest.main()

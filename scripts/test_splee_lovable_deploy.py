"""Offline safety and wiring checks for the Splee -> Lovable AI deployment proposal.

No Splee Rust builds, AI requests, mail sends, Render provisioning or keys.
"""
import os
from pathlib import Path
import unittest

try:
    import yaml
except ImportError:
    raise SystemExit("Install PyYAML for deployment configuration tests")

ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deploy" / "splee"
BLUEPRINT = yaml.safe_load((DEPLOY / "render.yaml").read_text())
GATEWAY = yaml.safe_load((DEPLOY / "gateway" / "config.yaml").read_text())


class SpleeDeploymentTests(unittest.TestCase):
    def services(self):
        return {item["name"]: item for item in BLUEPRINT["services"]}

    def env(self, service_name):
        return {row["key"]: row for row in self.services()[service_name]["envVars"]}

    def test_separate_backend_and_private_gateway(self):
        services = self.services()
        self.assertEqual(set(services), {"explee-splee-backend", "explee-splee-ai-gateway"})
        self.assertEqual(services["explee-splee-backend"]["type"], "web")
        self.assertEqual(services["explee-splee-ai-gateway"]["type"], "pserv")
        self.assertEqual(services["explee-splee-backend"]["runtime"], "docker")

    def test_real_splee_backend_not_lovable_cloud_rust(self):
        source = (DEPLOY / "backend" / "Dockerfile").read_text()
        self.assertIn("https://github.com/Iweisc/splee.git", source)
        self.assertIn("3c2b1723bc9651a2cd2872ae6a3b4939501c8435", source)
        self.assertIn("cargo build --locked --release -p splee", source)
        self.assertIn("@anthropic-ai/claude-code@2.1.329", source)

    def test_qa_mode_cannot_send_mail_or_use_public_agent(self):
        env = self.env("explee-splee-backend")
        for key in ("SENDING_ENABLED", "PUBLIC_AGENT", "OPEN_SIGNUP"):
            self.assertEqual(env[key]["value"], "false")
        startup = (DEPLOY / "backend" / "start.sh").read_text()
        self.assertIn('SENDING_ENABLED', startup)
        self.assertIn('PUBLIC_AGENT', startup)
        self.assertIn('exec /usr/local/bin/splee', startup)

    def test_gateway_key_is_manual_secret_only(self):
        e = self.env("explee-splee-ai-gateway")
        self.assertEqual(e["LOVABLE_API_KEY"], {"key": "LOVABLE_API_KEY", "sync": False})
        self.assertEqual(e["GATEWAY_SHARED_SECRET"]["generateValue"], True)
        cfg = (DEPLOY / "gateway" / "config.yaml").read_text()
        self.assertIn("os.environ/LOVABLE_API_KEY", cfg)
        self.assertNotIn("Bearer eyJ", cfg)

    def test_database_is_separate_and_private(self):
        self.assertEqual(len(BLUEPRINT["databases"]), 1)
        self.assertEqual(BLUEPRINT["databases"][0]["name"], "explee-splee-postgres")
        self.assertEqual(BLUEPRINT["databases"][0]["ipAllowList"], [])
        db = self.env("explee-splee-backend")["DATABASE_URL"]["fromDatabase"]
        self.assertEqual(db["name"], "explee-splee-postgres")
        self.assertEqual(db["property"], "connectionString")

    def test_credentials_wired_by_render_secret_reference(self):
        backend = self.env("explee-splee-backend")
        self.assertEqual(backend["APP_SECRET"]["generateValue"], True)
        self.assertEqual(backend["GATEWAY_SHARED_SECRET"]["fromService"]["name"], "explee-splee-ai-gateway")
        self.assertEqual(backend["GATEWAY_SHARED_SECRET"]["fromService"]["envVarKey"], "GATEWAY_SHARED_SECRET")
        self.assertEqual(backend["GATEWAY_HOST"]["fromService"]["property"], "host")

    def test_model_uses_openai_compatible_lovable_gateway(self):
        models = GATEWAY["model_list"]
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0]["model_name"], "claude-sonnet-5-5")
        provider = models[0]["litellm_params"]
        self.assertEqual(provider["api_base"], "https://ai.gateway.lovable.dev/v1")
        self.assertEqual(provider["model"], "openai/openai/gpt-6-luna")
        self.assertEqual(provider["max_retries"], 0)
        self.assertEqual(provider["extra_headers"]["Lovable-API-Key"], "os.environ/LOVABLE_API_KEY")

    def test_anthropic_messages_translation_not_anthropic_subscription(self):
        gateway = (DEPLOY / "gateway" / "start.sh").read_text()
        backend = (DEPLOY / "backend" / "start.sh").read_text()
        self.assertIn("LITELLM_USE_CHAT_COMPLETIONS_URL_FOR_ANTHROPIC_MESSAGES=true", gateway)
        self.assertIn("ANTHROPIC_BASE_URL=", backend)
        self.assertIn("ANTHROPIC_AUTH_TOKEN=", backend)
        self.assertIn("unset ANTHROPIC_API_KEY", backend)

    def test_no_mocked_or_static_leads(self):
        for path in DEPLOY.rglob("*"):
            if path.is_file():
                text = path.read_text()
                self.assertNotIn("Agnes Tworz", text)
                self.assertNotIn("adela@house-of-english.cz", text)

    def test_no_real_credentials_committed(self):
        for key in ("DATABASE_URL", "APP_SECRET", "LOVABLE_API_KEY"):
            if os.environ.get(key):
                for path in DEPLOY.rglob("*"):
                    if path.is_file():
                        self.assertNotIn(os.environ[key], path.read_text())


if __name__ == "__main__":
    unittest.main()

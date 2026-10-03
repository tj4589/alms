import io
import os
import socket
import sys
import unittest
import urllib.error
from unittest.mock import patch

os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import ai_clients  # noqa: E402


class ProviderHardeningTests(unittest.TestCase):
    def test_provider_timeout_configuration_is_bounded(self):
        self.assertGreater(ai_clients.AI_PROVIDER_TIMEOUT_SECONDS, 0)
        self.assertLessEqual(ai_clients.AI_PROVIDER_TIMEOUT_SECONDS, ai_clients.MAX_PROVIDER_TIMEOUT_SECONDS)
        self.assertEqual(ai_clients._read_bounded_timeout("45", 10), 45.0)
        self.assertIsNone(ai_clients._read_bounded_timeout("121", 10))
        self.assertIsNone(ai_clients._read_bounded_timeout("not-a-timeout", 10))

    def test_deepseek_failure_logs_class_only_and_uses_fallback(self):
        sentinel = "Bearer provider-secret raw-response-body"

        class FailingDeepSeek:
            def invoke(self, _prompt):
                raise RuntimeError(sentinel)

        with (
            patch.object(ai_clients, "llm", FailingDeepSeek()),
            patch.object(ai_clients, "_cohere_api_key", "test-key"),
            patch.object(ai_clients, "AI_FALLBACK_PROVIDER", "cohere"),
            patch.object(ai_clients, "_cohere_chat", return_value="safe fallback"),
            self.assertLogs(ai_clients.logger, level="WARNING") as captured,
        ):
            result = ai_clients.generate_ai_response("private prompt")

        self.assertEqual(result, "safe fallback")
        output = "\n".join(captured.output)
        self.assertNotIn(sentinel, output)
        self.assertIn("provider=deepseek", output)
        self.assertIn("error_class=RuntimeError", output)

    def test_cohere_rate_limit_does_not_log_response_body(self):
        sentinel = "cohere-secret-response-body"
        error = urllib.error.HTTPError(
            "https://api.cohere.com/v2/chat",
            429,
            "Too Many Requests",
            hdrs=None,
            fp=io.BytesIO(sentinel.encode("utf-8")),
        )
        with (
            patch.object(ai_clients, "llm", None),
            patch.object(ai_clients, "_cohere_api_key", "test-key"),
            patch.object(ai_clients, "AI_FALLBACK_PROVIDER", "cohere"),
            patch.object(ai_clients.urllib.request, "urlopen", side_effect=error),
            self.assertLogs(ai_clients.logger, level="WARNING") as captured,
        ):
            with self.assertRaisesRegex(ai_clients.AIProviderError, "temporarily unavailable"):
                ai_clients.generate_ai_response("private prompt")

        output = "\n".join(captured.output)
        self.assertNotIn(sentinel, output)
        self.assertIn("provider=cohere", output)
        self.assertIn("status=429", output)

    def test_openai_transcription_auth_failure_is_safe(self):
        sentinel = "openai-secret-provider-body"
        error = urllib.error.HTTPError(
            "https://api.openai.com/v1/audio/transcriptions",
            401,
            "Unauthorized",
            hdrs=None,
            fp=io.BytesIO(sentinel.encode("utf-8")),
        )
        with (
            patch.object(ai_clients, "TRANSCRIPTION_PROVIDER", "openai"),
            patch.object(ai_clients, "OPENAI_API_KEY", "test-key"),
            patch.object(ai_clients, "OPENAI_TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1"),
            patch.object(ai_clients, "TRANSCRIPTION_TIMEOUT_SECONDS", 1.0),
            patch.object(ai_clients.urllib.request, "urlopen", side_effect=error),
            self.assertLogs(ai_clients.logger, level="WARNING") as captured,
        ):
            with self.assertRaisesRegex(ai_clients.AIProviderError, "authentication failed"):
                ai_clients._openai_transcription_request("recording.mp3", "audio/mpeg", b"audio")

        output = "\n".join(captured.output)
        self.assertNotIn(sentinel, output)
        self.assertIn("provider=openai_transcription", output)
        self.assertIn("status=401", output)

    def test_provider_timeout_and_malformed_response_are_safe(self):
        with (
            patch.object(ai_clients, "TRANSCRIPTION_PROVIDER", "openai"),
            patch.object(ai_clients, "OPENAI_API_KEY", "test-key"),
            patch.object(ai_clients, "OPENAI_TRANSCRIPTION_BASE_URL", "https://api.openai.com/v1"),
            patch.object(ai_clients, "TRANSCRIPTION_TIMEOUT_SECONDS", 1.0),
            patch.object(ai_clients.urllib.request, "urlopen", side_effect=socket.timeout()),
        ):
            with self.assertRaisesRegex(ai_clients.AIProviderError, "timed out"):
                ai_clients._openai_transcription_request("recording.mp3", "audio/mpeg", b"audio")

        class InvalidResponse:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b"not-json"

        with (
            patch.object(ai_clients.urllib.request, "urlopen", return_value=InvalidResponse()),
            patch.object(ai_clients, "_cohere_api_key", "test-key"),
            patch.object(ai_clients, "AI_FALLBACK_PROVIDER", "cohere"),
        ):
            with self.assertRaisesRegex(ai_clients.AIProviderError, "invalid response"):
                ai_clients._cohere_chat("private prompt", 0.3)

    def test_cohere_network_and_server_failures_are_safe(self):
        for failure, expected in (
            (urllib.error.URLError("provider-secret-url"), "could not reach"),
            (urllib.error.HTTPError("https://api.cohere.com/v2/chat", 500, "server", None, io.BytesIO(b"secret")), "server is temporarily unavailable"),
        ):
            with self.subTest(expected=expected), patch.object(ai_clients.urllib.request, "urlopen", side_effect=failure), patch.object(ai_clients, "_cohere_api_key", "test-key"), patch.object(ai_clients, "AI_FALLBACK_PROVIDER", "cohere"):
                with self.assertRaisesRegex(ai_clients.AIProviderError, expected):
                    ai_clients._cohere_chat("private prompt", 0.3)


if __name__ == "__main__":
    unittest.main()

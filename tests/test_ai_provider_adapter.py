import unittest
from types import SimpleNamespace
from unittest import mock

from file_pilot.ai.models import (
    OPENAI_CHAT_COMPLETIONS_FORMAT,
    OPENAI_COMPATIBLE_PROVIDER,
    ChatRequest,
)
from file_pilot.ai.providers.openai_compatible import OpenAICompatibleAdapter
from file_pilot.ai.registry import get_adapter_for_runtime


class OpenAICompatibleAdapterTests(unittest.TestCase):
    def test_runtime_defaults_to_openai_compatible_format(self):
        adapter = get_adapter_for_runtime(
            {
                "base_url": "https://text.example/v1",
                "model": "gpt-test",
                "api_key": "secret",
            }
        )

        self.assertEqual(adapter.runtime.provider, OPENAI_COMPATIBLE_PROVIDER)
        self.assertEqual(adapter.runtime.api_format, OPENAI_CHAT_COMPLETIONS_FORMAT)
        self.assertEqual(adapter.runtime.tool_mode, "native")
        self.assertTrue(adapter.capabilities.tools)
        self.assertFalse(adapter.capabilities.image_generation)

    def test_chat_request_forwards_to_openai_compatible_client(self):
        response = {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "ok",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "present_plan", "arguments": '{"ok":true}'},
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        }
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))
        adapter = OpenAICompatibleAdapter({"model": "gpt-test"}, client=client)

        result = adapter.chat(
            ChatRequest(
                model="gpt-test",
                messages=[{"role": "user", "content": "ping"}],
                tools=[{"type": "function", "function": {"name": "present_plan"}}],
                tool_choice="auto",
            )
        )

        client.chat.completions.create.assert_called_once()
        self.assertEqual(result.content, "ok")
        self.assertEqual(result.tool_calls[0]["function"]["name"], "present_plan")
        self.assertEqual(result.response_mode, "non_stream")

    def test_stream_request_keeps_raw_iterator_for_existing_collectors(self):
        chunks = iter(
            [
                {"choices": [{"delta": {"content": "he"}, "finish_reason": None}]},
                {"choices": [{"delta": {"content": "llo"}, "finish_reason": "stop"}]},
            ]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=chunks))))
        adapter = OpenAICompatibleAdapter({"model": "gpt-test"}, client=client)

        result = adapter.chat(
            ChatRequest(
                model="gpt-test",
                messages=[{"role": "user", "content": "ping"}],
                stream=True,
            )
        )

        self.assertEqual(result.response_mode, "stream")
        self.assertIs(result.raw_response, chunks)
        self.assertTrue(client.chat.completions.create.call_args.kwargs["stream"])

    def test_rejects_non_enabled_provider_formats(self):
        with self.assertRaises(ValueError):
            get_adapter_for_runtime(
                {
                    "provider": "anthropic",
                    "api_format": "anthropic_messages",
                    "base_url": "https://api.anthropic.com",
                    "model": "claude",
                    "api_key": "secret",
                }
            )


if __name__ == "__main__":
    unittest.main()


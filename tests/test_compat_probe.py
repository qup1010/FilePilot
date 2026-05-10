import unittest
from types import SimpleNamespace

from file_pilot.debug.compat_probe import collect_stream_response, summarize_response_message


class CompatProbeTests(unittest.TestCase):
    def test_summarize_response_message_detects_empty_assistant_message(self):
        response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=None, tool_calls=None, role="assistant"),
                    finish_reason="stop",
                )
            ]
        )

        summary = summarize_response_message(response)

        self.assertEqual(summary["role"], "assistant")
        self.assertEqual(summary["content"], "")
        self.assertEqual(summary["tool_call_count"], 0)
        self.assertTrue(summary["empty_assistant_message"])

    def test_collect_stream_response_merges_content_and_tool_calls(self):
        stream = [
            {"choices": [{"delta": {"role": "assistant", "content": "你好"}, "finish_reason": None}]},
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {"name": "submit_probe_result", "arguments": "{\"ok\":"},
                                }
                            ]
                        },
                        "finish_reason": None,
                    }
                ]
            },
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "function": {"arguments": "true}"},
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        ]

        summary = collect_stream_response(stream)

        self.assertEqual(summary["role"], "assistant")
        self.assertEqual(summary["content"], "你好")
        self.assertEqual(summary["tool_call_count"], 1)
        self.assertEqual(summary["tool_calls"][0]["function"]["name"], "submit_probe_result")
        self.assertEqual(summary["tool_calls"][0]["function"]["arguments"], "{\"ok\":true}")
        self.assertFalse(summary["empty_assistant_message"])


if __name__ == "__main__":
    unittest.main()

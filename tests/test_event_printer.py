import unittest
from io import StringIO
from types import SimpleNamespace

from rich.console import Console

from file_organizer.cli.console import CLI
from file_organizer.cli.event_printer import scanner_ui_handler


class EventPrinterTests(unittest.TestCase):
    def build_cli(self):
        buffer = StringIO()
        console = Console(file=buffer, force_terminal=False, color_system=None, width=120)
        return CLI(console=console), buffer

    def test_wait_events_delegate_to_cli_waiting_methods(self):
        calls = []
        cli = SimpleNamespace(
            start_waiting=lambda message: calls.append(("start", message)),
            stop_waiting=lambda: calls.append(("stop", None)),
        )

        scanner_ui_handler("model_wait_start", {"message": "正在等待模型响应..."}, cli=cli)
        scanner_ui_handler("model_wait_end", {}, cli=cli)

        self.assertEqual(calls, [("start", "正在等待模型响应..."), ("stop", None)])

    def test_stream_sections_render_reasoning_and_answer_labels_once(self):
        cli, buffer = self.build_cli()

        scanner_ui_handler("ai_streaming_start", {}, cli=cli)
        scanner_ui_handler("ai_reasoning", {"content": "先分析目录。"}, cli=cli)
        scanner_ui_handler("ai_reasoning", {"content": "再检查条目。"}, cli=cli)
        scanner_ui_handler("ai_chunk", {"content": "建议整理到 Projects。"}, cli=cli)
        scanner_ui_handler("ai_chunk", {"content": "并保留 Review。"}, cli=cli)
        scanner_ui_handler("ai_streaming_end", {}, cli=cli)

        output = buffer.getvalue()
        self.assertEqual(output.count("思考:"), 1)
        self.assertEqual(output.count("回答:"), 1)
        self.assertIn("先分析目录。", output)
        self.assertIn("建议整理到 Projects。", output)

    def test_tool_start_renders_as_separate_status_line(self):
        cli, buffer = self.build_cli()

        scanner_ui_handler("tool_start", {"name": "list_local_files", "args": {"directory": "."}}, cli=cli)

        output = buffer.getvalue()
        self.assertIn("工具调用", output)
        self.assertIn("list_local_files", output)

    def test_cycle_start_does_not_render_round_banner(self):
        cli, buffer = self.build_cli()

        scanner_ui_handler("cycle_start", {"attempt": 2, "max_attempts": 3}, cli=cli)

        output = buffer.getvalue()
        self.assertEqual(output, "")


if __name__ == "__main__":
    unittest.main()

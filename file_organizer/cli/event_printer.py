from file_organizer.cli.console import default_cli


def scanner_ui_handler(event_type, data, cli=default_cli):
    """处理扫描过程中的各种反馈。"""
    if event_type == "model_wait_start":
        cli.start_waiting(data.get("message", "模型回复中..."))
    elif event_type == "model_wait_end":
        cli.stop_waiting()
    elif event_type == "cycle_start":
        pass
    elif event_type == "tool_start":
        cli.stream_status("工具调用", f"{data['name']}({data['args']})", style="dim")
    elif event_type == "ai_streaming_start":
        cli.begin_stream()
    elif event_type == "ai_reasoning":
        cli.stream_section("reasoning", "思考", data["content"], label_style="dim yellow", text_style="dim")
    elif event_type == "ai_chunk":
        cli.stream_section("answer", "回答", data["content"], label_style="bold cyan", text_style="")
    elif event_type == "ai_streaming_end":
        cli.newline()
    elif event_type == "validation_pass":
        cli.success(f"第 {data['attempt']} 次结果校验通过", title="扫描校验")
    elif event_type == "validation_fail":
        details = data["details"]
        cli.warning(f"第 {data['attempt']} 次结果校验失败", title="扫描校验")
        items = []
        if details["missing"]:
            items.append(f"缺少: {details['missing']}")
        if details["extra"]:
            items.append(f"多余: {details['extra']}")
        if details["duplicates"]:
            items.append(f"重复: {details['duplicates']}")
        if details.get("invalid_lines"):
            items.append(f"非法行: {details['invalid_lines']}")
        cli.show_list("校验详情", items, style="yellow")
    elif event_type == "retry_exhausted":
        cli.error("重试次数耗尽，本次分析未保存。", title="扫描失败")
    elif event_type == "command_validation_pass":
        cli.success(f"第 {data['attempt']} 次命令流校验通过", title="命令流校验")
    elif event_type == "command_validation_fail":
        details = data["details"]
        cli.warning(f"第 {data['attempt']} 次命令流校验失败", title="命令流校验")
        items = []
        for key, label in [
            ("missing", "缺少 MOVE"),
            ("extra", "多余 MOVE"),
            ("duplicates", "重复条目"),
            ("order_errors", "顺序错误"),
            ("invalid_lines", "非法计划"),
            ("path_errors", "路径错误"),
            ("rename_errors", "禁止重命名"),
            ("duplicate_mkdirs", "重复目录"),
            ("missing_mkdirs", "缺少目录"),
            ("unused_mkdirs", "未使用目录"),
            ("conflicting_targets", "目标冲突"),
        ]:
            if details[key]:
                items.append(f"{label}: {details[key]}")
        cli.show_list("校验详情", items, style="yellow")
    elif event_type == "command_retry_exhausted":
        cli.error("命令流自动重试已耗尽，即将进入修复模式。", title="命令流失败")
    elif event_type == "repair_mode_start":
        cli.warning("已进入修复模式，将根据权威分析结构重新生成最终计划。", title="修复模式")


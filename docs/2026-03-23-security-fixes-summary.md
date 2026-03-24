# 2026-03-23 安全修复总结

## 背景

本轮优先处理了三项高优先级安全问题：

1. `config.json` 持久化明文 secret
2. 本地 FastAPI 缺少最小鉴权
3. 分析链路允许读取目标目录外文件

---

## 已完成变更

### 1. 配置管理：secret 不再落盘

相关文件：

- `file_organizer/shared/config_manager.py`
- `.gitignore`
- `tests/test_config_manager.py`

已完成内容：

- 将 `OPENAI_API_KEY`、`IMAGE_ANALYSIS_API_KEY` 从持久化 profile 中剥离，不再写入 `config.json`；secret 仅存在于运行时内存和进程环境变量中。
- `save()` 写入的 `config.json` 不再包含 secret 字段。
- `get_active_config()` 仍能返回运行时 secret，并保留脱敏展示逻辑。
- `update_active_profile()` 现在区分：
  - 非敏感字段：允许持久化
  - 敏感字段：只更新运行时 secret
- 支持显式清空 secret。
- 增加白名单过滤，忽略未知配置键，避免任意字段进入 profile 和环境变量。
- 修复 profile 切换时 secret 串用问题。
- 修复已有 `config.json` 场景下，从环境变量补齐当前 active profile 的运行时 secret。
- 修复旧版 `OPENAI_ANALYSIS_MODEL` 到 `OPENAI_MODEL` 的迁移。
- `.gitignore` 已加入 `config.json`，避免新的本地配置再次污染工作树。

### 2. 本地 API：补最小鉴权与输入校验

相关文件：

- `file_organizer/api/main.py`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/runtime.ts`
- `frontend/src/lib/sse.ts`
- `frontend/src/lib/use-session.ts`
- `frontend/src/app/settings/page.tsx`
- `frontend/src/types/session.ts`
- `desktop/src-tauri/src/backend.rs`
- `desktop/src-tauri/src/runtime.rs`
- `desktop/src-tauri/src/lib.rs`
- `tests/test_api_sessions.py`
- `tests/test_api_auth.py`
- `tests/test_api_runtime.py`

已完成内容：

- FastAPI 增加实例级 token 鉴权中间件。
- 放行：
  - `GET /api/health`
  - `OPTIONS` 预检请求
- 当 `FILE_ORGANIZER_API_TOKEN` 已设置时，其余 `/api/*` 要求 token；桌面端启动链路会自动注入该 token。
- token 支持：
  - REST 请求头：`Authorization: Bearer ...` 或 `x-file-organizer-token`
  - SSE query：`access_token`
- 桌面端启动 Python API 时生成实例 token，并通过运行时注入给前端。
- 前端 REST 请求统一自动带 token。
- 前端 SSE 订阅统一自动带 token。
- 由于浏览器 `EventSource` 不能自定义 header，SSE 当前采用 query token，这是兼容性折中方案，暴露面高于 REST header。
- 设置页不再绕过统一 API client。
- `api/main.py` 为关键接口补了 Pydantic 请求模型，缺字段时返回 `422`，避免 `KeyError -> 500`。
- `open_dir()` / `test_llm()` 改为返回稳定错误，同时在服务端记录异常日志，减少前端暴露内部错误细节。
- `AddProfilePayload` 调整为 alias 字段，去掉 Pydantic warning。

### 3. 分析链路：收紧本地文件读取边界

相关文件：

- `file_organizer/analysis/service.py`
- `file_organizer/analysis/file_reader.py`
- `file_organizer/analysis/models.py`
- `tests/test_analysis_path_boundaries.py`
- `tests/test_analysis_structured_service.py`
- `tests/test_file_parser.py`

已完成内容：

- `analysis/service.py` 为 `read_local_file` 增加目标目录边界校验。
- 拒绝读取：
  - 目标目录外绝对路径
  - `..` 越界路径
  - 目录路径
- `analysis/file_reader.py` 增加第二层 `allowed_base_dir` 防御。
- 修复结构化分析校验时 `entry_name` 未规范化的问题，避免 `./foo`、绝对路径等被误判。
- 修复空输出时 `duplicates` 键缺失导致的兼容问题。
- 恢复 `AnalysisItem` 的兼容字段，避免结构化分析测试回归。

---

## 新增/更新测试

### 配置管理回归

- `test_sync_from_legacy_env_does_not_persist_secret_values_to_config_json`
- `test_update_active_profile_keeps_secret_in_runtime_but_not_on_disk`
- `test_update_active_profile_ignores_unknown_keys`
- `test_update_active_profile_allows_clearing_secret_fields`
- `test_switch_profile_does_not_inherit_previous_profile_runtime_secret`
- `test_existing_config_keeps_runtime_secret_from_environment`
- `test_load_from_file_migrates_legacy_openai_analysis_model`

### API 回归

- `test_post_sessions_returns_422_when_target_dir_is_missing`
- `test_messages_endpoint_returns_422_when_content_is_missing`
- `test_update_item_returns_422_when_item_id_is_missing`

### 分析路径边界回归

- 覆盖目录外绝对路径读取失败
- 覆盖 `../` 越界路径读取失败
- 覆盖结构化分析校验兼容性

---

## 已验证结果

本轮已通过：

```bash
python -m unittest tests.test_config_manager -v
python -m unittest tests.test_api_sessions -v
```

其中：

- `tests/test_config_manager.py`：7 个测试通过
- `tests/test_api_sessions.py`：24 个测试通过

此前还已完成并验证过：

- 分析路径边界相关测试
- 分析结构化服务相关测试
- API 鉴权/运行时相关测试
- 前端 typecheck
- Tauri / Rust 侧联动校验

---

## 当前仍需继续处理的点

以下问题已识别，但本轮未继续展开：

1. `config.json` 虽然已不再写入 secret，但它目前仍是 **git tracked 文件**。
   - `.gitignore` 只能阻止未跟踪文件，不能解决已跟踪文件。
   - 后续需要决定是否从索引移除，或改为示例配置文件方案。

2. `/api/utils/test-llm` 仍有进一步收紧空间。
   - 当前已减少错误信息暴露。
   - 但若允许任意 `base_url`，仍建议后续继续评估是否需要白名单或限制策略。

3. 已暴露过的历史 API key 需要人工轮换。
   - 代码修复只能阻止继续落盘，不能撤销历史泄露风险。

---

## 结论

本轮三项主安全修复已基本落地：

- secret 去盘化
- 本地 API 最小鉴权
- 分析读取边界收紧

同时补齐了对应的关键回归测试，并修复了修复过程中新暴露出的兼容性与输入校验问题。

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库概览

这是一个本地文件整理工作台，包含三层入口：

- Python CLI：交互式整理主流程
- FastAPI 本地 API：给前端工作台和桌面壳提供会话接口
- Next.js + Tauri：桌面工作台前端与宿主

当前主链路是：

`扫描目录 -> AI 分析 -> 增量整理对话 -> 预检 -> 明确确认 -> 执行文件移动 -> 写执行日志 -> 支持最近一次回退`

## 常用命令

### Python 依赖

```bash
pip install -r requirements.txt
```

### CLI 主流程

```bash
python -m file_organizer
```

### 启动本地 API

```bash
python -m file_organizer.api
```

默认监听 `http://127.0.0.1:8765`，并写入运行时文件：`output/runtime/backend.json`。

常用环境变量：

- `FILE_ORGANIZER_API_HOST` / `FILE_ORGANIZER_API_PORT` / `FILE_ORGANIZER_API_BASE_URL`
- `FILE_ORGANIZER_API_RELOAD=false`（桌面宿主默认关闭 reload，避免 runtime 文件归属漂移）
- `FILE_ORGANIZER_API_TOKEN=...`（开启后，除 `/api/health` 外的 `/api/*` 请求都需要带 token）

### 回退最近一次执行

```bash
python -m file_organizer.rollback <target_dir>
```

例如：

```bash
python -m file_organizer.rollback D:/Downloads
```

### Python 测试

全量：

```bash
python -m unittest discover -s tests -p "test_*.py"
```

单个模块：

```bash
python -m unittest tests.test_session_service -v
python -m unittest tests.test_api_runtime -v
python -m unittest tests.test_rollback_service -v
```

单个测试方法：

```bash
python -m unittest tests.test_api_sessions.ApiSessionsTest.test_create_session_returns_snapshot -v
```

### 前端工作台

```bash
cd frontend
npm install
npm run dev
```

前端构建：

```bash
cd frontend
npm run build
```

前端类型检查：

```bash
cd frontend
npm run typecheck
```

如需直连非默认后端，可设置：

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8765
```

### Tauri 桌面壳

```bash
cd desktop
npm install
npm run tauri:dev
```

桌面构建：

```bash
cd desktop
npm run tauri:build
```

Rust 侧快速校验：

```bash
cd desktop/src-tauri
cargo check
```

## 高层架构

### 1. `OrganizerSessionService` 是系统编排核心

`file_organizer/app/session_service.py` 是整个产品的状态机与编排中心。

- CLI 入口 `file_organizer/cli/session_cli.py` 调它
- FastAPI 入口 `file_organizer/api/main.py` 也调它
- 它统一管理 session 生命周期、阶段流转、事件流、预检、执行、回退

如果你想理解“这次用户操作为什么会进入某个阶段”，先看这里。

### 2. 会话状态是持久化的，不只是内存对象

会话存储在 `output/sessions`，由 `file_organizer/app/session_store.py` 管理。

关键点：

- 每个目标目录同一时间只允许一个可写会话
- 目录锁也保存在 `output/sessions` 下
- 会话支持恢复、失效标记、放弃、只读历史查看

这意味着很多行为不是单次 CLI 调用，而是“可恢复的工作会话”。

### 3. 分析层只负责“看懂当前目录”，不负责落盘

`file_organizer/analysis/service.py` 负责扫描和 AI 分析：

- 只分析目标目录当前层条目
- 允许工具读取文件摘要、图片摘要、压缩包索引预览
- 会校验分析结果是否覆盖当前层全部条目
- 分析结果最终写成 `scan_lines`，供后续整理阶段消费

如果改动分析逻辑，要保住“完整覆盖当前层条目并校验”的约束。

### 4. 整理层是“增量规划器”，不是一次性生成最终命令

`file_organizer/organize/service.py` 不直接执行文件操作，而是维护一个逐轮演进的计划：

- 基于 `scan_lines + 对话消息 + 已确认偏好`
- 通过工具调用提交计划 diff、待确认项和最终计划
- 产物分成 `PendingPlan` 和 `FinalPlan`
- 前端展示的摘要、分组、待确认项都来自这里生成的快照

如果要改交互体验，通常不是改 execution，而是改 organize 和 session snapshot 的生成方式。

### 5. 执行层只认结构化最终计划

`file_organizer/execution/service.py` 会把最终计划转成真实文件系统动作：

- `MKDIR`
- `MOVE`

执行前会做真实文件系统预检：

- 源是否存在
- 目标是否已存在
- 是否移动到自身子路径
- 目标父目录是否存在或被计划创建

执行日志和回退依据写在 `output/history/executions`。

### 6. 回退依赖 journal，而不是重新推理

`file_organizer/rollback/service.py` 依据最近一次 execution journal 做回退。

因此如果改动 execution journal 结构，必须同时考虑 rollback 是否还能正确读取旧数据或当前数据。

### 7. API、前端、桌面壳共享同一套运行时契约

#### FastAPI

`file_organizer/api/main.py` 提供：

- session 生命周期接口
- 预检 / 执行 / 回退接口
- SSE 事件流 `GET /api/sessions/{session_id}/events`
- 一些本地工作台工具接口，例如打开目录、选择目录、配置管理、模型连通性测试

如果设置了 `FILE_ORGANIZER_API_TOKEN`，除了 `/api/health` 以外的 `/api/*` 请求都必须通过 `Authorization: Bearer ...`、`x-file-organizer-token` 或 query 参数带 token。

#### Next.js 前端

前端在 `frontend/src`：

- `src/lib/api.ts` 是 REST client
- `src/lib/use-session.ts` 负责会话加载、SSE 订阅、工作台状态同步
- `src/components/workspace-client.tsx` 是工作台主容器

核心业务状态以后端 `session_snapshot` 和事件流为准，前端只维护少量本地瞬时 UI 状态（例如 `assistantDraft`、`activityFeed` 和局部乐观更新）。

纯前端开发时，`frontend/src/lib/runtime.ts` 会按以下顺序解析 API 地址：

1. `window.__FILE_ORGANIZER_RUNTIME__.base_url`
2. `NEXT_PUBLIC_API_BASE_URL`
3. 默认 `http://127.0.0.1:8765`

前端也会从同一个 runtime 对象读取 `api_token`，用于给 API client 自动补鉴权头。

#### Tauri 桌面壳

Tauri 宿主在 `desktop/src-tauri`：

- 启动时拉起 `python -m file_organizer.api`
- 为该后端生成独立 `instance_id` 和 API token
- 等待 `output/runtime/backend.json`
- 校验 runtime 文件里的 `pid` / `instance_id`
- 再请求 `/api/health`，确认 runtime 文件确实属于当前后端实例
- 通过注入 `window.__FILE_ORGANIZER_RUNTIME__.base_url` 和 `api_token` 让前端连接当前后端实例

所以桌面端联调问题，优先检查：

1. Python API 是否成功启动
2. `output/runtime/backend.json` 是否生成且实例归属正确
3. `/api/health` 返回的 `instance_id` 是否与 runtime 文件一致
4. 前端是否正确读取注入的 `base_url` / `api_token`
5. 非桌面开发场景下是否误用了 `NEXT_PUBLIC_API_BASE_URL` 或默认地址

## 重要约束与共享契约

### session stage 是状态机协议，不只是展示字段

常见主链路：

`draft -> scanning -> planning / ready_for_precheck -> ready_to_execute -> executing -> completed`

需要特别注意的 stage 分组：

- terminal：`abandoned`、`completed`、`stale`
- locked：`scanning`、`executing`、`rolling_back`
- 异常恢复相关：`interrupted`、`stale`

很多 `SESSION_STAGE_CONFLICT` 都和这里有关。改阶段流转前，先看 `file_organizer/app/session_service.py`。

### `session_snapshot` / stage / event name 是跨端协议

以下内容是 Python 与前端共享契约：

- `session_snapshot` 结构
- session stage 名称
- SSE event 名称
- unresolved choices 的 block 结构
- 前端 `RuntimeConfig` 中的 `base_url` / `api_token`

只改其中一端通常会把工作台打坏。涉及这类改动时，至少同步检查：

- `file_organizer/app/session_service.py`
- `file_organizer/api/main.py`
- `frontend/src/types/session.ts`
- `frontend/src/lib/use-session.ts`
- `frontend/src/lib/runtime.ts`

### 运行时发现机制不要随意改

当前桌面与前端依赖这两个稳定契约：

- `output/runtime/backend.json`
- `window.__FILE_ORGANIZER_RUNTIME__.base_url`
- `window.__FILE_ORGANIZER_RUNTIME__.api_token`

桌面端启动握手不只是“文件存在即可”，还依赖 runtime 文件与当前后端实例的一致性校验；如果你改运行时发现逻辑，桌面启动、前端 API 连接和本地联调都会一起受影响。

### CLI 确认流程是产品行为，不只是文案

CLI 主流程保留了明确的分阶段确认：

- 用户先自然语言调整整理方案
- 输入“执行”进入预检
- 只有显式输入大写 `YES` 才真正落盘

不要把“预检”和“执行确认”混成一步。

### Windows 路径是第一等场景

仓库明显以 Windows 本地整理场景为主：

- 示例路径大量使用 `D:/...`
- API 里直接调用 `explorer`
- 目录选择走 `tkinter`
- 文本读取兼容常见中文 Windows 编码

改路径处理时不要默认这是纯 Unix 项目。

## 修改时优先回归的测试

### 会话 / 状态机 / 快照改动

```bash
python -m unittest tests.test_session_service -v
python -m unittest tests.test_api_sessions -v
python -m unittest tests.test_main_flow -v
```

### 运行时发现 / API 启动改动

```bash
python -m unittest tests.test_api_runtime -v
```

### 回退链路改动

```bash
python -m unittest tests.test_rollback_service -v
python -m unittest tests.test_rollback_last_execution -v
```

### 前端接口或工作台状态改动

```bash
cd frontend
npm run typecheck
```

### Tauri / 桌面宿主改动

```bash
cd desktop/src-tauri
cargo check
```

## 额外说明

- Python 侧当前没有仓库内的独立 lint 配置；不要假设存在 `ruff`、`flake8` 或 `pytest` 工作流。
- 前端使用 Next.js 15，`frontend/next.config.mjs` 配置为 `output: "export"`。
- 文件分析依赖 OpenAI 兼容接口；基础配置从项目根 `.env` 和配置管理器读取。图片分析走独立配置，不复用普通文本分析设置。
- 当前前端不是纯 mock：它已经通过 `src/lib/api.ts` 和 `src/lib/use-session.ts` 对接真实 FastAPI / SSE；如果改 API 返回结构，要按真实跨端联调来回归。

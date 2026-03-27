# AGENTS.md

## 语言与输出

- 除非用户明确要求英文，否则所有回复使用简体中文。
- 代码标识符、命令、日志、报错信息保持原始语言；其余解释使用中文。
- 中文注释、Markdown、日志说明统一使用 UTF

## 项目概览

- 这是一个本地文件整理项目，当前同时包含 CLI、FastAPI、本地前端工作台和 Tauri 桌面壳。
- 当前主链路覆盖：
  - 扫描目录
  - AI 分析
  - 增量整理对话
  - 执行预检
  - 输入大写 `YES` 后执行
  - 写入执行日志
  - 支持最近一次回退

## 目录约定

- `file_organizer/analysis`：扫描分析、文件读取、摘要能力
- `file_organizer/organize`：整理对话、增量计划、确认逻辑
- `file_organizer/execution`：执行计划、日志、报告
- `file_organizer/rollback`：最近一次执行回退
- `file_organizer/app`：桌面工作台会话服务
- `file_organizer/api`：FastAPI 本地 API 与运行时发现
- `file_organizer/cli`：终端 UI 与事件输出
- `file_organizer/workflows`：CLI 主流程与回退流程编排
- `frontend/`：Next.js 工作台前端
- `desktop/`：Tauri 宿主

## 常用命令

### Python 依赖

```powershell
pip install -r requirements.txt
```

### CLI 主流程

```powershell
python -m file_organizer
```

### 回退最近一次执行

```powershell
python -m file_organizer.rollback D:/Downloads
```

### 启动本地 API

```powershell
python -m file_organizer.api
```

- 默认地址：`http://127.0.0.1:8765`
- API 进程会写入运行时文件：`output/runtime/backend.json`

### 运行 Python 测试

```powershell
python -m unittest discover -s tests -p "test_*.py"
```

### 运行单个测试模块

```powershell
python -m unittest tests.test_session_service -v
python -m unittest tests.test_api_runtime -v
python -m unittest tests.test_rich_workflow_integration -v
```

### 前端开发

```powershell
Set-Location frontend
npm install
npm run dev
```

### 前端类型检查

```powershell
Set-Location frontend
npm run typecheck
```

### Tauri 桌面壳

```powershell
Set-Location desktop
npm install
npm run tauri:dev
```

### Tauri 构建

```powershell
Set-Location desktop
npm run tauri:build
```

### Rust 侧快速检查

```powershell
Set-Location desktop\src-tauri
cargo check
```

## 推荐工作流

### 1. 纯 CLI 工作流

1. 安装 Python 依赖。
2. 运行 `python -m file_organizer`。
3. 通过自然语言指令查看摘要、改动和待确认项。
4. 执行前确认未决项是否符合预期。
5. 只有在准备落盘时才输入大写 `YES`。

### 2. API / 工作台开发工作流

1. 启动 `python -m file_organizer.api`。
2. 在 `frontend/` 运行 `npm run dev`。
3. 如涉及会话快照、事件流或阶段推进，优先同步验证：
   - `tests/test_api_*.py`
   - `tests/test_session_*.py`
   - `tests/test_main_flow.py`

### 3. 桌面联调工作流

1. 确保 `frontend/` 与 `desktop/` 依赖已安装。
2. 在 `desktop/` 运行 `npm run tauri:dev`。
3. Tauri 会负责拉起 `python -m file_organizer.api`。
4. 前端优先读取 `window.__FILE_ORGANIZER_RUNTIME__.base_url`。
5. 如联调异常，优先检查 `output/runtime/backend.json` 是否生成。

### 4. 回退验证工作流

1. 先完成一次真实整理执行并生成 journal。
2. 运行 `python -m file_organizer.rollback <target_dir>`。
3. 先看回退预检，再决定是否确认执行。
4. 修改回退逻辑时至少回归：
   - `tests/test_rollback_service.py`
   - `tests/test_rollback_last_execution.py`

## 修改约束

- 改动会话状态机、API schema、事件名或 `session_snapshot` 时，必须同时检查：
  - Python 服务测试
  - 前端类型定义
  - 相关文档或设计稿
- 改动 `frontend/`、工作台页面或桌面壳交互时，默认按“桌面应用”而不是“普通网页”设计：
  - 优先保证稳定工作台框架、清晰信息密度和长时间使用的低疲劳体验
  - 优先考虑窗口化使用场景，包括小窗口、分栏、状态栏、工具栏和高频任务切换
  - 避免网页式 hero、大横幅、居中窄栏、宣传感文案和漂浮卡片堆叠
  - 如无明确理由，不要引入偏官网化、营销化或 SaaS dashboard 风格的布局
- 改动 CLI 交互文案时，注意不要破坏当前“摘要优先、自然语言快捷指令、`YES` 最终确认”的主流程。
- 改动运行时发现机制时，保持以下契约稳定：
  - `output/runtime/backend.json`
  - `window.__FILE_ORGANIZER_RUNTIME__.base_url`
- 涉及 Windows 路径时，优先保持现有写法和兼容性，不要假设仅在 Unix 环境运行。

## 提交前最小验证

- Python 逻辑改动：运行相关 `unittest`
- 前端改动：运行 `npm run typecheck`
- Tauri / Rust 改动：运行 `cargo check`
- 涉及端到端主链路时，至少手动验证以下其一：
  - `python -m file_organizer`
  - `python -m file_organizer.api`
  - `npm run tauri:dev`

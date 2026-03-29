# file-organizer-test

本项目是一个本地文件整理应用，当前同时包含：

- CLI 主流程
- FastAPI 本地 API
- Next.js 本地工作台前端
- Tauri 桌面壳

当前主链路已经可运行：

`扫描目录 -> AI 分析 -> 整理对话 -> 执行预检 -> YES 确认执行 -> 写入执行日志 -> 支持最近一次回退`

## 当前整理流程

- 分析阶段只处理目标目录当前层条目，并做结果校验。
- 整理阶段改为增量交互：模型通过 `submit_plan_diff` 只提交本轮变更，系统在本地维护完整待定计划。
- 默认先展示摘要视图：目录分组、当前变化、待确认项。
- 用户可直接输入自然语言快捷意图，例如 `看明细`、`看改动`、`看待确认项`、`执行`。
- 若未确认项当前默认落在 `Review/`，执行前可按默认策略自动收口；否则必须继续确认。
- 真正落盘前仍需输入大写 `YES`。

## 运行入口

CLI 主流程：

```bash
python -m file_organizer
```

启动本地 API：

```bash
python -m file_organizer.api
```

- 默认地址：`http://127.0.0.1:8765`
- API 进程会写入运行时文件：`output/runtime/backend.json`

前端开发：

```bash
cd frontend
npm install
npm run dev
```

Tauri 桌面壳：

```bash
cd desktop
npm install
npm run tauri:dev
```

回退最近一次执行：

```bash
python -m file_organizer.rollback D:/Downloads
```

## 目录结构

```text
file_organizer/
  analysis/    扫描分析、文件读取、分析提示词
  organize/    整理对话、增量计划、最终计划校验
  execution/   执行计划、执行日志、执行报告
  rollback/    回退计划、回退预检、回退执行
  app/         桌面工作台会话服务
  api/         FastAPI 本地 API 与运行时发现
  cli/         终端展示与事件输出
  shared/      配置、路径工具、history/journal 公共存储
  workflows/   主流程编排与入口逻辑
frontend/      Next.js 工作台前端
desktop/       Tauri 宿主
```

## 文件读取能力

- 普通文本读取，支持常见中文 Windows 编码 fallback：`UTF-8`、`UTF-8 with BOM`、`GBK`、`UTF-16`
- `PDF`、`Word`、`Excel` 摘要提取
- `.zip` 索引预览，不解压、不读取内部正文
- 图片简短摘要，使用独立 Vision 配置，不复用主分析上下文

相关配置：

```env
IMAGE_ANALYSIS_ENABLED=true
IMAGE_ANALYSIS_BASE_URL=https://your-vision-endpoint/v1
IMAGE_ANALYSIS_API_KEY=your_api_key
IMAGE_ANALYSIS_MODEL=your_vision_model
```

配置文件约定：

- 仓库只保留脱敏示例 [`config.example.json`](config.example.json)，用于说明双预设配置结构。
- 本地运行仍读取根目录 `config.json`；该文件已被 `.gitignore` 忽略，不应提交到版本控制。

## 测试

```bash
python -m unittest discover -s tests -p "test_*.py"
```

前端类型检查：

```bash
cd frontend
npm run typecheck
```

## 日志

- 后端基础运行日志始终写入 `logs/backend/runtime.log`
- `runtime.log` 按天轮转，默认保留 7 份历史文件
- 设置页里的“详细日志”只控制是否额外写入 `logs/backend/debug.jsonl`
- `logs/backend/debug.jsonl` 为结构化 JSONL，记录扫描、规划、工具调用和异常调试摘要
- 现有执行 journal 继续保留在 `output/history/executions`
- 兼容调试产物 `output/runtime/debug_prompt.json` 仍会继续生成

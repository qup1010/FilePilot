<div align="center">
  <img src="./frontend/public/app-icon.png" alt="FilePilot Logo" width="128" />

  <h1>FilePilot</h1>

  <p>让 AI 帮你安全整理杂乱文件</p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square" alt="Platform Windows" />
    <img src="https://img.shields.io/badge/Desktop-Tauri-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Desktop Tauri" />
    <img src="https://img.shields.io/badge/Frontend-Next.js-000000?style=flat-square&logo=nextdotjs&logoColor=white" alt="Next.js" />
    <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+" />
    <img src="https://img.shields.io/badge/License-MIT-84cc16?style=flat-square" alt="MIT License" />
  </p>

  <p>
    <a href="#项目简介">项目简介</a> |
    <a href="#核心特性">核心特性</a> |
    <a href="#界面预览">界面预览</a> |
    <a href="#快速开始">快速开始</a> |
    <a href="#配置模型">配置模型</a> |
    <a href="#安全边界">安全边界</a> |
    <a href="#当前限制">当前限制</a> |
    <a href="#常见问题">常见问题</a> |
    <a href="#源码运行">源码运行</a>
  </p>
</div>

---

## 项目简介

FilePilot 是一个本地运行的 AI 文件整理应用，能够帮助用户整理和归档各种杂乱文件。

它把文件整理拆成一条可确认的工作流：扫描来源 → 模型生成整理方案 → 执行前预检 → 用户确认后执行。每次执行都保留日志和回退入口，方便检查结果或撤销。

FilePilot 适合处理"文件很多、类型混杂、命名不统一、人工整理成本高"的场景，例如下载目录、课程资料、截图素材、办公文档、临时收集文件等。

### 通用 Agent 也能操作文件，为什么用 FilePilot？

通用 Agent（如 Codex、Claude Code）可以执行文件操作，但它们的工作方式是"把文件系统当作编程环境的一部分"来操控，而不是作为一个面向用户的整理工具来设计。FilePilot 专门针对文件整理场景做了以下改进：

- **可视化方案确认**：通用 Agent 在终端或对话流中执行操作，用户很难在执行前总览全部变更。FilePilot 在移动任何文件之前，会生成结构化的整理方案供用户检查和确认。
- **执行前预检**：FilePilot 会在执行前检查路径冲突、跨磁盘移动等潜在风险，而不是直接执行 AI 的输出。
- **上下文隔离**：通用 Agent 通常在同一个上下文中完成所有操作，容易在大量文件场景下丢失信息或产生幻觉。FilePilot 将扫描、分析、规划拆分为独立阶段，分别处理，降低单步出错概率。
- **安全边界**：FilePilot 不会自动执行文件操作——需要用户手动确认后才会真正移动文件，并且每次执行都保留日志和回退入口。通用 Agent 没有这种系统级的安全约束。
- **专用交互界面**：FilePilot 提供桌面工作台，包含来源选择、方案预览、执行日志和回退入口，而不需要用户在终端中逐条与 AI 对话。

## 核心特性

### 把杂乱文件夹变成可确认的整理方案

FilePilot 可以基于文件名、目录结构和必要的内容摘要生成整理建议。你可以选择把文件归入已有目录，也可以让它生成新的分类结构。

### 移动前先检查风险，不让 AI 直接乱动文件

在真正移动文件之前，FilePilot 会先展示整理方案，并对潜在风险进行提示，例如目标路径冲突、跨磁盘移动、异常任务状态等。用户需要确认后才会执行实际文件操作。

### 整理后可查日志，操作可回退

每次执行都会记录整理日志。整理完成后，可以查看历史记录，并使用最近一次回退入口撤销上一次整理操作。

### 使用你自己的模型接口，不绑定托管服务

FilePilot 不提供托管模型服务，也不会内置固定模型账号。你需要自行配置 OpenAI-compatible 模型接口，例如 OpenAI、DeepSeek、Ollama 或其他兼容服务。

### 支持多个来源一起整理

可以同时选择多个文件或文件夹作为来源，合并到一次整理任务中一起处理。

### 整理后为文件夹生成更直观的图标

FilePilot 还提供图标工坊，可为整理后的文件夹生成、预览、应用和恢复自定义图标。该功能需要额外配置生图模型。

## 适用场景

| ✅ 适合 | ❌ 不建议 |
| :--- | :--- |
| 下载目录、桌面文件 | 系统目录 |
| 课程资料、文档素材 | 同步盘根目录 |
| 图片素材、临时收集文件夹 | 正在开发的代码仓库 |
| 命名不统一的混杂目录 | 含敏感信息的私有目录 |
| | 不希望发送给外部模型分析的文件 |

## 界面预览

### 启动工作台

进入桌面版后，可以继续已有任务，也可以开始一次新的整理任务。

![启动工作台](./frontend/public/screenshots/启动工作台.png)

### 扫描与分析

扫描阶段会读取来源结构，并逐步建立分析结果。对于较大的任务，可以等待后台分析完成。

![扫描与分析](./frontend/public/screenshots/扫描.png)

### 方案确认

整理方案生成后，可以在执行前查看结构预览、待处理项和确认入口。

![整理方案确认](./frontend/public/screenshots/整理页.png)

## 快速开始

### 环境要求

- Windows 10 / 11
- 一个可用的 OpenAI-compatible 模型接口（如 OpenAI、DeepSeek、Ollama 等）

### 安装与首次使用

1. 前往 [GitHub Releases](https://github.com/qup1010/FilePilot/releases) 下载最新版本的安装包。
2. 安装后打开 FilePilot，进入设置页配置文本模型接口并测试连通性。
3. 选择一个测试目录作为来源。
4. 选择整理方式：归入已有目录，或生成新的分类结构。
5. 等待扫描和方案生成。
6. 检查整理方案和预检结果。
7. 确认无误后执行。
8. 在历史记录中查看执行日志，必要时使用最近一次回退。

> **首次使用建议**：先复制一份小型测试目录，不要直接对重要目录执行整理。确认模型输出、整理方案和回退流程都符合预期后，再处理真实目录。

## 配置模型

FilePilot 使用 OpenAI-compatible 接口。你至少需要配置文本模型的接口地址、模型名称和 API Key。

**桌面版用户**：打开应用后在设置页中配置即可，不需要手动编辑配置文件。

**源码运行**：复制 `config.example.json` 为 `config.json`，然后填写自己的配置：

```json
{
  "text_presets": {
    "default": {
      "name": "默认文本模型",
      "OPENAI_BASE_URL": "https://your-text-endpoint/v1",
      "OPENAI_MODEL": "your-model-name",
      "OPENAI_API_KEY": "your-api-key"
    }
  },
  "active_text_preset_id": "default"
}
```

只配置文本模型即可使用扫描、规划、预检、执行和回退主链路。图片理解默认关闭，不影响基础整理功能。

## 安全边界

FilePilot 的工作台和文件执行逻辑在本地运行，但在扫描分析和规划阶段，文件名、目录结构以及必要的内容摘要可能会发送到你自己配置的模型接口。

FilePilot 不代管你的 API Key，也不提供托管模型服务。模型调用的速度、安全性、稳定性、费用和隐私边界取决于你选择的模型服务商。

## 当前限制

FilePilot 当前主要面向 Windows 桌面环境。

执行前预检会提示潜在风险，但不会替用户自动阻断所有高成本或高风险操作。请在确认方案无误后再执行整理。

文件分析速度和质量取决于你配置的模型能力、上下文窗口、接口稳定性以及待整理文件本身的信息量。

## 常见问题

### 图标工坊和文件整理有什么关系？

图标工坊是 FilePilot 的扩展能力，不是整理文件的必要步骤。

文件整理解决的是"文件应该放到哪里"，图标工坊解决的是"整理后的目录怎么更容易识别"。当 FilePilot 生成新的分类目录后，用户可以继续为这些文件夹生成、预览、应用或恢复自定义图标，让整理后的目录更直观。

## 源码运行

### 环境要求

- Python 3.11+
- Node.js 18+
- Rust 环境（仅桌面壳需要，可通过 [rustup.rs](https://rustup.rs/) 安装）

### 1. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

### 2. 安装前端依赖

```bash
cd frontend
npm install
```

### 3. 安装桌面端依赖

```bash
cd ../desktop
npm install
```

### 4. 启动本地 API

```bash
python -m file_pilot.api
```

默认地址：

```text
http://127.0.0.1:8765
```

### 5. 启动前端工作台

```bash
cd frontend
npm run dev
```

### 6. 启动桌面壳

需要本机已安装 Rust 环境。

```bash
cd desktop
npm run tauri:dev
```

## License

[MIT](./LICENSE)

---

**友情链接** · [**LINUX DO**](https://linux.do/)

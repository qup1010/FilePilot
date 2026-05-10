<div align="center">
  <img src="./frontend/public/app-icon.png" alt="FilePilot Logo" width="128" />

  <h1>FilePilot</h1>

  <p>面向 Windows 的本地 AI 文件整理工作台</p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Windows-0078D4?style=flat-square" alt="Platform Windows" />
    <img src="https://img.shields.io/badge/Desktop-Tauri-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Desktop Tauri" />
    <img src="https://img.shields.io/badge/Python-3.11%2B-3776AB?style=flat-square&logo=python&logoColor=white" alt="Python 3.11+" />
    <img src="https://img.shields.io/badge/License-MIT-84cc16?style=flat-square" alt="MIT License" />
  </p>

  <p>
    <a href="#它适合谁">它适合谁</a> |
    <a href="#核心能力">核心能力</a> |
    <a href="#当前限制">当前限制</a> |
    <a href="#下载安装">下载安装</a> |
    <a href="#首次配置">首次配置</a> |
    <a href="#最小使用流程">最小使用流程</a> |
    <a href="#源码运行">源码运行</a>
  </p>

</div>

---

## 一句话说明

FilePilot 用本地工作台把“扫描文件 -> 生成整理方案 -> 预检 -> 确认执行 -> 保留日志和回退入口”串成一条完整链路，适合处理 Windows 上长期堆积的下载目录、桌面和素材暂存目录。

## 它适合谁

适合：

- 想整理下载目录、桌面、素材收集目录的人
- 已经有一批混乱文件，想先看方案再决定是否执行的人
- 需要“归入已有目录”或“生成新结构”两种整理方式的人
- 希望自己掌握模型接口和 API Key，而不是把文件交给托管 SaaS 的人

不太适合：

- 想直接整理系统目录、开发环境目录、同步盘根目录的人
- 不希望任何文件内容发送到外部模型接口的人
- 需要 macOS / Linux 原生桌面体验的人

## 核心能力

- 支持多文件、多文件夹、混合来源启动任务
- 支持两种整理方式：
  - 归入已有目录
  - 生成新的分类结构
- 支持在执行前预检冲突和风险
- 支持重新扫描并重建可信方案
- 支持空目录直接完成，不进入无意义规划
- 支持执行日志、历史记录和最近一次回退
- 支持目标目录说明，帮助模型理解已有目录用途
- 图片理解默认复用文本模型，也可以单独配置

## 当前限制

- 当前主要面向 Windows
- 推荐优先使用桌面版，源码运行更适合开发者
- 你需要自行配置模型接口，项目不提供托管模型服务
- 只配置文本模型即可开始使用；图片理解默认关闭也不影响主流程
- 文件分析质量取决于你配置的模型能力、接口稳定性和上下文窗口
- 执行前预检会提示跨磁盘分区移动等高成本操作，但不会自动替你阻断

## 界面截图

### 启动工作台

进入桌面版后，可以直接继续已有任务，或开始一次新的整理。

![启动工作台](./frontend/public/screenshots/启动工作台.png)

### 扫描与分析

扫描阶段会先读取来源结构，再逐步建立分析结果；长任务可以在后台等待完成。

![扫描与分析](./frontend/public/screenshots/扫描.png)

### 方案确认

整理方案生成后，可以在执行前查看结构预览、待处理项和确认入口。

![整理方案确认](./frontend/public/screenshots/整理页.png)

## 下载安装

### 推荐路径：使用桌面版

普通用户建议直接下载 Windows 桌面安装包，不需要先跑源码。

前往 [GitHub Releases](https://github.com/qup1010/FilePilot/releases) 下载最新版本。

你需要准备：

- Windows 10 / 11 环境
- 一组可用的 OpenAI-compatible 文本模型接口（如 OpenAI、DeepSeek、本地 Ollama 等）
- 对应的 API Key

如果你更偏好源码运行，可以参考下方的[源码运行](#源码运行)章节。

## 首次配置

桌面版在设置页中直接配置模型接口。源码运行时，复制 `config.example.json` 为 `config.json` 并填入你的信息：

```json
{
  "text_presets": {
    "default": {
      "name": "默认文本模型",
      "OPENAI_BASE_URL": "https://api.openai.com/v1",
      "OPENAI_MODEL": "gpt-4o",
      "OPENAI_API_KEY": "sk-your-key-here"
    }
  },
  "active_text_preset_id": "default"
}
```

你至少需要配置文本模型的 `base_url`、`model` 和 `api_key`。

- 仅配置文本模型即可使用完整的扫描、规划、预检、执行、回退链路
- 图片理解默认关闭，开启后可以复用文本模型或单独配置

> **注意**：`config.json` 不会提交到版本控制。`config.example.json` 和 `.env.example` 只是示例，不要在其中保存真实密钥。

## 最小使用流程

1. 打开桌面版或本地工作台。
2. 配置文本模型接口并测试连通性。
3. 选择一个测试目录，建议先用下载目录副本或临时样本目录。
4. 选择整理方式：
   - 想建立新分类，选“生成新的分类结构”
   - 想归入现有目录，选“归入已有目录”
5. 等待扫描和方案生成。
6. 在执行前查看预检结果。
7. 确认无误后输入大写 `YES` 执行。
8. 如有需要，可查看执行日志或使用最近一次回退。

## 文件会发到哪里

FilePilot 的工作台和执行逻辑在本地运行，但在扫描分析和规划阶段，相关文件名、目录信息以及必要的文件内容摘要可能会发送到你自己配置的外部模型接口。

这意味着：

- 你需要自行判断所选目录是否适合交给外部模型分析
- 敏感目录、工作中的私有项目目录、系统目录不建议直接使用
- 作者不提供托管模型服务，也不代管你的 API Key

## 源码运行

如果你是开发者，或者想在 release 之外自行运行：

### 1. 安装依赖

```bash
pip install -r requirements.txt

cd frontend && npm install
cd ../desktop && npm install
```

### 2. 启动本地 API

```bash
python -m file_pilot.api
```

默认地址：`http://127.0.0.1:8765`

### 3. 启动前端工作台

```bash
cd frontend
npm run dev
```

### 4. 启动桌面壳（需要 Rust 环境）

```bash
cd desktop
npm run tauri:dev
```

## 开发者入口

- 前端工作台说明：[frontend/README.md](./frontend/README.md)
- Tauri 桌面宿主说明：[desktop/README.md](./desktop/README.md)
- 设计系统规范：[DESIGN.md](./DESIGN.md)

## License

[MIT](./LICENSE)

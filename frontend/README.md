# Frontend Workbench

这是 File Organizer 桌面工作台前端，基于 Next.js + React，负责承接会话启动、扫描、方案调整、预检、执行结果与回退等主要桌面整理流程。

## 桌面体验优先

- 这个前端最终运行在 Tauri 桌面壳里，设计和实现时应默认按桌面工作台思考，而不是按网页落地页或通用 SaaS 页面思考。
- 页面应优先服务任务连续性、信息密度、分栏协作和长时间操作稳定性，不要先追求网页式“首屏氛围”。
- 优先使用稳定的应用框架结构，例如工具栏、侧栏、主工作区、详情区、状态区，而不是居中单列内容流。
- 避免引入网页式 hero、超大宣传区、漂浮卡片堆叠、强展示型动效和偏营销化文案。
- 做响应式时优先适配桌面窗口缩放与窄宽度，不要把“移动端网页体验”当成默认目标。
- 具体视觉和交互判断以根目录 [DESIGN.md](../DESIGN.md) 为准，尤其是“桌面级建筑式工作台”的结构原则。

## 当前状态

- 已有首页启动台、工作区、历史页、设置页等主要工作台路由。
- 前端会优先读取 `window.__FILE_ORGANIZER_RUNTIME__.base_url`，没有时回退到 `NEXT_PUBLIC_API_BASE_URL`，最后才用本地默认值。
- API client 已接入本地 `/api/sessions/*` 端点。
- SSE client 已按 `GET /api/sessions/{session_id}/events` 接入会话事件流。
- 当前前端已围绕真实 `session_snapshot`、扫描进度、预检结果和执行结果进行状态渲染，不再只是骨架或 mock 页面。
- 在桌面模式下，Tauri 会负责拉起后端并向前端注入运行时地址。

## 运行

先安装依赖，再启动开发服务器：

```bash
cd frontend
npm install
npm run dev
```

类型检查：

```bash
npm run typecheck
```

## 运行时发现与 Tauri 接线约定

Tauri 或其他宿主只需要向页面注入一个全局对象：

```ts
window.__FILE_ORGANIZER_RUNTIME__ = {
 base_url: "http://127.0.0.1:8765",
};
```

前端不会猜测端口，也不会直接解析后端 stdout。

当桌面壳注入运行时地址时，前端会优先使用该地址；未注入时才回退到环境变量或本地默认值。

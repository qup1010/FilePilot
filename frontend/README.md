# Frontend Workbench

这是 FilePilot 的本地工作台前端，基于 Next.js 15 + React 19，主要负责：

- 新建整理任务
- 承接 `/workspace` 整理工作区
- 展示 `/history` 历史记录与回退入口
- 提供 `/settings` 统一设置页
- 承接 `/icons` 图标工坊界面

## 设计原则

- 这是桌面工作台前端，不是网页落地页。
- 设计与实现时优先考虑窗口化、多分区、信息密度和长时间稳定操作。
- 优先使用工具栏、侧栏、主工作区、详情区、状态区等桌面应用结构。
- 避免 hero、大横幅、营销式漂浮卡片和偏 SaaS dashboard 的页面语言。
- 视觉与交互基线以根目录 [DESIGN.md](../DESIGN.md) 为准。

## 当前覆盖范围

- 首页启动流已经围绕“先选来源，再决定去向，再展开高级配置”组织
- 工作区承接真实 `session_snapshot`、扫描进度、计划预览、预检结果、执行结果
- 历史页支持查看执行记录并触发回退
- 设置页承接模型配置、启动默认值与部分运行时设置
- 图标工坊支持文件夹图标的扫描、生成、筛选、应用与恢复

## 主要路由

- `/`：新建任务入口
- `/workspace`：整理工作区
- `/history`：整理历史与回退入口
- `/settings`：模型、默认值和调试设置
- `/icons`：图标工坊

## 本目录开发

```powershell
Set-Location frontend
npm install
npm run dev
```

常用检查：

```powershell
npm run typecheck
npm run lint
npm test
```

根目录 [README.md](../README.md) 提供统一的项目启动方式和跨目录工作流，这里只保留前端特有约定。

## 运行时发现与 Tauri 接线

前端读取后端地址的优先级是：

1. `window.__FILE_PILOT_RUNTIME__.base_url`
2. `NEXT_PUBLIC_API_BASE_URL`
3. 本地默认值

如果桌面壳注入了 `window.__FILE_PILOT_RUNTIME__.api_token`，前端会自动携带该 token 访问受保护接口和 SSE。

宿主注入格式：

```ts
window.__FILE_PILOT_RUNTIME__ = {
  base_url: "http://127.0.0.1:8765",
  api_token: "optional-token",
};
```

前端不会猜测后端端口，也不会直接解析后端 stdout。

## 开发约定

- 改动 `session_snapshot`、事件流或 API schema 时，要同步检查 `src/types/*`、API client 和对应渲染组件
- 改动启动页时，保持“先来源、再去向、最后高级配置”的产品顺序
- 改动 placement 相关 UI 时，保持“设置页配默认，任务页可覆盖，Review 默认跟随新目录根”的一致性
- 改动桌面兼容逻辑时，优先读取 `window.__FILE_PILOT_RUNTIME__`，不要新增并行端口发现机制
- 提交前至少运行 `npm run typecheck`；涉及复杂交互、状态同步或图标工坊时，补跑 `npm test`

## 联调提醒

- 后端默认地址是 `http://127.0.0.1:8765`，但桌面壳场景始终以运行时注入值为准
- 如果工作区没有拿到数据，优先检查：
  - `output/runtime/backend.json`
  - 后端 `GET /api/health`
  - 桌面壳是否成功注入 `window.__FILE_PILOT_RUNTIME__`

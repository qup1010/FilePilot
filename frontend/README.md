# Frontend Workbench

这是 File Organizer 桌面 MVP 的前端骨架，基于 Next.js + React，先把页面结构、`session_snapshot` 类型、统一 API client 和 SSE client 预留出来。

## 当前状态

- 已有 `Home`、`Workspace`、`Precheck`、`Completed` 四个基础路由。
- 前端会优先读取 `window.__FILE_ORGANIZER_RUNTIME__.base_url`，没有时回退到 `NEXT_PUBLIC_API_BASE_URL`，最后才用本地默认值。
- API client 已按计划里的 `/api/sessions/*` 端点命名。
- SSE client 已按 `GET /api/sessions/{session_id}/events` 约定封装。
- 现在仍然使用 mock `session_snapshot`，还没有真正接 Python 后端或 Tauri 宿主。

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

## Tauri 接线约定

未来 Tauri 只需要向页面注入一个全局对象：

```ts
window.__FILE_ORGANIZER_RUNTIME__ = {
  base_url: "http://127.0.0.1:8765",
};
```

这个骨架不会猜测端口，也不会直接解析后端 stdout。

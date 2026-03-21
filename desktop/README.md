# Desktop Integration

这个目录放桌面宿主相关文件，当前已经具备一套最小可运行的 Tauri 壳：

- `src-tauri/`
  - 守护本地 Python FastAPI 子进程
  - 通过 `output/runtime/backend.json` 发现后端地址
  - 把 `window.__FILE_ORGANIZER_RUNTIME__` 注入给前端
- `package.json`
  - 提供 `npm run tauri:dev`
  - 提供 `npm run tauri:build`
- `runtime/backend.json.example`
  - 说明前后端共享的运行时文件结构

## 当前运行方式

1. 先确保 `frontend/` 依赖已安装。
2. 在 `desktop/` 目录安装 Tauri CLI 依赖：
   - `npm install`
3. 在 `desktop/` 目录启动桌面开发模式：
   - `npm run tauri:dev`

Tauri 启动后会：

- 先拉起 `python -m file_organizer.api`
- 等待 `output/runtime/backend.json`
- 将其中的 `base_url` 注入到前端窗口

前端读取入口固定为：

```ts
window.__FILE_ORGANIZER_RUNTIME__.base_url
```

## 运行时契约

后端地址发现只允许通过：

- `output/runtime/backend.json`

最小字段包括：

- `base_url`
- `host`
- `port`
- `pid`
- `started_at`

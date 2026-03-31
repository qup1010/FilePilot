# Desktop Integration

这个目录放桌面宿主相关文件，当前已经具备一套可运行的 Tauri 桌面壳。

## 当前职责

- 开发态拉起本地 `python -m file_organizer.api`
- 打包态拉起随应用分发的 `file_organizer_api.exe`
- 通过 `output/runtime/backend.json` 发现并校验后端实例
- 向前端注入 `window.__FILE_ORGANIZER_RUNTIME__`
- 提供目录选择、批量目录选择、文件夹图标应用 / 恢复、抠图测试等原生命令

## 目录说明

- `src-tauri/`
  - `src/backend.rs`：后端子进程拉起与管理
  - `src/runtime.rs`：运行时文件读取、健康校验、前端注入脚本
  - `src/icon_apply.rs`：Windows 文件夹图标应用 / 恢复
  - `src/bg_removal.rs`：抠图相关原生命令
- `package.json`
  - `npm run tauri:dev`
  - `npm run tauri:build`
- `runtime/backend.json.example`
  - 说明前后端共享的运行时文件结构

## 当前运行方式

```powershell
Set-Location desktop
npm install
npm run tauri:dev
```

## GitHub Actions 打包

- 仓库提供了一个仅支持手动触发的 Windows 打包工作流：
  - `.github/workflows/windows-desktop-bundle.yml`
- 触发后会在 GitHub Actions 中完成：
  - 安装 `frontend/` 与 `desktop/` 的 Node 依赖
  - 安装根目录 `requirements.txt`、`fastapi`、`uvicorn`、`pyinstaller`
  - 构建 `file_organizer_api.exe`
  - 执行 `npm run tauri:build`
  - 上传 Windows bundle 产物为 `filepilot-windows-bundle` artifact

Tauri 启动后会：

1. 开发态拉起 `python -m file_organizer.api`，打包态拉起内置的 `file_organizer_api.exe`
2. 等待 `output/runtime/backend.json`
3. 通过 `/api/health` 校验实例归属与健康状态
4. 向前端注入运行时对象

前端读取入口固定为：

```ts
window.__FILE_ORGANIZER_RUNTIME__
```

当前注入字段至少包括：

- `base_url`
- `host`
- `port`
- `pid`
- `started_at`
- `instance_id`
- `api_token`

## 运行时契约

后端地址发现只允许通过：

- `output/runtime/backend.json`

该文件当前包含的最小字段包括：

- `base_url`
- `host`
- `port`
- `pid`
- `started_at`
- `instance_id`

## 当前限制

- 这个 workflow 当前只构建 Windows 包。
- 打包产物会携带桌面壳和内置 Python 后端，但仍需要在真实 Windows 环境进一步验证安装、首次启动和回退链路。

# Desktop Integration

这个目录放 FilePilot 的 Tauri 桌面宿主，负责把本地 FastAPI 后端和前端工作台接成一个可分发的 Windows 桌面应用。

## 当前职责

- 开发态拉起本地 `python -m file_pilot.api`
- 打包态拉起随应用分发的 `file_pilot_api.exe`
- 打包态后端以后台方式启动，不向用户显示额外终端窗口
- 打包态优先使用动态空闲端口，避免与固定 `8765` 冲突
- 保持单实例运行，重复启动时激活已有窗口
- 通过 `output/runtime/backend.json` 发现并校验后端实例
- 向前端注入 `window.__FILE_PILOT_RUNTIME__`
- 提供目录选择、文件选择、图标应用 / 恢复、抠图测试等原生命令

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
  - 前后端共享运行时文件结构示例

## 本目录开发

```powershell
Set-Location desktop
npm install
npm run tauri:dev
```

单独验证 Rust 编译检查：

```powershell
Set-Location desktop\src-tauri
cargo check
```

根目录 [README.md](../README.md) 提供统一的启动方式和跨目录开发流程，这里只保留桌面宿主特有说明。

## 运行时契约

前端读取入口固定为：

```ts
window.__FILE_PILOT_RUNTIME__
```

当前注入字段至少包括：

- `base_url`
- `host`
- `port`
- `pid`
- `started_at`
- `instance_id`
- `api_token`

后端地址发现只允许通过：

- `output/runtime/backend.json`

该文件当前最小字段包括：

- `base_url`
- `host`
- `port`
- `pid`
- `started_at`
- `instance_id`

补充说明：

- `api_token` 只存在于桌面壳注入给前端的 `window.__FILE_PILOT_RUNTIME__`，不会写入 `output/runtime/backend.json`
- 桌面壳会同时校验 runtime 文件中的 `instance_id` 与 `GET /api/health` 返回值，避免误连到旧实例或其他本地进程
- 如果调整这部分契约，需要同时检查：
  - `file_pilot/api/runtime.py`
  - `frontend/src/lib/*`
  - `desktop/src-tauri/src/runtime.rs`

## GitHub Actions 打包

- 仓库提供 Windows 桌面打包工作流：
  - `.github/workflows/windows-desktop-bundle.yml`
- 工作流会完成：
  - 安装 `frontend/` 与 `desktop/` 的 Node 依赖
  - 安装根目录 Python 依赖与打包依赖
  - 构建 `file_pilot_api.exe`
  - 执行 `npm run tauri:build`
  - 静默安装 MSI 并执行 smoke test
  - 上传 Windows bundle artifact
- 当前支持两种触发方式：
  - GitHub Actions 页面手动触发
  - 推送 `v*` tag 后自动创建 Release

推荐发版顺序：

1. 同步更新桌面版本号
2. 提交版本变更
3. 创建并推送 tag

可用命令：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\set_desktop_version.ps1 -Version 0.1.1
```

或：

```powershell
npm --prefix desktop run version:set -- 0.1.1
```

## 安装包 Smoke 验证

本地安装桌面应用后，可直接对安装目录中的桌面可执行文件运行 smoke 脚本。当前可执行文件名通常与 Rust 包名一致，例如 `file-pilot-desktop.exe`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\smoke_desktop_bundle.ps1 -AppPath "C:\Users\<User>\AppData\Local\Programs\FilePilot\file-pilot-desktop.exe"
```

脚本会验证：

1. 启动后能生成运行时文件并通过 `/api/health`
2. 安装包态默认未落在固定端口 `8765`
3. 重复启动时不会常驻第二个桌面实例
4. 关闭桌面应用后，`file_pilot_api.exe` 会退出
5. 再次启动后仍能恢复正常工作

## 当前限制

- 当前只构建 Windows 包
- 桌面端仍保留两个原生来源选择能力：`选择文件`、`选择文件夹`
- 目前不要假设 Tauri / `rfd` 已经支持单次原生混选文件和文件夹

## 排查建议

- 启动后前端空白或连不上后端时，先检查 `output/runtime/backend.json` 是否生成
- 如果运行时文件存在，再看 `logs/backend/runtime.log` 和 `GET /api/health` 是否正常
- 如果开发态拉起失败，优先确认 Python、Node.js、Rust / Cargo 是否可用，以及根目录 Python 依赖是否已安装

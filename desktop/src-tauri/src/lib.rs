mod desktop_ini;
mod icon_apply;
mod backend;
mod runtime;
mod bg_removal;

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{App, Manager, RunEvent};
use serde::Serialize;
use tauri_plugin_notification::NotificationExt;

const APP_USER_MODEL_ID: &str = "com.filepilot.desktop";

use crate::icon_apply::{
    apply_folder_icon,
    apply_ready_icons,
    can_restore_folder_icon,
    clear_folder_icon,
    restore_last_folder_icon,
    restore_ready_icons,
};

#[tauri::command]
fn pick_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn pick_directories() -> Option<Vec<String>> {
    rfd::FileDialog::new().pick_folders().map(|paths| {
        paths
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    })
}

#[tauri::command]
fn pick_files() -> Option<Vec<String>> {
    rfd::FileDialog::new().pick_files().map(|paths| {
        paths
            .into_iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect()
    })
}

#[derive(Serialize)]
struct InspectedPath {
    path: String,
    is_dir: bool,
    is_file: bool,
    error_code: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
struct DirectoryEntry {
    path: String,
    is_dir: bool,
    is_file: bool,
}

#[derive(Serialize)]
struct InspectPathsResult {
    ok: bool,
    items: Vec<InspectedPath>,
    ignored_count: usize,
    error_code: Option<String>,
    message: Option<String>,
}

#[derive(Serialize)]
struct DirectoryEntriesResult {
    ok: bool,
    items: Vec<DirectoryEntry>,
    ignored_count: usize,
    error_code: Option<String>,
    message: Option<String>,
}

fn io_error_code(error: &io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "NOT_FOUND",
        io::ErrorKind::PermissionDenied => "PERMISSION_DENIED",
        io::ErrorKind::AlreadyExists => "ALREADY_EXISTS",
        io::ErrorKind::InvalidInput => "INVALID_INPUT",
        io::ErrorKind::TimedOut => "TIMED_OUT",
        io::ErrorKind::Interrupted => "INTERRUPTED",
        _ => "IO_ERROR",
    }
    .to_string()
}

#[tauri::command]
fn inspect_paths(paths: Vec<String>) -> InspectPathsResult {
    let mut ignored_count = 0;
    let mut items = Vec::new();
    for path in paths {
        match fs::metadata(&path) {
            Ok(metadata) => items.push(InspectedPath {
                path,
                is_dir: metadata.is_dir(),
                is_file: metadata.is_file(),
                error_code: None,
                message: None,
            }),
            Err(error) => {
                ignored_count += 1;
                items.push(InspectedPath {
                    path,
                    is_dir: false,
                    is_file: false,
                    error_code: Some(io_error_code(&error)),
                    message: Some(error.to_string()),
                });
            }
        }
    }

    InspectPathsResult {
        ok: true,
        items,
        ignored_count,
        error_code: None,
        message: None,
    }
}

#[tauri::command]
fn list_directory_entries(path: String) -> DirectoryEntriesResult {
    let directory = PathBuf::from(&path);
    let entries = match fs::read_dir(&directory) {
        Ok(entries) => entries,
        Err(error) => {
            return DirectoryEntriesResult {
                ok: false,
                items: Vec::new(),
                ignored_count: 0,
                error_code: Some(io_error_code(&error)),
                message: Some(format!("failed to read directory {}: {error}", directory.display())),
            }
        }
    };

    let mut ignored_count = 0;
    let mut result: Vec<DirectoryEntry> = Vec::new();
    for entry_result in entries {
        let entry = match entry_result {
            Ok(entry) => entry,
            Err(_) => {
                ignored_count += 1;
                continue;
            }
        };
        let file_name = entry.file_name();
        let name = file_name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => {
                ignored_count += 1;
                continue;
            }
        };
        result.push(DirectoryEntry {
            path: path.to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            is_file: metadata.is_file(),
        });
    }

    result.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });

    DirectoryEntriesResult {
        ok: true,
        items: result,
        ignored_count,
        error_code: None,
        message: None,
    }
}

#[tauri::command]
fn save_file_as(source_path: String, filename: String) -> Result<bool, String> {
    let save_path = rfd::FileDialog::new()
        .set_file_name(&filename)
        .add_filter("PNG Image", &["png"])
        .save_file();

    if let Some(dest) = save_path {
        fs::copy(&source_path, &dest).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn open_directory(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // On Windows, using /select opens the parent folder and highlights the item
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        // On macOS, -R flag in open command reveals it in Finder
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        // For linux, just open the parent for now if it's a folder, or the path directly
        let _ = std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn();
    }
    Ok(())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(&["/C", "start", "", &url])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg(&url)
            .spawn();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn();
    }
    Ok(())
}

fn show_desktop_notification_inner(app: &tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("notification title is required".to_string());
    }

    let mut builder = app.notification().builder().title(title);
    let body = body.trim();
    if !body.is_empty() {
        builder = builder.body(body);
    }

    builder.show().map_err(|error| error.to_string())
}

#[tauri::command]
fn show_desktop_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    show_desktop_notification_inner(&app, title, body)
}

#[tauri::command]
fn show_desktop_notification_when_away(app: tauri::AppHandle, title: String, body: String) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_minimized = window.is_minimized().unwrap_or(false);
        let is_focused = window.is_focused().unwrap_or(false);
        if is_focused && !is_minimized {
            return Ok(false);
        }
    }

    show_desktop_notification_inner(&app, title, body)?;
    Ok(true)
}

#[cfg(windows)]
fn ensure_windows_notification_identity(_app: &App) -> Result<(), String> {
    use windows_registry::CURRENT_USER;
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;

    let exe_path = std::env::current_exe()
        .map_err(|error| format!("failed to resolve current executable: {error}"))?;
    let key = CURRENT_USER
        .create(format!(r"SOFTWARE\Classes\AppUserModelId\{APP_USER_MODEL_ID}"))
        .map_err(|error| format!("failed to create AppUserModelId registry key: {error}"))?;
    key.set_string("DisplayName", "FilePilot")
        .map_err(|error| format!("failed to set notification display name: {error}"))?;
    key.set_string("IconUri", &exe_path.to_string_lossy())
        .map_err(|error| format!("failed to set notification icon uri: {error}"))?;
    key.set_string("IconBackgroundColor", "0")
        .map_err(|error| format!("failed to set notification icon background: {error}"))?;

    let app_id: Vec<u16> = APP_USER_MODEL_ID.encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe { SetCurrentProcessExplicitAppUserModelID(app_id.as_ptr()) };
    if result < 0 {
        return Err(format!("failed to set process AppUserModelID: HRESULT 0x{result:08X}"));
    }

    Ok(())
}

#[cfg(not(windows))]
fn ensure_windows_notification_identity(_app: &App) -> Result<(), String> {
    Ok(())
}


struct DesktopState {
    project_root: PathBuf,
    backend_executable: Option<PathBuf>,
    backend_process: Mutex<Option<backend::ManagedBackendProcess>>,
    runtime_script: Mutex<Option<String>>,
    injected_runtime: Mutex<Option<runtime::InjectedRuntimeConfig>>,
}

impl DesktopState {
    fn new(project_root: PathBuf, backend_executable: Option<PathBuf>) -> Self {
        Self {
            project_root,
            backend_executable,
            backend_process: Mutex::new(None),
            runtime_script: Mutex::new(None),
            injected_runtime: Mutex::new(None),
        }
    }

    fn set_backend_process(&self, process: backend::ManagedBackendProcess) {
        let mut guard = self.backend_process.lock().expect("backend process lock");
        *guard = Some(process);
    }

    fn set_runtime_script(&self, script: String) {
        let mut guard = self.runtime_script.lock().expect("runtime script lock");
        *guard = Some(script);
    }

    fn set_injected_runtime(&self, runtime_config: runtime::InjectedRuntimeConfig) {
        let mut guard = self.injected_runtime.lock().expect("injected runtime lock");
        *guard = Some(runtime_config);
    }

    fn runtime_script(&self) -> Option<String> {
        self.runtime_script.lock().expect("runtime script lock").clone()
    }

    fn injected_runtime(&self) -> Option<runtime::InjectedRuntimeConfig> {
        self.injected_runtime.lock().expect("injected runtime lock").clone()
    }

    fn stop_backend(&self) {
        if let Some(mut process) = self.backend_process.lock().expect("backend process lock").take() {
            let _ = backend::terminate_backend_process(&mut process);
        }
    }
}

fn resolve_project_root() -> PathBuf {
    if let Some(project_root) = std::env::var_os("FILE_PILOT_PROJECT_ROOT") {
        return PathBuf::from(project_root);
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("project root should exist above desktop/src-tauri")
        .to_path_buf()
}

fn resolve_bundled_backend_executable(app: &App) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("failed to resolve resource dir: {error}"))?;
    let candidates = [
        resource_dir.join("backend").join("file_pilot_api.exe"),
        resource_dir.join("file_pilot_api.exe"),
    ];

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!(
                "bundled backend executable was not found under {}",
                resource_dir.display()
            )
        })
}

fn resolve_desktop_state(app: &App) -> Result<DesktopState, String> {
    if tauri::is_dev() {
        let project_root = resolve_project_root();
        return Ok(DesktopState::new(project_root, None));
    }

    let project_root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
    fs::create_dir_all(&project_root)
        .map_err(|error| format!("failed to create app data dir {}: {error}", project_root.display()))?;
    let backend_executable = resolve_bundled_backend_executable(app)?;
    Ok(DesktopState::new(project_root, Some(backend_executable)))
}

fn bootstrap_backend(app: &App) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    let runtime_path = runtime::backend_runtime_path(&state.project_root);
    if runtime_path.exists() {
        match runtime::read_runtime_config(&runtime_path) {
            Ok(config) if runtime::runtime_file_is_owned_by_active_backend(&config, Duration::from_millis(250)) => {
                return Err(format!(
                    "runtime file {} is already owned by an active backend instance",
                    runtime_path.display()
                ));
            }
            Ok(_) | Err(_) => {
                fs::remove_file(&runtime_path).map_err(|error| {
                    format!("failed to clear stale runtime file {}: {error}", runtime_path.display())
                })?;
            }
        }
    }

    let launch = backend::start_backend(&state.project_root, state.backend_executable.as_deref())?;
    // On Windows dev runs, `python` may be a launcher or venv shim whose child id
    // differs from the actual API process id written by the backend. The instance
    // id plus health check below is the stable ownership signal for both dev and
    // bundled modes.
    let expected_pid = None;
    let expected_instance_id = launch.instance_id.clone();
    let api_token = launch.api_token.clone();
    let mut process = launch.process;
    let config = match runtime::wait_for_runtime_config(
        &runtime_path,
        Duration::from_secs(20),
        expected_pid,
        &expected_instance_id,
    ) {
        Ok(config) => config,
        Err(error) => {
            let _ = backend::terminate_backend_process(&mut process);
            return Err(error);
        }
    };

    let script = runtime::build_runtime_injection_script(&config, &api_token);
    let injected_runtime = runtime::build_injected_runtime_config(&config, &api_token);
    state.set_backend_process(process);
    state.set_runtime_script(script.clone());
    state.set_injected_runtime(injected_runtime);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval(&script);
    }

    Ok(())
}

fn rehydrate_runtime(webview: &tauri::Webview) {
    let state = webview.app_handle().state::<DesktopState>();
    if let Some(script) = state.runtime_script() {
        let _ = webview.eval(&script);
    }
}

#[tauri::command]
fn get_runtime_config(app: tauri::AppHandle) -> Option<runtime::InjectedRuntimeConfig> {
    let state = app.state::<DesktopState>();
    state.injected_runtime()
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
struct SecondaryLaunchAction {
    should_show: bool,
    should_unminimize: bool,
    should_focus: bool,
}

impl SecondaryLaunchAction {
    fn from_window_state(window_exists: bool, is_minimized: bool) -> Self {
        Self {
            should_show: window_exists,
            should_unminimize: window_exists && is_minimized,
            should_focus: window_exists,
        }
    }
}

fn focus_existing_main_window(app_handle: &tauri::AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };

    let action = SecondaryLaunchAction::from_window_state(true, window.is_minimized().unwrap_or(false));
    if action.should_show {
        let _ = window.show();
    }
    if action.should_unminimize {
        let _ = window.unminimize();
    }
    if action.should_focus {
        let _ = window.set_focus();
    }
}

#[cfg(test)]
mod tests {
    use super::SecondaryLaunchAction;

    #[test]
    fn secondary_launch_marks_existing_window_for_focus() {
        let action = SecondaryLaunchAction::from_window_state(true, true);

        assert!(action.should_show);
        assert!(action.should_unminimize);
        assert!(action.should_focus);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            focus_existing_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pick_directory,
            pick_directories,
            pick_files,
            inspect_paths,
            list_directory_entries,
            open_directory,
            open_url,
            save_file_as,
            show_desktop_notification,
            show_desktop_notification_when_away,
            get_runtime_config,
            apply_folder_icon,
            apply_ready_icons,
            clear_folder_icon,
            can_restore_folder_icon,
            restore_last_folder_icon,
            restore_ready_icons,
            crate::bg_removal::remove_background_for_image,
            crate::bg_removal::test_bg_removal_connection
        ])
        .setup(|app| {
            if let Err(error) = ensure_windows_notification_identity(app) {
                eprintln!("failed to prepare Windows notification identity: {error}");
            }
            let state = resolve_desktop_state(app)?;
            std::env::set_var("FILE_PILOT_PROJECT_ROOT", &state.project_root);
            app.manage(state);
            bootstrap_backend(app).map_err(Into::into)
        })
        .on_page_load(|window, _| {
            rehydrate_runtime(window);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                let state = app_handle.state::<DesktopState>();
                state.stop_backend();
            }
        });
}

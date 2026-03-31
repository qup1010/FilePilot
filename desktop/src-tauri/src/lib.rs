mod desktop_ini;
mod icon_apply;
mod backend;
mod runtime;
mod bg_removal;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{App, Manager, RunEvent};

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


struct DesktopState {
    project_root: PathBuf,
    backend_executable: Option<PathBuf>,
    backend_child: Mutex<Option<Child>>,
    runtime_script: Mutex<Option<String>>,
}

impl DesktopState {
    fn new(project_root: PathBuf, backend_executable: Option<PathBuf>) -> Self {
        Self {
            project_root,
            backend_executable,
            backend_child: Mutex::new(None),
            runtime_script: Mutex::new(None),
        }
    }

    fn set_backend_child(&self, child: Child) {
        let mut guard = self.backend_child.lock().expect("backend child lock");
        *guard = Some(child);
    }

    fn set_runtime_script(&self, script: String) {
        let mut guard = self.runtime_script.lock().expect("runtime script lock");
        *guard = Some(script);
    }

    fn runtime_script(&self) -> Option<String> {
        self.runtime_script.lock().expect("runtime script lock").clone()
    }

    fn stop_backend(&self) {
        if let Some(mut child) = self.backend_child.lock().expect("backend child lock").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn resolve_project_root() -> PathBuf {
    if let Some(project_root) = std::env::var_os("FILE_ORGANIZER_PROJECT_ROOT") {
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
        resource_dir.join("backend").join("file_organizer_api.exe"),
        resource_dir.join("file_organizer_api.exe"),
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
    let expected_pid = launch.child.id();
    let expected_instance_id = launch.instance_id.clone();
    let api_token = launch.api_token.clone();
    let mut child = launch.child;
    let config = match runtime::wait_for_runtime_config(
        &runtime_path,
        Duration::from_secs(20),
        expected_pid,
        &expected_instance_id,
    ) {
        Ok(config) => config,
        Err(error) => {
            let _ = child.kill();
            return Err(error);
        }
    };

    let script = runtime::build_runtime_injection_script(&config, &api_token);
    state.set_backend_child(child);
    state.set_runtime_script(script.clone());

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            pick_directory,
            pick_directories,
            open_directory,
            save_file_as,
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
            let state = resolve_desktop_state(app)?;
            std::env::set_var("FILE_ORGANIZER_PROJECT_ROOT", &state.project_root);
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

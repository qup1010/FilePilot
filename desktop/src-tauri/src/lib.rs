mod backend;
mod runtime;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{App, Manager, RunEvent};

struct DesktopState {
    project_root: PathBuf,
    backend_child: Mutex<Option<Child>>,
    runtime_script: Mutex<Option<String>>,
}

impl DesktopState {
    fn new(project_root: PathBuf) -> Self {
        Self {
            project_root,
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

    let launch = backend::start_backend(&state.project_root)?;
    let expected_pid = launch.child.id();
    let expected_instance_id = launch.instance_id.clone();
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

    let script = runtime::build_runtime_injection_script(&config);
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
    let project_root = resolve_project_root();

    tauri::Builder::default()
        .manage(DesktopState::new(project_root))
        .setup(|app| {
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

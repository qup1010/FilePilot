use std::env;
use std::path::Path;
use std::process::{Child, Command};

use uuid::Uuid;

const DEFAULT_API_HOST: &str = "127.0.0.1";
const DEFAULT_API_PORT: &str = "8765";

pub struct BackendLaunch {
    pub child: Child,
    pub instance_id: String,
    pub api_token: String,
}

pub fn build_backend_command(
    project_root: &Path,
    api_token: &str,
    backend_executable: Option<&Path>,
) -> Command {
    let host = env::var("FILE_ORGANIZER_API_HOST").unwrap_or_else(|_| DEFAULT_API_HOST.to_string());
    let port = env::var("FILE_ORGANIZER_API_PORT").unwrap_or_else(|_| DEFAULT_API_PORT.to_string());
    let base_url = env::var("FILE_ORGANIZER_API_BASE_URL")
        .unwrap_or_else(|_| format!("http://{host}:{port}"));

    let mut command = if let Some(executable) = backend_executable {
        Command::new(executable)
    } else {
        let python = env::var("FILE_ORGANIZER_PYTHON").unwrap_or_else(|_| "python".to_string());
        let mut command = Command::new(python);
        command.arg("-m").arg("file_organizer.api");
        command
    };
    command
        .current_dir(project_root)
        .env("PYTHONUTF8", "1")
        // Tauri dev 自己已经负责桌面侧热重载；这里禁用 uvicorn reload，
        // 避免额外的 reloader 进程导致 runtime 文件 owner 与实际服务实例不一致。
        .env("FILE_ORGANIZER_API_RELOAD", "false")
        .env("FILE_ORGANIZER_API_HOST", &host)
        .env("FILE_ORGANIZER_API_PORT", &port)
        .env("FILE_ORGANIZER_API_BASE_URL", &base_url)
        .env("FILE_ORGANIZER_PROJECT_ROOT", project_root)
        .env("FILE_ORGANIZER_API_TOKEN", api_token);
    command
}

pub fn start_backend(project_root: &Path, backend_executable: Option<&Path>) -> Result<BackendLaunch, String> {
    validate_backend_port()?;
    let instance_id = Uuid::new_v4().to_string();
    let api_token = Uuid::new_v4().to_string();
    let mut command = build_backend_command(project_root, &api_token, backend_executable);
    command.env("FILE_ORGANIZER_INSTANCE_ID", &instance_id);
    let child = command
        .spawn()
        .map_err(|error| format!("failed to launch backend: {error}"))?;
    Ok(BackendLaunch {
        child,
        instance_id,
        api_token,
    })
}

fn validate_backend_port() -> Result<(), String> {
    if let Ok(value) = env::var("FILE_ORGANIZER_API_PORT") {
        value
            .parse::<u16>()
            .map_err(|_| format!("invalid FILE_ORGANIZER_API_PORT: {value}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{build_backend_command, validate_backend_port};
    use std::env;
    use std::path::Path;

    #[test]
    fn backend_command_uses_python_module_entrypoint() {
        let command = build_backend_command(Path::new("D:/repo"), "test-token", None);
        let args = command.get_args().map(|value| value.to_string_lossy().to_string()).collect::<Vec<_>>();

        assert_eq!(args, vec!["-m".to_string(), "file_organizer.api".to_string()]);
    }

    #[test]
    fn backend_command_runs_from_project_root_and_sets_runtime_env() {
        let command = build_backend_command(Path::new("D:/repo"), "test-token", None);
        let envs = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|entry| entry.to_string_lossy().to_string()),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(command.get_current_dir(), Some(Path::new("D:/repo")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_ORGANIZER_API_HOST" && value.as_deref() == Some("127.0.0.1")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_ORGANIZER_API_PORT" && value.as_deref() == Some("8765")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_ORGANIZER_API_RELOAD" && value.as_deref() == Some("false")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_ORGANIZER_PROJECT_ROOT" && value.as_deref() == Some("D:/repo")));
        assert!(envs.iter().any(|(key, value)| {
            key == "FILE_ORGANIZER_API_BASE_URL" && value.as_deref() == Some("http://127.0.0.1:8765")
        }));
        assert!(envs.iter().any(|(key, value)| key == "FILE_ORGANIZER_API_TOKEN" && value.as_deref() == Some("test-token")));
    }

    #[test]
    fn backend_command_can_launch_bundled_backend_executable() {
        let command = build_backend_command(
            Path::new("D:/runtime"),
            "test-token",
            Some(Path::new("D:/bundle/backend/file_organizer_api.exe")),
        );
        let args = command
            .get_args()
            .map(|value| value.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        let envs = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|entry| entry.to_string_lossy().to_string()),
                )
            })
            .collect::<Vec<_>>();

        assert_eq!(
            command.get_program().to_string_lossy(),
            "D:/bundle/backend/file_organizer_api.exe"
        );
        assert!(args.is_empty(), "bundled backend should not receive python module args");
        assert_eq!(command.get_current_dir(), Some(Path::new("D:/runtime")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_ORGANIZER_PROJECT_ROOT" && value.as_deref() == Some("D:/runtime")));
    }

    #[test]
    fn validate_backend_port_rejects_non_numeric_values() {
        let previous = env::var("FILE_ORGANIZER_API_PORT").ok();
        env::set_var("FILE_ORGANIZER_API_PORT", "not-a-port");

        let error = validate_backend_port().expect_err("invalid port should fail");
        assert!(error.contains("invalid FILE_ORGANIZER_API_PORT"));

        if let Some(value) = previous {
            env::set_var("FILE_ORGANIZER_API_PORT", value);
        } else {
            env::remove_var("FILE_ORGANIZER_API_PORT");
        }
    }
}

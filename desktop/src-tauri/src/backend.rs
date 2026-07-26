use std::env;
use std::net::TcpListener;
use std::path::Path;
use std::process::{Child, Command};

use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
use std::os::windows::io::AsRawHandle;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, JobObjectExtendedLimitInformation,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

const DEFAULT_API_HOST: &str = "127.0.0.1";
const DEFAULT_API_PORT: &str = "8765";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendRuntimeConfig {
    pub host: String,
    pub port: u16,
    pub base_url: String,
}

pub struct BackendLaunch {
    pub process: ManagedBackendProcess,
    pub instance_id: String,
    pub api_token: String,
}

pub struct ManagedBackendProcess {
    child: Child,
    #[cfg(target_os = "windows")]
    job: Option<BackendJob>,
}

impl ManagedBackendProcess {
    fn new(child: Child) -> Result<Self, String> {
        #[cfg(target_os = "windows")]
        {
            let job = attach_backend_process_to_job(&child)?;
            Ok(Self {
                child,
                job: Some(job),
            })
        }

        #[cfg(not(target_os = "windows"))]
        {
            Ok(Self { child })
        }
    }

    #[cfg(test)]
    pub fn id(&self) -> u32 {
        self.child.id()
    }
}

#[cfg(target_os = "windows")]
struct BackendJob(HANDLE);

#[cfg(target_os = "windows")]
unsafe impl Send for BackendJob {}

#[cfg(target_os = "windows")]
unsafe impl Sync for BackendJob {}

#[cfg(target_os = "windows")]
impl Drop for BackendJob {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
fn attach_backend_process_to_job(child: &Child) -> Result<BackendJob, String> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job == std::ptr::null_mut() {
            return Err(format!(
                "failed to create backend job object: {}",
                GetLastError()
            ));
        }

        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
            BasicLimitInformation: std::mem::zeroed(),
            IoInfo: std::mem::zeroed(),
            ProcessMemoryLimit: 0,
            JobMemoryLimit: 0,
            PeakProcessMemoryUsed: 0,
            PeakJobMemoryUsed: 0,
        };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let info_size = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            info_size,
        ) == 0
        {
            let error = GetLastError();
            CloseHandle(job);
            return Err(format!(
                "failed to configure backend job object: {}",
                error
            ));
        }

        if AssignProcessToJobObject(job, child.as_raw_handle() as HANDLE) == 0 {
            let error = GetLastError();
            CloseHandle(job);
            return Err(format!(
                "failed to assign backend process {} to job object: {}",
                child.id(),
                error
            ));
        }

        Ok(BackendJob(job))
    }
}

pub fn terminate_backend_process(process: &mut ManagedBackendProcess) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        process.job.take();
    }

    #[cfg(not(target_os = "windows"))]
    {
        process
            .child
            .kill()
            .map_err(|error| format!("failed to kill backend process {}: {error}", process.child.id()))?;
    }

    process
        .child
        .wait()
        .map_err(|error| format!("failed to wait for backend process {}: {error}", process.child.id()))?;
    Ok(())
}

pub fn should_hide_backend_window(backend_executable: Option<&Path>) -> bool {
    backend_executable.is_some()
}

pub fn resolve_backend_runtime_config(backend_executable: Option<&Path>) -> Result<BackendRuntimeConfig, String> {
    let host = env::var("FILE_PILOT_API_HOST").unwrap_or_else(|_| DEFAULT_API_HOST.to_string());

    if let Ok(value) = env::var("FILE_PILOT_API_PORT") {
        let port = value
            .parse::<u16>()
            .map_err(|_| format!("invalid FILE_PILOT_API_PORT: {value}"))?;
        let base_url = env::var("FILE_PILOT_API_BASE_URL")
            .unwrap_or_else(|_| format!("http://{host}:{port}"));
        return Ok(BackendRuntimeConfig {
            host,
            port,
            base_url,
        });
    }

    if backend_executable.is_none() {
        let preferred = DEFAULT_API_PORT
            .parse::<u16>()
            .expect("default backend port should be numeric");
        // 默认端口可能被其他软件占用（例如 AnkiConnect 同样监听 8765）。
        // 开发模式优先保持默认端口以便固定调试地址，占用时顺延到空闲端口，
        // 实际地址通过 backend.json 传给桌面壳与前端，不影响链路。
        let port = match TcpListener::bind((host.as_str(), preferred)) {
            Ok(listener) => {
                drop(listener);
                preferred
            }
            Err(_) => reserve_ephemeral_port(&host)?,
        };
        return Ok(BackendRuntimeConfig {
            host: host.clone(),
            port,
            base_url: format!("http://{host}:{port}"),
        });
    }

    let port = reserve_ephemeral_port(&host)?;

    Ok(BackendRuntimeConfig {
        host: host.clone(),
        port,
        base_url: format!("http://{host}:{port}"),
    })
}

fn reserve_ephemeral_port(host: &str) -> Result<u16, String> {
    let listener = TcpListener::bind((host, 0))
        .map_err(|error| format!("failed to reserve backend port for {host}: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("failed to resolve reserved backend port for {host}: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

pub fn build_backend_command(
    project_root: &Path,
    api_token: &str,
    backend_executable: Option<&Path>,
) -> Command {
    let runtime_config = resolve_backend_runtime_config(backend_executable)
        .expect("backend runtime config should resolve before command construction");

    let mut command = if let Some(executable) = backend_executable {
        Command::new(executable)
    } else {
        let python = env::var("FILE_PILOT_PYTHON").unwrap_or_else(|_| "python".to_string());
        let mut command = Command::new(python);
        command.arg("-m").arg("file_pilot.api");
        command
    };
    command
        .current_dir(project_root)
        .env("PYTHONUTF8", "1")
        // Tauri dev 自己已经负责桌面侧热重载；这里禁用 uvicorn reload，
        // 避免额外的 reloader 进程导致 runtime 文件 owner 与实际服务实例不一致。
        .env("FILE_PILOT_API_RELOAD", "false")
        .env("FILE_PILOT_API_HOST", &runtime_config.host)
        .env("FILE_PILOT_API_PORT", runtime_config.port.to_string())
        .env("FILE_PILOT_API_BASE_URL", &runtime_config.base_url)
        .env("FILE_PILOT_PROJECT_ROOT", project_root)
        .env("FILE_PILOT_API_TOKEN", api_token);
    configure_backend_command(&mut command, backend_executable);
    command
}

fn configure_backend_command(command: &mut Command, backend_executable: Option<&Path>) {
    #[cfg(target_os = "windows")]
    if should_hide_backend_window(backend_executable) {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub fn start_backend(project_root: &Path, backend_executable: Option<&Path>) -> Result<BackendLaunch, String> {
    validate_backend_port()?;
    let instance_id = Uuid::new_v4().to_string();
    let api_token = Uuid::new_v4().to_string();
    let mut command = build_backend_command(project_root, &api_token, backend_executable);
    command.env("FILE_PILOT_INSTANCE_ID", &instance_id);
    let child = command
        .spawn()
        .map_err(|error| format!("failed to launch backend: {error}"))?;
    let process = ManagedBackendProcess::new(child)?;
    Ok(BackendLaunch {
        process,
        instance_id,
        api_token,
    })
}

fn validate_backend_port() -> Result<(), String> {
    if let Ok(value) = env::var("FILE_PILOT_API_PORT") {
        value
            .parse::<u16>()
            .map_err(|_| format!("invalid FILE_PILOT_API_PORT: {value}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_backend_command, resolve_backend_runtime_config, should_hide_backend_window, terminate_backend_process,
        validate_backend_port, ManagedBackendProcess,
    };
    use std::io::{BufRead, BufReader};
    use std::env;
    use std::net::TcpListener;
    use std::path::Path;
    use std::process::{Command, Stdio};
    use std::sync::{Mutex, MutexGuard, OnceLock};
    use std::time::Duration;

    /// FILE_PILOT_API_* 是进程级环境变量，读写它们的测试必须串行，
    /// 否则并行执行时会互相看到对方的临时值。
    fn env_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn restore_env(key: &str, previous: Option<String>) {
        match previous {
            Some(value) => env::set_var(key, value),
            None => env::remove_var(key),
        }
    }

    #[cfg(target_os = "windows")]
    fn process_is_running(pid: u32) -> bool {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!("try {{ Get-Process -Id {pid} -ErrorAction Stop | Out-Null; exit 0 }} catch {{ exit 1 }}"),
            ])
            .status()
            .expect("powershell should run")
            .success()
    }

    #[test]
    fn backend_command_uses_python_module_entrypoint() {
        let _guard = env_lock();
        let previous_port = env::var("FILE_PILOT_API_PORT").ok();
        env::remove_var("FILE_PILOT_API_PORT");

        let command = build_backend_command(Path::new("D:/repo"), "test-token", None);
        let args = command.get_args().map(|value| value.to_string_lossy().to_string()).collect::<Vec<_>>();

        assert_eq!(args, vec!["-m".to_string(), "file_pilot.api".to_string()]);

        restore_env("FILE_PILOT_API_PORT", previous_port);
    }

    #[test]
    fn backend_runtime_config_prefers_default_port_in_dev_mode() {
        let _guard = env_lock();
        let previous_port = env::var("FILE_PILOT_API_PORT").ok();
        let previous_base_url = env::var("FILE_PILOT_API_BASE_URL").ok();
        env::remove_var("FILE_PILOT_API_PORT");
        env::remove_var("FILE_PILOT_API_BASE_URL");

        // 默认端口空闲时使用 8765；被其他软件（如 AnkiConnect）占用时顺延到空闲端口。
        let default_port_free = TcpListener::bind(("127.0.0.1", 8765)).is_ok();
        let config = resolve_backend_runtime_config(None).expect("runtime config");

        if default_port_free {
            assert_eq!(config.port, 8765);
        } else {
            assert_ne!(config.port, 8765);
            assert!(config.port > 0);
        }
        assert_eq!(config.base_url, format!("http://127.0.0.1:{}", config.port));

        if let Some(value) = previous_port {
            env::set_var("FILE_PILOT_API_PORT", value);
        } else {
            env::remove_var("FILE_PILOT_API_PORT");
        }
        if let Some(value) = previous_base_url {
            env::set_var("FILE_PILOT_API_BASE_URL", value);
        } else {
            env::remove_var("FILE_PILOT_API_BASE_URL");
        }
    }

    #[test]
    fn backend_runtime_config_falls_back_when_default_port_is_taken() {
        let _guard = env_lock();
        let previous_port = env::var("FILE_PILOT_API_PORT").ok();
        let previous_base_url = env::var("FILE_PILOT_API_BASE_URL").ok();
        env::remove_var("FILE_PILOT_API_PORT");
        env::remove_var("FILE_PILOT_API_BASE_URL");

        // 只有默认端口当前空闲时才能可靠地模拟"被占用"场景。
        let blocker = TcpListener::bind(("127.0.0.1", 8765)).ok();
        if blocker.is_some() {
            let config = resolve_backend_runtime_config(None).expect("runtime config");
            assert_ne!(config.port, 8765, "occupied default port should fall back");
            assert_eq!(config.base_url, format!("http://127.0.0.1:{}", config.port));
        }
        drop(blocker);

        if let Some(value) = previous_port {
            env::set_var("FILE_PILOT_API_PORT", value);
        } else {
            env::remove_var("FILE_PILOT_API_PORT");
        }
        if let Some(value) = previous_base_url {
            env::set_var("FILE_PILOT_API_BASE_URL", value);
        } else {
            env::remove_var("FILE_PILOT_API_BASE_URL");
        }
    }

    #[test]
    fn backend_runtime_config_picks_ephemeral_port_for_bundled_mode() {
        let _guard = env_lock();
        let previous_port = env::var("FILE_PILOT_API_PORT").ok();
        let previous_base_url = env::var("FILE_PILOT_API_BASE_URL").ok();
        env::remove_var("FILE_PILOT_API_PORT");
        env::remove_var("FILE_PILOT_API_BASE_URL");

        let config = resolve_backend_runtime_config(Some(Path::new("D:/bundle/backend/file_pilot_api.exe")))
            .expect("runtime config");

        assert_ne!(config.port, 8765);
        assert!(config.port > 0);
        assert_eq!(config.base_url, format!("http://127.0.0.1:{}", config.port));

        if let Some(value) = previous_port {
            env::set_var("FILE_PILOT_API_PORT", value);
        } else {
            env::remove_var("FILE_PILOT_API_PORT");
        }
        if let Some(value) = previous_base_url {
            env::set_var("FILE_PILOT_API_BASE_URL", value);
        } else {
            env::remove_var("FILE_PILOT_API_BASE_URL");
        }
    }

    #[test]
    fn backend_command_runs_from_project_root_and_sets_runtime_env() {
        let _guard = env_lock();
        let previous_port = env::var("FILE_PILOT_API_PORT").ok();
        let previous_base_url = env::var("FILE_PILOT_API_BASE_URL").ok();
        env::remove_var("FILE_PILOT_API_PORT");
        env::remove_var("FILE_PILOT_API_BASE_URL");

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
        assert!(envs.iter().any(|(key, value)| key == "FILE_PILOT_API_HOST" && value.as_deref() == Some("127.0.0.1")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_PILOT_API_RELOAD" && value.as_deref() == Some("false")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_PILOT_PROJECT_ROOT" && value.as_deref() == Some("D:/repo")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_PILOT_API_TOKEN" && value.as_deref() == Some("test-token")));

        // 端口取决于默认端口是否空闲（可能被 AnkiConnect 等占用），因此只校验 base_url 与之一致。
        let port = envs
            .iter()
            .find_map(|(key, value)| (key == "FILE_PILOT_API_PORT").then(|| value.clone()).flatten())
            .expect("port env should be set");
        assert!(envs.iter().any(|(key, value)| {
            key == "FILE_PILOT_API_BASE_URL" && value.as_deref() == Some(&format!("http://127.0.0.1:{port}"))
        }));

        restore_env("FILE_PILOT_API_PORT", previous_port);
        restore_env("FILE_PILOT_API_BASE_URL", previous_base_url);
    }

    #[test]
    fn backend_command_can_launch_bundled_backend_executable() {
        let command = build_backend_command(
            Path::new("D:/runtime"),
            "test-token",
            Some(Path::new("D:/bundle/backend/file_pilot_api.exe")),
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
            "D:/bundle/backend/file_pilot_api.exe"
        );
        assert!(args.is_empty(), "bundled backend should not receive python module args");
        assert_eq!(command.get_current_dir(), Some(Path::new("D:/runtime")));
        assert!(envs.iter().any(|(key, value)| key == "FILE_PILOT_PROJECT_ROOT" && value.as_deref() == Some("D:/runtime")));
    }

    #[test]
    fn bundled_backend_requests_hidden_window_but_python_mode_does_not() {
        assert!(!should_hide_backend_window(None));
        assert!(should_hide_backend_window(Some(Path::new(
            "D:/bundle/backend/file_pilot_api.exe"
        ))));
    }

    #[test]
    fn validate_backend_port_rejects_non_numeric_values() {
        let _guard = env_lock();
        let previous = env::var("FILE_PILOT_API_PORT").ok();
        env::set_var("FILE_PILOT_API_PORT", "not-a-port");

        let error = validate_backend_port().expect_err("invalid port should fail");
        assert!(error.contains("invalid FILE_PILOT_API_PORT"));

        restore_env("FILE_PILOT_API_PORT", previous);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn terminate_backend_process_stops_spawned_process_tree() {
        let parent = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "$child = Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 60' -PassThru; Write-Output $child.Id; Start-Sleep -Seconds 60",
            ])
            .stdout(Stdio::piped())
            .spawn()
            .expect("parent process should launch");
        let mut process = ManagedBackendProcess::new(parent).expect("managed backend process should be created");

        let stdout = process.child.stdout.take().expect("stdout pipe should be available");
        let mut reader = BufReader::new(stdout);
        let mut child_pid_line = String::new();
        reader
            .read_line(&mut child_pid_line)
            .expect("child pid should be written");
        let child_pid = child_pid_line
            .trim()
            .parse::<u32>()
            .expect("child pid should be numeric");

        std::thread::sleep(Duration::from_millis(400));
        assert!(process_is_running(process.id()), "parent process should still be running before termination");
        assert!(process_is_running(child_pid), "child process should still be running before termination");

        terminate_backend_process(&mut process).expect("process tree termination should succeed");

        std::thread::sleep(Duration::from_millis(400));
        assert!(!process_is_running(process.id()), "parent process should be terminated");
        assert!(!process_is_running(child_pid), "child process should be terminated with parent tree");
    }
}

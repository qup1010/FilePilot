use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DesktopRuntimeConfig {
    pub base_url: String,
    pub host: String,
    pub port: u16,
    pub pid: u32,
    pub started_at: String,
    #[serde(default)]
    pub instance_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DesktopHealthPayload {
    status: String,
    #[serde(default)]
    instance_id: Option<String>,
}

pub fn backend_runtime_path(project_root: &Path) -> PathBuf {
    project_root.join("output").join("runtime").join("backend.json")
}

pub fn read_runtime_config(path: &Path) -> Result<DesktopRuntimeConfig, String> {
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("failed to read runtime config {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("failed to parse runtime config {}: {error}", path.display()))
}

pub fn build_runtime_injection_script(config: &DesktopRuntimeConfig) -> String {
    let payload =
        serde_json::to_string(config).expect("serializing desktop runtime config should not fail");
    format!(
        "window.__FILE_ORGANIZER_RUNTIME__ = Object.freeze({payload});"
    )
}

pub fn wait_for_runtime_config(
    path: &Path,
    timeout: Duration,
    expected_pid: u32,
    expected_instance_id: &str,
) -> Result<DesktopRuntimeConfig, String> {
    let deadline = Instant::now() + timeout;
    let mut last_error = format!("runtime file {} was not created", path.display());

    loop {
        match read_runtime_config(path) {
            Ok(config) => {
                if config.pid != expected_pid {
                    last_error = format!(
                        "runtime file {} belongs to unexpected pid {}",
                        path.display(),
                        config.pid
                    );
                } else if config.instance_id.as_deref() != Some(expected_instance_id) {
                    last_error = format!(
                        "runtime file {} belongs to unexpected instance",
                        path.display()
                    );
                } else if backend_reports_expected_instance(&config, expected_instance_id, Duration::from_millis(250)) {
                    return Ok(config);
                } else {
                    last_error = format!("backend {} did not pass health verification", config.base_url);
                }
            }
            Err(error) => {
                last_error = error;
            }
        }

        if Instant::now() >= deadline {
            return Err(last_error);
        }

        thread::sleep(Duration::from_millis(200));
    }
}

pub fn backend_reports_expected_instance(
    config: &DesktopRuntimeConfig,
    expected_instance_id: &str,
    timeout: Duration,
) -> bool {
    let mut stream = match connect_backend(config, timeout) {
        Some(stream) => stream,
        None => return false,
    };

    if stream
        .write_all(
            format!(
                "GET /api/health HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
                config.host, config.port
            )
            .as_bytes(),
        )
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    let Some((_, body)) = response.split_once("\r\n\r\n") else {
        return false;
    };

    serde_json::from_str::<DesktopHealthPayload>(body)
        .map(|payload| payload.status == "ok" && payload.instance_id.as_deref() == Some(expected_instance_id))
        .unwrap_or(false)
}

pub fn runtime_file_is_owned_by_active_backend(config: &DesktopRuntimeConfig, timeout: Duration) -> bool {
    let Some(instance_id) = config.instance_id.as_deref() else {
        return false;
    };
    backend_reports_expected_instance(config, instance_id, timeout)
}

fn connect_backend(config: &DesktopRuntimeConfig, timeout: Duration) -> Option<TcpStream> {
    (config.host.as_str(), config.port)
        .to_socket_addrs()
        .ok()
        .and_then(|addresses| {
            addresses
                .into_iter()
                .find_map(|address| TcpStream::connect_timeout(&address, timeout).ok())
        })
}

#[cfg(test)]
mod tests {
    use super::{
        backend_reports_expected_instance, backend_runtime_path, build_runtime_injection_script, read_runtime_config,
        runtime_file_is_owned_by_active_backend, wait_for_runtime_config, DesktopRuntimeConfig,
    };
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn backend_runtime_path_points_to_output_runtime_backend_json() {
        let root = tempfile::tempdir().expect("tempdir");
        let path = backend_runtime_path(root.path());

        assert!(path.ends_with("output/runtime/backend.json"));
    }

    #[test]
    fn read_runtime_config_parses_backend_json() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("backend.json");
        fs::write(
            &path,
            r#"{"base_url":"http://127.0.0.1:8765","host":"127.0.0.1","port":8765,"pid":1234,"started_at":"2026-03-21T00:00:00Z","instance_id":"desktop-instance"}"#,
        )
        .expect("write backend json");

        let config = read_runtime_config(&path).expect("runtime config");

        assert_eq!(config.base_url, "http://127.0.0.1:8765");
        assert_eq!(config.port, 8765);
        assert_eq!(config.instance_id.as_deref(), Some("desktop-instance"));
    }

    #[test]
    fn build_runtime_injection_script_contains_window_runtime_assignment() {
        let config = DesktopRuntimeConfig {
            base_url: "http://127.0.0.1:8765".into(),
            host: "127.0.0.1".into(),
            port: 8765,
            pid: 1234,
            started_at: "2026-03-21T00:00:00Z".into(),
            instance_id: Some("desktop-instance".into()),
        };

        let script = build_runtime_injection_script(&config);

        assert!(script.contains("window.__FILE_ORGANIZER_RUNTIME__"));
        assert!(script.contains("http://127.0.0.1:8765"));
    }

    #[test]
    fn read_runtime_config_returns_error_for_invalid_json() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("backend.json");
        fs::write(&path, "{invalid").expect("write backend json");

        let error = read_runtime_config(&path).expect_err("invalid json should fail");

        assert!(error.contains("failed to parse runtime config"));
    }

    #[test]
    fn wait_for_runtime_config_waits_until_backend_health_matches_instance() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("backend.json");
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let port = listener.local_addr().expect("listener addr").port();
        let pid = 1234;
        let instance_id = "desktop-instance";

        let server = thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buffer = [0_u8; 512];
                let _ = stream.read(&mut buffer);
                let response = concat!(
                    "HTTP/1.1 200 OK\r\n",
                    "Content-Type: application/json\r\n",
                    "Connection: close\r\n",
                    "\r\n"
                );
                let body = format!(r#"{{"status":"ok","instance_id":"{instance_id}"}}"#);
                let _ = stream.write_all(format!("{response}{body}").as_bytes());
            }
        });

        fs::write(
            &path,
            format!(
                r#"{{"base_url":"http://127.0.0.1:{port}","host":"127.0.0.1","port":{port},"pid":{pid},"started_at":"2026-03-21T00:00:00Z","instance_id":"{instance_id}"}}"#
            ),
        )
        .expect("write backend json");

        let config = wait_for_runtime_config(&path, Duration::from_secs(1), pid, instance_id)
            .expect("runtime config");
        assert_eq!(config.port, port);
        server.join().expect("server thread");
    }

    #[test]
    fn backend_reports_expected_instance_checks_health_payload() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind listener");
        let port = listener.local_addr().expect("listener addr").port();
        let config = DesktopRuntimeConfig {
            base_url: format!("http://127.0.0.1:{port}"),
            host: "127.0.0.1".into(),
            port,
            pid: 1234,
            started_at: "2026-03-21T00:00:00Z".into(),
            instance_id: Some("desktop-instance".into()),
        };

        let server = thread::spawn(move || {
            for _ in 0..2 {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut buffer = [0_u8; 512];
                    let _ = stream.read(&mut buffer);
                    let response = concat!(
                        "HTTP/1.1 200 OK\r\n",
                        "Content-Type: application/json\r\n",
                        "Connection: close\r\n",
                        "\r\n",
                        "{\"status\":\"ok\",\"instance_id\":\"desktop-instance\"}"
                    );
                    let _ = stream.write_all(response.as_bytes());
                }
            }
        });

        assert!(backend_reports_expected_instance(
            &config,
            "desktop-instance",
            Duration::from_secs(1)
        ));
        assert!(runtime_file_is_owned_by_active_backend(&config, Duration::from_secs(1)));
        server.join().expect("server thread");
    }
}

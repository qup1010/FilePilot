use serde::Serialize;
use serde_json::Value;
use std::io;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeCommandError<'a> {
    code: &'a str,
    params: Value,
    detail: String,
}

pub fn encode_native_command_error(code: &str, params: Value, detail: impl Into<String>) -> String {
    serde_json::to_string(&NativeCommandError {
        code,
        params,
        detail: detail.into(),
    })
    .unwrap_or_else(|_| r#"{"code":"TAURI_OPERATION_FAILED","params":{},"detail":""}"#.to_string())
}

pub fn io_failure_code(error: &io::Error) -> &'static str {
    match error.kind() {
        io::ErrorKind::NotFound => "TAURI_PATH_NOT_FOUND",
        io::ErrorKind::PermissionDenied => "TAURI_PERMISSION_DENIED",
        _ => "TAURI_OPERATION_FAILED",
    }
}

#[cfg(test)]
mod tests {
    use super::{encode_native_command_error, io_failure_code};
    use serde_json::json;
    use std::io;

    #[test]
    fn native_error_payload_keeps_code_params_and_diagnostic_detail() {
        let encoded = encode_native_command_error(
            "TAURI_PATH_NOT_FOUND",
            json!({ "path": "D:/missing" }),
            "No such file or directory",
        );
        let payload: serde_json::Value = serde_json::from_str(&encoded).expect("valid error JSON");

        assert_eq!(payload["code"], "TAURI_PATH_NOT_FOUND");
        assert_eq!(payload["params"]["path"], "D:/missing");
        assert_eq!(payload["detail"], "No such file or directory");
    }

    #[test]
    fn native_io_failures_use_stable_codes() {
        assert_eq!(
            io_failure_code(&io::Error::from(io::ErrorKind::PermissionDenied)),
            "TAURI_PERMISSION_DENIED"
        );
        assert_eq!(
            io_failure_code(&io::Error::from(io::ErrorKind::NotFound)),
            "TAURI_PATH_NOT_FOUND"
        );
    }
}

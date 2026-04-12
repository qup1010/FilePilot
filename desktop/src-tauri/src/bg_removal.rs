use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use reqwest::{multipart, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::time::Duration;



pub static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(120))
        .pool_idle_timeout(Duration::from_secs(300))
        .pool_max_idle_per_host(10)
        .build()
        .expect("Failed to create global HTTP client")
});

pub fn get_http_client() -> &'static Client {
    &HTTP_CLIENT
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundRemovalConfig {
    pub model_id: String,
    pub api_type: String,
    pub payload_template: String,
    pub api_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BgRemovalTestResult {
    pub status: String,
    pub message: String,
}

pub struct BgRemovalClient;

impl BgRemovalClient {
    pub async fn remove_background(
        config: &BackgroundRemovalConfig,
        image_bytes: &[u8],
    ) -> Result<Vec<u8>, String> {
        match config.api_type.trim() {
            "gradio_space" => Self::call_gradio_api(config, image_bytes).await,
            other => Err(format!("不支持的抠图 API 类型: {other}")),
        }
    }

    pub async fn test_connection(config: &BackgroundRemovalConfig) -> Result<BgRemovalTestResult, String> {
        let test_image_bytes = Self::generate_test_png_10x10();
        Self::remove_background(config, &test_image_bytes).await?;
        Ok(BgRemovalTestResult {
            status: "ok".to_string(),
            message: "抠图服务连接测试已通过 (10x10 测试图)。".to_string(),
        })
    }

    fn generate_test_png_10x10() -> Vec<u8> {
        use image::{ImageFormat, RgbaImage};
        use std::io::Cursor;
        let img = RgbaImage::from_fn(10, 10, |_, _| image::Rgba([255, 255, 255, 255]));
        let mut buffer = Cursor::new(Vec::new());
        img.write_to(&mut buffer, ImageFormat::Png).ok();
        buffer.into_inner()
    }

    fn build_base_url(model_id: &str) -> Result<String, String> {
        let parts: Vec<&str> = model_id.split('/').collect();
        if parts.len() == 2 {
            let user = parts[0].replace('.', "-");
            let space = parts[1].replace('.', "-");
            Ok(format!("https://{}-{}.hf.space", user, space))
        } else {
            Err(format!("无效的 Space ID: {}", model_id))
        }
    }

    fn render_template_string(template: &str, uploaded_path: &str, model_id: &str) -> String {
        template
            .replace("{{uploaded_path}}", uploaded_path)
            .replace("{{model_id}}", model_id)
    }

    fn render_template_value(value: Value, uploaded_path: &str, model_id: &str) -> Value {
        match value {
            Value::String(text) => Value::String(Self::render_template_string(&text, uploaded_path, model_id)),
            Value::Array(items) => Value::Array(
                items
                    .into_iter()
                    .map(|item| Self::render_template_value(item, uploaded_path, model_id))
                    .collect(),
            ),
            Value::Object(map) => {
                let mut next = Map::new();
                for (key, value) in map {
                    next.insert(key, Self::render_template_value(value, uploaded_path, model_id));
                }
                Value::Object(next)
            }
            other => other,
        }
    }

    fn build_join_payload(
        config: &BackgroundRemovalConfig,
        uploaded_path: &str,
        session_hash: &str,
    ) -> Result<Value, String> {
        let template = config.payload_template.trim();
        if template.is_empty() {
            return Err("payload_template 不能为空".to_string());
        }
        let parsed: Value =
            serde_json::from_str(template).map_err(|error| format!("payload_template 不是合法 JSON: {error}"))?;
        let rendered = Self::render_template_value(parsed, uploaded_path, &config.model_id);
        let mut object = rendered
            .as_object()
            .cloned()
            .ok_or_else(|| "payload_template 须为 JSON 对象".to_string())?;
        object.insert(
            "session_hash".to_string(),
            Value::String(session_hash.to_string()),
        );
        object.insert("trigger_id".to_string(), json!(rand::random::<u32>()));
        if !object.contains_key("fn_index") {
            object.insert("fn_index".to_string(), json!(0));
        }
        Ok(Value::Object(object))
    }

    async fn upload_file(
        client: &reqwest::Client,
        base_url: &str,
        image_bytes: &[u8],
        api_token: Option<&str>,
    ) -> Result<String, String> {
        let upload_url = format!("{}/upload", base_url);

        let part = multipart::Part::bytes(image_bytes.to_vec())
            .file_name("image.png")
            .mime_str("image/png")
            .map_err(|e| format!("创建上传数据失败: {}", e))?;

        let form = multipart::Form::new().part("files", part);

        let mut request = client.post(&upload_url).multipart(form);
        if let Some(token) = api_token {
            if !token.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("上传文件网络失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("上传文件接口失败 {}: {}", status, error_text));
        }

        let upload_result: Vec<String> = response
            .json()
            .await
            .map_err(|e| format!("解析上传响应失败: {}", e))?;

        if upload_result.is_empty() {
            return Err("上传响应为空".to_string());
        }

        Ok(upload_result[0].clone())
    }

    async fn call_gradio_api(
        config: &BackgroundRemovalConfig,
        image_bytes: &[u8],
    ) -> Result<Vec<u8>, String> {
        let base_url = Self::build_base_url(&config.model_id)?;
        let client = get_http_client();

        let uploaded_path =
            Self::upload_file(client, &base_url, image_bytes, config.api_token.as_deref()).await?;

        let session_hash = format!("{:x}", rand::random::<u64>());
        let queue_join_url = format!("{}/queue/join", base_url);
        let join_payload = Self::build_join_payload(config, &uploaded_path, &session_hash)?;

        let mut request = client
            .post(&queue_join_url)
            .header("Content-Type", "application/json")
            .json(&join_payload);

        if let Some(ref token) = config.api_token {
            if !token.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("加入队列失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(format!("加入队列错误 {}: {}", status, error_text));
        }

        let queue_data_url = format!("{}/queue/data?session_hash={}", base_url, session_hash);
        Self::poll_queue_sse(client, &queue_data_url, &base_url, config.api_token.as_deref()).await
    }

    async fn poll_queue_sse(
        client: &reqwest::Client,
        url: &str,
        base_url: &str,
        api_token: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let mut request = client
            .get(url)
            .header("Accept", "text/event-stream")
            .header("Cache-Control", "no-cache");

        if let Some(token) = api_token {
            if !token.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }

        let mut response = request
            .send()
            .await
            .map_err(|e| format!("发起 SSE 请求失败: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let err_text = response.text().await.unwrap_or_default();
            return Err(format!("获取队列状态失败 {}: {}", status, err_text));
        }

        let mut buffer = String::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("读取流数据块失败: {}", e))?
        {
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(line_end) = buffer.find('\n') {
                let line = buffer[..line_end].trim().to_string();
                buffer.drain(..=line_end);

                if line.starts_with("data: ") {
                    let data_str = &line[6..];
                    if let Ok(data) = serde_json::from_str::<Value>(data_str) {
                        let msg = data.get("msg").and_then(|m| m.as_str()).unwrap_or("");
                        
                        match msg {
                            "process_completed" => {
                                if let Some(output) = data.get("output") {
                                    if let Some(output_data) = output.get("data").and_then(|d| d.as_array()) {
                                        for item in output_data {
                                            if let Some(img_bytes) = Self::extract_image_from_value(item, base_url).await {
                                                return Ok(img_bytes);
                                            }
                                        }
                                    }
                                }
                                return Err("任务已完成但未在响应中找到图像数据".to_string());
                            }
                            "process_starts" => {
                                // 可以增加进度回调或日志
                            }
                            "heartbeat" => {
                                // 忽略心跳
                            }
                            _ => {}
                        }
                    }
                }
            }
        }

        Err("流已意外中断且未收到完成消息".to_string())
    }

    async fn extract_image_from_value(v: &Value, base_url: &str) -> Option<Vec<u8>> {
        if let Some(s) = v.as_str() {
            if s.starts_with("data:image") {
                let parts: Vec<&str> = s.split(',').collect();
                if parts.len() == 2 {
                    if let Ok(bytes) = STANDARD.decode(parts[1]) {
                        return Some(bytes);
                    }
                }
            } else if s.starts_with("http") {
                if let Ok(bytes) = Self::download_url(s).await {
                    return Some(bytes);
                }
            } else if s.starts_with('/') {
                let full_url = format!("{}/file={}", base_url, s);
                if let Ok(bytes) = Self::download_url(&full_url).await {
                    return Some(bytes);
                }
            }
        }

        if let Some(obj) = v.as_object() {
            if let Some(url) = obj.get("url").and_then(|u| u.as_str()) {
                let full_url = if url.starts_with("http") {
                    url.to_string()
                } else {
                    format!("{}{}", base_url, url)
                };
                if let Ok(bytes) = Self::download_url(&full_url).await {
                    return Some(bytes);
                }
            }
            if let Some(path) = obj.get("path").and_then(|p| p.as_str()) {
                let full_url = if path.starts_with("http") {
                    path.to_string()
                } else {
                    format!("{}/file={}", base_url, path)
                };
                if let Ok(bytes) = Self::download_url(&full_url).await {
                    return Some(bytes);
                }
            }
        }

        if let Some(arr) = v.as_array() {
            for item in arr {
                if let Some(bytes) = Box::pin(Self::extract_image_from_value(item, base_url)).await {
                    return Some(bytes);
                }
            }
        }
        None
    }

    async fn download_url(url: &str) -> Result<Vec<u8>, String> {
        let client = get_http_client();
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("下载图像网络失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("下载结果图像失败: {}", resp.status()));
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("读取图像字节失败: {}", e))?;
        Ok(bytes.to_vec())
    }
}

#[tauri::command]
pub async fn remove_background_for_image(
    image_path: String,
    config: BackgroundRemovalConfig,
) -> Result<String, String> {
    let path = Path::new(&image_path);
    if !path.exists() {
        return Err(format!("原始图像不存在: {}", image_path));
    }

    let bytes = fs::read(path).map_err(|e| format!("读取原始图像失败: {}", e))?;
    let result_bytes = BgRemovalClient::remove_background(&config, &bytes).await?;
    
    // 转换为 Base64 字符串返回，大幅减少 IPC 传输 JSON 数组的开销
    let b64 = STANDARD.encode(&result_bytes);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[tauri::command]
pub async fn test_bg_removal_connection(
    config: BackgroundRemovalConfig,
) -> Result<BgRemovalTestResult, String> {
    BgRemovalClient::test_connection(&config).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_template_replaces_known_placeholders() {
        let rendered = BgRemovalClient::render_template_string(
            "{{model_id}}::{{uploaded_path}}",
            "/tmp/image.png",
            "user/space",
        );

        assert_eq!(rendered, "user/space::/tmp/image.png");
    }

    #[test]
    fn build_join_payload_renders_json_template() {
        let config = BackgroundRemovalConfig {
            model_id: "user/space".to_string(),
            api_type: "gradio_space".to_string(),
            payload_template: r#"{"data":[{"path":"{{uploaded_path}}","meta":{"label":"{{model_id}}"}}],"fn_index":2}"#
                .to_string(),
            api_token: Some("secret".to_string()),
        };

        let payload = BgRemovalClient::build_join_payload(&config, "/uploaded/file.png", "session-1")
            .expect("payload should render");

        assert_eq!(payload["data"][0]["path"], "/uploaded/file.png");
        assert_eq!(payload["data"][0]["meta"]["label"], "user/space");
        assert_eq!(payload["fn_index"], 2);
        assert_eq!(payload["session_hash"], "session-1");
        assert!(payload.get("trigger_id").is_some());
    }
}

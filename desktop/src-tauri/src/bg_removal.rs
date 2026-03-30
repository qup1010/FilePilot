use base64::{engine::general_purpose::STANDARD, Engine};
use once_cell::sync::Lazy;
use reqwest::{multipart, Client};
use serde_json::{json, Value};
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

#[derive(Debug)]
pub struct BackgroundRemovalConfig {
    pub model_id: String,
    pub api_token: Option<String>,
}

pub struct BgRemovalClient;

impl BgRemovalClient {
    pub async fn remove_background(
        config: &BackgroundRemovalConfig,
        image_bytes: &[u8],
    ) -> Result<Vec<u8>, String> {
        Self::call_gradio_api(config, image_bytes).await
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

        let file_obj = json!({
            "path": uploaded_path,
            "meta": {"_type": "gradio.FileData"}
        });

        let join_payload = json!({
            "data": [file_obj],
            "fn_index": 0,
            "session_hash": session_hash,
            "trigger_id": rand::random::<u32>()
        });

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

        let result =
            Self::poll_queue_sse(client, &queue_data_url, &base_url, config.api_token.as_deref()).await?;

        Ok(result)
    }

    async fn poll_queue_sse(
        client: &reqwest::Client,
        url: &str,
        base_url: &str,
        api_token: Option<&str>,
    ) -> Result<Vec<u8>, String> {
        let mut request = client.get(url);

        if let Some(token) = api_token {
            if !token.is_empty() {
                request = request.header("Authorization", format!("Bearer {}", token));
            }
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("获取队列状态失败: {}", e))?;

        if !response.status().is_success() {
            return Err(format!(
                "获取队列状态失败 {}: {}",
                response.status(),
                response.text().await.unwrap_or_default()
            ));
        }

        let body = response
            .text()
            .await
            .map_err(|e| format!("读取 SSE 流失败: {}", e))?;

        for line in body.lines() {
            if line.starts_with("data: ") {
                let data_str = &line[6..];
                if let Ok(data) = serde_json::from_str::<Value>(data_str) {
                    let msg = data.get("msg").and_then(|m| m.as_str()).unwrap_or("");
                    if msg == "process_completed" {
                        if let Some(output) = data.get("output") {
                            if let Some(output_data) = output.get("data").and_then(|d| d.as_array()) {
                                for item in output_data {
                                    if let Some(img_bytes) = Self::extract_image_from_value(item, base_url).await {
                                        return Ok(img_bytes);
                                    }
                                }
                            }
                        }
                        return Err("未在响应中找到有效的图像数据".to_string());
                    }
                }
            }
        }

        Err("SSE 流结束但未收到完成消息".to_string())
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
                let full_url = if url.starts_with("http") { url.to_string() } else { format!("{}{}", base_url, url) };
                if let Ok(bytes) = Self::download_url(&full_url).await {
                    return Some(bytes);
                }
            }
            if let Some(path) = obj.get("path").and_then(|p| p.as_str()) {
                let full_url = if path.starts_with("http") { path.to_string() } else { format!("{}/file={}", base_url, path) };
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
        let resp = client.get(url).send().await.map_err(|e| format!("下载图像网络失败: {}", e))?;
        if !resp.status().is_success() {
            return Err(format!("下载结果图像失败: {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| format!("读取图像字节失败: {}", e))?;
        Ok(bytes.to_vec())
    }
}

// ============ Tauri Commands ============

#[tauri::command]
pub async fn remove_background_for_image(
    image_path: String,
    api_token: Option<String>,
) -> Result<Vec<u8>, String> {
    let path = Path::new(&image_path);
    if !path.exists() {
        return Err(format!("原始图像不存在: {}", image_path));
    }
    
    let bytes = fs::read(path).map_err(|e| format!("读取原始图像失败: {}", e))?;
    
    // Default model to the highly accurate BRIA model
    let config = BackgroundRemovalConfig {
        model_id: "briaai/BRIA-RMBG-2.0".to_string(),
        api_token,
    };

    let processed_bytes = BgRemovalClient::remove_background(&config, &bytes).await?;
    
    Ok(processed_bytes)
}

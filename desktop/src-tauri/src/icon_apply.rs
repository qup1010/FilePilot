use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File};
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use image::ImageFormat;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::desktop_ini;

const ICON_FILE_NAME: &str = "file-pilot-icon.ico";
const BACKUP_MANIFEST_FILE_NAME: &str = "manifest.json";
const BACKUP_MANAGED_ICON_FILE_NAME: &str = "managed-icon.bin";
const BACKUP_ORIGINAL_ICON_FILE_NAME: &str = "original-icon.bin";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
struct IconBackupManifest {
    folder_path: String,
    desktop_ini_content: Option<String>,
    managed_icon_backup_name: Option<String>,
    original_icon_relative_path: Option<String>,
    original_icon_backup_name: Option<String>,
}

#[tauri::command]
pub fn apply_folder_icon(folder_path: String, image_path: String) -> Result<String, String> {
    ensure_windows()?;
    let save_mode = load_configured_save_mode();
    apply_folder_icon_impl(&folder_path, &image_path, &save_mode)?;
    Ok(format!("已将图标应用到文件夹: {}", folder_path))
}

#[tauri::command]
pub fn clear_folder_icon(folder_path: String) -> Result<String, String> {
    ensure_windows()?;
    clear_folder_icon_impl(&folder_path)?;
    Ok(format!("已恢复默认图标: {}", folder_path))
}

#[tauri::command]
pub fn can_restore_folder_icon(folder_path: String) -> Result<bool, String> {
    ensure_windows()?;
    let folder = Path::new(&folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("文件夹不存在: {}", folder_path));
    }
    Ok(folder_backup_dir(&folder_path)?.join(BACKUP_MANIFEST_FILE_NAME).exists())
}

#[tauri::command]
pub fn restore_last_folder_icon(folder_path: String) -> Result<String, String> {
    ensure_windows()?;
    restore_last_folder_icon_impl(&folder_path)?;
    Ok(format!("已恢复最近一次图标状态: {}", folder_path))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ApplyIconTask {
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub folder_path: String,
    pub image_path: String,
    pub save_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct RestoreIconTask {
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub folder_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ApplyIconResult {
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub folder_path: String,
    pub status: String,
    pub message: String,
}

#[tauri::command]
pub fn apply_ready_icons(tasks: Vec<ApplyIconTask>) -> Result<Vec<ApplyIconResult>, String> {
    ensure_windows()?;
    let mut results: Vec<ApplyIconResult> = Vec::new();
    for task in tasks {
        let save_mode = task.save_mode.as_deref().unwrap_or("in_folder");
        match apply_folder_icon_impl(&task.folder_path, &task.image_path, save_mode) {
            Ok(()) => results.push(ApplyIconResult {
                folder_id: task.folder_id.clone(),
                folder_name: task.folder_name.clone(),
                folder_path: task.folder_path.clone(),
                status: "applied".to_string(),
                message: format!("已应用图标: {}", task.folder_path),
            }),
            Err(error) => results.push(ApplyIconResult {
                folder_id: task.folder_id.clone(),
                folder_name: task.folder_name.clone(),
                folder_path: task.folder_path.clone(),
                status: "failed".to_string(),
                message: error,
            }),
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn restore_ready_icons(tasks: Vec<RestoreIconTask>) -> Result<Vec<ApplyIconResult>, String> {
    ensure_windows()?;
    let mut results: Vec<ApplyIconResult> = Vec::new();
    for task in tasks {
        match restore_last_folder_icon_impl(&task.folder_path) {
            Ok(()) => results.push(ApplyIconResult {
                folder_id: task.folder_id.clone(),
                folder_name: task.folder_name.clone(),
                folder_path: task.folder_path.clone(),
                status: "restored".to_string(),
                message: format!("已恢复最近一次图标状态: {}", task.folder_path),
            }),
            Err(error) => results.push(ApplyIconResult {
                folder_id: task.folder_id.clone(),
                folder_name: task.folder_name.clone(),
                folder_path: task.folder_path.clone(),
                status: "failed".to_string(),
                message: error,
            }),
        }
    }
    Ok(results)
}

fn ensure_windows() -> Result<(), String> {
    if cfg!(target_os = "windows") {
        Ok(())
    } else {
        Err("文件夹图标应用仅支持 Windows 桌面壳。".to_string())
    }
}

fn load_configured_save_mode() -> String {
    let project_root = std::env::var_os("FILE_PILOT_PROJECT_ROOT")
        .map(PathBuf::from)
        .or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .ancestors()
                .nth(2)
                .map(PathBuf::from)
        });
    let Some(project_root) = project_root else {
        return "centralized".to_string();
    };

    let config_path = project_root.join("output").join("icon_workbench").join("config.json");
    let Ok(raw) = fs::read_to_string(config_path) else {
        return "centralized".to_string();
    };
    let Ok(payload) = serde_json::from_str::<Value>(&raw) else {
        return "centralized".to_string();
    };
    let Some(mode) = payload.get("save_mode").and_then(|value| value.as_str()) else {
        return "centralized".to_string();
    };

    match mode.trim().to_ascii_lowercase().as_str() {
        "in_folder" => "in_folder".to_string(),
        "centralized" => "centralized".to_string(),
        _ => "centralized".to_string(),
    }
}

fn apply_folder_icon_impl(folder_path: &str, image_path: &str, save_mode: &str) -> Result<(), String> {
    let folder = Path::new(folder_path);
    let preview = Path::new(image_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("文件夹不存在: {}", folder_path));
    }
    if !preview.exists() || !preview.is_file() {
        return Err(format!("预览图片不存在: {}", image_path));
    }

    backup_current_icon_state(folder)?;
 
    let (icon_path, icon_resource_name) = if save_mode == "centralized" {
        let managed_dir = managed_icons_dir()?;
        if !managed_dir.exists() {
            fs::create_dir_all(&managed_dir).map_err(|e| format!("创建集中图标目录失败: {e}"))?;
        }
        let key = folder_backup_key(folder_path);
        let target = managed_dir.join(format!("{}.ico", key));
        (target.clone(), target.to_string_lossy().into_owned())
    } else {
        (folder.join(ICON_FILE_NAME), ICON_FILE_NAME.to_string())
    };

    let ini_path = folder.join("desktop.ini");
 
    clear_attributes_if_exists(&ini_path)?;
    clear_attributes_if_exists(&icon_path)?;
 
    let image_bytes = std::fs::read(preview).map_err(|error| format!("读取预览图失败: {error}"))?;
    png_to_ico(&image_bytes, &icon_path)?;
    desktop_ini::create(folder_path, &icon_resource_name).map_err(|error| format!("写入 desktop.ini 失败: {error}"))?;
 
    if save_mode != "centralized" {
        set_hidden_system(&icon_path)?;
    }
    set_hidden_system(&ini_path)?;
    set_folder_readonly(folder)?;
    refresh_shell(folder_path);
    Ok(())
}

fn clear_folder_icon_impl(folder_path: &str) -> Result<(), String> {
    let folder = Path::new(folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("文件夹不存在: {}", folder_path));
    }

    let desktop_ini_content = desktop_ini::read_existing(folder_path);
    if let Some(content) = desktop_ini_content.as_deref() {
        if let Some(icon_resource) = desktop_ini::parse_icon_resource(content) {
            let resolved = desktop_ini::resolve_icon_path(folder_path, &icon_resource);
            if resolved.starts_with(folder) && resolved.exists() {
                clear_attributes_if_exists(&resolved)?;
                let _ = std::fs::remove_file(resolved);
            }
        }
    }

    clear_attributes_if_exists(&folder.join("desktop.ini"))?;
    let _ = desktop_ini::remove(folder_path);
    clear_attributes_if_exists(&folder.join(ICON_FILE_NAME))?;
    let _ = std::fs::remove_file(folder.join(ICON_FILE_NAME));
    clear_folder_readonly(folder)?;
    refresh_shell(folder_path);
    Ok(())
}

fn restore_last_folder_icon_impl(folder_path: &str) -> Result<(), String> {
    let folder = Path::new(folder_path);
    if !folder.exists() || !folder.is_dir() {
        return Err(format!("文件夹不存在: {}", folder_path));
    }

    let (backup_dir, manifest) = load_backup_manifest(folder_path)?;
    let ini_path = folder.join("desktop.ini");
    let managed_icon_path = folder.join(ICON_FILE_NAME);

    clear_attributes_if_exists(&ini_path)?;
    let _ = desktop_ini::remove(folder_path);

    clear_attributes_if_exists(&managed_icon_path)?;
    let _ = fs::remove_file(&managed_icon_path);

    if let (Some(relative_path), Some(backup_name)) = (
        manifest.original_icon_relative_path.as_deref(),
        manifest.original_icon_backup_name.as_deref(),
    ) {
        let source = backup_dir.join(backup_name);
        if source.exists() {
            restore_file(&source, &folder.join(Path::new(relative_path)))?;
        }
    }

    if let Some(backup_name) = manifest.managed_icon_backup_name.as_deref() {
        let source = backup_dir.join(backup_name);
        if source.exists() {
            restore_file(&source, &managed_icon_path)?;
        }
    }

    if let Some(content) = manifest.desktop_ini_content.as_deref() {
        fs::write(&ini_path, content.as_bytes()).map_err(|error| format!("恢复 desktop.ini 失败: {error}"))?;
        set_hidden_system(&ini_path)?;
        if managed_icon_path.exists() {
            set_hidden_system(&managed_icon_path)?;
        }
        set_folder_readonly(folder)?;
    } else {
        clear_folder_readonly(folder)?;
    }

    refresh_shell(folder_path);
    Ok(())
}

fn png_to_ico(png_bytes: &[u8], output_path: &Path) -> Result<(), String> {
    let image = image::load_from_memory(png_bytes).map_err(|error| format!("加载预览图失败: {error}"))?;
    let sizes = [256_u32, 128, 64, 48, 32, 16];
    let mut entries: Vec<(u32, Vec<u8>)> = Vec::new();

    for size in sizes {
        let resized = image.resize_exact(size, size, image::imageops::FilterType::Lanczos3);
        let mut png_data = Vec::new();
        let mut cursor = Cursor::new(&mut png_data);
        resized
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|error| format!("编码 ICO 图层失败: {error}"))?;
        entries.push((size, png_data));
    }

    let ico_bytes = build_ico_from_pngs(&entries)?;
    let mut file = File::create(output_path).map_err(|error| format!("创建 ICO 文件失败: {error}"))?;
    file.write_all(&ico_bytes)
        .map_err(|error| format!("写入 ICO 文件失败: {error}"))?;
    Ok(())
}

fn build_ico_from_pngs(entries: &[(u32, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let header_size = 6usize;
    let entry_size = 16usize;
    let directory_size = entry_size * entries.len();
    let mut current_offset = header_size + directory_size;
    let mut offsets = Vec::with_capacity(entries.len());
    for (_, png_data) in entries {
        offsets.push(current_offset);
        current_offset += png_data.len();
    }

    let mut output = Vec::with_capacity(current_offset);
    output.extend_from_slice(&0u16.to_le_bytes());
    output.extend_from_slice(&1u16.to_le_bytes());
    output.extend_from_slice(&(entries.len() as u16).to_le_bytes());

    for (index, (size, png_data)) in entries.iter().enumerate() {
        output.push(if *size == 256 { 0 } else { *size as u8 });
        output.push(if *size == 256 { 0 } else { *size as u8 });
        output.push(0);
        output.push(0);
        output.extend_from_slice(&1u16.to_le_bytes());
        output.extend_from_slice(&32u16.to_le_bytes());
        output.extend_from_slice(&(png_data.len() as u32).to_le_bytes());
        output.extend_from_slice(&(offsets[index] as u32).to_le_bytes());
    }

    for (_, png_data) in entries {
        output.extend_from_slice(png_data);
    }

    Ok(output)
}

fn backup_current_icon_state(folder: &Path) -> Result<(), String> {
    let folder_path = folder.to_string_lossy().into_owned();
    let backup_dir = folder_backup_dir(&folder_path)?;
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir)
            .map_err(|error| format!("清理历史图标备份失败: {error}"))?;
    }
    fs::create_dir_all(&backup_dir).map_err(|error| format!("创建图标备份目录失败: {error}"))?;

    let managed_icon_path = folder.join(ICON_FILE_NAME);
    let desktop_ini_content = desktop_ini::read_existing(&folder_path);
    let mut manifest = IconBackupManifest {
        folder_path: folder_path.clone(),
        desktop_ini_content: desktop_ini_content.clone(),
        managed_icon_backup_name: None,
        original_icon_relative_path: None,
        original_icon_backup_name: None,
    };

    if managed_icon_path.exists() && managed_icon_path.is_file() {
        backup_file(
            &managed_icon_path,
            &backup_dir.join(BACKUP_MANAGED_ICON_FILE_NAME),
        )?;
        manifest.managed_icon_backup_name = Some(BACKUP_MANAGED_ICON_FILE_NAME.to_string());
    }

    if let Some(content) = desktop_ini_content.as_deref() {
        if let Some(icon_resource) = desktop_ini::parse_icon_resource(content) {
            let resolved = desktop_ini::resolve_icon_path(&folder_path, &icon_resource);
            if resolved.starts_with(folder)
                && resolved.exists()
                && resolved.is_file()
                && resolved != managed_icon_path
            {
                backup_file(
                    &resolved,
                    &backup_dir.join(BACKUP_ORIGINAL_ICON_FILE_NAME),
                )?;
                let relative_path = resolved
                    .strip_prefix(folder)
                    .map_err(|error| format!("计算原图标相对路径失败: {error}"))?;
                manifest.original_icon_relative_path = Some(path_to_storage_string(relative_path));
                manifest.original_icon_backup_name = Some(BACKUP_ORIGINAL_ICON_FILE_NAME.to_string());
            }
        }
    }

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)
        .map_err(|error| format!("序列化图标备份清单失败: {error}"))?;
    fs::write(backup_dir.join(BACKUP_MANIFEST_FILE_NAME), manifest_bytes)
        .map_err(|error| format!("写入图标备份清单失败: {error}"))?;
    Ok(())
}

fn load_backup_manifest(folder_path: &str) -> Result<(PathBuf, IconBackupManifest), String> {
    let backup_dir = folder_backup_dir(folder_path)?;
    let manifest_path = backup_dir.join(BACKUP_MANIFEST_FILE_NAME);
    if !manifest_path.exists() {
        return Err(format!("没有找到最近一次图标备份: {}", folder_path));
    }
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("读取图标备份清单失败: {error}"))?;
    let manifest: IconBackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("解析图标备份清单失败: {error}"))?;
    Ok((backup_dir, manifest))
}

fn backup_root_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA")
        .ok_or_else(|| "未找到 APPDATA，无法创建图标备份。".to_string())?;
    Ok(PathBuf::from(appdata).join("FilePilot"))
}

fn managed_icons_dir() -> Result<PathBuf, String> {
    Ok(backup_root_dir()?.join("managed_icons"))
}

fn icon_backups_dir() -> Result<PathBuf, String> {
    Ok(backup_root_dir()?.join("icon_backups"))
}

fn folder_backup_dir(folder_path: &str) -> Result<PathBuf, String> {
    Ok(icon_backups_dir()?.join(folder_backup_key(folder_path)))
}

fn folder_backup_key(folder_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    folder_path
        .replace('/', "\\")
        .to_ascii_lowercase()
        .hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn backup_file(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建图标备份文件目录失败: {error}"))?;
    }
    fs::copy(source, target)
        .map_err(|error| format!("备份图标文件失败: {error}"))?;
    Ok(())
}

fn restore_file(source: &Path, target: &Path) -> Result<(), String> {
    if target.exists() {
        clear_attributes_if_exists(target)?;
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建恢复目标目录失败: {error}"))?;
    }
    fs::copy(source, target)
        .map_err(|error| format!("恢复图标文件失败: {error}"))?;
    Ok(())
}

fn path_to_storage_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn clear_attributes_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    run_windows_command("attrib", ["-h", "-s", "-r"], path)
}

fn set_hidden_system(path: &Path) -> Result<(), String> {
    run_windows_command("attrib", ["+h", "+s"], path)
}

fn set_folder_readonly(path: &Path) -> Result<(), String> {
    run_windows_command("attrib", ["+r"], path)
}

fn clear_folder_readonly(path: &Path) -> Result<(), String> {
    run_windows_command("attrib", ["-r"], path)
}

fn run_windows_command<const N: usize>(command: &str, args: [&str; N], target: &Path) -> Result<(), String> {
    let status = Command::new(command)
        .args(args)
        .arg(target.as_os_str())
        .status()
        .map_err(|error| format!("执行 {command} 失败: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{command} 返回错误状态: {status}"))
    }
}

fn refresh_shell(_folder_path: &str) {
    let _ = Command::new("ie4uinit.exe").arg("-show").status();
    // let _ = Command::new("explorer.exe").arg(folder_path).status();
}

#[cfg(test)]
mod tests {
    use super::build_ico_from_pngs;

    #[test]
    fn build_ico_from_pngs_creates_non_empty_payload() {
        let png_payload = vec![137, 80, 78, 71];
        let ico = build_ico_from_pngs(&[(16, png_payload), (32, vec![137, 80, 78, 71])])
            .expect("ico should build");
        assert!(ico.len() > 10);
    }
}

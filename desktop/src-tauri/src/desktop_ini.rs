use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn create(folder_path: &str, icon_name: &str) -> std::io::Result<()> {
    let ini_path = Path::new(folder_path).join("desktop.ini");
    let content = format!(
        "[.ShellClassInfo]\r\nIconResource={},0\r\n[ViewState]\r\nMode=\r\nVid=\r\nFolderType=Generic\r\n",
        icon_name
    );
    let mut file = File::create(ini_path)?;
    file.write_all(content.as_bytes())?;
    Ok(())
}

pub fn read_existing(folder_path: &str) -> Option<String> {
    let ini_path = Path::new(folder_path).join("desktop.ini");
    std::fs::read_to_string(ini_path).ok()
}

pub fn parse_icon_resource(content: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        if !lower.starts_with("iconresource=") {
            continue;
        }
        let raw_value = trimmed.split_once('=')?.1.trim();
        let icon_path = raw_value.split(',').next().unwrap_or(raw_value).trim();
        if !icon_path.is_empty() {
            return Some(icon_path.to_string());
        }
    }
    None
}

pub fn resolve_icon_path(folder_path: &str, icon_resource: &str) -> PathBuf {
    let icon_path = Path::new(icon_resource);
    if icon_path.is_absolute() {
        icon_path.to_path_buf()
    } else {
        Path::new(folder_path).join(icon_path)
    }
}

pub fn remove(folder_path: &str) -> std::io::Result<()> {
    let ini_path = Path::new(folder_path).join("desktop.ini");
    if ini_path.exists() {
        std::fs::remove_file(ini_path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_icon_resource, resolve_icon_path};
    use std::path::PathBuf;

    #[test]
    fn parse_icon_resource_reads_ini_value() {
        let content = "[.ShellClassInfo]\r\nIconResource=file-organizer-icon.ico,0\r\n";
        assert_eq!(
            parse_icon_resource(content).as_deref(),
            Some("file-organizer-icon.ico")
        );
    }

    #[test]
    fn resolve_icon_path_supports_relative_resource() {
        let resolved = resolve_icon_path("D:/Work", "file-organizer-icon.ico");
        assert_eq!(resolved, PathBuf::from("D:/Work").join("file-organizer-icon.ico"));
    }
}

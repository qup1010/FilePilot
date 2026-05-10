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
    file.write_all(&encode_utf16le_with_bom(&content))?;
    Ok(())
}

pub fn read_existing(folder_path: &str) -> Option<String> {
    let ini_path = Path::new(folder_path).join("desktop.ini");
    let bytes = std::fs::read(ini_path).ok()?;
    decode_ini_bytes(&bytes)
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

fn encode_utf16le_with_bom(content: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(2 + content.len() * 2);
    bytes.extend_from_slice(&[0xFF, 0xFE]);
    for unit in content.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

fn decode_ini_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xFF, 0xFE]) {
        let utf16_units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16(&utf16_units).ok();
    }
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let utf16_units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16(&utf16_units).ok();
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec()).ok();
    }
    String::from_utf8(bytes.to_vec()).ok()
}

#[cfg(test)]
mod tests {
    use super::{create, parse_icon_resource, read_existing, resolve_icon_path};
    use std::path::PathBuf;
    use tempfile::tempdir;

    #[test]
    fn parse_icon_resource_reads_ini_value() {
        let content = "[.ShellClassInfo]\r\nIconResource=file-pilot-icon.ico,0\r\n";
        assert_eq!(
            parse_icon_resource(content).as_deref(),
            Some("file-pilot-icon.ico")
        );
    }

    #[test]
    fn resolve_icon_path_supports_relative_resource() {
        let resolved = resolve_icon_path("D:/Work", "file-pilot-icon.ico");
        assert_eq!(resolved, PathBuf::from("D:/Work").join("file-pilot-icon.ico"));
    }

    #[test]
    fn create_writes_utf16le_bom_for_non_ascii_icon_paths() {
        let dir = tempdir().expect("temp dir");
        let folder_path = dir.path().to_string_lossy().to_string();
        create(&folder_path, r"C:\Users\测试\AppData\Roaming\FilePilot\managed_icons\a.ico")
            .expect("desktop.ini should be created");

        let bytes = std::fs::read(dir.path().join("desktop.ini")).expect("desktop.ini bytes");
        assert_eq!(&bytes[..2], &[0xFF, 0xFE]);
    }

    #[test]
    fn read_existing_decodes_utf16le_desktop_ini() {
        let dir = tempdir().expect("temp dir");
        let folder_path = dir.path().to_string_lossy().to_string();
        create(&folder_path, r"C:\Users\测试\AppData\Roaming\FilePilot\managed_icons\a.ico")
            .expect("desktop.ini should be created");

        let content = read_existing(&folder_path).expect("desktop.ini content");
        assert!(content.contains(r"IconResource=C:\Users\测试\AppData\Roaming\FilePilot\managed_icons\a.ico,0"));
    }
}

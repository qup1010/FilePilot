import os

import docx
import pandas as pd
import pypdf

from file_organizer.analysis.archive_reader import read_archive_index
from file_organizer.analysis.image_describer import describe_image

DEFAULT_MAX_LEN = 300
DEFAULT_LIST_DEPTH = 1
DEFAULT_LIST_CHAR_LIMIT = 1800
LIST_TRUNCATION_NOTICE = "...[目录结果过长已截断]"
TEXT_ENCODINGS = ["utf-8", "utf-8-sig", "gbk", "utf-16"]
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}


def _normalize_local_path(path: str) -> str:
    return os.path.normpath(path or ".")


def _is_allowed_local_path(path: str, allowed_base_dir: str | None = None) -> bool:
    if not allowed_base_dir:
        return True

    resolved_path = os.path.abspath(path)
    resolved_base = os.path.abspath(allowed_base_dir)
    try:
        common_path = os.path.commonpath([resolved_path, resolved_base])
    except ValueError:
        return False
    return common_path == resolved_base


def _read_text_with_fallback(filepath: str) -> str:
    last_error = None
    for encoding in TEXT_ENCODINGS:
        try:
            with open(filepath, "r", encoding=encoding) as file:
                return file.read()
        except UnicodeDecodeError as exc:
            last_error = exc
            continue
    if last_error is not None:
        raise last_error
    raise UnicodeDecodeError("utf-8", b"", 0, 1, "unable to decode file")


def _join_limited_lines(lines: list[str], char_limit: int, truncation_notice: str = LIST_TRUNCATION_NOTICE) -> str:
    full_text = "\n".join(lines)
    if char_limit <= 0 or len(full_text) <= char_limit:
        return full_text

    suffix = f"\n{truncation_notice}"
    available = char_limit - len(suffix)
    if available <= 0:
        return truncation_notice[:char_limit]

    kept_lines: list[str] = []
    current_length = 0
    for line in lines:
        extra = len(line) if not kept_lines else len(line) + 1
        if current_length + extra > available:
            break
        kept_lines.append(line)
        current_length += extra

    if not kept_lines:
        return full_text[:available].rstrip() + suffix
    return "\n".join(kept_lines) + suffix


def read_pdf(filepath, max_len=DEFAULT_MAX_LEN):
    """提取 PDF 文本内容。"""
    try:
        reader = pypdf.PdfReader(filepath)
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
            if len(text) >= max_len:
                break
        return text.strip()
    except Exception as exc:
        return f"读取 PDF 失败: {exc}"


def read_docx(filepath, max_len=DEFAULT_MAX_LEN):
    """提取 Word 文本内容。"""
    try:
        document = docx.Document(filepath)
        text = ""
        for para in document.paragraphs:
            text += para.text + "\n"
            if len(text) >= max_len:
                break
        return text.strip()
    except Exception as exc:
        return f"读取 Word 失败: {exc}"


def read_excel(filepath, max_len=DEFAULT_MAX_LEN):
    """提取 Excel 内容摘要。"""
    try:
        workbook = pd.ExcelFile(filepath)
        output = []
        total_len = 0

        for sheet_name in workbook.sheet_names:
            dataframe = pd.read_excel(filepath, sheet_name=sheet_name, nrows=10)
            combined = f"Sheet: {sheet_name}\n{dataframe.to_string(index=False)}\n"
            output.append(combined)
            total_len += len(combined)
            if total_len >= max_len:
                break

        return "".join(output)
    except Exception as exc:
        return f"读取 Excel 失败: {exc}"


def list_local_files(directory=".", max_depth=DEFAULT_LIST_DEPTH, char_limit=DEFAULT_LIST_CHAR_LIMIT):
    """列出指定目录下一层内的目录和文件摘要。"""
    try:
        directory = _normalize_local_path(directory)
        if not _is_allowed_local_path(directory):
            return "错误：基于安全考虑，仅允许查看当前目录或 test 子目录下的内容。"
        if not os.path.exists(directory):
            return f"错误：目录 {directory} 不存在。"
        if not os.path.isdir(directory):
            return f"错误：{directory} 不是目录。"

        lines = ["路径 | 类型 | 说明"]
        root_depth = directory.count(os.sep)

        top_level_entries = sorted(
            (entry for entry in os.scandir(directory) if not entry.name.startswith(".")),
            key=lambda entry: entry.name.lower(),
        )
        lines.append(f"{directory} | dir | 包含 {len(top_level_entries)} 个条目")

        for entry in top_level_entries:
            relative_path = os.path.join(directory, entry.name).replace("\\", "/")
            if entry.is_dir():
                child_entries = sorted(
                    (child for child in os.scandir(entry.path) if not child.name.startswith(".")),
                    key=lambda child: child.name.lower(),
                )
                lines.append(f"{relative_path} | dir | 包含 {len(child_entries)} 个条目")

                if max_depth >= 1:
                    current_depth = entry.path.count(os.sep) - root_depth
                    if current_depth <= max_depth:
                        for child in child_entries:
                            child_path = os.path.join(relative_path, child.name).replace("\\", "/")
                            if child.is_dir():
                                lines.append(f"{child_path} | dir | 已达到递归深度限制")
                            else:
                                suffix = os.path.splitext(child.name)[1].lower() or "无扩展名"
                                lines.append(f"{child_path} | file | {suffix}")
            else:
                suffix = os.path.splitext(entry.name)[1].lower() or "无扩展名"
                lines.append(f"{relative_path} | file | {suffix}")

        return _join_limited_lines(lines, char_limit=char_limit)
    except Exception as exc:
        return f"无法列出目录 {directory}: {exc}"


def read_local_file(filename, max_len=DEFAULT_MAX_LEN, allowed_base_dir: str | None = None):
    """读取本地文件内容。"""
    try:
        filename = _normalize_local_path(filename)
        if not _is_allowed_local_path(filename, allowed_base_dir=allowed_base_dir):
            return "错误：基于安全考虑，本程序仅限读取允许目录内的文件。"
        if not os.path.exists(filename):
            return f"错误：文件 {filename} 不存在。"
        if os.path.isdir(filename):
            return f"错误：{filename} 是目录，不能按文件读取。"

        ext = os.path.splitext(filename)[1].lower()
        if ext == ".pdf":
            content = read_pdf(filename, max_len=max_len)
        elif ext in [".docx", ".doc"]:
            content = read_docx(filename, max_len=max_len)
        elif ext in [".xlsx", ".xls"]:
            content = read_excel(filename, max_len=max_len)
        elif ext == ".zip":
            content = read_archive_index(filename, max_entries=max_len)
        elif ext in IMAGE_EXTENSIONS:
            content = describe_image(filename)
        else:
            content = _read_text_with_fallback(filename)

        if len(content) > max_len:
            content = content[:max_len] + "\n...[内容过长已截断]"

        return f"--- 文件 [{filename}] 内容开始 ---\n{content}\n--- 内容结束 ---"
    except UnicodeDecodeError:
        return "该文件可能是二进制格式或使用了非 UTF-8 编码，请检查文件后缀是否正确。"
    except Exception as exc:
        return f"无法读取文件 {filename}: {exc}"

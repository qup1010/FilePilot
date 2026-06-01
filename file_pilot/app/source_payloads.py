from __future__ import annotations

from pathlib import Path

from file_pilot.domain.models import SourceRef


def normalize_relpath(value: str | None) -> str:
    return str(value or "").replace("\\", "/").strip().strip("/")


def entry_extension(entry_path: str) -> str:
    suffix = Path(entry_path or "").suffix.lower().lstrip(".")
    return suffix or "item"


def planner_id_number(planner_id: str) -> int:
    text = str(planner_id or "").strip()
    if len(text) >= 2 and text[0].upper() == "F" and text[1:].isdigit():
        return int(text[1:])
    return 0


def scan_entries_from_lines(scan_lines: str) -> list[dict]:
    entries = []
    for line in (scan_lines or "").splitlines():
        if not line.strip():
            continue
        entry_path = ""
        entry_type = ""
        suggested_purpose = ""
        summary = ""
        confidence = None
        if "|" in line:
            parts = [part.strip() for part in line.split("|", 3)]
            entry_path = parts[0] if parts else ""
            if len(parts) >= 4:
                entry_type = parts[1].lower()
                suggested_purpose = parts[2]
                summary = parts[3]
            else:
                suggested_purpose = parts[1] if len(parts) > 1 else ""
                summary = parts[2] if len(parts) > 2 else ""
        else:
            parts = line.split(":", 1)
            if len(parts) >= 2:
                entry_path = parts[1].split("(")[0].strip()
        if not entry_path:
            continue
        source_relpath = normalize_relpath(entry_path)
        entries.append(
            {
                "item_id": source_relpath,
                "display_name": Path(source_relpath).name,
                "source_relpath": source_relpath,
                "suggested_purpose": suggested_purpose,
                "summary": summary,
                "confidence": confidence,
                "entry_type": entry_type,
                "ext": entry_extension(source_relpath),
            }
        )
    return entries


def build_planner_items_from_scan_lines(
    scan_lines: str,
    existing_items: list[dict] | None = None,
) -> list[dict]:
    entries = scan_entries_from_lines(scan_lines)
    existing_by_source = {
        normalize_relpath(item.get("source_relpath")): dict(item)
        for item in (existing_items or [])
        if normalize_relpath(item.get("source_relpath"))
    }
    next_id = max((planner_id_number(item.get("planner_id")) for item in (existing_items or [])), default=0)
    basename_counts: dict[str, int] = {}
    for entry in entries:
        basename = str(entry.get("display_name") or "").strip().lower()
        if basename:
            basename_counts[basename] = basename_counts.get(basename, 0) + 1

    duplicate_seen: dict[str, int] = {}

    planner_items: list[dict] = []
    for entry in entries:
        source_relpath = normalize_relpath(entry.get("source_relpath"))
        if not source_relpath:
            continue
        existing = existing_by_source.get(source_relpath)
        if existing:
            planner_id = str(existing.get("planner_id") or "").strip()
        else:
            next_id += 1
            planner_id = f"F{next_id:03d}"
        parent_hint = ""
        base_display_name = str(entry.get("display_name") or Path(source_relpath).name)
        display_name = base_display_name
        duplicate_key = base_display_name.strip().lower()
        if basename_counts.get(duplicate_key, 0) > 1:
            parent_hint = str(Path(source_relpath).parent).replace("\\", "/")
            if parent_hint == ".":
                parent_hint = ""
            duplicate_seen[duplicate_key] = duplicate_seen.get(duplicate_key, 0) + 1
            display_name = f"{base_display_name} ({duplicate_seen[duplicate_key]})"
        planner_items.append(
            {
                "planner_id": planner_id,
                "source_relpath": source_relpath,
                "display_name": display_name,
                "suggested_purpose": entry.get("suggested_purpose", ""),
                "summary": entry.get("summary", ""),
                "confidence": entry.get("confidence", existing.get("confidence") if existing else None),
                "entry_type": entry.get("entry_type", ""),
                "ext": entry.get("ext") or entry_extension(source_relpath),
                "parent_hint": parent_hint,
            }
        )
    planner_items.sort(key=lambda item: planner_id_number(item.get("planner_id", "")))
    return planner_items


def scan_entries_from_planner_items(planner_items: list[dict] | None) -> list[dict]:
    entries: list[dict] = []
    for item in planner_items or []:
        source_relpath = normalize_relpath(item.get("source_relpath"))
        if not source_relpath:
            continue
        entries.append(
            {
                "item_id": source_relpath,
                "display_name": str(item.get("display_name") or Path(source_relpath).name),
                "source_relpath": source_relpath,
                "suggested_purpose": str(item.get("suggested_purpose") or ""),
                "summary": str(item.get("summary") or ""),
                "confidence": item.get("confidence"),
                "entry_type": str(item.get("entry_type") or ""),
                "ext": str(item.get("ext") or entry_extension(source_relpath)),
            }
        )
    return entries


def planner_items_from_source_refs(sources: list[SourceRef] | None) -> list[dict]:
    planner_items: list[dict] = []
    for source in sources or []:
        relpath = normalize_relpath(source.relpath)
        if not relpath:
            continue
        planner_items.append(
            {
                "planner_id": str(source.ref_id or relpath),
                "source_relpath": relpath,
                "display_name": str(source.display_name or Path(relpath).name),
                "suggested_purpose": str(source.suggested_purpose or ""),
                "summary": str(source.content_summary or ""),
                "confidence": source.confidence,
                "entry_type": str(source.entry_type or ""),
                "ext": str(source.ext or entry_extension(relpath)),
                "parent_hint": "",
            }
        )
    planner_items.sort(key=lambda item: planner_id_number(item.get("planner_id", "")))
    return planner_items


def source_refs_from_planner_items(
    planner_items: list[dict] | None,
    *,
    default_origin: str,
) -> list[SourceRef]:
    refs: list[SourceRef] = []
    for item in planner_items or []:
        relpath = normalize_relpath(item.get("source_relpath"))
        if not relpath:
            continue
        refs.append(
            SourceRef(
                ref_id=str(item.get("planner_id") or relpath),
                display_name=str(item.get("display_name") or Path(relpath).name),
                entry_type=str(item.get("entry_type") or ""),
                origin=default_origin,
                relpath=relpath,
                suggested_purpose=str(item.get("suggested_purpose") or ""),
                content_summary=str(item.get("summary") or ""),
                confidence=item.get("confidence"),
                ext=str(item.get("ext") or entry_extension(relpath)),
            )
        )
    return refs

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AnalysisItem:
    entry_name: str
    suggested_purpose: str
    summary: str
    entry_type: str = ""
    evidence_sources: list[str] = field(default_factory=list)
    confidence: float | None = None

    @classmethod
    def from_dict(cls, data: dict) -> "AnalysisItem":
        return cls(
            entry_name=data.get("entry_name", ""),
            entry_type=data.get("entry_type", ""),
            suggested_purpose=data.get("suggested_purpose", "待判断"),
            summary=data.get("summary", ""),
            evidence_sources=list(data.get("evidence_sources", []) or []),
            confidence=data.get("confidence"),
        )

    def to_scan_line(self) -> str:
        return f"{self.entry_name} | {self.suggested_purpose} | {self.summary}"

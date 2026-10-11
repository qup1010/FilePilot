from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class AnalysisItem:
    entry_name: str
    suggested_purpose: str
    summary: str
    entry_id: str = ""
    display_name: str = ""
    entry_type: str = ""
    evidence_sources: list[str] = field(default_factory=list)
    confidence: float | None = None
    analysis_status: str = "completed"

    @classmethod
    def from_dict(cls, data: dict) -> "AnalysisItem":
        summary = data.get("summary", "")
        legacy_uncovered_summary = "分析未覆盖，需手动确认"
        analysis_status = str(data.get("analysis_status") or "").strip()
        if analysis_status not in {"completed", "needs_review"}:
            analysis_status = "needs_review" if summary == legacy_uncovered_summary else "completed"
        return cls(
            entry_id=data.get("entry_id", ""),
            entry_name=data.get("entry_name", ""),
            display_name=data.get("display_name", ""),
            entry_type=data.get("entry_type", ""),
            suggested_purpose=data.get("suggested_purpose", "待判断"),
            summary=summary,
            evidence_sources=list(data.get("evidence_sources", []) or []),
            confidence=data.get("confidence"),
            analysis_status=analysis_status,
        )

    def to_dict(self) -> dict:
        return {
            "entry_id": self.entry_id,
            "entry_name": self.entry_name,
            "display_name": self.display_name,
            "entry_type": self.entry_type,
            "suggested_purpose": self.suggested_purpose,
            "summary": self.summary,
            "evidence_sources": self.evidence_sources,
            "confidence": self.confidence,
            "analysis_status": self.analysis_status,
        }

    def to_scan_line(self) -> str:
        return f"{self.entry_name} | {self.entry_type} | {self.suggested_purpose} | {self.summary}"

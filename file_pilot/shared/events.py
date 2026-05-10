def emit(handler, event_type: str, data: dict | None = None):
    if handler:
        handler(event_type, data or {})

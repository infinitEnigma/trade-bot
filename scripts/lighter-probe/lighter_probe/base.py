"""Shared probe step infrastructure."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class StepResult:
    name: str
    status: str  # PASS | FAIL | NOTE
    detail: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:  # pragma: no cover - display only
        return f"[{self.status:>4}] {self.name} :: {self.detail}"


def safe_json(resp: Any) -> dict[str, Any]:
    try:
        body = resp.json()
        return body if isinstance(body, dict) else {}
    except Exception:  # noqa: BLE001 - probe must tolerate malformed bodies
        return {}


def unused_client_order_index() -> int:
    """A probe-only id in the engine's future int64 range (see Phase 1's
    deriveClientOrderId): high bits identify the probe, low bits the time."""
    return 700_000_000_000 + int(time.time()) % 100_000_000

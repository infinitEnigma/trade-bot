"""Probe CLI.

Usage (from scripts/lighter-probe/):
    python -m lighter_probe.probe --list
    python -m lighter_probe.probe --only connectivity,account
    python -m lighter_probe.probe --skip order.* --json-out .out/report.json
"""

from __future__ import annotations

import argparse
import asyncio
import fnmatch
import json
import os
import sys
import time
from collections.abc import Callable, Coroutine
from typing import Any

from dotenv import load_dotenv

from .base import StepResult
from .config import ProbeConfig, ProbeConfigError, load
from .session import ProbeSession
from .steps_orders import (
    step_duplicate_submission,
    step_place_limit_order,
    step_query_after_submit,
)
from .steps_orders_close import step_cancel_order, step_lost_response_recovery
from .steps_readonly import (
    step_account,
    step_active_orders,
    step_auth_token,
    step_connectivity,
    step_markets,
    step_rate_limits,
    step_unknown_client_order,
)

StepFn = Callable[[ProbeSession], Coroutine[Any, Any, StepResult]]
StateStepFn = Callable[[ProbeSession, dict], Coroutine[Any, Any, StepResult]]

# name -> (needs_order_state, callable). Order matters: it is execution order.
STEPS: list[tuple[str, bool, object]] = [
    ("connectivity", False, step_connectivity),
    ("account", False, step_account),
    ("markets", False, step_markets),
    ("auth-token", False, step_auth_token),
    ("active-orders", False, step_active_orders),
    ("unknown-client-order", False, step_unknown_client_order),
    ("place-order", True, step_place_limit_order),
    ("query-after-submit", True, step_query_after_submit),
    ("duplicate-submission", True, step_duplicate_submission),
    ("lost-response-recovery", True, step_lost_response_recovery),
    ("cancel-order", True, step_cancel_order),
    ("rate-limits", False, step_rate_limits),
]

ORDER_STEPS = {name for name, needs_state, _ in STEPS if needs_state}


def _selected(pattern: str, name: str, include: list[str], skip: list[str]) -> bool:
    if any(fnmatch.fnmatch(name, pat) for pat in skip):
        return False
    if not include:
        return True
    return any(fnmatch.fnmatch(name, pat) for pat in include)


async def run(include: list[str], skip: list[str], json_out: str | None) -> int:
    cfg: ProbeConfig = load()
    print(
        f"Lighter probe :: env={cfg.env_name} url={cfg.base_url}"
        f" account={cfg.account_index} api_key={cfg.api_key_index}"
        f" market={cfg.market_symbol}"
    )
    state: dict = {}
    results: list[StepResult] = []

    async with ProbeSession(cfg) as session:
        for name, needs_state, fn in STEPS:
            if not _selected(pattern="*", name=name, include=include, skip=skip):
                continue
            if needs_state and any(
                r.status == "FAIL"
                for r in results
                if r.name in ("connectivity", "account", "markets")
            ):
                results.append(
                    StepResult(name, "SKIP", {"reason": "prerequisite failed"})
                )
                continue
            try:
                if needs_state:
                    result = await fn(session, state)  # type: ignore[operator]
                else:
                    result = await fn(session)  # type: ignore[operator,misc]
            except Exception as exc:  # noqa: BLE001 - probe must not die mid-run
                result = StepResult(name, "FAIL", {"error": str(exc)[:300]})
            results.append(result)
            print(result)

    failed = sum(1 for r in results if r.status == "FAIL")
    print(
        f"\n{len(results)} steps: {failed} failed, "
        f"{sum(1 for r in results if r.status == 'NOTE')} notes"
    )
    if json_out:
        os.makedirs(os.path.dirname(json_out) or ".", exist_ok=True)
        payload = {
            "ran_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "env": cfg.env_name,
            "base_url": cfg.base_url,
            "results": [vars(r) for r in results],
            "state": {k: str(v) for k, v in state.items()},
        }
        # Blocking file IO is fine here: reports are written once per run, not
        # on any async hot path.
        with open(json_out, "w", encoding="utf-8") as fh:  # noqa: ASYNC230
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        print(f"report written to {json_out}")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Lighter.xyz API contract probe")
    parser.add_argument("--list", action="store_true", help="list step names")
    parser.add_argument("--only", default="", help="comma-separated fnmatch patterns")
    parser.add_argument("--skip", default="", help="comma-separated fnmatch patterns")
    parser.add_argument("--json-out", default=None, help="write a JSON report")
    args = parser.parse_args()

    if args.list:
        for name, needs_state, _ in STEPS:
            print(f"{name}{' (places orders)' if needs_state else ''}")
        return 0

    load_dotenv()
    try:
        return asyncio.run(
            run(
                include=[p for p in args.only.split(",") if p],
                skip=[p for p in args.skip.split(",") if p],
                json_out=args.json_out,
            )
        )
    except ProbeConfigError as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

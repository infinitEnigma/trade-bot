"""Read-only probe steps (safe: no orders are placed)."""

from __future__ import annotations

import time
from typing import Any

import httpx

from .base import StepResult, safe_json, unused_client_order_index
from .session import ProbeSession


async def step_connectivity(session: ProbeSession) -> StepResult:
    """Find a working info/status endpoint (varies by environment)."""
    assert session.http is not None
    candidates = ("/api/v1/info", "/status", "/info", "/api/v1/status")
    last: httpx.Response | None = None
    for path in candidates:
        resp = await session.http.get(path)
        if resp.status_code == 200:
            return StepResult(
                "connectivity",
                "PASS",
                {"path": path, "http": resp.status_code, "body": resp.text[:150]},
            )
        last = resp
    return StepResult(
        "connectivity",
        "FAIL",
        {
            "tried": list(candidates),
            "last_http": last.status_code if last else None,
            "body": last.text[:150] if last else "",
        },
    )


async def step_account(session: ProbeSession) -> StepResult:
    """Resolve the configured account index and read its collateral."""
    resp = await session.get(
        "/api/v1/account",
        params={"by": "index", "value": str(session.cfg.account_index)},
    )
    accounts = safe_json(resp).get("accounts") or []
    account = accounts[0] if accounts else None
    return StepResult(
        "account lookup (by index)",
        "PASS" if account else "FAIL",
        {
            "account_index": session.cfg.account_index,
            "found": account is not None,
            "status": (account or {}).get("status"),
            "collateral": (account or {}).get("collateral"),
            "available_balance": (account or {}).get("available_balance"),
        },
    )


async def step_markets(session: ProbeSession) -> StepResult:
    """Resolve the probe market via orderBooks + orderBookDetails."""
    details = await _market_details(session)
    if details is None:
        return StepResult(
            "market resolution",
            "FAIL",
            {"wanted": session.cfg.market_symbol},
        )
    return StepResult(
        "market resolution",
        "PASS",
        {
            "symbol": details.get("symbol"),
            "market_id": details.get("market_id"),
            "price_decimals": details.get("supported_price_decimals"),
            "size_decimals": details.get("supported_size_decimals"),
            "min_base_amount": details.get("min_base_amount"),
            "mark_price": details.get("mark_price"),
        },
    )


async def _market_details(session: ProbeSession) -> dict[str, Any] | None:
    """Find the market by symbol, then fetch its orderBookDetails entry."""
    resp = await session.get("/api/v1/orderBooks")
    books = safe_json(resp).get("order_books") or []
    symbol = session.cfg.market_symbol
    match = next(
        (b for b in books if str(b.get("symbol", "")).upper() == symbol.upper()),
        None,
    )
    if match is None and session.cfg.market_index_override is not None:
        match = next(
            (
                b
                for b in books
                if int(b.get("market_id", -1)) == session.cfg.market_index_override
            ),
            None,
        )
    if match is None:
        return None
    market_id = match.get("market_id") or match.get("market_index")
    resp = await session.get(
        "/api/v1/orderBookDetails", params={"market_id": market_id}
    )
    entries = safe_json(resp).get("order_book_details") or []
    return entries[0] if entries else dict(match)


async def step_auth_token(session: ProbeSession) -> StepResult:
    """Authorization token generation via the signer (needed for all reads)."""
    token = await session.auth_token(force=True)
    return StepResult(
        "auth token generation",
        "PASS" if token else "FAIL",
        {"token_prefix": token[:12] + "..." if token else "", "length": len(token)},
    )


async def step_active_orders(session: ProbeSession) -> StepResult:
    """GET /api/v1/accountActiveOrders - the startup orphan cross-check source."""
    resp = await session.get(
        "/api/v1/accountActiveOrders",
        params={"account_index": session.cfg.account_index},
    )
    orders = safe_json(resp).get("orders") or []
    return StepResult(
        "accountActiveOrders",
        "PASS" if resp.status_code == 200 else "FAIL",
        {
            "http": resp.status_code,
            "active_orders": len(orders),
            "sample_status": orders[0].get("status") if orders else None,
        },
    )


async def step_unknown_client_order(session: ProbeSession) -> StepResult:
    """accountOrders for a never-used client_order_index: establishes the
    definitive NOT_FOUND answer our reconciliation state machine relies on."""
    probe_index = unused_client_order_index()
    resp = await session.get(
        "/api/v1/accountOrders",
        params={
            "account_index": session.cfg.account_index,
            "client_order_indexes": str(probe_index),
        },
    )
    orders = safe_json(resp).get("orders") or []
    found = len(orders) > 0
    return StepResult(
        "accountOrders (unknown id)",
        "PASS" if resp.status_code == 200 and not found else "NOTE",
        {
            "http": resp.status_code,
            "client_order_index": probe_index,
            "orders_returned": len(orders),
            "interpretation": "empty result = definitive NOT_FOUND"
            if not found
            else "unexpected order for unused id",
        },
    )


async def step_rate_limits(session: ProbeSession) -> StepResult:
    """Burst authorized GETs to observe testnet rate limiting behavior."""
    burst = session.cfg.rate_limit_burst
    codes: list[int] = []
    started = time.monotonic()
    for _ in range(burst):
        resp = await session.http.get("/api/v1/orderBooks")
        codes.append(resp.status_code)
    elapsed = time.monotonic() - started
    counts: dict[int, int] = {}
    for code in codes:
        counts[code] = counts.get(code, 0) + 1
    return StepResult(
        "rate limits (burst)",
        "PASS",
        {
            "requests": burst,
            "status_counts": counts,
            "throttled": counts.get(429, 0),
            "elapsed_s": round(elapsed, 2),
        },
    )

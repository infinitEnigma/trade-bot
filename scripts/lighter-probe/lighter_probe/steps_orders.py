"""Order placement / query steps (places real orders on the target env)."""

from __future__ import annotations

import time
from typing import Any

from .base import StepResult, safe_json
from .session import ProbeSession, await_maybe

# Status vocabulary: the Go data-structures doc lists a uint8 enum
# (0 InProgress, 1 Pending, 2 ActiveLimit, 3 Filled, 4+ Canceled variants),
# but the REST JSON renders statuses as lowercase strings.
STATUS_INT_NAMES = {
    0: "InProgress",
    1: "Pending",
    2: "ActiveLimit",
    3: "Filled",
    4: "Canceled",
}

STATUS_STR_MAP = {
    "in_progress": "InProgress",
    "pending": "Pending",
    "open": "ActiveLimit",
    "partially_filled": "PartiallyFilled",
    "filled": "Filled",
    "canceled": "Canceled",
    "cancelled": "Canceled",
    "expired": "Canceled_Expired",
    "rejected": "Rejected",
}

# Canonical states for reconciliation decisions.
OPEN_LIKE = {"InProgress", "Pending", "ActiveLimit", "PartiallyFilled"}
FILLED_LIKE = {"Filled"}
CANCELED_LIKE = {"Canceled", "Canceled_Expired", "Rejected"}


def status_name(status: Any) -> str | None:
    """Normalize an exchange status (int or string) to a canonical name."""
    if status is None:
        return None
    if isinstance(status, bool):
        return None
    if isinstance(status, int):
        return STATUS_INT_NAMES.get(status)
    key = str(status).strip().lower()
    if key in STATUS_STR_MAP:
        return STATUS_STR_MAP[key]
    if key.isdigit():
        return STATUS_INT_NAMES.get(int(key))
    return None


def resolution(status: Any) -> str:
    """Reconciliation decision for one exchange status: OPEN means a live
    order exists, FILLED/CANCELED are terminal, UNRESOLVED means look again."""
    norm = status_name(status)
    if norm in OPEN_LIKE:
        return "OPEN"
    if norm in FILLED_LIKE:
        return "FILLED"
    if norm in CANCELED_LIKE:
        return "CANCELED"
    return "UNRESOLVED"


class OrderProbeError(Exception):
    """Raised when a prerequisite for an order step is missing."""


async def resolve_market(session: ProbeSession) -> dict[str, Any]:
    """Fetch the market's orderBookDetails entry (market_id, mark_price, decimals)."""
    resp = await session.get("/api/v1/orderBooks")
    books = safe_json(resp).get("order_books") or []
    symbol = session.cfg.market_symbol
    match = next(
        (b for b in books if str(b.get("symbol", "")).upper() == symbol.upper()),
        None,
    )
    if match is None:
        raise OrderProbeError(f"market {symbol} not found in orderBooks")
    market_id = match.get("market_id") or match.get("market_index")
    resp = await session.get(
        "/api/v1/orderBookDetails", params={"market_id": market_id}
    )
    entries = safe_json(resp).get("order_book_details") or []
    if not entries:
        raise OrderProbeError(f"orderBookDetails returned nothing for market {market_id}")
    return entries[0]


def scaled_price(mark_price: float, offset_pct: float, decimals: int) -> int:
    """Resting buy price `offset_pct` below the mark, scaled to price decimals."""
    raw = mark_price * (1 - offset_pct / 100)
    return int(round(raw, decimals) * (10**decimals))


def scaled_size(base_amount: float, decimals: int) -> int:
    return int(round(base_amount, decimals) * (10**decimals))


def market_index_of(market: dict[str, Any]) -> int:
    """The order's market index (orderBookDetails exposes it as market_id)."""
    return int(market.get("market_id") or market.get("market_index"))


def mark_price_of(market: dict[str, Any]) -> float:
    return float(market.get("mark_price") or market.get("last_traded_price") or 0)


async def query_order(
    session: ProbeSession, client_order_index: int
) -> dict[str, Any] | None:
    resp = await session.get(
        "/api/v1/accountOrders",
        params={
            "account_index": session.cfg.account_index,
            "client_order_indexes": str(client_order_index),
        },
    )
    orders = safe_json(resp).get("orders") or []
    return orders[0] if orders else None


async def query_all_orders(
    session: ProbeSession, client_order_index: int
) -> list[dict[str, Any]]:
    """All orders the exchange associates with one client order index.

    Used to detect whether a duplicate submission created a second live order.
    """
    resp = await session.get(
        "/api/v1/accountOrders",
        params={
            "account_index": session.cfg.account_index,
            "client_order_indexes": str(client_order_index),
        },
    )
    orders = safe_json(resp).get("orders") or []
    return [o for o in orders if isinstance(o, dict)]


async def sleep_for_commit() -> None:
    """L2 transactions commit asynchronously; give the block a moment."""
    import asyncio

    await asyncio.sleep(2.5)


async def step_place_limit_order(
    session: ProbeSession, state: dict[str, Any]
) -> StepResult:
    """Place a tiny resting limit buy; record the client order index in state."""
    market = await resolve_market(session)
    mark = mark_price_of(market)
    if mark <= 0:
        raise OrderProbeError("no mark price; cannot derive a safe order price")
    price_decimals = int(market.get("supported_price_decimals") or 2)
    size_decimals = int(market.get("supported_size_decimals") or 4)
    consts = session.signer_constants
    client_order_index = 800_000_000_000 + int(time.time())
    api_key_index, nonce = await session.next_nonce()
    call = session.signer.create_order(
        market_index=market_index_of(market),
        client_order_index=client_order_index,
        base_amount=scaled_size(0.01, size_decimals),
        price=scaled_price(mark, session.cfg.order_offset_pct, price_decimals),
        is_ask=False,
        order_type=consts["ORDER_TYPE_LIMIT"],
        time_in_force=consts["TIF_GOOD_TILL_TIME"],
        reduce_only=False,
        trigger_price=0,
        nonce=nonce,
        api_key_index=api_key_index,
    )
    tx, tx_hash, err = await await_maybe(call)
    state["client_order_index"] = client_order_index
    return StepResult(
        "place limit order",
        "FAIL" if err else "PASS",
        {
            "client_order_index": client_order_index,
            "tx_hash": str(tx_hash),
            "err": str(err) if err else None,
        },
    )


async def step_query_after_submit(
    session: ProbeSession, state: dict[str, Any]
) -> StepResult:
    """The order must be visible by its client order index after submission."""
    index = state.get("client_order_index")
    if index is None:
        raise OrderProbeError("no order placed yet")
    await sleep_for_commit()
    order = await query_order(session, int(index))
    status = (order or {}).get("status")
    return StepResult(
        "query after submit",
        "PASS" if order else "FAIL",
        {
            "client_order_index": index,
            "found": order is not None,
            "status": status,
            "status_name": status_name(status),
            "resolution": resolution(status),
            "order_id": (order or {}).get("order_id"),
            "remaining_base_amount": (order or {}).get("remaining_base_amount"),
        },
    )


async def step_duplicate_submission(
    session: ProbeSession, state: dict[str, Any]
) -> StepResult:
    """Resubmit with the SAME client_order_index, then list every order the
    exchange associates with that id. The idempotency question is whether a
    second live order was created - a missing error alone proves nothing."""
    index = state.get("client_order_index")
    if index is None:
        raise OrderProbeError("no order placed yet")
    before = await query_all_orders(session, int(index))
    before_ids = sorted(str(o.get("order_id")) for o in before)
    market = await resolve_market(session)
    consts = session.signer_constants
    api_key_index, nonce = await session.next_nonce()
    call = session.signer.create_order(
        market_index=market_index_of(market),
        client_order_index=int(index),
        base_amount=scaled_size(
            0.01, int(market.get("supported_size_decimals") or 4)
        ),
        price=scaled_price(
            mark_price_of(market),
            session.cfg.order_offset_pct,
            int(market.get("supported_price_decimals") or 2),
        ),
        is_ask=False,
        order_type=consts["ORDER_TYPE_LIMIT"],
        time_in_force=consts["TIF_GOOD_TILL_TIME"],
        reduce_only=False,
        trigger_price=0,
        nonce=nonce,
        api_key_index=api_key_index,
    )
    _tx, _tx_hash, err = await await_maybe(call)
    await sleep_for_commit()
    after = await query_all_orders(session, int(index))
    after_ids = sorted(str(o.get("order_id")) for o in after)
    new_ids = sorted(set(after_ids) - set(before_ids))
    live_new = [o for o in after if str(o.get("order_id")) in new_ids
                and resolution(o.get("status")) == "OPEN"]
    if err:
        verdict = "REJECTED"
    elif live_new:
        verdict = "ACCEPTED_WITH_NEW_LIVE_ORDER"
    elif new_ids:
        verdict = "ACCEPTED_NO_NEW_LIVE_ORDER"
    else:
        verdict = "ACCEPTED_NO_VISIBLE_CHANGE"
    return StepResult(
        "duplicate client_order_index",
        "NOTE",
        {
            "client_order_index": index,
            "err": str(err) if err else None,
            "orders_before": before_ids,
            "orders_after": after_ids,
            "new_order_ids": new_ids,
            "new_live_order_ids": [str(o.get("order_id")) for o in live_new],
            "verdict": verdict,
        },
    )

"""Order recovery / cancellation probe steps."""

from __future__ import annotations

import time
from typing import Any

from .base import StepResult
from .session import ProbeSession, await_maybe
from .steps_orders import (
    OrderProbeError,
    mark_price_of,
    market_index_of,
    query_order,
    resolution,
    resolve_market,
    scaled_price,
    scaled_size,
    sleep_for_commit,
    status_name,
)


async def step_lost_response_recovery(
    session: ProbeSession, state: dict[str, Any]
) -> StepResult:
    """Place an order and deliberately discard the submission response, then
    recover it purely via accountOrders - the exact recovery path the engine's
    OrderReconciliationService will use."""
    market = await resolve_market(session)
    consts = session.signer_constants
    client_order_index = 810_000_000_000 + int(time.time())
    api_key_index, nonce = await session.next_nonce()
    call = session.signer.create_order(
        market_index=market_index_of(market),
        client_order_index=client_order_index,
        base_amount=scaled_size(0.01, int(market.get("supported_size_decimals") or 4)),
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
    if err:
        return StepResult("lost-response recovery", "FAIL", {"err": str(err)})
    # Submission response intentionally discarded above. Recover by id alone:
    await sleep_for_commit()
    order = await query_order(session, client_order_index)
    state["lost_response_index"] = client_order_index
    return StepResult(
        "lost-response recovery",
        "PASS"
        if order and resolution((order or {}).get("status")) == "OPEN"
        else "FAIL",
        {
            "client_order_index": client_order_index,
            "recovered": order is not None,
            "order_id": (order or {}).get("order_id"),
            "status": (order or {}).get("status"),
            "status_name": status_name((order or {}).get("status")),
            "resolution": resolution((order or {}).get("status")),
        },
    )


async def step_cancel_order(session: ProbeSession, state: dict[str, Any]) -> StepResult:
    """Cancel the first probe order and confirm the final status via query.

    Cancel commits are eventually consistent: accountOrders can lag behind
    accountActiveOrders (verified live: a canceled order reads as missing once
    before settling on "canceled"). This step polls instead of one-shot
    reading - the same discipline the engine's reconciler must follow.
    """
    index = state.get("client_order_index")
    if index is None:
        raise OrderProbeError("no order placed yet")
    market = await resolve_market(session)
    api_key_index, nonce = await session.next_nonce()
    call = session.signer.cancel_order(
        market_index=market_index_of(market),
        order_index=int(index),  # cancel accepts the client order index
        nonce=nonce,
        api_key_index=api_key_index,
    )
    _tx, _tx_hash, err = await await_maybe(call)
    order: dict[str, Any] | None = None
    for _ in range(6):
        await sleep_for_commit()
        order = await query_order(session, int(index))
        if order and resolution(order.get("status")) != "UNRESOLVED":
            break
    status = (order or {}).get("status")
    canceled = resolution(status) == "CANCELED"
    return StepResult(
        "cancel + confirm",
        "PASS" if not err and canceled else "FAIL",
        {
            "client_order_index": index,
            "cancel_err": str(err) if err else None,
            "status": status,
            "status_name": status_name(status),
            "resolution": resolution(status),
        },
    )

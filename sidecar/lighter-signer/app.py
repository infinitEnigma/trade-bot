"""Lighter transaction signer service.

Signs and submits Lighter L2 transactions (create/cancel order) and generates
authorization tokens, using the official `lighter-python` SDK.

Security model:
- Credentials are NEVER stored: every request carries the caller's
  account_index / api_key_index / private key, exactly mirroring how the trade
  bot engine fetches per-user credentials from the backend.
- Bind to loopback only. An optional shared secret can be required via
  SIDECAR_AUTH_TOKEN.
- Private keys are never logged.

Run: uvicorn app:app --host 127.0.0.1 --port 8790
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from signer import SignerService

app = FastAPI(title="lighter-signer", version="0.1.0")
service = SignerService()


class Credentials(BaseModel):
    """Per-request Lighter credentials (never persisted by this service)."""

    account_index: int = Field(ge=1)
    api_key_index: int = Field(ge=0, le=254)
    private_key: str = Field(min_length=16)
    env: str = Field(default="testnet", pattern="^(testnet|mainnet)$")


class CreateOrderRequest(Credentials):
    market_index: int = Field(ge=0)
    client_order_index: int = Field(ge=0)
    base_amount: int = Field(gt=0, description="scaled integer (see orderBookDetails)")
    price: int = Field(gt=0, description="scaled integer (see orderBookDetails)")
    is_ask: bool
    order_type: int = Field(default=0, description="0 LIMIT, 1 MARKET")
    # 0 = IOC, 1 = GTT (resting), 2 = post-only. The signer binary refuses a
    # positive expiry for IOC orders and requires one for GTT, so the default
    # must be GTT: it is the only mode a grid bot uses.
    time_in_force: int = Field(default=1, description="0 IOC, 1 GTT (resting), 2 post-only")
    reduce_only: bool = False
    trigger_price: int = 0
    order_expiry: int = Field(
        default=-1, description="-1 = server default (now + 28d, ms)"
    )


class CancelOrderRequest(Credentials):
    market_index: int = Field(ge=0)
    # Cancel takes the order's CLIENT order index, not the venue order id
    # (verified live: the venue order id is refused with "invalid order index").
    order_index: int = Field(ge=0, description="the order's client order index")


class AuthTokenRequest(Credentials):
    deadline_seconds: int = Field(default=600, ge=60, le=8 * 3600)


def _authorize(authorization: str | None) -> None:
    import os

    expected = os.environ.get("SIDECAR_AUTH_TOKEN", "").strip()
    if expected and authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "service": "lighter-signer"}


@app.post("/v1/create-order")
async def create_order(
    req: CreateOrderRequest, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    _authorize(authorization)
    try:
        return await service.create_order(req.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"signer error: {exc}") from exc


@app.post("/v1/cancel-order")
async def cancel_order(
    req: CancelOrderRequest, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    _authorize(authorization)
    try:
        return await service.cancel_order(req.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"signer error: {exc}") from exc


@app.post("/v1/auth-token")
async def auth_token(
    req: AuthTokenRequest, authorization: str | None = Header(default=None)
) -> dict[str, Any]:
    _authorize(authorization)
    try:
        return await service.auth_token(req.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"signer error: {exc}") from exc

"""SignerService: cached SignerClients + serialized nonce usage per API key.

The official SDK manages nonces per (account, api key). Because order
submission is asynchronous and nonce ordering matters, every signing operation
for the same (account_index, api_key_index, key fingerprint) is serialized
behind an asyncio.Lock. Clients are cached so nonces and connections stay
consistent across calls, while credentials themselves are never persisted to
disk and never logged.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from typing import Any

import lighter
from lighter.nonce_manager import NonceManagerType


async def _await_maybe(value: Any) -> Any:
    """SDK 1.1.x mixes sync and async methods; handle both."""
    if asyncio.iscoroutine(value):
        return await value
    return value


_MAINNET_URL = "https://mainnet.zklighter.elliot.ai"
_TESTNET_URL = "https://testnet.zklighter.elliot.ai"
_CHAIN_IDS = {"mainnet": 304, "testnet": 300}


def _base_url(env: str) -> str:
    return _MAINNET_URL if env == "mainnet" else _TESTNET_URL


def _fingerprint(private_key: str) -> str:
    """Short, non-reversible fingerprint used only as a cache key."""
    return hashlib.sha256(private_key.encode()).hexdigest()[:16]


class SignerService:
    def __init__(self) -> None:
        self._clients: dict[tuple[str, int, int, str], lighter.SignerClient] = {}
        self._locks: dict[tuple[str, int, int, str], asyncio.Lock] = {}

    # ------------------------------------------------------------- internals

    def _client_for(self, creds: dict[str, Any]) -> lighter.SignerClient:
        env = creds.get("env", "testnet")
        key = (
            _base_url(env),
            int(creds["account_index"]),
            int(creds["api_key_index"]),
            _fingerprint(str(creds["private_key"])),
        )
        if key not in self._clients:
            self._clients[key] = lighter.SignerClient(
                url=key[0],
                account_index=key[1],
                api_private_keys={key[2]: creds["private_key"]},
                nonce_management_type=NonceManagerType.OPTIMISTIC,
                chain_id=_CHAIN_IDS.get(env, 300),
            )
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._clients[key]

    def _lock_for(self, creds: dict[str, Any]) -> asyncio.Lock:
        env = creds.get("env", "testnet")
        key = (
            _base_url(env),
            int(creds["account_index"]),
            int(creds["api_key_index"]),
            _fingerprint(str(creds["private_key"])),
        )
        if key not in self._locks:
            self._locks[key] = asyncio.Lock()
        return self._locks[key]

    # ------------------------------------------------------------------- ops

    @staticmethod
    def _resolve_expiry(value: Any) -> int:
        """Resolve the caller's `order_expiry` to the value the SDK accepts.

        The SDK's `-1`/"default" sentinel is rejected by the signer binary
        ("OrderExpiry is invalid"), and GTT orders need a positive
        MILLISECOND timestamp (verified on testnet: a 28-day expiry in
        SECONDS is refused with venue code 21711 `invalid expiry`, while the
        same instant in ms is accepted). So a negative/absent/unknown value
        resolves to now + 28 days in ms.
        """
        try:
            expiry = int(value) if value is not None else -1
        except (TypeError, ValueError):
            expiry = -1
        if expiry < 0:
            return int(time.time() * 1000) + 28 * 24 * 60 * 60 * 1000
        return expiry

    async def create_order(self, req: dict[str, Any]) -> dict[str, Any]:
        client = self._client_for(req)
        async with self._lock_for(req):
            # The SDK's `process_api_key_and_nonce` decorator owns the nonce:
            # it serializes per api key, fetches the venue's nonce lazily, and
            # self-heals (`acknowledge_failure` / `hard_refresh` on
            # "invalid nonce"). Passing api_key_index/nonce explicitly would
            # bypass all of that and leave the local counter stuck after any
            # rejected transaction, failing every later tx with
            # code 21104 `invalid nonce` until the process restarts.
            call = client.create_order(
                market_index=req["market_index"],
                client_order_index=req["client_order_index"],
                base_amount=req["base_amount"],
                price=req["price"],
                is_ask=req["is_ask"],
                order_type=req.get("order_type", 0),
                # 0 IOC / 1 GTT (resting) / 2 post-only — default GTT, matching
                # the API model: a grid bot only ever rests orders, and a bare
                # dict without TIF must not silently fill-or-cancel.
                time_in_force=req.get("time_in_force", 1),
                reduce_only=req.get("reduce_only", False),
                trigger_price=req.get("trigger_price", 0),
                order_expiry=self._resolve_expiry(req.get("order_expiry", -1)),
            )
            _tx, tx_hash, err = await _await_maybe(call)
        if err:
            return {"ok": False, "error": str(err)}
        return {
            "ok": True,
            "tx_hash": str(tx_hash),
            "client_order_index": req["client_order_index"],
        }

    async def cancel_order(self, req: dict[str, Any]) -> dict[str, Any]:
        client = self._client_for(req)
        async with self._lock_for(req):
            # Nonce is SDK-managed (see `create_order`) so a refused cancel
            # cannot desync the local counter.
            call = client.cancel_order(
                market_index=req["market_index"],
                order_index=req["order_index"],
            )
            _tx, tx_hash, err = await _await_maybe(call)
        if err:
            return {"ok": False, "error": str(err)}
        return {"ok": True, "tx_hash": str(tx_hash), "order_index": req["order_index"]}

    async def auth_token(self, req: dict[str, Any]) -> dict[str, Any]:
        client = self._client_for(req)
        async with self._lock_for(req):
            result = client.create_auth_token_with_expiry(
                deadline=int(req.get("deadline_seconds", 600)),
                api_key_index=int(req["api_key_index"]),
            )
            result = await _await_maybe(result)
        if isinstance(result, tuple):
            token, err = result[0], result[1]
        else:  # defensive: SDK may return the token directly
            token, err = result, None
        if err:
            return {"ok": False, "error": str(err)}
        return {"ok": True, "token": str(token)}

    async def close(self) -> None:
        for client in self._clients.values():
            try:
                await _await_maybe(client.close())
            except Exception:  # noqa: BLE001, S110 - shutdown best effort
                pass
        self._clients.clear()
        self._locks.clear()

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

    async def create_order(self, req: dict[str, Any]) -> dict[str, Any]:
        client = self._client_for(req)
        async with self._lock_for(req):
            api_key_index, nonce = client.nonce_manager.next_nonce(
                int(req["api_key_index"])
            )
            expiry = req.get("order_expiry", -1)
            call = client.create_order(
                market_index=req["market_index"],
                client_order_index=req["client_order_index"],
                base_amount=req["base_amount"],
                price=req["price"],
                is_ask=req["is_ask"],
                order_type=req.get("order_type", 0),
                time_in_force=req.get("time_in_force", 0),
                reduce_only=req.get("reduce_only", False),
                trigger_price=req.get("trigger_price", 0),
                order_expiry=expiry
                if expiry is not None and expiry >= 0
                else getattr(client, "DEFAULT_28_DAY_ORDER_EXPIRY", -1),
                nonce=nonce,
                api_key_index=api_key_index,
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
            api_key_index, nonce = client.nonce_manager.next_nonce(
                int(req["api_key_index"])
            )
            call = client.cancel_order(
                market_index=req["market_index"],
                order_index=req["order_index"],
                nonce=nonce,
                api_key_index=api_key_index,
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

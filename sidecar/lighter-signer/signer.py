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
import json
import sys
import time
from pathlib import Path
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
        # One client per (url, account_index, api_key_index) — NOT per key.
        # The SDK's signer is a PROCESS-GLOBAL singleton that registers exactly
        # one key per (account_index, api_key_index); verified live on testnet:
        # constructing a second client for the same pair silently changes the
        # key every existing client of that pair reports/signs with. Keying the
        # cache by key fingerprint would therefore promise an isolation the SDK
        # cannot provide (and leak a client per distinct key), so the slot is the
        # cache key and a changed key replaces the client under the slot lock.
        self._clients: dict[
            tuple[str, int, int], tuple[str, lighter.SignerClient]
        ] = {}
        self._locks: dict[tuple[str, int, int], asyncio.Lock] = {}

    # ------------------------------------------------------------- internals

    @staticmethod
    def _slot(creds: dict[str, Any]) -> tuple[str, int, int]:
        """The venue/account/api-key triple the SDK registers keys against."""
        return (
            _base_url(creds.get("env", "testnet")),
            int(creds["account_index"]),
            int(creds["api_key_index"]),
        )

    @staticmethod
    def _key_fingerprint(creds: dict[str, Any]) -> str:
        return _fingerprint(str(creds["private_key"]))

    def _lock_for(self, creds: dict[str, Any]) -> asyncio.Lock:
        slot = self._slot(creds)
        if slot not in self._locks:
            self._locks[slot] = asyncio.Lock()
        return self._locks[slot]

    async def _client_for(self, creds: dict[str, Any]) -> lighter.SignerClient:
        """Return the client for this slot, registering the request's key.

        Must be awaited while holding the slot lock: when the key changed since
        the client was built, the previous client is closed and discarded —
        otherwise it would keep signing with whichever key was registered last.
        """
        slot = self._slot(creds)
        fingerprint = self._key_fingerprint(creds)
        cached = self._clients.get(slot)
        if cached is not None and cached[0] == fingerprint:
            return cached[1]
        if cached is not None:
            try:
                await _await_maybe(cached[1].close())
            except Exception:  # noqa: BLE001 - replacement is best effort
                pass
        client = lighter.SignerClient(
            url=slot[0],
            account_index=slot[1],
            api_private_keys={slot[2]: creds["private_key"]},
            nonce_management_type=NonceManagerType.OPTIMISTIC,
            chain_id=_CHAIN_IDS.get(str(creds.get("env", "testnet")), 300),
        )
        self._clients[slot] = (fingerprint, client)
        return client

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
        async with self._lock_for(req):
            client = await self._client_for(req)
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
        async with self._lock_for(req):
            client = await self._client_for(req)
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
        async with self._lock_for(req):
            client = await self._client_for(req)
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

    # ---------------------------------------------------------- verification

    @staticmethod
    def _verify_command() -> list[str]:
        """The one-shot child that performs an isolated credential check."""
        return [sys.executable, str(Path(__file__).with_name("verify_cli.py"))]

    async def _run_verify_cli(
        self, payload: dict[str, Any], timeout: float = 45.0
    ) -> dict[str, Any]:
        """Run one credential check in a child process (see `verify_cli.py`).

        Isolated on purpose: the SDK's signer is a process-global singleton that
        holds one key per (account_index, api_key_index), so checking a key here
        would change the key that later signing calls use. Credentials travel
        over stdin (never argv), the verdict returns on stdout, nothing is
        logged, and the child exits with the process.
        """
        proc = await asyncio.create_subprocess_exec(
            *self._verify_command(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(
                proc.communicate(json.dumps(payload).encode()), timeout=timeout
            )
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return {"ok": False, "error": "credential check timed out"}
        lines = (stdout or b"").decode().strip().splitlines()
        if lines:
            try:
                verdict = json.loads(lines[-1])
            except ValueError:
                verdict = None
            if isinstance(verdict, dict) and "ok" in verdict:
                return verdict
        detail = (stderr or b"").decode().strip().splitlines()
        return {
            "ok": False,
            "error": f"credential check failed: {detail[-1] if detail else 'no output'}",
        }

    async def verify_credentials(self, req: dict[str, Any]) -> dict[str, Any]:
        """Live ownership proof for one API key (C2 connect / re-verify).

        `SignerClient.check_client()` derives the public key from the supplied
        private key and compares it with the one the venue registered for
        `(account_index, api_key_index)`, so the answer comes from Lighter, not
        from us. Verified on testnet:

        - correct key → no error
        - wrong key → "private key does not match the one on Lighter.
          ownPubKey: <hex> response: <hex> on api key <n>"
        - unregistered/absent key → "api key not found"

        That text carries PUBLIC keys only; the private key is never logged,
        stored or included in the result. Runs in a child process so it cannot
        disturb the keys this process signs with.
        """
        return await self._run_verify_cli(req)

    async def close(self) -> None:
        for _fingerprint, client in self._clients.values():
            try:
                await _await_maybe(client.close())
            except Exception:  # noqa: BLE001, S110 - shutdown best effort
                pass
        self._clients.clear()
        self._locks.clear()

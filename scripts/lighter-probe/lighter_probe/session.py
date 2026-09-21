"""Probe session: SDK clients + an authenticated REST helper.

The SignerClient is used only for signing (orders, auth tokens); REST reads go
through httpx with the authorization header, mirroring exactly what the future
TypeScript LighterClient will do.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
import lighter
from lighter.nonce_manager import NonceManagerType

from .config import ProbeConfig


class ProbeSession:
    """Owns the SDK clients and the authorized REST helper for one probe run."""

    def __init__(self, cfg: ProbeConfig) -> None:
        self.cfg = cfg
        self.api_client: lighter.ApiClient | None = None
        self.signer: lighter.SignerClient | None = None
        self.http: httpx.AsyncClient | None = None
        self._auth_token: str | None = None

    async def __aenter__(self) -> ProbeSession:
        self.api_client = lighter.ApiClient(
            configuration=lighter.Configuration(host=self.cfg.base_url)
        )
        self.signer = lighter.SignerClient(
            url=self.cfg.base_url,
            account_index=self.cfg.account_index,
            api_private_keys={self.cfg.api_key_index: self.cfg.private_key},
            nonce_management_type=NonceManagerType.OPTIMISTIC,
            chain_id=self.cfg.chain_id,
        )
        err = self.signer.check_client()
        if err is not None:
            raise RuntimeError(f"SignerClient.check_client failed: {err}")

        self.http = httpx.AsyncClient(
            base_url=self.cfg.base_url,
            timeout=self.cfg.request_timeout_s,
        )
        return self

    async def __aexit__(self, *_exc: object) -> None:
        if self.http is not None:
            await self.http.aclose()
        if self.signer is not None:
            result = self.signer.close()
            if asyncio.iscoroutine(result):
                await result
        if self.api_client is not None:
            result = self.api_client.close()
            if asyncio.iscoroutine(result):
                await result

    # ------------------------------------------------------------------ auth

    async def auth_token(self, force: bool = False) -> str:
        """Generate (and cache) an authorization token via the signer."""
        if self._auth_token is not None and not force:
            return self._auth_token
        assert self.signer is not None
        # SDK v1.1.x: this method is synchronous and returns (token, err).
        # Handle both sync and async forms defensively.
        result = self.signer.create_auth_token_with_expiry(
            deadline=self.cfg.auth_deadline_seconds,
            api_key_index=self.cfg.api_key_index,
        )
        if asyncio.iscoroutine(result):
            result = await result
        token, err = _unwrap(result)
        if err:
            raise RuntimeError(f"create_auth_token_with_expiry failed: {err}")
        self._auth_token = str(token)
        return self._auth_token

    # ------------------------------------------------------------------- rest

    async def get(self, path: str, params: dict[str, Any] | None = None) -> httpx.Response:
        """Authorized GET against the Lighter REST API."""
        assert self.http is not None
        headers = {"Authorization": await self.auth_token()}
        return await self.http.get(path, params=params, headers=headers)

    # ---------------------------------------------------------------- signing

    async def next_nonce(self) -> tuple[int, int]:
        assert self.signer is not None
        return self.signer.nonce_manager.next_nonce(self.cfg.api_key_index)

    @property
    def signer_constants(self) -> dict[str, Any]:
        """Order constants from the SDK, resolved defensively for probe output."""
        assert self.signer is not None
        return {
            "ORDER_TYPE_LIMIT": getattr(self.signer, "ORDER_TYPE_LIMIT", 0),
            "ORDER_TYPE_MARKET": getattr(self.signer, "ORDER_TYPE_MARKET", 1),
            "TIF_GOOD_TILL_TIME": getattr(
                self.signer, "ORDER_TIME_IN_FORCE_GOOD_TILL_TIME", 0
            ),
            "TIF_IMMEDIATE_OR_CANCEL": getattr(
                self.signer, "ORDER_TIME_IN_FORCE_IMMEDIATE_OR_CANCEL", 1
            ),
            "DEFAULT_28_DAY_ORDER_EXPIRY": getattr(
                self.signer, "DEFAULT_28_DAY_ORDER_EXPIRY", -1
            ),
        }


def _unwrap(result: Any) -> tuple[Any, Any]:
    """SDK methods return either (value, err) tuples or bare values."""
    if isinstance(result, tuple):
        if len(result) == 2:
            return result[0], result[1]
        return result, None
    return result, None


async def await_maybe(value: Any) -> Any:
    """Await coroutine results; pass through sync returns (SDK 1.1.x has a
    mix of sync and async methods)."""
    if asyncio.iscoroutine(value):
        return await value
    return value

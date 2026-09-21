"""Environment-driven configuration for the Lighter probe.

All values come from environment variables so real credentials never touch the
repository. Required: LIGHTER_ACCOUNT_INDEX, LIGHTER_API_KEY_INDEX,
LIGHTER_PRIVATE_KEY.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

MAINNET_URL = "https://mainnet.zklighter.elliot.ai"
TESTNET_URL = "https://testnet.zklighter.elliot.ai"
CHAIN_ID_MAINNET = 304
CHAIN_ID_TESTNET = 300
WS_SUFFIX = "/stream"


class ProbeConfigError(Exception):
    """Raised when required environment configuration is missing or invalid."""


@dataclass(frozen=True)
class ProbeConfig:
    base_url: str
    chain_id: int
    account_index: int
    api_key_index: int
    private_key: str
    market_symbol: str
    market_index_override: int | None
    # How far below the mark price the probe's resting limit order sits, so it
    # never fills while we inspect it.
    order_offset_pct: float
    auth_deadline_seconds: int
    request_timeout_s: float
    rate_limit_burst: int

    @property
    def ws_url(self) -> str:
        return self.base_url.replace("https", "wss") + WS_SUFFIX

    @property
    def env_name(self) -> str:
        return "mainnet" if self.base_url == MAINNET_URL else "testnet"


def load() -> ProbeConfig:
    env = os.environ.get("LIGHTER_ENV", "testnet").strip().lower()
    if env == "mainnet":
        base_url, chain_id = MAINNET_URL, CHAIN_ID_MAINNET
    elif env == "testnet":
        base_url, chain_id = TESTNET_URL, CHAIN_ID_TESTNET
    else:
        base_url = os.environ.get("LIGHTER_BASE_URL", "").strip()
        if not base_url:
            raise ProbeConfigError(
                f"LIGHTER_ENV={env!r} is not mainnet/testnet and no "
                "LIGHTER_BASE_URL override was provided"
            )
        chain_id = int(os.environ.get("LIGHTER_CHAIN_ID", "300"))

    account_index = os.environ.get("LIGHTER_ACCOUNT_INDEX", "").strip()
    api_key_index = os.environ.get("LIGHTER_API_KEY_INDEX", "").strip()
    private_key = os.environ.get("LIGHTER_PRIVATE_KEY", "").strip()
    missing = [
        name
        for name, value in (
            ("LIGHTER_ACCOUNT_INDEX", account_index),
            ("LIGHTER_API_KEY_INDEX", api_key_index),
            ("LIGHTER_PRIVATE_KEY", private_key),
        )
        if not value
    ]
    if missing:
        raise ProbeConfigError(
            "Missing required environment variables: " + ", ".join(missing)
        )

    override = os.environ.get("LIGHTER_MARKET_INDEX", "").strip()
    return ProbeConfig(
        base_url=base_url.rstrip("/"),
        chain_id=chain_id,
        account_index=int(account_index),
        api_key_index=int(api_key_index),
        private_key=private_key,
        market_symbol=os.environ.get("LIGHTER_MARKET_SYMBOL", "ETH").strip(),
        market_index_override=int(override) if override else None,
        order_offset_pct=float(os.environ.get("LIGHTER_PROBE_OFFSET_PCT", "25")),
        auth_deadline_seconds=int(os.environ.get("LIGHTER_AUTH_DEADLINE_S", "600")),
        request_timeout_s=float(os.environ.get("LIGHTER_PROBE_TIMEOUT_S", "15")),
        rate_limit_burst=int(os.environ.get("LIGHTER_PROBE_BURST", "30")),
    )

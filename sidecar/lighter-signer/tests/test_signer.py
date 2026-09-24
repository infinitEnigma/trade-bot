"""Unit tests for the signer sidecar (no network, no real SDK).

The `lighter` SDK module is stubbed so tests run anywhere without the
lighter-sdk package installed. Live testnet verification happens via the
probe scripts (scripts/lighter-probe), not here.
"""

from __future__ import annotations

import asyncio
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# ---- minimal `lighter` + `lighter.nonce_manager` stubs ----------------------

_calls: list[dict] = []
# Concurrency probe used by the lock test: the stub yields inside create_order
# so an unserialized service would be observed overlapping (peak > 1).
_concurrency = {"current": 0, "peak": 0}
# `check_client()` error injected by the credential-verification tests; the real
# SDK returns the venue's key-mismatch reason here (or None when keys match).
_check_client_error: dict[str, str | None] = {"error": None}


class _StubNonceManager:
    def __init__(self) -> None:
        self._next = 100

    def next_nonce(self, api_key_index=None):
        self._next += 1
        return api_key_index or 2, self._next


class _StubSignerClient:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.nonce_manager = _StubNonceManager()
        _calls.append({"kwargs": kwargs})

    def check_client(self):
        return _check_client_error["error"]

    async def create_order(self, **kwargs):
        _concurrency["current"] += 1
        _concurrency["peak"] = max(_concurrency["peak"], _concurrency["current"])
        await asyncio.sleep(0.01)  # yield — an unlocked service would overlap
        _concurrency["current"] -= 1
        _calls.append({"op": "create", **kwargs})
        return "tx-info", f"hash-{kwargs['client_order_index']}", None

    async def cancel_order(self, **kwargs):
        _calls.append({"op": "cancel", **kwargs})
        return "tx-info", "hash-cancel", None

    async def create_auth_token_with_expiry(self, **kwargs):
        _calls.append({"op": "auth", **kwargs})
        return "token-abc", None

    async def close(self):
        _calls.append({"op": "close"})
        return None


class _NonceManagerType:
    OPTIMISTIC = "optimistic"


lighter_stub = types.ModuleType("lighter")
lighter_stub.SignerClient = _StubSignerClient
lighter_stub.ApiClient = object
lighter_stub.Configuration = object
lighter_stub.EndpointProfile = object
lighter_stub.get_endpoint_profile = lambda name: None
lighter_stub.nonce_manager = types.SimpleNamespace(NonceManagerType=_NonceManagerType)
nonce_stub = types.ModuleType("lighter.nonce_manager")
nonce_stub.NonceManagerType = _NonceManagerType
lighter_stub.nonce_manager = nonce_stub

sys.modules.setdefault("lighter", lighter_stub)
sys.modules.setdefault("lighter.nonce_manager", nonce_stub)

from signer import SignerService

CREDS = {
    "account_index": 7,
    "api_key_index": 2,
    "private_key": "0x" + "a" * 32,
    "env": "testnet",
}


# ----------------------------------------------------------------- cache test


def test_clients_cached_per_credentials():
    service = SignerService()
    req = {
        **CREDS,
        "market_index": 0,
        "client_order_index": 1,
        "base_amount": 10,
        "price": 100,
        "is_ask": False,
    }
    asyncio.run(service.create_order(req))
    asyncio.run(service.create_order(req))
    # one client construction for two operations
    assert len([c for c in _calls if "kwargs" in c]) == 1


def test_create_order_returns_tx_hash():
    service = SignerService()
    result = asyncio.run(
        service.create_order(
            {
                **CREDS,
                "market_index": 0,
                "client_order_index": 42,
                "base_amount": 10,
                "price": 100,
                "is_ask": False,
            }
        )
    )
    assert result["ok"] is True
    assert result["tx_hash"] == "hash-42"


def test_cancel_order_uses_client_order_index():
    service = SignerService()
    result = asyncio.run(
        service.cancel_order(
            {
                **CREDS,
                "market_index": 0,
                "order_index": 42,
            }
        )
    )
    assert result["ok"] is True
    cancel = next(c for c in _calls if c.get("op") == "cancel")
    assert cancel["order_index"] == 42


def test_auth_token():
    service = SignerService()
    result = asyncio.run(service.auth_token({**CREDS, "deadline_seconds": 300}))
    assert result == {"ok": True, "token": "token-abc"}


def _fake_child(body: str) -> staticmethod:
    """A stand-in for `verify_cli.py` that prints `body` and exits."""
    command = [sys.executable, "-c", f"print({body!r})"]
    return staticmethod(lambda: command)


def test_verify_credentials_reports_venue_success(monkeypatch):
    """`check_client()` returning no error means Lighter accepted the key."""
    monkeypatch.setattr(SignerService, "_verify_command", _fake_child('{"ok": true}'))
    result = asyncio.run(SignerService().verify_credentials(CREDS))
    assert result == {"ok": True}


def test_verify_credentials_surfaces_venue_reason_without_leaking_key(monkeypatch):
    """The venue's own reason travels back verbatim — it names public keys only
    (live testnet finding)."""
    venue_reason = (
        "private key does not match the one on Lighter. "
        "ownPubKey: 5e9135addbfbf923 response: 6a2046d4f61d7a6f on api key 2"
    )
    monkeypatch.setattr(
        SignerService,
        "_verify_command",
        _fake_child(json.dumps({"ok": False, "error": venue_reason})),
    )
    result = asyncio.run(SignerService().verify_credentials(CREDS))
    assert result == {"ok": False, "error": venue_reason}
    assert CREDS["private_key"] not in str(result)


def test_verify_credentials_passes_credentials_on_stdin_not_argv(
    tmp_path, monkeypatch
):
    """The child reads credentials from stdin: they must never reach the
    process command line (visible in `ps`)."""
    captured = tmp_path / "stdin.json"
    command = [
        sys.executable,
        "-c",
        "import sys, pathlib; "
        f"pathlib.Path({str(captured)!r}).write_bytes(sys.stdin.buffer.read()); "
        "print('{\"ok\": true}')",
    ]
    monkeypatch.setattr(
        SignerService, "_verify_command", staticmethod(lambda: command)
    )

    result = asyncio.run(SignerService().verify_credentials(CREDS))

    assert result == {"ok": True}
    sent = json.loads(captured.read_text())
    assert sent["private_key"] == CREDS["private_key"]
    assert sent["account_index"] == CREDS["account_index"]
    assert all(CREDS["private_key"] not in part for part in command)


def test_verify_credentials_reports_an_unusable_child(monkeypatch):
    """A crashed/timed-out check is a failure, never an accidental pass."""
    command = [
        sys.executable,
        "-c",
        "import sys; sys.stderr.write('boom\\n'); sys.exit(3)",
    ]
    monkeypatch.setattr(
        SignerService, "_verify_command", staticmethod(lambda: command)
    )
    result = asyncio.run(SignerService().verify_credentials(CREDS))
    assert result["ok"] is False
    assert "credential check failed" in result["error"]


def test_verify_cli_reports_ok_with_stubbed_sdk():
    """`verify_cli` itself maps a clean `check_client()` to `{"ok": True}`."""
    import verify_cli  # noqa: PLC0415 - imported here so the SDK stub is active

    _check_client_error["error"] = None
    result = asyncio.run(
        verify_cli.check(
            {
                "account_index": CREDS["account_index"],
                "api_key_index": CREDS["api_key_index"],
                "private_key": CREDS["private_key"],
                "env": CREDS["env"],
            }
        )
    )
    assert result == {"ok": True}


def test_changed_key_replaces_the_client_for_the_same_slot():
    """The SDK registers ONE key per (account, api_key_index), so a changed key
    must replace the cached client — a stale client would keep signing with the
    key registered last (live testnet finding)."""
    service = SignerService()
    asyncio.run(service.auth_token({**CREDS, "deadline_seconds": 300}))
    slot = list(service._clients)  # noqa: SLF001 - cache is the unit under test
    closes_before = len([c for c in _calls if c.get("op") == "close"])

    rotated = {**CREDS, "private_key": "0x" + "b" * 32, "deadline_seconds": 300}
    asyncio.run(service.auth_token(rotated))

    assert len(service._clients) == 1  # one client per slot, not per key
    assert list(service._clients) == slot
    closes = len([c for c in _calls if c.get("op") == "close"])
    assert closes == closes_before + 1  # the replaced client was closed


def test_serialized_under_lock_with_sdk_managed_nonce():
    """Concurrent creates run one at a time (per-credentials lock) and pass no
    explicit nonce: the SDK owns the counter and self-heals it, so a refused
    transaction cannot desync local state (live testnet finding, B5)."""
    service = SignerService()
    _concurrency["current"] = 0
    _concurrency["peak"] = 0
    before = len([c for c in _calls if c.get("op") == "create"])

    async def two_orders():
        req = {
            **CREDS,
            "market_index": 0,
            "client_order_index": 1,
            "base_amount": 10,
            "price": 100,
            "is_ask": False,
        }
        return await asyncio.gather(
            service.create_order(req), service.create_order(req)
        )

    results = asyncio.run(two_orders())
    assert all(r["ok"] for r in results)
    creates = [c for c in _calls if c.get("op") == "create"][before:]
    assert len(creates) == 2
    assert all("nonce" not in c and "api_key_index" not in c for c in creates)
    assert _concurrency["peak"] == 1  # serialized by the lock


def test_resting_default_time_in_force_is_gtt():
    """A create without an explicit TIF must rest (GTT=1), never IOC: the
    grid only places resting limits, and IOC would fill-or-cancel at once."""
    service = SignerService()
    result = asyncio.run(
        service.create_order(
            {
                **CREDS,
                "market_index": 0,
                "client_order_index": 99,
                "base_amount": 10,
                "price": 100,
                "is_ask": False,
            }
        )
    )
    assert result["ok"] is True
    create = [c for c in _calls if c.get("op") == "create"][-1]
    assert create["time_in_force"] == 1

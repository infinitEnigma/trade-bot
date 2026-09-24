"""One-shot credential check for the Lighter signer sidecar (C2).

Spawned as a CHILD PROCESS by `SignerService.verify_credentials`, on purpose:
the Lighter SDK keeps its signer in a process-global singleton and registers
exactly one key per `(account_index, api_key_index)` — verified live on testnet:
building a second client for the same pair silently changes the key every
existing client of that pair signs with. A credential check must therefore never
run in the long-lived sidecar process.

Contract:
- stdin  : JSON `{account_index, api_key_index, private_key, env}`
- stdout : JSON `{ok: true}` or `{ok: false, error: "<venue reason>"}`
- exit   : 0 for a verdict, 2 for an unusable payload

`SignerClient.check_client()` derives the public key from the supplied private
key and compares it with the one Lighter has registered, so the verdict comes
from the venue. The error text contains PUBLIC keys only; the private key is
never logged, stored or echoed back.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

import lighter
from lighter.nonce_manager import NonceManagerType
from signer import _CHAIN_IDS, _base_url


async def check(payload: dict[str, Any]) -> dict[str, Any]:
    environment = str(payload.get("env", "testnet"))
    try:
        client = lighter.SignerClient(
            url=_base_url(environment),
            account_index=int(payload["account_index"]),
            api_private_keys={
                int(payload["api_key_index"]): str(payload["private_key"])
            },
            nonce_management_type=NonceManagerType.OPTIMISTIC,
            chain_id=_CHAIN_IDS.get(environment, 300),
        )
    except Exception as exc:  # noqa: BLE001 - bad key/format, reported to caller
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    try:
        result = client.check_client()
        if asyncio.iscoroutine(result):
            result = await result
    except Exception as exc:  # noqa: BLE001 - venue/SDK failure
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    finally:
        try:
            closing = client.close()
            if asyncio.iscoroutine(closing):
                await closing
        except Exception:  # noqa: BLE001, S110 - best effort
            pass
    if result:
        return {"ok": False, "error": str(result)}
    return {"ok": True}


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": f"invalid payload: {exc}"}))
        return 2
    print(json.dumps(asyncio.run(check(payload))))
    return 0


if __name__ == "__main__":
    sys.exit(main())

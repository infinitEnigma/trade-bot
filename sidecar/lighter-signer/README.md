# lighter-signer

Stateless signing sidecar for the Lighter.xyz exchange. Wraps the official
[`lighter-python`](https://github.com/elliottech/lighter-python) SDK so the
TypeScript trading engine can submit signed L2 transactions (create/cancel
order) and generate authorization tokens without a native TS signer.

## Security model

- **No credentials at rest.** Every request carries the caller's
  `account_index` / `api_key_index` / `private_key`; the service keeps nothing
  on disk and never logs keys. This mirrors the engine's per-user
  credential-fetch flow for Kodiak/Orderly.
- **Loopback only.** Run bound to `127.0.0.1`. Set `SIDECAR_AUTH_TOKEN` to
  require `Authorization: Bearer <token>` on every call (recommended when the
  engine and sidecar share a host with other services).
- Failures are surfaced as typed HTTP 502 responses with the SDK error string;
  the engine's reconciliation state machine treats an unreachable sidecar as
  `UNREACHABLE` → slots freeze (no duplicate orders).

## API

| Endpoint                | Body                                                                                                                                                                | Returns                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `GET /health`           | –                                                                                                                                                                   | `{status: "ok"}`                    |
| `POST /v1/create-order` | credentials + `market_index`, `client_order_index`, `base_amount`, `price`, `is_ask`, `order_type`, `time_in_force`, `reduce_only`, `trigger_price`, `order_expiry` | `{ok, tx_hash, client_order_index}` |
| `POST /v1/cancel-order` | credentials + `market_index`, `order_index` (= the client order index)                                                                                              | `{ok, tx_hash, order_index}`        |
| `POST /v1/auth-token`   | credentials + `deadline_seconds` (≤ 8h)                                                                                                                             | `{ok, token}`                       |

`base_amount` / `price` are **scaled integers** using the market's
`supported_size_decimals` / `supported_price_decimals` from
`GET /api/v1/orderBookDetails` — the sidecar does no decimal math.

Create-order defaults: `order_type=0` (LIMIT), `time_in_force=1`
(GTT — resting; the signer binary refuses a positive `order_expiry` for IOC
orders), `order_expiry=-1` (server default = now + 28 days), `reduce_only=false`.
`cancel-order` takes the **client order index** as `order_index` — the venue
does not accept its own `order_id` there.

## Run

```sh
cd sidecar/lighter-signer
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

SIDECAR_AUTH_TOKEN=$(openssl rand -hex 16) \
  uvicorn app:app --host 127.0.0.1 --port 8790
```

Health check: `curl http://127.0.0.1:8790/health`

## Tests

```sh
pytest tests -q          # pure unit tests (SDK stubbed, no network)
```

Live testnet verification is done by the probe scripts in
`scripts/lighter-probe/` (Phase 0), not by these unit tests.

## Deploy notes

- One sidecar per host is sufficient; it is stateless and horizontally safe.
- Only required when a strategy selects `exchange: "lighter"`.
- The engine treats sidecar unavailability as exchange-unreachable — bots keep
  state consistent and freeze affected slots rather than double-placing orders.

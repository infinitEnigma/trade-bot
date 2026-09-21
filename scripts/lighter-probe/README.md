# Lighter.xyz Probe (Phase 0)

Empirical verification of the Lighter.xyz API contract **before** the engine's
TypeScript `LighterClient` adapter is written. Every behavior the
`OrderReconciliationService` depends on is verified here against a real
Lighter environment (testnet by default).

## What it verifies

| Step | Question answered | Feeds |
| --- | --- | --- |
| `connectivity` | Is the API reachable? | — |
| `account` | Does the configured account index resolve? | credentials model |
| `markets` | Market index + price/size decimals for the symbol | adapter scaling |
| `auth-token` | Does signer-generated authorization work for REST reads? | adapter auth |
| `active-orders` | `accountActiveOrders` shape | startup orphan cross-check |
| `unknown-client-order` | Does an unused `client_order_index` return an empty result (definitive NOT_FOUND)? | state machine |
| `place-order` | Submission acknowledgment (`tx_hash`, no error) | `SUBMITTING` |
| `query-after-submit` | Is the order visible by its client order index? | `SUBMITTING → OPEN` |
| `duplicate-submission` | Does the exchange reject a reused `client_order_index`? | idempotency guarantee |
| `lost-response-recovery` | Can an order be recovered by id after a "lost" response? | the P0 recovery path |
| `cancel-order` | Does cancel accept the client order index, and does the query confirm `Canceled`? | confirmed-only cancellation |
| `rate-limits` | Burst behavior on the target environment | adapter pacing |

## Setup

1. Create a testnet account: connect a wallet at <https://testnet.app.lighter.xyz/>
   (testnet accounts receive mock collateral).
2. Create an API key (index **not 0** — indices 0-1 are reserved for the web app)
   via the SDK's `system_setup.py` example, or manually in the app.
3. Configure `.env` at the repo root (never committed):

```sh
LIGHTER_ENV=testnet                     # testnet | mainnet
LIGHTER_ACCOUNT_INDEX=12345             # your account index (int64)
LIGHTER_API_KEY_INDEX=2                 # your API key index
LIGHTER_PRIVATE_KEY=...                 # API key private key
LIGHTER_MARKET_SYMBOL=ETH-PERP          # probe market
LIGHTER_PROBE_OFFSET_PCT=25             # resting order sits this far below mark
```

## Run

```sh
cd scripts/lighter-probe
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m lighter_probe.probe --list                 # list steps
python -m lighter_probe.probe --skip 'order.*,duplicate-submission,lost-response-recovery,cancel-order'   # read-only pass
python -m lighter_probe.probe --json-out .out/report.json   # full run incl. orders
```

Full-run steps place **tiny resting limit orders** (default 0.01 units, 25% below
mark) and cancel them. They need testnet collateral.

## Outputs

- Console: one `[PASS|FAIL|NOTE]` line per step.
- `--json-out .out/report.json`: machine-readable report (`.out/` is gitignored).
  Paste the relevant sections into `docs/ARCHITECTURE.md` §5 when writing the
  Lighter adapter contract.

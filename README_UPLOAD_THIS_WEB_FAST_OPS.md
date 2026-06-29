# Upload This To `vidipay-backend`

Purpose: 1.5M backend ops speed patch only.

Changed:

- Cached scanner heartbeat reads for fast `/scanner/healthz`.
- Cached wallet capacity counts for fast `/ops/wallet-capacity`.
- Cached scanner backlog counts.
- Cached Redis health/deep checks.
- Reused one ops snapshot for `/ops/final-gate`, `/ops/scale-contract`, and `/ops/launch-checklist`.

Render settings:

```text
Build Command: npm install --omit=dev
Start Command: npm start
Root Directory: empty
```

Recommended env additions/updates:

```env
SCANNER_HEARTBEAT_CACHE_TTL_MS=1500
WALLET_CAPACITY_CACHE_TTL_MS=15000
SCANNER_BACKLOG_CACHE_TTL_MS=10000
REDIS_HEALTH_CACHE_TTL_MS=5000
OPS_SNAPSHOT_CACHE_TTL_MS=3000
OPS_DB_AUDIT_TIMEOUT_MS=5000
SCALE_AUDIT_COUNT_MODE=planned
```

Do not put scanner mode on the web service:

```env
WORKER_MODE=api
PAYMENT_SCANNER_ENABLED=false
```

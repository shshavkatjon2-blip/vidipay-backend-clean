const fs = require("fs");
const path = require("path");

function readNumber(name, fallback, min, max) {
  const raw = Number(process.env[name] || fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

const shardCount = readNumber("PAYMENT_SCANNER_SHARD_COUNT", 16, 1, 2048);
const batchSize = readNumber("PAYMENT_SCAN_BATCH_SIZE", 500, 1, 5000);
const concurrency = readNumber("PAYMENT_SCAN_CONCURRENCY", 32, 1, 128);
const intervalMs = readNumber("PAYMENT_SCAN_INTERVAL_MS", 3000, 1000, 300000);
const jitterMs = readNumber("PAYMENT_SCAN_JITTER_MS", 2500, 0, 60000);
const orderDelayMs = readNumber("PAYMENT_SCAN_ORDER_DELAY_MS", 10, 0, 5000);
const maxErrorsPerRun = readNumber("PAYMENT_SCAN_MAX_ERRORS_PER_RUN", 500, 1, 10000);
const staleAfterMs = readNumber("PAYMENT_SCANNER_STALE_AFTER_MS", 30000, 30000, 300000);

function serviceYaml(index) {
  return `  - type: worker
    name: vidipay-payment-scanner-hyperscale-${index}
    runtime: node
    plan: standard
    buildCommand: node render-build-fix.cjs && npm install --omit=dev --no-audit --no-fund
    startCommand: npm run start:scanner
    envVars:
      - key: NODE_ENV
        value: production
      - key: WORKER_MODE
        value: scanner
      - key: PAYMENT_SCANNER_ENABLED
        value: true
      - key: PAYMENT_SCANNER_WORKER_ID
        value: scanner-hyperscale-${index}
      - key: PAYMENT_SCANNER_SHARD_COUNT
        value: ${shardCount}
      - key: PAYMENT_SCANNER_SHARD_INDEX
        value: ${index}
      - key: PAYMENT_SCAN_INTERVAL_MS
        value: ${intervalMs}
      - key: PAYMENT_SCAN_BATCH_SIZE
        value: ${batchSize}
      - key: PAYMENT_SCAN_CONCURRENCY
        value: ${concurrency}
      - key: PAYMENT_SCAN_JITTER_MS
        value: ${jitterMs}
      - key: PAYMENT_SCAN_ORDER_DELAY_MS
        value: ${orderDelayMs}
      - key: PAYMENT_SCAN_MAX_ERRORS_PER_RUN
        value: ${maxErrorsPerRun}
      - key: PAYMENT_SCANNER_STALE_AFTER_MS
        value: ${staleAfterMs}
      - key: TONAPI_REQUEST_TIMEOUT_MS
        value: 12000
      - key: TONAPI_RETRY_COUNT
        value: 2
      - key: TONAPI_RETRY_BASE_MS
        value: 250
      - key: RATE_LIMIT_BACKEND
        value: memory
      - key: TONAPI_BASE_URL
        value: https://tonapi.io
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: TONAPI_KEY
        sync: false`;
}

const yaml = [
  "# VidiPay hyperscale scanner worker blueprint.",
  "# Generated file. Create all services or split them across Render accounts/regions.",
  "services:",
  ...Array.from({ length: shardCount }, (_, index) => serviceYaml(index))
].join("\n");

const output = path.resolve(__dirname, "..", "render.hyperscale-256-workers.yaml");
fs.writeFileSync(output, `${yaml}\n`);
console.log(`wrote ${output}`);

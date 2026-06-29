const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const outDir = path.join(packageRoot, "render-blueprints");
const envDir = path.join(packageRoot, "env", "scanner-workers");

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  console.log(path.relative(packageRoot, file).replace(/\\/g, "/"));
}

function workerService(index, shardCount) {
  const suffix = String(index).padStart(3, "0");
  return `  - type: worker
    name: vidipay-scanner-${suffix}
    runtime: node
    plan: pro
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
        value: vidipay-scanner-${suffix}
      - key: PAYMENT_SCANNER_SHARD_COUNT
        value: ${shardCount}
      - key: PAYMENT_SCANNER_SHARD_INDEX
        value: ${index}
      - key: REDIS_SCANNER_LOCKS_ENABLED
        value: true
      - key: REDIS_URL
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
      - key: TONAPI_KEY
        sync: false
      - key: TONAPI_BASE_URL
        value: https://tonapi.io
`;
}

function envFile(index, shardCount) {
  const suffix = String(index).padStart(3, "0");
  return [
    "NODE_ENV=production",
    "WORKER_MODE=scanner",
    "PAYMENT_SCANNER_ENABLED=true",
    `PAYMENT_SCANNER_WORKER_ID=vidipay-scanner-${suffix}`,
    `PAYMENT_SCANNER_SHARD_COUNT=${shardCount}`,
    `PAYMENT_SCANNER_SHARD_INDEX=${index}`,
    "PAYMENT_SCAN_INTERVAL_MS=3000",
    "PAYMENT_SCAN_BATCH_SIZE=500",
    "PAYMENT_SCAN_CONCURRENCY=32",
    "PAYMENT_SCAN_JITTER_MS=2500",
    "PAYMENT_SCAN_ORDER_DELAY_MS=10",
    "REDIS_SCANNER_LOCKS_ENABLED=true",
    "REDIS_URL=",
    "SUPABASE_URL=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "TONAPI_KEY=",
    "TONAPI_BASE_URL=https://tonapi.io"
  ].join("\n");
}

function generate(shardCount) {
  const services = ["services:"];
  for (let index = 0; index < shardCount; index += 1) {
    services.push(workerService(index, shardCount));
    write(path.join(envDir, `${shardCount}-workers`, `scanner-${String(index).padStart(3, "0")}.env`), envFile(index, shardCount));
  }
  write(path.join(outDir, `scanner-workers-${shardCount}.autopilot.yaml`), services.join("\n"));
}

function main() {
  for (const shardCount of [4, 16, 64]) generate(shardCount);
}

main();

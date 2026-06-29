const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const outputDir = fs.existsSync(path.join(packageRoot, "ops")) ? path.join(packageRoot, "ops") : root;
const outputFile = path.join(outputDir, "render-env-bundle-1_5m.txt");

function envBlock(title, lines) {
  return [`# ===== ${title} =====`, ...lines, ""].join("\n");
}

function scannerBlock(count, index) {
  return [
    `# scanner-${count}-${index}`,
    "WORKER_MODE=scanner",
    "PAYMENT_SCANNER_ENABLED=true",
    `PAYMENT_SCANNER_WORKER_ID=scanner-${count}-${index}`,
    `PAYMENT_SCANNER_SHARD_COUNT=${count}`,
    `PAYMENT_SCANNER_SHARD_INDEX=${index}`,
    "PAYMENT_SCAN_INTERVAL_MS=3000",
    "PAYMENT_SCAN_BATCH_SIZE=500",
    "PAYMENT_SCAN_CONCURRENCY=32",
    "PAYMENT_SCAN_JITTER_MS=2500",
    "PAYMENT_SCAN_ORDER_DELAY_MS=10",
    "PAYMENT_SCAN_MAX_ERRORS_PER_RUN=500",
    "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT=512",
    "REDIS_SCANNER_LOCKS_ENABLED=true",
    "REDIS_SCANNER_LOCKS_REQUIRED=false",
    "REDIS_SCANNER_LOCK_TTL_MS=60000",
    "SUPABASE_URL=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "TONAPI_BASE_URL=https://tonapi.io",
    "TONAPI_KEY="
  ];
}

function main() {
  const sections = [];
  sections.push(envBlock("WEB SERVICE API", [
    "WORKER_MODE=api",
    "PAYMENT_SCANNER_ENABLED=false",
    "RATE_LIMIT_BACKEND=redis",
    "REDIS_URL=",
    "REDIS_DEEP_CHECK_ENABLED=true",
    "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT=512",
    "OPS_SNAPSHOT_CACHE_TTL_MS=2000",
    "FINAL_GATE_MIN_SCANNER_WORKERS=4",
    "CAPACITY_TARGET_USERS=1500000",
    "SUPABASE_URL=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "ADMIN_TOKEN=",
    "BOT_TOKEN=",
    "TELEGRAM_WEBHOOK_SECRET=",
    "TONAPI_BASE_URL=https://tonapi.io",
    "TONAPI_KEY=",
    "TON_AUTO_PAYOUT_ENABLED=true",
    "TON_SIGNER_ENABLED=true",
    "TON_SIGNER_KEYS_DIR=",
    "TON_RPC_ENDPOINT=",
    "TON_RPC_API_KEY="
  ]));
  for (const count of [4, 16]) {
    for (let index = 0; index < count; index += 1) {
      sections.push(envBlock(`SCANNER ${count} SHARDS / INDEX ${index}`, scannerBlock(count, index)));
    }
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${sections.join("\n")}\n`, "utf8");
  console.log(`render_env_bundle=${outputFile}`);
}

main();

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const outputDir = fs.existsSync(path.join(packageRoot, "ops")) ? path.join(packageRoot, "ops") : root;
const outputFile = path.join(outputDir, "scanner-shard-env-matrix-1_5m.txt");
const shardCounts = [4, 16, 64, 256];

function block(count, index) {
  return [
    `# scanner shard ${index + 1}/${count}`,
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
    "REDIS_SCANNER_LOCKS_ENABLED=true",
    "REDIS_SCANNER_LOCKS_REQUIRED=false",
    "REDIS_SCANNER_LOCK_TTL_MS=60000",
    "TONAPI_BASE_URL=https://tonapi.io",
    "SUPABASE_URL=",
    "SUPABASE_SERVICE_ROLE_KEY=",
    "TONAPI_KEY=",
    ""
  ].join("\n");
}

function main() {
  const lines = [
    "# VidiPay 1.5M scanner shard env matrix",
    "# Use 4 for minimum gate, 16 for 1.5M baseline, 64/256 for later expansion.",
    ""
  ];
  for (const count of shardCounts) {
    lines.push(`# ===== ${count} scanner workers =====`);
    for (let index = 0; index < count; index += 1) {
      lines.push(block(count, index));
    }
  }
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${lines.join("\n")}\n`, "utf8");
  console.log(`scanner_matrix=${outputFile}`);
  console.log(`shard_counts=${shardCounts.join(",")}`);
}

main();

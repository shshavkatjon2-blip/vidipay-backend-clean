const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const opsDir = fs.existsSync(path.join(packageRoot, "ops")) ? path.join(packageRoot, "ops") : root;
const targetUsers = Number(process.env.CAPACITY_TARGET_USERS || 1500000);
const currentAvailable = Number(process.env.CURRENT_AVAILABLE_WALLETS || 100001);
const missingWallets = Math.max(0, targetUsers - currentAvailable);

function write(name, content) {
  fs.mkdirSync(opsDir, { recursive: true });
  const filePath = path.join(opsDir, name);
  fs.writeFileSync(filePath, content.trimEnd() + "\n", "utf8");
  return filePath;
}

function scannerEnv(count) {
  const blocks = [];
  for (let index = 0; index < count; index += 1) {
    blocks.push([
      `# ===== scanner-${count}-${index} =====`,
      "NODE_ENV=production",
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
    ].join("\n"));
  }
  return blocks.join("\n\n");
}

function main() {
  const files = [];
  files.push(write("01_RENDER_WEB_SERVICE_ENV_CLOSEOUT_1_5M.env", `
NODE_ENV=production
WORKER_MODE=api
PAYMENT_SCANNER_ENABLED=false
RATE_LIMIT_BACKEND=redis
REDIS_URL=
REDIS_DEEP_CHECK_ENABLED=true
PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT=512
OPS_SNAPSHOT_CACHE_TTL_MS=2000
FINAL_GATE_MIN_SCANNER_WORKERS=4
CAPACITY_TARGET_USERS=1500000
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ADMIN_TOKEN=
BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=
PUBLIC_BACKEND_URL=https://vidipay-backend.onrender.com
PUBLIC_APP_URL=
GAME_URL=
ALLOWED_ORIGINS=https://shshavkatjon2-blip.github.io,https://web.telegram.org,https://telegram.org
TONAPI_BASE_URL=https://tonapi.io
TONAPI_KEY=
TON_AUTO_PAYOUT_ENABLED=true
TON_SIGNER_ENABLED=true
REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M=true
TON_SIGNER_NETWORK=mainnet
TON_SIGNER_KEYS_DIR=
TON_RPC_ENDPOINT=
TON_RPC_API_KEY=
TON_PAYOUT_GAS_RESERVE=0.10
TON_PAYOUT_BODY=VidiPay activation payout
ACTIVATION_DEPOSIT_TON=6.99
TON_PAYMENT_MIN_RECEIVED=6.90
TON_PAYMENT_MAX_RECEIVED=7.05
`));

  files.push(write("02_SCANNER_WORKERS_4_SHARDS_ENV_CLOSEOUT_1_5M.txt", scannerEnv(4)));
  files.push(write("03_SCANNER_WORKERS_16_SHARDS_ENV_CLOSEOUT_1_5M.txt", scannerEnv(16)));

  files.push(write("04_WALLET_GENERATION_COMMANDS_1_5M.ps1", `
# Run locally only. Do not upload private-keys anywhere.
cd "C:\\Users\\MYCOM Official Win\\Documents\\Codex\\2026-06-15\\salom\\outputs\\UPLOAD_1_5M_BLOCKER_CLOSEOUT_EXECUTION_BATCH_2026-06-28\\web-service-vidipay-backend"

npm.cmd install --omit=dev

npm.cmd run wallets:generate-missing -- --target=${targetUsers} --current-available=${currentAvailable} --buffer=0 --out="$env:USERPROFILE\\Desktop\\vidipay-ton-wallet-pool-1_5m" --network=mainnet --key-format=mnemonic --sql-batch-size=10000 --confirm-private-output=yes

npm.cmd run wallets:verify -- --pool="$env:USERPROFILE\\Desktop\\vidipay-ton-wallet-pool-1_5m" --expected-count=${missingWallets}

npm.cmd run verify:wallet-sql -- "$env:USERPROFILE\\Desktop\\vidipay-ton-wallet-pool-1_5m"
`));

  files.push(write("05_SIGNER_KEYS_DIR_VERIFY_COMMANDS_1_5M.ps1", `
# Run after wallet pool generation. This does not print private keys.
cd "C:\\Users\\MYCOM Official Win\\Documents\\Codex\\2026-06-15\\salom\\outputs\\UPLOAD_1_5M_BLOCKER_CLOSEOUT_EXECUTION_BATCH_2026-06-28\\web-service-vidipay-backend"
npm.cmd run verify:signer-keys -- --keys-dir="$env:USERPROFILE\\Desktop\\vidipay-ton-wallet-pool-1_5m\\private-keys" --min-files=1
`));

  files.push(write("06_SUPABASE_SQL_CLOSEOUT_RUN_ORDER_1_5M.txt", `
Run in Supabase SQL Editor, in this exact order:

1. sql/RUN_HYPERSCALE_SQL_2026-06-27.sql
2. sql/IMPORT_PROGRESS_TABLE_1_5M.sql
3. generated public-addresses-*.sql files from the wallet pool folder
4. sql/WALLET_IMPORT_AFTER_GENERATION_VERIFY_1_5M.sql
5. sql/WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql
6. sql/WALLET_ASSIGNMENT_INTEGRITY_AUDIT_1_5M.sql
7. sql/PAYMENT_ORDER_TO_WALLET_LINK_AUDIT_1_5M.sql
8. sql/TON_DEPOSIT_REFUND_AUDIT_1_5M.sql
9. sql/CLOSEOUT_FINAL_SQL_AUDIT_1_5M.sql
10. sql/CONTROL_TOWER_SQL_AUDIT_1_5M.sql
`));

  files.push(write("BLOCKER_CLOSEOUT_EXECUTION_README_1_5M.md", `
# 1.5M Blocker Closeout Execution Kit

This kit targets the four real blockers currently shown by live control tower:

1. Redis env is missing.
2. Scanner workers are not heartbeating.
3. Wallet pool is short by ${missingWallets} wallets.
4. TON signer/RPC is not enabled.

Use the files in this folder:

- 01_RENDER_WEB_SERVICE_ENV_CLOSEOUT_1_5M.env
- 02_SCANNER_WORKERS_4_SHARDS_ENV_CLOSEOUT_1_5M.txt
- 03_SCANNER_WORKERS_16_SHARDS_ENV_CLOSEOUT_1_5M.txt
- 04_WALLET_GENERATION_COMMANDS_1_5M.ps1
- 05_SIGNER_KEYS_DIR_VERIFY_COMMANDS_1_5M.ps1
- 06_SUPABASE_SQL_CLOSEOUT_RUN_ORDER_1_5M.txt

After upload and env setup, verify:

- https://vidipay-backend.onrender.com/ops/control-tower?fresh=true
- https://vidipay-backend.onrender.com/ops/blocker-actions?fresh=true
- https://vidipay-backend.onrender.com/ops/final-gate
`));

  console.log(`closeout_files=${files.length}`);
  for (const file of files) console.log(file);
}

main();

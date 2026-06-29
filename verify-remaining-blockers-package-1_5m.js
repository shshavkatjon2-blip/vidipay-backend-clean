const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function existsFromPackage(file) {
  return fs.existsSync(path.join(packageRoot, file));
}

function fail(errors, message) {
  errors.push(message);
}

function assertIncludes(errors, file, pattern, label) {
  if (!read(file).includes(pattern)) fail(errors, `${file} missing ${label || pattern}`);
}

function main() {
  const errors = [];

  for (const file of [
    "server.js",
    "scripts/plan-wallet-topup-1_5m.js",
    "scripts/generate-missing-ton-wallets-to-target-1_5m.js",
    "scripts/verify-remaining-blockers-package-1_5m.js",
    "scripts/final-live-gate-1_5m.js",
    "scripts/verify-public-wallet-sql-batches-1_5m.js",
    "scripts/build-production-launch-manifest-1_5m.js",
    "scripts/verify-hyperscale-operations-package-1_5m.js",
    "scripts/verify-control-tower-package-1_5m.js",
    "scripts/verify-live-ops-1_5m.js",
    "scripts/diagnose-live-control-tower-1_5m.js",
    "scripts/generate-wallet-import-manifest-1_5m.js",
    "scripts/generate-scanner-shard-env-matrix-1_5m.js",
    "scripts/generate-render-env-bundle-1_5m.js",
    "scripts/generate-closeout-execution-kit-1_5m.js",
    "scripts/verify-render-env-file-1_5m.js",
    "scripts/verify-signer-keys-dir-1_5m.js"
  ]) {
    if (!fs.existsSync(path.join(root, file))) fail(errors, `Missing ${file}`);
  }

  assertIncludes(errors, "server.js", 'app.get("/ops/redis"', "/ops/redis endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/ton-signer"', "/ops/ton-signer endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/final-gate"', "/ops/final-gate endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/redis-deep"', "/ops/redis-deep endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/wallet-import-plan"', "/ops/wallet-import-plan endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/launch-checklist"', "/ops/launch-checklist endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/control-tower"', "/ops/control-tower endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/blocker-actions"', "/ops/blocker-actions endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/env-contract"', "/ops/env-contract endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/scanner-worker-plan"', "/ops/scanner-worker-plan endpoint");
  assertIncludes(errors, "server.js", "REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M", "1.5M signer requirement flag");
  assertIncludes(errors, "server.js", "buildFinalLaunchGate", "final launch gate helper");
  assertIncludes(errors, "server.js", "acquireScannerDistributedLock", "scanner distributed lock helper");
  assertIncludes(errors, "server.js", "buildTonSignerReadinessReport", "TON signer readiness report");
  assertIncludes(errors, "server.js", "checkRedisHealth", "Redis readiness report");
  assertIncludes(errors, "server.js", "checkRedisDeepHealth", "Redis deep readiness report");
  assertIncludes(errors, "server.js", "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT", "scanner heartbeat read limit");
  assertIncludes(errors, "server.js", "OPS_SNAPSHOT_CACHE_TTL_MS", "ops snapshot cache ttl");

  for (const file of [
    "env/RENDER_WEB_SERVICE_FINAL_1_5M.env",
    "env/RENDER_SCANNER_WORKERS_FINAL_1_5M.env",
    "env/SIGNER_AUTO_PAYOUT_REQUIRED_1_5M.env",
    "env/WALLET_TOPUP_GENERATION_LOCAL_1_5M.env",
    "sql/FINAL_REMAINING_BLOCKERS_AUDIT_1_5M.sql",
    "sql/WALLET_IMPORT_AFTER_GENERATION_VERIFY_1_5M.sql",
    "sql/FINAL_GATE_SQL_VERIFY_1_5M.sql",
    "sql/FINAL_OPERATIONAL_GATE_1_5M.sql",
    "sql/WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql",
    "sql/SCANNER_WORKER_OPERATIONS_AUDIT_1_5M.sql",
    "sql/CONTROL_TOWER_SQL_AUDIT_1_5M.sql",
    "sql/WALLET_ASSIGNMENT_INTEGRITY_AUDIT_1_5M.sql",
    "sql/PAYMENT_ORDER_TO_WALLET_LINK_AUDIT_1_5M.sql",
    "sql/TON_DEPOSIT_REFUND_AUDIT_1_5M.sql",
    "sql/CLOSEOUT_FINAL_SQL_AUDIT_1_5M.sql",
    "ops/ONE_SHOT_REMAINING_BLOCKERS_RUNBOOK_1_5M.md",
    "ops/PRODUCTION_LAUNCH_SEQUENCE_1_5M.md",
    "ops/HYPERSCALE_OPERATIONS_RUNBOOK_1_5M.md",
    "ops/CONTROL_TOWER_RUNBOOK_1_5M.md",
    "env/RENDER_1_5M_REQUIRED_ALL_NO_SECRETS.env",
    "env/REDIS_SCANNER_LOCKS_1_5M.env",
    "env/CONTROL_TOWER_ENV_1_5M.env",
    "sql/IMPORT_PROGRESS_TABLE_1_5M.sql"
  ]) {
    if (!existsFromPackage(file)) fail(errors, `Missing package file ${file}`);
  }

  if (errors.length) {
    console.error("REMAINING BLOCKERS PACKAGE CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("REMAINING BLOCKERS PACKAGE CHECK OK");
}

main();

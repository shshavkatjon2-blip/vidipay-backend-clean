const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const candidateDirs = [
  path.join(root, "sql"),
  path.join(root, "..", "sql")
];
const sqlDir = candidateDirs.find((dir) => fs.existsSync(dir));

function read(file) {
  return fs.readFileSync(path.join(sqlDir, file), "utf8");
}

function fail(errors, message) {
  errors.push(message);
}

function assertFile(errors, file) {
  if (!fs.existsSync(path.join(sqlDir, file))) fail(errors, `Missing sql/${file}`);
}

function assertIncludes(errors, file, pattern, label) {
  const text = read(file);
  if (!text.includes(pattern)) fail(errors, `${file} missing ${label || pattern}`);
}

function main() {
  if (!sqlDir) {
    console.log("SQL PACKAGE CHECK SKIPPED");
    console.log("reason=sql directory is not bundled with this repo-only upload");
    return;
  }

  const errors = [];
  for (const file of [
    "RUN_HYPERSCALE_SQL_2026-06-27.sql",
    "VERIFY_HYPERSCALE_SQL_2026-06-27.sql",
    "POST_DEPLOY_VERIFY_1_5M.sql",
    "SCALE_CONTRACT_AUDIT_1_5M.sql",
    "WALLET_CAPACITY_AUDIT_1_5M.sql",
    "PAYMENT_ORDER_SCANNER_AUDIT_1_5M.sql",
    "PAYMENT_BACKLOG_FAST_AUDIT_1_5M.sql",
    "SCANNER_HEARTBEAT_AUDIT_1_5M.sql",
    "SCANNER_SHARD_COVERAGE_AUDIT_1_5M.sql",
    "FINAL_REMAINING_BLOCKERS_AUDIT_1_5M.sql",
    "FINAL_GATE_SQL_VERIFY_1_5M.sql",
    "IMPORT_PROGRESS_TABLE_1_5M.sql",
    "FINAL_OPERATIONAL_GATE_1_5M.sql",
    "WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql",
    "SCANNER_WORKER_OPERATIONS_AUDIT_1_5M.sql",
    "CONTROL_TOWER_SQL_AUDIT_1_5M.sql",
    "WALLET_ASSIGNMENT_INTEGRITY_AUDIT_1_5M.sql",
    "PAYMENT_ORDER_TO_WALLET_LINK_AUDIT_1_5M.sql",
    "TON_DEPOSIT_REFUND_AUDIT_1_5M.sql",
    "CLOSEOUT_FINAL_SQL_AUDIT_1_5M.sql",
    "INFRA_AUTOPILOT_SQL_GATE_1_5M.sql",
    "WALLET_PUBLIC_IMPORT_STAGING_TEMPLATE_1_5M.sql",
    "COPY_THIS_FIRST_FIX_SHARD_COLUMNS_1_5M.sql",
    "RUN_SQL_IN_THIS_ORDER_1_5M.txt"
  ]) {
    assertFile(errors, file);
  }

  if (!errors.length) {
    assertIncludes(errors, "RUN_HYPERSCALE_SQL_2026-06-27.sql", "claim_pending_payment_orders_sharded", "sharded scanner claim function");
    assertIncludes(errors, "RUN_HYPERSCALE_SQL_2026-06-27.sql", "payment_scanner_heartbeats", "scanner heartbeat table");
    assertIncludes(errors, "VERIFY_HYPERSCALE_SQL_2026-06-27.sql", "function_claim_pending_payment_orders_sharded", "sharded claim verify");
    assertIncludes(errors, "SCALE_CONTRACT_AUDIT_1_5M.sql", "wallet_capacity_available_1_5m", "wallet capacity contract");
    assertIncludes(errors, "SCANNER_SHARD_COVERAGE_AUDIT_1_5M.sql", "scanner_shard_coverage_live", "scanner shard coverage");
    assertIncludes(errors, "PAYMENT_BACKLOG_FAST_AUDIT_1_5M.sql", "pending_orders_with_wallet", "payment backlog audit");
    assertIncludes(errors, "FINAL_GATE_SQL_VERIFY_1_5M.sql", "wallet_capacity_ready", "final SQL launch gate");
    assertIncludes(errors, "IMPORT_PROGRESS_TABLE_1_5M.sql", "wallet_import_batches", "wallet import progress table");
    assertIncludes(errors, "FINAL_OPERATIONAL_GATE_1_5M.sql", "vidipay_operational_gate_1_5m", "final operational gate");
    assertIncludes(errors, "WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql", "wallet_import_batches_summary", "wallet import manifest audit");
    assertIncludes(errors, "SCANNER_WORKER_OPERATIONS_AUDIT_1_5M.sql", "scanner_live_summary", "scanner worker operations audit");
    assertIncludes(errors, "CONTROL_TOWER_SQL_AUDIT_1_5M.sql", "wallet_capacity_ready", "control tower SQL audit");
    assertIncludes(errors, "WALLET_ASSIGNMENT_INTEGRITY_AUDIT_1_5M.sql", "multi_wallet_users", "wallet assignment integrity audit");
    assertIncludes(errors, "PAYMENT_ORDER_TO_WALLET_LINK_AUDIT_1_5M.sql", "pending_order_wallet_status", "payment order wallet link audit");
    assertIncludes(errors, "TON_DEPOSIT_REFUND_AUDIT_1_5M.sql", "vidipay_ton_refund_audit_1_5m", "TON deposit refund audit");
    assertIncludes(errors, "CLOSEOUT_FINAL_SQL_AUDIT_1_5M.sql", "wallet_capacity_ready", "closeout final SQL audit");
    assertIncludes(errors, "INFRA_AUTOPILOT_SQL_GATE_1_5M.sql", "vidipay_infra_autopilot_gate_1_5m", "infra autopilot SQL gate");
    assertIncludes(errors, "WALLET_PUBLIC_IMPORT_STAGING_TEMPLATE_1_5M.sql", "wallet_import_batches", "public wallet import staging table");
    assertIncludes(errors, "COPY_THIS_FIRST_FIX_SHARD_COLUMNS_1_5M.sql", "shard_index", "emergency shard column fix");
    assertIncludes(errors, "RUN_SQL_IN_THIS_ORDER_1_5M.txt", "POST_DEPLOY_VERIFY_1_5M.sql", "post deploy verify order");
    assertIncludes(errors, "RUN_SQL_IN_THIS_ORDER_1_5M.txt", "SCALE_CONTRACT_AUDIT_1_5M.sql", "scale contract run order");
  }

  if (errors.length) {
    console.error("SQL PACKAGE CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("SQL PACKAGE CHECK OK");
  console.log(`sql_dir=${sqlDir}`);
}

main();

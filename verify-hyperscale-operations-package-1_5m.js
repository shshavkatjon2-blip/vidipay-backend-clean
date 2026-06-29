const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");

function readFromRoot(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function existsFromRoot(file) {
  return fs.existsSync(path.join(root, file));
}

function existsFromPackage(file) {
  return fs.existsSync(path.join(packageRoot, file));
}

function fail(errors, message) {
  errors.push(message);
}

function assertIncludes(errors, file, pattern, label) {
  if (!existsFromRoot(file)) return fail(errors, `Missing ${file}`);
  if (!readFromRoot(file).includes(pattern)) fail(errors, `${file} missing ${label || pattern}`);
}

function main() {
  const errors = [];

  for (const file of [
    "server.js",
    "package.json",
    "render-build-fix.cjs",
    "scripts/verify-hyperscale-operations-package-1_5m.js",
    "scripts/verify-live-ops-1_5m.js",
    "scripts/generate-wallet-import-manifest-1_5m.js",
    "scripts/generate-scanner-shard-env-matrix-1_5m.js"
  ]) {
    if (!existsFromRoot(file)) fail(errors, `Missing ${file}`);
  }

  assertIncludes(errors, "server.js", 'app.get("/ops/redis-deep"', "/ops/redis-deep endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/wallet-import-plan"', "/ops/wallet-import-plan endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/launch-checklist"', "/ops/launch-checklist endpoint");
  assertIncludes(errors, "server.js", "REDIS_SCANNER_LOCKS_ENABLED", "scanner Redis lock env");
  assertIncludes(errors, "server.js", "acquireScannerDistributedLock", "scanner distributed lock helper");
  assertIncludes(errors, "server.js", "checkRedisDeepHealth", "Redis deep check helper");
  assertIncludes(errors, "server.js", "buildWalletImportPlan", "wallet import plan helper");
  assertIncludes(errors, "server.js", "FINAL_GATE_MIN_SCANNER_WORKERS", "final gate scanner worker env");
  assertIncludes(errors, "server.js", "WALLET_POOL_BUFFER", "wallet pool buffer env");

  for (const file of [
    "sql/FINAL_OPERATIONAL_GATE_1_5M.sql",
    "sql/WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql",
    "sql/SCANNER_WORKER_OPERATIONS_AUDIT_1_5M.sql",
    "ops/HYPERSCALE_OPERATIONS_RUNBOOK_1_5M.md",
    "env/RENDER_1_5M_REQUIRED_ALL_NO_SECRETS.env",
    "env/REDIS_SCANNER_LOCKS_1_5M.env"
  ]) {
    if (!existsFromPackage(file)) fail(errors, `Missing package file ${file}`);
  }

  assertIncludes(errors, "package.json", "\"verify:ops\"", "verify:ops script");
  assertIncludes(errors, "package.json", "\"verify:live:ops\"", "verify:live:ops script");
  assertIncludes(errors, "package.json", "\"ops:wallet-manifest\"", "ops:wallet-manifest script");
  assertIncludes(errors, "package.json", "\"ops:scanner-matrix\"", "ops:scanner-matrix script");
  assertIncludes(errors, "render-build-fix.cjs", "\"verify:ops\"", "render-build-fix verify:ops script");
  assertIncludes(errors, "render-build-fix.cjs", "\"verify:live:ops\"", "render-build-fix verify:live:ops script");

  if (errors.length) {
    console.error("HYPERSCALE OPERATIONS PACKAGE CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("HYPERSCALE OPERATIONS PACKAGE CHECK OK");
}

main();

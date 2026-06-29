const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");

function existsRoot(file) {
  return fs.existsSync(path.join(root, file));
}

function existsPackage(file) {
  return fs.existsSync(path.join(packageRoot, file));
}

function readRoot(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function fail(errors, message) {
  errors.push(message);
}

function assertIncludes(errors, file, pattern, label) {
  if (!existsRoot(file)) return fail(errors, `Missing ${file}`);
  if (!readRoot(file).includes(pattern)) fail(errors, `${file} missing ${label || pattern}`);
}

function main() {
  const errors = [];

  for (const file of [
    "server.js",
    "scripts/verify-control-tower-package-1_5m.js",
    "scripts/diagnose-live-control-tower-1_5m.js",
    "scripts/generate-render-env-bundle-1_5m.js"
  ]) {
    if (!existsRoot(file)) fail(errors, `Missing ${file}`);
  }

  for (const file of [
    "sql/CONTROL_TOWER_SQL_AUDIT_1_5M.sql",
    "ops/CONTROL_TOWER_RUNBOOK_1_5M.md",
    "env/CONTROL_TOWER_ENV_1_5M.env"
  ]) {
    if (!existsPackage(file)) fail(errors, `Missing package file ${file}`);
  }

  assertIncludes(errors, "server.js", "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT", "scanner heartbeat read limit");
  assertIncludes(errors, "server.js", "OPS_SNAPSHOT_CACHE_TTL_MS", "ops snapshot cache");
  assertIncludes(errors, "server.js", "buildEnvContract", "env contract helper");
  assertIncludes(errors, "server.js", "buildScannerWorkerPlan", "scanner worker plan helper");
  assertIncludes(errors, "server.js", "buildBlockerActions", "blocker actions helper");
  assertIncludes(errors, "server.js", "buildOpsSnapshot", "ops snapshot helper");
  assertIncludes(errors, "server.js", 'app.get("/ops/snapshot"', "/ops/snapshot endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/control-tower"', "/ops/control-tower endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/env-contract"', "/ops/env-contract endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/scanner-worker-plan"', "/ops/scanner-worker-plan endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/blocker-actions"', "/ops/blocker-actions endpoint");
  assertIncludes(errors, "package.json", "\"verify:control-tower\"", "control tower verify script");
  assertIncludes(errors, "package.json", "\"diagnose:live\"", "live diagnosis script");
  assertIncludes(errors, "package.json", "\"ops:render-env-bundle\"", "render env bundle script");

  if (errors.length) {
    console.error("CONTROL TOWER PACKAGE CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("CONTROL TOWER PACKAGE CHECK OK");
}

main();

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const expectedVersion = "v1.8.2-infra-autopilot-20260628";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function fail(errors, message) {
  errors.push(message);
}

function assertIncludes(errors, file, pattern, label) {
  const text = read(file);
  if (!text.includes(pattern)) fail(errors, `${file} missing ${label || pattern}`);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    else files.push(fullPath);
  }
  return files;
}

function main() {
  const errors = [];

  for (const file of [
    "server.js",
    "package.json",
    "scripts/verify-live-1_5m.js",
    "scripts/verify-staging-deploy.js",
    "scripts/verify-env-1_5m.js",
    "scripts/verify-render-blueprints-1_5m.js",
    "scripts/verify-sql-package-1_5m.js",
    "scripts/verify-contract-1_5m.js",
    "scripts/verify-hyperscale-operations-package-1_5m.js",
    "scripts/verify-control-tower-package-1_5m.js",
    "scripts/verify-live-ops-1_5m.js",
    "scripts/diagnose-live-control-tower-1_5m.js",
    "scripts/generate-wallet-import-manifest-1_5m.js",
    "scripts/generate-scanner-shard-env-matrix-1_5m.js",
    "scripts/generate-render-env-bundle-1_5m.js",
    "scripts/generate-closeout-execution-kit-1_5m.js",
    "scripts/generate-infra-autopilot-kit-1_5m.js",
    "scripts/generate-scanner-worker-blueprints-1_5m.js",
    "scripts/build-public-wallet-import-from-keys-dir-1_5m.js",
    "scripts/verify-render-env-file-1_5m.js",
    "scripts/verify-signer-keys-dir-1_5m.js",
    "scripts/verify-infra-autopilot-package-1_5m.js",
    "scripts/final-upload-audit-1_5m.js",
    "render.yaml",
    "render-build-fix.cjs"
  ]) {
    if (!exists(file)) fail(errors, `Missing ${file}`);
  }

  const renderText = exists("render.yaml") ? read("render.yaml") : "";
  const isWorkerPackage = renderText.includes("type: worker");
  if (isWorkerPackage) {
    if (!exists("README_UPLOAD_TO_SCANNER_WORKER_REPO.txt")) fail(errors, "Missing README_UPLOAD_TO_SCANNER_WORKER_REPO.txt");
  } else if (!exists("README_UPLOAD_TO_VIDIPAY_BACKEND_REPO.txt")) {
    fail(errors, "Missing README_UPLOAD_TO_VIDIPAY_BACKEND_REPO.txt");
  }

  assertIncludes(errors, "server.js", expectedVersion, "expected backend version");
  assertIncludes(errors, "server.js", 'app.get("/ops/readiness"', "/ops/readiness endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/metrics"', "/ops/metrics endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/capacity"', "/ops/capacity endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/deploy"', "/ops/deploy endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/live"', "/ops/live endpoint");
  assertIncludes(errors, "server.js", "buildProcessMetrics", "process metrics helper");
  assertIncludes(errors, "server.js", "buildCapacityReadiness", "capacity helper");
  assertIncludes(errors, "server.js", "claim_pending_payment_orders_sharded", "sharded scanner claim rpc");
  assertIncludes(errors, "server.js", "PAYMENT_SCAN_CONCURRENCY", "scanner concurrency env");
  assertIncludes(errors, "server.js", "PAYMENT_SCANNER_SHARD_COUNT", "scanner shard env");
  assertIncludes(errors, "server.js", "PAYMENT_SCAN_JITTER_MS", "scanner jitter env");
  assertIncludes(errors, "server.js", "PAYMENT_SCAN_ORDER_DELAY_MS", "scanner order delay env");
  assertIncludes(errors, "server.js", "fetchJsonWithTimeout", "TON API timeout/retry helper");
  assertIncludes(errors, "server.js", 'app.get("/ops/scale-plan"', "/ops/scale-plan endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/hyperscale"', "/ops/hyperscale endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/scanner-shards"', "/ops/scanner-shards endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/scanner-backlog"', "/ops/scanner-backlog endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/wallet-capacity"', "/ops/wallet-capacity endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/wallet-import-plan"', "/ops/wallet-import-plan endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/redis-deep"', "/ops/redis-deep endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/scale-contract"', "/ops/scale-contract endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/launch-checklist"', "/ops/launch-checklist endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/snapshot"', "/ops/snapshot endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/control-tower"', "/ops/control-tower endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/env-contract"', "/ops/env-contract endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/scanner-worker-plan"', "/ops/scanner-worker-plan endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/blocker-actions"', "/ops/blocker-actions endpoint");
  assertIncludes(errors, "server.js", 'app.get("/ops/infra-autopilot"', "/ops/infra-autopilot endpoint");
  assertIncludes(errors, "server.js", "buildInfraAutopilotPlan", "infra autopilot planner");
  assertIncludes(errors, "server.js", "OPS_DB_AUDIT_TIMEOUT_MS", "ops DB audit timeout");
  assertIncludes(errors, "server.js", "SCALE_AUDIT_COUNT_MODE", "scale audit count mode");
  assertIncludes(errors, "server.js", "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT", "scanner heartbeat read limit");
  assertIncludes(errors, "server.js", "OPS_SNAPSHOT_CACHE_TTL_MS", "ops snapshot cache");
  assertIncludes(errors, "server.js", "REDIS_SCANNER_LOCKS_ENABLED", "scanner Redis locks");
  assertIncludes(errors, "server.js", "checkRedisDeepHealth", "Redis deep check");
  assertIncludes(errors, "server.js", "buildWalletImportPlan", "wallet import plan");
  assertIncludes(errors, "server.js", "shutdownGracefully", "graceful shutdown");
  assertIncludes(errors, "scripts/verify-live-1_5m.js", expectedVersion, "verify-live expected version");
  assertIncludes(errors, "package.json", "\"verify:package\"", "package verify script");
  assertIncludes(errors, "package.json", "\"verify:ops\"", "ops verify script");
  assertIncludes(errors, "package.json", "\"verify:control-tower\"", "control tower verify script");
  assertIncludes(errors, "package.json", "\"diagnose:live\"", "live diagnose script");
  assertIncludes(errors, "package.json", "\"closeout:kit\"", "closeout kit script");
  assertIncludes(errors, "package.json", "\"ops:infra-autopilot\"", "infra autopilot script");
  assertIncludes(errors, "package.json", "\"ops:scanner-blueprints\"", "scanner blueprint script");
  assertIncludes(errors, "package.json", "\"wallets:public-import\"", "public wallet import script");
  assertIncludes(errors, "package.json", "\"verify:infra-autopilot\"", "infra autopilot verifier script");
  assertIncludes(errors, "package.json", "\"verify:upload-audit\"", "final upload audit script");
  assertIncludes(errors, "package.json", "\"verify:render-env-file\"", "render env file verifier script");
  assertIncludes(errors, "package.json", "\"verify:signer-keys\"", "signer keys verifier script");
  assertIncludes(errors, "package.json", "\"verify:all\"", "full verify script");
  if (isWorkerPackage) {
    assertIncludes(errors, "render.yaml", "type: worker", "Render Background Worker type");
    assertIncludes(errors, "render.yaml", "startCommand: npm run start:scanner", "Render Background Worker start command");
  } else {
    assertIncludes(errors, "render.yaml", "type: web", "Render Web Service type");
    assertIncludes(errors, "render.yaml", "startCommand: npm start", "Render Web Service start command");
  }
  assertIncludes(errors, "render.yaml", "PAYMENT_SCANNER_ENABLED", "scanner disabled env marker");
  assertIncludes(errors, "server.js", "CAPACITY_TARGET_USERS || 1500000", "1.5M capacity target default");
  assertIncludes(errors, "render-build-fix.cjs", "object-assign", "Render clean-install dependency guard");
  assertIncludes(errors, "render-build-fix.cjs", "\"verify:ops\"", "Render build ops verify script");
  assertIncludes(errors, "render-build-fix.cjs", "\"verify:control-tower\"", "Render build control tower verify script");
  assertIncludes(errors, "render-build-fix.cjs", "\"closeout:kit\"", "Render build closeout kit script");
  assertIncludes(errors, "render-build-fix.cjs", "\"ops:infra-autopilot\"", "Render build infra autopilot script");
  assertIncludes(errors, "render-build-fix.cjs", "fs.rmSync(\"node_modules\"", "Render node_modules cleanup");

  const textFiles = walk(root)
    .filter((file) => /\.(js|json|env|txt|md|yaml|yml|sql)$/i.test(file))
    .filter((file) => fs.statSync(file).size <= 1024 * 1024);

  const forbiddenPatterns = [
    { regex: /v1\.7\.5-1-5m-worker-failfast-20260627/, label: "old backend version" },
    { regex: /v1\.7\.6-1-5m-readiness-doctor-20260627/, label: "old backend version" },
    { regex: /v1\.7\.7-1-5m-ops-observability-20260627/, label: "old backend version" },
    { regex: /v1\.7\.8-1-5m-runtime-capacity-20260627/, label: "old backend version" },
    { regex: /v1\.7\.9-3m-sharded-scanner-20260627/, label: "old backend version" },
    { regex: /v1\.8\.0-100x-scale-controls-20260627/, label: "old backend version" },
    { regex: /UPLOAD_READY_SCANNER_WORKER_ONLY_1_5M_2026-06-27\.zip/, label: "old non-safe scanner zip name" },
    { regex: /UPLOAD_READY_1_5M_BACKEND_STAGING_2026-06-26\.zip/, label: "old non-safe backend zip name" },
    { regex: /ACTIVATION_FEE_TON=0(?:\r?\n|$)/, label: "old activation fee value" },
    { regex: /READY_FILLED_1_5M/, label: "confusing filled env name" }
  ];

  for (const file of textFiles) {
    const relative = path.relative(root, file);
    if (relative === path.join("scripts", "verify-package-1_5m.js")) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const item of forbiddenPatterns) {
      if (item.regex.test(text)) fail(errors, `${relative} contains ${item.label}`);
    }
  }

  if (errors.length) {
    console.error("PACKAGE CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("PACKAGE CHECK OK");
  console.log(`version=${expectedVersion}`);
  console.log(`files_checked=${textFiles.length}`);
}

main();

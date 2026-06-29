const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

const required = [
  ["BACKEND_VERSION", "v1.8.2-infra-autopilot-20260628"],
  ["OPS_DB_AUDIT_TIMEOUT_MS", "OPS_DB_AUDIT_TIMEOUT_MS"],
  ["SCALE_AUDIT_COUNT_MODE", "SCALE_AUDIT_COUNT_MODE"],
  ["/ops/scanner-shards", 'app.get("/ops/scanner-shards"'],
  ["/ops/scanner-backlog", 'app.get("/ops/scanner-backlog"'],
  ["/ops/wallet-capacity", 'app.get("/ops/wallet-capacity"'],
  ["/ops/wallet-import-plan", 'app.get("/ops/wallet-import-plan"'],
  ["/ops/redis", 'app.get("/ops/redis"'],
  ["/ops/redis-deep", 'app.get("/ops/redis-deep"'],
  ["/ops/ton-signer", 'app.get("/ops/ton-signer"'],
  ["/ops/final-gate", 'app.get("/ops/final-gate"'],
  ["/ops/launch-checklist", 'app.get("/ops/launch-checklist"'],
  ["/ops/snapshot", 'app.get("/ops/snapshot"'],
  ["/ops/control-tower", 'app.get("/ops/control-tower"'],
  ["/ops/env-contract", 'app.get("/ops/env-contract"'],
  ["/ops/scanner-worker-plan", 'app.get("/ops/scanner-worker-plan"'],
  ["/ops/blocker-actions", 'app.get("/ops/blocker-actions"'],
  ["/ops/infra-autopilot", 'app.get("/ops/infra-autopilot"'],
  ["/ops/scale-contract", 'app.get("/ops/scale-contract"'],
  ["redis health helper", "checkRedisHealth"],
  ["redis deep health helper", "checkRedisDeepHealth"],
  ["scanner distributed lock helper", "acquireScannerDistributedLock"],
  ["ton signer readiness helper", "buildTonSignerReadinessReport"],
  ["1.5M signer required flag", "REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M"],
  ["final launch gate helper", "buildFinalLaunchGate"],
  ["wallet import plan helper", "buildWalletImportPlan"],
  ["env contract helper", "buildEnvContract"],
  ["scanner worker plan helper", "buildScannerWorkerPlan"],
  ["blocker actions helper", "buildBlockerActions"],
  ["ops snapshot helper", "buildOpsSnapshot"],
  ["wallet capacity helper", "buildWalletCapacityReport"],
  ["scanner backlog helper", "buildScannerBacklogReport"],
  ["scanner shard helper", "buildScannerShardReport"],
  ["scale contract helper", "buildScaleContract"],
  ["ops timeout helper", "withOpsTimeout"],
  ["planned count mode", "planned"]
];

const errors = [];
for (const [label, pattern] of required) {
  if (!server.includes(pattern)) errors.push(`server.js missing ${label}`);
}

if (errors.length) {
  console.error("SCALE CONTRACT CHECK FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("SCALE CONTRACT CHECK OK");
console.log("endpoints=/ops/scanner-shards,/ops/scanner-backlog,/ops/wallet-capacity,/ops/wallet-import-plan,/ops/redis,/ops/redis-deep,/ops/ton-signer,/ops/final-gate,/ops/launch-checklist,/ops/snapshot,/ops/control-tower,/ops/env-contract,/ops/scanner-worker-plan,/ops/blocker-actions,/ops/infra-autopilot,/ops/scale-contract");

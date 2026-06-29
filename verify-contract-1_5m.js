process.env.WORKER_MODE = "scanner";
process.env.PAYMENT_SCANNER_ENABLED = process.env.PAYMENT_SCANNER_ENABLED || "true";

const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TONAPI_KEY",
  "TONAPI_BASE_URL"
];

function hasRealValue(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return false;
  if (/^(PASTE|CHANGE|TODO|YOUR_|placeholder)/i.test(raw)) return false;
  return true;
}

const missing = REQUIRED.filter((name) => !hasRealValue(name));
const shardCount = Math.max(1, Number(process.env.PAYMENT_SCANNER_SHARD_COUNT || 1));
const shardIndex = Number(process.env.PAYMENT_SCANNER_SHARD_INDEX || 0);

if (missing.length) {
  console.error("[scanner] Cannot start VidiPay payment scanner.");
  console.error(`[scanner] Missing required Render env: ${missing.join(", ")}`);
  console.error("[scanner] Required service type: Background Worker");
  console.error("[scanner] Required start command: npm run start:scanner");
  process.exit(1);
}

if (!Number.isInteger(shardCount) || !Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
  console.error("[scanner] Invalid shard env.");
  console.error("[scanner] PAYMENT_SCANNER_SHARD_INDEX must be between 0 and PAYMENT_SCANNER_SHARD_COUNT - 1");
  process.exit(1);
}

console.log("[scanner] Starting VidiPay payment scanner worker");
console.log(`[scanner] Shard ${shardIndex + 1}/${shardCount}`);
console.log("[scanner] Expected heartbeat endpoint: /scanner/healthz -> status=ok");

require("../server");

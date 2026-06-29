const fs = require("fs");
const path = require("path");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    out[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return out;
}

function hasValue(value) {
  return Boolean(String(value || "").trim()) && !/^(PASTE|CHANGE|TODO|YOUR_|placeholder)/i.test(String(value || "").trim());
}

function main() {
  const file = path.resolve(readArg("file", ""));
  const role = readArg("role", "api");
  if (!file || !fs.existsSync(file)) throw new Error(`Env file not found: ${file}`);
  const env = parseEnv(fs.readFileSync(file, "utf8"));
  const requiredByRole = {
    api: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_TOKEN", "BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TONAPI_KEY", "RATE_LIMIT_BACKEND", "REDIS_URL", "TON_AUTO_PAYOUT_ENABLED", "TON_SIGNER_ENABLED", "TON_SIGNER_KEYS_DIR", "TON_RPC_ENDPOINT", "TON_RPC_API_KEY"],
    scanner: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TONAPI_KEY", "TONAPI_BASE_URL", "WORKER_MODE", "PAYMENT_SCANNER_ENABLED", "PAYMENT_SCANNER_WORKER_ID", "PAYMENT_SCANNER_SHARD_COUNT", "PAYMENT_SCANNER_SHARD_INDEX"],
    signer: ["TON_AUTO_PAYOUT_ENABLED", "TON_SIGNER_ENABLED", "TON_SIGNER_KEYS_DIR", "TON_RPC_ENDPOINT", "TON_RPC_API_KEY"]
  };
  const expected = {
    api: { RATE_LIMIT_BACKEND: "redis", TON_AUTO_PAYOUT_ENABLED: "true", TON_SIGNER_ENABLED: "true" },
    scanner: { WORKER_MODE: "scanner", PAYMENT_SCANNER_ENABLED: "true" },
    signer: { TON_AUTO_PAYOUT_ENABLED: "true", TON_SIGNER_ENABLED: "true" }
  };
  const required = requiredByRole[role] || requiredByRole.api;
  const missing = required.filter((key) => !hasValue(env[key]));
  const wrong = Object.entries(expected[role] || {}).filter(([key, value]) => String(env[key] || "") !== value);
  const report = { status: missing.length || wrong.length ? "failed" : "ok", role, file, missing, wrong };
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exit(1);
}

main();

function value(name) {
  return String(process.env[name] || "").trim();
}

function isHttpsUrl(raw) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function parseNumber(name, fallback = NaN) {
  const raw = value(name);
  if (!raw) return fallback;
  return Number(raw);
}

function addMissing(errors, names) {
  for (const name of names) {
    if (!value(name)) errors.push(`Missing ${name}`);
  }
}

function checkUrl(errors, name, { required = true } = {}) {
  const raw = value(name);
  if (!raw) {
    if (required) errors.push(`Missing ${name}`);
    return;
  }
  if (!isHttpsUrl(raw)) errors.push(`${name} must be a valid https URL`);
}

function checkBoolean(errors, name, expected) {
  const raw = value(name).toLowerCase();
  if (raw !== String(expected)) {
    errors.push(`${name} must be ${expected}`);
  }
}

function checkPositiveNumber(errors, name, { min = 0, max = Number.POSITIVE_INFINITY } = {}) {
  const num = parseNumber(name);
  if (!Number.isFinite(num)) {
    errors.push(`${name} must be a number`);
    return;
  }
  if (num < min || num > max) {
    errors.push(`${name} must be between ${min} and ${max}`);
  }
}

function main() {
  const argMode = String(process.argv[2] || "").trim().toLowerCase();
  const workerMode = value("WORKER_MODE").toLowerCase();
  const scannerEnabled = value("PAYMENT_SCANNER_ENABLED").toLowerCase() === "true";
  const mode = argMode || (workerMode === "scanner" || scannerEnabled ? "scanner" : "api");

  if (!["api", "scanner"].includes(mode)) {
    throw new Error("Usage: node scripts/verify-env-1_5m.js [api|scanner]");
  }

  const errors = [];
  const warnings = [];

  addMissing(errors, [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ADMIN_TOKEN",
    "BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "PUBLIC_BACKEND_URL",
    "PUBLIC_APP_URL",
    "GAME_URL",
    "ALLOWED_ORIGINS",
    "TONAPI_KEY",
    "TONAPI_BASE_URL"
  ]);

  checkUrl(errors, "SUPABASE_URL", { required: false });
  checkUrl(errors, "PUBLIC_BACKEND_URL", { required: false });
  checkUrl(errors, "PUBLIC_APP_URL", { required: false });
  checkUrl(errors, "GAME_URL", { required: false });
  checkUrl(errors, "TONAPI_BASE_URL", { required: false });

  const rateLimitBackend = value("RATE_LIMIT_BACKEND").toLowerCase();
  if (mode === "api" && rateLimitBackend !== "redis") {
    errors.push("RATE_LIMIT_BACKEND must be redis for 1.5M API mode");
  }
  if (mode === "api" && !value("REDIS_URL")) {
    errors.push("Missing REDIS_URL");
  }
  if (mode === "scanner" && rateLimitBackend !== "redis") {
    warnings.push("Scanner worker is using memory rate limit fallback; this is OK for scanner-only worker");
  }
  if (mode === "scanner" && !value("REDIS_URL")) {
    warnings.push("REDIS_URL is empty; scanner can still run, but API service should use Redis for 1.5M traffic");
  }

  checkPositiveNumber(errors, "ACTIVATION_DEPOSIT_TON", { min: 0.000001, max: 1000000 });
  checkPositiveNumber(errors, "TON_PAYMENT_AMOUNT", { min: 0.000001, max: 1000000 });
  checkPositiveNumber(errors, "PAYMENT_MIN_RECEIVED_TON", { min: 0.000001, max: 1000000 });
  checkPositiveNumber(errors, "PAYMENT_MAX_RECEIVED_TON", { min: 0.000001, max: 1000000 });
  checkPositiveNumber(errors, "WALLET_UNLOCK_REQUIRED_USD", { min: 0, max: 1000000000 });
  checkPositiveNumber(errors, "SETTINGS_CACHE_TTL_MS", { min: 100, max: 60000 });

  const minTon = parseNumber("PAYMENT_MIN_RECEIVED_TON");
  const amountTon = parseNumber("TON_PAYMENT_AMOUNT");
  const maxTon = parseNumber("PAYMENT_MAX_RECEIVED_TON");
  if (Number.isFinite(minTon) && Number.isFinite(amountTon) && Number.isFinite(maxTon)) {
    if (minTon > amountTon || amountTon > maxTon) {
      errors.push("Expected PAYMENT_MIN_RECEIVED_TON <= TON_PAYMENT_AMOUNT <= PAYMENT_MAX_RECEIVED_TON");
    }
  }

  if (mode === "api") {
    checkBoolean(errors, "PAYMENT_SCANNER_ENABLED", false);
    if (workerMode === "scanner") errors.push("API service must not set WORKER_MODE=scanner");
    checkPositiveNumber(errors, "PORT", { min: 1, max: 65535 });
  }

  if (mode === "scanner") {
    if (workerMode !== "scanner") errors.push("Scanner service must set WORKER_MODE=scanner");
    checkBoolean(errors, "PAYMENT_SCANNER_ENABLED", true);
    checkPositiveNumber(errors, "PAYMENT_SCAN_INTERVAL_MS", { min: 5000, max: 300000 });
    checkPositiveNumber(errors, "PAYMENT_SCAN_BATCH_SIZE", { min: 1, max: 250 });
  }

  const autoPayoutEnabled = value("TON_AUTO_PAYOUT_ENABLED").toLowerCase() === "true" ||
    value("TON_SIGNER_ENABLED").toLowerCase() === "true";
  if (autoPayoutEnabled) {
    addMissing(errors, ["TON_RPC_ENDPOINT", "TON_SIGNER_KEYS_DIR"]);
    if (!value("TON_RPC_KEY")) warnings.push("TON_RPC_KEY is empty; this is OK only if your TON RPC endpoint does not require a key");
  } else {
    warnings.push("TON auto payout is not enabled; deposit scanning can work, but automatic refund payout will not run");
  }

  console.log(`VidiPay 1.5M env check mode: ${mode}`);
  for (const warning of warnings) console.warn(`WARN ${warning}`);

  if (errors.length) {
    console.error("");
    console.error("ENV CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("ENV CHECK OK");
}

main();

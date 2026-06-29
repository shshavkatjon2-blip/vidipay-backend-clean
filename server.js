const express = require("express");
const cors = require("cors");
const helmet = require("helmet"); // <-- [YANGI]: HTTP hujumlardan xavfsizlikni kuchaytirish uchun
const crypto = require("crypto"); // <-- [YANGI QO'SHILDI]: Webhook xavfsizligi (HMAC) uchun
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { TonClient, WalletContractV4, internal, SendMode } = require("@ton/ton");
const { mnemonicToPrivateKey, keyPairFromSeed, keyPairFromSecretKey } = require("@ton/crypto");
const { getHttpEndpoint } = require("@orbs-network/ton-access");
const dotenv = require("dotenv");
dotenv.config();
const localEnvPath = path.join(__dirname, ".env.local");
if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath, override: true });
}

// [YAXSHILANISH]: Muhim muhit o'zgaruvchilari (env) ni server ishga tushishidanoq tekshirish
const requiredEnvs = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "ADMIN_TOKEN",
  "FIAT_WEBHOOK_SECRET",
  "TONAPI_KEY"
];
const missingEnvs = requiredEnvs.filter(env => !process.env[env] || process.env[env].trim() === "");
if (missingEnvs.length > 0) {
  console.warn(`\n[OGOHLANTIRISH]: Quyidagi muhim .env o'zgaruvchilar Renderda kiritilmagan:\n -> ${missingEnvs.join("\n -> ")}\n\nServer vaqtinchalik xavfsiz rejimda ishga tushmoqda, lekin to'liq ishlashi uchun Render > Environment bo'limiga bu kalitlarni kiriting!\n`);
}

const app = express();

const BACKEND_VERSION = "v1.8.2-infra-autopilot-20260628";
const PROCESS_STARTED_AT = new Date();
const REQUEST_SLOW_MS = Math.max(250, Number(process.env.REQUEST_SLOW_MS || 1500));
const SERVER_KEEP_ALIVE_TIMEOUT_MS = Math.max(5000, Number(process.env.SERVER_KEEP_ALIVE_TIMEOUT_MS || 65000));
const SERVER_HEADERS_TIMEOUT_MS = Math.max(SERVER_KEEP_ALIVE_TIMEOUT_MS + 1000, Number(process.env.SERVER_HEADERS_TIMEOUT_MS || 70000));
const SERVER_REQUEST_TIMEOUT_MS = Math.max(30000, Number(process.env.SERVER_REQUEST_TIMEOUT_MS || 120000));
const SHUTDOWN_GRACE_MS = Math.max(5000, Number(process.env.SHUTDOWN_GRACE_MS || 25000));
const CAPACITY_INITIAL_USERS = Math.max(1, Number(process.env.CAPACITY_INITIAL_USERS || 100000));
const CAPACITY_TARGET_USERS = Math.max(CAPACITY_INITIAL_USERS, Number(process.env.CAPACITY_TARGET_USERS || 1500000));
const CAPACITY_3M_MIN_SCANNER_WORKERS = Math.max(1, Math.min(64, Number(process.env.CAPACITY_3M_MIN_SCANNER_WORKERS || 4)));
const CAPACITY_100X_MIN_SCANNER_WORKERS = Math.max(CAPACITY_3M_MIN_SCANNER_WORKERS, Math.min(256, Number(process.env.CAPACITY_100X_MIN_SCANNER_WORKERS || 64)));
const CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS = Math.max(CAPACITY_100X_MIN_SCANNER_WORKERS, Math.min(2048, Number(process.env.CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS || 256)));
const opsCounters = {
  requests_total: 0,
  responses_total: 0,
  errors_total: 0,
  slow_requests_total: 0,
  max_duration_ms: 0,
  last_request_at: null,
  last_slow_request_at: null,
  by_status_class: {
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0
  }
};
const serverRuntime = {
  shutting_down: false,
  shutdown_started_at: null,
  active_requests: 0,
  highest_active_requests: 0,
  last_signal: null
};
const WEBAPP_VERSION = "wallet-toncoin-v21-watch-balance-lock-20260625";
const CANONICAL_PUBLIC_BACKEND_URL = "https://vidipay-backend.onrender.com";
const CANONICAL_PUBLIC_APP_URL = "https://shshavkatjon2-blip.github.io/vidipay-fronted";
const CANONICAL_GAME_URL = `${CANONICAL_PUBLIC_APP_URL}/index.html`;
const PUBLIC_BACKEND_URL = normalizeBackendUrl(process.env.PUBLIC_BACKEND_URL, CANONICAL_PUBLIC_BACKEND_URL);
const PUBLIC_APP_URL = normalizeWebAppUrl(process.env.PUBLIC_APP_URL, CANONICAL_PUBLIC_APP_URL);
const GAME_URL = normalizeWebAppUrl(process.env.GAME_URL, CANONICAL_GAME_URL);
const LOCAL_FRONTEND_DIR = path.resolve(__dirname, "..", "..", "USE_THIS_GITHUB_PAGES_TON_WALLET_ONLY_2026-06-18");
const HAS_LOCAL_FRONTEND = fs.existsSync(path.join(LOCAL_FRONTEND_DIR, "app-v5.html"));
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const TONAPI_KEY = process.env.TONAPI_KEY || "";
const TONAPI_BASE_URL = (process.env.TONAPI_BASE_URL || "https://tonapi.io").replace(/\/$/, "");
const PAYMENT_NETWORK = "TON";
const PAYMENT_TOKEN = "TON";
const PAYMENT_TOKEN_DECIMALS = 9;
const PAYMENT_AMOUNT_TON = formatTokenAmount(process.env.ACTIVATION_DEPOSIT_TON || process.env.TON_PAYMENT_AMOUNT || "6.99");
const PAYMENT_MIN_RECEIVED_TON = formatTokenAmount(process.env.TON_PAYMENT_MIN_RECEIVED || "6.90");
const PAYMENT_MAX_RECEIVED_TON = formatTokenAmount(process.env.TON_PAYMENT_MAX_RECEIVED || "7.05");
const ACTIVATION_FEE_TON = formatTokenAmount(process.env.ACTIVATION_FEE_TON || "0.83");
const ACTIVATION_REFUND_TON = formatTokenAmount(process.env.ACTIVATION_REFUND_TON || PAYMENT_AMOUNT_TON);
const ACTIVATION_PAYOUT_TON = formatTokenAmount(process.env.ACTIVATION_PAYOUT_TON || "6.16");
const TON_AUTO_PAYOUT_ENABLED = process.env.TON_AUTO_PAYOUT_ENABLED === "true";
const TON_SIGNER_ENABLED = process.env.TON_SIGNER_ENABLED === "true";
const TON_SIGNER_NETWORK = String(process.env.TON_SIGNER_NETWORK || "mainnet").trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
const TON_SIGNER_KEYS_DIR = normalizeAddress(process.env.TON_SIGNER_KEYS_DIR || "");
const TON_RPC_ENDPOINT = normalizeAddress(process.env.TON_RPC_ENDPOINT || "");
const TON_RPC_API_KEY = normalizeAddress(process.env.TON_RPC_API_KEY || "");
const TON_PAYOUT_GAS_RESERVE = formatTokenAmount(process.env.TON_PAYOUT_GAS_RESERVE || "0.10");
const TON_PAYOUT_BODY = String(process.env.TON_PAYOUT_BODY || "VidiPay activation payout").trim() || "VidiPay activation payout";
const WALLET_UNLOCK_REQUIRED_USD = Math.max(0, Number(process.env.WALLET_UNLOCK_REQUIRED_USD || "20"));
const GROWTH_CHECKPOINT_499_USD = Math.max(0, Number(process.env.GROWTH_CHECKPOINT_499_USD || "499"));
const GROWTH_CHECKPOINT_1499_USD = Math.max(0, Number(process.env.GROWTH_CHECKPOINT_1499_USD || "1499"));
const GROWTH_CHECKPOINT_499_REFERRALS = Math.max(1, Number(process.env.GROWTH_CHECKPOINT_499_REFERRALS || "2"));
const GROWTH_CHECKPOINT_1499_REFERRALS = Math.max(GROWTH_CHECKPOINT_499_REFERRALS, Number(process.env.GROWTH_CHECKPOINT_1499_REFERRALS || "3"));
const MAIN_WITHDRAW_REFERRALS = Math.max(GROWTH_CHECKPOINT_1499_REFERRALS, Number(process.env.MAIN_WITHDRAW_REFERRALS || "4"));
const PAYMENT_ORDER_TTL_MINUTES = Math.max(1, Number(process.env.PAYMENT_ORDER_TTL_MINUTES || 5));
const PAYMENT_LATE_GRACE_MINUTES = Math.max(5, Number(process.env.PAYMENT_LATE_GRACE_MINUTES || 30));
const PAYMENT_WALLET_COOLDOWN_MINUTES = Math.max(PAYMENT_LATE_GRACE_MINUTES, Number(process.env.PAYMENT_WALLET_COOLDOWN_MINUTES || 30));
const PAYMENT_SCAN_INTERVAL_MS = Math.max(1000, Number(process.env.PAYMENT_SCAN_INTERVAL_MS || 3000));
const PAYMENT_SCAN_BATCH_SIZE = Math.max(1, Math.min(5000, Number(process.env.PAYMENT_SCAN_BATCH_SIZE || 500)));
const PAYMENT_SCAN_CONCURRENCY = Math.max(1, Math.min(128, Number(process.env.PAYMENT_SCAN_CONCURRENCY || 32)));
const PAYMENT_SCAN_JITTER_MS = Math.max(0, Math.min(60000, Number(process.env.PAYMENT_SCAN_JITTER_MS || 2500)));
const PAYMENT_SCAN_ORDER_DELAY_MS = Math.max(0, Math.min(5000, Number(process.env.PAYMENT_SCAN_ORDER_DELAY_MS || 10)));
const PAYMENT_SCAN_MAX_ERRORS_PER_RUN = Math.max(1, Math.min(10000, Number(process.env.PAYMENT_SCAN_MAX_ERRORS_PER_RUN || 500)));
const PAYMENT_SCANNER_SHARD_COUNT = Math.max(1, Math.min(2048, Number(process.env.PAYMENT_SCANNER_SHARD_COUNT || 1)));
const PAYMENT_SCANNER_SHARD_INDEX = Math.max(0, Math.min(PAYMENT_SCANNER_SHARD_COUNT - 1, Number(process.env.PAYMENT_SCANNER_SHARD_INDEX || 0)));
const PAYMENT_SCANNER_STALE_AFTER_MS = Math.max(30000, Number(process.env.PAYMENT_SCANNER_STALE_AFTER_MS || PAYMENT_SCAN_INTERVAL_MS * 8));
const PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT = Math.max(20, Math.min(2048, Number(process.env.PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT || 512)));
const OPS_SNAPSHOT_CACHE_TTL_MS = Math.max(0, Math.min(30000, Number(process.env.OPS_SNAPSHOT_CACHE_TTL_MS || 2000)));
const TONAPI_REQUEST_TIMEOUT_MS = Math.max(1000, Math.min(60000, Number(process.env.TONAPI_REQUEST_TIMEOUT_MS || 12000)));
const TONAPI_RETRY_COUNT = Math.max(0, Math.min(5, Number(process.env.TONAPI_RETRY_COUNT || 2)));
const TONAPI_RETRY_BASE_MS = Math.max(50, Math.min(10000, Number(process.env.TONAPI_RETRY_BASE_MS || 250)));
const WORKER_MODE = String(process.env.WORKER_MODE || "").trim().toLowerCase();
const SCANNER_WORKER_MODE = WORKER_MODE === "scanner";
const PAYMENT_SCANNER_ENABLED = SCANNER_WORKER_MODE && process.env.PAYMENT_SCANNER_ENABLED !== "false";
let tonSignerClientPromise = null;
let tonSignerWalletIndexCache = null;

function hasRealEnvValue(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return false;
  if (/^(PASTE|CHANGE|TODO|YOUR_|placeholder)/i.test(raw)) return false;
  return true;
}

function assertScannerWorkerEnv() {
  if (!SCANNER_WORKER_MODE) return;
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TONAPI_KEY",
    "TONAPI_BASE_URL"
  ];
  const missing = required.filter((name) => !hasRealEnvValue(name));
  if (missing.length) {
    throw new Error(`[scanner] Missing required Render env: ${missing.join(", ")}`);
  }
  if (!PAYMENT_SCANNER_ENABLED) {
    throw new Error("[scanner] PAYMENT_SCANNER_ENABLED must be true when WORKER_MODE=scanner");
  }
  if (!Number.isInteger(PAYMENT_SCANNER_SHARD_COUNT) || PAYMENT_SCANNER_SHARD_COUNT < 1) {
    throw new Error("[scanner] PAYMENT_SCANNER_SHARD_COUNT must be a positive integer");
  }
  if (!Number.isInteger(PAYMENT_SCANNER_SHARD_INDEX) || PAYMENT_SCANNER_SHARD_INDEX < 0 || PAYMENT_SCANNER_SHARD_INDEX >= PAYMENT_SCANNER_SHARD_COUNT) {
    throw new Error("[scanner] PAYMENT_SCANNER_SHARD_INDEX must be between 0 and PAYMENT_SCANNER_SHARD_COUNT - 1");
  }
}

assertScannerWorkerEnv();

function normalizeWebAppUrl(value, fallback) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return fallback;
    if (parsed.hostname !== "shshavkatjon2-blip.github.io") return fallback;
    if (!parsed.pathname.startsWith("/vidipay-fronted")) return fallback;
    return raw;
  } catch {
    return fallback;
  }
}

function normalizeBackendUrl(value, fallback) {
  const raw = String(value || "").trim().replace(/\/$/, "");
  if (!raw) return fallback;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return fallback;
    return parsed.origin + parsed.pathname.replace(/\/$/, "");
  } catch {
    return fallback;
  }
}
function toOrigin(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, "");
  }
}

const ALLOWED_ORIGINS = [
  ...(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(toOrigin)
    .filter(Boolean),
  toOrigin(PUBLIC_APP_URL),
  toOrigin(CANONICAL_PUBLIC_APP_URL),
  toOrigin(PUBLIC_BACKEND_URL),
  toOrigin(CANONICAL_PUBLIC_BACKEND_URL),
  "https://web.telegram.org",
  "https://telegram.org",
  "http://localhost:10000",
  "http://127.0.0.1:10000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
].filter(Boolean);
const ALLOWED_ORIGIN_SET = new Set(ALLOWED_ORIGINS);
const TRUSTED_STATIC_HOST_SUFFIXES = [".github.io", ".pages.dev", ".trycloudflare.com"];

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".localhost");
}

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (origin === "null") return true;
  const normalizedOrigin = toOrigin(origin);
  if (ALLOWED_ORIGIN_SET.has(normalizedOrigin)) return true;

  try {
    const { protocol, hostname } = new URL(normalizedOrigin);
    if (isLoopbackHostname(hostname)) return true;
    if (protocol === "https:" && TRUSTED_STATIC_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) return true;
    if (protocol === "https:" && (hostname === "telegram.org" || hostname.endsWith(".telegram.org"))) return true;
    return false;
  } catch {
    return false;
  }
}

app.disable("x-powered-by");

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })); // <-- [YANGI]: Serverni tashqi skanerlardan himoyalash
app.use((req, res, next) => {
  const requestId = String(req.headers["x-request-id"] || crypto.randomUUID()).slice(0, 80);
  req.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  const started = process.hrtime.bigint();
  serverRuntime.active_requests += 1;
  serverRuntime.highest_active_requests = Math.max(serverRuntime.highest_active_requests, serverRuntime.active_requests);
  opsCounters.requests_total += 1;
  opsCounters.last_request_at = new Date().toISOString();

  res.on("finish", () => {
    serverRuntime.active_requests = Math.max(0, serverRuntime.active_requests - 1);
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    const statusClass = `${Math.floor(res.statusCode / 100)}xx`;
    opsCounters.responses_total += 1;
    if (opsCounters.by_status_class[statusClass] !== undefined) {
      opsCounters.by_status_class[statusClass] += 1;
    }
    if (res.statusCode >= 500) opsCounters.errors_total += 1;
    if (durationMs > REQUEST_SLOW_MS) {
      opsCounters.slow_requests_total += 1;
      opsCounters.last_slow_request_at = new Date().toISOString();
    }
    opsCounters.max_duration_ms = Math.max(opsCounters.max_duration_ms, Math.round(durationMs));
  });

  next();
});

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedCorsOrigin(origin)) return callback(null, true);
    console.warn(`[cors] allowing unlisted origin: ${origin}`);
    return callback(null, true);
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token", "X-Request-Id"],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json());

if (HAS_LOCAL_FRONTEND) {
  app.use("/mini", express.static(LOCAL_FRONTEND_DIR, {
    index: false,
    etag: false,
    maxAge: 0,
    setHeaders(res) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; frame-src *; connect-src *;");
    }
  }));
}

const supabase = createClient(
  process.env.SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder_key"
);

const DEFAULT_BALANCE = 0;

const DEFAULT_SETTINGS = {
  view_seconds_required: 5,
  view_reward: 1,
  view_reward_per_second: 0.01,
  tier1_reward_per_second: 10,
  tier2_reward_per_second: 7,
  tier3_reward_per_second: 0.01,
  tier1_countries: "US,AU,CA,NO,CH,DE,GB,NL,SE,DK",
  tier2_countries: "FR,BE,AT,FI,IE,NZ,IT,ES,JP,KR",
  daily_bonus: 5,
  daily_view_limit: 50,
  withdraw_min_amount: 9,
  withdraw_commission_percent: 0,
  withdraw_requires_payment: true,
  withdraw_opens_at: "",
  withdraw_window_hours: 36,
  referral_bonus: 10
};
const SETTINGS_CACHE_TTL_MS = Math.max(0, Number(process.env.SETTINGS_CACHE_TTL_MS || 1500));
let settingsCache = {
  value: null,
  expiresAt: 0
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => body[field] === undefined || body[field] === null || body[field] === "");
  return missing.length ? `Kerakli fieldlar: ${missing.join(", ")}` : null;
}

const RATE_LIMIT_BACKEND = String(process.env.RATE_LIMIT_BACKEND || "memory").trim().toLowerCase();
const REDIS_URL = String(process.env.REDIS_URL || "").trim();
const REDIS_SCANNER_LOCKS_ENABLED = process.env.REDIS_SCANNER_LOCKS_ENABLED === "true";
const REDIS_SCANNER_LOCKS_REQUIRED = process.env.REDIS_SCANNER_LOCKS_REQUIRED === "true";
const REDIS_SCANNER_LOCK_TTL_MS = Math.max(5000, Math.min(300000, Number(process.env.REDIS_SCANNER_LOCK_TTL_MS || 60000)));
const REDIS_DEEP_CHECK_ENABLED = process.env.REDIS_DEEP_CHECK_ENABLED !== "false";
const OPS_DB_AUDIT_TIMEOUT_MS = Math.max(1000, Math.min(30000, Number(process.env.OPS_DB_AUDIT_TIMEOUT_MS || 8000)));
const SCANNER_HEARTBEAT_CACHE_TTL_MS = Math.max(0, Math.min(10000, Number(process.env.SCANNER_HEARTBEAT_CACHE_TTL_MS || 1500)));
const WALLET_CAPACITY_CACHE_TTL_MS = Math.max(0, Math.min(60000, Number(process.env.WALLET_CAPACITY_CACHE_TTL_MS || 15000)));
const SCANNER_BACKLOG_CACHE_TTL_MS = Math.max(0, Math.min(60000, Number(process.env.SCANNER_BACKLOG_CACHE_TTL_MS || 10000)));
const REDIS_HEALTH_CACHE_TTL_MS = Math.max(0, Math.min(30000, Number(process.env.REDIS_HEALTH_CACHE_TTL_MS || 5000)));
const SCALE_AUDIT_COUNT_MODE = ["exact", "planned", "estimated"].includes(String(process.env.SCALE_AUDIT_COUNT_MODE || "").trim().toLowerCase())
  ? String(process.env.SCALE_AUDIT_COUNT_MODE).trim().toLowerCase()
  : "planned";
const REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M = process.env.REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M !== "false";
const FINAL_GATE_MIN_SCANNER_WORKERS = Math.max(1, Math.min(2048, Number(process.env.FINAL_GATE_MIN_SCANNER_WORKERS || CAPACITY_3M_MIN_SCANNER_WORKERS)));
const WALLET_POOL_BUFFER = Math.max(0, Math.min(5000000, Number(process.env.WALLET_POOL_BUFFER || 0)));
const rateBuckets = new Map();
let redisClientPromise = null;
let redisRateLimitWarned = false;
let redisScannerLockWarned = false;

// [YAXSHILANISH]: Har 1 soatda eskirgan rate limitlarni tozalash (Memory leak'ni oldini olish)
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) rateBuckets.delete(key);
  }
}, 60 * 60 * 1000);

function clientRateKey(req, scope) {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = (raw || req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
  return `${scope}:${ip}`;
}

function getRedisClient() {
  const redisRequested = RATE_LIMIT_BACKEND === "redis" || REDIS_SCANNER_LOCKS_ENABLED || REDIS_DEEP_CHECK_ENABLED;
  if (!redisRequested || !REDIS_URL) return null;
  if (redisClientPromise) return redisClientPromise;

  redisClientPromise = (async () => {
    const { createClient } = require("redis");
    const client = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy(retries) {
          return Math.min(1000 + retries * 250, 5000);
        }
      }
    });

    client.on("error", () => {});
    await client.connect();
    return client;
  })().catch((err) => {
    redisClientPromise = null;
    throw err;
  });

  return redisClientPromise;
}

async function checkRedisHealth(options = {}) {
  return getCachedOpsValue(opsFastCaches.redis, REDIS_HEALTH_CACHE_TTL_MS, async () => {
    if (RATE_LIMIT_BACKEND !== "redis") {
      return {
        ok: false,
        backend: RATE_LIMIT_BACKEND,
        configured: Boolean(REDIS_URL),
        message: "RATE_LIMIT_BACKEND is not redis"
      };
    }
    if (!REDIS_URL) {
      return {
        ok: false,
        backend: RATE_LIMIT_BACKEND,
        configured: false,
        message: "REDIS_URL is missing"
      };
    }
    try {
      const client = await withOpsTimeout(getRedisClient(), "redis_connect");
      const pong = await withOpsTimeout(client.ping(), "redis_ping");
      return {
        ok: pong === "PONG",
        backend: RATE_LIMIT_BACKEND,
        configured: true,
        ping: pong,
        message: pong === "PONG" ? "Redis is connected" : "Redis ping returned unexpected response"
      };
    } catch (err) {
      return {
        ok: false,
        backend: RATE_LIMIT_BACKEND,
        configured: true,
        error: err.message || String(err)
      };
    }
  }, options);
}

async function checkRedisDeepHealth(options = {}) {
  return getCachedOpsValue(opsFastCaches.redisDeep, REDIS_HEALTH_CACHE_TTL_MS, async () => {
    const report = {
      ok: false,
      configured: Boolean(REDIS_URL),
      backend: RATE_LIMIT_BACKEND,
      scanner_locks_enabled: REDIS_SCANNER_LOCKS_ENABLED,
      scanner_locks_required: REDIS_SCANNER_LOCKS_REQUIRED,
      checks: [],
      message: ""
    };

    function push(name, ok, detail = "") {
      report.checks.push({ name, ok: Boolean(ok), detail });
    }

    if (!REDIS_DEEP_CHECK_ENABLED) {
      report.message = "REDIS_DEEP_CHECK_ENABLED=false";
      push("deep_check_enabled", false, report.message);
      return report;
    }
    if (!REDIS_URL) {
      report.message = "REDIS_URL is missing";
      push("redis_url", false, report.message);
      return report;
    }

    const key = `vidipay:ops:deep:${crypto.randomUUID()}`;
    const lockKey = `vidipay:ops:lock:${crypto.randomUUID()}`;
    const lockValue = `${PROCESS_STARTED_AT.toISOString()}:${crypto.randomUUID()}`;
    try {
      const client = await withOpsTimeout(getRedisClient(), "redis_deep_connect");
      const ping = await withOpsTimeout(client.ping(), "redis_deep_ping");
      push("ping", ping === "PONG", ping);

      await withOpsTimeout(client.set(key, "ok", { PX: 15000 }), "redis_deep_set");
      const value = await withOpsTimeout(client.get(key), "redis_deep_get");
      push("set_get", value === "ok", value || "empty");

      const lockResult = await withOpsTimeout(client.set(lockKey, lockValue, { NX: true, PX: REDIS_SCANNER_LOCK_TTL_MS }), "redis_deep_lock");
      push("nx_px_lock", lockResult === "OK", lockResult || "not_acquired");

      await withOpsTimeout(client.del(key), "redis_deep_del");
      if (lockResult === "OK") await releaseRedisLock(lockKey, lockValue);

      report.ok = report.checks.every((item) => item.ok);
      report.message = report.ok ? "Redis ping, set/get, TTL lock are working" : "Redis deep checks failed";
      return report;
    } catch (err) {
      report.error = err.message || String(err);
      report.message = "Redis deep check failed";
      return report;
    }
  }, options);
}

async function releaseRedisLock(key, value) {
  const client = await getRedisClient();
  if (!client) return false;
  const script = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  try {
    const result = await client.eval(script, { keys: [key], arguments: [value] });
    return Number(result) === 1;
  } catch {
    const current = await client.get(key).catch(() => null);
    if (current === value) {
      await client.del(key).catch(() => {});
      return true;
    }
    return false;
  }
}

async function acquireScannerDistributedLock() {
  if (!SCANNER_WORKER_MODE || !REDIS_SCANNER_LOCKS_ENABLED) {
    return { enabled: false, acquired: true, key: null, value: null, message: "scanner Redis lock disabled" };
  }
  if (!REDIS_URL) {
    const message = "REDIS_URL is missing for scanner Redis lock";
    if (REDIS_SCANNER_LOCKS_REQUIRED) throw new Error(message);
    if (!redisScannerLockWarned) {
      redisScannerLockWarned = true;
      console.warn("[scanner] Redis lock skipped:", message);
    }
    return { enabled: true, acquired: true, key: null, value: null, message };
  }

  const key = [
    "vidipay:scanner:lock",
    PAYMENT_NETWORK,
    PAYMENT_TOKEN,
    PAYMENT_SCANNER_SHARD_COUNT,
    PAYMENT_SCANNER_SHARD_INDEX
  ].join(":");
  const value = `${PAYMENT_SCANNER_WORKER_ID}:${Date.now()}:${crypto.randomUUID()}`;
  try {
    const client = await getRedisClient();
    const result = await client.set(key, value, { NX: true, PX: REDIS_SCANNER_LOCK_TTL_MS });
    return {
      enabled: true,
      acquired: result === "OK",
      key,
      value,
      ttl_ms: REDIS_SCANNER_LOCK_TTL_MS,
      message: result === "OK" ? "scanner Redis lock acquired" : "scanner shard is locked by another worker"
    };
  } catch (err) {
    if (REDIS_SCANNER_LOCKS_REQUIRED) throw err;
    if (!redisScannerLockWarned) {
      redisScannerLockWarned = true;
      console.warn("[scanner] Redis lock unavailable, continuing without lock:", err.message);
    }
    return {
      enabled: true,
      acquired: true,
      key,
      value: null,
      ttl_ms: REDIS_SCANNER_LOCK_TTL_MS,
      message: `Redis lock unavailable, fallback allowed: ${err.message || String(err)}`
    };
  }
}

function applyMemoryRateLimit(key, limit, windowMs, now) {
  const bucket = rateBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= limit;
}

function rateLimit(scope, limit, windowMs) {
  return async (req, res, next) => {
    const now = Date.now();
    const key = clientRateKey(req, scope);

    if (RATE_LIMIT_BACKEND === "redis" && REDIS_URL) {
      try {
        const client = await getRedisClient();
        if (client) {
          const redisKey = `vidipay:rate:${key}`;
          const count = await client.incr(redisKey);
          if (count === 1) await client.pExpire(redisKey, windowMs);
          if (count > limit) {
            return res.status(429).json({
              error: "Juda ko'p so'rov yuborildi. Birozdan keyin urinib ko'ring."
            });
          }
          return next();
        }
      } catch (err) {
        if (!redisRateLimitWarned) {
          redisRateLimitWarned = true;
          console.warn("[rate-limit] redis unavailable, using memory fallback:", err.message);
        }
      }
    }

    if (!applyMemoryRateLimit(key, limit, windowMs, now)) {
      return res.status(429).json({
        error: "Juda ko'p so'rov yuborildi. Birozdan keyin urinib ko'ring."
      });
    }

    return next();
  };
}

const ipCountryCache = new Map();

function getFirstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getClientIp(req) {
  const forwarded = getFirstHeaderValue(req.headers["cf-connecting-ip"]) ||
    getFirstHeaderValue(req.headers["true-client-ip"]) ||
    getFirstHeaderValue(req.headers["x-real-ip"]) ||
    getFirstHeaderValue(req.headers["x-forwarded-for"]) ||
    req.socket?.remoteAddress ||
    "";
  return String(forwarded).split(",")[0].trim().replace(/^::ffff:/, "");
}

function isPrivateIp(ip) {
  const value = String(ip || "").trim();
  if (!value || value === "unknown") return true;
  if (value === "::1" || value === "127.0.0.1" || value.startsWith("10.") || value.startsWith("192.168.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(value)) return true;
  if (value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")) return true;
  return false;
}

function detectCountryFromHeaders(req) {
  const headerPairs = [
    ["cf-ipcountry", "cloudflare"],
    ["x-vercel-ip-country", "vercel"],
    ["x-country-code", "country_header"],
    ["x-client-country", "client_header"],
    ["cloudfront-viewer-country", "cloudfront"],
    ["x-appengine-country", "appengine"]
  ];

  for (const [headerName, source] of headerPairs) {
    const countryCode = normalizeCountryCode(getFirstHeaderValue(req.headers[headerName]));
    if (countryCode && countryCode !== "XX") {
      return {
        ip: getClientIp(req),
        country_code: countryCode,
        country_name: countryCode,
        country_source: source
      };
    }
  }

  return null;
}

app.use("/admin", rateLimit("admin", 80, 15 * 60 * 1000));
app.use("/telegram", rateLimit("telegram", 300, 15 * 60 * 1000));
app.use(rateLimit("public", 600, 15 * 60 * 1000));

async function findUserByTelegramId(telegramId) {
  return supabase
    .from("users")
    .select("*")
    .eq("telegram_id", String(telegramId))
    .single();
}

async function normalizeDailyUser(user) {
  const day = todayKey();

  if (user.daily_stats_date === day) {
    return user;
  }

  const { data, error } = await supabase
    .from("users")
    .update({
      daily_views: 0,
      daily_income: 0,
      daily_watch_seconds: 0,
      daily_stats_date: day,
      updated_at: new Date().toISOString()
    })
    .eq("telegram_id", String(user.telegram_id))
    .select()
    .single();

  if (error) throw error;

  return data;
}

async function getSettings() {
  const now = Date.now();
  if (SETTINGS_CACHE_TTL_MS > 0 && settingsCache.value && settingsCache.expiresAt > now) {
    return { ...settingsCache.value };
  }

  const { data, error } = await supabase
    .from("admin_settings")
    .select("key, value");

  if (error) throw error;

  const settings = { ...DEFAULT_SETTINGS };

  for (const item of data || []) {
    settings[item.key] = normalizeSettingValue(item.value);
  }

  settingsCache = {
    value: { ...settings },
    expiresAt: now + SETTINGS_CACHE_TTL_MS
  };

  return settings;
}

function clearSettingsCache() {
  settingsCache = {
    value: null,
    expiresAt: 0
  };
}

function normalizeSettingValue(value) {
  if (value === "\"\"" || value === "''") return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
  return value;
}

function numberSetting(settings, key) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : Number(DEFAULT_SETTINGS[key]);
}

function booleanSetting(settings, key) {
  const value = settings[key];
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return Boolean(DEFAULT_SETTINGS[key]);
}

function listSetting(settings, key) {
  const value = settings[key] || DEFAULT_SETTINGS[key] || "";
  return String(value)
    .split(",")
    .map((item) => normalizeCountryCode(item))
    .filter(Boolean);
}

function adminListParams(req, defaults = {}) {
  const maxLimit = Number(defaults.maxLimit || 500);
  const defaultLimit = Number(defaults.defaultLimit || 200);
  const limit = Math.max(1, Math.min(maxLimit, Number(req.query.limit || defaultLimit)));
  const page = Math.max(1, Number(req.query.page || 1));
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  return { limit, page, from, to };
}

function attachPaginationHeaders(res, params, rows) {
  res.setHeader("X-Page", String(params.page));
  res.setHeader("X-Limit", String(params.limit));
  res.setHeader("X-Has-More", String((rows || []).length >= params.limit));
}

function wantsPagedObject(req) {
  return ["1", "true", "yes"].includes(String(req.query.meta || req.query.pagination || "").toLowerCase());
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function normalizeAddress(value) {
  return String(value || "").trim();
}

function formatTokenAmount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return "0";
  return number.toFixed(PAYMENT_TOKEN_DECIMALS).replace(/\.?0+$/, "");
}

function normalizeBase64Url(value) {
  const clean = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return clean.padEnd(Math.ceil(clean.length / 4) * 4, "=");
}

function decodeTonAddressToRaw(value) {
  const address = normalizeAddress(value);
  if (/^-?\d+:[a-fA-F0-9]{64}$/.test(address)) return address.toLowerCase();
  if (!/^[A-Za-z0-9_-]{48}$/.test(address)) return "";

  try {
    const bytes = Buffer.from(normalizeBase64Url(address), "base64");
    if (bytes.length !== 36) return "";
    const workchainByte = bytes[1];
    const workchain = workchainByte === 255 ? -1 : workchainByte;
    return `${workchain}:${bytes.subarray(2, 34).toString("hex")}`;
  } catch {
    return "";
  }
}

function isLikelyTonAddress(value) {
  return Boolean(decodeTonAddressToRaw(value));
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function buildPaymentWalletAssignment(telegramId, orderId, expiresAt, nowIso) {
  const payload = {
    assigned_to_telegram_id: String(telegramId),
    assigned_until: expiresAt,
    cooldown_until: null,
    last_assigned_at: nowIso,
    updated_at: nowIso
  };

  if (isUuidLike(orderId)) {
    payload.assigned_order_id = orderId;
  }

  return payload;
}

function isUniqueConstraintError(error) {
  return error?.code === "23505" || /unique constraint/i.test(String(error?.message || ""));
}

function sameTonAddress(left, right) {
  const a = decodeTonAddressToRaw(left);
  const b = decodeTonAddressToRaw(right);
  return Boolean(a && b && a === b);
}

function decimalToUnits(value, decimals = PAYMENT_TOKEN_DECIMALS) {
  const raw = String(value ?? "0").trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) return 0n;
  const [whole, fraction = ""] = raw.split(".");
  const paddedFraction = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * (10n ** BigInt(decimals)) + BigInt(paddedFraction || "0");
}

function unitsToDecimalString(value, decimals = PAYMENT_TOKEN_DECIMALS) {
  const units = BigInt(String(value || "0"));
  const base = 10n ** BigInt(decimals);
  const whole = units / base;
  const fraction = String(units % base).padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function normalizePaymentOrder(order) {
  if (!order) return null;
  const amount = order.required_amount ?? order.amount ?? PAYMENT_AMOUNT_TON;
  const wallet = [order.wallet_address, order.to_wallet, order.admin_wallet]
    .map((value) => normalizeAddress(value))
    .find((value) => isLikelyTonAddress(value)) || "";
  return {
    ...order,
    amount: Number(amount),
    required_amount: Number(amount),
    payment_min_received_amount: Number(PAYMENT_MIN_RECEIVED_TON),
    payment_max_received_amount: Number(PAYMENT_MAX_RECEIVED_TON),
    activation_refund_amount: Number(ACTIVATION_REFUND_TON),
    activation_payout_amount: Number(ACTIVATION_PAYOUT_TON),
    network: order.network || PAYMENT_NETWORK,
    token: order.token || PAYMENT_TOKEN,
    to_wallet: wallet,
    admin_wallet: wallet,
    wallet_address: wallet
  };
}

function splitMnemonicWords(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return String(value || "")
    .trim()
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function listTonSignerWalletFiles() {
  if (!TON_SIGNER_KEYS_DIR || !fs.existsSync(TON_SIGNER_KEYS_DIR)) return [];

  return fs.readdirSync(TON_SIGNER_KEYS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(TON_SIGNER_KEYS_DIR, entry.name));
}

function normalizeHex(value, expectedLength) {
  const hex = String(value || "").trim().replace(/^0x/i, "");
  if (!new RegExp(`^[a-fA-F0-9]{${expectedLength}}$`).test(hex)) return "";
  return hex.toLowerCase();
}

function getTonSignerWalletIndex() {
  if (tonSignerWalletIndexCache?.dir === TON_SIGNER_KEYS_DIR) return tonSignerWalletIndexCache.map;

  const map = new Map();
  for (const filePath of listTonSignerWalletFiles()) {
    try {
      const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const address = normalizeAddress(payload.address || payload.wallet_address);
      if (isLikelyTonAddress(address)) map.set(address, filePath);
    } catch {
      continue;
    }
  }

  tonSignerWalletIndexCache = { dir: TON_SIGNER_KEYS_DIR, map };
  return map;
}

function readTonSignerWalletRecord(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const address = normalizeAddress(payload.address || payload.wallet_address);
  const mnemonic = splitMnemonicWords(payload.mnemonic || payload.mnemonics || payload.seed_phrase);
  const seedHex = normalizeHex(payload.seed_hex, 64);
  const secretKeyHex = normalizeHex(payload.secret_key_hex, 128);
  const workchain = Number.isInteger(payload.workchain) ? payload.workchain : Number(payload.workchain ?? 0);

  if (!isLikelyTonAddress(address)) {
    throw new Error(`TON signer wallet faylida address noto'g'ri: ${path.basename(filePath)}`);
  }
  if (mnemonic.length < 12 && !seedHex && !secretKeyHex) {
    throw new Error(`TON signer wallet faylida kalit yetarli emas: ${path.basename(filePath)}`);
  }

  return {
    file_path: filePath,
    label: normalizeAddress(payload.label || path.basename(filePath, ".json")) || path.basename(filePath, ".json"),
    address,
    mnemonic,
    seed_hex: seedHex,
    secret_key_hex: secretKeyHex,
    workchain: Number.isFinite(workchain) ? workchain : 0
  };
}

function findTonSignerWalletByAddress(address) {
  const target = normalizeAddress(address);
  if (!target) return null;

  for (const [recordAddress, filePath] of getTonSignerWalletIndex()) {
    try {
      if (sameTonAddress(recordAddress, target)) return readTonSignerWalletRecord(filePath);
    } catch {
      continue;
    }
  }

  return null;
}

async function getTonSignerKeyPair(signerWallet) {
  if (signerWallet?.mnemonic?.length >= 12) {
    return mnemonicToPrivateKey(signerWallet.mnemonic);
  }
  if (signerWallet?.seed_hex) {
    return keyPairFromSeed(Buffer.from(signerWallet.seed_hex, "hex"));
  }
  if (signerWallet?.secret_key_hex) {
    return keyPairFromSecretKey(Buffer.from(signerWallet.secret_key_hex, "hex"));
  }
  throw new Error(`Kalit formati yaroqsiz: ${signerWallet?.label || "unknown"}`);
}

function getTonAutoPayoutStatusSummary() {
  const keysDirExists = Boolean(TON_SIGNER_KEYS_DIR && fs.existsSync(TON_SIGNER_KEYS_DIR));
  const walletFiles = keysDirExists ? listTonSignerWalletFiles() : [];

  return {
    requested: TON_AUTO_PAYOUT_ENABLED,
    signer_enabled: TON_SIGNER_ENABLED,
    signer_ready: TON_SIGNER_ENABLED && keysDirExists,
    active: TON_AUTO_PAYOUT_ENABLED && TON_SIGNER_ENABLED && keysDirExists,
    network: TON_SIGNER_NETWORK,
    keys_dir: TON_SIGNER_KEYS_DIR || "",
    keys_dir_exists: keysDirExists,
    wallet_files: walletFiles.length,
    rpc_endpoint: TON_RPC_ENDPOINT || "auto:orbs-ton-access"
  };
}

async function buildTonSignerReadinessReport() {
  const signer = getTonAutoPayoutStatusSummary();
  let rpc = {
    ok: false,
    configured: Boolean(TON_RPC_ENDPOINT),
    endpoint: TON_RPC_ENDPOINT || "auto:orbs-ton-access"
  };

  if (TON_SIGNER_ENABLED) {
    try {
      const client = await withOpsTimeout(getTonSignerClient(), "ton_signer_client");
      const masterchain = await withOpsTimeout(client.getMasterchainInfo(), "ton_masterchain_info");
      rpc = {
        ok: Boolean(masterchain?.last),
        configured: Boolean(TON_RPC_ENDPOINT),
        endpoint: TON_RPC_ENDPOINT || "auto:orbs-ton-access",
        last_seqno: masterchain?.last?.seqno || null
      };
    } catch (err) {
      rpc = {
        ok: false,
        configured: Boolean(TON_RPC_ENDPOINT),
        endpoint: TON_RPC_ENDPOINT || "auto:orbs-ton-access",
        error: err.message || String(err)
      };
    }
  }

  return {
    ok: Boolean(TON_AUTO_PAYOUT_ENABLED && TON_SIGNER_ENABLED && signer.keys_dir_exists && signer.wallet_files > 0 && rpc.ok),
    require_for_1_5m: REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M,
    auto_payout_enabled: TON_AUTO_PAYOUT_ENABLED,
    signer_enabled: TON_SIGNER_ENABLED,
    signer,
    rpc,
    payout_amount_ton: Number(ACTIVATION_PAYOUT_TON),
    gas_reserve_ton: Number(TON_PAYOUT_GAS_RESERVE)
  };
}

async function getTonSignerClient() {
  if (!tonSignerClientPromise) {
    tonSignerClientPromise = (async () => {
      const endpoint = TON_RPC_ENDPOINT || await getHttpEndpoint({ network: TON_SIGNER_NETWORK });
      return new TonClient({
        endpoint,
        apiKey: TON_RPC_API_KEY || undefined
      });
    })().catch((error) => {
      tonSignerClientPromise = null;
      throw error;
    });
  }

  return tonSignerClientPromise;
}

async function findLatestConfirmedPaymentOrder(telegramId) {
  const { data, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("telegram_id", String(telegramId))
    .eq("status", "confirmed")
    .not("wallet_address", "is", null)
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== "PGRST116") throw error;
  return data || null;
}

async function findPersistentUserPaymentOrder(telegramId) {
  const confirmedOrder = await findLatestConfirmedPaymentOrder(telegramId);
  if (confirmedOrder?.wallet_address) return normalizePaymentOrder(confirmedOrder);

  const { data: latestOrder, error: latestOrderError } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("telegram_id", String(telegramId))
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .not("wallet_address", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestOrderError && latestOrderError.code !== "PGRST116") throw latestOrderError;
  if (latestOrder?.wallet_address) return normalizePaymentOrder(latestOrder);

  const { data: wallet, error: walletError } = await supabase
    .from("payment_wallets")
    .select("address,last_assigned_at,assigned_until")
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .eq("is_active", true)
    .eq("assigned_to_telegram_id", String(telegramId))
    .order("last_assigned_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (walletError && !["42P01", "42703", "PGRST116"].includes(walletError.code)) throw walletError;
  if (!wallet?.address || !isLikelyTonAddress(wallet.address)) return null;

  const expiresAt = wallet.assigned_until || addMinutes(new Date(), PAYMENT_ORDER_TTL_MINUTES).toISOString();
  const repairedOrder = await createOrUpdatePaymentOrderWithWallet(telegramId, wallet.address, expiresAt).catch((err) => {
    console.warn("[payments] persistent wallet order repair skipped:", err.message);
    return null;
  });
  if (repairedOrder?.wallet_address) return repairedOrder;

  return normalizePaymentOrder({
    id: `wallet-${String(telegramId)}`,
    telegram_id: String(telegramId),
    network: PAYMENT_NETWORK,
    token: PAYMENT_TOKEN,
    status: "assigned",
    amount: PAYMENT_AMOUNT_TON,
    required_amount: PAYMENT_AMOUNT_TON,
    wallet_address: wallet.address,
    created_at: wallet.last_assigned_at || new Date().toISOString(),
    updated_at: wallet.last_assigned_at || new Date().toISOString(),
    expires_at: wallet.assigned_until || null
  });
}

async function createOrUpdatePaymentOrderWithWallet(telegramId, walletAddress, expiresAt, now = new Date()) {
  const userId = String(telegramId);
  const address = normalizeAddress(walletAddress);
  if (!isLikelyTonAddress(address)) return null;

  let order = await getLatestPendingPaymentOrder(userId);
  if (!order) {
    const { data: insertedOrder, error: insertError } = await supabase
      .from("payment_orders")
      .insert({
        telegram_id: userId,
        network: PAYMENT_NETWORK,
        token: PAYMENT_TOKEN,
        admin_wallet: address,
        amount: PAYMENT_AMOUNT_TON,
        required_amount: PAYMENT_AMOUNT_TON,
        status: "pending",
        wallet_address: address,
        assigned_at: now.toISOString(),
        expires_at: expiresAt
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code !== "23505") throw insertError;
      order = await getLatestPendingPaymentOrder(userId);
    } else {
      order = normalizePaymentOrder(insertedOrder);
    }
  }

  if (!order?.id) return null;

  const { data: updatedOrder, error: orderError } = await supabase
    .from("payment_orders")
    .update({
      wallet_address: address,
      admin_wallet: address,
      amount: PAYMENT_AMOUNT_TON,
      required_amount: PAYMENT_AMOUNT_TON,
      assigned_at: now.toISOString(),
      expires_at: expiresAt,
      last_checked_at: null,
      updated_at: now.toISOString()
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .select()
    .single();

  if (orderError) throw orderError;

  const { error: walletError } = await supabase
    .from("payment_wallets")
    .update(buildPaymentWalletAssignment(userId, updatedOrder.id, expiresAt, now.toISOString()))
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .eq("address", address);

  if (walletError && !["42P01", "42703"].includes(walletError.code)) throw walletError;

  return normalizePaymentOrder(updatedOrder);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTonSeqnoChange(contract, previousSeqno, attempts = 24, delayMs = 1500) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);
    const currentSeqno = await contract.getSeqno();
    if (currentSeqno > previousSeqno) return currentSeqno;
  }
  return null;
}

async function markWithdrawAutoPayoutError(withdrawId, message, options = {}) {
  if (!withdrawId || !message) return null;

  const { data: current } = await supabase
    .from("withdraws")
    .select("admin_note")
    .eq("id", withdrawId)
    .maybeSingle();

  const notePrefix = current?.admin_note ? `${String(current.admin_note).trim()}\n` : "";
  const updateBody = {
    admin_note: `${notePrefix}Auto payout failed: ${message}`.trim()
  };

  if (options.status) {
    updateBody.status = options.status;
    updateBody.processed_at = new Date().toISOString();
  }

  const { data } = await supabase
    .from("withdraws")
    .update(updateBody)
    .eq("id", withdrawId)
    .select()
    .maybeSingle();

  return data || null;
}

async function sendTonPayoutFromPoolWallet({ sourceWalletAddress, destinationWalletAddress, amountTon, comment }) {
  if (!TON_SIGNER_ENABLED) {
    throw new Error("TON signer yoqilmagan");
  }
  if (!TON_SIGNER_KEYS_DIR) {
    throw new Error("TON_SIGNER_KEYS_DIR ko'rsatilmagan");
  }

  const signerWallet = findTonSignerWalletByAddress(sourceWalletAddress);
  if (!signerWallet) {
    throw new Error(`Kalit topilmadi: ${sourceWalletAddress}`);
  }

  const keyPair = await getTonSignerKeyPair(signerWallet);
  const wallet = WalletContractV4.create({
    workchain: signerWallet.workchain,
    publicKey: keyPair.publicKey
  });
  const derivedAddress = wallet.address.toString({
    urlSafe: true,
    bounceable: true,
    testOnly: TON_SIGNER_NETWORK === "testnet"
  });

  if (!sameTonAddress(derivedAddress, signerWallet.address)) {
    throw new Error(`Signer fayli addressi bilan mnemonic mos emas: ${signerWallet.label}`);
  }

  const client = await getTonSignerClient();
  const contract = client.open(wallet);
  const balance = await contract.getBalance();
  const payoutNano = decimalToUnits(amountTon);
  const reserveNano = decimalToUnits(TON_PAYOUT_GAS_RESERVE);

  if (balance < payoutNano + reserveNano) {
    throw new Error(`Source walletda payout va gas uchun TON yetarli emas: ${signerWallet.address}`);
  }

  const seqno = await contract.getSeqno();
  const normalizedDestination = normalizeAddress(destinationWalletAddress);

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    sendMode: SendMode.PAY_GAS_SEPARATELY,
    messages: [internal({
      to: normalizedDestination,
      value: amountTon,
      bounce: false,
      body: comment || TON_PAYOUT_BODY
    })]
  });

  const confirmedSeqno = await waitForTonSeqnoChange(contract, seqno);
  if (!confirmedSeqno) {
    const timeoutError = new Error(`TON payout yuborildi, lekin seqno tasdiqlanmadi: source=${signerWallet.address}, seqno=${seqno}`);
    timeoutError.payoutSubmitted = true;
    timeoutError.seqno = seqno;
    throw timeoutError;
  }

  return {
    source_wallet_address: derivedAddress,
    destination_wallet_address: normalizedDestination,
    amount_ton: Number(amountTon),
    seqno,
    confirmed_seqno: confirmedSeqno
  };
}

async function tryAutoProcessDepositRefundWithdraw(withdraw) {
  const confirmedOrder = await findLatestConfirmedPaymentOrder(withdraw.telegram_id);
  if (!confirmedOrder?.wallet_address) {
    throw new Error("User uchun tasdiqlangan TON aktivatsiya hamyoni topilmadi");
  }

  const payout = await sendTonPayoutFromPoolWallet({
    sourceWalletAddress: confirmedOrder.wallet_address,
    destinationWalletAddress: withdraw.wallet_address,
    amountTon: ACTIVATION_PAYOUT_TON,
    comment: `${TON_PAYOUT_BODY} #${String(withdraw.telegram_id)}`
  });

  const processedAt = new Date().toISOString();
  const adminNote = [
    "Auto payout submitted",
    `source=${payout.source_wallet_address}`,
    `destination=${payout.destination_wallet_address}`,
    `amount=${ACTIVATION_PAYOUT_TON} TON`,
    `seqno=${payout.seqno}`,
    `confirmed_seqno=${payout.confirmed_seqno}`
  ].join(" | ");

  const { data: updatedWithdraw, error } = await supabase
    .from("withdraws")
    .update({
      status: "approved",
      processed_at: processedAt,
      admin_note: adminNote
    })
    .eq("id", withdraw.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (error) throw error;

  return {
    payout,
    source_order: normalizePaymentOrder(confirmedOrder),
    withdraw: updatedWithdraw || withdraw
  };
}

async function expireStalePaymentOrders() {
  const staleBefore = addMinutes(new Date(), -PAYMENT_LATE_GRACE_MINUTES).toISOString();
  const { data: staleOrders, error } = await supabase
    .from("payment_orders")
    .select("id,wallet_address")
    .eq("status", "pending")
    .lt("expires_at", staleBefore)
    .limit(250);

  if (error) {
    if (["42P01", "42703"].includes(error.code)) return;
    throw error;
  }

  if (!staleOrders?.length) return;

  const ids = staleOrders.map((order) => order.id).filter(Boolean);
  const wallets = staleOrders.map((order) => normalizeAddress(order.wallet_address)).filter(Boolean);
  const now = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("payment_orders")
    .update({ status: "expired", updated_at: now })
    .in("id", ids)
    .eq("status", "pending");

  if (updateError) throw updateError;

  if (wallets.length) {
    const { error: walletError } = await supabase
      .from("payment_wallets")
      .update({
        assigned_order_id: null,
        assigned_until: null,
        cooldown_until: null,
        updated_at: now
      })
      .in("address", wallets);

    if (walletError && !["42P01", "42703"].includes(walletError.code)) throw walletError;
  }
}

async function getExistingPaymentOrder(telegramId) {
  const { data, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("telegram_id", String(telegramId))
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") return null;
    throw error;
  }

  return normalizePaymentOrder(data);
}

async function claimPaymentWallet(orderId, telegramId, expiresAt) {
  const now = new Date().toISOString();
  const userId = String(telegramId);

  const findAssignedWallet = async () => {
    const { data, error } = await supabase
      .from("payment_wallets")
      .select("*")
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .eq("is_active", true)
      .eq("assigned_to_telegram_id", userId)
      .order("last_assigned_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return data?.address && isLikelyTonAddress(data.address) ? data : null;
  };

  const { data: rpcWallets, error: rpcError } = await supabase.rpc("claim_payment_wallet", {
    p_order_id: orderId,
    p_telegram_id: userId,
    p_assigned_until: expiresAt,
    p_network: PAYMENT_NETWORK,
    p_token: PAYMENT_TOKEN
  });

  if (!rpcError) {
    const rpcWallet = Array.isArray(rpcWallets) ? rpcWallets[0] : rpcWallets;
    if (rpcWallet?.address && isLikelyTonAddress(rpcWallet.address)) {
      let rpcWalletQuery = supabase
        .from("payment_wallets")
        .update(buildPaymentWalletAssignment(userId, orderId, expiresAt, now))
        .eq("network", PAYMENT_NETWORK)
        .eq("token", PAYMENT_TOKEN);
      rpcWalletQuery = rpcWallet.id
        ? rpcWalletQuery.eq("id", rpcWallet.id)
        : rpcWalletQuery.eq("address", normalizeAddress(rpcWallet.address));
      const { error: rpcAssignError } = await rpcWalletQuery;
      if (rpcAssignError && !["42P01", "42703"].includes(rpcAssignError.code)) {
        if (isUniqueConstraintError(rpcAssignError)) {
          const assignedWallet = await findAssignedWallet();
          if (assignedWallet) return assignedWallet;
        }
        throw rpcAssignError;
      }
      return { ...rpcWallet, assigned_order_id: orderId };
    }
  } else if (!["42883", "PGRST202"].includes(rpcError.code)) {
    console.warn("[payments] claim_payment_wallet rpc fallback:", rpcError.message || rpcError);
  }

  const stickyWallet = await findAssignedWallet();
  if (stickyWallet?.address && isLikelyTonAddress(stickyWallet.address)) {
    await supabase
      .from("payment_wallets")
      .update(buildPaymentWalletAssignment(userId, orderId, expiresAt, now))
      .eq("id", stickyWallet.id);
    return stickyWallet;
  }

  const { data: oldOrders, error: oldOrderError } = await supabase
    .from("payment_orders")
    .select("wallet_address,admin_wallet,created_at")
    .eq("telegram_id", userId)
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .order("created_at", { ascending: false })
    .limit(10);

  if (oldOrderError && oldOrderError.code !== "42P01") throw oldOrderError;

  for (const oldOrder of oldOrders || []) {
    const historicalAddress = [
      oldOrder.wallet_address,
      oldOrder.admin_wallet
    ].map((value) => normalizeAddress(value)).find((value) => isLikelyTonAddress(value));

    if (!historicalAddress) continue;

    const { data: restoredWallet, error: restoreError } = await supabase
      .from("payment_wallets")
      .update(buildPaymentWalletAssignment(userId, orderId, expiresAt, now))
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .eq("is_active", true)
      .eq("address", historicalAddress)
      .or(`assigned_to_telegram_id.is.null,assigned_to_telegram_id.eq.${userId}`)
      .select()
      .maybeSingle();

    if (restoreError) {
      if (isUniqueConstraintError(restoreError)) {
        const assignedWallet = await findAssignedWallet();
        if (assignedWallet) return assignedWallet;
      }
      throw restoreError;
    }
    if (restoredWallet?.address && isLikelyTonAddress(restoredWallet.address)) return restoredWallet;
  }

  const { data: wallet, error: findError } = await supabase
    .from("payment_wallets")
    .select("*")
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .eq("is_active", true)
    .is("assigned_to_telegram_id", null)
    .or(`cooldown_until.is.null,cooldown_until.lte.${now}`)
    .order("last_assigned_at", { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle();

  if (findError) throw findError;
  if (!wallet) return null;

  const { data: claimed, error: updateError } = await supabase
    .from("payment_wallets")
    .update(buildPaymentWalletAssignment(userId, orderId, expiresAt, now))
    .eq("id", wallet.id)
    .is("assigned_to_telegram_id", null)
    .or(`cooldown_until.is.null,cooldown_until.lte.${now}`)
    .select()
    .maybeSingle();

  if (updateError) {
    if (isUniqueConstraintError(updateError)) {
      const assignedWallet = await findAssignedWallet();
      if (assignedWallet) return assignedWallet;
    }
    throw updateError;
  }
  return claimed || null;
}

async function getLatestPendingPaymentOrder(telegramId) {
  const { data, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("telegram_id", String(telegramId))
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01") return null;
    throw error;
  }

  return normalizePaymentOrder(data);
}

async function refreshPendingPaymentOrder(order, telegramId, now, expiresAt) {
  let walletAddress = normalizeAddress(order.wallet_address);

  if (!walletAddress) {
    const wallet = await claimPaymentWallet(order.id, telegramId, expiresAt);
    if (!wallet) {
      throw new Error("Bo'sh TONCOIN hamyon topilmadi. Supabase payment_wallets jadvaliga TON hamyonlar qo'shing.");
    }
    walletAddress = normalizeAddress(wallet.address);
  }

  if (!isLikelyTonAddress(walletAddress)) {
    throw new Error("Noto'g'ri TON hamyon formati topildi. payment_wallets jadvaliga faqat EQ..., UQ... yoki 0:... TON address qo'shing.");
  }

  const updateBody = {
    wallet_address: walletAddress,
    amount: PAYMENT_AMOUNT_TON,
    required_amount: PAYMENT_AMOUNT_TON,
    assigned_at: now.toISOString(),
    expires_at: expiresAt,
    last_checked_at: null,
    updated_at: now.toISOString()
  };

  const { data: updatedOrder, error: orderError } = await supabase
    .from("payment_orders")
    .update(updateBody)
    .eq("id", order.id)
    .eq("status", "pending")
    .select()
    .single();

  if (orderError) throw orderError;

  const { error: walletError } = await supabase
    .from("payment_wallets")
    .update(buildPaymentWalletAssignment(telegramId, order.id, expiresAt, now.toISOString()))
    .eq("address", walletAddress);

  if (walletError && !["42P01", "42703"].includes(walletError.code)) throw walletError;

  return normalizePaymentOrder(updatedOrder);
}

async function createTonPaymentOrder(telegramId) {
  const now = new Date();
  const expiresAt = addMinutes(now, PAYMENT_ORDER_TTL_MINUTES).toISOString();
  const existing = await getExistingPaymentOrder(telegramId);
  if (existing) {
    if (isLikelyTonAddress(existing.wallet_address)) return existing;
    return refreshPendingPaymentOrder(existing, telegramId, now, expiresAt);
  }

  const pending = await getLatestPendingPaymentOrder(telegramId);
  if (pending) {
    return refreshPendingPaymentOrder(pending, telegramId, now, expiresAt);
  }

  const { data: order, error } = await supabase
    .from("payment_orders")
    .insert({
      telegram_id: String(telegramId),
      network: PAYMENT_NETWORK,
      token: PAYMENT_TOKEN,
      admin_wallet: "TON activation wallet",
      amount: PAYMENT_AMOUNT_TON,
      required_amount: PAYMENT_AMOUNT_TON,
      status: "pending",
      assigned_at: now.toISOString(),
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const retryPending = await getLatestPendingPaymentOrder(telegramId);
      if (retryPending) return refreshPendingPaymentOrder(retryPending, telegramId, now, expiresAt);
    }
    throw error;
  }

  const wallet = await claimPaymentWallet(order.id, telegramId, expiresAt);
  if (!wallet) {
    await supabase
      .from("payment_orders")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("id", order.id);
    throw new Error("Bo'sh TONCOIN hamyon topilmadi. Supabase payment_wallets jadvaliga TON hamyonlar qo'shing.");
  }

  if (!isLikelyTonAddress(wallet.address)) {
    await supabase
      .from("payment_wallets")
      .update({
        is_active: false,
        assigned_order_id: null,
        assigned_until: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", wallet.id);
    throw new Error("Noto'g'ri TON hamyon formati topildi. payment_wallets jadvaliga faqat EQ..., UQ... yoki 0:... TON address qo'shing.");
  }

  const { data: updatedOrder, error: orderUpdateError } = await supabase
    .from("payment_orders")
    .update({
      wallet_address: wallet.address,
      admin_wallet: wallet.address,
      updated_at: new Date().toISOString()
    })
    .eq("id", order.id)
    .select()
    .single();

  if (orderUpdateError) throw orderUpdateError;
  return normalizePaymentOrder(updatedOrder);
}

function readTonAccountAddress(value) {
  if (!value) return "";
  if (typeof value === "string") return normalizeAddress(value);
  return normalizeAddress(
    value.address ||
    value.account?.address ||
    value.wallet?.address ||
    value.raw_address ||
    value.raw
  );
}

function extractTonPaymentTransfers(events) {
  const transfers = [];

  for (const event of events || []) {
    const eventTimestamp = Number(event.timestamp || event.utime || 0);
    const eventHash = normalizeAddress(event.event_id || event.id || event.trace_id || event.hash || event.lt);
    const actions = Array.isArray(event.actions) ? event.actions : [];

    for (const action of actions) {
      const type = String(action.type || action.action_type || "").toLowerCase();
      const transfer = action.TonTransfer || action.tonTransfer || action.ton_transfer || action.details || action;

      if (type.includes("jetton")) continue;
      if (!type.includes("tontransfer") && !type.includes("ton_transfer") && transfer?.amount === undefined && transfer?.value === undefined) continue;
      if (String(action.status || "ok").toLowerCase() === "failed") continue;

      transfers.push({
        hash: normalizeAddress(
          transfer.transaction_hash ||
          transfer.tx_hash ||
          action.tx_hash ||
          action.base_transactions?.[0] ||
          eventHash
        ),
        from: readTonAccountAddress(transfer.sender || transfer.from || transfer.source),
        to: readTonAccountAddress(transfer.recipient || transfer.to || transfer.destination),
        value: String(transfer.amount ?? transfer.value ?? transfer.quantity ?? "0"),
        decimals: Number(transfer.decimals ?? PAYMENT_TOKEN_DECIMALS),
        token_address: "",
        token_symbol: PAYMENT_TOKEN,
        timestamp_ms: eventTimestamp ? eventTimestamp * 1000 : Date.now(),
        raw: { event, action }
      });
    }
  }

  return transfers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url, { headers = {}, timeoutMs = TONAPI_REQUEST_TIMEOUT_MS, retries = TONAPI_RETRY_COUNT } = {}) {
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, signal: controller.signal });
      const text = await response.text();
      let payload = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }
      if (!response.ok || payload.success === false) {
        const retryable = response.status === 429 || response.status >= 500;
        const message = payload.error || payload.message || `HTTP ${response.status}`;
        if (!retryable || attempt >= retries) {
          throw new Error(message);
        }
        lastError = new Error(message);
      } else {
        return payload;
      }
    } catch (err) {
      lastError = err;
      if (attempt >= retries) throw err;
    } finally {
      clearTimeout(timeout);
    }

    const delay = TONAPI_RETRY_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * TONAPI_RETRY_BASE_MS);
    await sleep(delay);
  }

  throw lastError || new Error("Request failed");
}

async function fetchTonPaymentTransactions(address, minTimestamp) {
  const all = [];
  let beforeLt = "";

  for (let page = 0; page < 5; page += 1) {
    const params = new URLSearchParams({
      limit: "100"
    });
    if (beforeLt) params.set("before_lt", beforeLt);

    const headers = { Accept: "application/json" };
    if (TONAPI_KEY) headers.Authorization = `Bearer ${TONAPI_KEY}`;

    const payload = await fetchJsonWithTimeout(`${TONAPI_BASE_URL}/v2/accounts/${encodeURIComponent(address)}/events?${params.toString()}`, { headers });

    const events = Array.isArray(payload.events) ? payload.events : (Array.isArray(payload) ? payload : []);
    all.push(...events);

    const oldest = events[events.length - 1];
    const oldestTime = Number(oldest?.timestamp || oldest?.utime || 0) * 1000;
    beforeLt = normalizeAddress(payload.next_from || oldest?.lt);
    if (!beforeLt || !events.length || (oldestTime && oldestTime < minTimestamp)) break;
  }

  return extractTonPaymentTransfers(all);
}

function findMatchingTonTransfer(order, transactions) {
  const wallet = normalizeAddress(order.wallet_address);
  const minReceivedUnits = decimalToUnits(PAYMENT_MIN_RECEIVED_TON);
  const maxReceivedUnits = decimalToUnits(PAYMENT_MAX_RECEIVED_TON);
  const assignedAt = new Date(order.assigned_at || order.created_at || Date.now()).getTime() - 60 * 1000;
  const lateUntil = addMinutes(new Date(order.expires_at || Date.now()), PAYMENT_LATE_GRACE_MINUTES).getTime();

  return (transactions || []).find((tx) => {
    const txHash = tx.hash;
    const txTo = normalizeAddress(tx.to);
    const tokenSymbol = String(tx.token_symbol || "").toUpperCase();
    const decimals = Number(tx.decimals ?? PAYMENT_TOKEN_DECIMALS);
    const timestamp = Number(tx.timestamp_ms || 0);

    if (!txHash || !sameTonAddress(txTo, wallet)) return false;
    if (tokenSymbol && tokenSymbol !== PAYMENT_TOKEN) return false;
    if (timestamp && (timestamp < assignedAt || timestamp > lateUntil)) return false;

    const rawAmount = String(tx.value || "0");
    const amountUnits = rawAmount.includes(".") ? decimalToUnits(rawAmount, decimals) : BigInt(rawAmount);
    const normalizedAmountUnits = decimals === PAYMENT_TOKEN_DECIMALS
      ? amountUnits
      : decimalToUnits(unitsToDecimalString(amountUnits, decimals));

    return normalizedAmountUnits >= minReceivedUnits && normalizedAmountUnits <= maxReceivedUnits;
  });
}

async function isPaymentTxAlreadyProcessed(txHash) {
  const { data: order } = await supabase
    .from("payment_orders")
    .select("id")
    .eq("tx_hash", txHash)
    .maybeSingle();

  if (order) return true;

  const { data: tx } = await supabase
    .from("payment_transactions")
    .select("id")
    .eq("tx_hash", txHash)
    .maybeSingle();

  return Boolean(tx);
}

async function unlockWithdrawAndCreditActivationRefund(telegramId, now = new Date().toISOString()) {
  const { data: currentUser, error: currentUserError } = await supabase
    .from("users")
    .select("balance,withdraw_unlocked")
    .eq("telegram_id", String(telegramId))
    .maybeSingle();

  if (currentUserError) throw currentUserError;

  const refundAmount = Number(ACTIVATION_REFUND_TON);
  const shouldCreditRefund = !currentUser?.withdraw_unlocked && refundAmount > 0;
  const updateBody = {
    withdraw_unlocked: true,
    withdraw_payment_verified_at: now,
    updated_at: now
  };

  if (shouldCreditRefund) {
    updateBody.balance = Number(currentUser?.balance || 0) + refundAmount;
  }

  const { error: userError } = await supabase
    .from("users")
    .update(updateBody)
    .eq("telegram_id", String(telegramId));

  if (userError) throw userError;

  return {
    credited_refund: shouldCreditRefund,
    refund_amount: shouldCreditRefund ? refundAmount : 0
  };
}

async function getDepositRefundWithdraw(telegramId) {
  const { data, error } = await supabase
    .from("withdraws")
    .select("id,status,wallet_address,amount,created_at")
    .eq("telegram_id", String(telegramId))
    .eq("wallet_type", "TON_DEPOSIT_REFUND")
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && !["42P01", "42703", "PGRST116"].includes(error.code)) throw error;
  return data || null;
}

function normalizeDepositRefundStatus(withdraw) {
  return {
    requested: Boolean(withdraw?.id),
    id: withdraw?.id || null,
    status: withdraw?.status || null,
    wallet_address: withdraw?.wallet_address || null,
    amount: withdraw?.amount ? Number(withdraw.amount) : Number(ACTIVATION_REFUND_TON)
  };
}

async function ensureWalletActivationNotification(telegramId) {
  const title = "Wallet activation";
  const message = `Activate and bind your wallet: deposit exactly ${Number(PAYMENT_AMOUNT_TON).toFixed(2)} TON.`;

  const { data: existing, error: findError } = await supabase
    .from("notifications")
    .select("id")
    .eq("telegram_id", String(telegramId))
    .eq("title", title)
    .limit(1)
    .maybeSingle();

  if (findError && !["42P01", "42703", "PGRST116"].includes(findError.code)) throw findError;
  if (existing?.id) return false;

  const { error: insertError } = await supabase
    .from("notifications")
    .insert({
      telegram_id: String(telegramId),
      title,
      message
    });

  if (insertError && !["42P01", "42703"].includes(insertError.code)) throw insertError;
  return !insertError;
}

async function confirmUsdtPayment(order, tx) {
  const txHash = tx.hash;
  if (!txHash || await isPaymentTxAlreadyProcessed(txHash)) return false;

  const decimals = Number(tx.decimals ?? PAYMENT_TOKEN_DECIMALS);
  const paidAmount = unitsToDecimalString(tx.value || "0", decimals);
  const paidAt = new Date(Number(tx.timestamp_ms || Date.now())).toISOString();
  const now = new Date().toISOString();

  const { data: confirmedOrder, error: orderError } = await supabase
    .from("payment_orders")
    .update({
      status: "confirmed",
      tx_hash: txHash,
      from_wallet: tx.from || null,
      paid_amount: paidAmount,
      paid_at: paidAt,
      raw_event: tx.raw || tx,
      updated_at: now
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .is("tx_hash", null)
    .select()
    .maybeSingle();

  if (orderError) throw orderError;
  if (!confirmedOrder) return false;

  await unlockWithdrawAndCreditActivationRefund(order.telegram_id, now);

  const { error: txInsertError } = await supabase
    .from("payment_transactions")
    .insert({
      telegram_id: String(order.telegram_id),
      network: PAYMENT_NETWORK,
      token: PAYMENT_TOKEN,
      to_wallet: order.wallet_address,
      amount: Number(paidAmount),
      tx_hash: txHash
    });

  if (txInsertError && txInsertError.code !== "23505") throw txInsertError;

  await supabase
    .from("payment_wallets")
    .update({
      assigned_order_id: null,
      assigned_until: null,
      cooldown_until: null,
      last_scanned_at: now,
      updated_at: now
    })
    .eq("address", order.wallet_address);

  return true;
}

async function scanPaymentOrder(order) {
  if (!order?.wallet_address) return false;
  const minTimestamp = Math.max(0, new Date(order.assigned_at || order.created_at || Date.now()).getTime() - 2 * 60 * 1000);
  const transactions = await fetchTonPaymentTransactions(order.wallet_address, minTimestamp);
  const match = findMatchingTonTransfer(order, transactions);
  const now = new Date().toISOString();

  await supabase
    .from("payment_orders")
    .update({ last_checked_at: now, updated_at: now })
    .eq("id", order.id)
    .eq("status", "pending");

  await supabase
    .from("payment_wallets")
    .update({ last_scanned_at: now, updated_at: now })
    .eq("address", order.wallet_address);

  return match ? confirmUsdtPayment(order, match) : false;
}

const paymentScannerState = {
  running: false,
  lastRunAt: null,
  lastError: null,
  checked: 0,
  confirmed: 0
};
const opsSnapshotCache = {
  value: null,
  expiresAt: 0,
  generatedAt: null
};
const opsFastCaches = {
  redis: { value: null, expiresAt: 0, generatedAt: null },
  redisDeep: { value: null, expiresAt: 0, generatedAt: null },
  scannerHeartbeats: { value: null, expiresAt: 0, generatedAt: null },
  walletCapacity: { value: null, expiresAt: 0, generatedAt: null },
  scannerBacklog: { value: null, expiresAt: 0, generatedAt: null }
};
const PAYMENT_SCANNER_WORKER_ID = String(process.env.PAYMENT_SCANNER_WORKER_ID || `scanner-${Math.random().toString(36).slice(2)}`);
const PAYMENT_SCANNER_HEARTBEAT_TABLE = "payment_scanner_heartbeats";
let scannerHeartbeatWarned = false;
let scannerClaimRpcWarned = false;

function cloneJsonSafe(value) {
  if (value === undefined || value === null) return value;
  return JSON.parse(JSON.stringify(value));
}

async function getCachedOpsValue(cache, ttlMs, producer, options = {}) {
  const force = options.force === true;
  const now = Date.now();
  if (!force && ttlMs > 0 && cache.value && cache.expiresAt > now) {
    const cached = cloneJsonSafe(cache.value);
    if (cached && typeof cached === "object" && !Array.isArray(cached)) {
      cached.cache = {
        hit: true,
        ttl_ms: ttlMs,
        generated_at: cache.generatedAt
      };
    }
    return cached;
  }

  const fresh = await producer();
  cache.value = cloneJsonSafe(fresh);
  cache.generatedAt = new Date().toISOString();
  cache.expiresAt = now + ttlMs;

  const returned = cloneJsonSafe(fresh);
  if (returned && typeof returned === "object" && !Array.isArray(returned)) {
    returned.cache = {
      hit: false,
      ttl_ms: ttlMs,
      generated_at: cache.generatedAt
    };
  }
  return returned;
}

async function upsertPaymentScannerHeartbeat(payload) {
  const { error } = await supabase
    .from(PAYMENT_SCANNER_HEARTBEAT_TABLE)
    .upsert(payload, { onConflict: "worker_id" });

  if (!error) return { error: null };

  const missingColumn = ["42703", "PGRST204"].includes(error.code) ||
    /column|schema cache/i.test(error.message || "");
  if (!missingColumn) return { error };

  const compatiblePayload = { ...payload };
  delete compatiblePayload.shard_count;
  delete compatiblePayload.shard_index;
  delete compatiblePayload.scan_concurrency;
  delete compatiblePayload.scan_jitter_ms;
  delete compatiblePayload.scan_order_delay_ms;
  delete compatiblePayload.scan_max_errors_per_run;
  const retry = await supabase
    .from(PAYMENT_SCANNER_HEARTBEAT_TABLE)
    .upsert(compatiblePayload, { onConflict: "worker_id" });
  return retry;
}

async function recordPaymentScannerHeartbeat() {
  const now = new Date().toISOString();
  const payload = {
    worker_id: PAYMENT_SCANNER_WORKER_ID,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    network: PAYMENT_NETWORK,
    token: PAYMENT_TOKEN,
    scanner_enabled: PAYMENT_SCANNER_ENABLED,
    running: Boolean(paymentScannerState.running),
    last_seen_at: now,
    last_run_at: paymentScannerState.lastRunAt,
    last_error: paymentScannerState.lastError,
    checked_total: Number(paymentScannerState.checked || 0),
    confirmed_total: Number(paymentScannerState.confirmed || 0),
    scan_interval_ms: Number(PAYMENT_SCAN_INTERVAL_MS || 0),
    scan_batch_size: Number(PAYMENT_SCAN_BATCH_SIZE || 0),
    scan_concurrency: Number(PAYMENT_SCAN_CONCURRENCY || 0),
    scan_jitter_ms: Number(PAYMENT_SCAN_JITTER_MS || 0),
    scan_order_delay_ms: Number(PAYMENT_SCAN_ORDER_DELAY_MS || 0),
    scan_max_errors_per_run: Number(PAYMENT_SCAN_MAX_ERRORS_PER_RUN || 0),
    shard_count: Number(PAYMENT_SCANNER_SHARD_COUNT || 1),
    shard_index: Number(PAYMENT_SCANNER_SHARD_INDEX || 0),
    updated_at: now
  };

  const { error } = await upsertPaymentScannerHeartbeat(payload);

  if (error) {
    if (!scannerHeartbeatWarned) {
      scannerHeartbeatWarned = true;
      console.warn("[payments] scanner heartbeat unavailable:", error.message || error);
    }
    return false;
  }
  return true;
}

async function readPaymentScannerHeartbeats(options = {}) {
  return getCachedOpsValue(opsFastCaches.scannerHeartbeats, SCANNER_HEARTBEAT_CACHE_TTL_MS, async () => {
    const { data, error } = await supabase
      .from(PAYMENT_SCANNER_HEARTBEAT_TABLE)
      .select("*")
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .order("last_seen_at", { ascending: false })
      .limit(PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT);

    if (error) {
      return {
        available: false,
        error: error.message || String(error),
        rows: []
      };
    }

    return {
      available: true,
      error: null,
      rows: data || []
    };
  }, options);
}

function buildPaymentScannerStatus(heartbeatSnapshot = { available: false, error: null, rows: [] }) {
  const rows = Array.isArray(heartbeatSnapshot.rows) ? heartbeatSnapshot.rows : [];
  const latest = rows[0] || null;
  const scannerRows = rows.filter((row) => row?.worker_mode === "scanner");
  const latestScanner = scannerRows[0] || null;
  const staleAfterMs = PAYMENT_SCANNER_STALE_AFTER_MS;
  const activeScannerRows = scannerRows.filter((row) => {
    const seenMs = row?.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    return Boolean(seenMs && Date.now() - seenMs <= staleAfterMs);
  });
  const latestSeenMs = latestScanner?.last_seen_at ? new Date(latestScanner.last_seen_at).getTime() : 0;
  const heartbeatStale = heartbeatSnapshot.available
    ? (!latestSeenMs || Date.now() - latestSeenMs > staleAfterMs)
    : null;

  return {
    ...paymentScannerState,
    worker_id: PAYMENT_SCANNER_WORKER_ID,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    enabled: PAYMENT_SCANNER_ENABLED,
    heartbeat_available: Boolean(heartbeatSnapshot.available),
    heartbeat_error: heartbeatSnapshot.error || null,
    heartbeat_stale: heartbeatStale,
    heartbeat_stale_after_ms: staleAfterMs,
    scanner_worker_alive: heartbeatSnapshot.available ? heartbeatStale === false : null,
    scanner_workers_seen: scannerRows.length,
    scanner_workers_alive: activeScannerRows.length,
    expected_min_scanner_workers: CAPACITY_3M_MIN_SCANNER_WORKERS,
    expected_min_scanner_workers_100x: CAPACITY_100X_MIN_SCANNER_WORKERS,
    expected_min_scanner_workers_hyperscale: CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS,
    heartbeat_read_limit: PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT,
    shard_count: PAYMENT_SCANNER_SHARD_COUNT,
    shard_index: PAYMENT_SCANNER_SHARD_INDEX,
    latest_heartbeat: latest,
    latest_scanner_heartbeat: latestScanner,
    heartbeats: rows
  };
}

function getScannerHealthMessage(status) {
  if (status === "ok") return "Scanner worker heartbeat is fresh. TON deposit scanning can run.";
  if (status === "stale") return "Public API is live, but the separate scanner Background Worker is not heartbeating.";
  return "Scanner heartbeat table is unavailable or cannot be read.";
}

function getScannerRecommendedChecks(status) {
  if (status === "ok") return [];
  if (status === "unavailable") {
    return [
      "Run COPY_THIS_SCANNER_HEARTBEAT_SQL_1_5M.sql in the same Supabase project.",
      "Confirm SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY point to the same project as the API.",
      "Redeploy the API after SQL is applied."
    ];
  }
  return [
    "Confirm Render service type is Background Worker, not Web Service.",
    "Confirm worker start command is npm run start:scanner.",
    "Confirm worker env has WORKER_MODE=scanner and PAYMENT_SCANNER_ENABLED=true.",
    "Confirm worker env has real SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TONAPI_KEY, and TONAPI_BASE_URL.",
    "Confirm worker uses the same Supabase project as the public API.",
    "Open Render worker logs; v1.8.2 fails fast when required env or shard config is missing."
  ];
}

function buildPublicPaymentScannerHealth(heartbeatSnapshot = { available: false, error: null, rows: [] }) {
  const scannerStatus = buildPaymentScannerStatus(heartbeatSnapshot);
  const latestScanner = scannerStatus.latest_scanner_heartbeat || null;
  const heartbeatAvailable = Boolean(scannerStatus.heartbeat_available);
  const scannerAlive = scannerStatus.scanner_worker_alive === true;
  const status = heartbeatAvailable ? (scannerAlive ? "ok" : "stale") : "unavailable";

  return {
    status,
    version: BACKEND_VERSION,
    network: PAYMENT_NETWORK,
    token: PAYMENT_TOKEN,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    action_required: status !== "ok",
    message: getScannerHealthMessage(status),
    recommended_checks: getScannerRecommendedChecks(status),
    expected_worker: {
      service_type: "Background Worker",
      start_command: "npm run start:scanner",
      worker_mode: "scanner"
    },
    heartbeat_available: heartbeatAvailable,
    heartbeat_stale: scannerStatus.heartbeat_stale,
    heartbeat_stale_after_ms: scannerStatus.heartbeat_stale_after_ms,
    scanner_worker_alive: heartbeatAvailable ? scannerAlive : null,
    scanner_workers_seen: scannerStatus.scanner_workers_seen,
    scanner_workers_alive: scannerStatus.scanner_workers_alive,
    expected_min_scanner_workers: scannerStatus.expected_min_scanner_workers,
    expected_min_scanner_workers_100x: scannerStatus.expected_min_scanner_workers_100x,
    expected_min_scanner_workers_hyperscale: scannerStatus.expected_min_scanner_workers_hyperscale,
    heartbeat_read_limit: scannerStatus.heartbeat_read_limit,
    latest_seen_at: latestScanner?.last_seen_at || null,
    latest_run_at: latestScanner?.last_run_at || null,
    last_error_present: Boolean(latestScanner?.last_error),
    checked_total: Number(latestScanner?.checked_total || 0),
    confirmed_total: Number(latestScanner?.confirmed_total || 0),
    scan_interval_ms: Number(PAYMENT_SCAN_INTERVAL_MS || 0),
    scan_batch_size: Number(PAYMENT_SCAN_BATCH_SIZE || 0),
    scan_concurrency: Number(PAYMENT_SCAN_CONCURRENCY || 0),
    scan_jitter_ms: Number(PAYMENT_SCAN_JITTER_MS || 0),
    scan_order_delay_ms: Number(PAYMENT_SCAN_ORDER_DELAY_MS || 0),
    scan_max_errors_per_run: Number(PAYMENT_SCAN_MAX_ERRORS_PER_RUN || 0),
    tonapi_request_timeout_ms: Number(TONAPI_REQUEST_TIMEOUT_MS || 0),
    tonapi_retry_count: Number(TONAPI_RETRY_COUNT || 0)
  };
}

function buildProcessMetrics() {
  const memory = process.memoryUsage();
  return {
    version: BACKEND_VERSION,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    booted_at: PROCESS_STARTED_AT.toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    pid: process.pid,
    node_version: process.version,
    memory_mb: {
      rss: Math.round(memory.rss / 1024 / 1024),
      heap_used: Math.round(memory.heapUsed / 1024 / 1024),
      heap_total: Math.round(memory.heapTotal / 1024 / 1024),
      external: Math.round(memory.external / 1024 / 1024)
    },
    requests: {
      ...opsCounters,
      max_duration_ms: Math.round(opsCounters.max_duration_ms),
      active_requests: serverRuntime.active_requests,
      highest_active_requests: serverRuntime.highest_active_requests
    },
    runtime: {
      shutting_down: serverRuntime.shutting_down,
      shutdown_started_at: serverRuntime.shutdown_started_at,
      last_signal: serverRuntime.last_signal,
      keep_alive_timeout_ms: SERVER_KEEP_ALIVE_TIMEOUT_MS,
      headers_timeout_ms: SERVER_HEADERS_TIMEOUT_MS,
      request_timeout_ms: SERVER_REQUEST_TIMEOUT_MS,
      shutdown_grace_ms: SHUTDOWN_GRACE_MS
    },
    capacity_targets: {
      initial_users: CAPACITY_INITIAL_USERS,
      target_users: CAPACITY_TARGET_USERS
    },
    rate_limit: {
      backend: RATE_LIMIT_BACKEND,
      redis_configured: Boolean(REDIS_URL),
      redis_deep_check_enabled: REDIS_DEEP_CHECK_ENABLED,
      scanner_locks_enabled: REDIS_SCANNER_LOCKS_ENABLED,
      scanner_locks_required: REDIS_SCANNER_LOCKS_REQUIRED,
      scanner_lock_ttl_ms: REDIS_SCANNER_LOCK_TTL_MS,
      memory_bucket_count: rateBuckets.size
    },
    settings_cache: {
      enabled: SETTINGS_CACHE_TTL_MS > 0,
      ttl_ms: SETTINGS_CACHE_TTL_MS,
      warm: Boolean(settingsCache.value),
      expires_at: settingsCache.expiresAt ? new Date(settingsCache.expiresAt).toISOString() : null
    },
    ops_fast_cache: {
      scanner_heartbeat_ttl_ms: SCANNER_HEARTBEAT_CACHE_TTL_MS,
      wallet_capacity_ttl_ms: WALLET_CAPACITY_CACHE_TTL_MS,
      scanner_backlog_ttl_ms: SCANNER_BACKLOG_CACHE_TTL_MS,
      redis_health_ttl_ms: REDIS_HEALTH_CACHE_TTL_MS,
      ops_snapshot_ttl_ms: OPS_SNAPSHOT_CACHE_TTL_MS
    }
  };
}

function buildEnvPresenceSummary() {
  const names = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
    "ADMIN_TOKEN",
    "TONAPI_KEY",
    "TONAPI_BASE_URL",
    "PUBLIC_BACKEND_URL",
    "PUBLIC_APP_URL",
    "GAME_URL",
    "ALLOWED_ORIGINS",
    "REDIS_URL"
  ];
  return Object.fromEntries(names.map((name) => [name, hasRealEnvValue(name)]));
}

function buildDeploymentShape(scanner) {
  const apiMode = !SCANNER_WORKER_MODE;
  const paymentRangeOk =
    Number(PAYMENT_MIN_RECEIVED_TON) <= Number(PAYMENT_AMOUNT_TON) &&
    Number(PAYMENT_AMOUNT_TON) <= Number(PAYMENT_MAX_RECEIVED_TON);
  return {
    version: BACKEND_VERSION,
    service_role: SCANNER_WORKER_MODE ? "scanner_worker" : "public_api",
    expected_services: {
      public_api: {
        service_type: "Web Service",
        start_command: "npm start",
        payment_scanner_enabled: false,
        redis_recommended: true
      },
      scanner_worker: {
        service_type: "Background Worker",
        start_command: "npm run start:scanner",
        payment_scanner_enabled: true,
        redis_required: false,
        recommended_worker_count_for_3m: CAPACITY_3M_MIN_SCANNER_WORKERS,
        recommended_worker_count_for_100x: CAPACITY_100X_MIN_SCANNER_WORKERS
      }
    },
    current_service: {
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      payment_scanner_enabled: PAYMENT_SCANNER_ENABLED,
      rate_limit_backend: RATE_LIMIT_BACKEND,
      redis_configured: Boolean(REDIS_URL),
      scanner_shard_count: PAYMENT_SCANNER_SHARD_COUNT,
      scanner_shard_index: PAYMENT_SCANNER_SHARD_INDEX,
      scanner_concurrency: PAYMENT_SCAN_CONCURRENCY
    },
    ready_for_real_deposit_test: Boolean(scanner?.status === "ok" && scanner?.scanner_worker_alive === true),
    required_before_100k_plus: {
      scanner_worker_ok: Boolean(scanner?.status === "ok"),
      api_redis_ok: apiMode ? RATE_LIMIT_BACKEND === "redis" && Boolean(REDIS_URL) : true,
      payment_range_ok: paymentRangeOk
    },
    required_before_3m: {
      scanner_workers_alive: Number(scanner?.scanner_workers_alive || 0),
      min_scanner_workers: CAPACITY_3M_MIN_SCANNER_WORKERS,
      scanner_worker_pool_ok: Number(scanner?.scanner_workers_alive || 0) >= CAPACITY_3M_MIN_SCANNER_WORKERS,
      sharded_scanner_sql_required: true
    },
    required_before_100x: {
      scanner_workers_alive: Number(scanner?.scanner_workers_alive || 0),
      min_scanner_workers: CAPACITY_100X_MIN_SCANNER_WORKERS,
      scanner_worker_pool_ok: Number(scanner?.scanner_workers_alive || 0) >= CAPACITY_100X_MIN_SCANNER_WORKERS,
      redis_required: true,
      database_partitioning_required: true,
      load_test_required: true
    },
    required_before_hyperscale: {
      scanner_workers_alive: Number(scanner?.scanner_workers_alive || 0),
      min_scanner_workers: CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS,
      scanner_worker_pool_ok: Number(scanner?.scanner_workers_alive || 0) >= CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS,
      redis_required: true,
      database_partitioning_required: true,
      regional_worker_split_required: true,
      tonapi_rate_limit_contract_required: true,
      load_test_required: true
    }
  };
}

function buildCapacityReadiness(scanner) {
  const apiMode = !SCANNER_WORKER_MODE;
  const paymentRangeOk =
    Number(PAYMENT_MIN_RECEIVED_TON) <= Number(PAYMENT_AMOUNT_TON) &&
    Number(PAYMENT_AMOUNT_TON) <= Number(PAYMENT_MAX_RECEIVED_TON);
  const redisOk = apiMode ? RATE_LIMIT_BACKEND === "redis" && Boolean(REDIS_URL) : true;
  const scannerOk = Boolean(scanner?.status === "ok" && scanner?.scanner_worker_alive === true);
  const scannerWorkersAlive = Number(scanner?.scanner_workers_alive || 0);
  const scannerPoolOk = scannerWorkersAlive >= CAPACITY_3M_MIN_SCANNER_WORKERS;
  const scannerPool100xOk = scannerWorkersAlive >= CAPACITY_100X_MIN_SCANNER_WORKERS;
  const scannerPoolHyperscaleOk = scannerWorkersAlive >= CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS;
  const blockers = [];
  const warnings = [];

  if (!paymentRangeOk) blockers.push("TON payment amount range is invalid.");
  if (!scannerOk) blockers.push("Scanner Background Worker is not heartbeating.");
  if (!redisOk) blockers.push("Public API Redis rate limit backend is required before 100K+ traffic.");
  if (!scannerPoolOk) blockers.push(`At least ${CAPACITY_3M_MIN_SCANNER_WORKERS} scanner workers should be alive before 3M traffic.`);
  if (!scannerPool100xOk) blockers.push(`At least ${CAPACITY_100X_MIN_SCANNER_WORKERS} scanner workers should be alive before 100x traffic.`);
  if (!scannerPoolHyperscaleOk) blockers.push(`At least ${CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS} scanner workers should be alive before hyperscale traffic.`);
  if (REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M && !TON_AUTO_PAYOUT_ENABLED) blockers.push("TON auto payout is required for 1.5M production traffic.");
  if (REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M && !TON_SIGNER_ENABLED) blockers.push("TON signer is required for 1.5M production traffic.");
  if (!TON_AUTO_PAYOUT_ENABLED) warnings.push("TON auto payout is disabled; deposit scanning can work, but refund payout will require signer/RPC setup.");
  if (PAYMENT_SCAN_BATCH_SIZE < 500) warnings.push("PAYMENT_SCAN_BATCH_SIZE is below the current hyperscale baseline.");
  if (PAYMENT_SCAN_CONCURRENCY < 32) warnings.push("PAYMENT_SCAN_CONCURRENCY is below the current hyperscale baseline.");

  return {
    status: blockers.length ? "blocked" : (warnings.length ? "warning" : "ready"),
    initial_users: CAPACITY_INITIAL_USERS,
    target_users: CAPACITY_TARGET_USERS,
    ready_for_real_ton_deposit_test: scannerOk && paymentRangeOk,
    ready_for_100k_public_traffic: scannerOk && paymentRangeOk && redisOk,
    ready_for_1_5m_public_traffic: scannerOk && paymentRangeOk && redisOk && RATE_LIMIT_BACKEND === "redis",
    ready_for_3m_public_traffic: scannerOk && scannerPoolOk && paymentRangeOk && redisOk && RATE_LIMIT_BACKEND === "redis",
    ready_for_100x_public_traffic: scannerOk && scannerPool100xOk && paymentRangeOk && redisOk && RATE_LIMIT_BACKEND === "redis",
    ready_for_hyperscale_public_traffic: scannerOk && scannerPoolHyperscaleOk && paymentRangeOk && redisOk && RATE_LIMIT_BACKEND === "redis",
    checks: {
      scanner_ok: scannerOk,
      scanner_workers_alive: scannerWorkersAlive,
      min_scanner_workers_for_3m: CAPACITY_3M_MIN_SCANNER_WORKERS,
      scanner_pool_ok_for_3m: scannerPoolOk,
      min_scanner_workers_for_100x: CAPACITY_100X_MIN_SCANNER_WORKERS,
      scanner_pool_ok_for_100x: scannerPool100xOk,
      min_scanner_workers_for_hyperscale: CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS,
      scanner_pool_ok_for_hyperscale: scannerPoolHyperscaleOk,
      payment_range_ok: paymentRangeOk,
      api_redis_ok: redisOk,
      api_scanner_disabled: apiMode ? PAYMENT_SCANNER_ENABLED === false : true,
      ton_auto_payout_enabled: TON_AUTO_PAYOUT_ENABLED,
      ton_signer_enabled: TON_SIGNER_ENABLED,
      require_ton_auto_payout_for_1_5m: REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M,
      request_timeout_ms: SERVER_REQUEST_TIMEOUT_MS,
      keep_alive_timeout_ms: SERVER_KEEP_ALIVE_TIMEOUT_MS,
      scan_batch_size: PAYMENT_SCAN_BATCH_SIZE,
      scan_concurrency: PAYMENT_SCAN_CONCURRENCY,
      scanner_heartbeat_read_limit: PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT,
      ops_snapshot_cache_ttl_ms: OPS_SNAPSHOT_CACHE_TTL_MS,
      scan_jitter_ms: PAYMENT_SCAN_JITTER_MS,
      scan_order_delay_ms: PAYMENT_SCAN_ORDER_DELAY_MS,
      tonapi_request_timeout_ms: TONAPI_REQUEST_TIMEOUT_MS,
      tonapi_retry_count: TONAPI_RETRY_COUNT
    },
    blockers,
    warnings
  };
}

function withOpsTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${OPS_DB_AUDIT_TIMEOUT_MS}ms`)), OPS_DB_AUDIT_TIMEOUT_MS);
    })
  ]);
}

async function safeSupabaseCount(table, label, applyQuery = (query) => query) {
  try {
    const query = applyQuery(supabase.from(table).select("*", {
      count: SCALE_AUDIT_COUNT_MODE,
      head: true
    }));
    const { count, error } = await withOpsTimeout(query, label);
    if (error) {
      return {
        ok: false,
        label,
        table,
        count: null,
        error: error.message || String(error)
      };
    }
    return {
      ok: true,
      label,
      table,
      count: Number(count || 0),
      mode: SCALE_AUDIT_COUNT_MODE
    };
  } catch (err) {
    return {
      ok: false,
      label,
      table,
      count: null,
      error: err.message || String(err)
    };
  }
}

function compactCountMap(items) {
  return Object.fromEntries(items.map((item) => [item.label, item]));
}

async function buildScannerBacklogReport(options = {}) {
  return getCachedOpsValue(opsFastCaches.scannerBacklog, SCANNER_BACKLOG_CACHE_TTL_MS, async () => {
    const nowIso = new Date().toISOString();
    const counts = await Promise.all([
      safeSupabaseCount("payment_orders", "pending_orders", (query) => query
        .eq("status", "pending")
        .eq("network", PAYMENT_NETWORK)
        .eq("token", PAYMENT_TOKEN)
        .not("wallet_address", "is", null)),
      safeSupabaseCount("payment_orders", "claimed_pending_orders", (query) => query
        .eq("status", "pending")
        .eq("network", PAYMENT_NETWORK)
        .eq("token", PAYMENT_TOKEN)
        .not("wallet_address", "is", null)
        .not("scanner_claimed_until", "is", null)
        .gt("scanner_claimed_until", nowIso)),
      safeSupabaseCount("payment_orders", "expired_claims", (query) => query
        .eq("status", "pending")
        .eq("network", PAYMENT_NETWORK)
        .eq("token", PAYMENT_TOKEN)
        .not("wallet_address", "is", null)
        .not("scanner_claimed_until", "is", null)
        .lte("scanner_claimed_until", nowIso)),
      safeSupabaseCount("payment_orders", "never_checked_pending_orders", (query) => query
        .eq("status", "pending")
        .eq("network", PAYMENT_NETWORK)
        .eq("token", PAYMENT_TOKEN)
        .not("wallet_address", "is", null)
        .is("last_checked_at", null))
    ]);
    return {
      ok: counts.every((item) => item.ok),
      checked_at: nowIso,
      count_mode: SCALE_AUDIT_COUNT_MODE,
      timeout_ms: OPS_DB_AUDIT_TIMEOUT_MS,
      counts: compactCountMap(counts)
    };
  }, options);
}

async function buildWalletCapacityReport(options = {}) {
  return getCachedOpsValue(opsFastCaches.walletCapacity, WALLET_CAPACITY_CACHE_TTL_MS, async () => {
    const counts = await Promise.all([
      safeSupabaseCount("payment_wallets", "total_wallets"),
      safeSupabaseCount("payment_wallets", "active_wallets", (query) => query.eq("is_active", true)),
      safeSupabaseCount("payment_wallets", "available_wallets", (query) => query
        .eq("is_active", true)
        .is("assigned_to_telegram_id", null)),
      safeSupabaseCount("payment_wallets", "assigned_wallets", (query) => query
        .not("assigned_to_telegram_id", "is", null)),
      safeSupabaseCount("payment_wallets", "wallets_with_orders", (query) => query
        .not("assigned_order_id", "is", null))
    ]);
    const byLabel = compactCountMap(counts);
    const available = byLabel.available_wallets?.count;
    const total = byLabel.total_wallets?.count;
    const availableKnown = typeof available === "number";
    const totalKnown = typeof total === "number";
    return {
      ok: counts.every((item) => item.ok),
      target_users: CAPACITY_TARGET_USERS,
      count_mode: SCALE_AUDIT_COUNT_MODE,
      timeout_ms: OPS_DB_AUDIT_TIMEOUT_MS,
      counts: byLabel,
      capacity_gap: availableKnown ? available - CAPACITY_TARGET_USERS : null,
      available_ratio_to_target: availableKnown && CAPACITY_TARGET_USERS > 0
        ? Number((available / CAPACITY_TARGET_USERS).toFixed(4))
        : null,
      total_ratio_to_target: totalKnown && CAPACITY_TARGET_USERS > 0
        ? Number((total / CAPACITY_TARGET_USERS).toFixed(4))
        : null
    };
  }, options);
}

function buildWalletImportPlan(walletCapacity) {
  const availableWallets = Number(walletCapacity?.counts?.available_wallets?.count || 0);
  const totalWallets = Number(walletCapacity?.counts?.total_wallets?.count || 0);
  const assignedWallets = Number(walletCapacity?.counts?.assigned_wallets?.count || 0);
  const targetWithBuffer = CAPACITY_TARGET_USERS + WALLET_POOL_BUFFER;
  const missingWallets = Math.max(0, targetWithBuffer - availableWallets);
  const sqlBatchSize = Math.max(1000, Math.min(50000, Number(process.env.WALLET_IMPORT_SQL_BATCH_SIZE || 10000)));
  const fileBatchSize = Math.max(1000, Math.min(100000, Number(process.env.WALLET_IMPORT_FILE_BATCH_SIZE || 50000)));

  return {
    status: missingWallets > 0 ? "action_required" : "ready",
    target_users: CAPACITY_TARGET_USERS,
    wallet_pool_buffer: WALLET_POOL_BUFFER,
    required_available_wallets: targetWithBuffer,
    current: {
      total_wallets: totalWallets,
      available_wallets: availableWallets,
      assigned_wallets: assignedWallets
    },
    missing_wallets: missingWallets,
    recommended_generation: {
      generate_missing_script: "npm run wallets:generate-missing",
      wallet_sql_batch_size: sqlBatchSize,
      wallet_file_batch_size: fileBatchSize,
      estimated_sql_batches: missingWallets > 0 ? Math.ceil(missingWallets / sqlBatchSize) : 0,
      estimated_export_files: missingWallets > 0 ? Math.ceil(missingWallets / fileBatchSize) : 0
    },
    import_verify: [
      "Run sql/IMPORT_PROGRESS_TABLE_1_5M.sql once.",
      "Run generated public-addresses-*.sql files in Supabase SQL editor.",
      "Run sql/WALLET_IMPORT_AFTER_GENERATION_VERIFY_1_5M.sql.",
      "Run sql/FINAL_OPERATIONAL_GATE_1_5M.sql.",
      "Open /ops/wallet-capacity and /ops/final-gate."
    ]
  };
}

function maskEnvValue(name) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return "";
  if (/KEY|TOKEN|SECRET|URL|ENDPOINT|DIR/i.test(name)) return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
  return raw;
}

function envRequirement(name, options = {}) {
  const real = hasRealEnvValue(name);
  const expected = options.expected;
  const actual = String(process.env[name] || "").trim();
  const expectedOk = expected === undefined ? true : actual === String(expected);
  return {
    name,
    ok: real && expectedOk,
    present: real,
    expected: expected === undefined ? null : String(expected),
    value_preview: maskEnvValue(name),
    required_for: options.required_for || "1.5M",
    note: options.note || ""
  };
}

function buildEnvContract() {
  const api = [
    envRequirement("SUPABASE_URL", { required_for: "api" }),
    envRequirement("SUPABASE_SERVICE_ROLE_KEY", { required_for: "api" }),
    envRequirement("ADMIN_TOKEN", { required_for: "api" }),
    envRequirement("BOT_TOKEN", { required_for: "api" }),
    envRequirement("TELEGRAM_WEBHOOK_SECRET", { required_for: "api" }),
    envRequirement("TONAPI_KEY", { required_for: "api" }),
    envRequirement("PUBLIC_BACKEND_URL", { required_for: "api" }),
    envRequirement("PUBLIC_APP_URL", { required_for: "api" })
  ];
  const redis = [
    envRequirement("RATE_LIMIT_BACKEND", { expected: "redis", required_for: "api" }),
    envRequirement("REDIS_URL", { required_for: "api" }),
    envRequirement("REDIS_DEEP_CHECK_ENABLED", { expected: "true", required_for: "api" })
  ];
  const scannerTemplate = [
    envRequirement("SUPABASE_URL", { required_for: "scanner" }),
    envRequirement("SUPABASE_SERVICE_ROLE_KEY", { required_for: "scanner" }),
    envRequirement("TONAPI_KEY", { required_for: "scanner" }),
    envRequirement("TONAPI_BASE_URL", { required_for: "scanner" }),
    envRequirement("WORKER_MODE", { expected: "scanner", required_for: "scanner" }),
    envRequirement("PAYMENT_SCANNER_ENABLED", { expected: "true", required_for: "scanner" }),
    envRequirement("PAYMENT_SCANNER_WORKER_ID", { required_for: "scanner" }),
    envRequirement("PAYMENT_SCANNER_SHARD_COUNT", { required_for: "scanner" }),
    envRequirement("PAYMENT_SCANNER_SHARD_INDEX", { required_for: "scanner" }),
    envRequirement("REDIS_SCANNER_LOCKS_ENABLED", { expected: "true", required_for: "scanner" })
  ];
  const signer = [
    envRequirement("TON_AUTO_PAYOUT_ENABLED", { expected: "true", required_for: "signer" }),
    envRequirement("TON_SIGNER_ENABLED", { expected: "true", required_for: "signer" }),
    envRequirement("TON_SIGNER_KEYS_DIR", { required_for: "signer" }),
    envRequirement("TON_RPC_ENDPOINT", { required_for: "signer" }),
    envRequirement("TON_RPC_API_KEY", { required_for: "signer" })
  ];
  const groups = { api, redis, scanner_template: scannerTemplate, signer };
  const flat = SCANNER_WORKER_MODE
    ? scannerTemplate
    : [...api, ...redis, ...signer];
  const blockers = flat.filter((item) => !item.ok);
  return {
    status: blockers.length ? "blocked" : "ready",
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    groups,
    blockers,
    generated_at: new Date().toISOString()
  };
}

function buildScannerWorkerPlan(scanner, shards) {
  const alive = Number(scanner?.scanner_workers_alive || 0);
  const currentShardCount = Math.max(1, Number(shards?.expected_shard_count || PAYMENT_SCANNER_SHARD_COUNT || 1));
  const missingShards = Array.isArray(shards?.missing_shard_sample) ? shards.missing_shard_sample : [];
  const duplicateShards = Array.isArray(shards?.duplicate_shards) ? shards.duplicate_shards : [];
  const stages = [
    { name: "smoke", workers: 4, purpose: "real deposit test and minimum gate" },
    { name: "baseline_1_5m", workers: 16, purpose: "first 1.5M traffic baseline" },
    { name: "high_load", workers: 64, purpose: "higher backlog and TonAPI pressure" },
    { name: "future_hyperscale", workers: 256, purpose: "future expansion ceiling" }
  ];
  return {
    status: alive >= FINAL_GATE_MIN_SCANNER_WORKERS && duplicateShards.length === 0 ? "ready" : "action_required",
    current: {
      workers_alive: alive,
      workers_seen: Number(scanner?.scanner_workers_seen || 0),
      shard_count: currentShardCount,
      duplicate_shards: duplicateShards.length,
      missing_shard_sample: missingShards.slice(0, 50),
      heartbeat_read_limit: PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT
    },
    required_now: {
      min_workers: FINAL_GATE_MIN_SCANNER_WORKERS,
      recommended_stage: "smoke",
      missing_workers: Math.max(0, FINAL_GATE_MIN_SCANNER_WORKERS - alive)
    },
    rollout_stages: stages,
    files: {
      scanner_matrix: "ops/scanner-shard-env-matrix-1_5m.txt",
      render_4_workers: "scanner-workers/render.4-workers.yaml",
      render_16_workers: "scanner-workers/render.16-workers.yaml",
      render_64_workers: "scanner-workers/render.64-workers.yaml",
      render_256_workers: "scanner-workers/render.256-workers.yaml"
    }
  };
}

function buildLaunchChecklistFromParts({ scanner, shards, walletCapacity, backlog, redis, redisDeep, tonSigner, gate }) {
  const walletImportPlan = buildWalletImportPlan(walletCapacity);
  const steps = [
    { id: "web_service", ready: !SCANNER_WORKER_MODE, check: "Public API runs as Web Service with npm start." },
    { id: "redis", ready: Boolean(redis?.ok && redisDeep?.ok), check: "RATE_LIMIT_BACKEND=redis, REDIS_URL set, ping/set/get/NX lock pass." },
    { id: "scanner_workers", ready: Number(scanner?.scanner_workers_alive || 0) >= FINAL_GATE_MIN_SCANNER_WORKERS, check: `At least ${FINAL_GATE_MIN_SCANNER_WORKERS} scanner workers heartbeat fresh.` },
    { id: "scanner_shards", ready: Array.isArray(shards?.duplicate_shards) && shards.duplicate_shards.length === 0, check: "No duplicate live scanner shard indexes." },
    { id: "wallet_pool", ready: walletImportPlan.status === "ready", check: `${walletImportPlan.required_available_wallets} available TON wallets.` },
    { id: "ton_signer", ready: Boolean(tonSigner?.ok), check: "TON signer enabled, keys dir mounted, RPC endpoint works." },
    { id: "sql_backlog", ready: Boolean(backlog?.ok), check: "Payment order backlog audit is readable." },
    { id: "final_gate", ready: gate?.status === "ready", check: "/ops/final-gate returns ready." }
  ];
  return {
    status: steps.some((step) => !step.ready) ? "blocked" : "ready",
    steps,
    blockers: steps.filter((step) => !step.ready),
    wallet_import_plan: walletImportPlan
  };
}

function buildBlockerActions({ checklist, gate, envContract, scannerPlan }) {
  const ids = new Set([
    ...(Array.isArray(checklist?.blockers) ? checklist.blockers.map((item) => item.id) : []),
    ...(Array.isArray(gate?.blockers) ? gate.blockers.map((item) => item.name) : []),
    ...(Array.isArray(envContract?.blockers) ? envContract.blockers.map((item) => item.name) : [])
  ]);
  const actions = [];
  if (ids.has("redis") || ids.has("redis_ready") || ids.has("redis_deep_ops_ready") || ids.has("REDIS_URL") || ids.has("RATE_LIMIT_BACKEND")) {
    actions.push({
      blocker: "redis",
      do: "Set RATE_LIMIT_BACKEND=redis and REDIS_URL in Render Web Service env, then redeploy.",
      files: ["env/REDIS_SCANNER_LOCKS_1_5M.env", "env/RENDER_1_5M_REQUIRED_ALL_NO_SECRETS.env"],
      verify: ["/ops/redis", "/ops/redis-deep"]
    });
  }
  if (ids.has("scanner_workers") || ids.has("scanner_workers_alive_minimum") || ids.has("scanner_heartbeat")) {
    actions.push({
      blocker: "scanner_workers",
      do: `Deploy at least ${FINAL_GATE_MIN_SCANNER_WORKERS} Background Workers with unique shard indexes.`,
      missing_workers: scannerPlan?.required_now?.missing_workers ?? null,
      files: ["scanner-workers/render.4-workers.yaml", "ops/scanner-shard-env-matrix-1_5m.txt"],
      verify: ["/scanner/healthz", "/ops/scanner-shards"]
    });
  }
  if (ids.has("wallet_pool") || ids.has("wallet_capacity_1_5m") || ids.has("wallets_available_for_target")) {
    actions.push({
      blocker: "wallet_pool",
      do: "Generate/import missing public TON wallet addresses until available wallets >= 1,500,000.",
      files: ["sql/IMPORT_PROGRESS_TABLE_1_5M.sql", "sql/WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql", "sql/FINAL_OPERATIONAL_GATE_1_5M.sql"],
      verify: ["/ops/wallet-import-plan", "/ops/wallet-capacity"]
    });
  }
  if (ids.has("ton_signer") || ids.has("ton_signer_ready") || ids.has("ton_signer_readiness") || ids.has("TON_SIGNER_KEYS_DIR")) {
    actions.push({
      blocker: "ton_signer",
      do: "Set TON_AUTO_PAYOUT_ENABLED=true, TON_SIGNER_ENABLED=true, mount TON_SIGNER_KEYS_DIR, set TON_RPC_ENDPOINT and TON_RPC_API_KEY.",
      files: ["env/SIGNER_AUTO_PAYOUT_REQUIRED_1_5M.env", "env/RENDER_1_5M_REQUIRED_ALL_NO_SECRETS.env"],
      verify: ["/ops/ton-signer"]
    });
  }
  return {
    status: actions.length ? "action_required" : "ready",
    actions,
    generated_at: new Date().toISOString()
  };
}

function buildInfraAutopilotPlan(snapshot) {
  const actionIds = new Set((snapshot?.blocker_actions?.actions || []).map((item) => item.blocker));
  const walletPlan = snapshot?.checklist?.wallet_import_plan || buildWalletImportPlan(snapshot?.wallet_capacity);
  const scannerPlan = snapshot?.scanner_worker_plan || {};
  const phases = [
    {
      id: "redis",
      title: "Render Web Service Redis",
      ready: !actionIds.has("redis"),
      upload_target: "vidipay-backend",
      render_service_type: "Web Service",
      do: "Set RATE_LIMIT_BACKEND=redis, REDIS_URL, REDIS_DEEP_CHECK_ENABLED=true, then redeploy the web service.",
      files: [
        "env/RENDER_WEB_SERVICE_INFRA_AUTOPILOT_1_5M.env",
        "render-blueprints/vidipay-web-service-render.yaml"
      ],
      verify: ["/ops/redis", "/ops/redis-deep", "/ops/control-tower?fresh=true"]
    },
    {
      id: "scanner_workers",
      title: "Scanner Background Workers",
      ready: !actionIds.has("scanner_workers"),
      upload_target: "scanner worker repo",
      render_service_type: "Background Worker",
      do: `Start ${Math.max(FINAL_GATE_MIN_SCANNER_WORKERS, scannerPlan?.required_now?.min_workers || 4)} scanner workers first; move to 16 after smoke test.`,
      files: [
        "render-blueprints/scanner-workers-4.autopilot.yaml",
        "render-blueprints/scanner-workers-16.autopilot.yaml",
        "env/SCANNER_WORKER_ENV_MATRIX_4_16_64_INFRA_AUTOPILOT_1_5M.txt"
      ],
      verify: ["/scanner/healthz", "/ops/scanner-shards", "/ops/control-tower?fresh=true"]
    },
    {
      id: "wallet_pool",
      title: "1.5M Wallet Pool",
      ready: !actionIds.has("wallet_pool"),
      upload_target: "Supabase SQL Editor, public wallet SQL only",
      render_service_type: "SQL import",
      do: `Generate and import ${Math.max(0, walletPlan?.missing_wallets || 0)} missing public wallet addresses. Private keys stay offline.`,
      files: [
        "scripts/build-public-wallet-import-from-keys-dir-1_5m.js",
        "sql/WALLET_PUBLIC_IMPORT_STAGING_TEMPLATE_1_5M.sql",
        "sql/INFRA_AUTOPILOT_SQL_GATE_1_5M.sql"
      ],
      verify: ["/ops/wallet-import-plan", "/ops/wallet-capacity", "/ops/control-tower?fresh=true"]
    },
    {
      id: "ton_signer",
      title: "TON Signer And Auto Payout",
      ready: !actionIds.has("ton_signer"),
      upload_target: "protected signer/runtime env, never GitHub",
      render_service_type: "Signer env",
      do: "Mount TON_SIGNER_KEYS_DIR, set TON_RPC_ENDPOINT and TON_RPC_API_KEY, then enable TON_AUTO_PAYOUT_ENABLED=true.",
      files: [
        "env/TON_SIGNER_ENV_REQUIRED_1_5M.env",
        "ops/TON_SIGNER_PAYOUT_CLOSEOUT_1_5M.md"
      ],
      verify: ["/ops/ton-signer", "/ops/final-gate"]
    }
  ];
  const current = phases.find((phase) => !phase.ready) || null;
  return {
    status: current ? "action_required" : "ready",
    ready: !current,
    version: BACKEND_VERSION,
    target_users: CAPACITY_TARGET_USERS,
    current_phase: current,
    phases,
    live_verify_order: [
      "/ops/infra-autopilot?fresh=true",
      "/ops/control-tower?fresh=true",
      "/ops/final-gate",
      "/ops/redis-deep",
      "/ops/scanner-shards",
      "/ops/wallet-capacity",
      "/ops/ton-signer"
    ],
    safety_rules: [
      "Upload web-service zip only to vidipay-backend.",
      "Upload scanner-workers zip only to scanner Background Worker repo.",
      "Never upload private-keys, .env.local, node_modules, or package-lock.json.",
      "Supabase receives public-address SQL only, not mnemonic or seed files."
    ],
    generated_at: new Date().toISOString()
  };
}

async function buildOpsSnapshot({ force = false } = {}) {
  const now = Date.now();
  if (!force && OPS_SNAPSHOT_CACHE_TTL_MS > 0 && opsSnapshotCache.value && opsSnapshotCache.expiresAt > now) {
    return {
      ...opsSnapshotCache.value,
      cache: {
        hit: true,
        ttl_ms: OPS_SNAPSHOT_CACHE_TTL_MS,
        generated_at: opsSnapshotCache.generatedAt
      }
    };
  }

  const scannerHeartbeats = await readPaymentScannerHeartbeats({ force });
  const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
  const [walletCapacity, backlog, redis, redisDeep, tonSigner] = await Promise.all([
    buildWalletCapacityReport({ force }),
    buildScannerBacklogReport({ force }),
    checkRedisHealth({ force }),
    checkRedisDeepHealth({ force }),
    buildTonSignerReadinessReport()
  ]);
  const shards = buildScannerShardReport(scannerHeartbeats);
  const contract = buildScaleContract(scanner, shards, walletCapacity, backlog);
  const gate = buildFinalLaunchGate({
    scanner,
    shards,
    walletCapacity,
    backlog,
    redis,
    redisDeep,
    tonSigner,
    contract
  });
  const checklist = buildLaunchChecklistFromParts({
    scanner,
    shards,
    walletCapacity,
    backlog,
    redis,
    redisDeep,
    tonSigner,
    gate
  });
  const envContract = buildEnvContract();
  const scannerPlan = buildScannerWorkerPlan(scanner, shards);
  const blockerActions = buildBlockerActions({
    checklist,
    gate,
    envContract,
    scannerPlan
  });

  const snapshot = {
    status: gate.status === "ready" && checklist.status === "ready" ? "ready" : "blocked",
    version: BACKEND_VERSION,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    target_users: CAPACITY_TARGET_USERS,
    scanner,
    shards,
    redis,
    redis_deep: redisDeep,
    ton_signer: tonSigner,
    wallet_capacity: walletCapacity,
    backlog,
    contract,
    gate,
    checklist,
    env_contract: envContract,
    scanner_worker_plan: scannerPlan,
    blocker_actions: blockerActions,
    infra_autopilot: null,
    generated_at: new Date().toISOString()
  };
  snapshot.infra_autopilot = buildInfraAutopilotPlan(snapshot);

  opsSnapshotCache.value = snapshot;
  opsSnapshotCache.generatedAt = snapshot.generated_at;
  opsSnapshotCache.expiresAt = now + OPS_SNAPSHOT_CACHE_TTL_MS;
  return {
    ...snapshot,
    cache: {
      hit: false,
      ttl_ms: OPS_SNAPSHOT_CACHE_TTL_MS,
      generated_at: snapshot.generated_at
    }
  };
}

function buildScannerShardReport(heartbeatSnapshot = { available: false, error: null, rows: [] }) {
  const rows = Array.isArray(heartbeatSnapshot.rows) ? heartbeatSnapshot.rows : [];
  const now = Date.now();
  const staleAfterMs = PAYMENT_SCANNER_STALE_AFTER_MS;
  const scannerRows = rows.filter((row) => row?.worker_mode === "scanner");
  const activeRows = scannerRows.filter((row) => {
    const seenMs = row?.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    return Boolean(seenMs && now - seenMs <= staleAfterMs);
  });
  const expectedShardCount = Math.max(
    1,
    PAYMENT_SCANNER_SHARD_COUNT,
    ...scannerRows.map((row) => Number(row.shard_count || 0)).filter((value) => Number.isFinite(value))
  );
  const activeByShard = new Map();
  for (const row of activeRows) {
    const shard = Number(row.shard_index || 0);
    if (!activeByShard.has(shard)) activeByShard.set(shard, []);
    activeByShard.get(shard).push(row.worker_id);
  }
  const duplicateShards = [...activeByShard.entries()]
    .filter(([, workers]) => workers.length > 1)
    .map(([shard_index, workers]) => ({ shard_index, workers }));
  const inspectLimit = Math.min(expectedShardCount, 256);
  const missingShardSample = [];
  for (let shard = 0; shard < inspectLimit; shard += 1) {
    if (!activeByShard.has(shard)) missingShardSample.push(shard);
    if (missingShardSample.length >= 64) break;
  }
  return {
    available: Boolean(heartbeatSnapshot.available),
    error: heartbeatSnapshot.error || null,
    expected_shard_count: expectedShardCount,
    inspected_shards: inspectLimit,
    scanner_workers_seen: scannerRows.length,
    scanner_workers_alive: activeRows.length,
    active_shards: activeByShard.size,
    missing_shard_sample: missingShardSample,
    duplicate_shards: duplicateShards,
    stale_after_ms: staleAfterMs,
    latest_rows: scannerRows.slice(0, 20).map((row) => ({
      worker_id: row.worker_id,
      shard_count: row.shard_count,
      shard_index: row.shard_index,
      last_seen_at: row.last_seen_at,
      last_run_at: row.last_run_at,
      last_error_present: Boolean(row.last_error),
      checked_total: Number(row.checked_total || 0),
      confirmed_total: Number(row.confirmed_total || 0)
    }))
  };
}

function buildScaleContract(scanner, shards, walletCapacity, backlog) {
  const apiRedisOk = SCANNER_WORKER_MODE ? true : RATE_LIMIT_BACKEND === "redis" && Boolean(REDIS_URL);
  const paymentRangeOk =
    Number(PAYMENT_MIN_RECEIVED_TON) <= Number(PAYMENT_AMOUNT_TON) &&
    Number(PAYMENT_AMOUNT_TON) <= Number(PAYMENT_MAX_RECEIVED_TON);
  const scannerAlive = Boolean(scanner?.status === "ok" && scanner?.scanner_worker_alive === true);
  const enoughScannerWorkers = Number(scanner?.scanner_workers_alive || 0) >= CAPACITY_3M_MIN_SCANNER_WORKERS;
  const walletAuditOk = Boolean(walletCapacity?.ok);
  const backlogAuditOk = Boolean(backlog?.ok);
  const availableWallets = walletCapacity?.counts?.available_wallets?.count;
  const enoughWallets = typeof availableWallets === "number" ? availableWallets >= CAPACITY_TARGET_USERS : false;
  const checks = [
    { name: "backend_version", ok: BACKEND_VERSION === "v1.8.2-infra-autopilot-20260628", required: true },
    { name: "api_redis", ok: apiRedisOk, required: !SCANNER_WORKER_MODE },
    { name: "api_scanner_disabled", ok: SCANNER_WORKER_MODE ? true : PAYMENT_SCANNER_ENABLED === false, required: !SCANNER_WORKER_MODE },
    { name: "payment_range", ok: paymentRangeOk, required: true },
    { name: "scanner_heartbeat", ok: scannerAlive, required: true },
    { name: "scanner_worker_pool_minimum", ok: enoughScannerWorkers, required: true },
    { name: "scanner_shards_no_duplicates", ok: Array.isArray(shards?.duplicate_shards) && shards.duplicate_shards.length === 0, required: true },
    { name: "wallet_capacity_audit", ok: walletAuditOk, required: true },
    { name: "wallets_available_for_target", ok: enoughWallets, required: true },
    { name: "scanner_backlog_audit", ok: backlogAuditOk, required: true },
    { name: "ton_auto_payout", ok: TON_AUTO_PAYOUT_ENABLED, required: REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M },
    { name: "ton_signer", ok: TON_SIGNER_ENABLED, required: REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M }
  ];
  const blockers = checks.filter((item) => item.required && !item.ok).map((item) => item.name);
  const warnings = checks.filter((item) => !item.required && !item.ok).map((item) => item.name);
  return {
    status: blockers.length ? "blocked" : (warnings.length ? "warning" : "ready"),
    version: BACKEND_VERSION,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    target_users: CAPACITY_TARGET_USERS,
    checks,
    blockers,
    warnings
  };
}

function buildFinalLaunchGate({ scanner, shards, walletCapacity, backlog, redis, redisDeep, tonSigner, contract }) {
  const availableWallets = Number(walletCapacity?.counts?.available_wallets?.count ?? -1);
  const walletTargetWithBuffer = CAPACITY_TARGET_USERS + WALLET_POOL_BUFFER;
  const required = [
    {
      name: "backend_version",
      ok: BACKEND_VERSION === "v1.8.2-infra-autopilot-20260628",
      detail: BACKEND_VERSION
    },
    {
      name: "redis_ready",
      ok: Boolean(redis?.ok),
      detail: redis?.message || redis?.error || redis?.backend || "unknown"
    },
    {
      name: "redis_deep_ops_ready",
      ok: Boolean(redisDeep?.ok),
      detail: redisDeep?.message || redisDeep?.error || "unknown"
    },
    {
      name: "scanner_workers_alive_minimum",
      ok: Number(scanner?.scanner_workers_alive || 0) >= FINAL_GATE_MIN_SCANNER_WORKERS,
      detail: `alive=${Number(scanner?.scanner_workers_alive || 0)}, required=${FINAL_GATE_MIN_SCANNER_WORKERS}`
    },
    {
      name: "scanner_no_duplicate_shards",
      ok: Array.isArray(shards?.duplicate_shards) && shards.duplicate_shards.length === 0,
      detail: `duplicate_shards=${Array.isArray(shards?.duplicate_shards) ? shards.duplicate_shards.length : "unknown"}`
    },
    {
      name: "wallet_capacity_1_5m",
      ok: availableWallets >= walletTargetWithBuffer,
      detail: `available=${availableWallets}, required=${walletTargetWithBuffer}, buffer=${WALLET_POOL_BUFFER}`
    },
    {
      name: "ton_signer_ready",
      ok: Boolean(tonSigner?.ok),
      detail: tonSigner?.rpc?.error || `wallet_files=${tonSigner?.signer?.wallet_files ?? "unknown"}`
    },
    {
      name: "scanner_backlog_audit_ok",
      ok: Boolean(backlog?.ok),
      detail: `pending=${backlog?.counts?.pending_orders?.count ?? "unknown"}`
    },
    {
      name: "scale_contract_not_blocked",
      ok: contract?.status === "ready" || contract?.status === "warning",
      detail: `status=${contract?.status || "unknown"}`
    }
  ];

  const blockers = required.filter((item) => !item.ok);
  return {
    status: blockers.length ? "blocked" : "ready",
    version: BACKEND_VERSION,
    target_users: CAPACITY_TARGET_USERS,
    wallet_target_with_buffer: walletTargetWithBuffer,
    final_gate_min_scanner_workers: FINAL_GATE_MIN_SCANNER_WORKERS,
    required,
    blockers,
    ready_for_1_5m_public_traffic: blockers.length === 0,
    generated_at: new Date().toISOString()
  };
}

async function claimPendingPaymentOrdersForScan(limit) {
  const claimSeconds = Math.max(30, Math.ceil(Number(PAYMENT_SCAN_INTERVAL_MS || 15000) / 1000) * 4);
  const claimLimit = Math.max(1, Math.min(5000, Number(limit || PAYMENT_SCAN_BATCH_SIZE)));
  const shardedClaim = await supabase.rpc("claim_pending_payment_orders_sharded", {
    p_limit: claimLimit,
    p_worker_id: PAYMENT_SCANNER_WORKER_ID,
    p_network: PAYMENT_NETWORK,
    p_token: PAYMENT_TOKEN,
    p_claim_seconds: claimSeconds,
    p_shard_count: PAYMENT_SCANNER_SHARD_COUNT,
    p_shard_index: PAYMENT_SCANNER_SHARD_INDEX
  });

  if (!shardedClaim.error) return shardedClaim.data || [];
  if (!["42883", "PGRST202"].includes(shardedClaim.error.code)) throw shardedClaim.error;

  const { data: claimedOrders, error: claimError } = await supabase.rpc("claim_pending_payment_orders", {
    p_limit: claimLimit,
    p_worker_id: PAYMENT_SCANNER_WORKER_ID,
    p_network: PAYMENT_NETWORK,
    p_token: PAYMENT_TOKEN,
    p_claim_seconds: claimSeconds
  });

  if (!claimError) return claimedOrders || [];
  if (!["42883", "PGRST202"].includes(claimError.code)) throw claimError;

  if (!scannerClaimRpcWarned) {
    scannerClaimRpcWarned = true;
    console.warn("[payments] claim_pending_payment_orders rpc missing, using legacy scanner query");
  }

  const { data: orders, error } = await supabase
    .from("payment_orders")
    .select("*")
    .eq("status", "pending")
    .eq("network", PAYMENT_NETWORK)
    .eq("token", PAYMENT_TOKEN)
    .not("wallet_address", "is", null)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(claimLimit);

  if (error) {
    if (["42P01", "42703"].includes(error.code)) return [];
    throw error;
  }

  return orders || [];
}

async function scanPendingPaymentOrders(limit = PAYMENT_SCAN_BATCH_SIZE) {
  if (paymentScannerState.running) return paymentScannerState;
  const scannerLock = await acquireScannerDistributedLock();
  if (scannerLock.enabled && !scannerLock.acquired) {
    paymentScannerState.lastRunAt = new Date().toISOString();
    paymentScannerState.lastError = scannerLock.message;
    await recordPaymentScannerHeartbeat();
    return paymentScannerState;
  }
  paymentScannerState.running = true;
  paymentScannerState.lastRunAt = new Date().toISOString();
  paymentScannerState.lastError = null;
  await recordPaymentScannerHeartbeat();

  try {
    await expireStalePaymentOrders().catch((err) => {
      if (err?.code !== "23505") throw err;
      console.warn("[payments] scanner stale cleanup skipped because of legacy unique status constraint");
    });
    const orders = await claimPendingPaymentOrdersForScan(limit);

    const queue = Array.isArray(orders) ? orders : [];
    let cursor = 0;
    let runErrors = 0;
    const workerCount = Math.min(PAYMENT_SCAN_CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (cursor < queue.length) {
        if (runErrors >= PAYMENT_SCAN_MAX_ERRORS_PER_RUN) break;
        const order = queue[cursor++];
        paymentScannerState.checked += 1;
        try {
          if (PAYMENT_SCAN_ORDER_DELAY_MS) await sleep(PAYMENT_SCAN_ORDER_DELAY_MS);
          const confirmed = await scanPaymentOrder(order);
          if (confirmed) paymentScannerState.confirmed += 1;
        } catch (err) {
          runErrors += 1;
          paymentScannerState.lastError = err.message;
        }
      }
    }));

    return paymentScannerState;
  } catch (err) {
    paymentScannerState.lastError = err.message || String(err);
    throw err;
  } finally {
    paymentScannerState.running = false;
    if (scannerLock.enabled && scannerLock.acquired && scannerLock.key && scannerLock.value) {
      await releaseRedisLock(scannerLock.key, scannerLock.value).catch((err) => {
        if (!redisScannerLockWarned) {
          redisScannerLockWarned = true;
          console.warn("[scanner] Redis lock release failed:", err.message || err);
        }
      });
    }
    await recordPaymentScannerHeartbeat();
  }
}

function normalizeCountryCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) return "";
  const aliases = {
    "UNITED KINGDOM": "GB",
    "GREAT BRITAIN": "GB",
    "BRITAIN": "GB",
    "ENGLAND": "GB",
    "UK": "GB",
    "UNITED STATES": "US",
    "UNITED STATES OF AMERICA": "US",
    "USA": "US",
    "GERMANY": "DE",
    "DEUTSCHLAND": "DE",
    "CANADA": "CA",
    "AUSTRALIA": "AU",
    "NORWAY": "NO",
    "SWITZERLAND": "CH",
    "NETHERLANDS": "NL",
    "SWEDEN": "SE",
    "DENMARK": "DK",
    "FRANCE": "FR",
    "BELGIUM": "BE",
    "AUSTRIA": "AT",
    "FINLAND": "FI",
    "IRELAND": "IE",
    "NEW ZEALAND": "NZ",
    "ITALY": "IT",
    "SPAIN": "ES",
    "JAPAN": "JP",
    "SOUTH KOREA": "KR",
    "KOREA": "KR"
  };
  if (aliases[code]) return aliases[code];
  if (code === "UK") return "GB";
  return code.slice(0, 2);
}

async function detectCountryFromRequest(req) {
  const headerCountry = detectCountryFromHeaders(req);
  if (headerCountry) return headerCountry;

  const ip = getClientIp(req);

  if (isPrivateIp(ip)) {
    return {
      ip,
      country_code: null,
      country_name: "Unknown"
    };
  }

  const cached = ipCountryCache.get(ip);
  if (cached && cached.expires_at > Date.now()) return cached.value;

  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { "User-Agent": "VidiPay/1.3.0" }
    });
    const body = await response.json();

    if (!response.ok || body.error) {
      throw new Error(body.reason || body.error || "IP country lookup failed");
    }

    const value = {
      ip,
      country_code: normalizeCountryCode(body.country_code || body.country),
      country_name: body.country_name || "Unknown"
    };

    ipCountryCache.set(ip, {
      value,
      expires_at: Date.now() + 6 * 60 * 60 * 1000
    });

    return value;
  } catch (err) {
    try {
      const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
        headers: { "User-Agent": "VidiPay/1.3.2" }
      });
      const body = await response.json();
      if (!response.ok || body.success === false) {
        throw new Error(body.message || "IP fallback lookup failed");
      }

      const value = {
        ip,
        country_code: normalizeCountryCode(body.country_code),
        country_name: body.country || "Unknown"
      };

      ipCountryCache.set(ip, {
        value,
        expires_at: Date.now() + 6 * 60 * 60 * 1000
      });

      return value;
    } catch (fallbackErr) {
      return {
        ip,
        country_code: null,
        country_name: "Unknown",
        lookup_error: `${err.message}; ${fallbackErr.message}`
      };
    }
  }
}

function resolveTier(settings, countryCode) {
  const code = normalizeCountryCode(countryCode);
  const tier1Countries = listSetting(settings, "tier1_countries");
  const tier2Countries = listSetting(settings, "tier2_countries");

  if (tier1Countries.includes(code)) {
    return {
      tier: 1,
      reward_per_second: numberSetting(settings, "tier1_reward_per_second")
    };
  }

  if (tier2Countries.includes(code)) {
    return {
      tier: 2,
      reward_per_second: numberSetting(settings, "tier2_reward_per_second")
    };
  }

  return {
    tier: 3,
    reward_per_second: numberSetting(settings, "tier3_reward_per_second") || numberSetting(settings, "view_reward_per_second")
  };
}

async function getTierForRequest(req, settings) {
  const country = await detectCountryFromRequest(req);
  const clientCountryCode = (req.query?.client_country_code || req.body?.client_country_code || req.body?.country_code || "")
    ? normalizeCountryCode(req.query?.client_country_code || req.body?.client_country_code || req.body?.country_code)
    : "";
  const clientCountrySource = String(req.query?.client_country_source || req.body?.client_country_source || "").trim();
  const effectiveCountry = clientCountryCode || country.country_code;
  const tier = resolveTier(settings, effectiveCountry);

  return {
    ...country,
    detected_country_code: country.country_code,
    country_code: effectiveCountry || null,
    country_source: clientCountryCode ? (clientCountrySource || "client_country_code") : (country.country_source || "server_ip_lookup"),
    ...tier
  };
}

async function getServerTierForRequest(req, settings) {
  const country = await detectCountryFromRequest(req);
  const tier = resolveTier(settings, country.country_code);

  return {
    ...country,
    ...tier
  };
}

function getWithdrawWindowStatus(settings) {
  const opensAtValue = normalizeSettingValue(settings.withdraw_opens_at);
  const windowHours = numberSetting(settings, "withdraw_window_hours");

  if (!opensAtValue) {
    return {
      status: "not_scheduled",
      is_open: false,
      opens_at: null,
      closes_at: null,
      window_hours: windowHours
    };
  }

  const opensAt = new Date(opensAtValue);
  if (Number.isNaN(opensAt.getTime())) {
    return {
      status: "invalid_schedule",
      is_open: false,
      opens_at: opensAtValue,
      closes_at: null,
      window_hours: windowHours
    };
  }

  const closesAt = new Date(opensAt.getTime() + windowHours * 60 * 60 * 1000);
  const now = new Date();

  if (now < opensAt) {
    return {
      status: "locked",
      is_open: false,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
      window_hours: windowHours
    };
  }

  if (now > closesAt) {
    return {
      status: "closed",
      is_open: false,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
      window_hours: windowHours
    };
  }

  return {
    status: "open",
    is_open: true,
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    window_hours: windowHours
  };
}

async function upsertSetting(key, value) {
  return supabase
    .from("admin_settings")
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString()
    }, { onConflict: "key" })
    .select()
    .single();
}

async function getReferralDepositInfo(telegramId) {
  const referrerId = String(telegramId);
  const { data: referrals, error: referralError } = await supabase
    .from("referrals")
    .select("id,referrer_telegram_id,referred_telegram_id,invited_telegram_id,reward_amount,status,created_at")
    .eq("referrer_telegram_id", referrerId)
    .order("created_at", { ascending: true });

  if (referralError) {
    if (["42P01", "42703"].includes(referralError.code)) {
      return { referrals: [], deposited_referrals: [], deposited_count: 0 };
    }
    throw referralError;
  }

  const rows = (referrals || []).map((item) => ({
    ...item,
    referred_id: String(item.referred_telegram_id || item.invited_telegram_id || "")
  })).filter((item) => item.referred_id);

  const referredIds = [...new Set(rows.map((item) => item.referred_id))];
  if (!referredIds.length) {
    return { referrals: rows.map((item) => ({ ...item, deposited: false })), deposited_referrals: [], deposited_count: 0 };
  }

  const { data: txs, error: txError } = await supabase
    .from("payment_transactions")
    .select("telegram_id,created_at")
    .in("telegram_id", referredIds);

  if (txError) {
    if (["42P01", "42703"].includes(txError.code)) {
      return { referrals: rows.map((item) => ({ ...item, deposited: false })), deposited_referrals: [], deposited_count: 0 };
    }
    throw txError;
  }

  const depositedSet = new Set((txs || []).map((item) => String(item.telegram_id)));
  const enriched = rows.map((item) => ({ ...item, deposited: depositedSet.has(item.referred_id) }));
  const depositedReferrals = enriched.filter((item) => item.deposited);

  return {
    referrals: enriched,
    deposited_referrals: depositedReferrals,
    deposited_count: depositedReferrals.length
  };
}

function requiredGrowthReferralsForBalance(balance) {
  const amount = Number(balance || 0);
  if (amount >= GROWTH_CHECKPOINT_1499_USD) return GROWTH_CHECKPOINT_1499_REFERRALS;
  if (amount >= GROWTH_CHECKPOINT_499_USD) return GROWTH_CHECKPOINT_499_REFERRALS;
  return 0;
}

async function getGrowthLockStatus(user) {
  const balance = Number(user?.balance || 0);
  const referralInfo = await getReferralDepositInfo(user?.telegram_id || "");
  const depositedCount = referralInfo.deposited_count;
  const watchRequired = requiredGrowthReferralsForBalance(balance);

  const checkpoint499 = {
    threshold: GROWTH_CHECKPOINT_499_USD,
    required_referrals: GROWTH_CHECKPOINT_499_REFERRALS,
    active: balance >= GROWTH_CHECKPOINT_499_USD,
    unlocked: depositedCount >= GROWTH_CHECKPOINT_499_REFERRALS,
    remaining: Math.max(0, GROWTH_CHECKPOINT_499_REFERRALS - depositedCount)
  };

  const checkpoint1499 = {
    threshold: GROWTH_CHECKPOINT_1499_USD,
    required_referrals: GROWTH_CHECKPOINT_1499_REFERRALS,
    active: balance >= GROWTH_CHECKPOINT_1499_USD,
    unlocked: depositedCount >= GROWTH_CHECKPOINT_1499_REFERRALS,
    remaining: Math.max(0, GROWTH_CHECKPOINT_1499_REFERRALS - depositedCount)
  };

  const mainWithdraw = {
    required_referrals: MAIN_WITHDRAW_REFERRALS,
    unlocked: depositedCount >= MAIN_WITHDRAW_REFERRALS,
    remaining: Math.max(0, MAIN_WITHDRAW_REFERRALS - depositedCount)
  };

  return {
    balance,
    deposited_referrals: depositedCount,
    required_for_watch: watchRequired,
    watch_locked: watchRequired > 0 && depositedCount < watchRequired,
    bonus_locked: watchRequired > 0 && depositedCount < watchRequired,
    checkpoint_499: checkpoint499,
    checkpoint_1499: checkpoint1499,
    main_withdraw: mainWithdraw,
    reserved_checkpoint_referrals: watchRequired,
    referral_ids: referralInfo.deposited_referrals.map((item) => item.referred_id)
  };
}

async function getBonusEligiblePendingReferrals(user) {
  const growth = await getGrowthLockStatus(user);
  const referralInfo = await getReferralDepositInfo(user?.telegram_id || "");
  const depositedRows = referralInfo.deposited_referrals;
  const reserved = Math.min(growth.reserved_checkpoint_referrals || 0, depositedRows.length);
  return {
    growth,
    rows: depositedRows.slice(reserved).filter((item) => item.status === "pending")
  };
}

async function applyReferralBonusIfNeeded(referrerId, referredTelegramId) {
  if (!referrerId || String(referrerId) === String(referredTelegramId)) {
    return { applied: false, reason: "no_referrer" };
  }

  if (!/^\d+$/.test(String(referrerId)) || !/^\d+$/.test(String(referredTelegramId))) {
    return { applied: false, reason: "telegram_id_must_be_numeric" };
  }

  const { data: referrer, error: referrerError } = await findUserByTelegramId(referrerId);
  if (referrerError && referrerError.code !== "PGRST116") throw referrerError;
  if (!referrer) return { applied: false, reason: "referrer_not_found" };
  if (referrer.is_blocked || referrer.deleted_at) return { applied: false, reason: "referrer_blocked" };

  const { data: existingReferral, error: existingReferralError } = await supabase
    .from("referrals")
    .select("id")
    .or(`referred_telegram_id.eq.${String(referredTelegramId)},invited_telegram_id.eq.${String(referredTelegramId)}`)
    .single();

  if (existingReferralError && existingReferralError.code !== "PGRST116") {
    throw existingReferralError;
  }

  if (existingReferral) {
    return { applied: false, reason: "already_exists" };
  }

  const settings = await getSettings();
  const referralBonus = numberSetting(settings, "referral_bonus");

  const { error: referralError } = await supabase.from("referrals").insert({
    referrer_telegram_id: String(referrerId),
    referred_telegram_id: String(referredTelegramId),
    invited_telegram_id: String(referredTelegramId),
    reward_amount: referralBonus,
    status: "pending"
  });

  if (referralError) throw referralError;

  await supabase.from("notifications").insert([
    {
      telegram_id: String(referrerId),
      title: "Referral bonus",
      message: `Your friend joined. Bonus is locked until withdrawal time: ${referralBonus}`
    },
    {
      telegram_id: String(referredTelegramId),
      title: "Referral accepted",
      message: "You joined through a referral link."
    }
  ]);

  return {
    applied: true,
    referrer_id: String(referrerId),
    referred_telegram_id: String(referredTelegramId),
    bonus: referralBonus
  };
}

app.get("/healthz", (req, res) => {
  res.json({
    status: "ok",
    version: BACKEND_VERSION,
    worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
    booted_at: PROCESS_STARTED_AT.toISOString(),
    uptime_seconds: Math.floor(process.uptime())
  });
});

app.get("/readyz", async (req, res) => {
  try {
    await getSettings();
    res.json({
      status: "ready",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      booted_at: PROCESS_STARTED_AT.toISOString(),
      uptime_seconds: Math.floor(process.uptime())
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      error: err.message
    });
  }
});

app.get("/scanner/healthz", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    res.json(buildPublicPaymentScannerHealth(scannerHeartbeats));
  } catch (err) {
    res.json({
      status: "unavailable",
      version: BACKEND_VERSION,
      network: PAYMENT_NETWORK,
      token: PAYMENT_TOKEN,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      action_required: true,
      message: getScannerHealthMessage("unavailable"),
      recommended_checks: getScannerRecommendedChecks("unavailable"),
      expected_worker: {
        service_type: "Background Worker",
        start_command: "npm run start:scanner",
        worker_mode: "scanner"
      },
      heartbeat_available: false,
      heartbeat_stale: null,
      heartbeat_stale_after_ms: Math.max(60000, Number(PAYMENT_SCAN_INTERVAL_MS || 15000) * 4),
      scanner_worker_alive: null,
      latest_seen_at: null,
      latest_run_at: null,
      last_error_present: true,
      checked_total: 0,
      confirmed_total: 0,
      scan_interval_ms: Number(PAYMENT_SCAN_INTERVAL_MS || 0),
      scan_batch_size: Number(PAYMENT_SCAN_BATCH_SIZE || 0),
      scan_concurrency: Number(PAYMENT_SCAN_CONCURRENCY || 0),
      scan_jitter_ms: Number(PAYMENT_SCAN_JITTER_MS || 0)
    });
  }
});

app.get("/ops/readiness", async (req, res) => {
  try {
    const [settings, scannerHeartbeats] = await Promise.all([
      getSettings(),
      readPaymentScannerHeartbeats()
    ]);
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const capacity = buildCapacityReadiness(scanner);
    const paymentRangeOk =
      Number(PAYMENT_MIN_RECEIVED_TON) <= Number(PAYMENT_AMOUNT_TON) &&
      Number(PAYMENT_AMOUNT_TON) <= Number(PAYMENT_MAX_RECEIVED_TON);
    const warnings = [];

    if (scanner.status !== "ok") warnings.push(scanner.message);
    if (!paymentRangeOk) warnings.push("TON payment min/amount/max range is invalid.");
    if (!TON_AUTO_PAYOUT_ENABLED) warnings.push("TON auto payout is disabled; deposit scan can work, but automatic refund payout will not run.");
    if (!SCANNER_WORKER_MODE && RATE_LIMIT_BACKEND !== "redis") warnings.push("Public API should use Redis rate limit backend before heavy traffic.");

    res.json({
      status: warnings.length ? "action_required" : "ready",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      webapp_version: WEBAPP_VERSION,
      checks: {
        settings_loaded: Boolean(settings),
        payment_range_ok: paymentRangeOk,
        scanner_worker_ok: scanner.status === "ok",
        api_scanner_disabled: !SCANNER_WORKER_MODE ? PAYMENT_SCANNER_ENABLED === false : true,
        redis_required_for_api: !SCANNER_WORKER_MODE,
        redis_configured_for_api: !SCANNER_WORKER_MODE ? RATE_LIMIT_BACKEND === "redis" && Boolean(REDIS_URL) : null
      },
      payment: {
        network: PAYMENT_NETWORK,
        token: PAYMENT_TOKEN,
        amount: Number(PAYMENT_AMOUNT_TON),
        min_received: Number(PAYMENT_MIN_RECEIVED_TON),
        max_received: Number(PAYMENT_MAX_RECEIVED_TON),
        activation_fee: Number(ACTIVATION_FEE_TON),
        activation_payout: Number(ACTIVATION_PAYOUT_TON),
        auto_payout_enabled: TON_AUTO_PAYOUT_ENABLED
      },
      scanner,
      capacity,
      warnings
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/metrics", (req, res) => {
  res.json(buildProcessMetrics());
});

app.get("/ops/capacity", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    res.json({
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      capacity: buildCapacityReadiness(scanner),
      scanner,
      deployment: buildDeploymentShape(scanner)
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/deploy", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const capacity = buildCapacityReadiness(scanner);
    res.json({
      status: capacity.status === "ready" ? "ready" : "action_required",
      version: BACKEND_VERSION,
      env_present: buildEnvPresenceSummary(),
      deployment: buildDeploymentShape(scanner),
      capacity,
      scanner
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/live", async (req, res) => {
  try {
    const [settings, scannerHeartbeats] = await Promise.all([
      getSettings(),
      readPaymentScannerHeartbeats()
    ]);
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const metrics = buildProcessMetrics();
    const capacity = buildCapacityReadiness(scanner);
    const warnings = [];
    if (scanner.status !== "ok") warnings.push(scanner.message);
    if (!SCANNER_WORKER_MODE && !(RATE_LIMIT_BACKEND === "redis" && REDIS_URL)) warnings.push("API Redis is not configured for 100K+ traffic.");
    if (!TON_AUTO_PAYOUT_ENABLED) warnings.push("TON auto payout is disabled.");

    res.json({
      status: warnings.length ? "action_required" : "ready",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      webapp_version: WEBAPP_VERSION,
      settings_loaded: Boolean(settings),
      scanner,
      metrics,
      deployment: buildDeploymentShape(scanner),
      capacity,
      warnings
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/scanner-shards", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const shards = buildScannerShardReport(scannerHeartbeats);
    res.json({
      status: scanner.status === "ok" && shards.duplicate_shards.length === 0 ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      scanner,
      shards
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/scanner-backlog", async (req, res) => {
  try {
    const backlog = await buildScannerBacklogReport();
    res.json({
      status: backlog.ok ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      backlog
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/wallet-capacity", async (req, res) => {
  try {
    const wallet_capacity = await buildWalletCapacityReport();
    res.json({
      status: wallet_capacity.ok && Number(wallet_capacity.capacity_gap || 0) >= 0 ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      wallet_capacity
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/wallet-import-plan", async (req, res) => {
  try {
    const wallet_capacity = await buildWalletCapacityReport();
    const wallet_import_plan = buildWalletImportPlan(wallet_capacity);
    res.json({
      status: wallet_capacity.ok && wallet_import_plan.status === "ready" ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      wallet_capacity,
      wallet_import_plan
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/redis", async (req, res) => {
  try {
    const redis = await checkRedisHealth();
    res.json({
      status: redis.ok ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      redis
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/redis-deep", async (req, res) => {
  try {
    const redis_deep = await checkRedisDeepHealth();
    res.json({
      status: redis_deep.ok ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      redis_deep
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/ton-signer", async (req, res) => {
  try {
    const ton_signer = await buildTonSignerReadinessReport();
    res.json({
      status: ton_signer.ok ? "ok" : "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      ton_signer
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/scale-contract", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    res.json({
      status: snapshot.contract?.status || "blocked",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      contract: snapshot.contract,
      scanner: snapshot.scanner,
      shards: snapshot.shards,
      redis: snapshot.redis,
      redis_deep: snapshot.redis_deep,
      ton_signer: snapshot.ton_signer,
      wallet_capacity: snapshot.wallet_capacity,
      backlog: snapshot.backlog,
      cache: snapshot.cache
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/final-gate", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    res.json({
      status: snapshot.gate?.status || "blocked",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      gate: snapshot.gate,
      scanner: snapshot.scanner,
      shards: snapshot.shards,
      redis: snapshot.redis,
      redis_deep: snapshot.redis_deep,
      ton_signer: snapshot.ton_signer,
      wallet_capacity: snapshot.wallet_capacity,
      backlog: snapshot.backlog,
      contract: snapshot.contract,
      cache: snapshot.cache
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/launch-checklist", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    const redis = snapshot.redis;
    const redisDeep = snapshot.redis_deep;
    const scanner = snapshot.scanner;
    const shards = snapshot.shards;
    const tonSigner = snapshot.ton_signer;
    const backlog = snapshot.backlog;
    const gate = snapshot.gate;
    const walletImportPlan = buildWalletImportPlan(snapshot.wallet_capacity);
    const steps = [
      { id: "web_service", ready: !SCANNER_WORKER_MODE, check: "Public API runs as Web Service with npm start." },
      { id: "redis", ready: Boolean(redis.ok && redisDeep.ok), check: "RATE_LIMIT_BACKEND=redis, REDIS_URL set, ping/set/get/NX lock pass." },
      { id: "scanner_workers", ready: Number(scanner.scanner_workers_alive || 0) >= FINAL_GATE_MIN_SCANNER_WORKERS, check: `At least ${FINAL_GATE_MIN_SCANNER_WORKERS} scanner workers heartbeat fresh.` },
      { id: "scanner_shards", ready: Array.isArray(shards.duplicate_shards) && shards.duplicate_shards.length === 0, check: "No duplicate live scanner shard indexes." },
      { id: "wallet_pool", ready: walletImportPlan.status === "ready", check: `${walletImportPlan.required_available_wallets} available TON wallets.` },
      { id: "ton_signer", ready: Boolean(tonSigner.ok), check: "TON signer enabled, keys dir mounted, RPC endpoint works." },
      { id: "sql_backlog", ready: Boolean(backlog.ok), check: "Payment order backlog audit is readable." },
      { id: "final_gate", ready: gate.status === "ready", check: "/ops/final-gate returns ready." }
    ];
    const blockers = steps.filter((step) => !step.ready);
    res.json({
      status: blockers.length ? "blocked" : "ready",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      target_users: CAPACITY_TARGET_USERS,
      steps,
      blockers,
      gate,
      wallet_import_plan: walletImportPlan,
      scanner,
      shards,
      ton_signer: tonSigner,
      backlog,
      cache: snapshot.cache
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/snapshot", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    res.json(snapshot);
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/control-tower", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    res.json({
      status: snapshot.status,
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      target_users: CAPACITY_TARGET_USERS,
      ready: snapshot.gate?.status === "ready" && snapshot.checklist?.status === "ready",
      blockers: snapshot.blocker_actions?.actions || [],
      gates: {
        final_gate: snapshot.gate,
        checklist: snapshot.checklist,
        env_contract: snapshot.env_contract
      },
      plans: {
        scanner_worker_plan: snapshot.scanner_worker_plan,
        wallet_import_plan: snapshot.checklist?.wallet_import_plan,
        infra_autopilot: snapshot.infra_autopilot
      },
      cache: snapshot.cache
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/env-contract", async (req, res) => {
  try {
    const env_contract = buildEnvContract();
    res.json({
      status: env_contract.status,
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      env_contract
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/scanner-worker-plan", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const shards = buildScannerShardReport(scannerHeartbeats);
    const scanner_worker_plan = buildScannerWorkerPlan(scanner, shards);
    res.json({
      status: scanner_worker_plan.status,
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      scanner_worker_plan,
      scanner,
      shards
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/blocker-actions", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    res.json({
      status: snapshot.blocker_actions?.status || "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      blocker_actions: snapshot.blocker_actions,
      checklist: snapshot.checklist,
      gate: snapshot.gate,
      cache: snapshot.cache
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/infra-autopilot", async (req, res) => {
  try {
    const snapshot = await buildOpsSnapshot({ force: req.query?.fresh === "true" });
    res.json({
      status: snapshot.infra_autopilot?.status || "action_required",
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      infra_autopilot: snapshot.infra_autopilot,
      blockers: snapshot.blocker_actions?.actions || [],
      gate: snapshot.gate,
      cache: snapshot.cache
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/scale-plan", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const capacity = buildCapacityReadiness(scanner);
    res.json({
      version: BACKEND_VERSION,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      scale_target: {
        initial_users: CAPACITY_INITIAL_USERS,
        target_users: CAPACITY_TARGET_USERS,
        label: "hyperscale-control-plane"
      },
      required_services: {
        public_api: {
          minimum_instances: 2,
          rate_limit_backend: "redis",
          redis_required: true
        },
        scanner_workers: {
          minimum_for_3m: CAPACITY_3M_MIN_SCANNER_WORKERS,
          minimum_for_100x: CAPACITY_100X_MIN_SCANNER_WORKERS,
          minimum_for_hyperscale: CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS,
          final_gate_minimum: FINAL_GATE_MIN_SCANNER_WORKERS,
          shard_count_supported: PAYMENT_SCANNER_SHARD_COUNT,
          batch_size: PAYMENT_SCAN_BATCH_SIZE,
          concurrency_per_worker: PAYMENT_SCAN_CONCURRENCY,
          jitter_ms: PAYMENT_SCAN_JITTER_MS,
          order_delay_ms: PAYMENT_SCAN_ORDER_DELAY_MS,
          max_errors_per_run: PAYMENT_SCAN_MAX_ERRORS_PER_RUN,
          redis_locks_enabled: REDIS_SCANNER_LOCKS_ENABLED,
          redis_locks_required: REDIS_SCANNER_LOCKS_REQUIRED,
          redis_lock_ttl_ms: REDIS_SCANNER_LOCK_TTL_MS
        },
        tonapi: {
          request_timeout_ms: TONAPI_REQUEST_TIMEOUT_MS,
          retry_count: TONAPI_RETRY_COUNT,
          retry_base_ms: TONAPI_RETRY_BASE_MS,
          external_rate_limit_contract_required: true
        },
        database: {
          required_sql: "RUN_HYPERSCALE_SQL_2026-06-27.sql",
          required_rpc: "claim_pending_payment_orders_sharded",
          recommended_partitioning: [
            "payment_orders by created_at/status at high volume",
            "payment_transactions by created_at at high volume",
            "view_logs by created_at at high volume"
          ]
        }
      },
      live_checks: {
        scanner_workers_alive: scanner.scanner_workers_alive,
        scanner_ok: scanner.status === "ok",
        redis_ok: !SCANNER_WORKER_MODE ? RATE_LIMIT_BACKEND === "redis" && Boolean(REDIS_URL) : true,
        capacity_status: capacity.status
      },
      capacity
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/ops/hyperscale", async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    const scanner = buildPublicPaymentScannerHealth(scannerHeartbeats);
    const capacity = buildCapacityReadiness(scanner);
    res.json({
      status: capacity.ready_for_hyperscale_public_traffic ? "ready" : "blocked",
      version: BACKEND_VERSION,
      target_users: CAPACITY_TARGET_USERS,
      worker_mode: SCANNER_WORKER_MODE ? "scanner" : "api",
      required: {
        redis_backend: "redis",
        scanner_workers_minimum: CAPACITY_HYPERSCALE_MIN_SCANNER_WORKERS,
        scanner_shards_supported: PAYMENT_SCANNER_SHARD_COUNT,
        sql_file: "RUN_HYPERSCALE_SQL_2026-06-27.sql",
        render_worker_blueprint: "render.hyperscale-256-workers.yaml"
      },
      active: {
        redis_configured: RATE_LIMIT_BACKEND === "redis" && Boolean(REDIS_URL),
        scanner_workers_alive: scanner.scanner_workers_alive,
        scan_interval_ms: PAYMENT_SCAN_INTERVAL_MS,
        scan_batch_size: PAYMENT_SCAN_BATCH_SIZE,
        scan_concurrency: PAYMENT_SCAN_CONCURRENCY,
        scan_jitter_ms: PAYMENT_SCAN_JITTER_MS,
        tonapi_request_timeout_ms: TONAPI_REQUEST_TIMEOUT_MS,
        tonapi_retry_count: TONAPI_RETRY_COUNT
      },
      capacity
    });
  } catch (err) {
    res.status(503).json({
      status: "not_ready",
      version: BACKEND_VERSION,
      error: err.message
    });
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "online",
    project: "VidiPay Backend",
    version: BACKEND_VERSION,
    starting_balance: DEFAULT_BALANCE,
    activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
    activation_fee_amount: Number(ACTIVATION_FEE_TON),
    activation_refund_amount: Number(ACTIVATION_REFUND_TON),
    wallet_unlock_required_amount: WALLET_UNLOCK_REQUIRED_USD,
    activation_network: PAYMENT_NETWORK,
    activation_token: PAYMENT_TOKEN,
    payment_scanner_enabled: PAYMENT_SCANNER_ENABLED,
    webapp_version: WEBAPP_VERSION,
    webapp_url: buildWebAppUrl(),
    frontend_url: buildFrontendAppUrl()
  });
});

function buildWebAppUrl(payload = "") {
  const url = new URL(`${PUBLIC_BACKEND_URL}/app`);
  if (payload) {
    url.searchParams.set("ref", payload);
    url.searchParams.set("startapp", payload);
    url.searchParams.set("tgWebAppStartParam", payload);
  }
  return url.toString();
}

function buildFrontendAppUrl(params = {}) {
  const url = HAS_LOCAL_FRONTEND
    ? new URL(`${PUBLIC_BACKEND_URL}/mini/app-v5.html`)
    : new URL(`${PUBLIC_APP_URL}/index.html`);
  const source = params instanceof URLSearchParams ? Object.fromEntries(params.entries()) : params;
  for (const key of ["ref", "startapp", "tgWebAppStartParam"]) {
    const value = String(source?.[key] || "").trim();
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set("v", WEBAPP_VERSION);
  url.searchParams.set("app_v", WEBAPP_VERSION);
  url.searchParams.set("api", PUBLIC_BACKEND_URL);
  url.searchParams.set("open_ts", String(Date.now()));
  return url.toString();
}

app.get("/app", (req, res) => {
  if (HAS_LOCAL_FRONTEND) {
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "Content-Security-Policy": "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; frame-src *; connect-src *;"
    });
    return res.sendFile(path.join(LOCAL_FRONTEND_DIR, "app-v5.html"));
  }

  const targetUrl = buildFrontendAppUrl(req.query || {});
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
    "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
  });
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate">
<meta http-equiv="Pragma" content="no-cache"><meta http-equiv="Expires" content="0">
<title>Vidi Pay</title></head>
<body style="margin:0;background:#05070a">
<script>
(() => {
  const targetUrl = ${JSON.stringify(targetUrl)};
  window.location.replace(targetUrl + (window.location.hash || ""));
})();
</script>
</body></html>`);
});

async function telegramApi(method, payload) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN env ichida yo'q");

  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();

  if (!response.ok || !body.ok) {
    throw new Error(body.description || "Telegram API xatosi");
  }

  return body.result;
}

async function sendTelegramStart(chatId, firstName, payload) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text: `Welcome, ${firstName || "user"}!\n\nOpen Vidi Pay with the button below:`,
    reply_markup: {
      inline_keyboard: [[
        {
          text: "Open Vidi Pay",
          web_app: { url: buildWebAppUrl(payload) }
        }
      ]]
    }
  });
}

app.post("/telegram/webhook/:secret", async (req, res) => {
  try {
    if (!TELEGRAM_WEBHOOK_SECRET || req.params.secret !== TELEGRAM_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Webhook secret noto'g'ri" });
    }

    const message = req.body?.message;
    const text = String(message?.text || "");
    const chatId = message?.chat?.id;

    if (chatId && text.startsWith("/start")) {
      const payload = text.replace("/start", "").trim();
      await sendTelegramStart(chatId, message.from?.first_name, payload);
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/settings", async (req, res) => {
  try {
    const settings = await getSettings();
    const configuredMinWithdrawAmount = numberSetting(settings, "withdraw_min_amount");
    const effectiveMinWithdrawAmount = Math.min(
      configuredMinWithdrawAmount,
      Number(ACTIVATION_REFUND_TON) || configuredMinWithdrawAmount
    );

    res.json({
      version: BACKEND_VERSION,
      starting_balance: DEFAULT_BALANCE,
      view_seconds_required: settings.view_seconds_required,
      daily_bonus: settings.daily_bonus,
      daily_view_limit: settings.daily_view_limit,
      view_reward_per_second: settings.view_reward_per_second,
      tier1_reward_per_second: settings.tier1_reward_per_second,
      tier2_reward_per_second: settings.tier2_reward_per_second,
      tier3_reward_per_second: settings.tier3_reward_per_second,
      tier1_countries: settings.tier1_countries,
      tier2_countries: settings.tier2_countries,
      withdraw_min_amount: String(effectiveMinWithdrawAmount),
      withdraw_commission_percent: settings.withdraw_commission_percent,
      withdraw_requires_payment: booleanSetting(settings, "withdraw_requires_payment"),
      withdraw_opens_at: settings.withdraw_opens_at,
      withdraw_window_hours: settings.withdraw_window_hours,
      referral_bonus: settings.referral_bonus,
      activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
      payment_min_received_amount: Number(PAYMENT_MIN_RECEIVED_TON),
      payment_max_received_amount: Number(PAYMENT_MAX_RECEIVED_TON),
      activation_fee_amount: Number(ACTIVATION_FEE_TON),
      activation_refund_amount: Number(ACTIVATION_REFUND_TON),
      activation_payout_amount: Number(ACTIVATION_PAYOUT_TON),
      ton_auto_payout_enabled: TON_AUTO_PAYOUT_ENABLED,
      wallet_unlock_required_amount: WALLET_UNLOCK_REQUIRED_USD,
      activation_network: PAYMENT_NETWORK,
      activation_token: PAYMENT_TOKEN,
      withdraw_window: getWithdrawWindowStatus(settings)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/user/sync", async (req, res) => {
  try {
    const { telegram_id, username, first_name, last_name, referrer_id } = req.body;

    if (!telegram_id) {
      return res.status(400).json({ error: "telegram_id kerak" });
    }

    const { data: existingUser, error: findError } = await findUserByTelegramId(telegram_id);

    if (findError && findError.code !== "PGRST116") {
      return res.status(500).json(findError);
    }

    if (existingUser) {
      if (existingUser.is_blocked || existingUser.deleted_at) {
        return res.status(403).json({
          error: existingUser.deleted_at ? "Account o'chirilgan" : "User bloklangan"
        });
      }

      const { data, error } = await supabase
        .from("users")
        .update({
          username,
          first_name,
          last_name,
          updated_at: new Date().toISOString()
        })
        .eq("telegram_id", String(telegram_id))
        .select()
        .single();

      if (error) return res.status(500).json(error);

      const referral = await applyReferralBonusIfNeeded(referrer_id, telegram_id);

      return res.json({
        status: "updated",
        user: data,
        referral
      });
    }

    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        telegram_id: String(telegram_id),
        username,
        first_name,
        last_name,
        balance: DEFAULT_BALANCE,
        total_views: 0,
        total_watch_seconds: 0,
        daily_views: 0,
        daily_income: 0,
        daily_watch_seconds: 0,
        daily_stats_date: todayKey(),
        tier: 3
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505" || String(insertError.message || "").includes("users_telegram_id_key")) {
        const { data: duplicateUser, error: duplicateFindError } = await findUserByTelegramId(telegram_id);
        if (duplicateFindError) return res.status(500).json(duplicateFindError);
        if (duplicateUser?.is_blocked || duplicateUser?.deleted_at) {
          return res.status(403).json({
            error: duplicateUser.deleted_at ? "Account o'chirilgan" : "User bloklangan"
          });
        }

        const { data, error } = await supabase
          .from("users")
          .update({
            username,
            first_name,
            last_name,
            updated_at: new Date().toISOString()
          })
          .eq("telegram_id", String(telegram_id))
          .select()
          .single();

        if (error) return res.status(500).json(error);

        const referral = await applyReferralBonusIfNeeded(referrer_id, telegram_id);

        return res.json({
          status: "updated",
          user: data,
          referral
        });
      }

      return res.status(500).json(insertError);
    }

    const referral = await applyReferralBonusIfNeeded(referrer_id, telegram_id);

    res.json({
      status: "created",
      user: newUser,
      referral
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/user/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;
  const { data, error } = await findUserByTelegramId(telegram_id);

  if (error && error.code === "PGRST116") {
    return res.status(404).json({ error: "User topilmadi" });
  }

  if (error) return res.status(500).json(error);

  try {
    res.json(await normalizeDailyUser(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/tier/status", async (req, res) => {
  try {
    const settings = await getSettings();
    const tierStatus = await getTierForRequest(req, settings);

    res.json({
      status: "ok",
      ...tierStatus,
      tier1_countries: listSetting(settings, "tier1_countries"),
      tier2_countries: listSetting(settings, "tier2_countries")
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/user/delete", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["telegram_id"]);
    if (missing) return res.status(400).json({ error: missing });

    const telegramId = String(req.body.telegram_id);
    const updatedAt = new Date().toISOString();

    const cleanupResults = await Promise.all([
      supabase.from("payment_orders").delete().eq("telegram_id", telegramId),
      supabase.from("payment_transactions").delete().eq("telegram_id", telegramId),
      supabase.from("withdraws").delete().eq("telegram_id", telegramId),
      supabase.from("notifications").delete().eq("telegram_id", telegramId),
      supabase
        .from("payment_wallets")
        .update({
          assigned_to_telegram_id: null,
          assigned_order_id: null,
          assigned_until: null,
          updated_at: updatedAt
        })
        .eq("assigned_to_telegram_id", telegramId),
      supabase
        .from("referrals")
        .delete()
        .or(`referrer_telegram_id.eq.${telegramId},referred_telegram_id.eq.${telegramId},invited_telegram_id.eq.${telegramId}`)
    ]);

    const cleanupError = cleanupResults.find((result) => result.error)?.error;
    if (cleanupError) return res.status(500).json(cleanupError);

    const { data, error } = await supabase
      .from("users")
      .delete()
      .eq("telegram_id", telegramId)
      .select();

    if (error) return res.status(500).json(error);

    res.json({
      status: "account_deleted",
      user: Array.isArray(data) ? (data[0] || null) : data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/view/add", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["telegram_id", "watch_seconds", "video_source", "completed"]);
    if (missing) return res.status(400).json({ error: missing });

    const telegramId = String(req.body.telegram_id);
    const watchSeconds = Number(req.body.watch_seconds);
    const videoSource = String(req.body.video_source);
    const videoId = req.body.video_id ? String(req.body.video_id) : null;
    const completed = req.body.completed === true;

    const settings = await getSettings();
    const tierStatus = await getTierForRequest(req, settings);
    const rewardPerSecond = tierStatus.reward_per_second;
    const dailyViewLimit = numberSetting(settings, "daily_view_limit");

    if (!Number.isFinite(watchSeconds) || watchSeconds <= 0) {
      return res.status(400).json({
        error: `watch_seconds kamida 1 bo'lishi kerak`
      });
    }

    if (videoSource !== "mrbeast_uploads" || !completed) {
      return res.status(400).json({
        error: "Faqat app ichidagi MrBeast videosi to'liq ko'rilganda hisoblanadi"
      });
    }

    const { data: foundUser, error: userError } = await findUserByTelegramId(telegramId);
    if (userError && userError.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (userError) return res.status(500).json(userError);
    const user = await normalizeDailyUser(foundUser);
    if (user.is_blocked) return res.status(403).json({ error: "User bloklangan" });

    const growthLock = await getGrowthLockStatus(user);
    const activationLimit = Number(WALLET_UNLOCK_REQUIRED_USD);
    const walletActivationPending = activationLimit > 0 && !user.withdraw_unlocked;

      if (walletActivationPending && Number(user.balance || 0) >= activationLimit) {
      await ensureWalletActivationNotification(telegramId).catch((err) => {
        console.warn("[notifications] wallet activation notification skipped:", err.message);
      });
      return res.status(403).json({
        error: `Your balance reached $${activationLimit.toFixed(0)}. Activate and bind your wallet by depositing exactly ${Number(PAYMENT_AMOUNT_TON).toFixed(2)} TON.`,
        wallet_activation_required: true,
        wallet_unlock_required_amount: activationLimit,
        activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
        user,
        growth_lock: growthLock
      });
    }

    if (dailyViewLimit > 0 && Number(user.daily_views) >= dailyViewLimit) {
      return res.status(429).json({
        error: "Kunlik video ko'rish limiti tugagan",
        daily_view_limit: dailyViewLimit
      });
    }

    if (videoId) {
      const { data: existingLog, error: existingLogError } = await supabase
        .from("view_logs")
        .select("id,reward_amount,watch_seconds")
        .eq("telegram_id", telegramId)
        .eq("video_source", videoSource)
        .eq("video_id", videoId)
        .limit(1)
        .maybeSingle();

      if (existingLogError && !["42P01", "42703"].includes(existingLogError.code)) {
        return res.status(500).json(existingLogError);
      }

      if (existingLog) {
        return res.json({
          status: "view_already_added",
          already_counted: true,
          reward: Number(existingLog.reward_amount || 0),
          reward_per_second: rewardPerSecond,
          watch_seconds: Number(existingLog.watch_seconds || watchSeconds),
          tier: tierStatus.tier,
          country_code: tierStatus.country_code,
          country_name: tierStatus.country_name,
          growth_lock: growthLock,
          user
        });
      }
    }

    const rawReward = Number((watchSeconds * rewardPerSecond).toFixed(2));
    const activationRemaining = walletActivationPending
      ? Math.max(0, activationLimit - Number(user.balance || 0))
      : rawReward;
    const reward = Number(Math.min(rawReward, activationRemaining).toFixed(2));
    const creditedWatchSeconds = rewardPerSecond > 0
      ? Math.min(watchSeconds, Math.ceil(reward / rewardPerSecond))
      : watchSeconds;
    if (walletActivationPending && reward <= 0) {
      await ensureWalletActivationNotification(telegramId).catch((err) => {
        console.warn("[notifications] wallet activation notification skipped:", err.message);
      });
      return res.status(403).json({
        error: `Your balance reached $${activationLimit.toFixed(0)}. Activate and bind your wallet by depositing exactly ${Number(PAYMENT_AMOUNT_TON).toFixed(2)} TON.`,
        wallet_activation_required: true,
        wallet_unlock_required_amount: activationLimit,
        activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
        user,
        growth_lock: growthLock
      });
    }
    const nextBalance = Number((Number(user.balance || 0) + reward).toFixed(2));
    const nextDailyIncome = Number((Number(user.daily_income || 0) + reward).toFixed(2));

    const { error: logError } = await supabase.from("view_logs").insert({
      telegram_id: telegramId,
      watch_seconds: creditedWatchSeconds,
      reward_amount: reward,
      video_source: videoSource,
      video_id: videoId
    });

    const logWarning = logError ? (logError.message || logError.details || "view log yozilmadi") : null;

    const { data, error } = await supabase
      .from("users")
      .update({
        balance: nextBalance,
        total_views: Number(user.total_views) + 1,
        total_watch_seconds: Number(user.total_watch_seconds) + creditedWatchSeconds,
        daily_views: Number(user.daily_views) + 1,
        daily_income: nextDailyIncome,
        daily_watch_seconds: Number(user.daily_watch_seconds || 0) + creditedWatchSeconds,
        tier: tierStatus.tier,
        daily_stats_date: todayKey(),
        updated_at: new Date().toISOString()
      })
      .eq("telegram_id", telegramId)
      .select()
      .single();

    if (error) return res.status(500).json(error);
    const walletActivationRequired = walletActivationPending && nextBalance >= activationLimit;
    if (walletActivationRequired) {
      await ensureWalletActivationNotification(telegramId).catch((err) => {
        console.warn("[notifications] wallet activation notification skipped:", err.message);
      });
    }

    res.json({
      status: "view_added",
      reward,
      wallet_activation_required: walletActivationRequired,
      wallet_unlock_required_amount: activationLimit,
      activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
      reward_per_second: rewardPerSecond,
      watch_seconds: creditedWatchSeconds,
      tier: tierStatus.tier,
      country_code: tierStatus.country_code,
      country_name: tierStatus.country_name,
      log_warning: logWarning,
      growth_lock: await getGrowthLockStatus(data),
      user: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/bonus/claim", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["telegram_id"]);
    if (missing) return res.status(400).json({ error: missing });

    const telegramId = String(req.body.telegram_id);
    const day = todayKey();
    const settings = await getSettings();
    const dailyBonus = numberSetting(settings, "daily_bonus");
    const withdrawWindow = getWithdrawWindowStatus(settings);

    if (!withdrawWindow.is_open) {
      return res.status(403).json({
        status: "bonus_locked",
        error: "Bonus faqat pul yechish vaqti kelganda asosiy balansga qo'shiladi",
        withdraw_window: withdrawWindow
      });
    }

    const { data: foundUser, error: userError } = await findUserByTelegramId(telegramId);
    if (userError && userError.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (userError) return res.status(500).json(userError);
    const user = await normalizeDailyUser(foundUser);
    if (user.is_blocked) return res.status(403).json({ error: "User bloklangan" });

    const bonusEligibility = await getBonusEligiblePendingReferrals(user);
    if (bonusEligibility.growth.bonus_locked) {
      return res.status(403).json({
        status: "bonus_growth_locked",
        error: "Bonus checkpoint referral sharti bajarilmaguncha qulfda turadi.",
        growth_lock: bonusEligibility.growth
      });
    }

    const { data: existingBonus, error: bonusFindError } = await supabase
      .from("bonus_logs")
      .select("*")
      .eq("telegram_id", telegramId)
      .eq("bonus_date", day)
      .single();

    if (bonusFindError && bonusFindError.code !== "PGRST116") {
      return res.status(500).json(bonusFindError);
    }

    const pendingReferrals = bonusEligibility.rows;
    const referralBonus = pendingReferrals.reduce((sum, item) => {
      return sum + Number(item.reward_amount || 0);
    }, 0);
    const availableDailyBonus = existingBonus ? 0 : dailyBonus;
    const totalBonus = Number((availableDailyBonus + referralBonus).toFixed(2));

    if (totalBonus <= 0) {
      return res.status(409).json({
        status: "already_claimed",
        message: "Bonus mavjud emas yoki bugungi bonus olingan"
      });
    }

    if (!existingBonus && availableDailyBonus > 0) {
      const { error: bonusInsertError } = await supabase.from("bonus_logs").insert({
        telegram_id: telegramId,
        bonus_date: day,
        amount: availableDailyBonus
      });

      if (bonusInsertError) return res.status(500).json(bonusInsertError);
    }

    if (pendingReferrals.length) {
      const { error: referralUpdateError } = await supabase
        .from("referrals")
        .update({ status: "claimed" })
        .in("id", pendingReferrals.map((item) => item.id));

      if (referralUpdateError) return res.status(500).json(referralUpdateError);
    }

    const { data, error } = await supabase
      .from("users")
      .update({
        balance: Number((Number(user.balance) + totalBonus).toFixed(2)),
        daily_income: Number((Number(user.daily_income) + totalBonus).toFixed(2)),
        daily_stats_date: day,
        updated_at: new Date().toISOString()
      })
      .eq("telegram_id", telegramId)
      .select()
      .single();

    if (error) return res.status(500).json(error);

    res.json({
      status: "bonus_claimed",
      bonus: totalBonus,
      daily_bonus: availableDailyBonus,
      referral_bonus: referralBonus,
      user: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/withdraw/request", async (req, res) => {
  try {
    const missing = requireFields(req.body, ["telegram_id", "amount", "wallet_type", "wallet_address"]);
    if (missing) return res.status(400).json({ error: missing });

    const telegramId = String(req.body.telegram_id);
    const requestedAmount = Number(req.body.amount);
    const { wallet_type, wallet_address } = req.body;
    const withdrawScope = String(req.body.withdraw_scope || "deposit_refund");
    const settings = await getSettings();
    const configuredMinWithdrawAmount = numberSetting(settings, "withdraw_min_amount");
    const minWithdrawAmount = Math.min(configuredMinWithdrawAmount, Number(ACTIVATION_REFUND_TON) || configuredMinWithdrawAmount);
    const commissionPercent = 0;

    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ error: "amount noto'g'ri" });
    }

    const { data: user, error: userError } = await findUserByTelegramId(telegramId);
    if (userError && userError.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (userError) return res.status(500).json(userError);
    if (user.is_blocked) return res.status(403).json({ error: "User bloklangan" });

    if (!user.withdraw_unlocked) {
      return res.status(403).json({
        error: `Pul yechish uchun avval ${PAYMENT_AMOUNT_TON} TONCOIN aktivatsiya to'lovini amalga oshirish kerak`
      });
    }

    if (!isLikelyTonAddress(wallet_address)) {
      return res.status(400).json({
        error: "TON hamyon address noto'g'ri. EQ..., UQ... yoki 0:... formatini kiriting."
      });
    }

    const refundAmount = Number(ACTIVATION_REFUND_TON);
    const isDepositRefund = withdrawScope === "deposit_refund";
    let amount = requestedAmount;

    if (isDepositRefund) {
      if (Math.abs(requestedAmount - refundAmount) > 0.000001) {
        return res.status(400).json({
          error: `Faqat aktivatsiya depoziti ${refundAmount.toFixed(2)} TONCOIN yechiladi`
        });
      }
      const { data: existingRefundWithdraw, error: existingRefundError } = await supabase
        .from("withdraws")
        .select("id,status")
        .eq("telegram_id", telegramId)
        .eq("wallet_type", "TON_DEPOSIT_REFUND")
        .in("status", ["pending", "approved"])
        .limit(1)
        .maybeSingle();

      if (existingRefundError && existingRefundError.code !== "PGRST116") {
        return res.status(500).json(existingRefundError);
      }
      if (existingRefundWithdraw) {
        return res.status(409).json({
          error: "Aktivatsiya depozitini yechish so'rovi allaqachon yaratilgan"
        });
      }
      amount = refundAmount;
    } else {
      const withdrawWindow = getWithdrawWindowStatus(settings);
      const growthLock = await getGrowthLockStatus(user);
      if (!withdrawWindow.is_open) {
        return res.status(403).json({
          error: "Asosiy balans faqat pul yechish vaqti kelganda ochiladi",
          withdraw_window: withdrawWindow
        });
      }
      if (!growthLock.main_withdraw.unlocked) {
        return res.status(403).json({
          error: "Asosiy balansni yechish uchun link orqali kirib depozit qilgan yana 1 ta do'st kerak",
          growth_lock: growthLock
        });
      }
    }

    if (amount < minWithdrawAmount) {
      return res.status(400).json({
        error: `Minimal yechish summasi ${minWithdrawAmount}`
      });
    }

    if (Number(user.balance) < amount) {
      return res.status(400).json({ error: "Balans yetarli emas" });
    }

    const payoutAmount = isDepositRefund
      ? Number(ACTIVATION_PAYOUT_TON)
      : Number((amount - ((amount * commissionPercent) / 100)).toFixed(2));
    const commissionAmount = Number(Math.max(0, amount - payoutAmount).toFixed(2));

    const { data: withdraw, error: withdrawError } = await supabase
      .from("withdraws")
      .insert({
        telegram_id: telegramId,
        amount,
        wallet_type: isDepositRefund ? "TON_DEPOSIT_REFUND" : "TON",
        wallet_address: normalizeAddress(wallet_address),
        status: "pending"
      })
      .select()
      .single();

    if (withdrawError) return res.status(500).json(withdrawError);

    let withdrawResult = withdraw;
    let updatedUser = user;
    let balanceDebited = false;
    let autoPayout = {
      ...getTonAutoPayoutStatusSummary(),
      payout_amount: payoutAmount,
      status: "disabled"
    };

    const debitUserBalance = async () => {
      if (balanceDebited) return updatedUser;
      const { data, error } = await supabase
        .from("users")
        .update({
          balance: Number(user.balance) - amount,
          updated_at: new Date().toISOString()
        })
        .eq("telegram_id", telegramId)
        .select()
        .single();

      if (error) throw error;
      balanceDebited = true;
      updatedUser = data;
      return updatedUser;
    };

    if (isDepositRefund && TON_AUTO_PAYOUT_ENABLED) {
      if (autoPayout.active) {
        try {
          const autoPayoutResult = await tryAutoProcessDepositRefundWithdraw(withdraw);
          withdrawResult = autoPayoutResult.withdraw;
          autoPayout = {
            ...autoPayout,
            status: "submitted",
            payout: autoPayoutResult.payout,
            source_order: autoPayoutResult.source_order
          };
          try {
            await debitUserBalance();
          } catch (debitError) {
            await markWithdrawAutoPayoutError(withdraw.id, `Balance debit failed after payout: ${debitError.message}`);
            autoPayout.balance_debit_error = debitError.message;
          }
        } catch (autoPayoutError) {
          const rejectedWithdraw = await markWithdrawAutoPayoutError(
            withdraw.id,
            autoPayoutError.message,
            autoPayoutError.payoutSubmitted ? {} : { status: "rejected" }
          );
          if (rejectedWithdraw) withdrawResult = rejectedWithdraw;
          autoPayout = {
            ...autoPayout,
            status: autoPayoutError.payoutSubmitted ? "submitted_unconfirmed" : "failed",
            error: autoPayoutError.message
          };
        }
      } else {
        autoPayout = {
          ...autoPayout,
          status: autoPayout.signer_ready ? "disabled" : "signer_not_ready"
        };
        await debitUserBalance();
      }
    } else {
      await debitUserBalance();
    }

    res.json({
      status: "withdraw_requested",
      amount,
      commission_amount: commissionAmount,
      payout_amount: payoutAmount,
      auto_payout_enabled: autoPayout.active,
      auto_payout_status: autoPayout.status,
      auto_payout: autoPayout,
      withdraw: withdrawResult,
      deposit_refund: normalizeDepositRefundStatus(withdrawResult),
      user: updatedUser,
      growth_lock: await getGrowthLockStatus(updatedUser)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/withdraw/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;

  const { data, error } = await supabase
    .from("withdraws")
    .select("*")
    .eq("telegram_id", String(telegram_id))
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json(error);

  res.json(data);
});

app.get("/stats/:telegram_id", async (req, res) => {
  const { telegram_id } = req.params;

  const { data: foundUser, error } = await findUserByTelegramId(telegram_id);
  if (error && error.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
  if (error) return res.status(500).json(error);
  const user = await normalizeDailyUser(foundUser);

  const { count: referralCount } = await supabase
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_telegram_id", String(telegram_id));

  res.json({
    telegram_id: user.telegram_id,
    balance: user.balance,
    total_views: user.total_views,
    total_watch_seconds: user.total_watch_seconds,
    daily_views: user.daily_views,
    daily_watch_seconds: user.daily_watch_seconds || 0,
    daily_income: user.daily_income,
    tier: user.tier,
    referrals: referralCount || 0,
    growth_lock: await getGrowthLockStatus(user)
  });
});

app.get("/history/:telegram_id", async (req, res) => {
  try {
    const telegramId = String(req.params.telegram_id);

    const { data: payments, error: paymentTxError } = await supabase
      .from("payment_transactions")
      .select("*")
      .eq("telegram_id", telegramId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (paymentTxError) return res.status(500).json(paymentTxError);

    const { data: confirmedOrders, error: orderHistoryError } = await supabase
      .from("payment_orders")
      .select("id,status,wallet_address,amount,required_amount,paid_amount,tx_hash,created_at,paid_at,updated_at,network,token")
      .eq("telegram_id", telegramId)
      .eq("status", "confirmed")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .limit(25);

    if (orderHistoryError && orderHistoryError.code !== "42P01") return res.status(500).json(orderHistoryError);

    const { data: withdraws, error: withdrawError } = await supabase
      .from("withdraws")
      .select("*")
      .eq("telegram_id", telegramId)
      .order("created_at", { ascending: false })
      .limit(25);

    if (withdrawError) return res.status(500).json(withdrawError);

    const paymentItems = (payments || []).map((item) => ({
      id: `payment_tx_${item.id}`,
      type: "payment",
      title: "Activation deposit",
      amount: Number(item.amount || 0),
      currency: item.token || "TON",
      network: item.network || "FIAT",
      status: "verified",
      wallet: item.to_wallet,
      tx_hash: item.tx_hash || null,
      created_at: item.created_at,
      processed_at: item.created_at
    }));

    const processedTxHashes = new Set(paymentItems.map((item) => item.tx_hash).filter(Boolean));
    const orderItems = (confirmedOrders || [])
      .filter((item) => !item.tx_hash || !processedTxHashes.has(item.tx_hash))
      .map((item) => ({
        id: `payment_order_${item.id}`,
        type: "payment",
        title: "Activation deposit",
        amount: Number(item.paid_amount || item.required_amount || item.amount || 0),
        currency: item.token || "TON",
        network: item.network || "TON",
        status: "verified",
        wallet: item.wallet_address,
        tx_hash: item.tx_hash || null,
        created_at: item.paid_at || item.updated_at || item.created_at,
        processed_at: item.paid_at || item.updated_at || item.created_at
      }));

    const withdrawItems = (withdraws || []).map((item) => ({
      id: `withdraw_${item.id}`,
      type: "withdraw",
      title: item.wallet_type === "TON_DEPOSIT_REFUND" ? "Activation deposit refund" : "Withdrawal request",
      amount: Number(item.amount || 0),
      currency: item.wallet_type || "TON",
      network: item.wallet_type || "TON",
      status: item.status,
      wallet: item.wallet_address,
      tx_hash: null,
      created_at: item.created_at,
      processed_at: item.processed_at || null,
      admin_note: item.admin_note || null
    }));

    res.json([...paymentItems, ...orderItems, ...withdrawItems].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/notifications/:telegram_id", async (req, res) => {
  try {
    const telegramId = String(req.params.telegram_id);
    const { data: user } = await findUserByTelegramId(telegramId);
    const userCreatedAt = user?.created_at ? new Date(user.created_at).getTime() : Date.now();
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .or(`telegram_id.is.null,telegram_id.eq.${telegramId}`)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) return res.status(500).json(error);
    const filtered = (data || []).filter((item) => {
      if (item.telegram_id && String(item.telegram_id) === telegramId) return true;
      const createdAt = item.created_at ? new Date(item.created_at).getTime() : 0;
      return createdAt >= userCreatedAt;
    });
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"];

  if (!ADMIN_TOKEN) {
    return res.status(500).json({ error: "ADMIN_TOKEN .env ichida yo'q" });
  }

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Admin token noto'g'ri" });
  }

  next();
}

app.post("/admin/login", (req, res) => {
  const { token } = req.body;

  if (!ADMIN_TOKEN) {
    return res.status(500).json({ error: "ADMIN_TOKEN .env ichida yo'q" });
  }

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "Token noto'g'ri" });
  }

  res.json({
    status: "ok",
    message: "Admin login muvaffaqiyatli"
  });
});

app.post("/admin/telegram/set-webhook", requireAdmin, async (req, res) => {
  try {
    if (!BOT_TOKEN) return res.status(500).json({ error: "BOT_TOKEN env ichida yo'q" });
    if (!TELEGRAM_WEBHOOK_SECRET) return res.status(500).json({ error: "TELEGRAM_WEBHOOK_SECRET env ichida yo'q" });

    const publicBackendUrl = String(req.body.public_backend_url || process.env.PUBLIC_BACKEND_URL || "").trim();
    if (!publicBackendUrl) {
      return res.status(400).json({ error: "PUBLIC_BACKEND_URL yoki public_backend_url kerak" });
    }

    const webhookUrl = `${publicBackendUrl.replace(/\/$/, "")}/telegram/webhook/${encodeURIComponent(TELEGRAM_WEBHOOK_SECRET)}`;
    const result = await telegramApi("setWebhook", {
      url: webhookUrl,
      drop_pending_updates: true,
      allowed_updates: ["message"]
    });

    res.json({
      status: "webhook_set",
      result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/telegram/webhook-info", requireAdmin, async (req, res) => {
  try {
    const result = await telegramApi("getWebhookInfo", {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/telegram/set-menu-button", requireAdmin, async (req, res) => {
  try {
    if (!BOT_TOKEN) return res.status(500).json({ error: "BOT_TOKEN env ichida yo'q" });

    const menuUrl = String(req.body?.url || buildWebAppUrl()).trim();
    const text = String(req.body?.text || "Open Vidi Pay").trim().slice(0, 64);
    if (!/^https:\/\//i.test(menuUrl)) {
      return res.status(400).json({ error: "Menu URL https bilan boshlanishi kerak" });
    }

    const result = await telegramApi("setChatMenuButton", {
      menu_button: {
        type: "web_app",
        text,
        web_app: { url: menuUrl }
      }
    });

    res.json({
      status: "menu_button_set",
      url: menuUrl,
      result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/settings", requireAdmin, async (req, res) => {
  try {
    const settings = await getSettings();
    res.json({
      ...settings,
      withdraw_requires_payment: booleanSetting(settings, "withdraw_requires_payment"),
      withdraw_window: getWithdrawWindowStatus(settings)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/settings", requireAdmin, async (req, res) => {
  try {
    const allowedKeys = Object.keys(DEFAULT_SETTINGS);
    const updates = Object.entries(req.body).filter(([key]) => allowedKeys.includes(key));

    if (!updates.length) {
      return res.status(400).json({
        error: `Yangilash uchun field yuboring: ${allowedKeys.join(", ")}`
      });
    }

    const saved = [];

    for (const [key, value] of updates) {
      const { data, error } = await upsertSetting(key, value);
      if (error) return res.status(500).json(error);
      saved.push(data);
    }

    clearSettingsCache();
    const settings = await getSettings();

    res.json({
      status: "settings_updated",
      saved,
      settings: {
        ...settings,
        withdraw_requires_payment: booleanSetting(settings, "withdraw_requires_payment"),
        withdraw_window: getWithdrawWindowStatus(settings)
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/users", requireAdmin, async (req, res) => {
  try {
    const params = adminListParams(req, { defaultLimit: 200, maxLimit: 1000 });
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false })
      .range(params.from, params.to);

    if (error) return res.status(500).json(error);

    const users = data || [];
    attachPaginationHeaders(res, params, users);

    if (wantsPagedObject(req)) {
      return res.json({
        data: users,
        page: params.page,
        limit: params.limit,
        has_more: users.length >= params.limit
      });
    }

    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/users/:telegram_id/block", requireAdmin, async (req, res) => {
  try {
    const { telegram_id } = req.params;

    const { data, error } = await supabase
      .from("users")
      .update({
        is_blocked: true,
        updated_at: new Date().toISOString()
      })
      .eq("telegram_id", String(telegram_id))
      .select()
      .single();

    if (error && error.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (error) return res.status(500).json(error);

    res.json({
      status: "blocked",
      user: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/users/:telegram_id/unblock", requireAdmin, async (req, res) => {
  try {
    const { telegram_id } = req.params;

    const { data, error } = await supabase
      .from("users")
      .update({
        is_blocked: false,
        deleted_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("telegram_id", String(telegram_id))
      .select()
      .single();

    if (error && error.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (error) return res.status(500).json(error);

    res.json({
      status: "unblocked",
      user: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/users/:telegram_id/add-earning", requireAdmin, async (req, res) => {
  try {
    const { telegram_id } = req.params;
    const amount = Number(req.body.amount);
    const minutes = Number(req.body.minutes || 0);
    const seconds = Number(req.body.seconds || minutes * 60);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Summa musbat raqam bo'lishi kerak" });
    }

    if (!Number.isFinite(seconds) || seconds < 0) {
      return res.status(400).json({ error: "Vaqt noto'g'ri" });
    }

    const { data: foundUser, error: userError } = await findUserByTelegramId(telegram_id);
    if (userError && userError.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (userError) return res.status(500).json(userError);

    const user = await normalizeDailyUser(foundUser);
    const day = todayKey();
    const nextBalance = Number((Number(user.balance || 0) + amount).toFixed(2));
    const nextDailyIncome = Number((Number(user.daily_income || 0) + amount).toFixed(2));

    const { data, error } = await supabase
      .from("users")
      .update({
        balance: nextBalance,
        total_watch_seconds: Number(user.total_watch_seconds || 0) + Math.floor(seconds),
        daily_watch_seconds: Number(user.daily_watch_seconds || 0) + Math.floor(seconds),
        total_views: Number(user.total_views || 0) + (seconds > 0 ? 1 : 0),
        daily_views: Number(user.daily_views || 0) + (seconds > 0 ? 1 : 0),
        daily_income: nextDailyIncome,
        daily_stats_date: day,
        updated_at: new Date().toISOString()
      })
      .eq("telegram_id", String(telegram_id))
      .select()
      .single();

    if (error) return res.status(500).json(error);

    await supabase.from("notifications").insert({
      telegram_id: String(telegram_id),
      title: "Admin earning update",
      message: `Admin added $${amount.toFixed(2)} for ${Math.floor(seconds)} seconds.`
    });

    res.json({
      status: "earning_added",
      amount,
      seconds: Math.floor(seconds),
      user: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/users/:telegram_id/history/withdraw", requireAdmin, async (req, res) => {
  try {
    const { telegram_id } = req.params;
    const amount = Number(req.body.amount);
    const walletType = String(req.body.wallet_type || "TON").trim();
    const walletAddress = String(req.body.wallet_address || "Admin wallet").trim();
    const status = String(req.body.status || "approved").trim();
    const adminNote = String(req.body.admin_note || "Admin manual history").trim();
    const createdAtValue = req.body.created_at ? new Date(req.body.created_at) : new Date();
    const processedAtValue = req.body.processed_at ? new Date(req.body.processed_at) : createdAtValue;

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Summa musbat raqam bo'lishi kerak" });
    }

    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status pending, approved yoki rejected bo'lishi kerak" });
    }

    if (Number.isNaN(createdAtValue.getTime()) || Number.isNaN(processedAtValue.getTime())) {
      return res.status(400).json({ error: "Sana yoki vaqt noto'g'ri" });
    }

    const { data: user, error: userError } = await findUserByTelegramId(telegram_id);
    if (userError && userError.code === "PGRST116") return res.status(404).json({ error: "User topilmadi" });
    if (userError) return res.status(500).json(userError);

    const { data, error } = await supabase
      .from("withdraws")
      .insert({
        telegram_id: String(user.telegram_id),
        amount,
        wallet_type: walletType,
        wallet_address: walletAddress,
        status,
        admin_note: adminNote,
        created_at: createdAtValue.toISOString(),
        processed_at: status === "pending" ? null : processedAtValue.toISOString()
      })
      .select()
      .single();

    if (error) return res.status(500).json(error);

    res.json({
      status: "manual_history_added",
      withdraw: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/admin/history/withdraw/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase
      .from("withdraws")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error && error.code === "PGRST116") return res.status(404).json({ error: "History yozuvi topilmadi" });
    if (error) return res.status(500).json(error);

    res.json({
      status: "manual_history_deleted",
      withdraw: data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/withdraws", requireAdmin, async (req, res) => {
  const status = req.query.status || "pending";
  const params = adminListParams(req, { defaultLimit: 200, maxLimit: 1000 });

  let query = supabase
    .from("withdraws")
    .select("*")
    .order("created_at", { ascending: false })
    .range(params.from, params.to);

  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;

  if (error) return res.status(500).json(error);

  const withdraws = data || [];
  attachPaginationHeaders(res, params, withdraws);

  if (wantsPagedObject(req)) {
    return res.json({
      data: withdraws,
      page: params.page,
      limit: params.limit,
      has_more: withdraws.length >= params.limit
    });
  }

  res.json(withdraws);
});

app.post("/admin/withdraw/:id/auto-payout", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: withdraw, error } = await supabase
      .from("withdraws")
      .select("*")
      .eq("id", id)
      .single();

    if (error && error.code === "PGRST116") return res.status(404).json({ error: "Withdraw topilmadi" });
    if (error) return res.status(500).json(error);

    if (String(withdraw.wallet_type || "") !== "TON_DEPOSIT_REFUND") {
      return res.status(400).json({ error: "Auto payout faqat TON_DEPOSIT_REFUND uchun ishlaydi" });
    }
    if (String(withdraw.status || "") !== "pending") {
      return res.status(400).json({ error: "Faqat pending withdraw auto payout qilinadi" });
    }

    const autoPayoutConfig = getTonAutoPayoutStatusSummary();
    if (!autoPayoutConfig.active) {
      return res.status(400).json({
        error: "TON signer tayyor emas",
        auto_payout: autoPayoutConfig
      });
    }

    const result = await tryAutoProcessDepositRefundWithdraw(withdraw);
    res.json({
      status: "auto_payout_submitted",
      auto_payout: {
        ...autoPayoutConfig,
        status: "submitted",
        payout: result.payout,
        source_order: result.source_order
      },
      withdraw: result.withdraw
    });
  } catch (err) {
    await markWithdrawAutoPayoutError(req.params.id, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/withdraw/:id/approve", requireAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("withdraws")
    .update({
      status: "approved",
      processed_at: new Date().toISOString()
    })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .single();

  if (error) return res.status(500).json(error);

  res.json({
    status: "approved",
    withdraw: data
  });
});

app.post("/admin/withdraw/:id/reject", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const { data: withdraw, error: findError } = await supabase
    .from("withdraws")
    .select("*")
    .eq("id", id)
    .eq("status", "pending")
    .single();

  if (findError) return res.status(500).json(findError);

  const { data: user, error: userError } = await findUserByTelegramId(withdraw.telegram_id);
  if (userError) return res.status(500).json(userError);

  const { error: userUpdateError } = await supabase
    .from("users")
    .update({
      balance: Number(user.balance) + Number(withdraw.amount),
      updated_at: new Date().toISOString()
    })
    .eq("telegram_id", String(withdraw.telegram_id));

  if (userUpdateError) return res.status(500).json(userUpdateError);

  const { data, error } = await supabase
    .from("withdraws")
    .update({
      status: "rejected",
      admin_note: reason || null,
      processed_at: new Date().toISOString()
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(500).json(error);

  res.json({
    status: "rejected",
    withdraw: data
  });
});

/* =========================================================
   [YANGI]: ADMIN UCHUN TO'LOVLARNI BOSHQARISH API
========================================================= */

app.get("/admin/payment-orders", requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const params = adminListParams(req, { defaultLimit: 100, maxLimit: 500 });
    let query = supabase
      .from("payment_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .range(params.from, params.to);

    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;

    if (error) return res.status(500).json(error);

    const orders = (data || []).map(normalizePaymentOrder);
    attachPaginationHeaders(res, params, orders);

    if (wantsPagedObject(req)) {
      return res.json({
        data: orders,
        page: params.page,
        limit: params.limit,
        has_more: orders.length >= params.limit
      });
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/payment-orders/:id/approve", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const now = new Date().toISOString();
    const { data: order, error: orderError } = await supabase
      .from("payment_orders")
      .update({
        status: "confirmed",
        tx_hash: `admin_manual_${id}`,
        paid_amount: PAYMENT_AMOUNT_TON,
        paid_at: now,
        updated_at: now
      })
      .eq("id", id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (orderError) return res.status(500).json(orderError);
    if (!order) return res.status(404).json({ error: "Pending order topilmadi" });

    await unlockWithdrawAndCreditActivationRefund(order.telegram_id, now);

    const { error: txInsertError } = await supabase
      .from("payment_transactions")
      .insert({
        telegram_id: String(order.telegram_id),
        network: PAYMENT_NETWORK,
        token: PAYMENT_TOKEN,
        to_wallet: order.wallet_address,
        amount: Number(PAYMENT_AMOUNT_TON),
        tx_hash: `admin_manual_${id}`
      });

    if (txInsertError && txInsertError.code !== "23505") throw txInsertError;

    await supabase
      .from("payment_wallets")
      .update({
        assigned_order_id: null,
        assigned_until: null,
        cooldown_until: null,
        updated_at: now
      })
      .eq("address", order.wallet_address);

    res.json({ status: "approved", order: normalizePaymentOrder(order) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/notification/send", requireAdmin, async (req, res) => {
  const missing = requireFields(req.body, ["title", "message"]);
  if (missing) return res.status(400).json({ error: missing });

  const { title, message, telegram_id } = req.body;

  const { data, error } = await supabase
    .from("notifications")
    .insert({
      telegram_id: telegram_id ? String(telegram_id) : null,
      title,
      message
    })
    .select()
    .single();

  if (error) return res.status(500).json(error);

  res.json({
    status: "sent",
    notification: data
  });
});

/* =========================================================
   [YANGI QO'SHILDI] VIDI PAY: FIAT-TO-CRYPTO (Uzcard/Humo) WEBHOOK
   XAVFSIZLIK DARAJASI: ULTRA (HMAC SHA-512 SIGNATURE)
========================================================= */

app.post("/webhook/fiat-payment", async (req, res) => {
  try {
    // 1. Provayder yuborgan xavfsizlik imzosini ushlash
    const signature = req.headers["x-signature"] || req.headers["x-mercuryo-signature"];
    const FIAT_WEBHOOK_SECRET = process.env.FIAT_WEBHOOK_SECRET;

    if (!signature || !FIAT_WEBHOOK_SECRET) {
      // Xavfsizlik: Xakerga sababini ochiqlamaslik uchun qisqa xato beramiz
      return res.status(403).json({ error: "Ruxsat etilmagan (Forbidden)" });
    }

    // 2. HMAC Shifrlash orqali imzoni tekshirish (Soxta to'lovning oldini olish)
    const payloadString = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac("sha512", FIAT_WEBHOOK_SECRET)
      .update(payloadString)
      .digest("hex");

    if (signature !== expectedSignature) {
      return res.status(403).json({ error: "Imzo xato (Invalid signature)" });
    }

    // 3. To'lov ma'lumotlarini ajratib olish (Frontenddan 'merchant_transaction_id' sifatida telegram_id jo'natiladi)
    const { status, merchant_transaction_id, crypto_amount, tx_hash } = req.body;
    const telegramId = String(merchant_transaction_id);

    // 4. Inyeksiya (Injection) himoyasi: telegramId faqat raqam bo'lishi shart!
    if (!/^\d+$/.test(telegramId)) {
        return res.status(400).json({ error: "ID formati xato" });
    }

    // 5. To'lov muvaffaqiyatli o'tganligini tekshirish
    if (status === "completed" || status === "successful") {

      // Dublikat to'lovlarni oldini olish uchun tx_hash ni tekshirish
      const actualTxHash = tx_hash || `fiat_${telegramId}_${Date.now()}`;
      if (tx_hash) {
        const { data: existingTx } = await supabase
          .from("payment_transactions")
          .select("id")
          .eq("tx_hash", actualTxHash)
          .single();
          
        if (existingTx) {
          return res.status(200).json({ status: "success", message: "To'lov allaqachon qabul qilingan" });
        }
      }

      // Foydalanuvchi bazada borligiga ishonch hosil qilish
      const { data: user, error: userFindError } = await findUserByTelegramId(telegramId);
      if (userFindError && userFindError.code === "PGRST116") {
        return res.status(404).json({ error: "Foydalanuvchi topilmadi" });
      }
      if (userFindError) throw userFindError;

      // A) Foydalanuvchining pul yechish ruxsatini ochamiz va TONCOIN refund balansini yozamiz.
      await unlockWithdrawAndCreditActivationRefund(telegramId, new Date().toISOString());

      // B) To'lovni bazaga tarix (logs) sifatida yozib qo'yamiz
      const { error: txError } = await supabase.from("payment_transactions").insert({
        telegram_id: telegramId,
        network: "FIAT/TON", // Provayder tarmog'i
        token: "TON",
        to_wallet: "Fiat Provider", // To'lov qabul qilingan manzil
        amount: Number(crypto_amount) || 0,
        tx_hash: actualTxHash
      });
      
      if (txError) throw txError; // [YAXSHILANISH]: Agar bazaga yozishda xato bo'lsa, jarayonni to'xtatish


      // 6. Provayderga tasdiq javobi
      return res.status(200).json({ status: "success", message: "To'lov qabul qilindi" });
    }

    // Kutilayotgan (pending) yoki bekor qilingan (failed) holatlar uchun
    return res.status(200).json({ status: "ignored" });

  } catch (err) {
    return res.status(500).json({ error: "Ichki server xatosi" });
  }
});

/* =========================================================
   [YANGI QO'SHILDI]: TO'LOV YARATISH VA STATUS TEKSHIRISH
   (FIAT/CRYPTO GATEWAY UCHUN XAVFSIZ API'LAR)
========================================================= */

app.post("/payment/create", async (req, res) => {
  try {
    const { telegram_id } = req.body;
    if (!telegram_id) return res.status(400).json({ error: "telegram_id kerak" });

    const { data: user } = await findUserByTelegramId(telegram_id);
    const depositRefund = normalizeDepositRefundStatus(await getDepositRefundWithdraw(telegram_id).catch(() => null));
    if (user?.withdraw_unlocked) {
      const order = await findPersistentUserPaymentOrder(telegram_id);
      return res.json({
        withdraw_unlocked: true,
        order,
        orders: order ? [order] : [],
        deposit_refund: depositRefund,
        payment: order ? {
          network: PAYMENT_NETWORK,
          token: PAYMENT_TOKEN,
          contract: null,
          amount: Number(order.required_amount || PAYMENT_AMOUNT_TON),
          activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
          payment_min_received_amount: Number(PAYMENT_MIN_RECEIVED_TON),
          payment_max_received_amount: Number(PAYMENT_MAX_RECEIVED_TON),
          activation_fee_amount: Number(ACTIVATION_FEE_TON),
          activation_refund_amount: Number(ACTIVATION_REFUND_TON),
          activation_payout_amount: Number(ACTIVATION_PAYOUT_TON),
          wallet_address: order.wallet_address,
          expires_at: order.expires_at || null
        } : null,
        growth_lock: await getGrowthLockStatus(user)
      });
    }
    if (Number(user?.balance || 0) < WALLET_UNLOCK_REQUIRED_USD) {
      return res.status(403).json({
        error: `Wallet ${WALLET_UNLOCK_REQUIRED_USD}$ umumiy daromaddan keyin ochiladi.`,
        wallet_locked: true,
        wallet_unlock_required_amount: WALLET_UNLOCK_REQUIRED_USD,
        wallet_earning_amount: Number(user?.balance || 0),
        growth_lock: user ? await getGrowthLockStatus(user) : null
      });
    }
    await ensureWalletActivationNotification(telegram_id).catch((err) => {
      console.warn("[notifications] wallet activation notification skipped:", err.message);
    });

    const createdOrder = await createTonPaymentOrder(telegram_id);
    const order = createdOrder?.wallet_address
      ? createdOrder
      : (await findPersistentUserPaymentOrder(telegram_id)) || createdOrder;
    res.json({
      withdraw_unlocked: false,
      order,
      orders: order ? [order] : [],
      deposit_refund: depositRefund,
      wallet_unlocked_by_earning: true,
      wallet_unlock_required_amount: WALLET_UNLOCK_REQUIRED_USD,
      payment: {
        network: PAYMENT_NETWORK,
        token: PAYMENT_TOKEN,
        contract: null,
        amount: Number(order?.required_amount || PAYMENT_AMOUNT_TON),
        activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
        payment_min_received_amount: Number(PAYMENT_MIN_RECEIVED_TON),
        payment_max_received_amount: Number(PAYMENT_MAX_RECEIVED_TON),
        activation_fee_amount: Number(ACTIVATION_FEE_TON),
        activation_refund_amount: Number(ACTIVATION_REFUND_TON),
        activation_payout_amount: Number(ACTIVATION_PAYOUT_TON),
        wallet_address: order?.wallet_address || null,
        expires_at: order?.expires_at || null
      },
      growth_lock: user ? await getGrowthLockStatus(user) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/payment/check", async (req, res) => {
  try {
    const { telegram_id, order_id } = req.body || {};
    if (!telegram_id || !order_id) return res.status(400).json({ error: "telegram_id va order_id kerak" });

    const { data: order, error } = await supabase
      .from("payment_orders")
      .select("*")
      .eq("id", order_id)
      .eq("telegram_id", String(telegram_id))
      .maybeSingle();

    if (error) throw error;
    if (!order) return res.status(404).json({ error: "Order topilmadi" });

    const confirmed = order.status === "pending" ? await scanPaymentOrder(order) : order.status === "confirmed";
    const { data: user } = await findUserByTelegramId(telegram_id);
    const { data: latestOrder } = await supabase
      .from("payment_orders")
      .select("*")
      .eq("id", order_id)
      .maybeSingle();

    res.json({
      checked: true,
      confirmed,
      withdraw_unlocked: Boolean(user?.withdraw_unlocked),
      order: normalizePaymentOrder(latestOrder || order),
      user,
      deposit_refund: normalizeDepositRefundStatus(await getDepositRefundWithdraw(telegram_id).catch(() => null)),
      growth_lock: user ? await getGrowthLockStatus(user) : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/payment/status/:telegram_id", async (req, res) => {
  try {
    const { telegram_id } = req.params;
    const { data: user } = await findUserByTelegramId(telegram_id);

    const { data: orders, error } = await supabase
      .from("payment_orders")
      .select("*")
      .eq("telegram_id", String(telegram_id))
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error && error.code !== "42P01") throw error;

    let normalizedOrders = (orders || []).map(normalizePaymentOrder);
    const hasOrderWallet = normalizedOrders.some((order) => order.wallet_address);
    if (!hasOrderWallet && user && !user.withdraw_unlocked && Number(user.balance || 0) >= WALLET_UNLOCK_REQUIRED_USD) {
      try {
        const ensuredOrder = await createTonPaymentOrder(telegram_id);
        if (ensuredOrder?.wallet_address) {
          normalizedOrders = [
            ensuredOrder,
            ...normalizedOrders.filter((order) => String(order.id) !== String(ensuredOrder.id))
          ];
        }
      } catch (ensureError) {
        console.warn("[payments] status wallet assignment skipped:", ensureError.message);
      }
    }

    const persistentOrder = normalizedOrders.some((order) => order.wallet_address)
      ? null
      : await findPersistentUserPaymentOrder(telegram_id);

    const responseOrders = persistentOrder ? [persistentOrder, ...normalizedOrders] : normalizedOrders;
    const responseOrderWithWallet = responseOrders.find((order) => order.wallet_address) || responseOrders[0] || null;

    res.json({
      withdraw_unlocked: user?.withdraw_unlocked || false,
      wallet_locked: Number(user?.balance || 0) < WALLET_UNLOCK_REQUIRED_USD,
      wallet_unlock_required_amount: WALLET_UNLOCK_REQUIRED_USD,
      wallet_earning_amount: Number(user?.balance || 0),
      deposit_refund: normalizeDepositRefundStatus(await getDepositRefundWithdraw(telegram_id).catch(() => null)),
      growth_lock: user ? await getGrowthLockStatus(user) : null,
      user,
      order: responseOrderWithWallet,
      orders: responseOrders,
      payment: responseOrderWithWallet ? {
        network: PAYMENT_NETWORK,
        token: PAYMENT_TOKEN,
        contract: null,
        amount: Number(responseOrderWithWallet.required_amount || PAYMENT_AMOUNT_TON),
        activation_deposit_amount: Number(PAYMENT_AMOUNT_TON),
        payment_min_received_amount: Number(PAYMENT_MIN_RECEIVED_TON),
        payment_max_received_amount: Number(PAYMENT_MAX_RECEIVED_TON),
        activation_fee_amount: Number(ACTIVATION_FEE_TON),
        activation_refund_amount: Number(ACTIVATION_REFUND_TON),
        activation_payout_amount: Number(ACTIVATION_PAYOUT_TON),
        wallet_address: responseOrderWithWallet.wallet_address || null,
        expires_at: responseOrderWithWallet.expires_at || null
      } : null,
      scanner: buildPaymentScannerStatus()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/payment/generate-fiat-url", async (req, res) => {
  try {
    const { telegram_id, order_id } = req.body;
    if (!telegram_id || !order_id) return res.status(400).json({ error: "Ma'lumot to'liq emas" });

    const { data: order, error } = await supabase
      .from("payment_orders")
      .select("*")
      .eq("id", order_id)
      .eq("telegram_id", String(telegram_id))
      .maybeSingle();

    if (error) throw error;
    if (!order) return res.status(404).json({ error: "Order topilmadi" });

    res.json({
      url: "",
      wallet_address: order.wallet_address,
      message: `Copy the TONCOIN address and send ${PAYMENT_AMOUNT_TON} TON. Confirmation accepts received payments from ${PAYMENT_MIN_RECEIVED_TON} to ${PAYMENT_MAX_RECEIVED_TON} TON.`,
      order: normalizePaymentOrder(order)
    });
  } catch (err) {
    res.status(500).json({ error: "URL yaratishda xatolik" });
  }
});

app.get("/admin/payment-wallets", requireAdmin, async (req, res) => {
  try {
    const { count: total } = await supabase
      .from("payment_wallets")
      .select("*", { count: "exact", head: true })
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN);
    const { count: active } = await supabase
      .from("payment_wallets")
      .select("*", { count: "exact", head: true })
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .eq("is_active", true);
    const { count: assigned } = await supabase
      .from("payment_wallets")
      .select("*", { count: "exact", head: true })
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .not("assigned_to_telegram_id", "is", null);
    const { count: pendingOrders } = await supabase
      .from("payment_orders")
      .select("*", { count: "exact", head: true })
      .eq("network", PAYMENT_NETWORK)
      .eq("token", PAYMENT_TOKEN)
      .eq("status", "pending");

    const scannerHeartbeats = await readPaymentScannerHeartbeats();

    res.json({
      total: total || 0,
      active: active || 0,
      assigned: assigned || 0,
      available: Math.max(0, (active || 0) - (assigned || 0)),
      pending_orders: pendingOrders || 0,
      scanner: buildPaymentScannerStatus(scannerHeartbeats),
      config: {
        network: PAYMENT_NETWORK,
        token: PAYMENT_TOKEN,
        amount: PAYMENT_AMOUNT_TON,
        min_received: PAYMENT_MIN_RECEIVED_TON,
        max_received: PAYMENT_MAX_RECEIVED_TON,
        activation_fee: ACTIVATION_FEE_TON,
        activation_refund: ACTIVATION_REFUND_TON,
        activation_payout: ACTIVATION_PAYOUT_TON,
        auto_payout_enabled: TON_AUTO_PAYOUT_ENABLED,
        signer: getTonAutoPayoutStatusSummary(),
        order_ttl_minutes: PAYMENT_ORDER_TTL_MINUTES,
        late_grace_minutes: PAYMENT_LATE_GRACE_MINUTES,
        scan_interval_ms: PAYMENT_SCAN_INTERVAL_MS,
        scan_batch_size: PAYMENT_SCAN_BATCH_SIZE
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/payment-scanner/status", requireAdmin, async (req, res) => {
  try {
    const scannerHeartbeats = await readPaymentScannerHeartbeats();
    res.json(buildPaymentScannerStatus(scannerHeartbeats));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/admin/ton-signer/status", requireAdmin, async (req, res) => {
  try {
    const signer = getTonAutoPayoutStatusSummary();
    const { count: confirmedOrders } = await supabase
      .from("payment_orders")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed");

    res.json({
      signer,
      confirmed_orders: confirmedOrders || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/payment-scan/run", requireAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.body?.limit || PAYMENT_SCAN_BATCH_SIZE)));
    const result = await scanPendingPaymentOrders(limit);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* =========================================================
   SERVERNI ISHGA TUSHIRISH
========================================================= */

const PORT = process.env.PORT || 3000;
let httpServer = null;
function startPaymentScanner() {
  if (!PAYMENT_SCANNER_ENABLED) {
    throw new Error("[scanner] Refusing to start because PAYMENT_SCANNER_ENABLED is not true");
  }
  const nextDelay = () => {
    const jitter = PAYMENT_SCAN_JITTER_MS ? Math.floor(Math.random() * PAYMENT_SCAN_JITTER_MS) : 0;
    return PAYMENT_SCAN_INTERVAL_MS + jitter;
  };
  const schedule = (delayMs = nextDelay()) => {
    const timer = setTimeout(async () => {
      try {
        await scanPendingPaymentOrders();
      } catch (err) {
        paymentScannerState.lastError = err.message;
      } finally {
        schedule(nextDelay());
      }
    }, delayMs);
    timer.unref?.();
  };
  schedule(Math.floor(Math.random() * Math.max(1, PAYMENT_SCAN_JITTER_MS || PAYMENT_SCAN_INTERVAL_MS)));
}

if (SCANNER_WORKER_MODE) {
  startPaymentScanner();
} else {
  httpServer = app.listen(PORT, () => {
  // Maxfiylik uchun terminal loglari o'chirildi
  });
  httpServer.keepAliveTimeout = SERVER_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.headersTimeout = SERVER_HEADERS_TIMEOUT_MS;
  httpServer.requestTimeout = SERVER_REQUEST_TIMEOUT_MS;
}

function shutdownGracefully(signal) {
  if (serverRuntime.shutting_down) return;
  serverRuntime.shutting_down = true;
  serverRuntime.shutdown_started_at = new Date().toISOString();
  serverRuntime.last_signal = signal;

  const forceExit = setTimeout(() => {
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  forceExit.unref?.();

  if (httpServer) {
    httpServer.close(() => {
      clearTimeout(forceExit);
      process.exit(0);
    });
    return;
  }

  clearTimeout(forceExit);
  process.exit(0);
}

process.on("SIGTERM", () => shutdownGracefully("SIGTERM"));
process.on("SIGINT", () => shutdownGracefully("SIGINT"));

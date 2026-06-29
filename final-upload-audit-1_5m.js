const { execFileSync } = require("child_process");

const DEFAULT_BASE_URL = "https://vidipay-backend.onrender.com";

function readEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function normalizeBaseUrl(raw) {
  const value = String(raw || DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(value)) throw new Error("BASE_URL must start with http:// or https://");
  return value;
}

function getJson(baseUrl, path) {
  const url = `${baseUrl}${path}`;
  let text = "";
  let lastError = null;
  for (const bin of ["curl.exe", "curl"]) {
    try {
      text = execFileSync(bin, ["-s", "--max-time", "25", url], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (!text && lastError) throw lastError;
  if (!text.trim()) throw new Error(`Empty response from ${url}`);
  return JSON.parse(text);
}

function line(name, ok, detail = "") {
  console.log(`${ok ? "OK" : "FAIL"} ${name} ${detail}`.trim());
}

function main() {
  const baseUrl = normalizeBaseUrl(readEnv("BASE_URL", DEFAULT_BASE_URL));
  const health = getJson(baseUrl, "/healthz");
  const gate = getJson(baseUrl, "/ops/final-gate");
  const scanner = getJson(baseUrl, "/scanner/healthz");
  const wallet = getJson(baseUrl, "/ops/wallet-capacity");
  const redis = getJson(baseUrl, "/ops/redis");
  const signer = getJson(baseUrl, "/ops/ton-signer");

  const checks = [
    ["version", health.version === "v1.8.2-infra-autopilot-20260628", health.version],
    ["redis", redis.redis?.ok === true, redis.redis?.message || redis.redis?.error || redis.status],
    ["scanner_workers", Number(scanner.scanner_workers_alive || 0) >= 4, `alive=${scanner.scanner_workers_alive}`],
    ["wallet_capacity", Number(wallet.wallet_capacity?.capacity_gap ?? -1) >= 0, `gap=${wallet.wallet_capacity?.capacity_gap}`],
    ["ton_signer", signer.ton_signer?.ok === true, `wallet_files=${signer.ton_signer?.signer?.wallet_files}`],
    ["final_gate", gate.gate?.ready_for_1_5m_public_traffic === true, `status=${gate.gate?.status}`]
  ];

  console.log(`base_url=${baseUrl}`);
  for (const [name, ok, detail] of checks) line(name, ok, detail);

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.log("");
    console.log("ACTION REQUIRED:");
    for (const [name,, detail] of failed) console.log(`- ${name}: ${detail}`);
    process.exit(1);
  }

  console.log("");
  console.log("FINAL 1.5M LIVE GATE OK");
}

main();

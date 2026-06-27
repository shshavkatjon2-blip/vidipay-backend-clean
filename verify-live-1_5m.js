const DEFAULT_BASE_URL = "https://vidipay-backend.onrender.com";
const EXPECTED_VERSION = "v1.7.8-1-5m-runtime-capacity-20260627";
const DEFAULT_TIMEOUT_MS = 15000;

function readEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function normalizeBaseUrl(value) {
  const url = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("BASE_URL must start with http:// or https://");
  }
  return url;
}

async function getJson(baseUrl, path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, { signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return {
      path,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      ms: Date.now() - startedAt,
      body
    };
  } catch (error) {
    return {
      path,
      status: 0,
      ok: false,
      ms: Date.now() - startedAt,
      body: null,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function statusLine(name, result, extra = "") {
  const mark = result.ok ? "OK" : "FAIL";
  const code = result.status || "ERR";
  const detail = result.error ? ` error=${result.error}` : "";
  const suffix = extra ? ` ${extra}${detail}` : detail;
  return `${mark} ${name} ${code} ${result.ms}ms${suffix}`;
}

function isExpectedVersion(body) {
  return body && body.version === EXPECTED_VERSION;
}

function scannerAdvice(scanner) {
  if (!scanner || typeof scanner !== "object") return "scanner health response is missing";
  if (scanner.status === "ok" && scanner.scanner_worker_alive === true) {
    return "scanner worker heartbeat is fresh";
  }
  if (scanner.status === "stale") {
    return "scanner worker is not heartbeating; check Background Worker service, start command, env, and heartbeat SQL";
  }
  if (scanner.status === "unavailable") {
    return "scanner heartbeat table is unavailable; run COPY_THIS_SCANNER_HEARTBEAT_SQL_1_5M.sql in Supabase";
  }
  return `scanner status is ${scanner.status || "unknown"}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(readEnv("BASE_URL", DEFAULT_BASE_URL));
  const results = {};

  for (const [name, path] of [
    ["healthz", "/healthz"],
    ["readyz", "/readyz"],
    ["settings", "/settings"],
    ["scanner", "/scanner/healthz"],
    ["readiness", "/ops/readiness"],
    ["metrics", "/ops/metrics"],
    ["capacity", "/ops/capacity"],
    ["deploy", "/ops/deploy"],
    ["live", "/ops/live"],
    ["root", "/"]
  ]) {
    results[name] = await getJson(baseUrl, path);
  }

  const healthVersionOk = isExpectedVersion(results.healthz.body);
  const readyVersionOk = isExpectedVersion(results.readyz.body);
  const settingsVersionOk = isExpectedVersion(results.settings.body);
  const readinessVersionOk = isExpectedVersion(results.readiness.body);
  const metricsVersionOk = isExpectedVersion(results.metrics.body);
  const capacityVersionOk = isExpectedVersion(results.capacity.body);
  const deployVersionOk = isExpectedVersion(results.deploy.body);
  const liveVersionOk = isExpectedVersion(results.live.body);
  const scanner = results.scanner.body;
  const scannerOk = scanner && scanner.status === "ok" && scanner.scanner_worker_alive === true;

  console.log(statusLine("healthz", results.healthz, healthVersionOk ? "version-ok" : "version-mismatch"));
  console.log(statusLine("readyz", results.readyz, readyVersionOk ? "version-ok" : "version-mismatch"));
  console.log(statusLine("settings", results.settings, settingsVersionOk ? "version-ok" : "version-mismatch"));
  console.log(statusLine("scanner", results.scanner, scannerAdvice(scanner)));
  console.log(statusLine("readiness", results.readiness, readinessVersionOk ? `status=${results.readiness.body?.status || "unknown"}` : "version-mismatch"));
  console.log(statusLine("metrics", results.metrics, metricsVersionOk ? "version-ok" : "version-mismatch"));
  console.log(statusLine("capacity", results.capacity, capacityVersionOk ? `status=${results.capacity.body?.capacity?.status || "unknown"}` : "version-mismatch"));
  console.log(statusLine("deploy", results.deploy, deployVersionOk ? `status=${results.deploy.body?.status || "unknown"}` : "version-mismatch"));
  console.log(statusLine("live", results.live, liveVersionOk ? `status=${results.live.body?.status || "unknown"}` : "version-mismatch"));
  console.log(statusLine("root", results.root));

  console.log("");
  console.log(`base_url=${baseUrl}`);
  console.log(`expected_version=${EXPECTED_VERSION}`);
  console.log(`scanner_status=${scanner?.status || "unknown"}`);
  console.log(`scanner_worker_alive=${scanner?.scanner_worker_alive}`);
  console.log(`heartbeat_stale=${scanner?.heartbeat_stale}`);
  console.log(`latest_seen_at=${scanner?.latest_seen_at || ""}`);

  const failures = [];
  for (const [name, result] of Object.entries(results)) {
    if (!result.ok) failures.push(`${name} request failed`);
  }
  if (!healthVersionOk) failures.push("healthz version is not the expected package version");
  if (!readyVersionOk) failures.push("readyz version is not the expected package version");
  if (!settingsVersionOk) failures.push("settings version is not the expected package version");
  if (!readinessVersionOk) failures.push("readiness version is not the expected package version");
  if (!metricsVersionOk) failures.push("metrics version is not the expected package version");
  if (!capacityVersionOk) failures.push("capacity version is not the expected package version");
  if (!deployVersionOk) failures.push("deploy version is not the expected package version");
  if (!liveVersionOk) failures.push("live version is not the expected package version");
  if (!scannerOk) failures.push(scannerAdvice(scanner));

  if (failures.length) {
    console.log("");
    console.log("Action needed:");
    for (const failure of failures) console.log(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("LIVE 1.5M CHECK OK");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

const http = require("http");
const https = require("https");

const baseUrl = String(process.argv[2] || process.env.PUBLIC_BACKEND_URL || "https://vidipay-backend.onrender.com").replace(/\/$/, "");
const expectedVersion = "v1.8.2-infra-autopilot-20260628";
const timeoutMs = Math.max(3000, Number(process.env.LIVE_VERIFY_TIMEOUT_MS || 25000));

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const json = JSON.parse(body);
          resolve({ statusCode: res.statusCode, json });
        } catch {
          reject(new Error(`${url} did not return JSON: ${body.slice(0, 160)}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`${url} timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

async function main() {
  const endpoints = [
    "/healthz",
    "/ops/redis",
    "/ops/redis-deep",
    "/ops/scanner-shards",
    "/ops/scanner-backlog",
    "/ops/wallet-capacity",
    "/ops/wallet-import-plan",
    "/ops/ton-signer",
    "/ops/scale-contract",
    "/ops/final-gate",
    "/ops/launch-checklist"
  ];
  const results = [];
  const errors = [];

  for (const endpoint of endpoints) {
    const url = `${baseUrl}${endpoint}`;
    try {
      const result = await requestJson(url);
      const version = result.json.version || result.json.gate?.version || result.json.contract?.version || null;
      const okVersion = endpoint === "/healthz"
        ? result.json.version === expectedVersion
        : version === expectedVersion;
      if (!okVersion) errors.push(`${endpoint} version mismatch: ${version || "missing"}`);
      results.push({
        endpoint,
        http: result.statusCode,
        status: result.json.status || "ok",
        version: version || result.json.version || null,
        blockers: result.json.gate?.blockers?.length || result.json.contract?.blockers?.length || result.json.blockers?.length || 0
      });
    } catch (err) {
      errors.push(`${endpoint}: ${err.message}`);
    }
  }

  console.log(JSON.stringify({ baseUrl, expectedVersion, results, errors }, null, 2));
  if (errors.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

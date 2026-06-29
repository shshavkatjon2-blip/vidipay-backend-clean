const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawnSync } = require("child_process");

const baseUrl = String(process.argv[2] || process.env.PUBLIC_BACKEND_URL || "https://vidipay-backend.onrender.com").replace(/\/$/, "");
const timeoutMs = Math.max(3000, Number(process.env.LIVE_VERIFY_TIMEOUT_MS || 25000));
const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const outputDir = fs.existsSync(path.join(packageRoot, "ops")) ? path.join(packageRoot, "ops") : root;
const outputFile = path.join(outputDir, "live-control-tower-diagnosis-1_5m.json");

function requestJson(pathname) {
  const url = `${baseUrl}${pathname}`;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          resolve({ endpoint: pathname, statusCode: res.statusCode, json: JSON.parse(body) });
        } catch {
          reject(new Error(`${pathname} did not return JSON: ${body.slice(0, 160)}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error(`${pathname} timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
  });
}

function requestJsonWithCurl(pathname) {
  const url = `${baseUrl}${pathname}`;
  const result = spawnSync("curl.exe", ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000)), url], {
    encoding: "utf8"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `curl exited with ${result.status}`);
  return {
    endpoint: pathname,
    statusCode: 200,
    json: JSON.parse(result.stdout)
  };
}

async function main() {
  const endpoints = [
    "/healthz",
    "/ops/control-tower?fresh=true",
    "/ops/blocker-actions?fresh=true",
    "/ops/env-contract",
    "/ops/scanner-worker-plan",
    "/ops/wallet-import-plan",
    "/ops/redis-deep",
    "/ops/ton-signer"
  ];
  const results = [];
  const errors = [];
  for (const endpoint of endpoints) {
    try {
      try {
        results.push(await requestJson(endpoint));
      } catch {
        results.push(requestJsonWithCurl(endpoint));
      }
    } catch (err) {
      errors.push({ endpoint, error: err.message || String(err) });
    }
  }
  const control = results.find((item) => item.endpoint.startsWith("/ops/control-tower"))?.json || {};
  const actions = control.blockers || [];
  const report = {
    generated_at: new Date().toISOString(),
    baseUrl,
    status: errors.length ? "error" : (control.status || "unknown"),
    ready: Boolean(control.ready),
    blockers: actions,
    errors,
    results: results.map((item) => ({
      endpoint: item.endpoint,
      http: item.statusCode,
      status: item.json.status || item.json.gates?.final_gate?.status || "ok",
      version: item.json.version || item.json.gates?.final_gate?.version || null
    }))
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`diagnosis=${outputFile}`);
  if (errors.length) process.exit(1);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const opsDir = path.join(packageRoot, "ops");
const envDir = path.join(packageRoot, "env");
const blueprintDir = path.join(packageRoot, "render-blueprints");

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  console.log(path.relative(packageRoot, file).replace(/\\/g, "/"));
}

function envBlock(items) {
  return items.map(([key, value]) => `${key}=${value}`).join("\n");
}

function scannerMatrix(counts) {
  const lines = [];
  for (const count of counts) {
    lines.push(`# ${count} scanner workers`);
    for (let index = 0; index < count; index += 1) {
      lines.push(`PAYMENT_SCANNER_WORKER_ID=vidipay-scanner-${String(index).padStart(3, "0")}`);
      lines.push(`PAYMENT_SCANNER_SHARD_COUNT=${count}`);
      lines.push(`PAYMENT_SCANNER_SHARD_INDEX=${index}`);
      lines.push("WORKER_MODE=scanner");
      lines.push("PAYMENT_SCANNER_ENABLED=true");
      lines.push("REDIS_SCANNER_LOCKS_ENABLED=true");
      lines.push("");
    }
  }
  return lines.join("\n");
}

function webBlueprint() {
  return `services:
  - type: web
    name: vidipay-backend
    runtime: node
    plan: pro
    buildCommand: node render-build-fix.cjs && npm install --omit=dev --no-audit --no-fund
    startCommand: npm start
    healthCheckPath: /healthz
    envVars:
      - key: NODE_ENV
        value: production
      - key: WORKER_MODE
        value: api
      - key: PAYMENT_SCANNER_ENABLED
        value: false
      - key: RATE_LIMIT_BACKEND
        value: redis
      - key: REDIS_URL
        sync: false
      - key: REDIS_DEEP_CHECK_ENABLED
        value: true
      - key: TON_AUTO_PAYOUT_ENABLED
        value: true
      - key: TON_SIGNER_ENABLED
        value: true
      - key: TON_SIGNER_KEYS_DIR
        sync: false
      - key: TON_RPC_ENDPOINT
        sync: false
      - key: TON_RPC_API_KEY
        sync: false
`;
}

function main() {
  fs.mkdirSync(opsDir, { recursive: true });
  fs.mkdirSync(envDir, { recursive: true });
  fs.mkdirSync(blueprintDir, { recursive: true });

  write(path.join(envDir, "RENDER_WEB_SERVICE_INFRA_AUTOPILOT_1_5M.env"), envBlock([
    ["NODE_ENV", "production"],
    ["WORKER_MODE", "api"],
    ["PAYMENT_SCANNER_ENABLED", "false"],
    ["RATE_LIMIT_BACKEND", "redis"],
    ["REDIS_URL", ""],
    ["REDIS_DEEP_CHECK_ENABLED", "true"],
    ["REDIS_SCANNER_LOCKS_ENABLED", "false"],
    ["OPS_SNAPSHOT_CACHE_TTL_MS", "2000"],
    ["SCALE_AUDIT_COUNT_MODE", "planned"],
    ["CAPACITY_TARGET_USERS", "1500000"],
    ["FINAL_GATE_MIN_SCANNER_WORKERS", "4"],
    ["TONAPI_KEY", ""],
    ["TONAPI_BASE_URL", "https://tonapi.io"],
    ["TON_AUTO_PAYOUT_ENABLED", "true"],
    ["TON_SIGNER_ENABLED", "true"],
    ["TON_SIGNER_KEYS_DIR", ""],
    ["TON_RPC_ENDPOINT", ""],
    ["TON_RPC_API_KEY", ""]
  ]));

  write(path.join(envDir, "TON_SIGNER_ENV_REQUIRED_1_5M.env"), envBlock([
    ["TON_AUTO_PAYOUT_ENABLED", "true"],
    ["TON_SIGNER_ENABLED", "true"],
    ["TON_SIGNER_KEYS_DIR", ""],
    ["TON_RPC_ENDPOINT", ""],
    ["TON_RPC_API_KEY", ""],
    ["TON_PAYOUT_GAS_RESERVE", "0.10"],
    ["TON_PAYOUT_BODY", "VidiPay activation payout"],
    ["REQUIRE_TON_AUTO_PAYOUT_FOR_1_5M", "true"]
  ]));

  write(path.join(envDir, "SCANNER_WORKER_ENV_MATRIX_4_16_64_INFRA_AUTOPILOT_1_5M.txt"), scannerMatrix([4, 16, 64]));
  write(path.join(blueprintDir, "vidipay-web-service-render.yaml"), webBlueprint());

  write(path.join(opsDir, "INFRA_AUTOPILOT_APPLY_ORDER_1_5M.md"), `# VidiPay 1.5M Infra Autopilot Apply Order

Run this order only:

1. Upload web service zip to \`vidipay-backend\`.
2. Set \`env/RENDER_WEB_SERVICE_INFRA_AUTOPILOT_1_5M.env\` values in Render Web Service. Fill secrets manually.
3. Upload scanner worker zip to scanner worker repo.
4. Create 4 Background Workers first using \`render-blueprints/scanner-workers-4.autopilot.yaml\` or env matrix.
5. Generate/import missing wallet public SQL. Private keys stay offline.
6. Configure TON signer env and mounted key dir.
7. Verify \`/ops/infra-autopilot?fresh=true\`, then \`/ops/final-gate\`.

Do not upload \`private-keys\`, \`.env.local\`, \`node_modules\`, or \`package-lock.json\`.
`);

  write(path.join(opsDir, "TON_SIGNER_PAYOUT_CLOSEOUT_1_5M.md"), `# TON Signer Payout Closeout

Required before automatic deposit refund:

- \`TON_AUTO_PAYOUT_ENABLED=true\`
- \`TON_SIGNER_ENABLED=true\`
- \`TON_SIGNER_KEYS_DIR\` points to protected local/mounted private-key folder
- \`TON_RPC_ENDPOINT\` is a working TON RPC endpoint
- \`TON_RPC_API_KEY\` is the matching RPC key

Only the signer runtime can see private keys. GitHub, Supabase, Render repo uploads, frontend, and admin panel must not contain mnemonic or seed files.
`);

  write(path.join(opsDir, "infra-autopilot-manifest-1_5m.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    target_users: 1500000,
    generated_files: [
      "env/RENDER_WEB_SERVICE_INFRA_AUTOPILOT_1_5M.env",
      "env/SCANNER_WORKER_ENV_MATRIX_4_16_64_INFRA_AUTOPILOT_1_5M.txt",
      "env/TON_SIGNER_ENV_REQUIRED_1_5M.env",
      "render-blueprints/vidipay-web-service-render.yaml",
      "ops/INFRA_AUTOPILOT_APPLY_ORDER_1_5M.md",
      "ops/TON_SIGNER_PAYOUT_CLOSEOUT_1_5M.md"
    ],
    verify_after_deploy: [
      "/ops/infra-autopilot?fresh=true",
      "/ops/control-tower?fresh=true",
      "/ops/final-gate"
    ]
  }, null, 2));
}

main();

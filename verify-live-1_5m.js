const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");

function exists(relative) {
  return fs.existsSync(path.join(root, relative)) || fs.existsSync(path.join(packageRoot, relative));
}

function read(relative) {
  const rootPath = path.join(root, relative);
  if (fs.existsSync(rootPath)) return fs.readFileSync(rootPath, "utf8");
  return fs.readFileSync(path.join(packageRoot, relative), "utf8");
}

function main() {
  const errors = [];
  for (const file of [
    "scripts/generate-infra-autopilot-kit-1_5m.js",
    "scripts/generate-scanner-worker-blueprints-1_5m.js",
    "scripts/build-public-wallet-import-from-keys-dir-1_5m.js",
    "scripts/final-upload-audit-1_5m.js",
    "sql/INFRA_AUTOPILOT_SQL_GATE_1_5M.sql",
    "sql/WALLET_PUBLIC_IMPORT_STAGING_TEMPLATE_1_5M.sql"
  ]) {
    if (!exists(file)) errors.push(`Missing ${file}`);
  }

  const packageJson = read("package.json");
  for (const scriptName of [
    "ops:infra-autopilot",
    "ops:scanner-blueprints",
    "wallets:public-import",
    "verify:infra-autopilot",
    "verify:upload-audit"
  ]) {
    if (!packageJson.includes(`"${scriptName}"`)) errors.push(`package.json missing ${scriptName}`);
  }

  const server = read("server.js");
  for (const marker of [
    "buildInfraAutopilotPlan",
    'app.get("/ops/infra-autopilot"',
    "v1.8.2-infra-autopilot-20260628"
  ]) {
    if (!server.includes(marker)) errors.push(`server.js missing ${marker}`);
  }

  if (errors.length) {
    console.error("INFRA AUTOPILOT PACKAGE CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("INFRA AUTOPILOT PACKAGE CHECK OK");
}

main();

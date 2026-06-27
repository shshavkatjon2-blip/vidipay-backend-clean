const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function walkFiles(root, matcher, results = []) {
  if (!fs.existsSync(root)) return results;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, matcher, results);
    } else if (!matcher || matcher(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function countLines(filePath) {
  let count = 0;
  const content = fs.readFileSync(filePath, "utf8");
  for (const char of content) {
    if (char === "\n") count += 1;
  }
  return content ? count + (content.endsWith("\n") ? 0 : 1) : 0;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function countSqlRows(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const matches = content.match(/\('TON',\s*'TON',\s*'[^']+'\)/g);
  return matches ? matches.length : 0;
}

function validateWalletJson(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Boolean(data.address && (data.mnemonic || data.seed_hex));
  } catch {
    return false;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const poolDir = path.resolve(readArg("pool", process.cwd()));
  const expectedCount = Number(readArg("expected-count", "0"));
  const failOnPrivateKeysMissing = readArg("require-private-keys", "true") !== "false";

  if (!fs.existsSync(poolDir)) {
    throw new Error(`Pool folder not found: ${poolDir}`);
  }

  const sqlFiles = fs.readdirSync(poolDir)
    .filter((name) => /^public-addresses-\d+\.sql$/i.test(name))
    .sort()
    .map((name) => path.join(poolDir, name));
  const privateDir = path.join(poolDir, "private-keys");
  const privateKeyFiles = walkFiles(privateDir, (file) => file.endsWith(".json"));
  const manifestPath = path.join(poolDir, "wallet-manifest.public.jsonl");
  const csvPath = path.join(poolDir, "wallets-summary.csv");

  let sqlRowCount = 0;
  const sqlBatches = sqlFiles.map((filePath) => {
    const rows = countSqlRows(filePath);
    sqlRowCount += rows;
    return {
      file: path.basename(filePath),
      rows,
      sha256: sha256(filePath)
    };
  });

  const manifestLines = fs.existsSync(manifestPath) ? countLines(manifestPath) : 0;
  const csvLines = fs.existsSync(csvPath) ? Math.max(0, countLines(csvPath) - 1) : 0;
  const invalidPrivateFiles = privateKeyFiles.slice(0, 1000).filter((file) => !validateWalletJson(file));

  const checks = {
    pool_dir_exists: fs.existsSync(poolDir),
    sql_batches_found: sqlFiles.length > 0,
    sql_rows_match_expected: expectedCount > 0 ? sqlRowCount === expectedCount : true,
    manifest_matches_sql_rows: manifestLines === sqlRowCount,
    csv_matches_sql_rows: csvLines === sqlRowCount,
    private_keys_present: failOnPrivateKeysMissing ? privateKeyFiles.length === sqlRowCount : true,
    private_key_sample_valid: invalidPrivateFiles.length === 0
  };

  const report = {
    status: Object.values(checks).every(Boolean) ? "ok" : "failed",
    pool_dir: poolDir,
    expected_count: expectedCount || null,
    sql_batch_count: sqlFiles.length,
    sql_row_count: sqlRowCount,
    manifest_rows: manifestLines,
    csv_rows: csvLines,
    private_key_files: privateKeyFiles.length,
    invalid_private_key_sample_count: invalidPrivateFiles.length,
    checks,
    sql_batches: sqlBatches
  };

  const reportPath = path.join(poolDir, "wallet-pool-verification-report.json");
  writeJson(reportPath, report);

  console.log(`Wallet pool verification: ${report.status}`);
  console.log(`SQL rows: ${sqlRowCount}`);
  console.log(`Manifest rows: ${manifestLines}`);
  console.log(`CSV rows: ${csvLines}`);
  console.log(`Private key files: ${privateKeyFiles.length}`);
  console.log(`Report: ${reportPath}`);

  if (report.status !== "ok") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

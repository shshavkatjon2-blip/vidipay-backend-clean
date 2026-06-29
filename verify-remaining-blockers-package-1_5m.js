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

function countRows(text) {
  const matches = text.match(/\('TON',\s*'TON',\s*'[^']+'\)/g);
  return matches ? matches.length : 0;
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function main() {
  const dir = path.resolve(readArg("dir", process.cwd()));
  const expected = Number(readArg("expected-count", "0")) || 0;
  if (!fs.existsSync(dir)) throw new Error(`Folder not found: ${dir}`);

  const sqlFiles = fs.readdirSync(dir)
    .filter((name) => /^public-addresses-\d+\.sql$/i.test(name))
    .sort();

  const batches = [];
  let totalRows = 0;
  const seen = new Set();
  const duplicates = [];
  for (const file of sqlFiles) {
    const full = path.join(dir, file);
    const text = fs.readFileSync(full, "utf8");
    const rows = countRows(text);
    const addresses = [...text.matchAll(/\('TON',\s*'TON',\s*'([^']+)'\)/g)].map((match) => match[1]);
    for (const address of addresses) {
      if (seen.has(address)) duplicates.push(address);
      seen.add(address);
    }
    totalRows += rows;
    batches.push({
      file,
      rows,
      sha256: sha256(text)
    });
  }

  const report = {
    status: sqlFiles.length > 0 && duplicates.length === 0 && (!expected || totalRows === expected) ? "ok" : "failed",
    dir,
    expected_count: expected || null,
    sql_file_count: sqlFiles.length,
    total_rows: totalRows,
    unique_addresses: seen.size,
    duplicate_addresses: duplicates.length,
    batches
  };

  const reportPath = path.join(dir, "public-wallet-sql-verification-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`report=${reportPath}`);
  if (report.status !== "ok") process.exit(1);
}

main();

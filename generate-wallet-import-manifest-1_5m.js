const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const packageRoot = path.resolve(root, "..");
const searchDir = path.resolve(process.argv[2] || path.join(packageRoot, "wallet-import"));
const outputDir = fs.existsSync(path.join(packageRoot, "ops")) ? path.join(packageRoot, "ops") : root;
const outputFile = path.join(outputDir, "wallet-import-manifest-1_5m.json");

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function countWalletRows(text) {
  const matches = text.match(/\b(EQ|UQ)[A-Za-z0-9_-]{30,}\b/g);
  return matches ? matches.length : 0;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function main() {
  const files = walk(searchDir)
    .filter((file) => /public-addresses.*\.(sql|csv|txt)$/i.test(path.basename(file)))
    .sort((a, b) => a.localeCompare(b));

  const batches = files.map((file, index) => {
    const text = fs.readFileSync(file, "utf8");
    return {
      batch_index: index,
      file: path.relative(packageRoot, file).replace(/\\/g, "/"),
      bytes: fs.statSync(file).size,
      wallet_rows_detected: countWalletRows(text),
      sha256: sha256(file)
    };
  });

  const manifest = {
    generated_at: new Date().toISOString(),
    search_dir: searchDir,
    target_users: 1500000,
    batch_count: batches.length,
    wallet_rows_detected: batches.reduce((sum, item) => sum + item.wallet_rows_detected, 0),
    ready_for_sql_import: batches.length > 0,
    note: batches.length ? "Import these batches in Supabase SQL editor, then run WALLET_IMPORT_MANIFEST_AUDIT_1_5M.sql." : "No public-addresses SQL/CSV/TXT files found yet.",
    batches
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`manifest=${outputFile}`);
  console.log(`batches=${manifest.batch_count}`);
  console.log(`wallet_rows_detected=${manifest.wallet_rows_detected}`);
}

main();

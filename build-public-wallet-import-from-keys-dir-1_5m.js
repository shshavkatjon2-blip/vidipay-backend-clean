const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function numberArg(name, fallback, min, max) {
  const parsed = Number(arg(name, fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (/\.json$/i.test(entry.name)) files.push(full);
  }
  return files;
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeSqlBatch(outDir, batchIndex, rows) {
  const file = path.join(outDir, `public-addresses-${String(batchIndex).padStart(5, "0")}.sql`);
  const sql = [
    "-- Public wallet import only. No private keys in this file.",
    "insert into payment_wallets (network, token, address) values",
    rows.map((wallet) => `('TON', 'TON', '${sqlEscape(wallet.address)}')`).join(",\n"),
    "on conflict (address) do nothing;"
  ].join("\n");
  fs.writeFileSync(file, sql, "utf8");
  return file;
}

function main() {
  const keysDir = path.resolve(arg("keys-dir", ""));
  const outDir = path.resolve(arg("out", path.join(process.cwd(), "public-wallet-import-1_5m")));
  const batchSize = numberArg("sql-batch-size", 10000, 1, 10000);
  if (!keysDir || !fs.existsSync(keysDir)) {
    console.error("Usage: npm run wallets:public-import -- --keys-dir=C:\\secure\\private-keys --out=C:\\secure\\public-import");
    console.error("keys-dir is required and must exist.");
    process.exit(2);
  }
  if (/node_modules|\.git|outputs[\\/].*web-service|outputs[\\/].*scanner/i.test(keysDir)) {
    console.error("Refusing to read keys from repo/build/upload folders. Use an offline private-keys folder.");
    process.exit(2);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const files = walk(keysDir).sort((a, b) => a.localeCompare(b));
  const seen = new Set();
  const duplicates = [];
  const wallets = [];

  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const address = String(payload.address || "").trim();
    if (!/^(EQ|UQ)[A-Za-z0-9_-]{30,}$/.test(address)) continue;
    if (seen.has(address)) {
      duplicates.push({ address, file });
      continue;
    }
    seen.add(address);
    wallets.push({
      label: payload.label || path.basename(file, ".json"),
      address,
      raw_address: payload.raw_address || "",
      source_file_sha256: sha256(file)
    });
  }

  let batch = [];
  let batchIndex = 1;
  const batches = [];
  for (const wallet of wallets) {
    batch.push(wallet);
    if (batch.length >= batchSize) {
      const file = writeSqlBatch(outDir, batchIndex, batch);
      batches.push({ file: path.basename(file), wallet_count: batch.length, sha256: sha256(file) });
      batch = [];
      batchIndex += 1;
    }
  }
  if (batch.length) {
    const file = writeSqlBatch(outDir, batchIndex, batch);
    batches.push({ file: path.basename(file), wallet_count: batch.length, sha256: sha256(file) });
  }

  fs.writeFileSync(path.join(outDir, "wallets-public.csv"), [
    "label,address,raw_address",
    ...wallets.map((wallet) => `"${String(wallet.label).replace(/"/g, '""')}","${wallet.address}","${wallet.raw_address}"`)
  ].join("\n"), "utf8");

  fs.writeFileSync(path.join(outDir, "wallet-public-import-manifest-1_5m.json"), JSON.stringify({
    generated_at: new Date().toISOString(),
    source_keys_dir: keysDir,
    wallet_count: wallets.length,
    duplicate_count: duplicates.length,
    sql_batch_size: batchSize,
    sql_batches: batches,
    safe_to_upload_to_supabase: duplicates.length === 0 && wallets.length > 0,
    warning: "Only public-addresses SQL files go to Supabase. Keep source private keys offline."
  }, null, 2), "utf8");

  if (duplicates.length) {
    fs.writeFileSync(path.join(outDir, "duplicates.json"), JSON.stringify(duplicates, null, 2), "utf8");
    console.error(`duplicate_count=${duplicates.length}`);
    process.exit(1);
  }

  console.log(`wallet_count=${wallets.length}`);
  console.log(`sql_batches=${batches.length}`);
  console.log(`out=${outDir}`);
}

main();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WalletContractV4 } = require("@ton/ton");
const { mnemonicNew, mnemonicToPrivateKey, keyPairFromSeed } = require("@ton/crypto");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function normalizeCount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 10;
  return Math.min(100000, Math.floor(parsed));
}

function normalizeBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 5000;
  return Math.min(10000, Math.floor(parsed));
}

function sanitizeLabel(index, width) {
  return `wallet-${String(index + 1).padStart(width, "0")}`;
}

function buildInsertSql(rows) {
  return [
    "insert into payment_wallets (network, token, address) values",
    `${rows.join(",\n")}`,
    "on conflict (address) do nothing;"
  ].join("\n");
}

async function main() {
  const count = normalizeCount(readArg("count", "10"));
  const sqlBatchSize = normalizeBatchSize(readArg("sql-batch-size", "5000"));
  const keyFormat = String(readArg("key-format", "mnemonic")).trim().toLowerCase() === "seed" ? "seed" : "mnemonic";
  const workchain = Number(readArg("workchain", "0")) || 0;
  const network = String(readArg("network", "mainnet")).trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
  const outDir = path.resolve(readArg("out", path.join(process.cwd(), "ton-wallet-pool")));
  const labelWidth = Math.max(6, String(count).length);

  fs.mkdirSync(outDir, { recursive: true });

  const publicRows = [];
  let batchRows = [];
  let batchNumber = 1;
  let writtenBatchCount = 0;
  const csvRows = [["label", "address", "raw_address", "network", "workchain"]];
  const manifest = [];

  for (let index = 0; index < count; index += 1) {
    const label = sanitizeLabel(index, labelWidth);
    let mnemonic = null;
    let seedHex = "";
    let keyPair = null;

    if (keyFormat === "seed") {
      const seed = crypto.randomBytes(32);
      seedHex = seed.toString("hex");
      keyPair = keyPairFromSeed(seed);
    } else {
      mnemonic = await mnemonicNew(24);
      keyPair = await mnemonicToPrivateKey(mnemonic);
    }

    const wallet = WalletContractV4.create({
      workchain,
      publicKey: keyPair.publicKey
    });

    const address = wallet.address.toString({
      urlSafe: true,
      bounceable: true,
      testOnly: network === "testnet"
    });
    const rawAddress = wallet.address.toRawString();
    const walletFilePath = path.join(outDir, `${label}.json`);

    const securePayload = {
      label,
      network,
      workchain,
      address,
      raw_address: rawAddress,
      key_format: keyFormat,
      ...(mnemonic ? { mnemonic: mnemonic.join(" ") } : {}),
      ...(seedHex ? { seed_hex: seedHex } : {}),
      public_key_hex: Buffer.from(keyPair.publicKey).toString("hex")
    };

    fs.writeFileSync(walletFilePath, JSON.stringify(securePayload, null, 2), "utf8");

    const publicRow = `('TON', 'TON', '${address}')`;
    publicRows.push(publicRow);
    batchRows.push(publicRow);
    csvRows.push([label, address, rawAddress, network, String(workchain)]);
    manifest.push({
      label,
      address,
      raw_address: rawAddress,
      wallet_file: `${label}.json`
    });

    if (batchRows.length >= sqlBatchSize) {
      const batchFile = path.join(outDir, `public-addresses-${String(batchNumber).padStart(3, "0")}.sql`);
      fs.writeFileSync(batchFile, buildInsertSql(batchRows), "utf8");
      batchRows = [];
      batchNumber += 1;
      writtenBatchCount += 1;
    }

    if ((index + 1) % 10000 === 0) {
      console.log(`Generated ${index + 1}/${count} wallets...`);
    }
  }

  if (batchRows.length) {
    const batchFile = path.join(outDir, `public-addresses-${String(batchNumber).padStart(3, "0")}.sql`);
    fs.writeFileSync(batchFile, buildInsertSql(batchRows), "utf8");
    writtenBatchCount += 1;
  }

  const sql = buildInsertSql(publicRows);

  const csv = csvRows
    .map((row) => row.map((item) => `"${String(item).replace(/"/g, "\"\"")}"`).join(","))
    .join("\n");

  const envSnippet = [
    "TON_SIGNER_ENABLED=true",
    `TON_SIGNER_NETWORK=${network}`,
    `TON_SIGNER_KEYS_DIR=${outDir}`,
    "TON_RPC_ENDPOINT=",
    "TON_RPC_API_KEY=",
    "TON_PAYOUT_GAS_RESERVE=0.10",
    "TON_PAYOUT_BODY=VidiPay activation payout"
  ].join("\n");

  const readme = [
    "VidiPay TON wallet pool",
    "",
    `Wallet count: ${count}`,
    `Network: ${network}`,
    `Workchain: ${workchain}`,
    `Key format: ${keyFormat}`,
    "",
    "Important:",
    "- Do not upload these JSON files to GitHub, Supabase, Render, or frontend hosting.",
    "- Keep this folder private. Each JSON file contains the private recovery material for one pool wallet.",
    "- Use public-addresses.sql to import only the friendly addresses into payment_wallets.",
    `- For large imports, run public-addresses-001.sql ... public-addresses-${String(writtenBatchCount).padStart(3, "0")}.sql in Supabase SQL editor.`,
    "- signer-env-snippet.txt is for local signer setup only."
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "public-addresses.sql"), sql, "utf8");
  fs.writeFileSync(path.join(outDir, "wallets-summary.csv"), csv, "utf8");
  fs.writeFileSync(path.join(outDir, "wallet-manifest.public.json"), JSON.stringify(manifest, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "signer-env-snippet.txt"), envSnippet, "utf8");
  fs.writeFileSync(path.join(outDir, "README.txt"), readme, "utf8");

  console.log(`Generated ${count} TON wallets.`);
  console.log(`Secure folder: ${outDir}`);
  console.log(`Public SQL: ${path.join(outDir, "public-addresses.sql")}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

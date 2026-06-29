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
  if (!Number.isFinite(parsed) || parsed < 1) return 100000;
  return Math.min(3000000, Math.floor(parsed));
}

function normalizeBatchSize(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return 5000;
  return Math.min(10000, Math.floor(parsed));
}

function sanitizeLabel(index, width) {
  return `wallet-${String(index + 1).padStart(width, "0")}`;
}

function sqlEscape(value) {
  return String(value).replace(/'/g, "''");
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, "\"\"")}"`;
}

function writeBatchSql(outDir, batchNumber, rows) {
  const filePath = path.join(outDir, `public-addresses-${String(batchNumber).padStart(5, "0")}.sql`);
  const sql = [
    "insert into payment_wallets (network, token, address) values",
    rows.join(",\n"),
    "on conflict (address) do nothing;"
  ].join("\n");
  fs.writeFileSync(filePath, sql, "utf8");
  return filePath;
}

function shardDirForIndex(outDir, index) {
  const shardStart = Math.floor(index / 10000) * 10000 + 1;
  const shardEnd = shardStart + 9999;
  const shardName = `${String(shardStart).padStart(7, "0")}-${String(shardEnd).padStart(7, "0")}`;
  const dir = path.join(outDir, "private-keys", shardName);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function buildWallet(index, options) {
  const label = sanitizeLabel(index, options.labelWidth);
  let mnemonic = null;
  let seedHex = "";
  let keyPair = null;

  if (options.keyFormat === "seed") {
    const seed = crypto.randomBytes(32);
    seedHex = seed.toString("hex");
    keyPair = keyPairFromSeed(seed);
  } else {
    mnemonic = await mnemonicNew(24);
    keyPair = await mnemonicToPrivateKey(mnemonic);
  }

  const wallet = WalletContractV4.create({
    workchain: options.workchain,
    publicKey: keyPair.publicKey
  });

  const address = wallet.address.toString({
    urlSafe: true,
    bounceable: true,
    testOnly: options.network === "testnet"
  });
  const rawAddress = wallet.address.toRawString();

  return {
    label,
    address,
    rawAddress,
    payload: {
      label,
      network: options.network,
      workchain: options.workchain,
      address,
      raw_address: rawAddress,
      key_format: options.keyFormat,
      ...(mnemonic ? { mnemonic: mnemonic.join(" ") } : {}),
      ...(seedHex ? { seed_hex: seedHex } : {}),
      public_key_hex: Buffer.from(keyPair.publicKey).toString("hex")
    }
  };
}

async function main() {
  const count = normalizeCount(readArg("count", "100000"));
  const sqlBatchSize = normalizeBatchSize(readArg("sql-batch-size", "5000"));
  const keyFormat = String(readArg("key-format", "mnemonic")).trim().toLowerCase() === "seed" ? "seed" : "mnemonic";
  const workchain = Number(readArg("workchain", "0")) || 0;
  const network = String(readArg("network", "mainnet")).trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
  const outDir = path.resolve(readArg("out", path.join(process.cwd(), "ton-wallet-pool-large")));
  const labelWidth = Math.max(7, String(count).length);

  fs.mkdirSync(outDir, { recursive: true });

  const csvStream = fs.createWriteStream(path.join(outDir, "wallets-summary.csv"), { encoding: "utf8" });
  const manifestStream = fs.createWriteStream(path.join(outDir, "wallet-manifest.public.jsonl"), { encoding: "utf8" });
  csvStream.write(["label", "address", "raw_address", "network", "workchain"].map(csvCell).join(",") + "\n");

  let batchRows = [];
  let batchNumber = 1;
  let writtenBatchCount = 0;

  for (let index = 0; index < count; index += 1) {
    const wallet = await buildWallet(index, { labelWidth, keyFormat, workchain, network });
    const shardDir = shardDirForIndex(outDir, index);
    const walletFilePath = path.join(shardDir, `${wallet.label}.json`);

    fs.writeFileSync(walletFilePath, JSON.stringify(wallet.payload, null, 2), "utf8");

    batchRows.push(`('TON', 'TON', '${sqlEscape(wallet.address)}')`);
    csvStream.write([wallet.label, wallet.address, wallet.rawAddress, network, String(workchain)].map(csvCell).join(",") + "\n");
    manifestStream.write(JSON.stringify({
      label: wallet.label,
      address: wallet.address,
      raw_address: wallet.rawAddress,
      wallet_file: path.relative(outDir, walletFilePath).replace(/\\/g, "/")
    }) + "\n");

    if (batchRows.length >= sqlBatchSize) {
      writeBatchSql(outDir, batchNumber, batchRows);
      batchRows = [];
      batchNumber += 1;
      writtenBatchCount += 1;
    }

    if ((index + 1) % 10000 === 0) {
      console.log(`Generated ${index + 1}/${count} wallets...`);
    }
  }

  if (batchRows.length) {
    writeBatchSql(outDir, batchNumber, batchRows);
    writtenBatchCount += 1;
  }

  csvStream.end();
  manifestStream.end();

  const envSnippet = [
    "TON_SIGNER_ENABLED=true",
    `TON_SIGNER_NETWORK=${network}`,
    `TON_SIGNER_KEYS_DIR=${path.join(outDir, "private-keys")}`,
    "TON_RPC_ENDPOINT=",
    "TON_RPC_API_KEY=",
    "TON_PAYOUT_GAS_RESERVE=0.10",
    "TON_PAYOUT_BODY=VidiPay activation payout"
  ].join("\n");

  const readme = [
    "VidiPay TON large wallet pool",
    "",
    `Wallet count: ${count}`,
    `Network: ${network}`,
    `Workchain: ${workchain}`,
    `Key format: ${keyFormat}`,
    `SQL batch size: ${sqlBatchSize}`,
    `SQL batch files: ${writtenBatchCount}`,
    "",
    "Important:",
    "- Do not upload private-keys to GitHub, Supabase, Render, or frontend hosting.",
    "- Keep private-keys offline or on a protected signer machine only.",
    "- Import only public-addresses-00001.sql and later SQL files into Supabase.",
    "- wallet-manifest.public.jsonl contains public metadata only."
  ].join("\n");

  fs.writeFileSync(path.join(outDir, "signer-env-snippet.txt"), envSnippet, "utf8");
  fs.writeFileSync(path.join(outDir, "README.txt"), readme, "utf8");

  console.log(`Generated ${count} TON wallets.`);
  console.log(`Secure folder: ${outDir}`);
  console.log(`SQL batch files: ${writtenBatchCount}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

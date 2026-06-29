const path = require("path");
const { spawnSync } = require("child_process");

function readArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const direct = process.argv.find((item) => item.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

function readNumber(name, fallback, min, max) {
  const value = Number(readArg(name, process.env[name.toUpperCase().replace(/-/g, "_")] || fallback));
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function main() {
  const confirm = String(readArg("confirm-private-output", "")).trim().toLowerCase();
  if (confirm !== "yes") {
    console.error("Refusing to generate private wallet keys without --confirm-private-output=yes");
    console.error("Private keys must never be uploaded to GitHub, Render, Supabase, or frontend hosting.");
    process.exit(2);
  }

  const target = readNumber("target", 1500000, 1, 3000000);
  const currentAvailable = readNumber("current-available", 100001, 0, 3000000);
  const buffer = readNumber("buffer", 0, 0, 500000);
  const count = Math.max(0, target + buffer - currentAvailable);
  const out = path.resolve(readArg("out", path.join(process.cwd(), "ton-wallet-topup-to-1_5m")));
  const network = String(readArg("network", "mainnet")).trim().toLowerCase() === "testnet" ? "testnet" : "mainnet";
  const keyFormat = String(readArg("key-format", "mnemonic")).trim().toLowerCase() === "seed" ? "seed" : "mnemonic";
  const sqlBatchSize = readNumber("sql-batch-size", 5000, 1, 10000);

  if (count <= 0) {
    console.log("No wallet top-up needed.");
    console.log(`target=${target}`);
    console.log(`current_available=${currentAvailable}`);
    return;
  }

  console.log("=== VidiPay 1.5M wallet top-up generation ===");
  console.log(`target=${target}`);
  console.log(`current_available=${currentAvailable}`);
  console.log(`buffer=${buffer}`);
  console.log(`wallets_to_generate=${count}`);
  console.log(`secure_output=${out}`);
  console.log("IMPORTANT: Keep private-keys folder offline/private.");

  const generator = path.resolve(__dirname, "generate-ton-wallet-pool-large.js");
  const result = spawnSync(process.execPath, [
    generator,
    `--count=${count}`,
    `--out=${out}`,
    `--network=${network}`,
    `--key-format=${keyFormat}`,
    `--sql-batch-size=${sqlBatchSize}`
  ], {
    stdio: "inherit"
  });

  if (result.error) throw result.error;
  process.exit(result.status || 0);
}

main();

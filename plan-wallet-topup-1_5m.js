const fs = require("fs");
const path = require("path");

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
  const target = readNumber("target", 1500000, 1, 3000000);
  const currentAvailable = readNumber("current-available", 100001, 0, 3000000);
  const buffer = readNumber("buffer", 0, 0, 500000);
  const generateCount = Math.max(0, target + buffer - currentAvailable);
  const out = path.resolve(readArg("out", path.join(process.cwd(), "wallet-topup-plan-1_5m.json")));
  const plan = {
    target_wallets: target,
    current_available_wallets: currentAvailable,
    buffer_wallets: buffer,
    wallets_to_generate: generateCount,
    recommended_command: `node scripts/generate-missing-ton-wallets-to-target-1_5m.js --target=${target} --current-available=${currentAvailable} --buffer=${buffer} --out=SECURE_LOCAL_WALLET_FOLDER --confirm-private-output=yes`,
    warning: "Generated private keys must stay off GitHub, Render, Supabase, frontend hosting, and shared archives."
  };
  fs.writeFileSync(out, JSON.stringify(plan, null, 2), "utf8");
  console.log(JSON.stringify(plan, null, 2));
  console.log(`plan_written=${out}`);
}

main();

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

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith(".json")) files.push(full);
  }
  return files;
}

function main() {
  const keysDir = path.resolve(readArg("keys-dir", ""));
  const minFiles = Math.max(1, Number(readArg("min-files", "1")));
  if (!keysDir || !fs.existsSync(keysDir)) throw new Error(`TON_SIGNER_KEYS_DIR not found: ${keysDir}`);
  const files = walk(keysDir);
  const addresses = new Set();
  let valid = 0;
  let invalid = 0;
  for (const file of files.slice(0, 10000)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      const hasKey = Boolean(data.mnemonic || data.seed_hex || data.secret_key || data.private_key);
      const address = String(data.address || data.wallet_address || "").trim();
      if (!hasKey || !address) {
        invalid += 1;
        continue;
      }
      addresses.add(address);
      valid += 1;
    } catch {
      invalid += 1;
    }
  }
  const report = {
    status: files.length >= minFiles && valid > 0 && invalid === 0 ? "ok" : "failed",
    keys_dir: keysDir,
    files_found: files.length,
    files_sample_checked: Math.min(files.length, 10000),
    valid_sample: valid,
    invalid_sample: invalid,
    duplicate_addresses_in_sample: valid - addresses.size
  };
  fs.writeFileSync(path.join(keysDir, "..", "signer-keys-dir-verification-report.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== "ok") process.exit(1);
}

main();

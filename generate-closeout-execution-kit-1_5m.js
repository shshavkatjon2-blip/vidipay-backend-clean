const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
  return files;
}

function main() {
  const forbidden = [
    /(^|[\\/])node_modules([\\/]|$)/i,
    /(^|[\\/])package-lock\.json$/i,
    /(^|[\\/])\.env\.local$/i,
    /(^|[\\/])private-keys([\\/]|$)/i,
    /(^|[\\/])wallet-\d+\.json$/i
  ];
  const files = walk(root);
  const bad = files
    .map((file) => path.relative(root, file).replace(/\\/g, "/"))
    .filter((relative) => forbidden.some((pattern) => pattern.test(relative)));
  if (bad.length) {
    console.error("UPLOAD AUDIT FAILED");
    for (const file of bad.slice(0, 50)) console.error(`- ${file}`);
    process.exit(1);
  }
  console.log("UPLOAD AUDIT OK");
  console.log(`files_checked=${files.length}`);
}

main();

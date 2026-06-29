const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function fail(errors, message) {
  errors.push(message);
}

function assertIncludes(errors, file, pattern, label) {
  if (!exists(file)) return fail(errors, `Missing ${file}`);
  if (!read(file).includes(pattern)) fail(errors, `${file} missing ${label || pattern}`);
}

function assertNotIncludes(errors, file, pattern, label) {
  if (!exists(file)) return;
  if (read(file).includes(pattern)) fail(errors, `${file} contains ${label || pattern}`);
}

function countOccurrences(text, pattern) {
  const matches = text.match(new RegExp(pattern, "g"));
  return matches ? matches.length : 0;
}

function main() {
  const errors = [];
  assertIncludes(errors, "render.yaml", "buildCommand: node render-build-fix.cjs && npm install --omit=dev --no-audit --no-fund", "safe clean install build command");
  assertIncludes(errors, "render-build-fix.cjs", "fs.rmSync(\"node_modules\"", "node_modules cleanup guard");
  assertIncludes(errors, "render-build-fix.cjs", "package-lock.json", "package-lock cleanup guard");
  assertNotIncludes(errors, "render.yaml", "npm ci", "npm ci build command");
  assertNotIncludes(errors, "render.yaml", "value: 512      - key", "glued YAML env row");
  assertNotIncludes(errors, "render.yaml", "value: 60000      - key", "glued YAML env row");

  const render = exists("render.yaml") ? read("render.yaml") : "";
  const isWorker = render.includes("type: worker");
  const isWeb = render.includes("type: web");

  if (!isWorker && !isWeb) fail(errors, "render.yaml must be either Web Service or Background Worker");

  if (isWeb) {
    assertIncludes(errors, "render.yaml", "startCommand: npm start", "Web Service start command");
    assertIncludes(errors, "render.yaml", "PAYMENT_SCANNER_ENABLED", "API scanner disabled marker");
    assertIncludes(errors, "render.yaml", "RATE_LIMIT_BACKEND", "API Redis rate-limit marker");
    assertIncludes(errors, "render.yaml", "CAPACITY_TARGET_USERS", "1.5M target env marker");
    assertIncludes(errors, "render.yaml", "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT", "scanner heartbeat read limit marker");
    assertIncludes(errors, "render.yaml", "OPS_SNAPSHOT_CACHE_TTL_MS", "ops snapshot cache marker");
  }

  if (isWorker) {
    assertIncludes(errors, "render.yaml", "startCommand: npm run start:scanner", "Background Worker start command");
    assertIncludes(errors, "render.yaml", "WORKER_MODE", "scanner worker mode env");
    assertIncludes(errors, "render.yaml", "PAYMENT_SCANNER_SHARD_COUNT", "scanner shard count env");
    assertIncludes(errors, "render.yaml", "PAYMENT_SCANNER_SHARD_INDEX", "scanner shard index env");
    assertIncludes(errors, "render.yaml", "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT", "scanner heartbeat read limit env");
    for (const file of ["render.4-workers.yaml", "render.16-workers.yaml", "render.64-workers.yaml", "render.256-workers.yaml"]) {
      assertIncludes(errors, file, "startCommand: npm run start:scanner", `${file} scanner start command`);
      assertIncludes(errors, file, "PAYMENT_SCANNER_HEARTBEAT_READ_LIMIT", `${file} scanner heartbeat read limit`);
      assertNotIncludes(errors, file, "npm ci", `${file} npm ci`);
      assertNotIncludes(errors, file, "value: 512      - key", `${file} glued YAML env row`);
      assertNotIncludes(errors, file, "value: 60000      - key", `${file} glued YAML env row`);
    }
    const blueprint16 = exists("render.16-workers.yaml") ? read("render.16-workers.yaml") : "";
    const serviceCount16 = countOccurrences(blueprint16, "type: worker");
    if (serviceCount16 !== 16) fail(errors, `render.16-workers.yaml expected 16 workers, got ${serviceCount16}`);
  }

  if (errors.length) {
    console.error("RENDER BLUEPRINT CHECK FAILED");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log("RENDER BLUEPRINT CHECK OK");
  console.log(`service_type=${isWorker ? "worker" : "web"}`);
}

main();

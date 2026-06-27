const DEFAULT_TIMEOUT_MS = 12000;

function readEnv(name, fallback = "") {
  return String(process.env[name] || fallback).trim();
}

function normalizeBaseUrl(value) {
  const url = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("BASE_URL must start with http:// or https://");
  }
  return url;
}

async function requestJson(baseUrl, item) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), item.timeoutMs || DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(`${baseUrl}${item.path}`, {
      method: item.method || "GET",
      headers: item.headers || {},
      signal: controller.signal
    });
    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    let statusOk = response.status >= 200 && response.status < 400;
    if (Array.isArray(item.expectedStatus)) {
      statusOk = item.expectedStatus.includes(response.status);
    } else if (Number.isInteger(item.expectedStatus)) {
      statusOk = response.status === item.expectedStatus;
    }
    const bodyOk = typeof item.bodyOk === "function" ? item.bodyOk(body) : true;

    return {
      name: item.name,
      path: item.path,
      ok: statusOk && bodyOk,
      status: response.status,
      ms: Date.now() - startedAt,
      body,
      error: statusOk ? (bodyOk ? "" : "unexpected response body") : `unexpected status ${response.status}`
    };
  } catch (error) {
    return {
      name: item.name,
      path: item.path,
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResult(result) {
  const status = result.ok ? "OK" : "FAIL";
  const statusCode = result.status || "ERR";
  const error = result.error ? ` - ${result.error}` : "";
  return `${status} ${result.name} ${statusCode} ${result.ms}ms${error}`;
}

async function main() {
  const baseUrl = normalizeBaseUrl(readEnv("BASE_URL"));
  const testTelegramId = readEnv("TEST_TG_ID");
  const adminToken = readEnv("ADMIN_TOKEN");
  const expectedVersion = readEnv("EXPECTED_VERSION");

  const checks = [
    {
      name: "healthz",
      path: "/healthz",
      bodyOk: body => body && body.status === "ok" && (!expectedVersion || body.version === expectedVersion)
    },
    {
      name: "readyz",
      path: "/readyz",
      bodyOk: body => body && body.status === "ready" && (!expectedVersion || body.version === expectedVersion)
    },
    {
      name: "root",
      path: "/",
      bodyOk: body => body && body.status === "online" && (!expectedVersion || body.version === expectedVersion)
    },
    {
      name: "scanner public health",
      path: "/scanner/healthz",
      bodyOk: body => body && ["ok", "stale", "unavailable"].includes(body.status)
    },
    {
      name: "ops readiness",
      path: "/ops/readiness",
      bodyOk: body => body && ["ready", "action_required", "not_ready"].includes(body.status)
    },
    {
      name: "ops metrics",
      path: "/ops/metrics",
      bodyOk: body => body && typeof body.uptime_seconds === "number"
    },
    {
      name: "ops capacity",
      path: "/ops/capacity",
      bodyOk: body => body && body.capacity && ["ready", "warning", "blocked"].includes(body.capacity.status)
    },
    {
      name: "ops deploy",
      path: "/ops/deploy",
      bodyOk: body => body && ["ready", "action_required", "not_ready"].includes(body.status)
    },
    {
      name: "ops live",
      path: "/ops/live",
      bodyOk: body => body && ["ready", "action_required", "not_ready"].includes(body.status)
    },
    {
      name: "settings",
      path: "/settings",
      bodyOk: body => body
        && Number(body.activation_deposit_amount) > 0
        && Number(body.payment_min_received_amount) > 0
        && Number(body.payment_max_received_amount) >= Number(body.payment_min_received_amount)
    },
    {
      name: "admin protected without token",
      path: "/admin/users?limit=1&page=1",
      expectedStatus: [401, 403]
    }
  ];

  if (testTelegramId) {
    checks.push({
      name: "payment status",
      path: `/payment/status/${encodeURIComponent(testTelegramId)}`
    });
    checks.push({
      name: "notifications",
      path: `/notifications/${encodeURIComponent(testTelegramId)}`
    });
    checks.push({
      name: "history",
      path: `/history/${encodeURIComponent(testTelegramId)}`
    });
  }

  if (adminToken) {
    const headers = { "X-Admin-Token": adminToken };
    checks.push(
      { name: "admin users", path: "/admin/users?limit=20&page=1", headers },
      { name: "admin withdraws", path: "/admin/withdraws?status=pending&limit=20&page=1", headers },
      { name: "admin payment orders", path: "/admin/payment-orders?status=pending&limit=20&page=1", headers },
      { name: "admin payment wallets", path: "/admin/payment-wallets", headers },
      {
        name: "admin payment scanner",
        path: "/admin/payment-scanner/status",
        headers,
        bodyOk: body => body && typeof body.heartbeat_available === "boolean"
      }
    );
  }

  const results = [];
  for (const check of checks) {
    const result = await requestJson(baseUrl, check);
    results.push(result);
    console.log(summarizeResult(result));
  }

  const failed = results.filter((item) => !item.ok);
  const slow = results.filter((item) => item.ms > 1500);

  console.log("");
  console.log(`Checked: ${results.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Slow over 1500ms: ${slow.length}`);

  if (failed.length) {
    process.exitCode = 1;
    console.log("");
    console.log("Failed checks:");
    for (const item of failed) {
      console.log(`- ${item.name}: ${item.error || "failed"}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

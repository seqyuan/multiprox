const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const TEST_USER = "testuser";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(host, port, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({ hostname: host, port, path: "/", method: "GET", timeout: 500 }, (res) => {
          res.resume();
          resolve(true);
        });
        req.on("error", () => reject(new Error("not ready")));
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.end();
      });
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error(`Server ${host}:${port} did not start within ${timeoutMs}ms`);
}

function runNode(args) {
  return spawn("node", [CLI, ...args], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runForeground(args) {
  return spawn("node", [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, MULTIPROX_BACKGROUND: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function waitForLog(proc, pattern, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for log: ${pattern}\n${buf}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buf += chunk.toString();
      if (pattern.test(buf)) {
        cleanup();
        resolve(buf);
      }
    };

    const onExit = (code) => {
      cleanup();
      reject(new Error(`Process exited (${code}) before log match\n${buf}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("exit", onExit);
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.on("exit", onExit);
  });
}

async function startBackground(args) {
  const proc = runNode(args);
  await new Promise((resolve) => proc.on("exit", resolve));
}

async function stopBackground(statePath) {
  await new Promise((resolve) => {
    const proc = runNode(["stop", "-s", statePath]);
    proc.on("exit", resolve);
  });
}

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseCookie(setCookie) {
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  if (!raw) return "";
  return raw.split(";")[0];
}

function findCookie(setCookie, name) {
  const rows = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const row = rows.find((item) => item.startsWith(`${name}=`));
  return row ? row.split(";")[0] : "";
}

test("shared gateway login and web API writes", async (t) => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-it-"));
  const testHome = path.join(tmp, "home");
  const userHome = path.join(testHome, TEST_USER);
  const configPath = path.join(userHome, ".config", "multiprox", "config.yaml");
  const stateDir = path.join(tmp, "state");
  const statePath = path.join(stateDir, "state.yaml");
  const port = 30441;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });

  const { hashPassword } = require(path.join(ROOT, "dist", "auth"));
  const yaml = require("js-yaml");

  fs.writeFileSync(
    configPath,
    yaml.dump({
      auth: { password_hash: hashPassword("pass123") },
      services: [{ id: "echo", name: "Echo", host: "127.0.0.1", port: 9999, path: "/echo", websocket: false }],
    })
  );

  fs.writeFileSync(
    statePath,
    yaml.dump({
      server: { host: "127.0.0.1", port },
      auth: { session_secret: "integration-test-secret-fixed-32bytes", session_ttl: 3600 },
      users: { home_prefix: testHome, scan_homes: true },
    })
  );

  const daemon = runForeground(["-s", statePath, "--host", "127.0.0.1", "--port", String(port)]);
  t.after(() => daemon.kill("SIGTERM"));

  await waitForLog(daemon, /listening on http:\/\/127\.0\.0\.1:/);

  const login = await httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: "/login",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(`username=${TEST_USER}&password=pass123`),
      },
    },
    `username=${TEST_USER}&password=pass123`
  );
  assert.equal(login.status, 302, login.body);
  const cookie = parseCookie(login.headers["set-cookie"]);

  const list = await httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/services",
    method: "GET",
    headers: { Cookie: cookie },
  });
  assert.equal(list.status, 200);
  assert.match(list.body, /"echo"/);

  const add = await httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/services",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "Content-Length": Buffer.byteLength(
          JSON.stringify({ name: "newsvc", port: 18001, host: "127.0.0.1", category: "测试" })
        ),
      },
    },
    JSON.stringify({ name: "newsvc", port: 18001, host: "127.0.0.1", category: "测试" })
  );
  assert.equal(add.status, 201, add.body);
  assert.match(add.body, /"newsvc"/);

  const layout = await httpRequest(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/services/layout",
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        "Content-Length": Buffer.byteLength(
          JSON.stringify({
            items: [
              { id: "newsvc", order: 0, category: "测试" },
              { id: "echo", order: 1 },
            ],
          })
        ),
      },
    },
    JSON.stringify({
      items: [
        { id: "newsvc", order: 0, category: "测试" },
        { id: "echo", order: 1 },
      ],
    })
  );
  assert.equal(layout.status, 200, layout.body);
  assert.match(layout.body, /"newsvc"/);

  const del = await httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/services/newsvc",
    method: "DELETE",
    headers: { Cookie: cookie },
  });
  assert.equal(del.status, 200, del.body);
});

test("applySharedGatewayPermissions fixes traverse and config readability", () => {
  const { applySharedGatewayPermissions } = require(path.join(ROOT, "dist", "config-perms"));
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-perm-"));
  const home = path.join(tmp, "alice");
  const configPath = path.join(home, ".config", "multiprox", "config.yaml");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "auth: {}\n", { mode: 0o600 });
  fs.chmodSync(home, 0o700);
  fs.chmodSync(path.join(home, ".config"), 0o700);
  fs.chmodSync(path.dirname(configPath), 0o700);

  const result = applySharedGatewayPermissions(configPath, home);
  const changed = result.applied.filter((entry) => entry.changed).map((entry) => entry.path);

  assert.ok(changed.includes(home));
  assert.ok(changed.includes(configPath));
  assert.equal(fs.statSync(home).mode & 0o777, 0o711);
  assert.equal(fs.statSync(configPath).mode & 0o777, 0o666);
});

test("shouldApplySharedGatewayPermissions skips when gateway operator is current user", () => {
  const { shouldApplySharedGatewayPermissions } = require(path.join(ROOT, "dist", "config-perms"));
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-perm3-"));
  const home = path.join(tmp, "ops");
  const stateDir = path.join(tmp, "state");
  const statePath = path.join(stateDir, "state.yaml");
  const configPath = path.join(home, ".config", "multiprox", "config.yaml");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "auth: {}\n", { mode: 0o600 });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, "server: { host: 127.0.0.1, port: 1 }\n");

  const uid = fs.statSync(home).uid;
  fs.chownSync(statePath, uid, fs.statSync(statePath).gid);

  assert.equal(shouldApplySharedGatewayPermissions(configPath, statePath), false);
});

test("applySharedGatewayPermissions keeps permissive home unchanged", () => {
  const { applySharedGatewayPermissions } = require(path.join(ROOT, "dist", "config-perms"));
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-perm2-"));
  const home = path.join(tmp, "bob");
  const configPath = path.join(home, ".config", "multiprox", "config.yaml");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "auth: {}\n");
  fs.chmodSync(home, 0o755);
  fs.chmodSync(path.join(home, ".config"), 0o700);
  fs.chmodSync(path.dirname(configPath), 0o700);

  const result = applySharedGatewayPermissions(configPath, home);
  const homeEntry = result.applied.find((entry) => entry.path === home);

  assert.equal(homeEntry?.changed, false);
  assert.equal(fs.statSync(home).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.dirname(configPath)).mode & 0o777, 0o711);
});

test("add rejects non-interactive arguments", () => {
  const { parseArgv } = require(path.join(ROOT, "dist", "cli"));

  assert.throws(
    () => parseArgv(["add", "--port", "1901", "jupyter"]),
    /Unknown option|interactive only/
  );
  assert.throws(() => parseArgv(["add", "jupyter"]), /interactive only/);
  assert.equal(parseArgv(["add"]).command, "add");
});

test("proxy forwarded headers for subpath apps", () => {
  const { buildProxyForwardContext, buildForwardedHeaderValues } = require(path.join(
    ROOT,
    "dist",
    "proxy"
  ));

  const req = {
    headers: {
      host: "lab.example.com:1907",
    },
    socket: { remoteAddress: "10.0.0.5" },
  };

  const forward = buildProxyForwardContext(req, "alice", "/annovibe");
  assert.equal(forward.prefix, "/proxy/alice/annovibe");
  assert.equal(forward.host, "lab.example.com:1907");
  assert.equal(forward.proto, "http");
  assert.equal(forward.clientIp, "10.0.0.5");

  const headers = buildForwardedHeaderValues(forward, "203.0.113.1");
  assert.equal(headers["x-forwarded-for"], "203.0.113.1, 10.0.0.5");
  assert.equal(headers["x-forwarded-prefix"], "/proxy/alice/annovibe");
  assert.equal(headers["x-forwarded-host"], "lab.example.com:1907");

  const legacy = buildProxyForwardContext(req, "alice", "/jupyter", true);
  assert.equal(legacy.prefix, "/proxy/jupyter");
});

test("proxy rewrites redirects, strips gateway cookie, and falls back by referer", async (t) => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-proxy-"));
  const testHome = path.join(tmp, "home");
  const userHome = path.join(testHome, TEST_USER);
  const configPath = path.join(userHome, ".config", "multiprox", "config.yaml");
  const statePath = path.join(tmp, "state.yaml");
  const gatewayPort = 30443;
  let lastCookie = "";
  let lastOrigin = "";

  const backend = http.createServer((req, res) => {
    lastCookie = req.headers.cookie || "";
    lastOrigin = req.headers.origin || "";
    if (req.url === "/") {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }
    if (req.url === "/external") {
      res.writeHead(302, { Location: "//cdn.example.test/app.js" });
      res.end();
      return;
    }
    if (req.url === "/_next/static/app.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end("asset-ok");
      return;
    }
    if (req.url === "/?after=login") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("backend-root-ok");
      return;
    }
    if (req.url === "/api/auth/login" || req.url === "/login?next=%2Flab") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ backend: true, url: req.url }));
      return;
    }
    res.writeHead(404);
    res.end("backend 404");
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  t.after(() => backend.close());
  const backendPort = backend.address().port;

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { hashPassword } = require(path.join(ROOT, "dist", "auth"));
  const yaml = require("js-yaml");
  fs.writeFileSync(
    configPath,
    yaml.dump({
      auth: { password_hash: hashPassword("pass123") },
      services: [{ id: "app", name: "App", host: "127.0.0.1", port: backendPort, path: "/app", websocket: true }],
    })
  );
  fs.writeFileSync(
    statePath,
    yaml.dump({
      server: { host: "127.0.0.1", port: gatewayPort },
      auth: { session_secret: "proxy-test-secret", session_ttl: 3600 },
      users: { home_prefix: testHome, scan_homes: true },
    })
  );

  const daemon = runForeground(["-s", statePath, "--host", "127.0.0.1", "--port", String(gatewayPort)]);
  t.after(() => daemon.kill("SIGTERM"));
  await waitForLog(daemon, /listening on http:\/\/127\.0\.0\.1:/);

  const loginBody = `username=${TEST_USER}&password=pass123`;
  const login = await httpRequest(
    {
      hostname: "127.0.0.1",
      port: gatewayPort,
      path: "/login",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(loginBody),
      },
    },
    loginBody
  );
  assert.equal(login.status, 302, login.body);
  const cookie = parseCookie(login.headers["set-cookie"]);

  const proxied = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: `/proxy/${TEST_USER}/app/`,
    method: "GET",
    headers: {
      Cookie: `${cookie}; backend_cookie=yes`,
      Origin: `http://127.0.0.1:${gatewayPort}`,
    },
  });
  assert.equal(proxied.status, 302);
  assert.equal(proxied.headers.location, `/proxy/${TEST_USER}/app/login`);
  assert.equal(lastCookie.includes("multiprox_session="), false);
  assert.equal(lastCookie.includes("multiprox_route="), false);
  assert.equal(lastCookie.includes("backend_cookie=yes"), true);
  assert.equal(lastOrigin, `http://127.0.0.1:${backendPort}`);
  const routeCookie = findCookie(proxied.headers["set-cookie"], "multiprox_route");
  assert.match(routeCookie, /^multiprox_route=/);

  const external = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: `/proxy/${TEST_USER}/app/external`,
    method: "GET",
    headers: { Cookie: cookie },
  });
  assert.equal(external.status, 302);
  assert.equal(external.headers.location, "//cdn.example.test/app.js");

  const asset = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: "/_next/static/app.js",
    method: "GET",
    headers: {
      Cookie: cookie,
      Referer: `http://127.0.0.1:${gatewayPort}/proxy/${TEST_USER}/app/login`,
    },
  });
  assert.equal(asset.status, 200, asset.body);
  assert.equal(asset.body, "asset-ok");

  const backendApi = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: "/api/auth/login",
    method: "POST",
    headers: {
      Cookie: cookie,
      Referer: `http://127.0.0.1:${gatewayPort}/proxy/${TEST_USER}/app/login`,
    },
  });
  assert.equal(backendApi.status, 200, backendApi.body);
  assert.match(backendApi.body, /"backend":true/);

  const backendLogin = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: "/login?next=%2Flab",
    method: "POST",
    headers: {
      Cookie: cookie,
      Referer: `http://127.0.0.1:${gatewayPort}/proxy/${TEST_USER}/app/login?next=%2Flab`,
    },
  });
  assert.equal(backendLogin.status, 200, backendLogin.body);
  assert.match(backendLogin.body, /"url":"\/login\?next=%2Flab"/);

  const backendRoot = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: "/?after=login",
    method: "GET",
    headers: {
      Cookie: cookie,
      Referer: `http://127.0.0.1:${gatewayPort}/proxy/${TEST_USER}/app/login`,
    },
  });
  assert.equal(backendRoot.status, 302, backendRoot.body);
  assert.equal(backendRoot.headers.location, `/proxy/${TEST_USER}/app/?after=login`);

  const routeCookieAsset = await httpRequest({
    hostname: "127.0.0.1",
    port: gatewayPort,
    path: "/_next/static/app.js",
    method: "GET",
    headers: { Cookie: `${cookie}; ${routeCookie}` },
  });
  assert.equal(routeCookieAsset.status, 200, routeCookieAsset.body);
  assert.equal(routeCookieAsset.body, "asset-ok");
});

test("legacy proxy path routing", () => {
  const { UserRegistry } = require(path.join(ROOT, "dist", "registry"));
  const yaml = require("js-yaml");

  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-legacy-"));
  const testHome = path.join(tmp, "home");
  const userHome = path.join(testHome, TEST_USER);
  const configPath = path.join(userHome, ".config", "multiprox", "config.yaml");
  const statePath = path.join(tmp, "state.yaml");

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const { hashPassword } = require(path.join(ROOT, "dist", "auth"));
  fs.writeFileSync(
    configPath,
    yaml.dump({
      auth: { password_hash: hashPassword("pass123") },
      services: [
        { id: "jupyter", name: "Jupyter", host: "127.0.0.1", port: 1902, path: "/jupyter", websocket: true },
        { id: "echo", name: "Echo", host: "127.0.0.1", port: 9999, path: "/echo", websocket: false },
      ],
    })
  );
  fs.writeFileSync(
    statePath,
    yaml.dump({
      server: { host: "127.0.0.1", port: 1 },
      users: { home_prefix: testHome, scan_homes: true },
    })
  );

  const { loadState } = require(path.join(ROOT, "dist", "state"));
  const registry = new UserRegistry(loadState(statePath));
  registry.reload();

  const legacy = registry.findLegacyService("/proxy/jupyter/lab", TEST_USER);
  assert.ok(legacy);
  assert.equal(legacy.service.id, "jupyter");
  assert.equal(legacy.remainingPath, "/lab");
  assert.equal(legacy.legacy, true);

  const multi = registry.findService(`/proxy/${TEST_USER}/jupyter/lab`);
  assert.ok(multi);
  assert.equal(multi.service.id, "jupyter");
  assert.equal(multi.remainingPath, "/lab");
});

test("stop command stops running daemon", async () => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "multiprox-stop-"));
  const stateDir = path.join(tmp, "state");
  const statePath = path.join(stateDir, "state.yaml");
  const pidPath = path.join(stateDir, "daemon.pid");
  const port = 30442;

  fs.mkdirSync(stateDir, { recursive: true });
  const yaml = require("js-yaml");
  fs.writeFileSync(
    statePath,
    yaml.dump({
      server: { host: "127.0.0.1", port },
      auth: { session_secret: "stop-test-secret", session_ttl: 3600 },
      users: { home_prefix: tmp, scan_homes: false },
    })
  );

  const daemon = runNode(["-s", statePath, "--host", "127.0.0.1", "--port", String(port)]);
  await new Promise((resolve) => daemon.on("exit", resolve));
  await waitForServer("127.0.0.1", port);
  assert.equal(fs.existsSync(pidPath), true);

  const stop = runNode(["stop", "-s", statePath]);
  await new Promise((resolve) => stop.on("exit", resolve));

  // Allow background process to exit
  await sleep(500);
  assert.equal(fs.existsSync(pidPath), false);
});

test("layout helpers reorder and categorize", () => {
  const {
    buildLayoutEntries,
    moveEntry,
    setEntryCategory,
    entriesToLayoutItems,
  } = require(path.join(ROOT, "dist", "layout-cli"));

  const entries = buildLayoutEntries([
    { id: "a", name: "A", host: "127.0.0.1", port: 1, path: "/a", websocket: false, category: "x", order: 0 },
    { id: "b", name: "B", host: "127.0.0.1", port: 2, path: "/b", websocket: false, category: "x", order: 1 },
    { id: "c", name: "C", host: "127.0.0.1", port: 3, path: "/c", websocket: false, order: 2 },
  ]);

  assert.deepEqual(entries.map((e) => e.id), ["a", "b", "c"]);

  const moved = moveEntry(entries, 2, -1);
  assert.deepEqual(moved.map((e) => e.id), ["a", "c", "b"]);

  const categorized = setEntryCategory(moved, 1, "分析环境");
  assert.equal(categorized[1].category, "分析环境");

  const items = entriesToLayoutItems(categorized);
  assert.deepEqual(items, [
    { id: "a", order: 0, category: "x" },
    { id: "c", order: 1, category: "分析环境" },
    { id: "b", order: 2, category: "x" },
  ]);
});

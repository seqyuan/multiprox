const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const ROOT = path.resolve(__dirname, "..");
const CLI = path.join(ROOT, "dist", "cli.js");
const TEST_USER = "testuser";

function runNode(args) {
  return spawn("node", [CLI, ...args], {
    cwd: ROOT,
    env: process.env,
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

  const daemon = runNode(["-s", statePath, "--host", "127.0.0.1", "--port", String(port)]);
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
  const daemonExit = new Promise((resolve) => {
    if (daemon.exitCode !== null) {
      resolve(daemon.exitCode);
      return;
    }
    daemon.on("exit", resolve);
  });

  await waitForLog(daemon, /listening on http:\/\/127\.0\.0\.1:/);
  assert.equal(fs.existsSync(pidPath), true);

  const stop = runNode(["stop", "-s", statePath]);
  const stopExit = new Promise((resolve) => {
    if (stop.exitCode !== null) {
      resolve(stop.exitCode);
      return;
    }
    stop.on("exit", resolve);
  });

  const [stopCode, daemonCode] = await Promise.all([stopExit, daemonExit]);
  assert.equal(stopCode, 0);
  assert.equal(daemonCode, 0);
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

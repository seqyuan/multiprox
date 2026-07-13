import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import * as child_process from "child_process";
import { DaemonOptions } from "./options";
import { getDefaultStatePath, getLogPath, getPidPath } from "./paths";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw err;
  }
}

export function readPidFile(pidPath: string): number | null {
  if (!fs.existsSync(pidPath)) return null;
  const raw = fs.readFileSync(pidPath, "utf8").trim();
  const pid = parseInt(raw, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return pid;
}

export function writePidFile(pidPath: string, pid: number): void {
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  fs.writeFileSync(pidPath, `${pid}\n`, "utf8");
}

export function removePidFile(pidPath: string): void {
  try {
    fs.unlinkSync(pidPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function getRunningPid(statePath?: string): number | null {
  const pidPath = getPidPath(statePath);
  const pid = readPidFile(pidPath);
  if (!pid || pid === process.pid || !isProcessRunning(pid)) {
    if (pid) removePidFile(pidPath);
    return null;
  }
  return pid;
}

function getLocalIP(): string {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    const iface = ifaces[name];
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

export function setupDaemonShutdown(server: http.Server, pidPath: string): void {
  let shuttingDown = false;

  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[multiprox] received ${signal}, shutting down`);
    removePidFile(pidPath);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export async function runStop(options: DaemonOptions): Promise<void> {
  const statePath = options.statePath ?? getDefaultStatePath();
  const pidPath = getPidPath(statePath);
  const pid = getRunningPid(statePath);

  if (!pid) {
    console.log("[multiprox] not running");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      removePidFile(pidPath);
      console.log("[multiprox] not running");
      return;
    }
    throw err;
  }

  for (let i = 0; i < 50; i++) {
    if (!isProcessRunning(pid)) {
      removePidFile(pidPath);
      console.log(`[multiprox] stopped (pid ${pid})`);
      return;
    }
    await sleep(100);
  }

  process.kill(pid, "SIGKILL");
  removePidFile(pidPath);
  console.log(`[multiprox] force stopped (pid ${pid})`);
}

export async function runBackground(options: DaemonOptions, cliPath: string): Promise<void> {
  const statePath = options.statePath ?? getDefaultStatePath();
  const pidPath = getPidPath(statePath);
  const logPath = getLogPath(statePath);

  const runningPid = getRunningPid(statePath);
  if (runningPid) {
    console.log(`[multiprox] already running (pid ${runningPid})`);
    console.log(`[multiprox] log: ${logPath}`);
    return;
  }

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const fd = fs.openSync(logPath, "a");

  const args = [cliPath];
  if (options.host) args.push("--host", options.host);
  if (options.port !== undefined) args.push("--port", String(options.port));
  if (options.statePath) args.push("-s", options.statePath);

  const child = child_process.spawn(process.execPath, args, {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, MULTIPROX_BACKGROUND: "1" },
  });

  child.unref();
  fs.closeSync(fd);

  if (!child.pid) {
    throw new Error("failed to start multiprox daemon");
  }

  writePidFile(pidPath, child.pid);
  const host = options.host ?? "0.0.0.0";
  const displayHost = host === "0.0.0.0" || host === "::" ? getLocalIP() : host;
  console.log(`[multiprox] started (pid ${child.pid})`);
  console.log(`[multiprox] listening on http://${displayHost}:${options.port ?? 1907}`);
  console.log(`[multiprox] log: ${logPath}`);
}

export function printStatus(statePath?: string): void {
  const resolved = statePath ?? getDefaultStatePath();
  const pid = getRunningPid(resolved);
  const logPath = getLogPath(resolved);

  if (pid) {
    console.log(`[multiprox] running (pid ${pid})`);
  } else {
    console.log("[multiprox] not running");
  }
  console.log(`[multiprox] log: ${logPath}`);
  if (pid) {
    try {
      const { loadState } = require("./state");
      const state = loadState(resolved);
      const host = state.server.host ?? "0.0.0.0";
      const displayHost = host === "0.0.0.0" || host === "::" ? getLocalIP() : host;
      console.log(`[multiprox] listening on http://${displayHost}:${state.server.port}`);
    } catch {
      // ignore state read errors
    }
  }
}

export function printLogs(statePath?: string, follow = false): void {
  const resolved = statePath ?? getDefaultStatePath();
  const logPath = getLogPath(resolved);

  if (!fs.existsSync(logPath)) {
    console.log("[multiprox] no log file yet");
    return;
  }

  const content = fs.readFileSync(logPath, "utf8");
  const lines = content.split(/\r?\n/);
  const recent = lines.slice(Math.max(0, lines.length - 200));
  console.log(recent.join("\n"));

  if (!follow) return;

  const tail = child_process.spawn(
    process.platform === "win32" ? "powershell.exe" : "tail",
    process.platform === "win32"
      ? ["-NoProfile", "-Command", `Get-Content -Path ${JSON.stringify(logPath)} -Wait -Tail 0`]
      : ["-f", logPath],
    { stdio: "inherit" }
  );
  tail.on("exit", (code) => process.exit(code ?? 0));
}

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { DaemonOptions } from "./options";
import { getDefaultStatePath, getPidPath } from "./paths";

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
  if (!pid || !isProcessRunning(pid)) {
    if (pid) removePidFile(pidPath);
    return null;
  }
  return pid;
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

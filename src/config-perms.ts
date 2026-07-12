import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getDefaultStatePath } from "./paths";
import { getRunningPid } from "./daemon";

/** Default save mode for new configs. */
export const USER_CONFIG_FILE_MODE = 0o644;

/** Shared gateway: config readable + writable by gateway (other users). */
export const SHARED_GATEWAY_CONFIG_FILE_MODE = 0o666;

/** Home / .config dirs: others need traverse (o+x) without listing. */
export const SHARED_GATEWAY_DIR_MODE = 0o711;

export interface PermissionApplyEntry {
  path: string;
  mode: string;
  changed: boolean;
}

export interface PermissionApplyResult {
  applied: PermissionApplyEntry[];
  skipped: string[];
}

export function mapConfigWriteError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM") {
    return "无法写入配置文件，请执行 multiprox passwd 修复权限，或使用 CLI。";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Request failed";
}

function formatMode(mode: number): string {
  return (mode & 0o777).toString(8).padStart(4, "0");
}

function ensureSharedGatewayDirMode(current: number): number {
  const perm = current & 0o777;
  if ((perm & 0o001) !== 0) {
    return perm;
  }
  return SHARED_GATEWAY_DIR_MODE;
}

function chmodDirIfNeeded(targetPath: string): PermissionApplyEntry {
  const stat = fs.statSync(targetPath);
  const current = stat.mode & 0o777;
  const next = ensureSharedGatewayDirMode(current);
  if (current === next) {
    return { path: targetPath, mode: formatMode(current), changed: false };
  }
  fs.chmodSync(targetPath, next);
  return { path: targetPath, mode: formatMode(next), changed: true };
}

function chmodConfigForSharedGateway(targetPath: string): PermissionApplyEntry {
  const stat = fs.statSync(targetPath);
  const current = stat.mode & 0o777;
  if (current === SHARED_GATEWAY_CONFIG_FILE_MODE) {
    return { path: targetPath, mode: formatMode(current), changed: false };
  }
  fs.chmodSync(targetPath, SHARED_GATEWAY_CONFIG_FILE_MODE);
  return {
    path: targetPath,
    mode: formatMode(SHARED_GATEWAY_CONFIG_FILE_MODE),
    changed: true,
  };
}

function resolveExisting(pathname: string): string | null {
  try {
    return fs.realpathSync(pathname);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

function isUnderDir(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function getProcessUid(pid: number): number | null {
  if (process.platform !== "linux") {
    return null;
  }
  try {
    return fs.statSync(`/proc/${pid}`).uid;
  } catch {
    return null;
  }
}

export function getGatewayOperatorUid(statePath: string = getDefaultStatePath()): number | null {
  const pid = getRunningPid(statePath);
  if (pid) {
    const uid = getProcessUid(pid);
    if (uid !== null) {
      return uid;
    }
  }

  try {
    return fs.statSync(statePath).uid;
  } catch {
    return null;
  }
}

export function shouldApplySharedGatewayPermissions(
  configPath: string,
  statePath: string = getDefaultStatePath()
): boolean {
  if (typeof process.getuid !== "function") {
    return false;
  }

  const currentUid = process.getuid();
  const operatorUid = getGatewayOperatorUid(statePath);
  if (operatorUid !== null && operatorUid === currentUid) {
    return false;
  }

  const resolvedConfig = path.resolve(configPath);
  const homeReal = resolveExisting(os.homedir());
  const configReal = resolveExisting(resolvedConfig);
  if (!homeReal || !configReal || !isUnderDir(configReal, homeReal)) {
    return false;
  }

  return true;
}

export function applySharedGatewayPermissions(
  configPath: string,
  homeDir: string = os.homedir(),
  statePath: string = getDefaultStatePath()
): PermissionApplyResult {
  const resolvedConfig = path.resolve(configPath);
  const home = path.resolve(homeDir);
  const homeReal = resolveExisting(home);

  if (!homeReal) {
    throw new Error(`Home directory not found: ${home}`);
  }

  const configReal = resolveExisting(resolvedConfig);
  if (!configReal) {
    throw new Error(`Config file not found: ${resolvedConfig}`);
  }

  if (!isUnderDir(configReal, homeReal)) {
    return {
      applied: [],
      skipped: [
        `config is outside home (${configReal}); shared-gateway permissions not modified`,
      ],
    };
  }

  const configDir = path.dirname(configReal);
  const dotConfig = path.dirname(configDir);

  const targets: Array<{ path: string; kind: "dir" | "file" }> = [
    { path: homeReal, kind: "dir" },
  ];

  if (dotConfig !== homeReal && isUnderDir(dotConfig, homeReal)) {
    const dotConfigReal = resolveExisting(dotConfig);
    if (dotConfigReal) {
      targets.push({ path: dotConfigReal, kind: "dir" });
    }
  }

  if (configDir !== homeReal && isUnderDir(configDir, homeReal)) {
    targets.push({ path: configDir, kind: "dir" });
  }

  targets.push({ path: configReal, kind: "file" });

  const seen = new Set<string>();
  const applied: PermissionApplyEntry[] = [];

  for (const target of targets) {
    if (seen.has(target.path)) {
      continue;
    }
    seen.add(target.path);
    applied.push(
      target.kind === "dir"
        ? chmodDirIfNeeded(target.path)
        : chmodConfigForSharedGateway(target.path)
    );
  }

  return { applied, skipped: [] };
}

import * as os from "os";
import * as path from "path";

export const DEFAULT_SERVER_HOST = "0.0.0.0";
export const DEFAULT_SERVER_PORT = 1907;
export const DEFAULT_SESSION_TTL = 86400;
export const DEFAULT_HOME_PREFIX = process.platform === "darwin" ? "/Users" : "/home";

export const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/i;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null;
  return nums;
}

function isPrivateOrLocalHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (LOCAL_HOSTS.has(lower)) return true;

  const v4 = parseIPv4(lower);
  if (!v4) {
    return lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fd");
  }

  const [a, b] = v4;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

export function slugifyName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "service";
}

export function servicePathFromName(name: string): string {
  return `/${slugifyName(name)}`;
}

export function assertAllowedHost(host: string): void {
  if (!isPrivateOrLocalHost(host)) {
    throw new Error(
      `Backend host must be local or private network (127.0.0.1, 10.x, 172.16-31.x, 192.168.x), got: ${host}`
    );
  }
}

export function getDefaultUserConfigPath(username?: string): string {
  const user = username ?? os.userInfo().username;
  return path.join(getUserHome(user), ".config", "multiprox", "config.yaml");
}

export function getDefaultStatePath(): string {
  const base = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state");
  return path.join(base, "multiprox", "state.yaml");
}

export function getPidPath(statePath?: string): string {
  const resolved = statePath ?? getDefaultStatePath();
  return path.join(path.dirname(resolved), "daemon.pid");
}

export function getLogPath(statePath?: string): string {
  const resolved = statePath ?? getDefaultStatePath();
  return path.join(path.dirname(resolved), "multiprox.log");
}

export function getUserHome(username: string): string {
  if (username === os.userInfo().username) {
    return os.homedir();
  }
  return path.join(DEFAULT_HOME_PREFIX, username);
}

export function getUserConfigPath(username: string, homePrefix?: string): string {
  const home = username === os.userInfo().username
    ? os.homedir()
    : path.join(homePrefix ?? DEFAULT_HOME_PREFIX, username);
  return path.join(home, ".config", "multiprox", "config.yaml");
}

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

export const assertLocalHost = assertAllowedHost;

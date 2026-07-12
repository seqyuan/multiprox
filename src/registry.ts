import * as fs from "fs";
import * as path from "path";
import { StateConfig } from "./state";
import { ServiceConfig, UserConfig, loadUserConfig } from "./user-config";
import { getUserConfigPath, isValidUsername } from "./paths";

export interface ServiceMatch {
  username: string;
  service: ServiceConfig;
  remainingPath: string;
}

export interface LoadedUser {
  username: string;
  configPath: string;
  config: UserConfig;
}

export class UserRegistry {
  private users = new Map<string, LoadedUser>();
  private lastScan = 0;
  private readonly scanIntervalMs: number;

  constructor(
    private state: StateConfig,
    scanIntervalMs = 10000
  ) {
    this.scanIntervalMs = scanIntervalMs;
  }

  reload(): void {
    this.users.clear();

    if (!this.state.users.scan_homes) {
      return;
    }

    const homeRoot = this.state.users.home_prefix;
    if (!fs.existsSync(homeRoot)) {
      return;
    }

    let entries: string[];
    try {
      entries = fs.readdirSync(homeRoot);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!isValidUsername(entry)) {
        continue;
      }

      const configPath = getUserConfigPath(entry, homeRoot);
      if (!fs.existsSync(configPath)) {
        continue;
      }

      try {
        const config = loadUserConfig(configPath);
        this.users.set(entry, { username: entry, configPath, config });
      } catch {
        // skip invalid user configs
      }
    }

    this.lastScan = Date.now();
  }

  ensureFresh(): void {
    if (Date.now() - this.lastScan > this.scanIntervalMs) {
      this.reload();
    }
  }

  getUser(username: string): LoadedUser | null {
    this.ensureFresh();
    return this.users.get(username) ?? null;
  }

  listUsers(): LoadedUser[] {
    this.ensureFresh();
    return [...this.users.values()];
  }

  getUserConfigForLogin(username: string): UserConfig | null {
    if (!isValidUsername(username)) {
      return null;
    }

    const configPath = getUserConfigPath(username, this.state.users.home_prefix);
    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      return loadUserConfig(configPath);
    } catch {
      return null;
    }
  }

  findService(requestPath: string): ServiceMatch | null {
    this.ensureFresh();

    const prefix = "/proxy/";
    if (!requestPath.startsWith(prefix)) {
      return null;
    }

    const rest = requestPath.slice(prefix.length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) {
      return null;
    }

    const username = rest.slice(0, slashIdx);
    if (!isValidUsername(username)) {
      return null;
    }

    const user = this.users.get(username);
    if (!user) {
      return null;
    }

    let pathAfterUser = rest.slice(slashIdx);
    if (pathAfterUser === "") {
      pathAfterUser = "/";
    }

    let bestMatch: ServiceMatch | null = null;
    let bestLen = -1;

    for (const service of user.config.services) {
      const servicePath = service.path;
      if (pathAfterUser === servicePath || pathAfterUser.startsWith(servicePath + "/")) {
        if (servicePath.length > bestLen) {
          bestLen = servicePath.length;
          let remaining = pathAfterUser.slice(servicePath.length);
          if (remaining === "") {
            remaining = "/";
          }
          bestMatch = { username, service, remainingPath: remaining };
        }
      }
    }

    return bestMatch;
  }
}

export function usernameFromProxyPath(requestPath: string): string | null {
  const prefix = "/proxy/";
  if (!requestPath.startsWith(prefix)) {
    return null;
  }
  const rest = requestPath.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) {
    return null;
  }
  const username = rest.slice(0, slashIdx);
  return isValidUsername(username) ? username : null;
}

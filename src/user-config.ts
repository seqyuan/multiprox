import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import yaml from "js-yaml";
import { assertAllowedHost } from "./paths";
import { USER_CONFIG_FILE_MODE } from "./config-perms";

export interface ServiceConfig {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  host: string;
  port: number;
  path: string;
  websocket: boolean;
  category?: string;
  order?: number;
}

export interface UserConfig {
  auth: {
    password_hash: string;
  };
  services: ServiceConfig[];
}

function normalizeServicePath(servicePath: string): string {
  let p = servicePath.trim();
  if (!p.startsWith("/")) {
    p = "/" + p;
  }
  if (p.length > 1 && p.endsWith("/")) {
    p = p.slice(0, -1);
  }
  return p;
}

function validateServices(servicesRaw: unknown, requireNonEmpty = false): ServiceConfig[] {
  if (!Array.isArray(servicesRaw)) {
    throw new Error("services must be an array");
  }
  if (requireNonEmpty && servicesRaw.length === 0) {
    throw new Error("services must be a non-empty array");
  }

  const services: ServiceConfig[] = [];
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();

  for (const item of servicesRaw) {
    if (!item || typeof item !== "object") {
      throw new Error("Each service must be an object");
    }
    const s = item as Record<string, unknown>;

    const id = s.id;
    const name = s.name;
    const serviceHost = s.host;
    const servicePort = s.port;
    const servicePath = s.path;
    const websocket = s.websocket;

    if (typeof id !== "string" || id.length === 0) {
      throw new Error("service.id must be a non-empty string");
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate service id: ${id}`);
    }
    seenIds.add(id);

    const resolvedName = typeof name === "string" && name.length > 0 ? name : id;

    const resolvedHost = typeof serviceHost === "string" && serviceHost.length > 0
      ? serviceHost
      : "127.0.0.1";
    assertAllowedHost(resolvedHost);

    if (typeof servicePort !== "number" || servicePort < 1 || servicePort > 65535) {
      throw new Error(`service.port must be between 1 and 65535 (id: ${id})`);
    }
    if (typeof servicePath !== "string" || servicePath.length === 0) {
      throw new Error(`service.path must be a non-empty string (id: ${id})`);
    }

    const normalizedPath = normalizeServicePath(servicePath);
    if (seenPaths.has(normalizedPath)) {
      throw new Error(`Duplicate service path: ${normalizedPath}`);
    }
    seenPaths.add(normalizedPath);

    services.push({
      id,
      name: resolvedName,
      description: typeof s.description === "string" ? s.description : undefined,
      icon: typeof s.icon === "string" ? s.icon : undefined,
      host: resolvedHost,
      port: servicePort,
      path: normalizedPath,
      websocket: websocket !== false,
      category: typeof s.category === "string" && s.category.trim() ? s.category.trim() : undefined,
      order: typeof s.order === "number" ? s.order : undefined,
    });
  }

  return services;
}

export function groupServicesByCategory(services: ServiceConfig[]): Map<string, ServiceConfig[]> {
  const groups = new Map<string, ServiceConfig[]>();
  for (const s of services) {
    const cat = s.category?.trim() || "未分类";
    const list = groups.get(cat) ?? [];
    list.push(s);
    groups.set(cat, list);
  }

  for (const [cat, list] of groups) {
    list.sort(
      (a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER)
    );
    groups.set(cat, list);
  }

  const minOrder = (items: ServiceConfig[]) =>
    Math.min(...items.map((s) => s.order ?? Number.MAX_SAFE_INTEGER));

  return new Map(
    [...groups.entries()].sort((a, b) => {
      const diff = minOrder(a[1]) - minOrder(b[1]);
      if (diff !== 0) return diff;
      return a[0].localeCompare(b[0], "zh-CN");
    })
  );
}

export function validateUserConfig(raw: unknown, requirePassword = true): UserConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("Config must be a YAML object");
  }

  const cfg = raw as Record<string, unknown>;
  const auth = cfg.auth as Record<string, unknown> | undefined;
  if (!auth) {
    throw new Error("Missing auth section in config");
  }

  const passwordHash = auth.password_hash;
  if (requirePassword) {
    if (typeof passwordHash !== "string" || !/^[a-f0-9]{64}$/i.test(passwordHash)) {
      throw new Error("auth.password_hash must be a 64-character SHA-256 hex string");
    }
  }

  const services = validateServices(cfg.services ?? [], false);

  return {
    auth: {
      password_hash: typeof passwordHash === "string"
        ? passwordHash.toLowerCase()
        : "0000000000000000000000000000000000000000000000000000000000000000",
    },
    services,
  };
}

export function loadUserConfig(configPath: string, requirePassword = true): UserConfig {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  const content = fs.readFileSync(resolved, "utf8");
  const parsed = yaml.load(content);
  return validateUserConfig(parsed, requirePassword);
}

function loadRawConfig(configPath: string): Record<string, unknown> {
  const resolved = path.resolve(configPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, "utf8");
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config must be a YAML object");
  }
  return parsed as Record<string, unknown>;
}

function saveRawConfig(configPath: string, raw: Record<string, unknown>): void {
  const resolved = path.resolve(configPath);
  const existed = fs.existsSync(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const content = yaml.dump(raw, { lineWidth: -1, noRefs: true });

  if (existed) {
    fs.writeFileSync(resolved, content, "utf8");
    return;
  }

  fs.writeFileSync(resolved, content, { mode: USER_CONFIG_FILE_MODE });
  try {
    fs.chmodSync(resolved, USER_CONFIG_FILE_MODE);
  } catch {
    // ignore on platforms without chmod
  }
}

export function ensureUserConfigExists(configPath: string): void {
  const resolved = path.resolve(configPath);
  if (fs.existsSync(resolved)) {
    return;
  }

  const template: Record<string, unknown> = {
    auth: {
      password_hash: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    services: [],
  };

  saveRawConfig(resolved, template);
  console.log(`[multiprox] created user config: ${resolved}`);
  console.log(`[multiprox] run "multiprox passwd" to set your login password`);
}

export function updatePasswordHash(configPath: string, passwordHash: string): void {
  const raw = loadRawConfig(configPath);
  const auth = (raw.auth as Record<string, unknown> | undefined) ?? {};
  auth.password_hash = passwordHash;
  raw.auth = auth;
  if (!raw.services) {
    raw.services = [];
  }
  saveRawConfig(configPath, raw);
}

function getConfigLockPath(configPath: string): string {
  const resolved = path.resolve(configPath);
  const hash = crypto.createHash("sha256").update(resolved).digest("hex");
  const lockDir = path.join(os.tmpdir(), "multiprox-locks");
  return path.join(lockDir, `${hash}.lock`);
}

export function withConfigLock<T>(configPath: string, fn: () => T): T {
  const resolved = path.resolve(configPath);
  const lockPath = getConfigLockPath(resolved);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });

  const start = Date.now();
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") {
        throw err;
      }
      if (Date.now() - start > 5000) {
        throw new Error(`Config lock timeout: ${lockPath}`);
      }
      const waitUntil = Date.now() + 50;
      while (Date.now() < waitUntil) {
        // spin briefly
      }
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

export function saveUserConfig(configPath: string, config: UserConfig): void {
  withConfigLock(configPath, () => {
    validateUserConfig(config, true);
    saveRawConfig(configPath, {
      auth: { password_hash: config.auth.password_hash },
      services: config.services,
    });
  });
}

export interface AddServiceInput {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  host?: string;
  port: number;
  path: string;
  websocket?: boolean;
  category?: string;
}

export interface ServiceLayoutItem {
  id: string;
  order: number;
  category?: string;
}

function nextServiceOrder(services: ServiceConfig[]): number {
  const max = services.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
  return max + 1;
}

export function addService(configPath: string, input: AddServiceInput): void {
  withConfigLock(configPath, () => {
    ensureUserConfigExists(configPath);
    const config = loadUserConfig(configPath);
    if (config.services.some((s) => s.id === input.id)) {
      throw new Error(`Service already exists: ${input.id}`);
    }

    const host = input.host ?? "127.0.0.1";
    assertAllowedHost(host);

    const newService: ServiceConfig = {
      id: input.id,
      name: input.name ?? input.id,
      description: input.description,
      icon: input.icon,
      host,
      port: input.port,
      path: normalizeServicePath(input.path),
      websocket: input.websocket !== false,
      category: input.category?.trim() || undefined,
      order: nextServiceOrder(config.services),
    };

    validateServices([...config.services, newService]);
    config.services.push(newService);
    saveRawConfig(configPath, {
      auth: { password_hash: config.auth.password_hash },
      services: config.services,
    });
  });
}

export function updateServicesLayout(configPath: string, items: ServiceLayoutItem[]): void {
  withConfigLock(configPath, () => {
    const config = loadUserConfig(configPath);

    if (items.length !== config.services.length) {
      throw new Error("Layout must include every service");
    }

    const byId = new Map(config.services.map((s) => [s.id, s]));
    const seen = new Set<string>();

    for (const item of items) {
      if (seen.has(item.id)) {
        throw new Error(`Duplicate service in layout: ${item.id}`);
      }
      seen.add(item.id);

      const svc = byId.get(item.id);
      if (!svc) {
        throw new Error(`Service not found: ${item.id}`);
      }
      svc.order = item.order;
      svc.category = item.category?.trim() || undefined;
    }

    saveRawConfig(configPath, {
      auth: { password_hash: config.auth.password_hash },
      services: config.services,
    });
  });
}

export function removeService(configPath: string, id: string): void {
  withConfigLock(configPath, () => {
    const config = loadUserConfig(configPath);
    const next = config.services.filter((s) => s.id !== id);
    if (next.length === config.services.length) {
      throw new Error(`Service not found: ${id}`);
    }
    config.services = next;
    saveRawConfig(configPath, {
      auth: { password_hash: config.auth.password_hash },
      services: config.services,
    });
  });
}

export interface UpdateServiceInput {
  name?: string;
  description?: string;
  host?: string;
  port?: number;
  websocket?: boolean;
  category?: string;
}

export function updateService(configPath: string, id: string, input: UpdateServiceInput): void {
  withConfigLock(configPath, () => {
    const config = loadUserConfig(configPath);
    const svc = config.services.find((s) => s.id === id);
    if (!svc) {
      throw new Error(`Service not found: ${id}`);
    }

    if (input.name !== undefined && input.name.trim().length > 0) {
      svc.name = input.name.trim();
    }
    if (input.description !== undefined) {
      svc.description = input.description.trim() || undefined;
    }
    if (input.host !== undefined && input.host.trim().length > 0) {
      assertAllowedHost(input.host.trim());
      svc.host = input.host.trim();
    }
    if (input.port !== undefined) {
      if (!Number.isFinite(input.port) || input.port < 1 || input.port > 65535) {
        throw new Error("port must be between 1 and 65535");
      }
      svc.port = input.port;
    }
    if (input.websocket !== undefined) {
      svc.websocket = input.websocket;
    }
    if (input.category !== undefined) {
      svc.category = input.category.trim() || undefined;
    }

    saveRawConfig(configPath, {
      auth: { password_hash: config.auth.password_hash },
      services: config.services,
    });
  });
}

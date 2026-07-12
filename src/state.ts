import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import yaml from "js-yaml";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  DEFAULT_SESSION_TTL,
  DEFAULT_HOME_PREFIX,
  getDefaultStatePath,
} from "./paths";

export interface StateConfig {
  server: {
    host: string;
    port: number;
  };
  auth: {
    session_secret: string;
    session_ttl: number;
  };
  users: {
    home_prefix: string;
    scan_homes: boolean;
  };
}

function validateState(raw: unknown): StateConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("State must be a YAML object");
  }

  const cfg = raw as Record<string, unknown>;
  const server = (cfg.server as Record<string, unknown> | undefined) ?? {};
  const auth = (cfg.auth as Record<string, unknown> | undefined) ?? {};
  const users = (cfg.users as Record<string, unknown> | undefined) ?? {};

  const host = typeof server.host === "string" && server.host.length > 0
    ? server.host
    : DEFAULT_SERVER_HOST;
  const port = typeof server.port === "number" && server.port >= 1 && server.port <= 65535
    ? server.port
    : DEFAULT_SERVER_PORT;

  let sessionSecret = typeof auth.session_secret === "string" ? auth.session_secret : "";
  if (sessionSecret.length === 0) {
    sessionSecret = crypto.randomBytes(32).toString("hex");
  }

  const sessionTtl = typeof auth.session_ttl === "number" && auth.session_ttl > 0
    ? auth.session_ttl
    : DEFAULT_SESSION_TTL;

  const homePrefix = typeof users.home_prefix === "string" && users.home_prefix.length > 0
    ? users.home_prefix
    : DEFAULT_HOME_PREFIX;

  const scanHomes = users.scan_homes !== false;

  return {
    server: { host, port },
    auth: { session_secret: sessionSecret, session_ttl: sessionTtl },
    users: { home_prefix: homePrefix, scan_homes: scanHomes },
  };
}

function defaultStateRaw(): Record<string, unknown> {
  return {
    server: { host: DEFAULT_SERVER_HOST, port: DEFAULT_SERVER_PORT },
    auth: { session_secret: "", session_ttl: DEFAULT_SESSION_TTL },
    users: { home_prefix: DEFAULT_HOME_PREFIX, scan_homes: true },
  };
}

export function ensureStateExists(statePath: string): void {
  const resolved = statePath;
  if (fs.existsSync(resolved)) {
    return;
  }

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(
    resolved,
    yaml.dump(defaultStateRaw(), { lineWidth: -1, noRefs: true }),
    "utf8"
  );
  console.log(`[multiprox] created daemon state: ${resolved}`);
}

export function loadState(statePath: string): StateConfig {
  ensureStateExists(statePath);
  const content = fs.readFileSync(statePath, "utf8");
  const parsed = yaml.load(content);
  const state = validateState(parsed);

  const raw = parsed as Record<string, unknown>;
  const auth = (raw.auth as Record<string, unknown> | undefined) ?? {};
  if (typeof auth.session_secret !== "string" || auth.session_secret.length === 0) {
    auth.session_secret = state.auth.session_secret;
    raw.auth = auth;
    fs.writeFileSync(
      statePath,
      yaml.dump(raw, { lineWidth: -1, noRefs: true }),
      "utf8"
    );
    console.log(`[multiprox] persisted generated session_secret to ${statePath}`);
  }

  return state;
}

export function applyStateOverrides(
  state: StateConfig,
  overrides: { host?: string; port?: number }
): StateConfig {
  return {
    ...state,
    server: {
      host: overrides.host ?? state.server.host,
      port: overrides.port ?? state.server.port,
    },
  };
}

export { getDefaultStatePath };

import * as fs from "fs";
import { IncomingMessage, ServerResponse } from "http";
import { UserRegistry } from "./registry";
import { getSessionFromCookies } from "./auth";
import {
  addService,
  removeService,
  updateService,
  updateServicesLayout,
  ServiceConfig,
  ServiceLayoutItem,
} from "./user-config";
import { slugifyName, servicePathFromName, assertAllowedHost } from "./paths";
import { readBody } from "./http-body";
import { mapConfigWriteError } from "./config-perms";

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function requireSession(
  req: IncomingMessage,
  res: ServerResponse,
  sessionSecret: string
): string | null {
  const session = getSessionFromCookies(req.headers.cookie, sessionSecret);
  if (!session.valid || !session.userId) {
    sendJson(res, 401, { error: "Unauthorized" });
    return null;
  }
  return session.userId;
}

function getConfigPath(registry: UserRegistry, username: string): string | null {
  return registry.getUser(username)?.configPath ?? null;
}

function canWriteConfig(configPath: string): boolean {
  try {
    fs.accessSync(configPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function rejectNotWritable(res: ServerResponse): void {
  sendJson(res, 403, {
    error: "Config is not writable by the gateway. Run multiprox passwd or use CLI.",
  });
}

function parsePort(raw: unknown): number {
  const port = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error("Invalid port");
  }
  return port;
}

function parseAddBody(raw: unknown): {
  name: string;
  description?: string;
  host: string;
  port: number;
  websocket: boolean;
  category?: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON body");
  }
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    throw new Error("name is required");
  }

  const host = typeof body.host === "string" && body.host.trim() ? body.host.trim() : "127.0.0.1";
  assertAllowedHost(host);

  return {
    name,
    description:
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : undefined,
    host,
    port: parsePort(body.port),
    websocket: body.websocket === true,
    category:
      typeof body.category === "string" && body.category.trim()
        ? body.category.trim()
        : undefined,
  };
}

function parseLayoutBody(raw: unknown): ServiceLayoutItem[] {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON body");
  }
  const body = raw as Record<string, unknown>;
  if (!Array.isArray(body.items)) {
    throw new Error("items array is required");
  }

  return body.items.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Invalid layout item at index ${index}`);
    }
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      throw new Error(`Layout item id is required at index ${index}`);
    }
    const order = typeof row.order === "number" ? row.order : parseInt(String(row.order ?? ""), 10);
    if (!Number.isFinite(order) || order < 0) {
      throw new Error(`Invalid order for ${id}`);
    }
    return {
      id,
      order,
      category:
        typeof row.category === "string" && row.category.trim()
          ? row.category.trim()
          : undefined,
    };
  });
}

async function handleAddService(
  req: IncomingMessage,
  res: ServerResponse,
  registry: UserRegistry,
  username: string
): Promise<void> {
  const configPath = getConfigPath(registry, username);
  if (!configPath) {
    sendJson(res, 404, { error: "User config not found" });
    return;
  }
  if (!canWriteConfig(configPath)) {
    rejectNotWritable(res);
    return;
  }

  try {
    const body = parseAddBody(JSON.parse(await readBody(req)));
    const id = slugifyName(body.name);
    addService(configPath, {
      id,
      name: body.name,
      description: body.description,
      host: body.host,
      port: body.port,
      path: servicePathFromName(body.name),
      websocket: body.websocket,
      category: body.category,
    });
    registry.reload();
    const user = registry.getUser(username);
    const created = user?.config.services.find((s) => s.id === id);
    sendJson(res, 201, { service: created });
  } catch (err) {
    sendJson(res, 400, { error: mapConfigWriteError(err) });
  }
}

async function handleUpdateLayout(
  req: IncomingMessage,
  res: ServerResponse,
  registry: UserRegistry,
  username: string
): Promise<void> {
  const configPath = getConfigPath(registry, username);
  if (!configPath) {
    sendJson(res, 404, { error: "User config not found" });
    return;
  }
  if (!canWriteConfig(configPath)) {
    rejectNotWritable(res);
    return;
  }

  try {
    const items = parseLayoutBody(JSON.parse(await readBody(req)));
    updateServicesLayout(configPath, items);
    registry.reload();
    const user = registry.getUser(username);
    sendJson(res, 200, { services: user?.config.services ?? [] });
  } catch (err) {
    sendJson(res, 400, { error: mapConfigWriteError(err) });
  }
}

function parseUpdateBody(raw: unknown): {
  name?: string;
  description?: string;
  host?: string;
  port?: number;
  websocket?: boolean;
  category?: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid JSON body");
  }
  const body = raw as Record<string, unknown>;

  const result: ReturnType<typeof parseUpdateBody> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    result.name = body.name.trim();
  }
  if (typeof body.description === "string") {
    result.description = body.description.trim();
  }
  if (typeof body.host === "string" && body.host.trim()) {
    assertAllowedHost(body.host.trim());
    result.host = body.host.trim();
  }
  if (typeof body.port === "number" || typeof body.port === "string") {
    result.port = parsePort(body.port);
  }
  if (typeof body.websocket === "boolean") {
    result.websocket = body.websocket;
  }
  if (typeof body.category === "string") {
    result.category = body.category.trim() || undefined;
  }

  return result;
}

async function handleUpdateService(
  req: IncomingMessage,
  res: ServerResponse,
  registry: UserRegistry,
  username: string,
  serviceId: string
): Promise<void> {
  const configPath = getConfigPath(registry, username);
  if (!configPath) {
    sendJson(res, 404, { error: "User config not found" });
    return;
  }
  if (!canWriteConfig(configPath)) {
    rejectNotWritable(res);
    return;
  }

  try {
    const body = parseUpdateBody(JSON.parse(await readBody(req)));
    updateService(configPath, serviceId, body);
    registry.reload();
    const user = registry.getUser(username);
    const updated = user?.config.services.find((s) => s.id === serviceId);
    sendJson(res, 200, { service: updated });
  } catch (err) {
    sendJson(res, 400, { error: mapConfigWriteError(err) });
  }
}

function handleDeleteService(
  res: ServerResponse,
  registry: UserRegistry,
  username: string,
  serviceId: string
): void {
  const configPath = getConfigPath(registry, username);
  if (!configPath) {
    sendJson(res, 404, { error: "User config not found" });
    return;
  }
  if (!canWriteConfig(configPath)) {
    rejectNotWritable(res);
    return;
  }

  try {
    removeService(configPath, serviceId);
    registry.reload();
    sendJson(res, 200, { ok: true });
  } catch (err) {
    sendJson(res, 400, { error: mapConfigWriteError(err) });
  }
}

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  registry: UserRegistry,
  sessionSecret: string
): Promise<boolean> {
  if (!pathname.startsWith("/api/")) {
    return false;
  }

  const username = requireSession(req, res, sessionSecret);
  if (!username) {
    return true;
  }

  if (pathname === "/api/services" && req.method === "GET") {
    const user = registry.getUser(username);
    const services: ServiceConfig[] = user?.config.services ?? [];
    const writable = user ? canWriteConfig(user.configPath) : false;
    sendJson(res, 200, { services, writable });
    return true;
  }

  if (pathname === "/api/services" && req.method === "POST") {
    await handleAddService(req, res, registry, username);
    return true;
  }

  if (pathname === "/api/services/layout" && req.method === "PUT") {
    await handleUpdateLayout(req, res, registry, username);
    return true;
  }

  const serviceIdMatch = pathname.match(/^\/api\/services\/([^/]+)$/);
  if (serviceIdMatch && req.method === "DELETE") {
    handleDeleteService(res, registry, username, decodeURIComponent(serviceIdMatch[1]));
    return true;
  }
  if (serviceIdMatch && req.method === "PUT") {
    await handleUpdateService(req, res, registry, username, decodeURIComponent(serviceIdMatch[1]));
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

import { IncomingMessage, ServerResponse } from "http";
import { UserRegistry } from "./registry";
import { getSessionFromCookies } from "./auth";
import { ServiceConfig } from "./user-config";

const READ_ONLY_HINT =
  "Web dashboard is read-only. Use CLI: multiprox add / remove / layout";

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
    sendJson(res, 200, { services });
    return true;
  }

  if (
    (pathname === "/api/services" && req.method === "POST") ||
    (pathname === "/api/services/layout" && req.method === "PUT") ||
    (pathname.match(/^\/api\/services\/[^/]+$/) && req.method === "DELETE")
  ) {
    sendJson(res, 405, { error: READ_ONLY_HINT });
    return true;
  }

  sendJson(res, 404, { error: "Not found" });
  return true;
}

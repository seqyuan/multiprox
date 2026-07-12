import * as http from "http";
import * as net from "net";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { ServiceConfig } from "./user-config";
import { isSecureRequest } from "./auth";
import { clientIp } from "./http-body";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
]);

export interface ProxyForwardContext {
  prefix: string;
  clientIp: string;
  proto: "http" | "https";
  host: string;
}

export function buildProxyForwardContext(
  req: IncomingMessage,
  username: string,
  servicePath: string
): ProxyForwardContext {
  const hostHeader = req.headers.host;
  return {
    prefix: `/proxy/${username}${servicePath}`,
    clientIp: clientIp(req),
    proto: isSecureRequest(req) ? "https" : "http",
    host: typeof hostHeader === "string" && hostHeader.length > 0 ? hostHeader : "localhost",
  };
}

export function buildForwardedHeaderValues(
  forward: ProxyForwardContext,
  existingForwardedFor?: string
): Record<string, string> {
  const xForwardedFor = existingForwardedFor
    ? `${existingForwardedFor}, ${forward.clientIp}`
    : forward.clientIp;

  return {
    "x-forwarded-for": xForwardedFor,
    "x-forwarded-proto": forward.proto,
    "x-forwarded-host": forward.host,
    "x-forwarded-prefix": forward.prefix,
  };
}

function copyHeadersToOutgoing(
  source: IncomingMessage,
  target: http.OutgoingHttpHeaders
): void {
  for (const [key, value] of Object.entries(source.headers)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    target[key] = value;
  }
}

function applyForwardedHeaders(
  headers: http.OutgoingHttpHeaders,
  req: IncomingMessage,
  forward: ProxyForwardContext
): void {
  const existing = req.headers["x-forwarded-for"];
  const prior = typeof existing === "string" ? existing : undefined;
  const values = buildForwardedHeaderValues(forward, prior);

  for (const [key, value] of Object.entries(values)) {
    headers[key] = value;
  }
}

export function proxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  service: ServiceConfig,
  proxiedPath: string,
  forward: ProxyForwardContext
): void {
  const options: http.RequestOptions = {
    hostname: service.host,
    port: service.port,
    path: proxiedPath,
    method: req.method,
    headers: {},
  };

  const headers = options.headers as http.OutgoingHttpHeaders;
  copyHeadersToOutgoing(req, headers);

  delete headers.connection;
  delete headers["proxy-connection"];
  applyForwardedHeaders(headers, req, forward);
  headers.host = `${service.host}:${service.port}`;

  const proxyReq = http.request(options, (proxyRes) => {
    const resHeaders = { ...proxyRes.headers };
    delete resHeaders["transfer-encoding"];
    res.writeHead(proxyRes.statusCode ?? 502, resHeaders);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad Gateway");
    } else {
      res.end();
    }
  });

  req.pipe(proxyReq);
}

export function proxyWebSocket(
  req: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  service: ServiceConfig,
  proxiedPath: string,
  forward: ProxyForwardContext
): void {
  const forwarded = buildForwardedHeaderValues(
    forward,
    typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"] : undefined
  );

  const backendSocket = net.connect(service.port, service.host, () => {
    const lines: string[] = [];
    lines.push(`${req.method} ${proxiedPath} HTTP/1.1`);

    const headerLines: string[] = [];
    for (const [key, value] of Object.entries(req.headers)) {
      if (!value) continue;
      const lower = key.toLowerCase();
      if (lower === "host") continue;
      if (HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (lower.startsWith("x-forwarded-")) continue;
      if (Array.isArray(value)) {
        for (const v of value) {
          headerLines.push(`${key}: ${v}`);
        }
      } else {
        headerLines.push(`${key}: ${value}`);
      }
    }

    for (const [key, value] of Object.entries(forwarded)) {
      headerLines.push(`${key}: ${value}`);
    }

    headerLines.push(`Host: ${service.host}:${service.port}`);
    lines.push(...headerLines);
    lines.push("", "");

    backendSocket.write(lines.join("\r\n"));
    if (head.length > 0) {
      backendSocket.write(head);
    }
  });

  const destroyBoth = () => {
    if (!clientSocket.destroyed) clientSocket.destroy();
    if (!backendSocket.destroyed) backendSocket.destroy();
  };

  clientSocket.on("error", destroyBoth);
  backendSocket.on("error", destroyBoth);
  clientSocket.on("close", () => {
    if (!backendSocket.destroyed) backendSocket.end();
  });
  backendSocket.on("close", () => {
    if (!clientSocket.destroyed) clientSocket.end();
  });

  clientSocket.pipe(backendSocket);
  backendSocket.pipe(clientSocket);
}

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

export function proxyWebSocket(
  req: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  service: ServiceConfig,
  proxiedPath: string
): void {
  const targetHost = service.host;
  const targetPort = service.port;

  const backendSocket = net.connect(targetPort, targetHost, () => {
    const reqLine = `${req.method} ${proxiedPath} HTTP/${req.httpVersion}\r\n`;

    const headers: string[] = [];
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (k === "host") {
        headers.push(`host: ${targetHost}:${targetPort}`);
      } else if (k !== "connection" && k !== "proxy-connection" && k !== "upgrade-insecure-requests") {
        if (Array.isArray(value)) {
          for (const v of value) headers.push(`${key}: ${v}`);
        } else if (value !== undefined) {
          headers.push(`${key}: ${value}`);
        }
      }
    }

    backendSocket.write(reqLine + headers.join("\r\n") + "\r\n\r\n");
    if (head.length > 0) {
      backendSocket.write(head);
    }
  });

  backendSocket.on("data", (data: Buffer) => {
    clientSocket.write(data);
  });

  clientSocket.on("data", (data: Buffer) => {
    backendSocket.write(data);
  });

  backendSocket.on("error", () => {
    clientSocket.destroy();
  });

  clientSocket.on("error", () => {
    backendSocket.destroy();
  });

  backendSocket.on("close", () => {
    clientSocket.end();
  });

  clientSocket.on("close", () => {
    backendSocket.end();
  });
}

export interface ProxyForwardContext {
  prefix: string;
  clientIp: string;
  proto: "http" | "https";
  host: string;
}

export function buildProxyForwardContext(
  req: IncomingMessage,
  username: string,
  servicePath: string,
  legacy = false
): ProxyForwardContext {
  const hostHeader = req.headers.host;
  return {
    prefix: legacy ? `/proxy${servicePath}` : `/proxy/${username}${servicePath}`,
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

    // Rewrite redirect Location: bare path → proxy-prefixed path
    const status = proxyRes.statusCode ?? 502;
    if (
      status >= 300 && status < 400 &&
      typeof resHeaders["location"] === "string"
    ) {
      const loc = resHeaders["location"] as string;
      if (loc.startsWith("/") && !loc.startsWith("/proxy/")) {
        resHeaders["location"] = forward.prefix + loc;
      }
    }

    res.writeHead(status, resHeaders);
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

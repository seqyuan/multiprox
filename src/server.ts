import * as fs from "fs";
import * as http from "http";
import { IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { loadState, applyStateOverrides, persistServerConfig, getDefaultStatePath, StateConfig } from "./state";
import { getPidPath } from "./paths";
import { getRunningPid, setupDaemonShutdown, writePidFile, removePidFile } from "./daemon";
import { UserRegistry, usernameFromProxyPath } from "./registry";
import {
  verifyPassword,
  getSessionFromCookies,
  setSessionCookie,
  clearSessionCookie,
  isSecureRequest,
} from "./auth";
import { proxyHttp, proxyWebSocket, buildProxyForwardContext } from "./proxy";
import { loginPage, dashboardPage, notFoundPage, FAVICON_SVG } from "./templates";
import { handleApi } from "./api";
import { DaemonOptions } from "./options";
import { isValidUsername } from "./paths";
import { readBody, clientIp } from "./http-body";
import { RateLimiter } from "./rate-limit";

const LOGIN_ERROR = "用户名或密码错误";
const LOGIN_RATE_LIMIT = new RateLimiter(10, 15 * 60 * 1000);

function getSession(req: IncomingMessage, sessionSecret: string) {
  return getSessionFromCookies(req.headers.cookie, sessionSecret);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function createHandler(
  registry: UserRegistry,
  state: StateConfig,
  sessionSecret: string,
  sessionTtl: number
) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (await handleApi(req, res, pathname, registry, sessionSecret)) {
      return;
    }

    if (req.method === "GET" && pathname === "/favicon.ico") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(FAVICON_SVG);
      return;
    }

    if (req.method === "GET" && pathname === "/logout") {
      res.writeHead(302, {
        Location: "/",
        "Set-Cookie": clearSessionCookie(),
      });
      res.end();
      return;
    }

    if (req.method === "POST" && pathname === "/login") {
      try {
        const ip = clientIp(req);
        const rateKey = `${ip}`;

        if (LOGIN_RATE_LIMIT.isBlocked(rateKey)) {
          sendHtml(res, 429, loginPage("登录尝试过多，请 15 分钟后再试"));
          return;
        }

        const body = await readBody(req);
        const params = new URLSearchParams(body);
        const username = (params.get("username") ?? "").trim();
        const password = params.get("password") ?? "";

        let ok = false;
        if (isValidUsername(username) && password.length > 0) {
          const userConfig = registry.getUserConfigForLogin(username);
          if (userConfig && verifyPassword(password, userConfig.auth.password_hash)) {
            ok = true;
          }
        }

        if (ok) {
          LOGIN_RATE_LIMIT.reset(rateKey);
          res.writeHead(302, {
            Location: "/",
            "Set-Cookie": setSessionCookie(
              sessionSecret,
              sessionTtl,
              username,
              isSecureRequest(req)
            ),
          });
          res.end();
        } else {
          LOGIN_RATE_LIMIT.recordFailure(rateKey);
          sendHtml(res, 401, loginPage(LOGIN_ERROR));
        }
      } catch {
        sendHtml(res, 500, loginPage("登录请求处理失败"));
      }
      return;
    }

    if (pathname.startsWith("/proxy/")) {
      const session = getSession(req, sessionSecret);
      if (!session.valid || !session.userId) {
        res.writeHead(302, { Location: "/" });
        res.end();
        return;
      }

      const multiMatch = registry.findService(pathname);
      if (multiMatch) {
        const pathUser = usernameFromProxyPath(pathname);
        if (!pathUser || pathUser !== session.userId) {
          sendHtml(res, 403, notFoundPage());
          return;
        }
      }

      const match =
        multiMatch ?? registry.findLegacyService(pathname, session.userId);
      if (!match) {
        sendHtml(res, 404, notFoundPage());
        return;
      }

      const query = url.search || "";
      const proxiedPath = match.remainingPath + query;
      const forward = buildProxyForwardContext(
        req,
        match.username,
        match.service.path,
        match.legacy
      );
      proxyHttp(req, res, match.service, proxiedPath, forward);
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      const session = getSession(req, sessionSecret);
      if (session.valid && session.userId) {
        const user = registry.getUser(session.userId);
        const services = user?.config.services ?? [];
        let writable = false;
        if (user) {
          try {
            fs.accessSync(user.configPath, fs.constants.W_OK);
            writable = true;
          } catch {
            writable = false;
          }
        }
        sendHtml(res, 200, dashboardPage(session.userId, services, writable));
      } else {
        sendHtml(res, 200, loginPage());
      }
      return;
    }

    sendHtml(res, 404, notFoundPage());
  };
}

function createUpgradeHandler(registry: UserRegistry, sessionSecret: string) {
  return (req: IncomingMessage, socket: Socket, head: Buffer): void => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = url.pathname;

    if (!pathname.startsWith("/proxy/")) {
      socket.destroy();
      return;
    }

    const session = getSession(req, sessionSecret);
    if (!session.valid || !session.userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const multiMatch = registry.findService(pathname);
    if (multiMatch) {
      const pathUser = usernameFromProxyPath(pathname);
      if (!pathUser || pathUser !== session.userId) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    const match =
      multiMatch ?? registry.findLegacyService(pathname, session.userId);
    if (!match) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!match.service.websocket) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    const query = url.search || "";
    const proxiedPath = match.remainingPath + query;
    proxyWebSocket(req, socket, head, match.service, proxiedPath);
  };
}

export async function runServer(options: DaemonOptions): Promise<void> {
  const statePath = options.statePath ?? getDefaultStatePath();
  persistServerConfig(statePath, options.host, options.port);

  const runningPid = getRunningPid(statePath);
  if (runningPid) {
    throw new Error(
      `multiprox is already running (pid ${runningPid}); stop it first: multiprox stop`
    );
  }

  let state = loadState(statePath);
  state = applyStateOverrides(state, {
    host: options.host,
    port: options.port,
  });

  const registry = new UserRegistry(state);
  registry.reload();

  const handler = createHandler(registry, state, state.auth.session_secret, state.auth.session_ttl);
  const upgradeHandler = createUpgradeHandler(registry, state.auth.session_secret);

  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
      }
    });
  });

  server.on("upgrade", upgradeHandler);

  const scanTimer = setInterval(() => registry.reload(), 10000);

  const pidPath = getPidPath(statePath);

  await new Promise<void>((resolve, reject) => {
    server.listen(state.server.port, state.server.host, () => {
      writePidFile(pidPath, process.pid);
      setupDaemonShutdown(server, pidPath);
      console.log(
        `[multiprox] listening on http://${state.server.host}:${state.server.port}`
      );
      console.log(`[multiprox] state: ${statePath}`);
      console.log(`[multiprox] scanning ${state.users.home_prefix}/*/.config/multiprox/config.yaml`);
      console.log(`[multiprox] ${registry.listUsers().length} user(s) loaded`);
      resolve();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${state.server.port} is already in use; if multiprox is running, try: multiprox stop`
          )
        );
        return;
      }
      reject(err);
    });
  });

  server.on("close", () => {
    clearInterval(scanTimer);
    removePidFile(pidPath);
  });
}

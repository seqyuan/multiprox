#!/usr/bin/env node

import * as path from "path";
import { runServer } from "./server";
import { runStop } from "./daemon";
import { runPasswd } from "./passwd";
import { runAdd, runList, runRemove } from "./services-cli";
import { runLayout } from "./layout-cli";
import { getDefaultStatePath } from "./paths";
import { DaemonOptions } from "./options";
import pkg from "../package.json";

const VERSION = pkg.version;

type Command = "serve" | "stop" | "passwd" | "add" | "list" | "remove" | "layout";

function printHelp(): void {
  console.log(`MultiProx v${VERSION} — 多服务认证反向代理入口（共享网关）

用法:
  multiprox [选项]                         启动共享网关 daemon
  multiprox stop [选项]                    停止后台运行的 daemon
  multiprox passwd [选项]                  设置密码并修复共享网关目录权限
  multiprox add [选项]                         交互式添加端口转发
  multiprox list [选项]                    列出当前用户转发
  multiprox remove <name> [选项]           删除转发
  multiprox layout [选项]                  终端交互式排序与分类

Daemon 选项:
  -s, --state <path>    daemon 状态文件 (默认: ~/.local/state/multiprox/state.yaml)
  --host <host>         监听地址 (默认: 0.0.0.0)
  --port <port>         监听端口 (默认: 1907)
  -h, --help            显示帮助

用户命令选项:
  -c, --config <path>   用户配置文件 (默认: ~/.config/multiprox/config.yaml)

说明:
  multiprox add 为纯交互式，逐项填写名称、端口、分类等

示例:
  multiprox
  multiprox --port 1908
  multiprox stop
  multiprox passwd
  multiprox add
  multiprox layout
  multiprox list
  multiprox remove jupyter
`);
}

function parsePort(value: string): number {
  const port = parseInt(value, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

const COMMANDS = new Set<Command>(["stop", "passwd", "add", "list", "remove", "layout"]);

function findCommand(argv: string[]): { command: Command; rest: string[] } {
  for (let i = 0; i < argv.length; i++) {
    if (COMMANDS.has(argv[i] as Command)) {
      return {
        command: argv[i] as Command,
        rest: [...argv.slice(0, i), ...argv.slice(i + 1)],
      };
    }
  }
  return { command: "serve", rest: argv };
}

export function parseArgv(argv: string[]): {
  command: Command;
  daemon: DaemonOptions;
  userConfigPath?: string;
  positional: string[];
} {
  const { command, rest } = findCommand(argv);

  let statePath = getDefaultStatePath();
  let userConfigPath: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let help = false;
  const positional: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "-h" || arg === "--help") {
      help = true;
      continue;
    }

    if (arg === "-c" || arg === "--config") {
      const next = rest[++i];
      if (!next) throw new Error("Missing value for --config");
      userConfigPath = path.resolve(next);
      continue;
    }

    if (arg === "-s" || arg === "--state") {
      const next = rest[++i];
      if (!next) throw new Error("Missing value for --state");
      statePath = path.resolve(next);
      continue;
    }

    if (command === "serve") {
      if (arg === "--host") {
        const next = rest[++i];
        if (!next) throw new Error("Missing value for --host");
        host = next;
      } else if (arg === "--port") {
        const next = rest[++i];
        if (!next) throw new Error("Missing value for --port");
        port = parsePort(next);
      } else if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}`);
      } else {
        throw new Error(`Unexpected argument: ${arg}`);
      }
      continue;
    }

    if (command === "add") {
      if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}`);
      }
      throw new Error("multiprox add is interactive only; run: multiprox add");
    }

    positional.push(arg);
  }

  return {
    command,
    daemon: { statePath, host, port, help },
    userConfigPath,
    positional,
  };
}

async function main(): Promise<void> {
  const { command, daemon, userConfigPath, positional } = parseArgv(process.argv.slice(2));

  if (daemon.help) {
    printHelp();
    return;
  }

  switch (command) {
    case "passwd":
      await runPasswd(userConfigPath);
      return;
    case "add":
      await runAdd(positional, userConfigPath);
      return;
    case "list":
      runList(userConfigPath);
      return;
    case "remove":
      runRemove(positional[0], userConfigPath);
      return;
    case "layout":
      await runLayout(userConfigPath);
      return;
    case "stop":
      await runStop(daemon);
      return;
    default:
      await runServer(daemon);
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(`[multiprox] fatal: ${err.message}`);
    process.exit(1);
  });
}

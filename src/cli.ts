#!/usr/bin/env node

import * as path from "path";
import { runServer } from "./server";
import { runPasswd } from "./passwd";
import { runAdd, runList, runRemove } from "./services-cli";
import { runLayout } from "./layout-cli";
import { getDefaultStatePath } from "./paths";
import { DaemonOptions } from "./options";

type Command = "serve" | "passwd" | "add" | "list" | "remove" | "layout";

function printHelp(): void {
  console.log(`MultiProx — 多服务认证反向代理入口（共享网关）

用法:
  multiprox [选项]                         启动共享网关 daemon
  multiprox passwd [选项]                  设置当前用户登录密码
  multiprox add [选项] [name] [description]     添加端口转发（无必填参数时进入交互）
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

add 选项:
  --host <host>         后端地址 (默认: 127.0.0.1，允许内网地址)
  --port <port>         后端端口 (必填)
  --category <name>     分类名称
  --ws                  启用 WebSocket

说明:
  name 会自动生成代理路径，如 "jupyter" -> /jupyter
  直接运行 multiprox add 可逐项填写；带齐 --port 与 name 时仍支持一行命令

示例:
  multiprox
  multiprox passwd
  multiprox add
  multiprox add --port 1901 --category 开发工具 jupyter 交互式笔记本
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

const COMMANDS = new Set<Command>(["passwd", "add", "list", "remove", "layout"]);

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

    positional.push(arg);
    if (["--name", "--path", "--host", "--port", "--category"].includes(arg)) {
      positional.push(rest[++i]);
    }
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
    default:
      await runServer(daemon);
  }
}

main().catch((err: Error) => {
  console.error(`[multiprox] fatal: ${err.message}`);
  process.exit(1);
});

import {
  addService,
  removeService,
  loadUserConfig,
  ensureUserConfigExists,
} from "./user-config";
import {
  getDefaultUserConfigPath,
  slugifyName,
  servicePathFromName,
  assertAllowedHost,
} from "./paths";
import { createLinePrompter } from "./prompt";

const DEFAULT_HOST = "127.0.0.1";

export interface AddServiceInput {
  name: string;
  description?: string;
  host: string;
  port: number;
  websocket: boolean;
  category?: string;
}

function resolveConfigPath(userConfigPath?: string): string {
  return userConfigPath ?? getDefaultUserConfigPath();
}

function parsePortValue(raw: string): number {
  const port = parseInt(raw, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${raw}`);
  }
  return port;
}

export function commitAddService(configPath: string, input: AddServiceInput): void {
  const id = slugifyName(input.name);
  const servicePath = servicePathFromName(input.name);

  addService(configPath, {
    id,
    name: input.name,
    description: input.description,
    host: input.host,
    port: input.port,
    path: servicePath,
    websocket: input.websocket,
    category: input.category,
  });

  console.log(`[multiprox] added ${input.name} -> ${input.host}:${input.port} at ${servicePath}`);
}

async function promptAddService(): Promise<AddServiceInput> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("multiprox add requires an interactive terminal; run: multiprox add");
  }

  const prompter = createLinePrompter();

  try {
    console.log("");
    console.log("MultiProx 添加端口转发（直接回车采用默认值）");
    console.log("");

    let name = "";
    while (!name) {
      name = await prompter.ask("名称", undefined, true);
      if (!name) {
        console.log("名称不能为空");
      }
    }

    const description = await prompter.ask("说明", "");
    const desc = description.trim() || undefined;

    let host = DEFAULT_HOST;
    while (true) {
      host = await prompter.ask("后端地址", host);
      try {
        assertAllowedHost(host);
        break;
      } catch (err) {
        console.log(err instanceof Error ? err.message : "无效地址");
      }
    }

    let port: number | undefined;
    while (port === undefined) {
      const raw = await prompter.ask("端口", undefined, true);
      if (!raw) {
        console.log("端口不能为空");
        continue;
      }
      try {
        port = parsePortValue(raw);
      } catch (err) {
        console.log(err instanceof Error ? err.message : "无效端口");
      }
    }

    const categoryRaw = await prompter.ask("分类", "");
    const category = categoryRaw.trim() || undefined;

    const websocket = await prompter.askYesNo("启用 WebSocket", false);

    const servicePath = servicePathFromName(name);
    console.log("");
    console.log(`将添加: ${name} -> ${host}:${port}  路径 ${servicePath}`);
    if (desc) console.log(`说明: ${desc}`);
    if (category) console.log(`分类: ${category}`);
    if (websocket) console.log("WebSocket: 是");

    const ok = await prompter.askYesNo("确认添加", true);
    if (!ok) {
      console.log("[multiprox] cancelled");
      process.exit(0);
    }

    return {
      name,
      description: desc,
      host,
      port,
      websocket,
      category,
    };
  } finally {
    prompter.close();
  }
}

export function runList(userConfigPath?: string): void {
  const configPath = resolveConfigPath(userConfigPath);
  ensureUserConfigExists(configPath);
  const config = loadUserConfig(configPath);

  if (config.services.length === 0) {
    console.log("[multiprox] no services configured");
    return;
  }

  for (const s of config.services) {
    const desc = s.description ? `\t${s.description}` : "";
    console.log(`${s.name}\t${s.host}:${s.port}\t${s.path}${desc}`);
  }
}

export async function runAdd(argv: string[], userConfigPath?: string): Promise<void> {
  if (argv.length > 0) {
    throw new Error("multiprox add is interactive only; run: multiprox add");
  }

  const configPath = resolveConfigPath(userConfigPath);
  ensureUserConfigExists(configPath);

  const input = await promptAddService();
  commitAddService(configPath, input);
}

export function runRemove(nameOrId: string | undefined, userConfigPath?: string): void {
  if (!nameOrId) {
    throw new Error("Usage: multiprox remove <name>");
  }

  const configPath = resolveConfigPath(userConfigPath);
  const config = loadUserConfig(configPath);
  const slug = slugifyName(nameOrId);

  const target = config.services.find(
    (s) => s.id === slug || s.id === nameOrId || s.name === nameOrId
  );
  if (!target) {
    throw new Error(`Service not found: ${nameOrId}`);
  }

  removeService(configPath, target.id);
  console.log(`[multiprox] removed ${target.name} from ${configPath}`);
}

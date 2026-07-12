import * as readline from "readline";
import {
  ensureUserConfigExists,
  groupServicesByCategory,
  loadUserConfig,
  ServiceConfig,
  ServiceLayoutItem,
  updateServicesLayout,
} from "./user-config";
import { getDefaultUserConfigPath } from "./paths";

export interface LayoutEntry {
  id: string;
  name: string;
  host: string;
  port: number;
  category?: string;
}

export function buildLayoutEntries(services: ServiceConfig[]): LayoutEntry[] {
  const groups = groupServicesByCategory(services);
  const entries: LayoutEntry[] = [];

  for (const [, items] of groups) {
    for (const s of items) {
      entries.push({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        category: s.category,
      });
    }
  }

  return entries;
}

export function moveEntry(
  entries: LayoutEntry[],
  index: number,
  direction: -1 | 1
): LayoutEntry[] {
  const next = entries.map((entry) => ({ ...entry }));
  const target = index + direction;
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) {
    return next;
  }
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function setEntryCategory(
  entries: LayoutEntry[],
  index: number,
  category: string
): LayoutEntry[] {
  const next = entries.map((entry) => ({ ...entry }));
  if (index < 0 || index >= next.length) {
    return next;
  }
  const trimmed = category.trim();
  next[index].category = trimmed || undefined;
  return next;
}

export function entriesToLayoutItems(entries: LayoutEntry[]): ServiceLayoutItem[] {
  return entries.map((entry, order) => ({
    id: entry.id,
    order,
    category: entry.category,
  }));
}

function formatCategory(category?: string): string {
  return category?.trim() || "未分类";
}

function renderLayout(entries: LayoutEntry[]): void {
  console.log("");
  console.log("MultiProx 布局编辑（添加/删除请用 multiprox add / remove）");
  console.log("");

  if (entries.length === 0) {
    console.log("  （暂无服务）");
    console.log("");
    return;
  }

  const indexWidth = String(entries.length).length;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const num = String(i + 1).padStart(indexWidth, " ");
    const name = entry.name.padEnd(14).slice(0, 14);
    const category = formatCategory(entry.category).padEnd(10).slice(0, 10);
    console.log(` ${num}  ${name}  ${category}  ${entry.host}:${entry.port}`);
  }

  console.log("");
  console.log("命令: <序号>u 上移 | <序号>d 下移 | <序号>c <分类> 改分类 | s 保存 | q 退出 | h 帮助");
}

function printHelp(): void {
  console.log("");
  console.log("示例:");
  console.log("  2u          将第 2 项上移");
  console.log("  3d          将第 3 项下移");
  console.log("  1c 开发工具  将第 1 项归入「开发工具」");
  console.log("  2c          清除第 2 项分类");
  console.log("  s           保存并退出");
  console.log("  q           放弃修改并退出");
  console.log("");
}

function parseCommand(
  line: string
): { type: "move"; index: number; direction: -1 | 1 } | { type: "category"; index: number; category: string } | { type: "save" } | { type: "quit" } | { type: "help" } | { type: "unknown" } {
  const trimmed = line.trim();
  if (!trimmed) {
    return { type: "unknown" };
  }

  if (/^h(?:elp)?$/i.test(trimmed)) {
    return { type: "help" };
  }
  if (/^s(?:ave)?$/i.test(trimmed)) {
    return { type: "save" };
  }
  if (/^q(?:uit)?$/i.test(trimmed)) {
    return { type: "quit" };
  }

  const moveMatch = trimmed.match(/^(\d+)\s*([ud])(?:own|p)?$/i);
  if (moveMatch) {
    const index = parseInt(moveMatch[1], 10) - 1;
    const direction = moveMatch[2].toLowerCase() === "u" ? -1 : 1;
    return { type: "move", index, direction };
  }

  const categoryMatch = trimmed.match(/^(\d+)\s+c(?:\s+(.*))?$/i);
  if (categoryMatch) {
    const index = parseInt(categoryMatch[1], 10) - 1;
    return { type: "category", index, category: categoryMatch[2] ?? "" };
  }

  return { type: "unknown" };
}

function askLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function runLayout(userConfigPath?: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("layout requires an interactive terminal");
  }

  const configPath = userConfigPath ?? getDefaultUserConfigPath();
  ensureUserConfigExists(configPath);
  const config = loadUserConfig(configPath);

  let entries = buildLayoutEntries(config.services);
  let dirty = false;

  renderLayout(entries);

  while (true) {
    const line = await askLine("> ");
    const command = parseCommand(line);

    switch (command.type) {
      case "help":
        printHelp();
        break;
      case "move": {
        const before = entries.map((e) => e.id).join(",");
        entries = moveEntry(entries, command.index, command.direction);
        if (entries.map((e) => e.id).join(",") !== before) {
          dirty = true;
          renderLayout(entries);
        } else {
          console.log("无法移动：序号无效或已在边界");
        }
        break;
      }
      case "category":
        entries = setEntryCategory(entries, command.index, command.category);
        if (command.index >= 0 && command.index < entries.length) {
          dirty = true;
          renderLayout(entries);
        } else {
          console.log("无效序号");
        }
        break;
      case "save":
        if (entries.length > 0) {
          updateServicesLayout(configPath, entriesToLayoutItems(entries));
        }
        console.log(dirty ? "[multiprox] layout saved" : "[multiprox] no changes");
        return;
      case "quit":
        if (dirty) {
          console.log("[multiprox] discarded changes");
        }
        return;
      default:
        console.log("未知命令，输入 h 查看帮助");
        break;
    }
  }
}

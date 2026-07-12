import * as readline from "readline";

export interface LinePrompter {
  ask(label: string, defaultValue?: string, required?: boolean): Promise<string>;
  askYesNo(label: string, defaultYes?: boolean): Promise<boolean>;
  close(): void;
}

export function createLinePrompter(): LinePrompter {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (label: string, defaultValue?: string, required = false): Promise<string> => {
    const hint =
      defaultValue !== undefined
        ? defaultValue === ""
          ? " []"
          : ` [${defaultValue}]`
        : required
          ? " (必填)"
          : "";
    return new Promise((resolve) => {
      rl.question(`${label}${hint}: `, (answer) => {
        const trimmed = answer.trim();
        if (trimmed) {
          resolve(trimmed);
          return;
        }
        if (defaultValue !== undefined) {
          resolve(defaultValue);
          return;
        }
        resolve("");
      });
    });
  };

  const askYesNo = async (label: string, defaultYes = false): Promise<boolean> => {
    const suffix = defaultYes ? " [Y/n]" : " [y/N]";
    while (true) {
      const answer = (await ask(`${label}${suffix}`, "")).toLowerCase();
      if (!answer) return defaultYes;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      console.log("请输入 y 或 n");
    }
  };

  return {
    ask,
    askYesNo,
    close: () => rl.close(),
  };
}

export function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);

    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error("Password input requires an interactive terminal"));
      return;
    }

    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    let password = "";

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (ch: string) => {
      switch (ch) {
        case "\n":
        case "\r":
        case "\u0004":
          cleanup();
          process.stdout.write("\n");
          resolve(password);
          break;
        case "\u0003":
          cleanup();
          process.stdout.write("\n");
          process.exit(130);
          break;
        case "\u007f":
        case "\b":
          password = password.slice(0, -1);
          break;
        default:
          if (ch >= " " || ch === "\t") {
            password += ch;
          }
          break;
      }
    };

    stdin.on("data", onData);
  });
}

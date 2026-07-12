/** Shared gateway: daemon must read user configs. */
export const USER_CONFIG_FILE_MODE = 0o644;

export function mapConfigWriteError(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM") {
    return "无法写入配置文件。请使用 CLI：multiprox add / remove / layout。";
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Request failed";
}

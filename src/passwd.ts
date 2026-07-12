import { ensureUserConfigExists, updatePasswordHash } from "./user-config";
import { hashPassword } from "./auth";
import { askHidden } from "./prompt";
import { getDefaultUserConfigPath } from "./paths";

export async function runPasswd(userConfigPath?: string): Promise<void> {
  const configPath = userConfigPath ?? getDefaultUserConfigPath();
  ensureUserConfigExists(configPath);

  const password = await askHidden("New password: ");
  if (!password) {
    throw new Error("Password cannot be empty");
  }

  const confirm = await askHidden("Confirm password: ");
  if (password !== confirm) {
    throw new Error("Passwords do not match");
  }

  const hash = hashPassword(password);
  updatePasswordHash(configPath, hash);

  console.log(`[multiprox] password updated in ${configPath}`);
}

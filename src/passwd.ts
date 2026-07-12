import { ensureUserConfigExists, updatePasswordHash } from "./user-config";
import {
  applySharedGatewayPermissions,
  shouldApplySharedGatewayPermissions,
} from "./config-perms";
import { hashPassword } from "./auth";
import { askHidden } from "./prompt";
import { getDefaultUserConfigPath, getDefaultStatePath } from "./paths";

function logPermissionResult(result: ReturnType<typeof applySharedGatewayPermissions>): void {
  const changed = result.applied.filter((entry) => entry.changed);
  if (changed.length > 0) {
    console.log("[multiprox] updated shared-gateway permissions:");
    for (const entry of changed) {
      console.log(`  ${entry.path} -> ${entry.mode}`);
    }
  } else if (result.applied.length > 0) {
    console.log("[multiprox] shared-gateway permissions already OK");
  }

  for (const note of result.skipped) {
    console.log(`[multiprox] ${note}`);
  }
}

export async function runPasswd(userConfigPath?: string): Promise<void> {
  const configPath = userConfigPath ?? getDefaultUserConfigPath();
  const statePath = getDefaultStatePath();
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

  if (shouldApplySharedGatewayPermissions(configPath, statePath)) {
    const permResult = applySharedGatewayPermissions(configPath, undefined, statePath);
    logPermissionResult(permResult);
  } else {
    console.log(
      "[multiprox] gateway operator is current user; home/config permissions unchanged"
    );
  }
}

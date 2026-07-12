export {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  getDefaultUserConfigPath,
  getDefaultStatePath,
} from "./paths";

export type { ServiceConfig, UserConfig } from "./user-config";
export {
  loadUserConfig,
  ensureUserConfigExists,
  updatePasswordHash,
  addService,
  removeService,
} from "./user-config";

export type { StateConfig } from "./state";
export { loadState, ensureStateExists, applyStateOverrides } from "./state";

export { UserRegistry, usernameFromProxyPath } from "./registry";
export type { ServiceMatch, LoadedUser } from "./registry";

// Backward-compatible alias
export { getDefaultUserConfigPath as getDefaultConfigPath } from "./paths";

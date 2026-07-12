export interface DaemonOptions {
  statePath?: string;
  host?: string;
  port?: number;
  help: boolean;
}

export interface UserCommandOptions {
  userConfigPath?: string;
  help: boolean;
}

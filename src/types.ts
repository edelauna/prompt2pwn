export interface LaunchOptions {
  project?: string;
  launchFile?: string;
  noPriv?: boolean;
  verbose?: boolean;
  yes?: boolean;
  pwnObjective?: string;
  pwnTarget?: string;
  pwnInfo?: string;
  provider?: string;
  model?: string;
  tool?: 'goose' | 'claude';
}

export interface AppConfig {
  extensions: Record<string, unknown>;
  GOOSE_TELEMETRY_ENABLED: boolean;
}

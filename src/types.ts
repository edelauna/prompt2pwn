export interface LaunchOptions {
  project?: string;
  launchFile?: string;
  noPriv?: boolean;
  verbose?: boolean;
  yes?: boolean;
  pwnChallenge?: string;
  pwnTarget?: string;
  pwnInfo?: string;
  provider?: string;
  model?: string;
}

export interface AppConfig {
  extensions: Record<string, unknown>;
  GOOSE_TELEMETRY_ENABLED: boolean;
}

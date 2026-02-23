import { ux } from "./ux.ts";
import { Input, Select } from "@cliffy/prompt";

export type GooseProviderName = "xai" | "google" | "openai" | "anthropic";

export interface ProviderConfig {
  keyEnv: string; // Environment variable name for the API key
  defaultModel: string;
  host?: string; // Optional host for providers that support custom endpoints
}

const providerConfigs: Record<GooseProviderName, ProviderConfig> = {
  xai: {
    keyEnv: "XAI_API_KEY",
    defaultModel: "grok-4-1-fast-reasoning",
  },
  google: {
    keyEnv: "GOOGLE_API_KEY",
    defaultModel: "gemini-flash-lite-latest",
    host: "https://generativelanguage.googleapis.com",
  },
  openai: {
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4.1-nano",
  },
  anthropic: {
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-sonnet-4-5",
  },
};

export function getProviderConfig(
  providerName: GooseProviderName,
): ProviderConfig {
  const config = providerConfigs[providerName];
  if (!config) {
    throw new Error(`Unsupported Goose provider: ${providerName}`);
  }
  return config;
}

export async function selectAndConfigureProvider(
  skipOptionalPrompts = false,
  preSetProvider?: GooseProviderName,
  preSetModel?: string,
  xaiKey?: string,
  loadedEnv?: Record<string, string>,
): Promise<
  {
    provider: GooseProviderName;
    model: string;
    providerApiKey: string | undefined;
  }
> {
  // 1. Select Provider
  let providerName: GooseProviderName;
  if (preSetProvider && Object.keys(providerConfigs).includes(preSetProvider)) {
    providerName = preSetProvider;
  } else {
    const envProvider = Deno.env.get("GOOSE_PROVIDER") as GooseProviderName;
    if (envProvider && Object.keys(providerConfigs).includes(envProvider)) {
      providerName = envProvider;
    } else {
      providerName = (await Select.prompt({
        message: "Which model provider would you like to use?",
        options: Object.keys(providerConfigs) as GooseProviderName[],
        default: "xai",
      })) as GooseProviderName;
    }
  }

  const config = await getProviderConfig(providerName);

  let providerApiKey: string | undefined;

  if (providerName === "xai") {
    // For xai, use the XAI_API_KEY passed in (for MCP), but Goose xai provider likely uses the same.
    providerApiKey = xaiKey;
  } else {
    // 2. Prompt for provider-specific API Key
    const keyEnv = config.keyEnv;
    const keyFromEnv = loadedEnv?.[keyEnv] || Deno.env.get(keyEnv);

    if (!keyFromEnv && !skipOptionalPrompts) {
      providerApiKey = await Input.prompt({
        message:
          `Provider '${providerName}' requires ${keyEnv}. Please enter the key:`,
      });
      if (!providerApiKey) {
        ux.error(
          `Error: API Key for ${keyEnv} is required for provider ${providerName}.`,
        );
        Deno.exit(1);
      }
    } else {
      providerApiKey = keyFromEnv;
    }
  }

  // 3. Select Model
  let model = preSetModel || config.defaultModel;
  if (!skipOptionalPrompts && !preSetModel) {
    const wantModelPrompt = await Select.prompt({
      message:
        `Use default model for ${providerName} (${config.defaultModel})?`,
      options: ["Yes", "No"],
      default: "Yes",
    });

    if (wantModelPrompt === "No") {
      model = await Input.prompt({
        message:
          `Enter model name for ${providerName} (e.g., ${config.defaultModel}):`,
        default: config.defaultModel,
      });
    }
  }

  return {
    provider: providerName,
    model: model,
    providerApiKey: providerApiKey,
  };
}

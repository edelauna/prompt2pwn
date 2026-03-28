import { join } from "path";
import { Confirm, Input } from "@cliffy/prompt";
import { ux } from "./ux.ts";
import {
  type GooseProviderName,
  selectAndConfigureProvider,
} from "./providers.ts";

export async function loadEnvFile(
  path: string,
): Promise<Record<string, string>> {
  try {
    const text = await Deno.readTextFile(path);
    const env: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const [key, ...valueParts] = trimmed.split("=");
        if (key) {
          env[key.trim()] = valueParts.join("=").trim();
        }
      }
    }
    return env;
  } catch {
    return {};
  }
}

export async function setupEnv(
  root: string,
  configDir: string,
  skipOptionalPrompts = false,
  preSetProvider?: GooseProviderName,
  preSetModel?: string,
) {
  // Try current directory first, then root, then config dir
  const env1 = await loadEnvFile(".env");
  const env2 = await loadEnvFile(join(root, ".env"));
  const env3 = await loadEnvFile(join(configDir, ".env"));
  // Priority: .env > root/.env > configDir/.env
  const env: Record<string, string> = { ...env3, ...env2, ...env1 };

  // Optional XAI_API_KEY for MCP search tools
  let xaiKey: string | undefined = env["XAI_API_KEY"] ||
    Deno.env.get("XAI_API_KEY");
  const wantXaiMcp = xaiKey ? true : await Confirm.prompt({
    message:
      "Configure XAI_API_KEY for MCP search tools? (optional, skip for Sourcegraph-only tools)",
    default: true,
  });
  if (wantXaiMcp && !xaiKey) {
    xaiKey = await Input.prompt({
      message: "Please enter your XAI_API_KEY:",
    });
    if (!xaiKey) {
      ux.error("XAI_API_KEY is required.");
      Deno.exit(1);
    }
  }

  // Get SOURCEGRAPH_TOKEN
  let sourcegraphToken = env["SOURCEGRAPH_TOKEN"] ||
    Deno.env.get("SOURCEGRAPH_TOKEN");
  if (!sourcegraphToken && !skipOptionalPrompts) {
    const wantSg = await Confirm.prompt({
      message: "Configure SOURCEGRAPH_TOKEN for code search tools? (optional)",
      default: false,
    });
    if (wantSg) {
      sourcegraphToken = await Input.prompt({
        message: "Enter your SOURCEGRAPH_TOKEN:",
      });
    }
  }

  // Configure Goose provider and model
  const preSetProviderFromEnv =
    (env["GOOSE_PROVIDER"] || Deno.env.get("GOOSE_PROVIDER")) as
      | GooseProviderName
      | undefined;
  const effectivePreSetProvider = preSetProvider || preSetProviderFromEnv;
  const effectivePreSetModel = preSetModel || env["GOOSE_MODEL"] ||
    Deno.env.get("GOOSE_MODEL");

  const { provider, model, providerApiKey } = await selectAndConfigureProvider(
    skipOptionalPrompts,
    effectivePreSetProvider,
    effectivePreSetModel,
    xaiKey, // Pass xaiKey for xai provider
    env, // Pass loaded env
  );

  return {
    xaiKey,
    provider,
    model,
    providerApiKey,
    sourcegraphToken,
  };
}

export async function setupMcpEnv(
  root: string,
  configDir: string,
  skipOptionalPrompts = false,
) {
  const env1 = await loadEnvFile(".env");
  const env2 = await loadEnvFile(join(root, ".env"));
  const env3 = await loadEnvFile(join(configDir, ".env"));
  const env: Record<string, string> = { ...env3, ...env2, ...env1 };

  let xaiKey: string | undefined = env["XAI_API_KEY"] ||
    Deno.env.get("XAI_API_KEY");
  if (!xaiKey && !skipOptionalPrompts) {
    const wantXaiMcp = await Confirm.prompt({
      message:
        "Configure XAI_API_KEY for MCP search tools? (optional, skip for Sourcegraph-only tools)",
      default: true,
    });
    if (wantXaiMcp) {
      xaiKey = await Input.prompt({
        message: "Please enter your XAI_API_KEY:",
      });
      if (!xaiKey) {
        ux.error("XAI_API_KEY is required.");
        Deno.exit(1);
      }
    }
  }

  let sourcegraphToken = env["SOURCEGRAPH_TOKEN"] ||
    Deno.env.get("SOURCEGRAPH_TOKEN");
  if (!sourcegraphToken && !skipOptionalPrompts) {
    const wantSg = await Confirm.prompt({
      message: "Configure SOURCEGRAPH_TOKEN for code search tools? (optional)",
      default: false,
    });
    if (wantSg) {
      sourcegraphToken = await Input.prompt({
        message: "Enter your SOURCEGRAPH_TOKEN:",
      });
    }
  }

  return { xaiKey, sourcegraphToken };
}

export async function setupCodexEnv(
  root: string,
  configDir: string,
  skipOptionalPrompts = false,
) {
  const env1 = await loadEnvFile(".env");
  const env2 = await loadEnvFile(join(root, ".env"));
  const env3 = await loadEnvFile(join(configDir, ".env"));
  const env: Record<string, string> = { ...env3, ...env2, ...env1 };

  const { xaiKey, sourcegraphToken } = await setupMcpEnv(
    root,
    configDir,
    skipOptionalPrompts,
  );

  let openAiApiKey = env["OPENAI_API_KEY"] || Deno.env.get("OPENAI_API_KEY");
  if (!openAiApiKey && !skipOptionalPrompts) {
    const wantOpenAi = await Confirm.prompt({
      message:
        "Configure OPENAI_API_KEY for Codex CLI? (optional, skip to use codex login)",
      default: false,
    });
    if (wantOpenAi) {
      openAiApiKey = await Input.prompt({
        message: "Please enter your OPENAI_API_KEY:",
      });
      if (!openAiApiKey) {
        ux.error("OPENAI_API_KEY is required.");
        Deno.exit(1);
      }
    }
  }

  return {
    xaiKey,
    sourcegraphToken,
    openAiApiKey,
  };
}

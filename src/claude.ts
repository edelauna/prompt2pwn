import { join } from "path";

function buildClaudeMcpConfig() {
  return {
    mcpServers: {
      search: {
        type: "http",
        url: "http://mcp-xai:1337/mcp",
        headers: {},
        timeout: 120,
      },
      playwright: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp", "--ignore-https-errors"],
        env: {},
        timeout: 120,
      },
    },
  };
}

export function mergeClaudeProjectMcpConfig(
  existingConfig: Record<string, unknown> = {},
): Record<string, unknown> {
  const existingServers = existingConfig.mcpServers &&
      typeof existingConfig.mcpServers === "object" &&
      !Array.isArray(existingConfig.mcpServers)
    ? existingConfig.mcpServers as Record<string, unknown>
    : {};

  return {
    ...existingConfig,
    mcpServers: {
      ...existingServers,
      ...buildClaudeMcpConfig().mcpServers,
    },
  };
}

export async function syncClaudeProjectMcpConfig(projectPath: string) {
  const mcpConfigPath = join(projectPath, ".mcp.json");
  let existingConfig: Record<string, unknown> = {};

  try {
    const raw = await Deno.readTextFile(mcpConfigPath);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Project MCP config must be a JSON object.");
    }
    existingConfig = parsed as Record<string, unknown>;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw new Error(
        `Failed to load existing MCP config at ${mcpConfigPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const nextConfig = mergeClaudeProjectMcpConfig(existingConfig);
  const nextContent = `${JSON.stringify(nextConfig, null, 2)}\n`;

  let existingContent = "";
  try {
    existingContent = await Deno.readTextFile(mcpConfigPath);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) {
      throw error;
    }
  }

  if (existingContent !== nextContent) {
    await Deno.writeTextFile(mcpConfigPath, nextContent);
  }

  return mcpConfigPath;
}

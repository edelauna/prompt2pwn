import { join } from "path";

const CLAUDE_HOME_SEED_MARKER = ".prompt2pwn-claude-seed-version";

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

export async function syncClaudeHomeVolume(
  volumeName: string,
  image: string,
  seedVersion: string,
) {
  const inspectRes = await new Deno.Command("docker", {
    args: ["volume", "inspect", volumeName],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!inspectRes.success) {
    const createVolumeRes = await new Deno.Command("docker", {
      args: ["volume", "create", volumeName],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!createVolumeRes.success) {
      throw new Error(
        `docker volume create failed: ${
          new TextDecoder().decode(createVolumeRes.stderr)
        }`,
      );
    }
  } else {
    const markerRes = await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/target`,
        "alpine",
        "sh",
        "-c",
        `cat /target/${CLAUDE_HOME_SEED_MARKER} 2>/dev/null || true`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!markerRes.success) {
      throw new Error(
        `Failed to inspect Claude volume: ${
          new TextDecoder().decode(markerRes.stderr)
        }`,
      );
    }
    if (new TextDecoder().decode(markerRes.stdout).trim() === seedVersion) {
      return "existing";
    }
  }

  const tmpName = `seed-claude-vol-${Date.now()}`;
  const tmpDir = await Deno.makeTempDir({ prefix: "claude-seed-" });
  try {
    const createRes = await new Deno.Command("docker", {
      args: ["create", "--name", tmpName, image],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!createRes.success) {
      throw new Error(
        `docker create failed: ${new TextDecoder().decode(createRes.stderr)}`,
      );
    }

    for (const path of [".local", ".cache/ms-playwright"]) {
      const cpRes = await new Deno.Command("docker", {
        args: ["cp", `${tmpName}:/home/goose/${path}`, `${tmpDir}/${path}`],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!cpRes.success) {
        throw new Error(
          `docker cp failed for ${path}: ${
            new TextDecoder().decode(cpRes.stderr)
          }`,
        );
      }
    }

    await Deno.writeTextFile(
      join(tmpDir, CLAUDE_HOME_SEED_MARKER),
      seedVersion,
    );

    const volCpRes = await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/target`,
        "-v",
        `${tmpDir}:/seed`,
        "alpine",
        "sh",
        "-c",
        [
          "mkdir -p /target/.cache",
          "rm -rf /target/.local",
          "cp -a /seed/.local /target/.local",
          "rm -rf /target/.cache/ms-playwright",
          "cp -a /seed/.cache/ms-playwright /target/.cache/ms-playwright",
          `cp /seed/${CLAUDE_HOME_SEED_MARKER} /target/${CLAUDE_HOME_SEED_MARKER}`,
        ].join(" && "),
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!volCpRes.success) {
      throw new Error(
        `Failed to seed Claude volume: ${
          new TextDecoder().decode(volCpRes.stderr)
        }`,
      );
    }
  } finally {
    await new Deno.Command("docker", {
      args: ["rm", "-f", tmpName],
      stdout: "piped",
      stderr: "piped",
    }).output();
    await Deno.remove(tmpDir, { recursive: true });
  }

  return inspectRes.success ? "updated" : "created";
}

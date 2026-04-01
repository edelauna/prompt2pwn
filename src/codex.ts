import { join } from "path";

const CODEX_HOME_SEED_MARKER = ".prompt2pwn-codex-seed-version";
const CODEX_CONFIG_PATH = "/target/.codex/config.toml";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertTomlTable(content: string, header: string, body: string) {
  const block = `${header}\n${body}\n`;
  const pattern = new RegExp(
    `(?:^|\\n)${escapeRegExp(header)}\\n[\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)`,
    "m",
  );

  if (pattern.test(content)) {
    return content.replace(pattern, `\n${block}`).replace(/^\n/, "");
  }

  const trimmed = content.trimEnd();
  if (!trimmed) return block;
  return `${trimmed}\n\n${block}`;
}

function removeTomlTable(content: string, header: string) {
  const pattern = new RegExp(
    `(?:^|\\n)${escapeRegExp(header)}\\n[\\s\\S]*?(?=\\n\\[[^\\n]+\\]|$)`,
    "m",
  );
  return content.replace(pattern, "").replace(/^\n+/, "").trim();
}

function stripPrompt2pwnManagedCodexTables(existingContent = "") {
  return [
    '[projects."/workspace"]',
    "[mcp_servers.search]",
    "[mcp_servers.playwright]",
  ].reduce(
    (content, header) => removeTomlTable(content, header),
    existingContent.trim(),
  ).trimEnd() + "\n";
}

export function mergeCodexConfig(existingContent = "") {
  return upsertTomlTable(
    existingContent.trim(),
    '[projects."/workspace"]',
    'trust_level = "trusted"',
  ).trimEnd() + "\n";
}

async function writeCodexConfigVolume(volumeName: string, content: string) {
  const tmpDir = await Deno.makeTempDir({ prefix: "codex-config-" });
  try {
    const hostConfigPath = join(tmpDir, "config.toml");
    await Deno.writeTextFile(hostConfigPath, content);

    const writeRes = await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/target`,
        "-v",
        `${hostConfigPath}:/seed/config.toml`,
        "alpine",
        "sh",
        "-c",
        [
          "mkdir -p /target/.codex",
          "cp /seed/config.toml /target/.codex/config.toml",
        ].join(" && "),
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!writeRes.success) {
      throw new Error(
        `Failed to write Codex config: ${
          new TextDecoder().decode(writeRes.stderr)
        }`,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

export async function syncCodexConfigVolume(volumeName: string, image: string) {
  const readRes = await new Deno.Command("docker", {
    args: [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/target`,
      "alpine",
      "sh",
      "-c",
      `cat ${CODEX_CONFIG_PATH} 2>/dev/null || true`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!readRes.success) {
    throw new Error(
      `Failed to read Codex config: ${
        new TextDecoder().decode(readRes.stderr)
      }`,
    );
  }

  const existingContent = new TextDecoder().decode(readRes.stdout);
  const sanitizedContent = stripPrompt2pwnManagedCodexTables(existingContent);

  if (existingContent.trim() !== sanitizedContent.trim()) {
    await writeCodexConfigVolume(volumeName, sanitizedContent);
  }

  const managedServers = [
    ["mcp", "add", "search", "--url", "http://mcp-xai:1337/mcp"],
    [
      "mcp",
      "add",
      "playwright",
      "--",
      "npx",
      "-y",
      "@playwright/mcp",
      "--ignore-https-errors",
    ],
  ] as const;

  const runManagedAdds = async () => {
    for (const args of managedServers) {
      const addRes = await new Deno.Command("docker", {
        args: [
          "run",
          "--rm",
          "--entrypoint",
          "codex",
          "-v",
          `${volumeName}:/home/goose`,
          image,
          ...args,
        ],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!addRes.success) {
        return {
          success: false,
          stderr: new TextDecoder().decode(addRes.stderr),
        };
      }
    }
    return { success: true, stderr: "" };
  };

  let addResult = await runManagedAdds();
  if (
    !addResult.success &&
    addResult.stderr.includes("failed to load configuration")
  ) {
    await writeCodexConfigVolume(volumeName, mergeCodexConfig(""));
    addResult = await runManagedAdds();
  }
  if (!addResult.success) {
    throw new Error(`Failed to update Codex MCP config: ${addResult.stderr}`);
  }

  const finalReadRes = await new Deno.Command("docker", {
    args: [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/target`,
      "alpine",
      "sh",
      "-c",
      `cat ${CODEX_CONFIG_PATH} 2>/dev/null || true`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (!finalReadRes.success) {
    throw new Error(
      `Failed to read Codex config: ${
        new TextDecoder().decode(finalReadRes.stderr)
      }`,
    );
  }

  const nextBaseContent = new TextDecoder().decode(finalReadRes.stdout);
  const nextContent = mergeCodexConfig(nextBaseContent);
  if (nextBaseContent.trim() === nextContent.trim()) {
    return CODEX_CONFIG_PATH;
  }

  const tmpDir = await Deno.makeTempDir({ prefix: "codex-config-" });
  try {
    const hostConfigPath = join(tmpDir, "config.toml");
    await Deno.writeTextFile(hostConfigPath, nextContent);

    const writeRes = await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "-v",
        `${volumeName}:/target`,
        "-v",
        `${hostConfigPath}:/seed/config.toml`,
        "alpine",
        "sh",
        "-c",
        [
          "mkdir -p /target/.codex",
          "cp /seed/config.toml /target/.codex/config.toml",
        ].join(" && "),
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!writeRes.success) {
      throw new Error(
        `Failed to write Codex config: ${
          new TextDecoder().decode(writeRes.stderr)
        }`,
      );
    }
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }

  return CODEX_CONFIG_PATH;
}

export async function syncCodexHomeVolume(
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
        `cat /target/${CODEX_HOME_SEED_MARKER} 2>/dev/null || true`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!markerRes.success) {
      throw new Error(
        `Failed to inspect Codex volume: ${
          new TextDecoder().decode(markerRes.stderr)
        }`,
      );
    }
    if (new TextDecoder().decode(markerRes.stdout).trim() === seedVersion) {
      return "existing";
    }
  }

  const tmpName = `seed-codex-vol-${Date.now()}`;
  const tmpDir = await Deno.makeTempDir({ prefix: "codex-seed-" });
  try {
    await Deno.mkdir(join(tmpDir, ".cache"), { recursive: true });

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

    const cpRes = await new Deno.Command("docker", {
      args: [
        "cp",
        `${tmpName}:/home/goose/.cache/ms-playwright`,
        `${tmpDir}/.cache/ms-playwright`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!cpRes.success) {
      throw new Error(
        `docker cp failed for .cache/ms-playwright: ${
          new TextDecoder().decode(cpRes.stderr)
        }`,
      );
    }

    const tunneltoCpRes = await new Deno.Command("docker", {
      args: [
        "cp",
        `${tmpName}:/home/goose/.tunnelto`,
        `${tmpDir}/.tunnelto`,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!tunneltoCpRes.success) {
      throw new Error(
        `docker cp failed for .tunnelto: ${
          new TextDecoder().decode(tunneltoCpRes.stderr)
        }`,
      );
    }

    await Deno.writeTextFile(join(tmpDir, CODEX_HOME_SEED_MARKER), seedVersion);

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
          "mkdir -p /target/.cache /target/.codex",
          "rm -rf /target/.cache/ms-playwright",
          "cp -a /seed/.cache/ms-playwright /target/.cache/ms-playwright",
          "rm -rf /target/.tunnelto",
          "cp -a /seed/.tunnelto /target/.tunnelto",
          `cp /seed/${CODEX_HOME_SEED_MARKER} /target/${CODEX_HOME_SEED_MARKER}`,
        ].join(" && "),
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!volCpRes.success) {
      throw new Error(
        `Failed to seed Codex volume: ${
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

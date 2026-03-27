import { basename, dirname, join } from "path";
import { Command } from "@cliffy/command";
import { Confirm, Input } from "@cliffy/prompt";
import { ensureDir } from "fs/ensure_dir";
import type { Spinner } from "@std/cli/unstable-spinner";
import pc from "picocolors";

import { ux } from "./ux.ts";
import { loadEnvFile, setupEnv } from "./env.ts";
import { setupConfig } from "./config.ts";
import { getProviderConfig, type GooseProviderName } from "./providers.ts";
import { runPreflight } from "./preflight.ts";
import {
  cleanupOldVolumes,
  ensureDockerCompose,
  initVolume,
  resolveGooseImage,
  runGooseDocker,
} from "./docker.ts";
import { manageMcpSidecar } from "./mcp.ts";
import { LaunchOptions } from "./types.ts";
import {
  pullConfigFromVolume,
  seedRecipes,
  syncRecipesToVolume,
} from "./recipes.ts";
import { buildLaunchCmd, showLaunchPreview } from "./launch.ts";

async function prepareCTFArgs(
  options: LaunchOptions,
  extraArgs: string[],
): Promise<string[]> {
  if (extraArgs.length > 0) return extraArgs;
  const recipeArgs = ["run", "--recipe", "ctf-orchestrator", "--interactive"];
  const fields = [
    {
      flag: options.pwnObjective,
      prompt: "Objective / Description (req)",
      key: "target",
    },
    { flag: options.pwnTarget, prompt: "Target URL", key: "target_url" },
    {
      flag: options.pwnInfo,
      prompt: "Additional info",
      key: "additional_info",
    },
  ];
  for (const f of fields) {
    let val = f.flag;
    if (!val && !options.yes) {
      val = await Input.prompt({ message: f.prompt, default: "" });
    }
    if (val) {
      recipeArgs.push("--params", `${f.key}=${val}`);
    }
  }
  return recipeArgs;
}

async function orchestrateLaunchPrep(
  options: LaunchOptions,
  stagingPath: string,
  root: string,
  configDir: string,
  envPath: string,
  volumeName: string,
) {
  let seededType = "";
  await ux.withSpinner("Preparing environment...", async (spinner: Spinner) => {
    await ensureDir(stagingPath);
    await ensureDir(join(stagingPath, "recipes"));
    seededType = await seedRecipes(stagingPath, root);
    if (seededType === "external") {
      spinner.message = pc.cyan("Seeded external recipes...");
    } else if (seededType === "bundled") {
      spinner.message = pc.cyan("Seeded bundled recipes...");
    }
    await setupConfig(stagingPath, !!options.verbose);
    await runPreflight(configDir, !!options.verbose, spinner, envPath);
    await initVolume(volumeName, stagingPath, spinner);
  });
  if (seededType) {
    ux.info(`Recipes source: ${seededType}`);
  }
  if (seededType === "external") {
    ux.success("✔ Seeded external recipes.");
  } else if (seededType === "bundled") {
    ux.success("✔ Seeded bundled recipes.");
  }
  return seededType;
}

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

async function seedClaudeVolume(
  volumeName: string,
  image: string,
) {
  const inspectRes = await new Deno.Command("docker", {
    args: ["volume", "inspect", volumeName],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (inspectRes.success) return false;

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
          "mkdir -p /target/.local /target/.cache",
          "cp -a /seed/.local /target/.local",
          "mkdir -p /target/.cache",
          "cp -a /seed/.cache/ms-playwright /target/.cache/ms-playwright",
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

  return true;
}

const VERSION = "1.0.0";
// Robust root detection: always use project root
const root = dirname(
  Deno.args.includes("--dev")
    ? dirname(new URL(import.meta.url).pathname)
    : Deno.execPath(),
);

function getConfigDir() {
  return join(Deno.env.get("HOME") || ".", ".config/prompt2pwn");
}

export async function runCli() {
  const configDir = getConfigDir();
  await new Command()
    .name("prompt2Pwn")
    .version(VERSION)
    .description("Prompt2Pwn: Automate CTF Solver using Goose Workflows")
    .action(function () {
      this.showHelp();
    })
    .command("preflight", "Run preflight checks only")
    .option("--verbose", "Show detailed logs")
    .action(async (opts) => {
      await ux.withSpinner("Running preflight checks...", async () => {
        await runPreflight(root, !!opts.verbose);
      });
      ux.success("✔ Preflight complete.");
    })
    .command("down", "Stop and cleanup MCP sidecar services")
    .action(async () => {
      await manageMcpSidecar(configDir, "down");
    })
    .command("launch", "Launch Goose in Docker")
    .option(
      "--launch-file <path:string>",
      "Path to goose launch file relative to workspace",
    )
    .option("--no-priv", "Disable privileged mode (security check)")
    .option("--verbose", "Show detailed logs")
    .option("-y, --yes", "Skip confirmation prompts")
    .option("--pwn-objective <desc:string>", "Objective description")
    .option("--pwn-target <url:string>", "Target URL/IP")
    .option("--pwn-info <extra:string>", "Additional info/hints")
    .option(
      "--provider <provider:string>",
      "Set Goose provider (xai, google, openai, anthropic)",
    )
    .option("--model <model:string>", "Override Goose model (e.g., gemini-pro)")
    .option("--tool <tool:string>", "AI tool: goose (default) or claude")
    .arguments("[...extraArgs]")
    .stopEarly()
    .action(async function (opts, ...extraArgs) {
      const options = opts as LaunchOptions;

      if (options.verbose) {
        ux.info(`[DEBUG] Raw extraArgs: ${JSON.stringify(extraArgs)}`);
      }

      if (options.verbose) {
        ux.info("Verbose mode enabled");
        ux.info(`[DEBUG] Full opts: ${JSON.stringify(opts)}`);
        ux.info(
          `[DEBUG] Provider flag: ${
            options.provider || "undefined"
          }, Model flag: ${options.model || "undefined"}`,
        );
      }

      const literals = (this as any).getLiteralArgs() ?? [];
      if (options.verbose) {
        ux.info(
          `[DEBUG] Raw literalArgs (post --): ${JSON.stringify(literals)}`,
        );
      }
      const allPassthroughArgs = [...extraArgs, ...literals];
      let fullExtraArgs: string[];
      if (options.tool === "claude") {
        fullExtraArgs = allPassthroughArgs;
      } else {
        fullExtraArgs = await prepareCTFArgs(options, allPassthroughArgs);
      }
      const { xaiKey, provider, model, providerApiKey, sourcegraphToken } =
        await setupEnv(
          root,
          configDir,
          options.yes,
          options.provider as GooseProviderName,
          options.model,
        );
      await ensureDir(configDir);
      await ensureDockerCompose(configDir);
      const envPath = join(configDir, ".env");
      const providerConfig = await getProviderConfig(provider);

      const existingEnv = await loadEnvFile(envPath); // Parse existing
      const newEnv = {
        ...existingEnv,
        GOOSE_PROVIDER: provider,
        GOOSE_MODEL: model,
        ...(providerApiKey && { [providerConfig.keyEnv]: providerApiKey }),
        SOURCEGRAPH_TOKEN: sourcegraphToken || "",
        ...(xaiKey && provider !== "xai" && { XAI_API_KEY: xaiKey }),
        TOOL: options.tool || "goose",
      };

      const newContent = Object.entries(newEnv)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n";

      let existingContent = "";
      try {
        existingContent = await Deno.readTextFile(envPath);
      } catch { /* file doesn't exist */ }

      if (existingContent.trim() !== newContent.trim()) {
        await Deno.writeTextFile(envPath, newContent);
        if (options.verbose) ux.info(`Updated ${envPath}`);
      }
      await manageMcpSidecar(configDir, "restart", envPath);
      const workspacePath = Deno.cwd();
      const stagingPath = join(root, ".goose-staging");
      const volumeName = "goose-configs";
      const claudeVolumeName = `claude-configs`;
      const dockerCacheVol = `goose-docker-cache-${basename(workspacePath)}`;
      if (options.launchFile) {
        const fullPath = join(workspacePath, options.launchFile);
        try {
          await Deno.stat(fullPath);
        } catch {
          ux.error(`Launch file not found: ${fullPath}`);
          Deno.exit(1);
        }
      }
      const image = await resolveGooseImage(root);
      if (options.tool === "claude") {
        const mcpConfigPath = await syncClaudeProjectMcpConfig(workspacePath);
        ux.info(`Updated Claude project MCP config at ${mcpConfigPath}`);
        await ux.withSpinner(
          "Preparing Claude volume...",
          async (spinner: Spinner) => {
            spinner.message = pc.cyan(`Ensuring volume ${claudeVolumeName}...`);
            const seeded = await seedClaudeVolume(claudeVolumeName, image);
            if (seeded) {
              spinner.message = pc.cyan("Seeded Claude home and MCP config...");
            } else {
              spinner.message = pc.cyan("Reusing existing Claude volume...");
            }
          },
        );
      }
      if (options.tool !== "claude") {
        await orchestrateLaunchPrep(
          options,
          stagingPath,
          root,
          configDir,
          envPath,
          volumeName,
        );
        await syncRecipesToVolume(stagingPath, volumeName);
      }
      ux.success("✔ Environment Prepared.");
      showLaunchPreview(
        options,
        workspacePath,
        stagingPath,
        options.tool === "claude" ? claudeVolumeName : volumeName,
        provider,
        model,
      );
      if (!options.yes) {
        const ok = await Confirm.prompt({
          message: "Proceed with launch?",
          default: true,
        });
        if (!ok) Deno.exit(0);
      }
      const fullCmd = buildLaunchCmd(
        options,
        workspacePath,
        volumeName,
        claudeVolumeName,
        dockerCacheVol,
        envPath,
        image,
        fullExtraArgs,
      );
      if (options.verbose) {
        ux.info(`[DEBUG] Full Docker Command: ${fullCmd.join(" ")}`);
        ux.info(`[DEBUG] Extra Arguments: ${JSON.stringify(fullExtraArgs)}`);
      }
      // Add signal handlers for cleanup on shutdown
      const cleanupHandler = () => {
        ux.info("Received shutdown signal, cleaning up old volumes...");
        cleanupOldVolumes();
      };
      Deno.addSignalListener("SIGTERM", cleanupHandler);
      Deno.addSignalListener("SIGINT", cleanupHandler);

      ux.info("Launching or attaching to Goose Docker container...");
      await runGooseDocker(fullCmd);

      // Sync back any configuration changes made during the session
      if (options.tool !== "claude") {
        await pullConfigFromVolume(stagingPath, volumeName);
      }
    })
    .parse(Deno.args);
}

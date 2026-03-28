import { basename, dirname, join } from "path";
import { Command } from "@cliffy/command";
import { Confirm, Input } from "@cliffy/prompt";
import { ensureDir } from "fs/ensure_dir";
import type { Spinner } from "@std/cli/unstable-spinner";
import pc from "picocolors";

import { syncClaudeHomeVolume, syncClaudeProjectMcpConfig } from "./claude.ts";
import { syncCodexConfigVolume, syncCodexHomeVolume } from "./codex.ts";
import { ux } from "./ux.ts";
import { loadEnvFile, setupCodexEnv, setupEnv, setupMcpEnv } from "./env.ts";
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

type LiteralArgsCommandContext = {
  getLiteralArgs?: () => string[] | undefined;
};

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

const VERSION = "1.0.0";
const CLAUDE_HOME_SEED_VERSION = `${VERSION}-claude-home-v2`;
const CODEX_HOME_SEED_VERSION = `${VERSION}-codex-home-v1`;
// Robust root detection: always use project root
const root = dirname(
  Deno.args.includes("--dev")
    ? dirname(new URL(import.meta.url).pathname)
    : Deno.execPath(),
);

function getConfigDir() {
  return join(Deno.env.get("HOME") || ".", ".config/prompt2pwn");
}

function getCodexDefaultArgs(extraArgs: string[]) {
  const hasApprovalMode = extraArgs.some((arg) =>
    arg === "-a" ||
    arg === "--ask-for-approval" ||
    arg === "--full-auto" ||
    arg === "--dangerously-bypass-approvals-and-sandbox"
  );
  const hasSandboxMode = extraArgs.some((arg) =>
    arg === "-s" || arg === "--sandbox"
  );
  const defaults: string[] = [];
  if (!hasApprovalMode) defaults.push("-a", "on-request");
  if (!hasSandboxMode) defaults.push("-s", "workspace-write");
  return [...defaults, ...extraArgs];
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
    .command("launch", "Launch the selected AI tool in Docker")
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
    .option(
      "--tool <tool:string>",
      "AI tool: goose (default), claude, or codex",
    )
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

      const literals = (this as LiteralArgsCommandContext).getLiteralArgs?.() ??
        [];
      if (options.verbose) {
        ux.info(
          `[DEBUG] Raw literalArgs (post --): ${JSON.stringify(literals)}`,
        );
      }
      const allPassthroughArgs = [...extraArgs, ...literals];
      const tool = options.tool || "goose";
      let fullExtraArgs: string[];
      if (tool === "claude") {
        fullExtraArgs = allPassthroughArgs;
      } else if (tool === "codex") {
        fullExtraArgs = getCodexDefaultArgs(allPassthroughArgs);
      } else {
        fullExtraArgs = await prepareCTFArgs(options, allPassthroughArgs);
      }
      await ensureDir(configDir);
      await ensureDockerCompose(configDir);
      const envPath = join(configDir, ".env");
      const existingEnv = await loadEnvFile(envPath); // Parse existing
      let providerDisplay = tool === "codex" ? "OpenAI Codex" : "Claude";
      let modelDisplay = tool === "codex" ? "Suggest" : "Project MCP";
      let newEnv = { ...existingEnv };

      if (tool === "claude") {
        const { xaiKey, sourcegraphToken } = await setupMcpEnv(
          root,
          configDir,
          options.yes,
        );
        newEnv = {
          ...newEnv,
          ...(sourcegraphToken !== undefined && {
            SOURCEGRAPH_TOKEN: sourcegraphToken,
          }),
          ...(xaiKey && { XAI_API_KEY: xaiKey }),
        };
      } else if (tool === "codex") {
        const { xaiKey, sourcegraphToken, openAiApiKey } = await setupCodexEnv(
          root,
          configDir,
          options.yes,
        );
        newEnv = {
          ...newEnv,
          ...(sourcegraphToken !== undefined && {
            SOURCEGRAPH_TOKEN: sourcegraphToken,
          }),
          ...(xaiKey && { XAI_API_KEY: xaiKey }),
          ...(openAiApiKey && { OPENAI_API_KEY: openAiApiKey }),
        };
      } else {
        const envResult = await setupEnv(
          root,
          configDir,
          options.yes,
          options.provider as GooseProviderName,
          options.model,
        );
        providerDisplay = envResult.provider;
        modelDisplay = envResult.model;
        const providerConfig = await getProviderConfig(envResult.provider);
        newEnv = {
          ...newEnv,
          GOOSE_PROVIDER: envResult.provider,
          GOOSE_MODEL: envResult.model,
          ...(envResult.providerApiKey && {
            [providerConfig.keyEnv]: envResult.providerApiKey,
          }),
          SOURCEGRAPH_TOKEN: envResult.sourcegraphToken || "",
          ...(envResult.xaiKey && envResult.provider !== "xai" && {
            XAI_API_KEY: envResult.xaiKey,
          }),
          TOOL: tool,
        };
      }

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
      const codexVolumeName = `codex-configs`;
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
      if (tool === "claude") {
        const mcpConfigPath = await syncClaudeProjectMcpConfig(workspacePath);
        ux.info(`Updated Claude project MCP config at ${mcpConfigPath}`);
        await ux.withSpinner(
          "Preparing Claude volume...",
          async (spinner: Spinner) => {
            spinner.message = pc.cyan(`Ensuring volume ${claudeVolumeName}...`);
            const syncState = await syncClaudeHomeVolume(
              claudeVolumeName,
              image,
              CLAUDE_HOME_SEED_VERSION,
            );
            if (syncState === "created") {
              spinner.message = pc.cyan("Seeded Claude home runtime assets...");
            } else if (syncState === "updated") {
              spinner.message = pc.cyan(
                "Refreshed Claude home runtime assets...",
              );
            } else {
              spinner.message = pc.cyan("Reusing existing Claude volume...");
            }
          },
        );
      } else if (tool === "codex") {
        await ux.withSpinner(
          "Preparing Codex volume...",
          async (spinner: Spinner) => {
            spinner.message = pc.cyan(`Ensuring volume ${codexVolumeName}...`);
            const syncState = await syncCodexHomeVolume(
              codexVolumeName,
              image,
              CODEX_HOME_SEED_VERSION,
            );
            if (syncState === "created") {
              spinner.message = pc.cyan("Seeded Codex home runtime assets...");
            } else if (syncState === "updated") {
              spinner.message = pc.cyan(
                "Refreshed Codex home runtime assets...",
              );
            } else {
              spinner.message = pc.cyan("Reusing existing Codex volume...");
            }
          },
        );
        const codexConfigPath = await syncCodexConfigVolume(
          codexVolumeName,
          image,
        );
        ux.info(`Updated Codex MCP config at ${codexConfigPath}`);
      }
      if (tool === "goose") {
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
        tool === "claude"
          ? claudeVolumeName
          : tool === "codex"
          ? codexVolumeName
          : volumeName,
        providerDisplay,
        modelDisplay,
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
        codexVolumeName,
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

      ux.info("Launching or attaching to tool container...");
      await runGooseDocker(fullCmd);

      // Sync back any configuration changes made during the session
      if (tool === "goose") {
        await pullConfigFromVolume(stagingPath, volumeName);
      }
    })
    .parse(Deno.args);
}

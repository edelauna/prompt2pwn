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
      flag: options.pwnChallenge,
      prompt: "Challenge description (req)",
      key: "challenge_description",
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
// Robust root detection: always use project root
const root = dirname(
  Deno.args.includes("--dev")
    ? dirname(new URL(import.meta.url).pathname)
    : Deno.execPath(),
);

const configDir = join(Deno.env.get("HOME") || ".", ".config/prompt2pwn");

export async function runCli() {
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
    .option("--pwn-challenge <desc:string>", "CTF challenge description")
    .option("--pwn-target <url:string>", "Target URL/IP")
    .option("--pwn-info <extra:string>", "Additional info/hints")
    .option(
      "--provider <provider:string>",
      "Set Goose provider (xai, google, openai, anthropic)",
    )
    .option("--model <model:string>", "Override Goose model (e.g., gemini-pro)")
    .arguments("[...extraArgs]")
    .stopEarly()
    .action(async (opts, ...extraArgs) => {
      const options = opts as LaunchOptions;
      if (options.verbose) {
        ux.info("Verbose mode enabled");
        ux.info(`[DEBUG] Full opts: ${JSON.stringify(opts)}`);
        ux.info(
          `[DEBUG] Provider flag: ${
            options.provider || "undefined"
          }, Model flag: ${options.model || "undefined"}`,
        );
      }

      const fullExtraArgs = await prepareCTFArgs(options, extraArgs);
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
      await orchestrateLaunchPrep(
        options,
        stagingPath,
        root,
        configDir,
        envPath,
        volumeName,
      );
      await syncRecipesToVolume(stagingPath, volumeName);
      ux.success("✔ Environment Prepared.");
      showLaunchPreview(
        options,
        workspacePath,
        stagingPath,
        volumeName,
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
      await pullConfigFromVolume(stagingPath, volumeName);
    })
    .parse(Deno.args);
}

import { ux } from "./ux.ts";
import type { Spinner } from "@std/cli/unstable-spinner";
import pc from "picocolors";

export async function getComposeCmd() {
  try {
    const process = new Deno.Command("docker", {
      args: ["compose", "version"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success } = await process.output();
    return success ? ["docker", "compose"] : ["docker-compose"];
  } catch {
    return ["docker-compose"];
  }
}

export async function runPreflight(
  configDir: string,
  verbose = false,
  spinner?: Spinner,
  envFile?: string,
) {
  try {
    // 1. Check for shared network
    const netRes = await new Deno.Command("docker", {
      args: ["network", "inspect", "goose-shared-net"],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!netRes.success) {
      if (spinner) spinner.message = pc.cyan("Starting mcp-xai services...");
      const composeCmd = await getComposeCmd();

      // Try to up with remote image first (default in compose)
      const upArgs = envFile
        ? [
          ...composeCmd.slice(1),
          "-f",
          "docker-compose.yml",
          "up",
          "-d",
          "--env-file",
          envFile,
        ]
        : [...composeCmd.slice(1), "-f", "docker-compose.yml", "up", "-d"];
      const up = new Deno.Command(composeCmd[0], {
        args: upArgs,
        cwd: configDir,
        stderr: "piped",
      });
      const upRes = await up.output();

      if (!upRes.success) {
        const err = new TextDecoder().decode(upRes.stderr);
        if (err.includes("pull access denied") || err.includes("not found")) {
          if (spinner) {
            spinner.message = pc.yellow("Using local build fallback...");
          }
          const buildUpArgs = envFile
            ? [
              ...composeCmd.slice(1),
              "-f",
              "docker-compose.yml",
              "up",
              "-d",
              "--build",
              "--env-file",
              envFile,
            ]
            : [
              ...composeCmd.slice(1),
              "-f",
              "docker-compose.yml",
              "up",
              "-d",
              "--build",
            ];
          const buildUp = new Deno.Command(composeCmd[0], {
            args: buildUpArgs,
            cwd: configDir,
          });
          const buildRes = await buildUp.output();
          if (!buildRes.success) {
            const buildErr = new TextDecoder().decode(buildRes.stderr);
            throw new Error(
              `Failed to build/start services locally: ${buildErr}`,
            );
          }
        } else {
          throw new Error(`Failed to start services: ${err}`);
        }
      }
    }

    // 2. Check for required images
    const images = [
      Deno.env.get("GOOSE_IMAGE") || "edelauna/goose-dind:latest",
      "edelauna/mcp-xai:latest",
    ];

    for (const img of images) {
      const imgCheck = await new Deno.Command("docker", {
        args: ["image", "inspect", img],
        stdout: "piped",
        stderr: "piped",
      }).output();

      if (!imgCheck.success && verbose) {
        ux.gray(`  Image ${img} will be fetched on demand.`);
      }
    }
  } catch (e) {
    throw e;
  }
}

import { ux } from "./ux.ts";
import { dirname, join } from "path";
import pc from "picocolors";
import type { Spinner } from "@std/cli/unstable-spinner";

export async function ensureDockerCompose(
  configDir: string,
  spinner?: { message: string },
) {
  const composeUrl = new URL("../docker-compose.yml", import.meta.url);
  const targetPath = join(configDir, "docker-compose.yml");

  try {
    const content = await Deno.readTextFile(composeUrl);
    await Deno.writeTextFile(targetPath, content);
    if (spinner) {
      spinner.message = pc.cyan("Shipped docker-compose.yml from binary...");
    } else {
      ux.info("Shipped docker-compose.yml from binary");
    }
  } catch (err) {
    if (!(err instanceof Deno.errors.NotFound)) {
      const message = err instanceof Error ? err.message : String(err);
      ux.error(`Failed to ship docker-compose.yml: ${message}`);
    }
  }
}

export async function initVolume(
  volumeName: string,
  stagingPath: string,
  spinner: Spinner,
) {
  spinner.message = pc.cyan("Initializing Docker volume...");
  const inspectRes = await new Deno.Command("docker", {
    args: ["volume", "inspect", volumeName],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!inspectRes.success) {
    await new Deno.Command("docker", {
      args: ["volume", "create", volumeName],
    }).output();
  }

  // Seed if no config.yaml is missing
  const hasConfig = await new Deno.Command("docker", {
    args: [
      "run",
      "--rm",
      "-v",
      `${volumeName}:/cfg:ro`,
      "alpine",
      "test",
      "-f",
      "/cfg/config.yaml",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output().then((s) => s.success);

  if (!hasConfig) {
    spinner.message = pc.cyan("Seeding volume from staging...");
    await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        "-v",
        `${stagingPath}:/host`,
        "-v",
        `${volumeName}:/target`,
        "alpine",
        "sh",
        "-c",
        `cp -a /host/. /target/`,
      ],
    }).output();
  }
}

export async function resolveGooseImage(
  root: string,
  image?: string,
): Promise<string> {
  const finalImage = image || "edelauna/goose-dind:latest";

  const hasImageLocally = await new Deno.Command("docker", {
    args: ["image", "inspect", finalImage],
    stdout: "piped",
    stderr: "piped",
  }).output().then((o) => o.success);

  if (!hasImageLocally) {
    let pullSuccess = false;
    await ux.withSpinner(
      `Pulling remote image: ${finalImage}`,
      async (spinner) => {
        const p = new Deno.Command("docker", {
          args: ["pull", finalImage],
          stdout: "piped",
          stderr: "piped",
        });
        const { success } = await p.output();
        pullSuccess = success;
        if (!success) {
          spinner.message = pc.yellow(
            `Pull failed. Checking local build fallback...`,
          );
        }
      },
    );

    if (!pullSuccess) {
      // Check for Dockerfile.goose in root or CWD
      const possiblePaths = [
        join(root, "Dockerfile.goose"),
        join(Deno.cwd(), "Dockerfile.goose"),
      ];

      let dockerfilePath = "";
      for (const p of possiblePaths) {
        try {
          if ((await Deno.stat(p)).isFile) {
            dockerfilePath = p;
            break;
          }
        } catch { /* ignore */ }
      }

      if (dockerfilePath) {
        const contextDir = dirname(dockerfilePath);
        await ux.withSpinner(
          `Building local image: ${finalImage}`,
          async () => {
            const p = new Deno.Command("docker", {
              args: [
                "build",
                "-t",
                finalImage,
                "-f",
                dockerfilePath,
                contextDir,
              ],
              stdout: "piped",
              stderr: "piped",
            });
            const { success, stderr } = await p.output();
            if (!success) {
              ux.error(
                `Local build failed: ${new TextDecoder().decode(stderr)}`,
              );
              Deno.exit(1);
            }
          },
        );
        ux.success(`✔ Built local fallback: ${finalImage}`);
      } else {
        ux.error(
          `Image ${finalImage} not found and no local Dockerfile.goose at ${dockerfilePath}`,
        );
        ux.info(
          "Please ensure you are logged in to Docker Hub or have the source code available.",
        );
        Deno.exit(1);
      }
    }
  }

  return finalImage;
}

export async function runGooseDocker(fullCmd: string[]) {
  ux.magenta("\n--- Goose Session Starting ---\n");

  const args = fullCmd.slice(1);
  const nameIdx = args.indexOf("--name");
  if (nameIdx === -1 || nameIdx + 1 >= args.length) {
    // Fallback to plain run
    const process = new Deno.Command(fullCmd[0], {
      args: fullCmd.slice(1),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const status = await process.output();
    if (!status.success) {
      ux.error(`Goose exited with code: ${status.code}`);
      Deno.exit(status.code);
    }
    return;
  }

  const containerName = args[nameIdx + 1];

  // Check if container exists and its state
  const inspectRes = await new Deno.Command("docker", {
    args: ["inspect", "-f", "{{.State.Running}}", containerName],
    stdout: "piped",
    stderr: "piped",
  }).output();

  if (inspectRes.success) {
    const running =
      new TextDecoder().decode(inspectRes.stdout).trim() === "true";
    if (running) {
      ux.info(`Attaching to running Goose container: ${containerName}`);
      const process = new Deno.Command("docker", {
        args: ["attach", containerName],
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      const status = await process.output();
      if (!status.success) {
        ux.error(`Docker attach failed with code: ${status.code}`);
        Deno.exit(status.code);
      }
      return;
    } else {
      // Stopped container may lack a PTY or be from an old image — remove and run fresh.
      ux.info(`Removing stale stopped container: ${containerName}`);
      await new Deno.Command("docker", {
        args: ["rm", "-f", containerName],
        stdout: "piped",
        stderr: "piped",
      }).output();
    }
  }

  ux.info(`Starting new Goose container: ${containerName}`);

  // Normal run
  const process = new Deno.Command(fullCmd[0], {
    args: fullCmd.slice(1),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await process.output();
  if (!status.success) {
    ux.error(`Goose exited with code: ${status.code}`);
    Deno.exit(status.code);
  }
}

export async function cleanupOldVolumes() {
  try {
    // List all Docker volumes with creation time
    const listRes = await new Deno.Command("docker", {
      args: ["volume", "ls", "--format", "{{.Name}}\t{{.CreatedAt}}"],
      stdout: "piped",
      stderr: "piped",
    }).output();

    if (!listRes.success) {
      ux.warn("Failed to list Docker volumes for cleanup");
      return;
    }

    const lines = new TextDecoder().decode(listRes.stdout).trim().split("\n");
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    for (const line of lines) {
      const [volume, createdAtStr] = line.split("\t");
      if (!volume.startsWith("goose-docker-cache-")) continue;

      const createdAt = new Date(createdAtStr);
      if (createdAt < thirtyDaysAgo) {
        ux.info(`Removing old volume: ${volume} (created ${createdAtStr})`);
        const rmRes = await new Deno.Command("docker", {
          args: ["volume", "rm", volume],
          stdout: "piped",
          stderr: "piped",
        }).output();
        if (!rmRes.success) {
          ux.warn(
            `Failed to remove volume ${volume}: ${
              new TextDecoder().decode(rmRes.stderr)
            }`,
          );
        }
      }
    }
  } catch (error) {
    ux.warn(`Volume cleanup failed: ${error}`);
  }
}

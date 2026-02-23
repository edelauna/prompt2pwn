import { join } from "path";
import { ux } from "./ux.ts";
import { getComposeCmd } from "./preflight.ts";
import { computeFileHash } from "./utils.ts";

export async function manageMcpSidecar(
  configDir: string,
  action: "down" | "restart",
  envPath?: string,
): Promise<boolean> {
  const composeCmd = await getComposeCmd();
  // Ship the docker-compose.yml to configDir
  const composeUrl = new URL("../docker-compose.yml", import.meta.url);
  const composeContent = await Deno.readTextFile(composeUrl);
  const composeFile = join(configDir, "docker-compose.yml");
  await Deno.writeTextFile(composeFile, composeContent);

  if (action === "down") {
    const downArgs = ["-f", composeFile, "down"];
    const down = new Deno.Command(composeCmd[0], {
      args: [...composeCmd.slice(1), ...downArgs],
      cwd: configDir,
    });
    const res = await down.output();
    if (res.success) {
      ux.success("✔ MCP sidecar stopped and cleaned up.");
    } else {
      ux.error(
        `Failed to stop services: ${new TextDecoder().decode(res.stderr)}`,
      );
      Deno.exit(1);
    }
    return false;
  } else if (action === "restart") {
    if (!envPath) throw new Error("envPath required for restart");

    const statePath = join(configDir, "mcp-state.json");
    const currentHash = await computeFileHash(envPath);
    let needsRestart = true;
    try {
      const state = JSON.parse(await Deno.readTextFile(statePath));
      if (state.envHash === currentHash) {
        // Check if running
        const ps = await new Deno.Command("docker", {
          args: [
            "ps",
            "--filter",
            "name=mcp-xai-global",
            "--format",
            "{{.Names}}",
          ],
          stdout: "piped",
        }).output();
        const running =
          new TextDecoder().decode(ps.stdout).trim() === "mcp-xai-global";
        needsRestart = !running;
      }
    } catch {
      // No state or error, restart
    }

    if (needsRestart) {
      ux.info("Restarting MCP sidecar due to env changes...");
      // Down
      const downArgs = ["-f", composeFile, "down"];
      const down = new Deno.Command(composeCmd[0], {
        args: [...composeCmd.slice(1), ...downArgs],
        cwd: configDir,
      });
      await down.output();
      // Up
      const upArgs = ["-f", composeFile, "up", "-d"];
      const up = new Deno.Command(composeCmd[0], {
        args: [...composeCmd.slice(1), ...upArgs],
        cwd: configDir,
      });
      const upRes = await up.output();
      if (!upRes.success) {
        ux.error(
          `Failed to start MCP sidecar: ${
            new TextDecoder().decode(upRes.stderr)
          }`,
        );
        Deno.exit(1);
      }
      // Save state
      await Deno.writeTextFile(
        statePath,
        JSON.stringify({ envHash: currentHash }),
      );
      ux.success("✔ MCP sidecar restarted.");
    }
    return needsRestart;
  }
  return false;
}

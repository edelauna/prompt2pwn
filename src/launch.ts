import { Table } from "@cliffy/table";
import { ux } from "./ux.ts";
import { LaunchOptions } from "./types.ts";
import { basename } from "path";

export function showLaunchPreview(
  options: LaunchOptions,
  workspacePath: string,
  stagingPath: string,
  volumeName: string,
  provider: string,
  model?: string,
) {
  ux.info(ux.bold("\n🚀 Launch Configuration"));
  new Table()
    .header([ux.bold("Property"), ux.bold("Value")])
    .body([
      ["Workspace", workspacePath],
      ["Staging", stagingPath],
      ["Volume", volumeName],
      ["Tool", options.tool || "goose"],
      ["Privileged", options.noPriv ? "No" : "Yes"],
      ["Launch File", options.launchFile || "None"],
      ["Provider", provider],
      ["Model", model || "Default"],
    ])
    .padding(2)
    .render();
}

export function buildLaunchCmd(
  options: LaunchOptions,
  workspacePath: string,
  volumeName: string,
  claudeVolumeName: string,
  dockerCacheVol: string,
  envPath: string,
  image: string,
  extraArgs: string[],
): string[] {
  const containerName = basename(workspacePath);
  const baseCmd = [
    "docker",
    "run",
    "--rm",
  ];
  if (!options.noPriv) {
    baseCmd.push("--privileged");
  }
  baseCmd.push(
    "--name",
    containerName,
    "-it",
    "--network",
    "goose-shared-net",
    "-v",
    `${workspacePath}:/workspace`,
  );
  const tool = options.tool || "goose";
  if (tool === "claude") {
    baseCmd.push("-e", "TOOL=claude");
    baseCmd.push("-v", `${claudeVolumeName}:/home/goose`);
  } else {
    baseCmd.push("-v", `${volumeName}:/home/goose/.config/goose`);
  }
  baseCmd.push("--env-file", envPath);
  if (options.launchFile) {
    baseCmd.push("-e", `GOOSE_LAUNCH_FILE=${options.launchFile}`);
    baseCmd.push("-v", `${dockerCacheVol}:/var/lib/docker`);
  }
  const fullCmd = [...baseCmd, image, ...extraArgs];
  return fullCmd;
}

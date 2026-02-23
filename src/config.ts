import { join } from "path";
import { stringify } from "yaml";
import { ux } from "./ux.ts";

export async function setupConfig(configPath: string, verbose = false) {
  const configFile = join(configPath, "config.yaml");
  if (!await Deno.stat(configFile).catch(() => false)) {
    if (verbose) ux.info("Seeding MCP config...");
    const template = {
      extensions: {
        apps: {
          enabled: false,
          type: "platform",
          name: "apps",
          description:
            "Create and manage custom Goose apps through chat. Apps are HTML/CSS/JavaScript and run in sandboxed windows.",
          display_name: "Apps",
          bundled: true,
          available_tools: [],
        },
        skills: {
          enabled: false,
          type: "platform",
          name: "skills",
          description: "Load and use skills from relevant directories",
          display_name: "Skills",
          bundled: true,
          available_tools: [],
        },
        extensionmanager: {
          enabled: false,
          type: "platform",
          name: "Extension Manager",
          description:
            "Enable extension management tools for discovering, enabling, and disabling extensions",
          display_name: "Extension Manager",
          bundled: true,
          available_tools: [],
        },
        search: {
          enabled: true,
          type: "streamable_http",
          name: "search",
          description:
            "A multi-source intelligence engine providing real-time access to the open web, social media trends on X (Twitter), and deep semantic code search via Sourcegraph. Use this extension to bridge the gap between current events, social sentiment, and technical implementation.",
          uri: "http://mcp-xai:1337/mcp",
          envs: {},
          env_keys: [],
          headers: {},
          timeout: 300,
          bundled: null,
          available_tools: [],
        },
        developer: {
          enabled: true,
          type: "builtin",
          name: "developer",
          description: "Code editing and shell access",
          display_name: "Developer Tools",
          timeout: 120,
          bundled: true,
          available_tools: [],
        },
      },
      GOOSE_TELEMETRY_ENABLED: false,
    };
    await Deno.writeTextFile(configFile, stringify(template, { indent: 2 }));
    if (Deno.build.os !== "windows") {
      await Deno.chmod(configFile, 0o666);
    }
    if (verbose) ux.success(`Created ${configFile}`);
  }
}

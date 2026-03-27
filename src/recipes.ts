import { basename, dirname, join } from "path";
import { ensureDir } from "fs/ensure_dir";
import { ux } from "./ux.ts";
import { walk } from "fs/walk";

export async function seedRecipes(
  stagingPath: string,
  root: string,
): Promise<string> {
  let seededType = "";
  const stagingRecipesDir = join(stagingPath, "recipes");
  try {
    for await (const entry of walk(stagingRecipesDir, { maxDepth: 1 })) {
      if (entry.isFile && entry.name.endsWith(".yaml")) {
        return "existing";
      }
    }
  } catch {
    // Ignore missing staging dir; first-run seeding continues below.
  }
  // External recipes (next to binary/source)
  const recipesDir = join(root, "recipes");
  try {
    const stat = await Deno.stat(recipesDir);
    if (stat.isDirectory) {
      for await (const entry of walk(recipesDir, { maxDepth: 1 })) {
        if (entry.isFile && entry.name.endsWith(".yaml")) {
          const dst = join(stagingPath, "recipes", basename(entry.path));
          await ensureDir(dirname(dst));
          await Deno.copyFile(entry.path, dst);
        }
      }
      seededType = "external";
    }
  } catch { /* ignore */ }
  // Bundled fallback (hardcoded for compile --include)
  if (!seededType) {
    const bundledFiles = [
      "./recipes/ctf-orchestrator.yaml",
    ];
    for (const relPath of bundledFiles) {
      try {
        const content = await Deno.readTextFile(relPath);
        const filename = basename(relPath);
        const dst = join(stagingPath, "recipes", filename);
        await ensureDir(dirname(dst));
        await Deno.writeTextFile(dst, content);
        seededType = "bundled";
      } catch { /* ignore */ }
    }
  }
  return seededType;
}

async function chownVolume(volumeName: string, uid: number, gid: number) {
  await new Deno.Command("docker", {
    args: [
      "run",
      "--rm",
      `-v${volumeName}:/target`,
      "alpine",
      "sh",
      "-c",
      `chown -R ${uid}:${gid} /target 2>/dev/null || true`,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  // Ignore errors, as chown might fail if volume is empty or already owned
}

export async function syncVolume(
  stagingPath: string,
  volumeName: string,
  options: { config?: boolean; recipes?: boolean } = {
    config: true,
    recipes: true,
  },
) {
  const commands: string[] = [];
  if (options.config) {
    const configPath = join(stagingPath, "config.yaml");
    if (await Deno.stat(configPath).then((s) => s.isFile).catch(() => false)) {
      commands.push(
        "rm -f /target/config.yaml && cp /host/config.yaml /target/config.yaml",
      );
    }
  }
  if (options.recipes) {
    commands.push(
      'mkdir -p /target/recipes && if [ "$(ls -A /host/recipes 2>/dev/null)" ]; then cp -a /host/recipes/* /target/recipes/; fi',
    );
  }
  if (commands.length === 0) return;
  const stat = await Deno.stat(stagingPath);
  const uid = stat.uid ?? 1000;
  const gid = stat.gid ?? 1000;
  await chownVolume(volumeName, uid, gid);
  const result = await new Deno.Command("docker", {
    args: [
      "run",
      "--rm",
      `--user=${uid}:${gid}`,
      `-v${stagingPath}:/host`,
      `-v${volumeName}:/target`,
      "alpine",
      "sh",
      "-c",
      commands.join(" && "),
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    const stderr = new TextDecoder().decode(result.stderr);
    console.error(`Failed to sync volume: ${stderr}`);
    throw new Error(`Volume sync failed: ${stderr}`);
  }
}

export async function syncRecipesToVolume(
  stagingPath: string,
  volumeName: string,
) {
  await ensureDir(join(stagingPath, "recipes"));
  await ux.withSpinner("Syncing staging to volume...", async () => {
    await syncVolume(stagingPath, volumeName, { config: true, recipes: true });
  });
  ux.success("✅ Recipes synced to goose volume");
}

export async function pullConfigFromVolume(
  stagingPath: string,
  volumeName: string = "goose-configs",
) {
  await ux.withSpinner("Pulling config from volume...", async () => {
    const stat = await Deno.stat(stagingPath);
    const uid = stat.uid ?? 1000;
    const gid = stat.gid ?? 1000;
    const result = await new Deno.Command("docker", {
      args: [
        "run",
        "--rm",
        `--user=${uid}:${gid}`,
        `-v${stagingPath}:/host`,
        `-v${volumeName}:/target`,
        "alpine",
        "sh",
        "-c",
        "cp /target/config.yaml /host/config.yaml",
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!result.success) {
      const stderr = new TextDecoder().decode(result.stderr);
      ux.error(`Failed to pull config: ${stderr}`);
      throw new Error(`Pull config failed: ${stderr}`);
    }
  });
  ux.info("Config pulled from volume to staging");
}

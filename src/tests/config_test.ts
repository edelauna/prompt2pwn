import { assertEquals } from "std/assert";
import { setupConfig } from "../config.ts";
import { join } from "path";

Deno.test("setupConfig - creates config file if not exists", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await setupConfig(tempDir, false);
    const configFile = join(tempDir, "config.yaml");
    const stat = await Deno.stat(configFile);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("setupConfig - creates config file with verbose output", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    await setupConfig(tempDir, true);
    const configFile = join(tempDir, "config.yaml");
    const stat = await Deno.stat(configFile);
    assertEquals(stat.isFile, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

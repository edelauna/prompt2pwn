#!/usr/bin/env -S deno run -A

import { runCli } from "./src/cli.ts";

if (import.meta.main) {
  await runCli();
}

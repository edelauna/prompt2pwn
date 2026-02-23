import { assert, assertEquals } from "std/assert";
import {
  pullConfigFromVolume,
  seedRecipes,
  syncRecipesToVolume,
} from "../recipes.ts";
import { buildLaunchCmd, showLaunchPreview } from "../launch.ts";
import { LaunchOptions } from "../types.ts";
import { ux } from "../ux.ts";
import { Table as _Table } from "@cliffy/table";

Deno.test("seedRecipes - no recipes", async () => {
  const originalStat = Deno.stat;
  // @ts-ignore: overriding readonly property for testing
  Deno.stat = async () => {
    throw new Deno.errors.NotFound("not found");
  };
  try {
    const result = await seedRecipes("/staging", "/root");
    assertEquals(result, "");
  } finally {
    Deno.stat = originalStat;
  }
});

Deno.test("seedRecipes - staging has existing recipes", async () => {
  const stagingPath = "/staging";
  const rootPath = "/root";

  const originalReadDir = Deno.readDir;
  (Deno as any).readDir = function (_path: string) {
    const entries = [{
      isFile: true,
      isDirectory: false,
      name: "existing.yaml",
      isSymlink: false,
    }];
    return {
      [Symbol.iterator]() {
        return entries[Symbol.iterator]();
      },
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next() {
            if (i < entries.length) {
              return Promise.resolve({ value: entries[i++], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  };

  // walk also calls lstat for each entry
  const originalLstat = Deno.lstat;
  (Deno as any).lstat = async () => ({
    isFile: true,
    isDirectory: false,
    isSymlink: false,
  });

  // seedRecipes in recipes.ts:13 calls walk which might be using stat or lstat
  const originalStatStub = Deno.stat;
  (Deno as any).stat = async () => ({
    isFile: true,
    isDirectory: false,
    isSymlink: false,
  });

  try {
    const result = await seedRecipes(stagingPath, rootPath);
    assertEquals(result, "existing");
  } finally {
    (Deno as any).readDir = originalReadDir;
    (Deno as any).lstat = originalLstat;
    (Deno as any).stat = originalStatStub;
  }
});

Deno.test("seedRecipes - external recipes", async () => {
  const originalReadDir = Deno.readDir;
  const originalStat = Deno.stat;

  (Deno as any).readDir = function (path: string) {
    const entries: any[] = [];
    if (path.includes("root")) {
      entries.push({
        isFile: true,
        isDirectory: false,
        name: "external.yaml",
        isSymlink: false,
      });
    }
    return {
      [Symbol.iterator]() {
        return entries[Symbol.iterator]();
      },
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next() {
            if (i < entries.length) {
              return Promise.resolve({ value: entries[i++], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  };

  const originalLstat = Deno.lstat;
  (Deno as any).lstat = async () => ({
    isFile: true,
    isDirectory: false,
    isSymlink: false,
  });

  (Deno as any).stat = async (path: string) => {
    if (path.includes("recipes")) {
      return { isDirectory: true, isFile: false };
    }
    throw new Deno.errors.NotFound();
  };

  const originalCopyFile = Deno.copyFile;
  (Deno as any).copyFile = async () => {};

  const originalMkdir = Deno.mkdir;
  (Deno as any).mkdir = async () => {};

  try {
    const result = await seedRecipes("/staging", "/root");
    assertEquals(result, "external");
  } finally {
    (Deno as any).readDir = originalReadDir;
    Deno.stat = originalStat;
    (Deno as any).lstat = originalLstat;
    (Deno as any).copyFile = originalCopyFile;
    (Deno as any).mkdir = originalMkdir;
  }
});

Deno.test("seedRecipes - bundled fallback", async () => {
  const originalReadDir = Deno.readDir;
  const originalStat = Deno.stat;
  const originalReadTextFile = Deno.readTextFile;
  const originalWriteTextFile = Deno.writeTextFile;
  const originalMkdir = Deno.mkdir;

  (Deno as any).readDir = function (_path: string) {
    const entries: any[] = [];
    return {
      [Symbol.iterator]() {
        return entries[Symbol.iterator]();
      },
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          next() {
            if (i < entries.length) {
              return Promise.resolve({ value: entries[i++], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    };
  };

  (Deno as any).stat = async () => {
    throw new Deno.errors.NotFound();
  };

  (Deno as any).readTextFile = async () => "bundled content";
  (Deno as any).writeTextFile = async () => {};
  (Deno as any).mkdir = async () => {};

  try {
    const result = await seedRecipes("/staging", "/root");
    assertEquals(result, "bundled");
  } finally {
    (Deno as any).readDir = originalReadDir;
    Deno.stat = originalStat;
    (Deno as any).readTextFile = originalReadTextFile;
    (Deno as any).writeTextFile = originalWriteTextFile;
    (Deno as any).mkdir = originalMkdir;
  }
});

Deno.test("buildLaunchCmd - basic command", () => {
  const options: LaunchOptions = {
    launchFile: undefined,
    noPriv: false,
    verbose: false,
    yes: false,
  };
  const cmd = buildLaunchCmd(
    options,
    "/workspace",
    "volume",
    "docker-vol",
    "/env",
    "image",
    ["arg1", "arg2"],
  );
  assertEquals(cmd, [
    "docker",
    "run",
    "--rm",
    "--privileged",
    "--name",
    "workspace",
    "-it",
    "--network",
    "goose-shared-net",
    "-v",
    "/workspace:/workspace",
    "-v",
    "volume:/home/goose/.config/goose",
    "--env-file",
    "/env",
    "image",
    "arg1",
    "arg2",
  ]);
});

Deno.test("buildLaunchCmd - with launch file", () => {
  const options: LaunchOptions = {
    launchFile: "file",
    noPriv: true,
    verbose: false,
    yes: false,
  };
  const cmd = buildLaunchCmd(
    options,
    "/workspace",
    "volume",
    "docker-vol",
    "/env",
    "image",
    [],
  );
  assertEquals(cmd.includes("--privileged"), false);
  assertEquals(cmd.includes("-e"), true);
  assertEquals(cmd.includes("docker-vol:/var/lib/docker"), true);
});

Deno.test("buildLaunchCmd - privileged and no launch file", () => {
  const options: LaunchOptions = {
    launchFile: undefined,
    noPriv: false,
    verbose: false,
    yes: false,
  };
  const cmd = buildLaunchCmd(
    options,
    "/workspace",
    "volume",
    "docker-vol",
    "/env",
    "image",
    [],
  );
  assertEquals(cmd.includes("--privileged"), true);
  assertEquals(cmd.includes("-e"), false);
  assertEquals(cmd.includes("docker-vol:/var/lib/docker"), false);
});

Deno.test("showLaunchPreview - calls ux.info", () => {
  const originalInfo = ux.info;
  let infoCalled = false;

  // @ts-ignore: overriding method for testing
  ux.info = () => {
    infoCalled = true;
  };

  try {
    const options: LaunchOptions = {
      launchFile: "file",
      noPriv: false,
      verbose: false,
      yes: false,
    };
    showLaunchPreview(options, "/ws", "/st", "vol", "prov", "model");
    assertEquals(infoCalled, true);
  } finally {
    ux.info = originalInfo;
  }
});

Deno.test("showLaunchPreview - noPriv true", () => {
  const originalInfo = ux.info;
  let infoCalled = false;

  // @ts-ignore: overriding method for testing
  ux.info = () => {
    infoCalled = true;
  };

  try {
    const options: LaunchOptions = {
      launchFile: "file",
      noPriv: true,
      verbose: false,
      yes: false,
    };
    showLaunchPreview(options, "/ws", "/st", "vol", "prov", "model");
    assertEquals(infoCalled, true);
  } finally {
    ux.info = originalInfo;
  }
});

Deno.test("buildLaunchCmd - with CTF recipe args", () => {
  const options: LaunchOptions = {
    launchFile: undefined,
    noPriv: false,
    verbose: false,
    yes: false,
  };
  const cmd = buildLaunchCmd(
    options,
    "/workspace",
    "volume",
    "docker-vol",
    "/env",
    "image",
    [
      "run",
      "--recipe",
      "ctf-orchestrator",
      "--params",
      "challenge_description=test",
    ],
  );
  assertEquals(cmd.slice(-5), [
    "run",
    "--recipe",
    "ctf-orchestrator",
    "--params",
    "challenge_description=test",
  ]);
});

Deno.test("syncRecipesToVolume - with config", async () => {
  const calls: string[][] = [];
  class MockCommand {
    constructor(exe: string, opts: { args: string[] }) {
      calls.push(opts.args);
    }
    async output() {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  }
  const originalCommand = Deno.Command;
  (Deno.Command as any) = MockCommand;
  // @ts-ignore
  const originalStat = Deno.stat;
  Deno.stat = async (path: any) => {
    if (typeof path === "string" && path === "/tmp/staging") {
      return Promise.resolve({
        uid: 1000,
        gid: 1000,
        isFile: () => false,
        isDirectory: () => true,
      } as any);
    }
    if (typeof path === "string" && path.endsWith("config.yaml")) {
      return Promise.resolve({
        isFile: () => true,
        isDirectory: () => false,
      } as any);
    }
    return Promise.reject(new Deno.errors.NotFound());
  };
  const spinnerCalls: string[] = [];
  const originalSpinner = ux.withSpinner;
  // @ts-ignore
  ux.withSpinner = async (msg: string, fn: (spinner: any) => Promise<any>) => {
    spinnerCalls.push(msg);
    await fn({});
  };
  try {
    await syncRecipesToVolume("/tmp/staging", "goose-configs");
    // Consolidated into one call with sh -c
    const consolidatedCall = calls.find((c) =>
      c.includes("sh") && c.includes("-c")
    );
    assert(consolidatedCall !== undefined, "Consolidated docker call missing");
    const shellCmd = consolidatedCall[consolidatedCall.indexOf("-c") + 1];
    assert(
      shellCmd.includes("cp /host/config.yaml"),
      "Config sync missing in shell cmd",
    );
    assert(
      shellCmd.includes("cp -a /host/recipes/*"),
      "Recipes sync missing in shell cmd",
    );
    assertEquals(spinnerCalls.length, 1);
  } finally {
    Deno.Command = originalCommand;
    Deno.stat = originalStat;
    ux.withSpinner = originalSpinner;
  }
});

Deno.test("syncRecipesToVolume - no config", async () => {
  const calls: string[][] = [];
  class MockCommand {
    constructor(exe: string, opts: { args: string[] }) {
      calls.push(opts.args);
    }
    async output() {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  }
  const originalCommand = Deno.Command;
  (Deno.Command as any) = MockCommand;
  // @ts-ignore
  const originalStat = Deno.stat;
  Deno.stat = async (path: any) => {
    if (typeof path === "string" && path === "/tmp/staging") {
      return Promise.resolve({
        uid: 1000,
        gid: 1000,
        isFile: () => false,
        isDirectory: () => true,
      } as any);
    }
    return Promise.reject(new Deno.errors.NotFound());
  };
  const spinnerCalls: string[] = [];
  const originalSpinner = ux.withSpinner;
  // @ts-ignore
  ux.withSpinner = async (msg: string, fn: (spinner: any) => Promise<any>) => {
    spinnerCalls.push(msg);
    await fn({});
  };
  try {
    await syncRecipesToVolume("/tmp/staging", "goose-configs");
    const consolidatedCall = calls.find((c) =>
      c.includes("sh") && c.includes("-c")
    );
    assert(consolidatedCall !== undefined, "Consolidated docker call missing");
    const shellCmd = consolidatedCall[consolidatedCall.indexOf("-c") + 1];
    assert(
      !shellCmd.includes("cp /host/config.yaml"),
      "Config sync should be missing",
    );
    assert(shellCmd.includes("cp -a /host/recipes/*"), "Recipes sync missing");
    assertEquals(spinnerCalls.length, 1);
  } finally {
    Deno.Command = originalCommand;
    Deno.stat = originalStat;
    ux.withSpinner = originalSpinner;
  }
});

Deno.test("pullConfigFromVolume", async () => {
  const calls: string[][] = [];
  class MockCommand {
    constructor(exe: string, opts: { args: string[] }) {
      calls.push(opts.args);
    }
    async output() {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  }
  const originalCommand = Deno.Command;
  (Deno.Command as any) = MockCommand;
  const spinnerCalls: string[] = [];
  const originalSpinner = ux.withSpinner;
  // @ts-ignore
  ux.withSpinner = async (msg: string, fn: (spinner: any) => Promise<any>) => {
    spinnerCalls.push(msg);
    await fn({});
  };
  try {
    await pullConfigFromVolume("/tmp/staging");
    const cpCall = calls.find((c) =>
      c.some((arg) => arg.includes("cp /target/config.yaml"))
    );
    assert(cpCall !== undefined, "cp call missing");
    assertEquals(spinnerCalls.length, 1);
  } finally {
    Deno.Command = originalCommand;
    ux.withSpinner = originalSpinner;
  }
});

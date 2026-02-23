import { assertEquals } from "std/assert";
import {
  cleanupOldVolumes,
  ensureDockerCompose,
  initVolume,
  resolveGooseImage,
  runGooseDocker,
} from "../docker.ts";
import { ux } from "../ux.ts";

Deno.test("ensureDockerCompose - copies file successfully", async () => {
  const originalReadTextFile = Deno.readTextFile;
  const originalWriteTextFile = Deno.writeTextFile;

  let readCalled = false;
  let writeCalled = false;

  Deno.readTextFile = async () => {
    readCalled = true;
    return "content";
  };

  Deno.writeTextFile = async () => {
    writeCalled = true;
  };

  try {
    await ensureDockerCompose("/tmp/test-config");
    assertEquals(readCalled, true);
    assertEquals(writeCalled, true);
  } finally {
    Deno.readTextFile = originalReadTextFile;
    Deno.writeTextFile = originalWriteTextFile;
  }
});

Deno.test("ensureDockerCompose - handles file not found", async () => {
  const originalReadFile = Deno.readFile;

  Deno.readFile = async () => {
    throw new Deno.errors.NotFound();
  };

  try {
    await ensureDockerCompose("/tmp/test-config");
    // Should not throw
  } finally {
    Deno.readFile = originalReadFile;
  }
});

Deno.test("ensureDockerCompose - handles other errors", async () => {
  const originalReadFile = Deno.readFile;

  Deno.readFile = async () => {
    throw new Deno.errors.PermissionDenied();
  };

  try {
    await ensureDockerCompose("/tmp/test-config");
    // Should not throw, but error is logged
  } finally {
    Deno.readFile = originalReadFile;
  }
});

Deno.test("ensureDockerCompose - with spinner", async () => {
  const originalReadTextFile = Deno.readTextFile;
  const originalWriteTextFile = Deno.writeTextFile;

  let readCalled = false;
  let writeCalled = false;
  const mockSpinner = { message: "" };

  Deno.readTextFile = async () => {
    readCalled = true;
    return "content";
  };

  Deno.writeTextFile = async () => {
    writeCalled = true;
  };

  try {
    await ensureDockerCompose("/tmp/test-config", mockSpinner);
    assertEquals(readCalled, true);
    assertEquals(writeCalled, true);
    assertEquals(
      mockSpinner.message.includes("Shipped docker-compose.yml from binary"),
      true,
    );
  } finally {
    Deno.readTextFile = originalReadTextFile;
    Deno.writeTextFile = originalWriteTextFile;
  }
});

Deno.test("runGooseDocker - runs command successfully", async () => {
  const originalCommand = Deno.Command;
  let spawned = false;

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      spawned = true;
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await runGooseDocker(["echo", "test"]);
    assertEquals(spawned, true);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runGooseDocker - handles command failure", async () => {
  const originalCommand = Deno.Command;
  const originalExit = Deno.exit;
  let exitCode: number | undefined;

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      return Promise.resolve({
        success: false,
        code: 1,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  Deno.exit = (code?: number) => {
    exitCode = code;
    throw new Error("Exit called");
  };

  try {
    await runGooseDocker(["failing", "command"]);
    // Should not reach here
    assertEquals(true, false);
  } catch (_err) {
    assertEquals(exitCode, 1);
  } finally {
    Deno.Command = originalCommand;
    Deno.exit = originalExit;
  }
});

Deno.test("initVolume - volume exists and has config", async () => {
  const originalCommand = Deno.Command;
  const mockSpinner = { message: "" };
  const commands: string[][] = [];

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      return Promise.resolve({ success: true });
    }
  };

  try {
    // @ts-ignore
    await initVolume("test-volume", "/tmp/staging", mockSpinner);
    assertEquals(commands.some((c) => c.includes("create")), false);
    assertEquals(commands.some((c) => c.includes("cp")), false);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("initVolume - volume needs creation and seeding", async () => {
  const originalCommand = Deno.Command;
  const mockSpinner = { message: "" };
  const commands: string[][] = [];

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("inspect")) {
        return Promise.resolve({ success: false });
      }
      if (lastCmd.includes("test")) {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    // @ts-ignore
    await initVolume("test-volume", "/tmp/staging", mockSpinner);
    assertEquals(commands.some((c) => c.includes("create")), true);
    assertEquals(
      commands.some((c) => c.some((arg) => arg.includes("cp"))),
      true,
    );
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("resolveGooseImage - image exists locally", async () => {
  const originalCommand = Deno.Command;
  const commands: string[][] = [];

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      return Promise.resolve({ success: true });
    }
  };

  try {
    const image = await resolveGooseImage("/tmp", "test-image");
    assertEquals(image, "test-image");
    assertEquals(commands.some((c) => c.includes("pull")), false);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("resolveGooseImage - pulls image", async () => {
  const originalCommand = Deno.Command;
  const originalWithSpinner = ux.withSpinner;
  const commands: string[][] = [];

  // @ts-ignore
  ux.withSpinner = async (_message, fn) => await fn({ message: "" });

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("inspect")) {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    const image = await resolveGooseImage("/tmp", "test-image");
    assertEquals(image, "test-image");
    assertEquals(commands.some((c) => c.includes("pull")), true);
  } finally {
    Deno.Command = originalCommand;
    ux.withSpinner = originalWithSpinner;
  }
});

Deno.test("resolveGooseImage - builds local fallback", async () => {
  const originalCommand = Deno.Command;
  const originalWithSpinner = ux.withSpinner;
  const originalStat = Deno.stat;
  const commands: string[][] = [];

  // @ts-ignore
  ux.withSpinner = async (_message, fn) => await fn({ message: "" });

  // @ts-ignore
  Deno.stat = async (path) => {
    if (typeof path === "string" && path.includes("Dockerfile.goose")) {
      return { isFile: true };
    }
    throw new Error("not found");
  };

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("inspect")) {
        return Promise.resolve({ success: false });
      }
      if (lastCmd.includes("pull")) {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    const image = await resolveGooseImage("/tmp", "test-image");
    assertEquals(image, "test-image");
    assertEquals(commands.some((c) => c.includes("pull")), true);
    assertEquals(commands.some((c) => c.includes("build")), true);
  } finally {
    Deno.Command = originalCommand;
    ux.withSpinner = originalWithSpinner;
    Deno.stat = originalStat;
  }
});

Deno.test("resolveGooseImage - exits on build failure", async () => {
  const originalCommand = Deno.Command;
  const originalWithSpinner = ux.withSpinner;
  const originalStat = Deno.stat;
  const originalExit = Deno.exit;
  const originalError = ux.error;
  const commands: string[][] = [];
  let exitCode: number | undefined;
  let errorMessage = "";

  // @ts-ignore
  ux.withSpinner = async (_message, fn) => await fn({ message: "" });

  // @ts-ignore
  Deno.stat = async (path) => {
    if (typeof path === "string" && path.includes("Dockerfile.goose")) {
      return { isFile: true };
    }
    throw new Error("not found");
  };

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("inspect")) {
        return Promise.resolve({ success: false });
      }
      if (lastCmd.includes("pull")) {
        return Promise.resolve({ success: false });
      }
      if (lastCmd.includes("build")) {
        return Promise.resolve({
          success: false,
          stderr: new TextEncoder().encode("Build failed"),
        });
      }
      return Promise.resolve({ success: true });
    }
  };

  Deno.exit = (code?: number) => {
    exitCode = code;
    throw new Error("Exit called");
  };

  ux.error = (msg: string) => {
    errorMessage = msg;
  };

  try {
    await resolveGooseImage("/tmp", "test-image");
    // Should not reach here
    assertEquals(true, false);
  } catch (_err) {
    assertEquals(exitCode, 1);
    assertEquals(errorMessage.includes("Local build failed"), true);
  } finally {
    Deno.Command = originalCommand;
    ux.withSpinner = originalWithSpinner;
    Deno.stat = originalStat;
    Deno.exit = originalExit;
    ux.error = originalError;
  }
});

Deno.test("resolveGooseImage - no local fallback available", async () => {
  const originalCommand = Deno.Command;
  const originalWithSpinner = ux.withSpinner;
  const originalStat = Deno.stat;
  const originalExit = Deno.exit;
  const originalError = ux.error;
  const originalInfo = ux.info;
  const commands: string[][] = [];
  let exitCode: number | undefined;
  let errorMessage = "";
  let infoMessage = "";

  // @ts-ignore
  ux.withSpinner = async (_message, fn) => await fn({ message: "" });

  // @ts-ignore
  Deno.stat = async (_path) => {
    throw new Error("not found");
  };

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("inspect")) {
        return Promise.resolve({ success: false });
      }
      if (lastCmd.includes("pull")) {
        return Promise.resolve({ success: false });
      }
      return Promise.resolve({ success: true });
    }
  };

  Deno.exit = (code?: number) => {
    exitCode = code;
    throw new Error("Exit called");
  };

  ux.error = (msg: string) => {
    errorMessage = msg;
  };

  ux.info = (msg: string) => {
    infoMessage = msg;
  };

  try {
    await resolveGooseImage("/tmp", "test-image");
    // Should not reach here
    assertEquals(true, false);
  } catch (_err) {
    assertEquals(exitCode, 1);
    assertEquals(
      errorMessage.includes("not found and no local Dockerfile.goose"),
      true,
    );
    assertEquals(
      infoMessage.includes("Please ensure you are logged in to Docker Hub"),
      true,
    );
  } finally {
    Deno.Command = originalCommand;
    ux.withSpinner = originalWithSpinner;
    Deno.stat = originalStat;
    Deno.exit = originalExit;
    ux.error = originalError;
    ux.info = originalInfo;
  }
});

Deno.test("cleanupOldVolumes - removes old volumes", async () => {
  const originalCommand = Deno.Command;
  const originalWarn = ux.warn;
  const commands: string[][] = [];
  let warnCalled = false;

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("ls")) {
        const output =
          "goose-docker-cache-old-volume\t2023-01-01T00:00:00Z\ngoose-docker-cache-new-volume\t2026-02-20T00:00:00Z\nother-volume\t2023-01-01T00:00:00Z\n";
        return Promise.resolve({
          success: true,
          stdout: new TextEncoder().encode(output),
        });
      }
      return Promise.resolve({ success: true });
    }
  };

  ux.warn = () => {
    warnCalled = true;
  };

  try {
    await cleanupOldVolumes();
    assertEquals(
      commands.some((c) =>
        c.includes("rm") && c.includes("goose-docker-cache-old-volume")
      ),
      true,
    );
    assertEquals(
      commands.some((c) =>
        c.includes("rm") && c.includes("goose-docker-cache-new-volume")
      ),
      false,
    );
    assertEquals(
      commands.some((c) => c.includes("rm") && c.includes("other-volume")),
      false,
    );
    assertEquals(warnCalled, false);
  } finally {
    Deno.Command = originalCommand;
    ux.warn = originalWarn;
  }
});

Deno.test("cleanupOldVolumes - no volumes to clean", async () => {
  const originalCommand = Deno.Command;
  const originalWarn = ux.warn;
  const commands: string[][] = [];
  let warnCalled = false;

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("ls")) {
        const output =
          "goose-docker-cache-new-volume\t2026-02-20T00:00:00Z\nother-volume\t2026-02-20T00:00:00Z\n";
        return Promise.resolve({
          success: true,
          stdout: new TextEncoder().encode(output),
        });
      }
      return Promise.resolve({ success: true });
    }
  };

  ux.warn = () => {
    warnCalled = true;
  };

  try {
    await cleanupOldVolumes();
    assertEquals(commands.some((c) => c.includes("rm")), false);
    assertEquals(warnCalled, false);
  } finally {
    Deno.Command = originalCommand;
    ux.warn = originalWarn;
  }
});

Deno.test("cleanupOldVolumes - handles docker command failure", async () => {
  const originalCommand = Deno.Command;
  const originalWarn = ux.warn;
  let warnCalled = false;
  let warnMessage = "";

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      // volume ls command
    }
    output() {
      return Promise.resolve({ success: false });
    }
  };

  ux.warn = (msg: string) => {
    warnCalled = true;
    warnMessage = msg;
  };

  try {
    await cleanupOldVolumes();
    assertEquals(warnCalled, true);
    assertEquals(warnMessage.includes("Failed to list Docker volumes"), true);
  } finally {
    Deno.Command = originalCommand;
    ux.warn = originalWarn;
  }
});

Deno.test("cleanupOldVolumes - handles volume removal failure", async () => {
  const originalCommand = Deno.Command;
  const originalWarn = ux.warn;
  const commands: string[][] = [];
  let warnCalled = false;
  let warnMessage = "";

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("ls")) {
        const output = "goose-docker-cache-old-volume\t2023-01-01T00:00:00Z\n";
        return Promise.resolve({
          success: true,
          stdout: new TextEncoder().encode(output),
        });
      }
      if (lastCmd.includes("rm")) {
        return Promise.resolve({
          success: false,
          stderr: new TextEncoder().encode("Volume not found"),
        });
      }
      return Promise.resolve({ success: true });
    }
  };

  ux.warn = (msg: string) => {
    warnCalled = true;
    warnMessage = msg;
  };

  try {
    await cleanupOldVolumes();
    assertEquals(commands.some((c) => c.includes("rm")), true);
    assertEquals(warnCalled, true);
    assertEquals(warnMessage.includes("Failed to remove volume"), true);
  } finally {
    Deno.Command = originalCommand;
    ux.warn = originalWarn;
  }
});

Deno.test("runGooseDocker - attaches to running container with --name", async () => {
  const originalCommand = Deno.Command;
  const commands: string[][] = [];

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("inspect")) {
        return Promise.resolve({
          success: true,
          stdout: new TextEncoder().encode("true\n"),
        });
      }
      if (lastCmd.includes("attach")) {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    await runGooseDocker([
      "docker",
      "run",
      "--name",
      "test-container",
      "image",
    ]);
    assertEquals(
      commands.some((c) =>
        c.includes("inspect") && c.includes("test-container")
      ),
      true,
    );
    assertEquals(
      commands.some((c) =>
        c.includes("attach") && c.includes("test-container")
      ),
      true,
    );
  } finally {
    Deno.Command = originalCommand;
  }
});

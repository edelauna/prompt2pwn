import { assertEquals, assertRejects } from "std/assert";
import { getComposeCmd, runPreflight } from "../preflight.ts";
import { ux } from "../ux.ts";

Deno.test("getComposeCmd - returns docker compose when available", async () => {
  const originalCommand = Deno.Command;
  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(_cmd: string, _options: any) {}
    output() {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    const cmd = await getComposeCmd();
    assertEquals(cmd, ["docker", "compose"]);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("getComposeCmd - falls back to docker-compose when docker compose fails", async () => {
  const originalCommand = Deno.Command;
  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(_cmd: string, _options: any) {}
    output() {
      return Promise.resolve({
        success: false,
        code: 1,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    const cmd = await getComposeCmd();
    assertEquals(cmd, ["docker-compose"]);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("getComposeCmd - falls back to docker-compose on exception", async () => {
  const originalCommand = Deno.Command;
  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(_cmd: string, _options: any) {}
    output() {
      throw new Error("command not found");
    }
  };

  try {
    const cmd = await getComposeCmd();
    assertEquals(cmd, ["docker-compose"]);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runPreflight - successfully detects existing network", async () => {
  const originalCommand = Deno.Command;
  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(_cmd: string, _options: any) {}
    output() {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await runPreflight("/tmp/test-config", false);
    assertEquals(true, true);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runPreflight - handles network not found and starts services", async () => {
  const originalCommand = Deno.Command;
  const commandsRun: string[] = [];

  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      commandsRun.push(`${this.cmd} ${this.args.join(" ")}`);
      if (
        this.cmd === "docker" && this.args[0] === "network" &&
        this.args[1] === "inspect"
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        });
      }
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await runPreflight("/tmp/test-config", false);
    assertEquals(commandsRun.some((c) => c.includes("network inspect")), true);
    assertEquals(commandsRun.some((c) => c.includes("up -d")), true);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runPreflight - handles pull access denied and builds locally", async () => {
  const originalCommand = Deno.Command;
  const commandsRun: string[] = [];

  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      commandsRun.push(`${this.cmd} ${this.args.join(" ")}`);
      if (
        this.cmd === "docker" && this.args[0] === "network" &&
        this.args[1] === "inspect"
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        });
      }
      if (
        this.args.includes("up") && this.args.includes("-d") &&
        !this.args.includes("--build")
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new TextEncoder().encode(""),
          stderr: new TextEncoder().encode("pull access denied"),
        });
      }
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await runPreflight("/tmp/test-config", false);
    assertEquals(commandsRun.some((c) => c.includes("up -d --build")), true);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runPreflight - throws on up failure not due to pull access", async () => {
  const originalCommand = Deno.Command;

  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      if (
        this.cmd === "docker" && this.args[0] === "network" &&
        this.args[1] === "inspect"
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        });
      }
      if (
        this.args.includes("up") && this.args.includes("-d") &&
        !this.args.includes("--build")
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new TextEncoder().encode(""),
          stderr: new TextEncoder().encode("some other error"),
        });
      }
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await assertRejects(
      async () => {
        await runPreflight("/tmp/test-config", false);
      },
      Error,
      "Failed to start services: some other error",
    );
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runPreflight - throws on build failure", async () => {
  const originalCommand = Deno.Command;

  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      if (
        this.cmd === "docker" && this.args[0] === "network" &&
        this.args[1] === "inspect"
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        });
      }
      if (
        this.args.includes("up") && this.args.includes("-d") &&
        !this.args.includes("--build")
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new TextEncoder().encode(""),
          stderr: new TextEncoder().encode("pull access denied"),
        });
      }
      if (
        this.args.includes("up") && this.args.includes("-d") &&
        this.args.includes("--build")
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new TextEncoder().encode(""),
          stderr: new TextEncoder().encode("build failed"),
        });
      }
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await assertRejects(
      async () => {
        await runPreflight("/tmp/test-config", false);
      },
      Error,
      "Failed to build/start services locally: build failed",
    );
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("runPreflight - handles verbose output for image checks", async () => {
  const originalCommand = Deno.Command;
  const commandsRun: string[] = [];

  // @ts-ignore: overriding readonly property for testing
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      this.cmd = cmd;
      this.args = options.args;
    }
    cmd: string;
    args: string[];

    output() {
      commandsRun.push(`${this.cmd} ${this.args.join(" ")}`);
      if (
        this.cmd === "docker" && this.args[0] === "network" &&
        this.args[1] === "inspect"
      ) {
        return Promise.resolve({
          success: true,
          code: 0,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        });
      }
      if (
        this.cmd === "docker" && this.args[0] === "image" &&
        this.args[1] === "inspect"
      ) {
        return Promise.resolve({
          success: false,
          code: 1,
          stdout: new Uint8Array(),
          stderr: new Uint8Array(),
        });
      }
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array(),
      });
    }
  };

  try {
    await runPreflight("/tmp/test-config", true);
    assertEquals(commandsRun.some((c) => c.includes("image inspect")), true);
  } finally {
    Deno.Command = originalCommand;
  }
});

Deno.test("ux.withSpinner - executes function and stops spinner", async () => {
  let executed = false;
  const result = await ux.withSpinner("test", async () => {
    executed = true;
    return "ok";
  });
  assertEquals(executed, true);
  assertEquals(result, "ok");
});

Deno.test("ux.withSpinner - handles errors", async () => {
  await assertRejects(
    async () => {
      await ux.withSpinner("test", async () => {
        throw new Error("fail");
      });
    },
    Error,
    "fail",
  );
});

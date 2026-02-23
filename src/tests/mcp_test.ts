import { assertEquals } from "std/assert";
import { manageMcpSidecar } from "../mcp.ts";

Deno.test("manageMcpSidecar - down", async () => {
  const originalCommand = Deno.Command;
  const originalWriteTextFile = Deno.writeTextFile;
  const commands: string[][] = [];

  // @ts-ignore
  Deno.writeTextFile = async () => {};

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
    const result = await manageMcpSidecar("/config", "down");
    assertEquals(result, false);
    assertEquals(commands.some((c) => c.includes("down")), true);
  } finally {
    Deno.Command = originalCommand;
    Deno.writeTextFile = originalWriteTextFile;
  }
});

Deno.test("manageMcpSidecar - restart when needed", async () => {
  const originalCommand = Deno.Command;
  const originalReadTextFile = Deno.readTextFile;
  const originalWriteTextFile = Deno.writeTextFile;
  const originalReadFile = Deno.readFile;
  const commands: string[][] = [];
  const files: Record<string, string> = {};

  // @ts-ignore
  Deno.readFile = async (_path) => {
    return new Uint8Array([1, 2, 3]); // mock env file content
  };

  // @ts-ignore
  Deno.readTextFile = async (path) => {
    if (typeof path === "string" && path.includes("mcp-state.json")) {
      return JSON.stringify({ envHash: "old" });
    }
    return "";
  };

  // @ts-ignore
  Deno.writeTextFile = async (path, content) => {
    // @ts-ignore
    files[path] = content;
  };

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("ps")) {
        return Promise.resolve({ success: true, stdout: new Uint8Array() }); // no running
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    const result = await manageMcpSidecar("/config", "restart", "/env");
    assertEquals(result, true);
    assertEquals(commands.some((c) => c.includes("up")), true);
    assertEquals(commands.some((c) => c.includes("down")), true);
  } finally {
    Deno.Command = originalCommand;
    Deno.readTextFile = originalReadTextFile;
    Deno.writeTextFile = originalWriteTextFile;
    Deno.readFile = originalReadFile;
  }
});

Deno.test("manageMcpSidecar - restart not needed", async () => {
  const originalCommand = Deno.Command;
  const originalReadTextFile = Deno.readTextFile;
  const originalReadFile = Deno.readFile;
  const originalWriteTextFile = Deno.writeTextFile;
  const commands: string[][] = [];

  // @ts-ignore
  Deno.writeTextFile = async () => {};

  // Mock hash to be same
  // @ts-ignore
  Deno.readFile = async (_path) => {
    return new Uint8Array([1, 2, 3]); // same content
  };

  // @ts-ignore
  Deno.readTextFile = async (path) => {
    if (typeof path === "string" && path.includes("mcp-state.json")) {
      // Compute hash of [1,2,3], but to make same, return the hash
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array([1, 2, 3]),
      );
      const hashStr = Array.from(new Uint8Array(hash)).map((b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      return JSON.stringify({ envHash: hashStr });
    }
    return "";
  };

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("ps")) {
        return Promise.resolve({
          success: true,
          stdout: new TextEncoder().encode("mcp-xai-global"),
        }); // running
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    const result = await manageMcpSidecar("/config", "restart", "/env");
    assertEquals(result, false); // not restarted
    assertEquals(commands.some((c) => c.includes("up")), false);
    assertEquals(commands.some((c) => c.includes("down")), false);
  } finally {
    Deno.Command = originalCommand;
    Deno.readTextFile = originalReadTextFile;
    Deno.readFile = originalReadFile;
    Deno.writeTextFile = originalWriteTextFile;
  }
});

Deno.test("manageMcpSidecar - restart state file not exist", async () => {
  const originalCommand = Deno.Command;
  const originalReadTextFile = Deno.readTextFile;
  const originalReadFile = Deno.readFile;
  const originalWriteTextFile = Deno.writeTextFile;
  const commands: string[][] = [];
  const files: Record<string, string> = {};

  // @ts-ignore
  Deno.readFile = async (_path) => {
    return new Uint8Array([1, 2, 3]);
  };

  // @ts-ignore
  Deno.readTextFile = async (path) => {
    if (typeof path === "string" && path.includes("mcp-state.json")) {
      throw new Error("not found");
    }
    return "";
  };

  // @ts-ignore
  Deno.writeTextFile = async (path, content) => {
    // @ts-ignore
    files[path] = content;
  };

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
    const result = await manageMcpSidecar("/config", "restart", "/env");
    assertEquals(result, true);
    assertEquals(commands.some((c) => c.includes("up")), true);
  } finally {
    Deno.Command = originalCommand;
    Deno.readTextFile = originalReadTextFile;
    Deno.readFile = originalReadFile;
    Deno.writeTextFile = originalWriteTextFile;
  }
});

Deno.test("manageMcpSidecar - restart hash same but not running", async () => {
  const originalCommand = Deno.Command;
  const originalReadTextFile = Deno.readTextFile;
  const originalReadFile = Deno.readFile;
  const originalWriteTextFile = Deno.writeTextFile;
  const commands: string[][] = [];
  const files: Record<string, string> = {};

  // @ts-ignore
  Deno.readFile = async (_path) => {
    return new Uint8Array([1, 2, 3]);
  };

  // @ts-ignore
  Deno.readTextFile = async (path) => {
    if (typeof path === "string" && path.includes("mcp-state.json")) {
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new Uint8Array([1, 2, 3]),
      );
      const hashStr = Array.from(new Uint8Array(hash)).map((b) =>
        b.toString(16).padStart(2, "0")
      ).join("");
      return JSON.stringify({ envHash: hashStr });
    }
    return "";
  };

  // @ts-ignore
  Deno.writeTextFile = async (path, content) => {
    // @ts-ignore
    files[path] = content;
  };

  // @ts-ignore
  Deno.Command = class MockCommand {
    constructor(cmd: string, options: any) {
      commands.push([cmd, ...options.args]);
    }
    output() {
      const lastCmd = commands[commands.length - 1];
      if (lastCmd.includes("ps")) {
        return Promise.resolve({ success: true, stdout: new Uint8Array() }); // not running
      }
      return Promise.resolve({ success: true });
    }
  };

  try {
    const result = await manageMcpSidecar("/config", "restart", "/env");
    assertEquals(result, true);
    assertEquals(commands.some((c) => c.includes("up")), true);
  } finally {
    Deno.Command = originalCommand;
    Deno.readTextFile = originalReadTextFile;
    Deno.readFile = originalReadFile;
    Deno.writeTextFile = originalWriteTextFile;
  }
});

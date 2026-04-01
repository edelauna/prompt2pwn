import { assertEquals } from "std/assert";
import { stub } from "@std/testing/mock";
import { setupCodexEnv, setupEnv, setupMcpEnv } from "./env.ts";
import { Confirm, Input, Select } from "@cliffy/prompt";

// Use a guaranteed non-existent dir so loadEnvFile returns {} and no real .env
// files can interfere with test assertions about env var presence/absence.
const NO_ENV_DIR = "/tmp/prompt2pwn-test-noenv";

Deno.test("setupMcpEnv reads TUNNELTO_AUTH_KEY from environment", async () => {
  const testKey = "test-key-12345";
  const originalKey = Deno.env.get("TUNNELTO_AUTH_KEY");

  try {
    Deno.env.set("TUNNELTO_AUTH_KEY", testKey);
    // setupMcpEnv no longer collects tunnelto — key is handled by promptTunneltoKey
    // called separately in the claude/codex paths. Verify the return shape is unchanged.
    const result = await setupMcpEnv(NO_ENV_DIR, NO_ENV_DIR, true);
    assertEquals("xaiKey" in result, true);
    assertEquals("sourcegraphToken" in result, true);
    assertEquals("tunneltoAuthKey" in result, false);
  } finally {
    if (originalKey === undefined) {
      Deno.env.delete("TUNNELTO_AUTH_KEY");
    } else {
      Deno.env.set("TUNNELTO_AUTH_KEY", originalKey);
    }
  }
});

Deno.test("setupCodexEnv includes tunneltoAuthKey when env var is set", async () => {
  const testKey = "test-codex-key";
  const originalKey = Deno.env.get("TUNNELTO_AUTH_KEY");

  try {
    Deno.env.set("TUNNELTO_AUTH_KEY", testKey);
    const result = await setupCodexEnv(NO_ENV_DIR, NO_ENV_DIR, true);
    assertEquals(result.tunneltoAuthKey, testKey);
  } finally {
    if (originalKey === undefined) {
      Deno.env.delete("TUNNELTO_AUTH_KEY");
    } else {
      Deno.env.set("TUNNELTO_AUTH_KEY", originalKey);
    }
  }
});

Deno.test("setupCodexEnv tunneltoAuthKey is undefined when not set", async () => {
  const originalKey = Deno.env.get("TUNNELTO_AUTH_KEY");

  try {
    Deno.env.delete("TUNNELTO_AUTH_KEY");
    const result = await setupCodexEnv(NO_ENV_DIR, NO_ENV_DIR, true);
    assertEquals(result.tunneltoAuthKey, undefined);
  } finally {
    if (originalKey === undefined) {
      Deno.env.delete("TUNNELTO_AUTH_KEY");
    } else {
      Deno.env.set("TUNNELTO_AUTH_KEY", originalKey);
    }
  }
});

Deno.test("setupEnv includes tunneltoAuthKey when env var is set", async () => {
  const testKey = "test-env-key";
  const originalKey = Deno.env.get("TUNNELTO_AUTH_KEY");

  try {
    Deno.env.set("TUNNELTO_AUTH_KEY", testKey);
    using _inputStub = stub(Input, "prompt", async () => "test-api-key");
    using _confirmStub = stub(Confirm, "prompt", async () => false);
    using _selectStub = stub(Select, "prompt", async () => "xai");

    const result = await setupEnv(NO_ENV_DIR, NO_ENV_DIR, true);
    assertEquals(result.tunneltoAuthKey, testKey);
  } finally {
    if (originalKey === undefined) {
      Deno.env.delete("TUNNELTO_AUTH_KEY");
    } else {
      Deno.env.set("TUNNELTO_AUTH_KEY", originalKey);
    }
  }
});

Deno.test("setupEnv tunneltoAuthKey is undefined when not set and prompts skipped", async () => {
  using _inputStub = stub(Input, "prompt", async () => "test-api-key");
  using _confirmStub = stub(Confirm, "prompt", async () => false);
  using _selectStub = stub(Select, "prompt", async () => "xai");

  const originalKey = Deno.env.get("TUNNELTO_AUTH_KEY");
  try {
    Deno.env.delete("TUNNELTO_AUTH_KEY");
    const result = await setupEnv(NO_ENV_DIR, NO_ENV_DIR, true);
    assertEquals(result.tunneltoAuthKey, undefined);
  } finally {
    if (originalKey === undefined) {
      Deno.env.delete("TUNNELTO_AUTH_KEY");
    } else {
      Deno.env.set("TUNNELTO_AUTH_KEY", originalKey);
    }
  }
});

Deno.test("setupMcpEnv returns object without tunneltoAuthKey", async () => {
  const result = await setupMcpEnv(NO_ENV_DIR, NO_ENV_DIR, true);

  assertEquals("xaiKey" in result, true);
  assertEquals("sourcegraphToken" in result, true);
  assertEquals("tunneltoAuthKey" in result, false);
});

Deno.test("setupCodexEnv returns object with tunneltoAuthKey property", async () => {
  const result = await setupCodexEnv(NO_ENV_DIR, NO_ENV_DIR, true);

  assertEquals("xaiKey" in result, true);
  assertEquals("sourcegraphToken" in result, true);
  assertEquals("openAiApiKey" in result, true);
  assertEquals("tunneltoAuthKey" in result, true);
});

Deno.test("setupEnv returns object with tunneltoAuthKey property", async () => {
  using _inputStub = stub(Input, "prompt", async () => "test-api-key");
  using _confirmStub = stub(Confirm, "prompt", async () => false);
  using _selectStub = stub(Select, "prompt", async () => "xai");

  const result = await setupEnv(NO_ENV_DIR, NO_ENV_DIR, true);

  assertEquals("xaiKey" in result, true);
  assertEquals("provider" in result, true);
  assertEquals("model" in result, true);
  assertEquals("providerApiKey" in result, true);
  assertEquals("sourcegraphToken" in result, true);
  assertEquals("tunneltoAuthKey" in result, true);
});

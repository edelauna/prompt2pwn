import { assertEquals } from "std/assert";
import { setupEnv } from "../env.ts";
import { Confirm, Input, Select } from "@cliffy/prompt";
import { stub } from "@std/testing/mock";

Deno.test("setupEnv - returns env config", async () => {
  using _inputStub = stub(Input, "prompt", async () => "test-api-key");
  using _confirmStub = stub(Confirm, "prompt", async () => true); // want XAI
  using _selectStub = stub(Select, "prompt", async () => "xai");

  const result = await setupEnv(".", ".");
  assertEquals(result.xaiKey, "test-api-key");
  assertEquals(result.provider, "xai");
  assertEquals(result.model, "grok-4-1-fast-reasoning");
});

Deno.test("setupEnv - uses .env file for apiKey", async () => {
  const originalEnv = Deno.env.get("XAI_API_KEY");
  const originalProvider = Deno.env.get("GOOSE_PROVIDER");
  const originalModel = Deno.env.get("GOOSE_MODEL");
  Deno.env.delete("XAI_API_KEY"); // ensure not set
  Deno.env.set("GOOSE_PROVIDER", "xai");
  Deno.env.set("GOOSE_MODEL", "test-model");
  const envContent =
    "XAI_API_KEY=env-file-key\nGOOSE_PROVIDER=xai\nGOOSE_MODEL=test-model\n";
  await Deno.writeTextFile(".env", envContent);
  try {
    using _confirmStub = stub(Confirm, "prompt", async () => false); // for SOURCEGRAPH_TOKEN
    const result = await setupEnv(".", ".");
    assertEquals(result.xaiKey, "env-file-key");
    assertEquals(result.provider, "xai");
    assertEquals(result.model, "test-model");
  } finally {
    await Deno.remove(".env");
    if (originalEnv !== undefined) {
      Deno.env.set("XAI_API_KEY", originalEnv);
    } else {
      Deno.env.delete("XAI_API_KEY");
    }
    if (originalProvider !== undefined) {
      Deno.env.set("GOOSE_PROVIDER", originalProvider);
    } else {
      Deno.env.delete("GOOSE_PROVIDER");
    }
    if (originalModel !== undefined) {
      Deno.env.set("GOOSE_MODEL", originalModel);
    } else {
      Deno.env.delete("GOOSE_MODEL");
    }
  }
});

Deno.test("setupEnv - exits on empty apiKey input", async () => {
  let exitCode: number | undefined;
  const originalSg = Deno.env.get("SOURCEGRAPH_TOKEN");
  Deno.env.set("SOURCEGRAPH_TOKEN", "dummy"); // avoid SOURCEGRAPH prompt

  using _inputStub = stub(Input, "prompt", async () => "");
  using _confirmStub = stub(Confirm, "prompt", async () => true); // want XAI
  using _selectStub = stub(Select, "prompt", async () => "xai");
  using _exitStub = stub(Deno, "exit", (code?: number) => {
    exitCode = code;
    throw new Error("Exit called");
  });

  try {
    await setupEnv(".", ".");
    // Should not reach here
    assertEquals(true, false);
  } catch (_err) {
    assertEquals(exitCode, 1);
  } finally {
    if (originalSg !== undefined) {
      Deno.env.set("SOURCEGRAPH_TOKEN", originalSg);
    } else {
      Deno.env.delete("SOURCEGRAPH_TOKEN");
    }
  }
});

Deno.test("setupEnv - skips optional prompts when skipOptionalPrompts is true", async () => {
  using _inputStub = stub(Input, "prompt", async () => "test-api-key");
  using _confirmStub = stub(Confirm, "prompt", async () => true); // want XAI
  using _selectStub = stub(Select, "prompt", async () => "xai");
  // Note: Confirm.prompt should not be called when skipOptionalPrompts is true

  const result = await setupEnv(".", ".", true);
  assertEquals(result.xaiKey, "test-api-key");
  assertEquals(result.provider, "xai");
  assertEquals(result.model, "grok-4-1-fast-reasoning");
  assertEquals(result.sourcegraphToken, undefined); // Should be undefined since not prompted
});

Deno.test("setupEnv - uses preSetProvider google", async () => {
  using _inputStub = stub(Input, "prompt", async () => "test-xai-key");
  using _confirmStub = stub(Confirm, "prompt", async () => true); // want XAI
  // Note: For google, since skipOptionalPrompts not set, but to avoid prompting, set env

  const originalEnv = Deno.env.get("GOOGLE_API_KEY");
  Deno.env.set("GOOGLE_API_KEY", "test-google-key");
  try {
    const result = await setupEnv(".", ".", true, "google");
    assertEquals(result.xaiKey, "test-xai-key");
    assertEquals(result.provider, "google");
    assertEquals(result.model, "gemini-flash-lite-latest");
    assertEquals(result.providerApiKey, "test-google-key");
  } finally {
    if (originalEnv !== undefined) {
      Deno.env.set("GOOGLE_API_KEY", originalEnv);
    } else {
      Deno.env.delete("GOOGLE_API_KEY");
    }
  }
});

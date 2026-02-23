import { assertEquals, assertThrows } from "std/assert";
import {
  getProviderConfig,
  type GooseProviderName,
  selectAndConfigureProvider,
} from "../providers.ts";
import { Input, Select } from "@cliffy/prompt";
import { stub } from "@std/testing/mock";

Deno.test("getProviderConfig - returns config for valid provider", async () => {
  const config = await getProviderConfig("xai");
  assertEquals(config.keyEnv, "XAI_API_KEY");
  assertEquals(config.defaultModel, "grok-4-1-fast-reasoning");
});

Deno.test("getProviderConfig - throws for invalid provider", async () => {
  try {
    await getProviderConfig("invalid" as GooseProviderName);
    throw new Error("Expected error but none thrown");
  } catch (error) {
    assertEquals(
      (error as Error).message,
      "Unsupported Goose provider: invalid",
    );
  }
});

Deno.test("selectAndConfigureProvider - uses preSetProvider", async () => {
  using _selectStub = stub(Select, "prompt", async () => "xai");
  using _inputStub = stub(Input, "prompt", async () => "test-key");

  const result = await selectAndConfigureProvider(false, "google");
  assertEquals(result.provider, "google");
  assertEquals(result.model, "gemini-flash-lite-latest");
  assertEquals(result.providerApiKey, "test-key"); // prompted for key
});

Deno.test("selectAndConfigureProvider - uses env provider", async () => {
  const originalEnv = Deno.env.get("GOOSE_PROVIDER");
  Deno.env.set("GOOSE_PROVIDER", "openai");
  try {
    using _selectStub = stub(Select, "prompt", async () => "xai");
    using _inputStub = stub(Input, "prompt", async () => "test-key");

    const result = await selectAndConfigureProvider(false);
    assertEquals(result.provider, "openai");
    assertEquals(result.model, "gpt-4.1-nano");
  } finally {
    if (originalEnv !== undefined) {
      Deno.env.set("GOOSE_PROVIDER", originalEnv);
    } else {
      Deno.env.delete("GOOSE_PROVIDER");
    }
  }
});

Deno.test("selectAndConfigureProvider - prompts for provider when no preset", async () => {
  using _selectStub = stub(Select, "prompt", async () => "anthropic");
  using _inputStub = stub(Input, "prompt", async () => "test-key");

  const result = await selectAndConfigureProvider(false);
  assertEquals(result.provider, "anthropic");
  assertEquals(result.model, "claude-sonnet-4-5");
});

Deno.test("selectAndConfigureProvider - xai provider uses xaiKey", async () => {
  using _selectStub = stub(Select, "prompt", async () => "xai");

  const result = await selectAndConfigureProvider(
    false,
    undefined,
    undefined,
    "xai-test-key",
  );
  assertEquals(result.provider, "xai");
  assertEquals(result.providerApiKey, "xai-test-key");
});

Deno.test("selectAndConfigureProvider - non-xai provider uses env key", async () => {
  const originalEnv = Deno.env.get("GOOGLE_API_KEY");
  Deno.env.set("GOOGLE_API_KEY", "env-google-key");
  try {
    using _selectStub = stub(Select, "prompt", async () => "google");

    const result = await selectAndConfigureProvider(false, "google");
    assertEquals(result.provider, "google");
    assertEquals(result.providerApiKey, "env-google-key");
  } finally {
    if (originalEnv !== undefined) {
      Deno.env.set("GOOSE_API_KEY", originalEnv);
    } else {
      Deno.env.delete("GOOGLE_API_KEY");
    }
  }
});

Deno.test("selectAndConfigureProvider - prompts for key when no env and not skip", async () => {
  using _selectStub = stub(Select, "prompt", async () => "google");
  using _inputStub = stub(Input, "prompt", async () => "prompted-key");

  const result = await selectAndConfigureProvider(false, "google");
  assertEquals(result.provider, "google");
  assertEquals(result.providerApiKey, "prompted-key");
});

Deno.test("selectAndConfigureProvider - exits on empty key input", async () => {
  let exitCode: number | undefined;
  using _selectStub = stub(Select, "prompt", async () => "google");
  using _inputStub = stub(Input, "prompt", async () => "");
  using _exitStub = stub(Deno, "exit", (code?: number) => {
    exitCode = code;
    throw new Error("Exit called");
  });

  try {
    await selectAndConfigureProvider(false, "google");
    assertEquals(true, false); // should not reach
  } catch (_err) {
    assertEquals(exitCode, 1);
  }
});

Deno.test("selectAndConfigureProvider - uses preSetModel", async () => {
  using _selectStub = stub(Select, "prompt", async () => "xai");

  const result = await selectAndConfigureProvider(false, "xai", "custom-model");
  assertEquals(result.model, "custom-model");
});

Deno.test("selectAndConfigureProvider - prompts for model when not skip", async () => {
  using _selectStub = stub(Select, "prompt", async (options) => {
    if (options.message.includes("Use default model")) {
      return "No";
    }
    return "xai";
  });
  using _inputStub = stub(Input, "prompt", async () => "custom-model");

  const result = await selectAndConfigureProvider(false, "xai");
  assertEquals(result.model, "custom-model");
});

Deno.test("selectAndConfigureProvider - skips model prompt when skipOptionalPrompts", async () => {
  using _selectStub = stub(Select, "prompt", async () => "xai");

  const result = await selectAndConfigureProvider(true, "xai");
  assertEquals(result.model, "grok-4-1-fast-reasoning");
});

Deno.test("selectAndConfigureProvider - skips key prompt when skipOptionalPrompts", async () => {
  using _selectStub = stub(Select, "prompt", async () => "google");

  const result = await selectAndConfigureProvider(true, "google");
  assertEquals(result.providerApiKey, undefined); // no env set
});

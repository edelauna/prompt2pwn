import { assert } from "@std/assert";

async function callXaiApi(
  query: string,
  toolType: string,
  options: {
    allowed_domains?: string[];
    excluded_domains?: string[];
    allowed_x_handles?: string[];
    excluded_x_handles?: string[];
    from_date?: string;
    to_date?: string;
    enable_image_understanding?: boolean;
    enable_video_understanding?: boolean;
  } = {},
  apiKey: string,
) {
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4-1-fast-reasoning",
      input: [
        {
          role: "user",
          content: query,
        },
      ],
      tools: [
        {
          type: toolType,
          ...options,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

Deno.test("callXaiApi constructs correct request", async () => {
  // Mock fetch
  const originalFetch = globalThis.fetch;
  const mockResponse = { data: "test" };
  globalThis.fetch =
    (async (url: string | URL | Request, options?: RequestInit) => {
      assert(
        url === "https://api.x.ai/v1/responses",
        "Should call correct URL",
      );
      assert(options?.method === "POST", "Should be POST request");
      const body = JSON.parse(options?.body as string);
      assert(
        body.model === "grok-4-1-fast-reasoning",
        "Should use correct model",
      );
      assert(body.input[0].content === "test query", "Should include query");
      assert(body.tools[0].type === "web_search", "Should include tool type");
      return {
        ok: true,
        json: async () => mockResponse,
      } as Response;
    }) as typeof fetch;

  try {
    const result = await callXaiApi("test query", "web_search", {}, "test-key");
    assert(result === mockResponse, "Should return mock response");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callXaiApi handles API errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
  } as Response)) as typeof fetch;

  try {
    let error: Error | null = null;
    try {
      await callXaiApi("query", "tool", {}, "key");
    } catch (e) {
      error = e as Error;
    }
    assert(error !== null, "Should throw error");
    if (error) {
      assert(
        error.message === "API error: 401 Unauthorized",
        "Should have correct error message",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callXaiApi includes options in tools", async () => {
  const originalFetch = globalThis.fetch;
  const mockResponse = { data: "test" };
  globalThis.fetch =
    (async (_url: string | URL | Request, options?: RequestInit) => {
      const body = JSON.parse(options?.body as string);
      assert(
        body.tools[0].allowed_domains === undefined,
        "Should not include undefined options",
      );
      assert(
        body.tools[0].enable_image_understanding === true,
        "Should include boolean option",
      );
      assert(
        body.tools[0].allowed_x_handles?.[0] === "testuser",
        "Should include array option",
      );
      return {
        ok: true,
        json: async () => mockResponse,
      } as Response;
    }) as typeof fetch;

  try {
    await callXaiApi("test query", "x_search", {
      enable_image_understanding: true,
      allowed_x_handles: ["testuser"],
    }, "test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  CTF_DEFAULT_DOMAINS,
  CTF_DOMAIN_PRESETS,
  CTF_RECON_SECTIONS,
  extractGuideSection,
} from "./ctf.ts";

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

// CTF module tests

Deno.test("extractGuideSection: 'all' returns full guide", () => {
  const result = extractGuideSection("all");
  assertStringIncludes(result, "## Minute 0-1");
  assertStringIncludes(result, "## When You're Stuck");
  assertStringIncludes(result, "## Reference: Attacker Infrastructure");
});

Deno.test("extractGuideSection: known phase returns only that section", () => {
  const result = extractGuideSection("hypothesis");
  assertStringIncludes(result, "## Minute 5-10");
  assert(!result.includes("## Minute 0-1"), "Should not include orientation");
  assert(!result.includes("## Minute 10-15"), "Should not include confirm");
});

Deno.test("extractGuideSection: 'stuck' section ends before knowledge-base", () => {
  const result = extractGuideSection("stuck");
  assertStringIncludes(result, "## When You're Stuck");
  assert(
    !result.includes("## Knowledge Base Research"),
    "Should not bleed into knowledge-base",
  );
});

Deno.test("extractGuideSection: unknown phase returns full guide", () => {
  const result = extractGuideSection("nonexistent");
  assertStringIncludes(result, "## Minute 0-1");
  assertStringIncludes(result, "## When You're Stuck");
});

Deno.test("extractGuideSection: all known phases resolve without fallback", () => {
  for (const phase of Object.keys(CTF_RECON_SECTIONS)) {
    const result = extractGuideSection(phase);
    const heading = CTF_RECON_SECTIONS[phase];
    assertStringIncludes(
      result,
      heading,
      `Phase '${phase}' should start with its heading`,
    );
  }
});

Deno.test("CTF_DOMAIN_PRESETS: all categories have 3 domains", () => {
  for (const [category, domains] of Object.entries(CTF_DOMAIN_PRESETS)) {
    assertEquals(
      domains.length,
      3,
      `Category '${category}' should have 3 domains`,
    );
  }
});

Deno.test("CTF_DOMAIN_PRESETS: payloads includes hacktricks and portswigger", () => {
  assertStringIncludes(CTF_DOMAIN_PRESETS["payloads"].join(","), "hacktricks");
  assertStringIncludes(CTF_DOMAIN_PRESETS["payloads"].join(","), "portswigger");
});

Deno.test("CTF_DOMAIN_PRESETS: cve includes nvd.nist.gov", () => {
  assert(CTF_DOMAIN_PRESETS["cve"].includes("nvd.nist.gov"));
});

Deno.test("CTF_DEFAULT_DOMAINS: contains expected CTF knowledge bases", () => {
  assert(CTF_DEFAULT_DOMAINS.includes("github.com"));
  assert(CTF_DEFAULT_DOMAINS.includes("book.hacktricks.xyz"));
  assert(CTF_DEFAULT_DOMAINS.includes("ctftime.org"));
  assert(CTF_DEFAULT_DOMAINS.includes("nvd.nist.gov"));
  assert(CTF_DEFAULT_DOMAINS.includes("portswigger.net"));
});

// callXaiApi tests

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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { Context, Hono } from "hono";
import { z } from "zod";
import {
  CTF_DEFAULT_DOMAINS,
  CTF_DOMAIN_PRESETS,
  extractGuideSection,
} from "./ctf.ts";

const PORT = Deno.env.get("PORT") || "1337";
const MODEL = Deno.env.get("MODEL") || "grok-4-1-fast-reasoning";
const FETCH_TIMEOUT_MS = 60_000;

interface JSONSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  additionalProperties?: boolean;
}

interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

function jsonSchemaToZod(schema: JSONSchema): z.ZodTypeAny {
  const desc = schema.description || "";
  switch (schema.type) {
    case "string":
      return z.string().describe(desc);
    case "boolean":
      return z.boolean().describe(desc);
    case "integer":
      return z.number().int().describe(desc);
    case "number":
      return z.number().describe(desc);
    case "array":
      return z.array(schema.items ? jsonSchemaToZod(schema.items) : z.any())
        .describe(desc);
    case "object": {
      const schemaProps = schema.properties || {};
      const requiredKeys = schema.required || [];
      const objProps: Record<string, z.ZodTypeAny> = {};
      for (const [key, propSchema] of Object.entries(schemaProps)) {
        let propZod = jsonSchemaToZod(propSchema);
        if (!requiredKeys.includes(key)) {
          propZod = propZod.optional();
        }
        objProps[key] = propZod;
      }
      const obj = z.object(objProps).describe(desc);
      return schema.additionalProperties === false
        ? obj.strict()
        : obj.passthrough();
    }
    default:
      return z.any().describe(desc);
  }
}

const API_KEY = Deno.env.get("XAI_API_KEY");
if (!API_KEY) {
  console.warn(
    "XAI_API_KEY not set; web_search, twitter_search and ctf_recon_search tools will fail",
  );
}

const SOURCEGRAPH_TOKEN = Deno.env.get("SOURCEGRAPH_TOKEN");
if (!SOURCEGRAPH_TOKEN) {
  console.warn(
    "SOURCEGRAPH_TOKEN not set; Sourcegraph tools will be unavailable",
  );
}

let sgTools: Tool[] = [];
if (SOURCEGRAPH_TOKEN) {
  sgTools = await loadSgTools();
}

async function callXaiApi(
  query: string,
  toolType: string,
  chat_history: Array<{ role: string; content: string }> = [],
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
) {
  const response = await fetch("https://api.x.ai/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      input: [
        ...chat_history,
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
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data;
}

console.log("Starting MCP server...");

async function loadSgTools(): Promise<Tool[]> {
  if (!SOURCEGRAPH_TOKEN) return [];
  try {
    const toolsListBody = JSON.stringify({
      jsonrpc: "2.0",
      id: "tools-list",
      method: "tools/list",
    });
    const resp = await fetch("https://sourcegraph.com/.api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `token ${SOURCEGRAPH_TOKEN}`,
      },
      body: toolsListBody,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) throw new Error(`Fetch tools failed: ${resp.status}`);
    const text = await resp.text();
    const lines = text.split("\n");
    let jsonData = null;
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        jsonData = line.slice(6);
        break;
      }
    }
    if (!jsonData) throw new Error("No data in response");
    const data = JSON.parse(jsonData);
    const tools = data.result?.tools || [];
    console.log(`Loaded ${tools.length} Sourcegraph tools`);
    return tools;
  } catch (e) {
    console.error("Failed to load Sourcegraph tools:", e);
    return [];
  }
}

// Shared chat_history schema used across all xAI tools
const chatHistorySchema = z.array(
  z.object({ role: z.string(), content: z.string() }),
).max(50).optional().default([]).describe("Previous chat messages for context");

// Build McpServer once at startup — tools/prompts registered here are reused
// across all requests; only the transport is created per-request.
const mcpServer = new McpServer({
  name: "xai-server",
  version: "0.1.0",
  description:
    "MCP server providing web search and X (Twitter) search tools powered by xAI API",
});

mcpServer.registerTool(
  "web_search",
  {
    description:
      "Perform web searches to gather current information, research topics, or browse the internet. Use this tool when you need real-time data, recent news, or information not available in your training data. Supports domain filtering and image analysis.",
    inputSchema: z.object({
      query: z.string().describe(
        "The search query for web research. Use specific keywords and be clear about what information you need.",
      ),
      chat_history: chatHistorySchema,
      allowed_domains: z.array(z.string()).max(5).optional().describe(
        "Only search within specific domains (max 5)",
      ),
      excluded_domains: z.array(z.string()).max(5).optional().describe(
        "Exclude specific domains from search (max 5)",
      ),
      enable_image_understanding: z.boolean().optional().describe(
        "Enable analysis of images found during browsing",
      ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({
    query,
    chat_history = [],
    allowed_domains,
    excluded_domains,
    enable_image_understanding,
  }: {
    query: string;
    chat_history?: Array<{ role: string; content: string }>;
    allowed_domains?: string[];
    excluded_domains?: string[];
    enable_image_understanding?: boolean;
  }) => {
    try {
      const result = await callXaiApi(query, "web_search", chat_history, {
        allowed_domains,
        excluded_domains,
        enable_image_understanding,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

mcpServer.registerTool(
  "twitter_search",
  {
    description:
      "Search for discussions and posts on X (formerly Twitter). Use this tool to find real-time conversations, opinions, and trending topics on social media.",
    inputSchema: z.object({
      query: z.string().describe(
        "The search query for X (Twitter) discussions. Include keywords, hashtags, or usernames to find relevant posts.",
      ),
      chat_history: chatHistorySchema,
      allowed_x_handles: z.array(z.string()).max(10).optional().describe(
        "Only consider posts from specific X handles (max 10)",
      ),
      excluded_x_handles: z.array(z.string()).max(10).optional().describe(
        "Exclude posts from specific X handles (max 10)",
      ),
      from_date: z.string().optional().describe(
        "Start date for search range (ISO8601 format)",
      ),
      to_date: z.string().optional().describe(
        "End date for search range (ISO8601 format)",
      ),
      enable_image_understanding: z.boolean().optional().describe(
        "Enable analysis of images in posts",
      ),
      enable_video_understanding: z.boolean().optional().describe(
        "Enable analysis of videos in posts",
      ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({
    query,
    chat_history = [],
    allowed_x_handles,
    excluded_x_handles,
    from_date,
    to_date,
    enable_image_understanding,
    enable_video_understanding,
  }: {
    query: string;
    chat_history?: Array<{ role: string; content: string }>;
    allowed_x_handles?: string[];
    excluded_x_handles?: string[];
    from_date?: string;
    to_date?: string;
    enable_image_understanding?: boolean;
    enable_video_understanding?: boolean;
  }) => {
    try {
      const result = await callXaiApi(query, "x_search", chat_history, {
        allowed_x_handles,
        excluded_x_handles,
        from_date,
        to_date,
        enable_image_understanding,
        enable_video_understanding,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

mcpServer.registerPrompt(
  "ctf_recon_guide",
  {
    description:
      "CTF challenge recon and threat modelling methodology. Inject this at the start of any CTF challenge to get a structured approach: orient, review source code, form a vulnerability hypothesis, confirm primitives, and build exploit chains. Optionally specify a phase to get just that section.",
    argsSchema: {
      phase: z.enum([
        "all",
        "orientation",
        "source-review",
        "hypothesis",
        "confirm",
        "chain",
        "stuck",
        "knowledge-base",
        "infrastructure",
      ]).optional().describe(
        "Which phase of the methodology to return. Defaults to 'all'. Use 'stuck' when blocked on a challenge, 'knowledge-base' to get search strategy, 'infrastructure' for tunnelto and runtime recon commands.",
      ),
    },
  },
  ({ phase = "all" }: { phase?: string }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: extractGuideSection(phase),
      },
    }],
  }),
);

mcpServer.registerTool(
  "ctf_recon_search",
  {
    description:
      "Web search pre-configured for CTF knowledge bases. Use this instead of generic web_search when researching vulnerability techniques, payloads, CVEs, or CTF writeups. The 'category' parameter selects the right knowledge base domain set automatically.",
    inputSchema: z.object({
      query: z.string().describe(
        "Search query. Be specific: include the vulnerability class, tech stack, and version if known. E.g. 'Jinja2 SSTI sandbox escape filter bypass' or 'nginx 1.19.0 path traversal CVE'.",
      ),
      chat_history: chatHistorySchema,
      category: z.enum([
        "payloads",
        "writeups",
        "cve",
        "cloud",
        "browser",
      ]).optional().describe(
        "Knowledge base category. 'payloads': PayloadsAllTheThings + HackTricks + PortSwigger. 'writeups': CTFtime + Medium + GitHub. 'cve': NVD + ExploitDB + GitHub. 'cloud': hackingthe.cloud + cloud.hacktricks.xyz. 'browser': MDN + PortSwigger + HackTricks. Defaults to a general CTF set.",
      ),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({
    query,
    chat_history = [],
    category,
  }: {
    query: string;
    chat_history?: Array<{ role: string; content: string }>;
    category?: string;
  }) => {
    try {
      const allowed_domains = category
        ? CTF_DOMAIN_PRESETS[category]
        : CTF_DEFAULT_DOMAINS;
      const result = await callXaiApi(query, "web_search", chat_history, {
        allowed_domains,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${(error as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  },
);

for (const tool of sgTools) {
  const zodSchema = jsonSchemaToZod(tool.inputSchema);
  mcpServer.registerTool(`sourcegraph_${tool.name}`, {
    description: tool.description,
    inputSchema: zodSchema,
    annotations: { readOnlyHint: true },
  }, async (input: Record<string, unknown>) => {
    try {
      const callBody = JSON.stringify({
        jsonrpc: "2.0",
        id: `sg-call-${tool.name}`,
        method: "tools/call",
        params: { name: tool.name, arguments: input },
      });
      const resp = await fetch("https://sourcegraph.com/.api/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `token ${SOURCEGRAPH_TOKEN}`,
        },
        body: callBody,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`Tool call failed: ${resp.status}`);
      // deno-lint-ignore no-explicit-any
      const content: any[] = [];
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No body");
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const dataStr = line.slice(6);
              const data = JSON.parse(dataStr);
              if (data.result && data.result.content) {
                content.push(...data.result.content);
              }
            } catch {
              // Ignore parsing errors for individual lines
            }
          }
        }
      }
      return {
        content,
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `Error calling sourcegraph_${tool.name}: ${
            (e as Error).message
          }`,
        }],
        isError: true,
      };
    }
  });
}

const app = new Hono();

// Transport is stateless per-request; mcpServer is shared across all requests.
app.all("/mcp", async (c: Context) => {
  const transport = new StreamableHTTPTransport();
  await mcpServer.connect(transport);
  return transport.handleRequest(c);
});

app.get("/mcp/health", (c: Context) => c.text("OK"));

console.log(`Starting HTTP server on 0.0.0.0:${PORT}`);
Deno.serve({ hostname: "0.0.0.0", port: parseInt(PORT) }, app.fetch);
console.log(`xAI MCP server running on port ${PORT}`);

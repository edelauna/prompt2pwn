# MCP-XAI Server

Model Context Protocol (MCP) sidecar for Prompt2Pwn. Bridges xAI models to
external tools: web search, Sourcegraph code search, Twitter.

## Features

- Web search (domains filter).
- Sourcegraph: code search, defs, refs, commits.
- Twitter search.
- Image/video understanding.

## Build & Run

```sh
docker build -t mcp-xai .
docker run -p 8000:8000 --env XAI_API_KEY=... mcp-xai
```

Or dev:

```sh
cd mcp-xai
deno run --allow-net --allow-env server.ts
```

## Integration

Used by Goose via docker-compose.yml. Loads .env (XAI_API_KEY, etc.).

## Files

- [`server.ts`](server.ts): MCP server.
- [`Dockerfile`](Dockerfile)
- [`test.ts`](test.ts)

See main [README](../README.md), [`CONTRIBUTING.md`](../CONTRIBUTING.md).

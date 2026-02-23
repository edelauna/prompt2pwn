# Prompt2Pwn

[![CI](https://github.com/edelauna/prompt2pwn/workflows/CI/badge.svg)](https://github.com/edelauna/prompt2pwn/actions)

Automate CTF pwn challenges using Goose AI workflows in Docker. Secure nested
env with MCP sidecar for xAI models.

## Quick Start

1. Install Docker.
2. `curl -fsSL https://raw.githubusercontent.com/edelauna/prompt2pwn/main/install.sh | sh`
3. `prompt2pwn launch --pwn-challenge \"Buffer overflow in login\" --pwn-target http://target:8080`

## CLI

```
prompt2pwn [preflight|down|launch] [options]
```

**Launch**:

- `--pwn-challenge <desc>`: CTF description
- `--pwn-target <url>`: Target
- `--pwn-info <hints>`: Extra info
- `--yes`: Skip prompts
- `--no-priv`: Safer Docker
- `--verbose`
- `--provider <name>`: Set LLM provider (xai, google, openai, anthropic)
- `[...extraArgs]`: Goose cmds

## Providers

Prompt2Pwn supports multiple LLM providers for Goose:

- **xai** (default): Uses XAI Grok models. Requires XAI_API_KEY.
- **google**: Uses Google Gemini. Requires GOOGLE_API_KEY. Default model:
  gemini-flash-lite-latest.
- **openai**: Uses OpenAI models. Requires OPENAI_API_KEY. Default model:
  gpt-4.1-nano.
- **anthropic**: Uses Anthropic Claude. Requires ANTHROPIC_API_KEY. Default
  model: claude-sonnet-4-5.

Set via `--provider <name>` or GOOSE_PROVIDER env var.

MCP sidecar uses XAI for search tools (optional), and Sourcegraph for code
tools.

**Examples**:

```sh
prompt2pwn launch  # Interactive CTF
prompt2pwn launch --yes --pwn-challenge \"XSS vuln\"
prompt2pwn preflight
prompt2pwn down
```

## MCP Sidecar Configuration

The MCP sidecar provides search tools to Goose. By default, it includes:

- **Sourcegraph tools** (if `SOURCEGRAPH_TOKEN` is configured): Code search and
  repository analysis tools.
- **Web and X/Twitter search tools** (if `XAI_API_KEY` is configured): Real-time
  web search and social media analysis.

`XAI_API_KEY` is optional. If not provided, the MCP sidecar will start with only
Sourcegraph tools available. You will be prompted during setup whether to
configure the XAI key for full search capabilities.

To configure `SOURCEGRAPH_TOKEN` for code search tools, set it in your `.env`
file or environment.

## Installation

**Recommended (One-liner)**:

```sh
curl -fsSL https://raw.githubusercontent.com/edelauna/prompt2pwn/main/install.sh | sh
```

**Development**:

```sh
git clone https://github.com/edelauna/prompt2pwn.git
cd prompt2pwn
deno task start
```

## Architecture

```mermaid
graph TB
  Host[Docker Host] --> Goose[Goose Container<br/>DinD + Goose AI]
  Goose --> WS[/workspace]
  Goose --> Vol[goose-configs Vol]
  Host --> MCP[MCP-XAI Sidecar]
  MCP --> SG[Sourcegraph]
  MCP --> Web[Web Search]
```

## Features

- CTF recipe orchestrator.
- Bundled/external recipes.
- Persistent configs.
- Preflight checks.
- See [`CONTRIBUTING.md`](CONTRIBUTING.md)

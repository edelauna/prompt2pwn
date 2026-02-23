# Contributing to Prompt2Pwn

Thank you for your interest in contributing!

## Prerequisites

- Deno 1.40+
- Docker & docker-compose

## Setup

1. Fork & clone repo.
2. `deno task preflight`
3. `deno task test`

## Development

- Branch: `git checkout -b feat/my-feature`
- Lint: `deno lint`
- Test: `deno task test`
- Compile: `deno task compile:bundle`

## Docker Distribution Notes

Shifted to pre-built images:

**Goals:**

- No local builds.
- Multi-arch CI.

**Components:**

- CLI pulls `edelauna/goose-dind:v1.0.0`
- Goose-DinD: `ghcr.io/block/goose:1.23.2` + DinD
- MCP-XAI bridge.

**CI:** v* tags → Docker Hub.

Status: ✅

## Releases

**Process:**

1. `git tag vX.Y.Z`
2. `git push origin vX.Y.Z`

**CI:** Builds platform binaries uploaded to GitHub Releases and Docker images
to Docker Hub ([`ci.yml`](.github/workflows/ci.yml)).

**Verify:** Check releases page for assets matching [`install.sh`](install.sh)
(e.g., `prompt2pwn-linux-amd64`).

Status: ✅

## PR Guidelines

- Reference issues.
- Pass CI ([ci.yml](.github/workflows/ci.yml)).
- Conventional commits.

#!/bin/bash
set -e

dockerd > /var/log/docker.log 2>&1 &

# Wait for dockerd to be ready
echo "Waiting for Docker daemon to start..."
timeout 30 bash -c 'until docker info >/dev/null 2>&1; do sleep 1; done'

# Detect host workspace owner UID/GID
HOST_UID=$(stat -c '%u' /workspace)
HOST_GID=$(stat -c '%g' /workspace)
echo "Running goose as UID ${HOST_UID}:${HOST_GID} to match host"

SUPP_GROUPS="${HOST_GID}"
if [ -S /var/run/docker.sock ]; then
    DOCKER_SOCK_GID=$(stat -c '%g' /var/run/docker.sock)
    if [ -n "$DOCKER_SOCK_GID" ] && [ "$DOCKER_SOCK_GID" != "$HOST_GID" ]; then
        SUPP_GROUPS="${HOST_GID},${DOCKER_SOCK_GID}"
    fi
fi

if [ -n "$GOOSE_LAUNCH_FILE" ]; then
    FULLPATH="/workspace/$GOOSE_LAUNCH_FILE"
    CONTEXT="$(dirname "$FULLPATH")"

    echo "Processing launch file: $GOOSE_LAUNCH_FILE"

    if [[ "$GOOSE_LAUNCH_FILE" =~ [Dd]ockerfile$ ]]; then
        IMAGE="$(basename "$CONTEXT")-launch"
        echo "Building Docker image: $IMAGE"
        docker build -f "$FULLPATH" -t "$IMAGE" "$CONTEXT"
        echo "Running container: $IMAGE"
        docker rm -f "$IMAGE" 2>/dev/null || true
        docker run -d --name "$IMAGE" "$IMAGE" tail -f /dev/null
    elif [[ "$GOOSE_LAUNCH_FILE" =~ \.(yaml|yml)$ ]]; then
        echo "Starting docker-compose: $GOOSE_LAUNCH_FILE"
        docker compose -f "$FULLPATH" up -d
    else
        echo "Warning: Unrecognized launch file format: $GOOSE_LAUNCH_FILE"
    fi
fi

# Drop privileges (unless called from root) - limits the ability of agents to rewrite network
if [ "$TOOL" = "claude" ]; then
  mkdir -p /home/goose/.local /home/goose/.cache /home/goose/.claude /home/goose/.npm
  # Chown home dir itself so the user can create new dirs (e.g. npm cache, node)
  chown ${HOST_UID}:${HOST_GID} /home/goose
  # Don't recursively chown .cache — it contains ms-playwright browser binaries (GB of files)
  # which are already owned by UID 1000 from image seeding and only need to be executable.
  chown -R ${HOST_UID}:${HOST_GID} /home/goose/.local /home/goose/.claude /home/goose/.npm
  chown ${HOST_UID}:${HOST_GID} /home/goose/.cache
elif [ "$TOOL" = "codex" ]; then
  mkdir -p /home/goose/.cache /home/goose/.codex
  chown -R ${HOST_UID}:${HOST_GID} /home/goose/.cache /home/goose/.codex
else
  chown -R ${HOST_UID}:${HOST_GID} /home/goose/.config/goose
fi

# Configure tunnelto auth if key is provided (claude and codex only)
if [ "$TOOL" = "claude" ] || [ "$TOOL" = "codex" ]; then
  if [ -n "$TUNNELTO_AUTH_KEY" ]; then
    mkdir -p /home/goose/.tunnelto
    chown -R ${HOST_UID}:${HOST_GID} /home/goose/.tunnelto
    setpriv --reuid ${HOST_UID} --regid ${HOST_GID} --groups ${SUPP_GROUPS} \
      tunnelto set-auth --key "$TUNNELTO_AUTH_KEY" || \
      echo "Warning: tunnelto set-auth failed, tunnels may not authenticate"
  fi
fi

if [ "$TOOL" = "claude" ]; then
  exec setpriv --reuid ${HOST_UID} --regid ${HOST_GID} --groups ${SUPP_GROUPS} claude "$@"
elif [ "$TOOL" = "codex" ]; then
  exec setpriv --reuid ${HOST_UID} --regid ${HOST_GID} --groups ${SUPP_GROUPS} codex "$@"
else
  exec setpriv --reuid ${HOST_UID} --regid ${HOST_GID} --groups ${SUPP_GROUPS} goose "$@"
fi

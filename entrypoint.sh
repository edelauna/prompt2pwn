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
  chown -R ${HOST_UID}:${HOST_GID} /home/goose
else
  chown -R ${HOST_UID}:${HOST_GID} /home/goose/.config/goose
fi

if [ "$TOOL" = "claude" ]; then
  exec setpriv --reuid ${HOST_UID} --regid ${HOST_GID} --clear-groups claude "$@"
else
  exec setpriv --reuid ${HOST_UID} --regid ${HOST_GID} --clear-groups goose "$@"
fi

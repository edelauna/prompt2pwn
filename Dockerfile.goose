FROM ghcr.io/block/goose:1.23.2

LABEL version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/edelauna/prompt2pwn"
LABEL org.opencontainers.image.description="Custom Goose with Docker-in-Docker for prompt2pwn"

USER root

# 1. Install Docker dependencies & Docker CLI/Engine
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    iptables \
    dbus-user-session \
    python3-full \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Install Docker Engine (official repo is best for DinD)
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && apt-get install -y \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-compose-plugin \
        docker-buildx-plugin

# 2. Configure Docker to use VFS (essential for nested storage without setup complexity)
RUN mkdir -p /etc/docker && \
    echo '{"storage-driver": "vfs", "mtu": 1450 }' > /etc/docker/daemon.json

# 3. Set home directory
ENV HOME=/home/goose

# 4. Entrypoint script to start the Docker daemon
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Goose usually runs as a specific user, but DinD daemon needs root
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

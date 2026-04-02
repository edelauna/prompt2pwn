FROM ghcr.io/block/goose:1.23

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
    python3-pip \
    ripgrep \
    binutils \
    libatomic1 \
    jq \
    strace \
    netcat-openbsd \
    && rm -rf /var/lib/apt/lists/*

# Now install pyotp using the newly installed pip
RUN pip3 install pyotp --break-system-packages

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

# Playwright
# Install Node.js (required for Playwright MCP) and browser dependencies
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    libxss1 libatspi2.0-0 libgtk-3-0 fonts-liberation \
    libappindicator3-1 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex @playwright/mcp playwright

# Ensure npm and Playwright cache roots exist and are owned by goose user.
RUN mkdir -p /home/goose/.npm /home/goose/.cache && \
    chown -R goose:goose /home/goose/.npm /home/goose/.cache

# Claude/Codex/tunnelto dirs
RUN mkdir -p /home/goose/.local/bin /home/goose/.claude /home/goose/.codex \
             /home/goose/.tunnelto/bin && \
    chown -R goose:goose /home/goose/.local /home/goose/.claude /home/goose/.codex \
                         /home/goose/.tunnelto

    # Switch to goose user for browser installation
USER goose

# Install Playwright-managed Chromium as goose user so the cache lands in /home/goose/.cache/ms-playwright/
RUN npx playwright@latest install chromium

# Installing Claude
RUN curl -fsSL https://claude.ai/install.sh | bash

# Installing tunnelto (x86_64 only — no arm64 release available)
RUN arch=$(uname -m) && \
    if [ "$arch" = "x86_64" ]; then \
        curl -sL https://tunnelto.dev/install.sh | sh; \
    else \
        echo "Skipping tunnelto install: no release for $arch"; \
    fi

ENV PATH="/home/goose/.local/bin:/home/goose/.tunnelto/bin:${PATH}"
USER root

# 3. Set home directory
ENV HOME=/home/goose

# 4. Entrypoint script to start the Docker daemon
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Goose usually runs as a specific user, but DinD daemon needs root
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

FROM denoland/deno:alpine

LABEL version="1.0.0"
LABEL org.opencontainers.image.source="https://github.com/edelauna/prompt2pwn"
LABEL org.opencontainers.image.description="MCP XAI Server for prompt2pwn"
WORKDIR /app
COPY deno.json deno.lock server.ts ctf.ts .
RUN apk add --no-cache curl && deno cache server.ts
EXPOSE 1337

CMD ["deno", "run", "--allow-net", "--allow-env", "server.ts"]

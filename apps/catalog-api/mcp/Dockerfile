# input: Catalog MCP source plus pinned Bun dependencies
# output: Non-root Streamable HTTP MCP container
# pos: Public protocol adapter in front of the private Catalog API

FROM oven/bun:1.3.14-alpine

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile
COPY src ./src

USER bun
EXPOSE 8789
CMD ["bun", "run", "src/index.ts"]

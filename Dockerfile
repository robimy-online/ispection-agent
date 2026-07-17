# Build stage — compile TypeScript to dist/ (dev deps live only here).
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage — no node_modules: the agent has zero runtime deps (only Node built-ins).
# iputils gives a predictable `ping` (RTT + packet loss); BusyBox ping would also work.
FROM node:24-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache iputils
# /data is the default data dir so `docker run -v vol:/data` persists the key/buffer with no extra env.
ENV NODE_ENV=production \
    AGENT_DATA_DIR=/data
# Link the image to its repo on GHCR + opt in to label-scoped Watchtower auto-update (harmless if unused).
LABEL org.opencontainers.image.source="https://github.com/robimy-online/ispection-agent" \
      com.centurylinklabs.watchtower.enable="true"
COPY package.json ./
COPY --from=build /app/dist ./dist
# Run unprivileged. The `node` user (uid 1000) owns /data so a fresh named volume inherits that
# ownership and the Ed25519 key/buffer stay writable. Non-root ping uses ICMP datagram sockets
# (net.ipv4.ping_group_range, set in compose / via --sysctl); without it the agent falls back to TCP.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
CMD ["node", "dist/index.js"]

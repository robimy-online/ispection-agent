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
ENV NODE_ENV=production
# Link the image to its repo on GHCR + opt in to label-scoped Watchtower auto-update (harmless if unused).
LABEL org.opencontainers.image.source="https://github.com/robimy-online/ispection-agent" \
      com.centurylinklabs.watchtower.enable="true"
COPY package.json ./
COPY --from=build /app/dist ./dist
CMD ["node", "dist/index.js"]

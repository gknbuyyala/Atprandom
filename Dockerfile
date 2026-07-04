# Ask The Professor shuffle player — tiny, dependency-free container.
FROM node:20-alpine

# Non-root for safety (QNAP maps container users onto the host).
WORKDIR /app

# No npm dependencies: copy just the app files.
COPY index.html generate-episodes.mjs server.mjs episodes.json ./

ENV PORT=8080 \
    REGEN_ON_START=true \
    REGEN_INTERVAL_HOURS=168 \
    WEB_ROOT=/app

EXPOSE 8080

# Basic container healthcheck.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

USER node
CMD ["node", "server.mjs"]

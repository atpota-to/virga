# The worker (worker/README.md). Built from the repository's root:
#   docker compose -f worker/compose.yaml up -d --build
# One package (@atproto/api, for the moderator's DMs), from worker/'s own
# lockfile, and the few modules of the server and the engine it shares.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false

# "type": "module" for the shared modules below.
COPY package.json ./
COPY worker/package.json worker/package-lock.json ./worker/
RUN cd worker && npm ci --omit=dev --no-audit --no-fund

# Only what runs: never worker/.env, which compose passes in at run time
# (and .dockerignore keeps out of the build context).
COPY worker/main.js worker/drive.js worker/dmLoop.js worker/agent.js worker/check.js worker/model.js worker/moderator.js worker/state.js worker/virga.js ./worker/
COPY server/defense/workerAuth.js ./server/defense/workerAuth.js
COPY src/defense/command.js ./src/defense/command.js

# The moderator's session and how far its DMs have been read, kept across restarts.
RUN mkdir -p /data && chown node:node /data
VOLUME /data

USER node
CMD ["node", "worker/main.js"]

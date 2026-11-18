# The worker (worker/README.md). Built from the repository's root:
#   docker compose -f worker/compose.yaml up -d --build
# It needs no packages: Node's own fetch and crypto, and the one module of the
# server it signs with.
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false

# Only what runs: never worker/.env, which compose passes in at run time
# (and .dockerignore keeps out of the build context).
COPY package.json ./
COPY worker/main.js worker/drive.js ./worker/
COPY server/defense/workerAuth.js ./server/defense/workerAuth.js

USER node
CMD ["node", "worker/main.js"]

FROM node:22-bookworm-slim AS runtime-base

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    dumb-init \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY patches ./patches

RUN npm ci

COPY src ./src

RUN mkdir -p /app/data /app/backups /app/logs /app/openwa-session \
  && chown -R node:node /app

FROM runtime-base AS cloud-runtime

USER node

EXPOSE 3002

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start:whatsapp-cloud"]

FROM runtime-base AS openwa-runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

USER node

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "smoke:openwa"]

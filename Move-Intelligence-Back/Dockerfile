FROM node:20-bookworm-slim AS node-builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /build/back
COPY Move-Intelligence-Back/package*.json ./
RUN npm ci
COPY Move-Intelligence-Back/ ./
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/back
COPY --from=node-builder /build/back/node_modules ./node_modules
COPY --from=node-builder /build/back/dist ./dist
COPY --from=node-builder /build/back/scripts ./scripts
COPY --from=node-builder /build/back/prisma ./prisma
COPY --from=node-builder /build/back/package*.json ./
COPY Move-Intelligence-Dados /app/data
RUN pip3 install --break-system-packages --no-cache-dir -r /app/data/requirements.txt
ENV NODE_ENV=production MOVE_INTELLIGENCE_DATA_DIR=/app/data PYTHON_BIN=python3
EXPOSE 3000
CMD ["sh", "-c", "if [ \"$RUN_DB_PUSH_ON_BOOT\" = \"true\" ]; then npx prisma db push; fi; exec node dist/main.js"]

# ---------------------------------------------------------------------------
# Stage 1 — build the client bundle and install production dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# manifests first so the dependency layer caches across source-only changes
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --no-audit --no-fund

COPY shared/ shared/
COPY server/ server/
COPY client/ client/
RUN npm run build -w client \
    && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Stage 2 — runtime: Node + LibreOffice + poppler + metric-compatible fonts
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim

# libreoffice-writer: DOCX→PDF previews/export (full suite not needed)
# poppler-utils:      pdftotext/pdftoppm → preview hover overlays
# carlito/caladea:    metric-compatible with Calibri/Cambria (common resume
#                     fonts that can't be redistributed) — keeps rendering
#                     faithful; liberation covers Arial/Times/Courier
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-writer \
        poppler-utils \
        fonts-liberation \
        fonts-crosextra-carlito \
        fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

# Codex CLI preinstalled — sign in via Settings → Connect ChatGPT,
# `docker exec -it tailr codex login`, or set OPENAI_API_KEY
RUN npm install -g @openai/codex && npm cache clean --force

WORKDIR /app
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared ./shared
COPY --from=build /app/server ./server
COPY --from=build /app/client/dist ./client/dist

# /data holds everything mutable: app.db, storage/, logs/, codex credentials.
# One volume = one backup.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=7777 \
    TAILR_DATA_DIR=/data \
    CODEX_HOME=/data/.codex
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data

# 7777 app · 1455 codex OAuth callback (only needed during ChatGPT sign-in)
EXPOSE 7777 1455

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:7777/api/boards').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["./node_modules/.bin/tsx", "server/src/index.ts"]

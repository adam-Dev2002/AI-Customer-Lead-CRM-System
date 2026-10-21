# syntax=docker/dockerfile:1
FROM node:22.23.3-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global pnpm@10.34.7
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1 \
    CRM_STANDALONE_OUTPUT=1 \
    CRM_DATA_DIR=/tmp/customerlead-build
COPY . .
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && pnpm build

FROM node:22.23.3-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3001 \
    CRM_DATA_DIR=/data/crm CRM_REPORT_BROWSER_EXECUTABLE=/usr/bin/chromium
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node scripts/start-container.mjs ./start-container.mjs
RUN mkdir -p /data/crm && chown node:node /data/crm
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3001/login',{signal:AbortSignal.timeout(8000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "start-container.mjs"]

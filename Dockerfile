# ── Stage 1: build ────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force \
    && find node_modules -type f \( -name "*.md" -o -name "*.markdown" -o -name "LICENSE*" -o -name "CHANGELOG*" -o -name "*.map" -o -name "*.ts" ! -name "*.d.ts" \) -delete \
    && find node_modules -type d \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "docs" -o -name ".github" -o -name "examples" \) -prune -exec rm -rf {} +

# Copy compiled output and generated Prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 3004

CMD ["node", "dist/index.js"]

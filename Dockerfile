FROM node:20-slim AS base
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY prisma ./prisma/
RUN npm ci

# Build
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build


# Production
FROM node:20-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=base /app/dist ./dist
COPY prisma ./prisma/

# Generate prisma client at runtime stage
RUN npx prisma generate

EXPOSE 3004

CMD ["node", "dist/index.js"]

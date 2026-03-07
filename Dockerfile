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

ARG DATABASE_URL
ARG JWT_SECRET
ARG FRONTEND_URL
ARG PORT
ARG RAZORPAY_KEY_ID
ARG RAZORPAY_KEY_SECRET
ARG RAZORPAY_WEBHOOK_SECRET
ARG RAZORPAY_PLAN_ID_STARTER
ARG RAZORPAY_PLAN_ID_GROWTH
ARG RAZORPAY_PLAN_ID_MULTI

ENV DATABASE_URL=$DATABASE_URL
ENV JWT_SECRET=$JWT_SECRET
ENV FRONTEND_URL=$FRONTEND_URL
ENV PORT=$PORT
ENV RAZORPAY_KEY_ID=$RAZORPAY_KEY_ID
ENV RAZORPAY_KEY_SECRET=$RAZORPAY_KEY_SECRET
ENV RAZORPAY_WEBHOOK_SECRET=$RAZORPAY_WEBHOOK_SECRET
ENV RAZORPAY_PLAN_ID_STARTER=$RAZORPAY_PLAN_ID_STARTER
ENV RAZORPAY_PLAN_ID_GROWTH=$RAZORPAY_PLAN_ID_GROWTH
ENV RAZORPAY_PLAN_ID_MULTI=$RAZORPAY_PLAN_ID_MULTI

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=base /app/dist ./dist
COPY prisma ./prisma/

# Generate prisma client at runtime stage
RUN npx prisma generate

EXPOSE 3004

CMD ["node", "dist/index.js"]

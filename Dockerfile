FROM node:20-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

# --- Production image ---
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && rm -rf /root/.npm

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

ENV TRANSPORT=sse
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]

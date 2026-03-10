# Build stage
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:20-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

VOLUME /data

EXPOSE 3001

CMD ["node", "dist/index.js"]

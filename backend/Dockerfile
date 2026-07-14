FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tsconfig*.json ./
RUN npm install
EXPOSE 3000
RUN apk add --no-cache openssl
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && npx prisma db seed || true && node dist/src/main"]

FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server ./server
USER node
ENV HOST=127.0.0.1 PORT=8787 NODE_ENV=production
CMD ["node","server/index.mjs"]

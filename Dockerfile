FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4180 DATA_FILE=/data/vesper.sqlite
COPY package.json server.mjs admin.mjs security.mjs ./
COPY public ./public
COPY scripts/start-production.mjs ./scripts/start-production.mjs
RUN mkdir -p /data
EXPOSE 4180
CMD ["node", "scripts/start-production.mjs"]

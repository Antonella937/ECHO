FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node server.mjs ./
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]

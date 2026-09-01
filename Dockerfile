FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/knowledge ./knowledge
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations
EXPOSE 8080
USER node
CMD ["node","dist/src/server.js"]

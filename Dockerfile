FROM node:20-alpine AS build
WORKDIR /app

# Install deps (full, for build step)
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# Copy source and build
COPY . .
RUN npm run build

# Strip dev deps for the runtime image
RUN npm prune --omit=dev

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 5000
CMD ["node", "dist/index.cjs"]

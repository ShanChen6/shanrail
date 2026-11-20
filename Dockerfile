FROM node:24-bookworm-slim
WORKDIR /app
RUN npm install --global pnpm@11.18.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
COPY apps apps
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build
USER node

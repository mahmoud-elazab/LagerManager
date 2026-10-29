FROM node:26.7.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts ./
COPY public/ public/
COPY src/ src/
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.28.2-alpine AS runtime
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/server.conf.template /etc/nginx/lagermanager.conf.template
COPY --chmod=755 nginx/start.sh /usr/local/bin/start-frontend
COPY --from=build /workspace/dist/ /srv/lagermanager/
USER 101:101
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/start-frontend"]

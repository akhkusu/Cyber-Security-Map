# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
# Optional CA mount supports managed HTTPS proxies without weakening TLS checks.
RUN --mount=type=secret,id=proxy_ca,mode=0444 \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --ignore-scripts --no-audit --no-fund --strict-ssl=true

FROM dependencies AS source
COPY --chown=node:node index.html tsconfig.json vite.config.ts vitest.config.ts ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public

FROM source AS checks
RUN --network=none npm run lint && npm test && npm run build

FROM dependencies AS browser-dependencies
USER root
RUN npx --no-install playwright install --with-deps chromium \
    && mv /root/.cache/ms-playwright /opt/playwright \
    && chmod -R a+rX /opt/playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
USER node

FROM browser-dependencies AS browser-tests
COPY --chown=node:node index.html tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node e2e ./e2e
CMD ["npm", "run", "test:e2e"]

FROM source AS build
RUN --network=none npm run build

FROM nginx:stable-alpine AS runtime
COPY --chmod=0644 docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -Y off -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]

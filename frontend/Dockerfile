# syntax=docker/dockerfile:1
# Frontend image: build with Node, serve the static files with nginx. No Node or tooling is needed on the host.
#
#   docker build -t school-admission-frontend ./frontend                          # build + serve
#   docker build --build-arg VITE_API_BASE_URL=http://localhost:8080 ./frontend   # point at another API
#   docker build --target test ./frontend                                         # lint + build + tests only

ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

# ---- dependencies (cached until package*.json changes)
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- test: `docker build --target test` runs the whole quality gate; it fails the build on any problem
FROM deps AS test
COPY . .
RUN npm run lint && npm run build && npm test

# ---- build: the API address is baked into the bundle at build time (Vite replaces import.meta.env.VITE_*)
FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY . .
RUN npm run build

# ---- serve
FROM ${NGINX_IMAGE} AS serve
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q --spider http://127.0.0.1/healthz || exit 1

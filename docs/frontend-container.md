# Frontend Docker image

The frontend image builds React/TypeScript with Node and serves the generated files with Nginx. It does not run Vite. Backend security, relative `/api` URLs, memory-only authentication and normal IntelliJ/Vite development are unchanged. Compose is a later step.

## Build

From the repository root with Docker running:

```sh
docker build -t lagermanager-frontend:local frontend
```

The build uses official `node:26.7.0-bookworm-slim`, matching the verified local Node version and locked dependency engine requirements. It runs `npm ci` from the unchanged lockfile and `npm run build`. The runtime uses the Nginx project's official unprivileged image, `nginxinc/nginx-unprivileged:1.28.2-alpine`, running as UID/GID 101 on port 8080. Both images support Apple silicon; the verified image is linux/arm64. Version updates should be deliberate reviewed changes.

Only `dist` is copied from the build stage into `/srv/lagermanager`. Node, npm, application sources, tests and build dependencies are absent from the runtime. The frontend build context excludes environment files, credentials, local dependencies/build output and editor/repository metadata. Never place secrets in frontend source, public assets or Vite variables: compiled frontend content is public. No database configuration, signing key or private account file belongs in this image.

Building the image does not start containers or connect to the backend/database.

## Connect frontend and backend

Both containers must share a user-defined Docker network. The browser connects to Nginx; Nginx resolves the backend name inside that network. It does not use the browser's `localhost` to find the backend.

For manual use, first follow the [backend image instructions](backend-container.md) and deliberately configure its database connection with the schema-validation override. This step's automated verification does not use the existing Mac database.

For a backend container already named `lagermanager-backend` from that guide:

```sh
docker network create lagermanager-local
docker network connect --alias backend lagermanager-local lagermanager-backend
docker run --detach --name lagermanager-frontend \
  --network lagermanager-local \
  --publish 127.0.0.1:8082:8080 \
  --env API_UPSTREAM=http://backend:8080 \
  lagermanager-frontend:local
```

Create the network/connect the backend only once. Alternatively, add `--network lagermanager-local --network-alias backend` when initially creating the backend container. The backend must become reachable for API requests to succeed. No backend host-port publication is required for container-to-container traffic; existing manual publication on 8081 may remain for separate HTTP checks. Do not stop or replace an unrelated backend to follow this example. For all three services with readiness dependencies and separate Docker MySQL, see [Compose](compose.md).

Open http://localhost:8082 for manual use. HTTP checks:

```sh
curl -i http://localhost:8082/
curl -i http://localhost:8082/api/products
```

Expect the application HTML and an unauthenticated 401 respectively. This does not prove successful login or browser behavior. The backend must have deliberately provisioned application accounts for real login.

## Runtime API configuration

`API_UPSTREAM` is required at container startup. It accepts a single HTTP origin with a hostname/IPv4 address and explicit port, for example `http://backend:8080` or `http://another-backend:8080`. Ports must be 1–65535. Missing values, HTTPS/other schemes, user information, paths, queries, whitespace and configuration injection are rejected with a clear startup error, without echoing the supplied value. IPv6 literals and HTTPS upstreams are outside this local workflow. Unresolvable/unavailable backends produce API gateway errors until DNS/service recovery; static serving remains available.

Change `--env API_UPSTREAM=http://another-backend:8080` when recreating the frontend container to select another reachable backend, without rebuilding assets or the image. Nginx uses Docker's DNS resolver with a shared upstream zone and five-second refresh, so backend address changes recover without restarting the frontend. The upstream is server-side configuration, not a secret embedded in browser assets.

Nginx preserves the complete `/api` path/query, HTTP methods, bodies, Authorization header and backend status codes. `/api` and `/api/...` always use the proxy; missing API routes cannot fall through to the HTML application. Missing `/assets/...` files return 404. Backend errors are not replaced by HTML, and automatic upstream retries are disabled to avoid replaying stock operations or other mutations. No permissive CORS or backend-security change is needed. The startup script execs Nginx directly; it handles container shutdown signals. Access logging is disabled, and the configuration does not log request bodies or Authorization values.

Vite's existing development proxy is separate: `npm run dev` still serves localhost:5173 and forwards `/api` to localhost:8080 according to `vite.config.ts`. `API_UPSTREAM` controls only the container's Nginx proxy. The frontend container publishes host port 8082 to its unprivileged port 8080, while the separate backend guide uses host 8081 to backend 8080.

## Stop

Remove only containers/network you deliberately created:

```sh
docker stop lagermanager-frontend
docker rm lagermanager-frontend
```

If also removing this optional network, first disconnect the backend you explicitly connected, without stopping it:

```sh
docker network disconnect lagermanager-local lagermanager-backend
docker network rm lagermanager-local
```

Keep a shared network if another container still needs it. Built frontend/backend images remain available. No database storage is removed by these manual frontend commands.

## Verification evidence and limitations

Step 3 passed `npm test` (473 tests), `npm run build`, `npm run lint` and the actual Docker build. Runtime checks verified linux/arm64, UID 101, Nginx 1.28.2, absence of Node/npm/source, application HTML and both generated asset responses, plus missing-asset 404.

Actual backend verification used a task-owned MySQL 8.4.8 container with tmpfs storage, a fresh isolated schema and generated runtime authentication/signing configuration. No demo population or real accounts were used. Through Nginx, protected products and unknown API requests returned backend 401 rather than HTML; fictional login rejection returned 401 and invalid login input returned 400.

A separate temporary HTTP fixture verified the same frontend image with the runtime upstream override: GET/POST/PUT/PATCH/DELETE, full encoded paths/queries, bodies, Authorization forwarding, exact `/api` handling, status codes 207/400/401/403/404/409/500/503, and no automatic replay of a 503 request. Eight invalid/missing upstream cases failed startup. Nginx stopped cleanly with exit 0. All task-owned containers, network and temporary database/configuration storage were removed; both application images remain.

These are real container/HTTP proxy checks plus mocked component tests. They do not establish browser layout, a complete browser login flow, real-user authentication, host-database connectivity or business persistence through the frontend. No browser/native computer control was used. Automated checks never connected to the existing Mac database. See the local codex-report.txt for current command results and local evidence paths.

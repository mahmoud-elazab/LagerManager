# LagerManager frontend

React + TypeScript with Vite. This step includes a login form, signed-in placeholder, and local logout only.

## Prerequisites and installation

Node.js 22.12 or newer and npm (verified environment: Node.js 26.7.0, npm 11.19.0). All packages are local dependencies.

From the repository root:

```sh
cd frontend
npm ci
```

Keep `package-lock.json`. Use `npm install` when intentionally changing dependencies.

## Development

For real login, first start MySQL with the existing LagerManager database configuration. Supply the backend's required `LAGERMANAGER_JWT_SECRET` environment variable through your local environment, then start Spring Boot from the repository root:

```sh
./mvnw spring-boot:run
```

In another terminal, from the repository root:

```sh
cd frontend
npm run dev -- --host localhost --port 5173 --strictPort
```

Open http://localhost:5173. Stop with Ctrl+C. No backend port override exists in the repository, so Vite forwards `/api` to `http://localhost:8080` without removing the `/api` prefix. All frontend requests use relative `/api` URLs. If you launch Spring Boot with a different port, update the local proxy target accordingly.

The Vite proxy is for development only. Production hosting/API forwarding is outside this step. `npm run preview -- --host localhost` previews the static build; it does not establish production login connectivity. No backend CORS changes are required for the development proxy.

## Authentication behavior

Sign in sends JSON to `/api/auth/login`. Only a successful response with a nonempty token string and `tokenType: "Bearer"` is accepted. Password input is sent unchanged and cleared after successful login. Tokens stay only in React memory; they are never stored in browser storage, cookies, URLs, or logs. Claims are not decoded for authorization. Logout clears local authentication state without a backend logout request. Refreshing requires login again.

## Verification

```sh
npm run build
npm run lint
npm test
```

`build` checks TypeScript and generates ignored `dist/` output. `lint` runs Oxlint. `test` runs Vitest once with React Testing Library and jsdom. Tests mock fetch and use fictional inputs, needing neither MySQL nor a running backend. They cover success, failures, malformed responses, pending submissions, password handling, logout, and fresh-mount login. Mocked tests do not establish live backend connectivity. Live login testing remains for manual review.

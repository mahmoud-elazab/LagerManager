# LagerManager frontend

React + TypeScript with Vite. Includes login, a view-only authenticated Products screen, and local logout.

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


## Products

After login, GET `/api/products` sends the memory-only session token in the Bearer authorization header through the development proxy. The response is validated at runtime. The responsive, horizontally scrollable table displays name, SKU, category, product record quantity, and price. Nullable values show “Not specified”. Price has no currency label because the backend does not specify one. Product record quantity is not an aggregate of warehouse inventory.

Loading, empty-list, safe errors and recoverable-error Retry states are supported. HTTP 401 clears the current session and asks for sign-in again; HTTP 403 shows access denied without clearing the session. Logout remains available while loading and on errors. Obsolete requests are aborted and ignored on logout, unmount or session changes, including obsolete 401 responses. There are no product mutation, search, pagination or routing features.

### Manual verification after review

1. Start MySQL, Spring Boot and Vite as described above; use an approved test account for live review.
2. Sign in and confirm a Products table or the empty-list message appears. Inspect the request URL and authorization header without copying or recording the token.
3. Check the table at narrow and wide viewport sizes, keyboard navigation, screen-reader headers, quantity note and nullable-field presentation. No currency should be assumed.
4. Using mocked responses or controlled test fixtures, check loading, empty list, 403, network/server failures, malformed responses and Retry. A 401 should return to login with a sign-in-again message.
5. With a delayed mocked product response, log out and sign in again; the old response must not replace current products or expire the new session. Refresh to confirm sign-in is required again.

`npm test` includes mocked product-request and lifecycle tests. These do not prove live backend/proxy connectivity or visually verify a real browser.

The repository-root `/codex-report.txt` ignore rule keeps local reports out of new tracking. If a report is already tracked, it requires a separate manual removal from the version-control index while keeping the local file; ignore rules alone do not untrack existing files.

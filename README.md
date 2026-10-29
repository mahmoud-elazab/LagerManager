# LagerManager

Warehouse and inventory management with a Java 21 / Spring Boot 4.1.1 backend, MySQL, and a React / TypeScript frontend built with Vite. The frontend includes login, three resource lists, role-controlled creation/editing/deletion, inventory stock movements and immutable history. Product stock is derived from warehouse inventory.

## Prerequisites

- Java 21; use the included Maven wrapper.
- Node.js 22.12+ and npm; verified locally with Node.js 26.7.0 and npm 11.19.0.
- MySQL for a running backend. Tests use their own disposable MySQL process, described below.
- The three local demo application accounts are provisioned in the existing local database; see the ignored private account file. Normal startup does not create users.

## Configuration and startup

Supply configuration through your local environment without committing or recording its values:

| Environment variable | Purpose |
| --- | --- |
| `LAGERMANAGER_JWT_SECRET` | Required Base64 signing key encoding at least 32 cryptographically random bytes. Invalid or missing keys prevent startup. |
| `SPRING_DATASOURCE_URL` | JDBC URL for the existing local lagermanager database. Automated tests use disposable MySQL instead. |
| `SPRING_DATASOURCE_USERNAME` | Database account. |
| `SPRING_DATASOURCE_PASSWORD` | Database authentication. |
| `SERVER_PORT` | Optional backend port override. The default and development proxy target are 8080. |

Normal startup now requires explicit datasource settings; hardcoded database authentication and the implicit project URL were removed. Standard `SPRING_DATASOURCE_*` variables override the optional `LAGERMANAGER_DB_URL`, `LAGERMANAGER_DB_USER` and `LAGERMANAGER_DB_PASSWORD` aliases. Normal application startup currently uses Hibernate schema update. Pointing it at a database can modify that schema, so it is not the way to run isolated verification. The local lagermanager database is explicitly authorized as the demo database and has been populated non-destructively. No separate demo database or Spring profile is required.

Start the configured backend from the repository root:

```sh
./mvnw spring-boot:run
```

In a second terminal:

```sh
cd frontend
npm ci
npm run dev -- --host localhost --port 5173 --strictPort
```

Open http://localhost:5173. Stop each process with Ctrl+C. Vite forwards relative `/api` requests to the backend on localhost:8080 without removing `/api`. If overriding the backend port, update the local proxy target in `frontend/vite.config.ts`. This is a development proxy; production serving and deployment are outside Phase 4. No permissive CORS configuration is needed.

For local demo use, sign in with the named demo accounts in the existing lagermanager database. Preserve the original unrelated records. Population requires the explicit LAGERMANAGER_LOCAL_DEMO_POPULATE opt-in; normal startup never repeats it. Automated tests always use their own fresh disposable MySQL instance and never target this database. See the local demo guide for the merge and actual verification counts.

The normal local Docker stack is also prepared: `docker compose up -d --wait` serves http://localhost:8082 using an independently imported Docker MySQL copy. The Mac database and IntelliJ/Vite workflow remain separate; changes do not synchronize. See [database copy and backup](docs/database-copy.md) and [Compose instructions](docs/compose.md). Fresh Docker volumes do not create application users or import data automatically.

## Permissions

Backend authorization uses the user's current database role, never the role claim from an older JWT. `/api/auth/me` provides the frontend's display permissions; a later role change can still produce a server-side 403.

| Operation | ADMIN | MANAGER | EMPLOYEE |
| --- | --- | --- | --- |
| View products, warehouses, inventory; view own account | Yes | Yes | Yes |
| Create products, warehouses, inventory | Yes | Yes | No |
| Edit product or warehouse details | Yes | Yes | No |
| Receive, issue, adjust stock; view history | Yes | Yes | Yes |
| Same-quantity inventory metadata PUT (API only; lifecycle restrictions apply) | Yes | Yes | No |
| Delete products, warehouses, inventory | Yes | No | No |

POST `/api/auth/login` is public. Other resource operations require authentication: missing/invalid authentication is 401; insufficient permission is 403. Ordinary `/error` requests remain protected; internal error dispatch preserves the original status. No role hierarchy is used.

The UI keeps tokens only in React memory. Logout clears the local session; refresh requires login. Tokens last 60 minutes, with no refresh-token flow or backend logout/revocation endpoint. Aborting a request or signing out does not undo a server-side mutation. Mutation outcomes are confirmed before success is displayed; uncertain failures offer a read-only reload instead of automatic retries.

## Automated verification

From the root:

```sh
./mvnw -DskipTests compile
./mvnw test
```

From `frontend/`:

```sh
npm test
npm run build
npm run lint
```

Backend database tests start a new loopback-only MySQL process with a fresh temporary data directory, private port, generated authentication, and isolated schemas. The helper verifies data-directory ownership before writes and has no fallback to application datasource settings. It stops and removes its own server/data at JVM shutdown. Existing binary locations are detected by `DisposableMySql`; override the location if necessary:

```sh
./mvnw -Dlagermanager.test.mysql.binary=/path/to/mysqld test
```

If no suitable binary exists, `LagermanagerApplicationTests`, `InventoryReferencePersistenceTests` and `StockPersistenceTests` are explicitly skipped. Inspect the skipped count: a skipped run provides no persistence evidence. Startup failure with an available binary fails rather than connecting elsewhere. Some environments need permission for local ports, subprocesses and Mockito agent attachment. No Docker setup or dependency installation is required for this test infrastructure.

Frontend tests use mocked fetch with fictional data. Browser checks against HTTP fixtures verify the real rendered client, not the actual backend or database. The backend's real-MySQL integration tests independently verify foreign keys, transactions and deletion races; they are not full browser-to-backend end-to-end tests.

## Further documentation

- [Docker Compose: frontend, backend and separate persistent MySQL](docs/compose.md)
- [Imported local database, private backups and restore limitations](docs/database-copy.md)
- [Backend Docker image: build, isolated verification, and manual host-MySQL startup](docs/backend-container.md)
- [Frontend Docker image and runtime API proxy](docs/frontend-container.md)
- [Stock/movement API and legacy quantity treatment](docs/stock-management.md)
- [Explicit local demo setup and dataset](docs/local-demo.md)
- [Frontend behavior and manual verification](frontend/README.md)
- [Inventory-reference deletion conflict contract and transaction strategy](docs/inventory-deletion-conflicts.md)
- [Historical Phase 4 final verification evidence and limitations](docs/phase4-verification.md)

`DEV_TEST_ACCOUNTS.local.md` is an ignored private file for disposable generated demo accounts; never commit or copy its values. See the demo instructions for the existing single-database workflow, explicit merge opt-in and optional password-only reset.

`codex-report.txt` is a local verification report and remains ignored. An ignore rule does not untrack an already tracked file; any repository-index cleanup is a separate manual action. No Git commands were run during this verification.

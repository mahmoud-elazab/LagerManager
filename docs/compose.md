# Local three-service Docker Compose stack

From the repository root, Compose builds and starts the frontend, backend and a **separate Docker MySQL server**. The normal local project now has an explicitly imported copy of the Mac demo data; see [database copy and backup](database-copy.md). http://localhost:8082 uses Docker MySQL. The source Mac database remains unchanged and independent. A fresh volume still starts with **no application users or business records**; startup never imports data or creates demo accounts automatically.

## First setup

Docker Desktop and its Compose plugin must be available. Create a private environment file without overwriting an existing one:

```sh
cp -n .env.example .env
chmod 600 .env
```

Edit `.env` locally. Supply nonempty, independently chosen `MYSQL_ROOT_PASSWORD` and `MYSQL_APP_PASSWORD`, and a valid `LAGERMANAGER_JWT_SECRET` (Base64 encoding of at least 32 random bytes). `.env.example` contains no credential/key values. Choose the signing key deliberately; Compose does not generate it, change the IntelliJ key, or read local account credentials. Never place secret values in source, frontend assets, image build arguments, reports or shared terminal output. Real `.env` files are ignored and excluded from both image contexts.

`FRONTEND_PORT` defaults to 8082 and may be changed if occupied. Compose requires the three nonempty secret variables with useful missing-value errors; the backend also validates the signing key on startup. The MySQL application account is fixed to `lagermanager` and accesses only the `lagermanager` schema. The backend does not use root. Runtime variables are visible to Docker administrators; this is local development configuration, not an external secret-management system.

Validate without displaying resolved secrets, then start:

```sh
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

Use `config --quiet`; plain `docker compose config` or full container inspection can reveal resolved secret values. Wait until the services are healthy. Open http://localhost:8082. The existing normal local volume contains the imported demo accounts; use the private account file. A newly created volume has no application accounts until a separate explicit import/provisioning step.

## Networking and readiness

- `frontend`: Nginx on container port 8080, published only at `127.0.0.1:8082` by default. `API_UPSTREAM` is `http://backend:8080`.
- `backend`: Java 21 on internal port 8080; no host publication. JDBC uses `mysql:3306/lagermanager`, never the Mac's localhost or host.docker.internal.
- `mysql`: official version-pinned `mysql:9.7.2` LTS, internal port 3306; no host publication. The Step 5 compatibility-tested forward import from Mac MySQL 9.6.0 required replacing the earlier 8.4.8 pin; the Mac version was not changed.

All services share a project-scoped **internal** application network. Only the frontend also joins an ingress bridge to support its loopback port publication. No fixed container names or global volume/network names are used, so different Compose project names can coexist. Override `FRONTEND_PORT` for another project; verification uses an ephemeral loopback port.

MySQL health uses a real authenticated TCP `SELECT 1` as the application user against the intended schema. The backend waits for it, initializes its application context and schema, and is checked by a local HTTP request expecting 401 from the protected products endpoint. No public health/business API is added. This backend check establishes HTTP/security readiness after context initialization, not continuous authenticated database-operation monitoring. Frontend startup waits for backend health; frontend health checks actual static HTTP serving. An unhealthy result is reported by Docker; it does not itself restart a service or replay requests.

Nginx uses Docker's DNS resolver with a shared upstream zone and five-second DNS refresh. It recovers after backend replacement/address changes without restarting the frontend. Temporary API failures can occur while the backend is unavailable; requests are never automatically replayed. Paths, query strings, methods, bodies, Authorization headers and statuses remain intact. `/api` errors cannot return the SPA HTML. No permissive CORS change is made.

The prior [host-MySQL backend image workflow](backend-container.md) remains separate: it uses host.docker.internal and host port 8081. Compose uses its own MySQL and only exposes the frontend. [Vite development](../frontend/README.md) remains localhost:5173 with its unchanged proxy to the IntelliJ backend on localhost:8080. Do not point the Compose stack at the existing Mac database for troubleshooting.

## Schema and persistent storage policy

The named `mysql-data` volume is scoped to the Compose project, for example `<project>_mysql-data`. MySQL initialization creates the empty schema and dedicated database account on the first start of an empty volume. Hibernate's deliberately configured **update** mode creates/updates application tables in this separate local Docker schema; it never uses create-drop. This is a local first-start convenience, not a production migration strategy. Review schema changes before rebuilding against valuable Docker data; future controlled migrations are a separate concern.

Both demo population and password-reset flags are explicitly false in Compose, regardless of corresponding values in your shell. No initializer imports Mac data, seeds business rows or resets application accounts. The stock/movement lifecycle and API permissions are unchanged.

MySQL initialization variables apply only to a fresh volume. Editing `.env` later does **not** rotate existing MySQL account passwords or rebuild schema/data. A changed application password can cause readiness/authentication failures until credentials and the stored account are deliberately reconciled. Do not delete a populated volume or weaken grants to hide a mismatch. Database credential changes/imports require a separate explicit procedure. Changing the JWT signing key also invalidates tokens signed with the previous key; Compose never changes it automatically.

## Daily commands

```sh
docker compose ps
docker compose logs --tail=100 frontend backend mysql
docker compose stop
docker compose start
```

Logs are for local troubleshooting; inspect privately and do not share secrets. `start` resumes existing containers. Use `up -d --wait` when creating/reconciling services and waiting for readiness. To rebuild after code or proxy changes:

```sh
docker compose up --build -d
```

To stop and remove this project's containers/network while **retaining its database volume**:

```sh
docker compose down
```

A subsequent `docker compose up --build -d` reuses the same project-scoped volume, including accounts, business rows and movement history. Keep the project name consistent: another project name selects a different volume and therefore a different database.

**Destructive, optional only:** `docker compose down -v` deletes this Compose project's named database volume and all its stored data. It is not a normal stop/reset instruction. Do not run it unless you explicitly intend to destroy that project's Docker database. It was used only for the uniquely named disposable verification project, never for a normal/user project. No broad prune command is required.

## Troubleshooting

For missing environment errors, fill the required entries in your private `.env`; do not paste resolved config into reports. For invalid signing-key startup errors, supply a deliberately chosen valid Base64 key without replacing another workflow's key. For unhealthy MySQL, inspect local logs, check existing-volume credential consistency and disk capacity. For API 502 during backend replacement, wait for backend health and DNS refresh, then perform a read-only retry. Never automatically retry a stock mutation with an uncertain result. Port conflicts are limited to the frontend's host port; choose another `FRONTEND_PORT` rather than stopping unrelated processes. Do not change Docker Desktop settings or Mac MySQL access controls to make this isolated stack work.

## Verification boundaries

Step 4 uses a unique temporary project, generated runtime settings and a fresh project-scoped volume. Checks include quiet config validation, actual build/start/health, HTTP HTML/assets/401, a generated isolated application account, authenticated product/warehouse/inventory/stock operations, down/up persistence, backend replacement with a different IP while the frontend remains running, and complete task-owned cleanup. No existing database or real users are used. Local results are recorded in codex-report.txt.

The Step 4 HTTP and API checks do not establish browser layout or browser login behavior. Step 4 did not populate the normal database. The subsequent [Step 5 copy](database-copy.md) separately verified the real normal project's imported data, all demo logins and persistence; the normal stack is now running with that independent copy.

Actual Step 4 results: all three services became healthy; HTML and both generated assets returned 200, and unauthenticated products returned 401 through Nginx. An isolated generated ADMIN authenticated, created one product/warehouse/inventory, received seven initial items and issued two. Stock and derived product total were five, with two actor-attributed movements. The account, records and exact movement history survived down/up. A replacement backend with a verified different IP accepted the existing token through the unchanged frontend container. A separate HTTP fixture rechecked method/body/path/query/Authorization/status preservation and runtime overrides; 473 frontend tests, build and lint passed. The unique verification project and all its volume/network/container resources were removed; application images were retained. No normal project or Mac database was used.

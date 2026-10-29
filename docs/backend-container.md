# Backend Docker image

This step packages only the Spring Boot backend. IntelliJ startup and the existing local database configuration are unchanged. No Compose or frontend image is included.

## Build

Docker Desktop's engine must be running. From the repository root:

```sh
docker build -t lagermanager-backend:local .
```

The multi-stage build uses the existing Maven wrapper and official Eclipse Temurin `21.0.10_7-jdk-jammy`, then copies the executable JAR into `21.0.10_7-jre-jammy`. These version-pinned images support Apple silicon; a native build on this Mac produces linux/arm64. Rebuild deliberately with reviewed newer patch versions when updating Java. Tests run separately, not during image construction. Building an image does not start the application or connect to MySQL.

The runtime runs as UID/GID 10001 and starts Java directly as PID 1. Only the JAR and runtime image contents are retained; no Maven, application source, frontend, local credentials, or signing key is copied. The root `.dockerignore` allowlists backend build inputs and excludes local secret/environment files. Never put secrets into tracked backend resources or add secret build arguments.

## Manual connection to Mac-hosted MySQL

Configure these runtime environment variables privately in your terminal, reusing the existing signing key and database account. Values must not be committed or pasted into reports:

- `SPRING_DATASOURCE_URL`: `jdbc:mysql://host.docker.internal:3306/lagermanager`
- `SPRING_DATASOURCE_USERNAME`: existing database account
- `SPRING_DATASOURCE_PASSWORD`: existing database authentication
- `LAGERMANAGER_JWT_SECRET`: existing Base64 signing key (at least 32 random bytes before encoding)

Do not use `localhost` in the container's JDBC URL: that refers to the container itself. Docker Desktop provides `host.docker.internal` to reach the Mac. Standard `SPRING_DATASOURCE_*` variables override the existing `LAGERMANAGER_DB_*` aliases.

After deliberately configuring those four variables, start the image:

```sh
docker run --detach --name lagermanager-backend \
  --publish 127.0.0.1:8081:8080 \
  --env SPRING_DATASOURCE_URL \
  --env SPRING_DATASOURCE_USERNAME \
  --env SPRING_DATASOURCE_PASSWORD \
  --env LAGERMANAGER_JWT_SECRET \
  --env SPRING_JPA_HIBERNATE_DDL_AUTO=validate \
  --env SPRING_JPA_SHOW_SQL=false \
  --env LAGERMANAGER_LOCAL_DEMO_POPULATE=false \
  --env LAGERMANAGER_DEMO_RESET_PASSWORDS=false \
  lagermanager-backend:local
```

The explicit `validate` override prevents Hibernate's normal schema-update behavior. The existing schema must already match; this command is not a migration or population command. Population and password reset remain disabled by default and are explicitly disabled here. No private account file is available inside the image. The existing local population workflow remains documented separately and is not part of container startup.

Check the protected endpoint without credentials:

```sh
curl -i http://localhost:8081/api/products
```

Expect 401 after successful startup. Port 8081 on the Mac maps to 8080 in the container, avoiding the IntelliJ backend's port. The frontend development proxy still targets port 8080; it has not been integrated with this container.

Stop and remove only this named manual container when finished:

```sh
docker stop lagermanager-backend
docker rm lagermanager-backend
```

The image remains available for another run. Inspect container logs locally if needed, but do not share configuration secrets or sensitive logs. Docker runtime environment values are visible to users with Docker inspection access; they are not embedded in the image.

## Troubleshooting

If Docker cannot connect to its engine, start Docker Desktop yourself; no Docker settings need changing for this setup. An occupied port 8081 requires stopping only your own conflicting container or selecting another host port.

For host MySQL connection failures, verify that MySQL is running, the JDBC hostname is `host.docker.internal`, and the supplied database/schema and authentication are correct. A working Mac-local CLI connection alone does not establish access from Docker: host routing and MySQL account host restrictions may differ. Inspect the failure privately. Do not automatically change grants, root account access, bind addresses, passwords, or firewall rules. Any required access-policy change is a separate reviewed action. Schema-validation failures require reviewing the schema mismatch, not enabling automatic schema updates to bypass it.

## Verification boundaries

Run backend checks separately:

```sh
./mvnw -DskipTests compile
./mvnw test
```

The existing test helper owns fresh local MySQL processes/storage and never falls back to the project database. Check skipped counts. Container runtime verification uses a separately generated configuration, a dedicated Docker bridge network, a MySQL `8.4.8` container with disposable tmpfs storage, and an isolated test schema. Schema creation is permitted only there; no demo accounts or population are used. Task-owned containers/network/storage are removed afterward while retaining the built backend image. The report records actual build/runtime evidence; these checks do not establish container access to the existing Mac database or frontend connectivity.

The Step 2 run built `lagermanager-backend:local` as linux/arm64 and verified Java 21.0.10, UID 10001, direct Java startup, real Spring Boot startup against disposable MySQL 8.4.8, and HTTP 401 for unauthenticated `GET /api/products`. The isolated database contained no accounts, inventory, or movements. Both temporary containers and their dedicated network/tmpfs storage were removed, and the image was retained. Compilation and all 214 backend tests passed with zero skips. Host-database connectivity was deliberately not tested.

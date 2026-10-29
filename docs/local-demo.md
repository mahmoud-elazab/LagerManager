# Local demo: the existing LagerManager database

The existing local `jdbc:mysql://localhost:3306/lagermanager` database **is** the demo database. No separate database or Spring profile is required or created. Existing rows are preserved. Population is an explicit one-time action; normal startup never automatically populates or resets accounts.

## Normal startup

Reuse the existing local datasource configuration and the existing `LAGERMANAGER_JWT_SECRET` from the `LagermanagerApplication` IntelliJ run configuration. Do not print or replace that signing key. Standard `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` or the existing `LAGERMANAGER_DB_*` aliases configure the connection. Authentication values are intentionally omitted from documentation.

From the repository root, with that existing environment configured:

```sh
./mvnw spring-boot:run
```

No profile or population flag is needed. In another terminal:

```sh
cd frontend
npm run dev -- --host localhost --port 5173 --strictPort
```

Open http://localhost:5173. The development proxy expects the backend on 8080. Working application credentials for the three demo roles are in the ignored, owner-only `DEV_TEST_ACCOUNTS.local.md`. That file contains neither database authentication nor the signing key.

## Explicit population

The database already has the current business schema. The merge adds one non-destructive identity-mapping table, `demo_seed_record`; its explicit, idempotent DDL is [local-demo-manifest.sql](../src/main/resources/db/local-demo-manifest.sql). This table was created during the authorized local population. The SQL only creates that tracking table if missing; it never creates a database, drops/truncates tables or changes existing business schemas.

When deliberately populating the local demo again:

```sh
LAGERMANAGER_LOCAL_DEMO_POPULATE=true ./mvnw spring-boot:run -Dspring-boot.run.arguments=--spring.jpa.hibernate.ddl-auto=validate
```

Unset the population flag for ordinary use. No special profile is used. The previous separate-database/profile workflow is removed. The old seed flag is not the population opt-in.

Population/reset validates the explicitly authorized local database URL before datasource initialization and requires Hibernate `validate`, so the operation cannot issue schema updates. Remote/unapproved databases and automatic database-creation URL options are rejected. Automated tests use only the existing disposable MySQL helper and its private test schema, never this running database.

## Non-destructive merge policy

A database-scoped lock serializes population attempts. Account changes, new business rows, movements, identity mappings and the completion marker commit together in one transaction.

- Products are initially matched by their planned SKU and exact metadata. Warehouses are initially matched by name/location/capacity. Clearly matching records are reused without overwriting their fields. Conflicting or ambiguous identities stop the whole operation safely rather than replacing records or guessing.
- Inventory is initially matched by product/warehouse IDs. An existing unambiguous record is reused with its current quantity and history; no opening receipt, adjustment or other movement is fabricated for it. Multiple matches are ambiguous and stop setup; this is a seeder safety check, not a new API uniqueness restriction.
- New inventory alone receives its initial and subsequent sample movements. Zero initial stock creates no receipt. Legacy product quantities are never converted into warehouse stock.
- `demo_seed_record` tracks stable business IDs for all 12 planned products, 3 warehouses and 18 inventory slots. Repeat runs use those IDs, never replay receipts or reset manual metadata/quantity/association changes. Manually deleted tracked records are reported missing and are not recreated. The map has no delete cascade or business-record mutation API.
- Only `demo-admin@lagermanager.test`, `demo-manager@lagermanager.test` and `demo-employee@lagermanager.test` may be created or updated. On explicit population they get their corresponding role, enabled state and matching BCrypt password from the private account file. Existing account IDs/emails are retained. Unrelated accounts and database users are untouched. Already matching hashes are not regenerated.
- The original private file/setup marker must agree once a marker exists. The seeder does not replace files or infer ownership from an unrelated marker. Keep that file private and preserve its setup ID.

## Actual local population and verification

The explicitly authorized operation completed on the existing local database:

| Resource | Before | Inserted | Final |
| --- | ---: | ---: | ---: |
| Products | 4 | 12 | 16 |
| Warehouses | 2 | 3 | 5 |
| Inventory | 2 | 18 | 20 |
| Movements | 0 | 28 | 28 |
| Application accounts | 1 | 3 | 4 |

The new products span five categories. The three new warehouses each have six inventory records; multiple warehouses stock the same product. The new dataset includes four zero-stock inventory records and three products without inventory. All eighteen new histories start at zero and agree with their saved quantities. Their stock sums to 667; all inventory, including the preserved original records, sums to 924. API product totals agree with current inventory.

Live HTTP login and `/api/auth/me` verification succeeded for ADMIN, MANAGER and EMPLOYEE. Every original business row and the unrelated application account was compared before/after in memory, including original account authentication fields; none changed. No history was added to the two preexisting inventory records. Existing table column definitions and the IntelliJ run configuration/signing key were unchanged. Only the new tracking table was added.

Repeating population inserted zero products, warehouses, inventory, movements or accounts, reused all 12/3/18 tracked business rows and all three accounts, and changed no stored rows. A subsequent ordinary startup with population disabled (the normal default), schema validation and no special profile also authenticated all three roles and changed no stored data. Temporary verification servers were stopped; data remains in the existing local database.

This is actual backend/database/HTTP evidence, not browser verification. No Chrome or other computer control was used. Automated tests were run separately on disposable MySQL and cover matching reuse, ambiguity/conflict refusal, manual edits/deletions, history preservation, concurrency and transaction rollback.

## Optional password-only reset

For a deliberate password-only change after editing the private file, reuse the same database and signing key:

```sh
LAGERMANAGER_LOCAL_DEMO_POPULATE=false LAGERMANAGER_DEMO_RESET_PASSWORDS=true SERVER_PORT=0 ./mvnw spring-boot:run -Dspring-boot.run.arguments=--spring.jpa.hibernate.ddl-auto=validate
```

Wait for the non-sensitive completion message, then stop the temporary process with Ctrl+C. Normal startup leaves both flags unset. Password-only reset preserves current roles/enabled states and never seeds data; explicit population, in contrast, restores the three named demo accounts' requested roles and enabled states. The two modes cannot run together. Neither changes the JWT signing key or revokes existing JWTs.

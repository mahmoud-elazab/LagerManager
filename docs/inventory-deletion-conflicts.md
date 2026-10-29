# Inventory-reference deletion conflicts

ADMIN-only deletion authorization is unchanged. Deleting a referenced product or warehouse returns HTTP 409 with exactly these public fields:

```json
{"code":"INVENTORY_REFERENCE_CONFLICT","message":"This product is used by inventory and cannot be deleted."}
```

The warehouse message is `This warehouse is used by inventory and cannot be deleted.` The exception is raised only by an explicit inventory-reference check. Database exception text is never copied into this response. Other integrity failures, lock timeouts and unexpected errors are not translated into this code. Unlinked deletion still returns an empty successful response; already-missing IDs keep their existing no-op success policy. Inventory-record deletion is unchanged.

## Transaction and race strategy

Each product/warehouse deletion runs in its own short `REQUIRES_NEW`, `READ_COMMITTED` transaction:

1. Lock the existing parent row using `PESSIMISTIC_WRITE` before checking inventory.
2. Query for current committed inventory references. If present, raise the domain conflict and roll back.
3. Delete and explicitly flush within the same transaction. Commit completes before the HTTP method returns.

This relies on InnoDB's active restrictive foreign keys from inventory to its parent records. Foreign-key checks acquire a shared lock on the referenced parent, conflicting with the deletion's exclusive lock. If an inventory writer acquired that lock first, deletion waits and then sees its committed reference. If deletion acquired it first, a new inventory reference waits; after deletion commits, that writer fails its foreign-key check instead of committing a dangling reference. The reference check cannot use a stale repeatable-read snapshot. No cascade, association detachment or schema-constraint changes were introduced.

Unexpected constraints are left untouched: for example, a separate unrelated table referencing a product causes ordinary deletion failure/rollback, not an invented inventory-reference conflict. A real inventory reference legitimately blocks deletion even if other restrictions might also exist.

Primary background: [MySQL InnoDB locks and foreign-key checks](https://dev.mysql.com/doc/refman/8.4/en/innodb-locks-set.html), [transaction isolation](https://dev.mysql.com/doc/refman/8.4/en/innodb-transaction-isolation-levels.html).

## Isolated verification

`./mvnw test` uses existing JUnit/Spring/MySQL JDBC tooling; no new dependencies or Docker are required. The persistence suite and existing application-context test use `DisposableMySql`:

- Finds an existing local server binary, or accepts `-Dlagermanager.test.mysql.binary=/path/to/mysqld`.
- Starts a new mysqld with `--no-defaults`, a generated temporary data directory, loopback-only private port and generated ephemeral authentication.
- Verifies `@@datadir` is its own temporary directory before writing anything. There is no fallback to application datasource settings or the project's database.
- Uses distinct disposable schemas for the persistence and context tests. Temporary server/data are removed at JVM shutdown.
- If no binary is available, the database-dependent classes are explicitly skipped. Such a run does not prove database behavior; inspect skipped counts. If a binary exists but startup fails, tests fail rather than using another database.

Run:

```sh
./mvnw -DskipTests compile
./mvnw test
# Optional binary location override:
./mvnw -Dlagermanager.test.mysql.binary=/path/to/mysqld test
```

Tests assert actual InnoDB engine metadata, restrictive foreign-key rules, safe HTTP 409 bodies, unlinked/missing deletion behavior, ADMIN authorization, direct foreign-key rejection without cascading, and both concurrent writer/deleter orderings. The after-check test uses a repository spy only as a scheduling barrier: its predicate executes a real transaction-bound JPQL query against MySQL, while parent locking, DELETE, INSERT, blocking, rollback and foreign-key failures are real database operations. A separate non-inventory foreign key verifies HTTP 500 and rollback instead of blanket conflict classification.

These tests prove behavior on the freshly generated disposable schema and installed MySQL version. They do not inspect or certify existing deployed constraints. Deployments must retain InnoDB and active restrictive inventory foreign keys. Never disable them to make deletion succeed.

## Frontend behavior

Only HTTP 409 with the validated code and a nonempty string message is recognized for product/warehouse deletion. The UI constructs a concise resource-specific explanation locally, keeps the row visible and allows Cancel to dismiss. It never renders the server message verbatim. Unknown/malformed 409 bodies remain generic. A 500 remains an uncertain outcome even if its body contains the conflict code. There is no automatic DELETE retry or inventory mutation. Existing 401/403 handling and stale-session/request protection remain unchanged.

Manual UI verification after review should use mocks first, then disposable records in a designated test database. Do not use real records. Browser verification and deployed-constraint testing are separate from mocked frontend results.


## Stock-history lifecycle update

Inventory deletion now requires zero quantity and no movement history; otherwise it returns a safe `STOCK_HISTORY_CONFLICT` 409. History is never cascaded away or detached. Retained inventory continues to block product/warehouse deletion under this document's existing `INVENTORY_REFERENCE_CONFLICT` contract. Missing inventory deletion now returns 404. See [stock management](stock-management.md) for the coordinated API change and tests.

# Mac-to-Docker local database copy

The normal Compose project is `lagermanager`, using volume `lagermanager_mysql-data`. Its authorized import is complete. All three services are running, and **http://localhost:8082 uses the Docker copy**, not Mac MySQL. Use the unchanged application accounts in the ignored `DEV_TEST_ACCOUNTS.local.md`.

Mac MySQL and Docker MySQL now hold independent copies. Changes in one do not synchronize to the other. IntelliJ/Vite at localhost:5173 still use the Mac backend/database; their configuration and signing key were preserved. No database passwords, application passwords or signing values are included here.

## Start and stop

The ignored owner-only `.env` is prepared with Docker-only database authentication and the existing IntelliJ JWT signing key. Preserve it privately; initialization credentials belong to the stored Docker volume and are not reset by editing `.env`.

```sh
docker compose up -d --wait
docker compose ps
# Open http://localhost:8082
docker compose stop
# Later:
docker compose up -d --wait
```

`docker compose down` also preserves the named volume. Do not use `down -v`: it deletes this project's copied database. Do not repeat this import against the now-populated target. Startup never seeds data, resets application passwords or imports a backup automatically. Rebuilding application images does not import data.

## Compatibility decision

The source server and dump client are MySQL **9.6.0**. The original Compose image was **8.4.8**. A blind downgrade was not attempted. Docker alone was changed to official **mysql:9.7.2 LTS**, following the [supported Innovation-to-next-LTS upgrade path](https://docs.oracle.com/en-us/iaas/mysql-database/doc/major-version-upgrade.html) and [MySQL release model](https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html). The Mac server was not upgraded or reconfigured.

Before the normal volume was created, the logical snapshot was imported into a disposable 9.7.2 instance using temporary storage. Every row, table definition, index and foreign key matched the source snapshot; a deliberately invalid reference was rejected there. The normal target had no volume/containers initially and zero application tables immediately before import. This was a fresh target import, not an in-place Docker database upgrade or a merge.

## Backup and consistency

The primary retained snapshot is:

`local-backups/20261029T184743Z/lagermanager.sql`

Its adjacent `manifest.json` records versions, row counts and the dump checksum, without account values. An earlier snapshot from the initial temporary client-encoding check is also retained privately at `local-backups/20261029T184710Z/lagermanager.sql`. Both exports contain authentication hashes and must never be printed, committed, copied into images or shared as ordinary documentation. Backup directories are 0700; files are 0600. The root directory is ignored and excluded from Docker build contexts.

The export used a single InnoDB transaction with streaming reads. No table/database drops, database creation, GTID state, tablespaces, MySQL system tables, database accounts/grants or server configuration were exported. Source tables were ordered parent-first. Foreign-key/unique-check disabling statements normally emitted by mysqldump were removed from the import file; constraints stayed enabled throughout. Both sides used explicit UTF-8 clients and snapshot comparisons used UTC. All seven tables were included:

| Table | Rows in source snapshot and Docker |
| --- | ---: |
| app_users | 4 |
| product | 16 |
| warehouse | 5 |
| inventory | 20 |
| stock_movement | 28 |
| demo_seed_state | 1 |
| demo_seed_record | 33 |

For a future **read-only backup**, use the matching/newer compatible dump client and a new private directory. Pause manual writes and prevent schema changes/application restarts during the backup window. `--single-transaction` provides a consistent InnoDB data snapshot while readers continue; it does not protect against concurrent DDL, and later writes are not part of that snapshot. This copy compared every source row/schema before and after to confirm no changes during the operation. No unrelated source process was stopped.

Example from the repository root (the password prompt does not echo its value):

```sh
umask 077
BACKUP_DIR="local-backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
/usr/local/mysql/bin/mysqldump --protocol=TCP -h127.0.0.1 -P3306 -uroot -p \
  --default-character-set=utf8mb4 --single-transaction --quick --hex-blob \
  --no-tablespaces --set-gtid-purged=OFF --column-statistics=0 \
  --skip-add-drop-table --skip-add-locks --skip-disable-keys --skip-lock-tables \
  --skip-comments --skip-triggers --order-by-primary \
  --result-file="$BACKUP_DIR/export.raw.tmp" \
  lagermanager app_users demo_seed_state demo_seed_record product warehouse inventory stock_movement
```

The current schema has no views, triggers, routines or events. If that changes, review their dependency/definer handling before reusing the example; it is not a universal MySQL migration script. Check that all tables are transactional and that the dump command succeeds before proceeding. Do not import a partial dump.

Remove only the dump's constraint-toggle boilerplate privately, without printing rows:

```sh
python3 - "$BACKUP_DIR" <<'PY'
import pathlib, re, sys
folder = pathlib.Path(sys.argv[1])
raw = folder / 'export.raw.tmp'
text = ''.join(line for line in raw.read_text().splitlines(True)
               if not re.match(r'^/\*!\d+ SET .*\b(?:FOREIGN_KEY_CHECKS|UNIQUE_CHECKS)\b', line))
assert 'FOREIGN_KEY_CHECKS=0' not in text and 'UNIQUE_CHECKS=0' not in text
output = folder / 'lagermanager.sql'
with output.open('x') as stream:
    stream.write(text)
output.chmod(0o600)
raw.unlink()
PY
```

Retain the backup even if later validation/import fails. This procedure is deliberately limited to the inspected parent-first schema. Verify logical restore compatibility in disposable storage before touching any intended target; do not switch an existing volume to another MySQL image without checking its version and contents.

## Restore boundaries

The normal Docker database is now populated. No overwrite or merge is authorized by these instructions. For a separately approved restore to a verified empty target, stop its backend/frontend, verify its exact project/volume, ensure there are **no application tables/data**, then use the dedicated application user with the private Compose runtime authentication:

```sh
# Only after a separately reviewed empty-target preflight; not for the populated copy.
docker compose stop frontend backend
docker compose exec -T mysql sh -c \
  'MYSQL_PWD="$MYSQL_PASSWORD" mysql --protocol=TCP -h127.0.0.1 -u"$MYSQL_USER" "$MYSQL_DATABASE" --default-character-set=utf8mb4' \
  < "$BACKUP_DIR/lagermanager.sql"
```

This dump contains CREATE TABLE and INSERT statements, without DROP statements. It is not a merge tool and cannot restore safely into an existing populated schema. Never force past errors or disable constraints. MySQL DDL is not a single rollbackable transaction: a failed import can leave partial target tables/rows. Keep the export and source intact, leave the target application stopped, inspect the exact state privately, and obtain explicit authorization before any target cleanup. Do not automatically delete a volume.

After a successful import, compare full rows (including hashes/history) privately, table definitions, indexes and constraints; verify `foreign_key_checks=1`, zero orphan references and stock totals. Then start the stack and check logins using the private account file. No credentials belong in command arguments, reports or shared logs. Backups contain application users only, not MySQL database users; restore authentication comes from the target's own initialization configuration.

## Actual verification

- Normal import matched every source-snapshot row and schema/index/foreign-key definition, preserving IDs, BCrypt hashes, timestamps, reasons, legacy product values, stock and seed identities.
- Global/session foreign-key checks remained 1. No reseeding, password reset, movement replay or fabricated history occurred.
- All three named demo accounts logged in through the Nginx frontend; `/api/auth/me` returned ADMIN, MANAGER and EMPLOYEE respectively.
- Authenticated reads returned 16 products, 5 warehouses, 20 inventory records and all 28 movements. Every product total matched inventory; total stock was 924. No verification business records were created.
- Stop/start preserved every row, exact movement history, schema/index/foreign-key definitions and all three logins.
- Final MySQL/backend/frontend health is healthy, frontend is loopback-only on 8082, and the normal stack was left running. Temporary compatibility containers/storage were removed.

The source database, unrelated Mac processes, original run configuration/key and existing application passwords were unchanged. HTTP checks prove actual API/proxy login and reads, not browser layout or a complete browser interaction test. The local codex-report.txt records the current evidence and results.

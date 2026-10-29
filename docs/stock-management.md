# Inventory stock and movement API

## Source of truth and legacy data

Stock belongs to `Inventory`, linking a product and warehouse. Product responses (including nested products) expose `totalStock`, a read-only 64-bit sum of all associated inventory quantities, or zero when none exist. Product forms contain metadata and price only; the table labels the derived amount **Total stock**. Inventory still exposes its own `quantity`.

The legacy database `product.quantity` column and its stored values are retained. They are neither stock nor an input to totals. Product POST/PUT uses a metadata DTO: `quantity`, `totalStock` and `id` are ignored and cannot change stock or target another record. Updating metadata leaves the stored legacy quantity unchanged. A future reviewed migration can archive/reconcile the old values before removing the column. No legacy product values are silently assigned to a warehouse. No legacy quantities were migrated or removed. The existing local lagermanager database was subsequently explicitly authorized for non-destructive demo population; original quantities were preserved. See the local demo guide for actual verification.

Product description/category/null behavior and exact decimal request serialization are preserved. The backend's existing decimal storage precision policy is unchanged. Frontend numeric validation supports safe JavaScript integer totals; inventory quantities remain bounded by Java Integer. Legacy negative stock or orphan inventory requires explicit review; operations reject it rather than inventing an opening balance or product/warehouse association.

## Operations

All ADMIN, MANAGER and EMPLOYEE users may read history and change stock. ADMIN/MANAGER alone may create inventory; existing metadata/deletion permissions remain. The actor is taken from the authenticated server-side identity and stored as an email snapshot, so later user changes cannot erase historical attribution. Client actor/email/id fields never select an actor.

### POST `/api/inventory/{id}/movements`

```json
{"type":"RECEIVE","quantity":5,"reason":"Supplier delivery"}
```

| Type | Quantity means | Validation |
| --- | --- | --- |
| `RECEIVE` | Add this many items | Positive integer |
| `ISSUE` | Remove this many items | Positive integer; enough stock must exist |
| `ADJUST` | Set the resulting quantity | Nonnegative integer; meaningful reason required |

Quantities must be actual JSON integers within Java Integer range; strings, fractions, negatives and overflow are rejected. An adjustment reason requires at least three non-whitespace characters; all reasons are limited to 200 characters. Blank receipt/issue reasons receive a short server default. The signed change is computed by the server using wide arithmetic; overflow and negative resulting stock cannot be committed. A no-op adjustment returns the unchanged inventory without creating a movement.

Success returns HTTP 200 and the updated Inventory response, with nested product/warehouse and the inventory's resulting quantity. Stock and history are saved in one transaction. No automatic client retry is safe: an uncertain receipt/issue may have committed already.

### GET `/api/inventory/{id}/movements`

Returns newest-first immutable movement rows, for example:

```json
[{
  "id": 8,
  "inventoryId": 3,
  "type": "ISSUE",
  "quantityChange": -2,
  "previousQuantity": 12,
  "resultingQuantity": 10,
  "timestamp": "2026-10-29T10:00:00Z",
  "actor": "counter@example.test",
  "reason": "Order dispatch"
}]
```

There are no PUT/DELETE movement-history endpoints. No User entity, authentication material or inventory entity graph is embedded in a movement.

### Existing inventory paths

- POST inventory still accepts exactly productId, warehouseId and quantity. Strict validation and missing-association 404 are now explicit. Positive initial stock creates a RECEIVE from zero in the same transaction; zero creates no movement.
- PATCH `/api/inventory/{id}/quantity` now requires `{"quantity":25,"reason":"Cycle count"}`. It calls the same ADJUST service and cannot bypass history. Old clients must supply a reason.
- Full inventory PUT cannot change quantity: use the movement/PATCH path. A same-quantity PUT may preserve its association, or change associations only for zero stock with no movement history. Reassignment with stock or history is a conflict.
- Inventory DELETE requires zero stock and no history; otherwise it conflicts. An unknown inventory ID returns 404. Products and warehouses referenced by retained inventory remain protected by the existing inventory-reference conflict contract.

This deliberately retains inventory once it has a history, even after its stock reaches zero. It cannot be deleted, detached or reassigned to another product/warehouse. Movement history has a restrictive foreign key with no delete cascade. There is no archive/retention/deletion feature in this change.

Existing inventory quantities are opening balances predating this feature; historical events are not fabricated. The first new movement records the actual previous quantity and all subsequent changes. A future controlled opening-balance migration can reconcile preexisting inventory history. The fresh demo starts at zero and has a complete chain for every stocked inventory record.

## Transactions and concurrency

Every stock mutation obtains a `PESSIMISTIC_WRITE` lock on the inventory row. The resulting quantity and its movement are flushed within the same transaction; failure to persist history rolls back quantity (and initial inventory creation). Concurrent RECEIVE/ISSUE/ADJUST operations serialize on that inventory, preventing lost updates or mismatched before/after values. Full PUT and inventory deletion take the same row lock before their lifecycle checks. Restrictive database foreign keys also prevent direct deletion of referenced history.

## Safe errors

Domain errors return `{ "code": "...", "message": "..." }` without SQL or exception details:

| HTTP | Code / situation |
| --- | --- |
| 400 | `INVALID_STOCK_REQUEST`: invalid type, quantity, overflow or reason |
| 401 | Missing/invalid authentication; only the matching current frontend session expires |
| 403 | Authenticated user lacks permission |
| 404 | `INVENTORY_NOT_FOUND`, `PRODUCT_NOT_FOUND`, `WAREHOUSE_NOT_FOUND` |
| 409 | `INSUFFICIENT_STOCK`: an issue would overdraw |
| 409 | `STOCK_HISTORY_CONFLICT`: lifecycle restrictions or legacy opening-stock review required |
| 409 | `INVENTORY_REFERENCE_CONFLICT`: product/warehouse still referenced by inventory |
| 500 | Unrelated/unexpected failures; never assume the operation did not commit |

Malformed JSON is also 400 through Spring's safe standard handling. The frontend constructs short messages locally rather than rendering raw exception text.

## Frontend and verification

Each inventory row retains quantity operations and has a History action. The operation selector explicitly distinguishes add/remove/set; adjustment reasons are required. History shows date, operation, signed change, before/after, actor and reason. All three roles may use it. No stock input remains in product creation/editing.

Save/Cancel, duplicate-submit guards, current-session 401, safe errors, GET-only reload after uncertain outcomes, and abort/stale-response guards remain. Navigation and the shared Logout stay available. Aborting does not undo a server-side update. Tokens remain in React memory only.

Run `./mvnw -DskipTests compile`, `./mvnw test`, then `npm test`, `npm run build`, `npm run lint` in frontend/. Real persistence tests use the existing disposable MySQL helper, including rollback triggers, concurrent receipts/issues, foreign keys, legacy mutation paths, totals and seed idempotency. They never fall back to the project database. Database-dependent classes explicitly skip if mysqld is unavailable; skipped tests do not establish persistence. Frontend tests use mocked HTTP and do not prove database behavior.

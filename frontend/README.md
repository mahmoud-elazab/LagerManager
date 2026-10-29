# LagerManager frontend

React + TypeScript with Vite. Products, Warehouses and Inventory use state-based navigation, a shared header with one Logout control, readable tables and inline forms. The approved layout uses left-aligned data and column headings, except the centered Actions heading. Tables scroll inside their labeled regions on narrow screens.

## Install and run

Use Node.js 22.12+ and npm (verified environment: Node.js 26.7.0, npm 11.19.0). Install locally from the repository root:

```sh
cd frontend
npm ci
npm run dev -- --host localhost --port 5173 --strictPort
```

Open http://localhost:5173; stop with Ctrl+C. Keep `package-lock.json`; no global packages or external fonts are needed.

Real login requires MySQL and the backend configured with `LAGERMANAGER_JWT_SECRET`, `SPRING_DATASOURCE_URL`, `SPRING_DATASOURCE_USERNAME` and `SPRING_DATASOURCE_PASSWORD`. `SERVER_PORT` optionally overrides its port. Values are intentionally omitted here. See the [root setup instructions](../README.md). Start the configured backend using `./mvnw spring-boot:run` from the root.

Vite forwards relative `/api` URLs to localhost:8080 and preserves the path. Update `vite.config.ts` if choosing another backend port. This proxy is for development only. Production API forwarding, hosting and deployment are outside Phase 4. No backend CORS changes are needed. `npm run preview -- --host localhost` previews the static build; it is not proof of production connectivity.

The existing local lagermanager database is the authorized demo database. Its named demo accounts are provisioned; use the ignored private account file and preserve unrelated existing records. No special profile or separate database is required. Automated tests remain isolated with fictional fixtures; there is no registration or automatic user creation during normal startup.

## Authentication and permissions

Login sends email and the unchanged password to POST `/api/auth/login`. A runtime-validated response must contain a nonempty token and `tokenType: "Bearer"`. Password input clears after successful login. The token and current-user details stay in React memory: no browser storage, cookies, URLs, token rendering or logging. JWT claims are not decoded for authorization.

After login, GET `/api/auth/me` confirms email and one of ADMIN, MANAGER or EMPLOYEE. Until confirmation, creation, product/warehouse editing and deletion controls stay hidden. Account loading/errors have Retry, and Logout remains available. Logout clears the session; refreshing requires login again. There is no backend logout, registration, refresh token or routing library.

| Frontend operation | ADMIN | MANAGER | EMPLOYEE |
| --- | --- | --- | --- |
| View Products, Warehouses, Inventory | Yes | Yes | Yes |
| Create products, warehouses and inventory | Yes | Yes | No |
| Edit product and warehouse details | Yes | Yes | No |
| Receive, issue, adjust stock; view history | Yes | Yes | Yes |
| Delete records | Yes | No | No |

The backend remains authoritative. A changed database role can produce 403 even after `/me` allowed controls. 403 retains the session; only a matching current-session 401 signs out and asks for login again. Obsolete responses, including 401, are aborted/ignored after navigation, unmount, selection changes or logout/session changes. No old response may update another view or expire a newer session.

## Lists and forms

Only the selected resource loads. Loading, empty, safe error and read-only Retry states are provided. All data is runtime-validated against nullable backend fields. Long values wrap and tables retain accessible names/column headers.

- **Products:** name, SKU, category, Total stock and price. The model also preserves description for editing. Total stock is derived from inventory across warehouses; products have no independently editable stock. No currency is assumed.
- **Warehouses:** name, location and capacity. No capacity unit is assumed.
- **Inventory:** nested product name/SKU and warehouse name/location, plus the inventory record's own quantity. Null associations/fields use readable fallbacks.

Creation/editing requires nonblank product name/SKU or warehouse name/location, and nonnegative whole-number inventory quantities/capacity within the Java Integer range. Price must be a nonnegative decimal; the client sends its exact decimal literal without rounding. Database precision/scale remains a separate backend constraint; arbitrary-precision persistence has not been certified. Product edit retains untouched nullable description/category fields. On browsers lacking JSON source-context support, an existing price must be deliberately re-entered rather than silently reconstructed from a rounded number.

Inventory creation loads authenticated product and warehouse choices, offers only positive safe IDs, labels options with distinguishing fields, and sends exactly productId, warehouseId and quantity. Empty choices explain what must be created first. No duplicate-combination restriction is invented.

Stock operations receive (add), issue (remove), or adjust (set) an existing inventory quantity. Adjustments require a meaningful reason. The existing quantity PATCH now sends quantity and reason and records the same immutable history. History is available to all three roles. Product forms no longer contain quantity. Stock editing preserves the displayed product/warehouse associations and ID. Full inventory/association editing is not part of the frontend.

Mutations target actual positive safe record IDs. Save/Cancel, local validation, saving state and duplicate-submit guards are provided. Cancel before submission sends no mutation. No optimistic success or automatic mutation retry is used. Successful responses are validated (and update IDs must match); a missing/null PUT response is not success. After confirmed creation/update/deletion, list-refresh failures remain separate from mutation failure.

400/403/404/409 receive safe feedback; server/network or malformed/mismatched responses can leave outcomes uncertain. The UI offers a GET reload before another attempt, since the server may already have saved. **Aborting, navigating away or logging out does not undo a server-side mutation.**

## Deletion and linked inventory

ADMIN-only deletion uses an inline identifying confirmation with explicit Delete/Cancel. DELETE has no body, accepts the backend's successful empty response, and refreshes only after confirmation. Pending state blocks duplicate deletion; navigation and Logout remain available. Product/warehouse deletion of an already-missing ID can return no-op success; inventory deletion now returns 404 when missing and conflicts for nonzero stock or any movement history. An inventory with history is retained with its associations. For product/warehouse no-op success, UI wording acknowledges request completion rather than claiming that this request newly removed the record.

Product/warehouse 409 with validated code `INVENTORY_REFERENCE_CONFLICT` and a nonempty message produces a concise inventory-use explanation. The row remains visible and Cancel dismisses the message. Server exception text is never displayed. Unknown/malformed 409 stays generic; a 500 stays an uncertain outcome rather than being assumed to be an inventory conflict. No inventory is automatically deleted or detached. See the [backend contract and isolated persistence evidence](../docs/inventory-deletion-conflicts.md).

## Verification commands

From this directory:

```sh
npm test
npm run build
npm run lint
```

Tests run Vitest / React Testing Library / jsdom with mocked HTTP and fictional data. Build runs TypeScript and Vite; lint runs Oxlint. No backend is needed for these tests. Backend checks are `./mvnw -DskipTests compile` and `./mvnw test` from the root, using the existing disposable-MySQL helper. Missing MySQL infrastructure produces explicit skipped database tests, never a fallback to the project database.

The [Step 12 verification record](../docs/phase4-verification.md) distinguishes component tests, actual browser checks against HTTP fixtures, real disposable-MySQL integration tests and still-pending full-stack checks. Component tests do not prove layout, connectivity or persistence.

## Manual verification checklist

Use fictional fixtures for automated/failure checks. Local manual demo checks may use the explicitly authorized lagermanager database and named demo accounts; avoid modifying unrelated original records. Automated backend tests always use disposable MySQL.

1. Login with valid/rejected fixtures; check password handling, safe failures, duplicate submission, logout, refresh-to-login and current-session 401. Delay `/me`, test Retry/malformed roles, and verify no privileged controls before role confirmation.
2. Check each resource's loading/populated/empty/null/error states and read-only Retry. Verify Bearer transmission without recording authorization values. 403 must retain the session; obsolete 401 must not expire a newer one.
3. For each role, compare controls with the matrix and verify backend enforcement independently. Test changed roles after `/me`, not decoded JWT claims.
4. Create/edit products and warehouses, create inventory, and update quantity including zero. Verify populated fields, null optional preservation, exact payloads/actual IDs, invalid-input rejection, Cancel with no mutation and duplicate-submit guards. Check that Total stock matches inventory across warehouses. Receive/issue take positive counts; adjustments set the quantity and require a reason. Verify history before/after/change/actor and no automatic mutation retries.
5. As ADMIN, inspect identifying confirmations, Cancel, unlinked deletion and linked product/warehouse conflicts. Verify linked records remain and no cascades occur. Generic/malformed 409 and unrelated server errors must not claim linked inventory caused the failure.
6. Simulate network/server/malformed/mismatched/null responses. Confirm no false success or automatic mutation retries. Separate confirmed mutation from failed list refresh. Use GET reload to resolve uncertainty.
7. Delay reads/options/mutations, navigate/select another record/log out and sign in again, then release stale success/401. They must not affect the new screen/session. Cancel and Logout must remain usable as specified while requests are pending.
8. Inspect approximately 1440, 1024, 768 and 390px with long emails, names, SKUs and messages. Check internal table overflow, shared Logout, form/confirmation widths, keyboard traversal and focus, browser zoom and reduced motion. Use screen-reader checks separately. Never include credential or authorization values in screenshots.


## Stock and demo setup

See [stock/movement API](../docs/stock-management.md) for totals, reasons, history and inventory lifecycle rules. See [local demo setup](../docs/local-demo.md) for ordinary single-database startup, explicit merge population, actual verified counts and the private ignored `DEV_TEST_ACCOUNTS.local.md` account file. The existing local database is populated and all three demo roles authenticated through real HTTP. The earlier [Phase 4 verification record](../docs/phase4-verification.md) is historical; current results are in the local codex-report.txt.

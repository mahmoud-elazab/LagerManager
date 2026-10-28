# LagerManager frontend

React + TypeScript with Vite. Includes login, current-user details, Product, Warehouse and Inventory creation for confirmed admins/managers, product/warehouse editing, inventory quantity editing, ADMIN-only deletion, state-based navigation, and local logout in a shared header.

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

Loading, empty-list, safe errors and recoverable-error Retry states are supported. HTTP 401 clears the current session and asks for sign-in again; HTTP 403 shows access denied without clearing the session. Logout remains available while loading and on errors. Obsolete requests are aborted and ignored on logout, unmount or session changes, including obsolete 401 responses. Confirmed ADMIN/MANAGER accounts can create and edit products; confirmed ADMIN accounts can also delete records. Search, pagination and routing changes are not included.

### Manual verification after review

1. Start MySQL, Spring Boot and Vite as described above; use an approved test account for live review.
2. Sign in and confirm a Products table or the empty-list message appears. Inspect the request URL and authorization header without copying or recording the token.
3. Check the table at narrow and wide viewport sizes, keyboard navigation, screen-reader headers, quantity note and nullable-field presentation. No currency should be assumed.
4. Using mocked responses or controlled test fixtures, check loading, empty list, 403, network/server failures, malformed responses and Retry. A 401 should return to login with a sign-in-again message.
5. With a delayed mocked product response, log out and sign in again; the old response must not replace current products or expire the new session. Refresh to confirm sign-in is required again.

`npm test` includes mocked product-request and lifecycle tests. These do not prove live backend/proxy connectivity or visually verify a real browser.

The repository-root `/codex-report.txt` ignore rule keeps local reports out of new tracking. If a report is already tracked, it requires a separate manual removal from the version-control index while keeping the local file; ignore rules alone do not untrack existing files.


## Warehouses, inventory and navigation

After each login, Products is selected. Use the labeled Resources navigation buttons to select Products, Warehouses or Inventory; the current selection is marked visually and with `aria-current`. Only the selected resource is fetched. Returning to a screen reloads it without caching. Logout resets navigation and all resource screen state.

Warehouses loads GET `/api/warehouses` and displays name, location and capacity. No capacity unit is assumed. Inventory loads GET `/api/inventory`; each row contains nested product and warehouse objects. The table shows product name/SKU, warehouse name/location and the inventory record's own quantity, never the nested product quantity. Null associations and text fields show “Not specified”. Runtime validation checks nullable fields/associations and integer fields before displaying data.

Both screens reuse the existing responsive, accessible table styling and support loading, empty lists, safe errors and Retry for recoverable failures. Logout and navigation remain available during loading and errors. A 401 asks for sign-in again; 403 shows access denied without ending the session. Navigation, logout, unmount and session changes cancel/ignore obsolete responses, including old 401s. Inventory supports quantity editing and creation; Product, Warehouse and Inventory creation is available to confirmed admins/managers. Product and Warehouse detail editing is available to confirmed admins/managers; deletion is ADMIN-only and full inventory editing is not included.

### Additional manual verification after review

1. Sign in and confirm Products is the default, with only a product-list request. Navigate through all three resources; confirm selected-button indication and only the selected endpoint is fetched. Switch back and verify a fresh request.
2. Check each table on narrow/wide screens with keyboard and screen-reader navigation. Warehouse capacity must have no invented unit. With controlled fixtures, verify null associations/text and inventory quantity different from product quantity.
3. Use mocked responses to exercise loading, empty lists, 403, network/server failures, invalid JSON/record shapes and Retry on each new screen. Verify 401 returns to login with a sign-in-again message.
4. Delay a request, navigate away or log out, then resolve it with success or 401. The selected screen/new session must remain unchanged. Sign in again and confirm Products is selected with no previous resource data.

Tests use mocked HTTP responses and fictional data; they do not establish live backend/proxy connectivity or browser-rendered layout quality. Live manual testing remains deferred until review.


## Edit inventory quantities

All authenticated ADMIN, MANAGER and EMPLOYEE users can use the existing quantity endpoint; permission checks remain on the backend and tokens are not decoded for UI authorization. Inventory rows retain their record IDs. Rows with a positive safe integer ID offer **Edit quantity**; records without a usable ID remain non-editable. The labeled field starts with the current inventory quantity. Save accepts decimal digits representing an absolute quantity from 0 through 2147483647, including zero. Blank, negative, fractional, exponent notation and out-of-range input are rejected locally. Cancel discards unsaved changes without a request.

Save sends only `{ "quantity": number }` via PATCH `/api/inventory/{id}/quantity` with the memory-only Bearer token. Duplicate submits are blocked while saving. The UI validates the complete inventory response and matching record ID, then updates only the displayed quantity and announces success. It does not optimistically update, increment stock, or allow changing product/warehouse associations. Product-record quantity stays separate.

401 returns to login only for the matching current session. 403 displays access denied without logout. 400, 404, network/server failures, invalid JSON, invalid record shapes and mismatched IDs show safe errors. After a failed PATCH, Save stays disabled in that editor and **Reload inventory** performs a GET to check the current state. There is no automatic mutation retry. Cancel can close the failed editor; prefer reloading before starting a new manual edit when the outcome is uncertain.

**Aborting a request does not undo a server-side update.** A network failure or unexpected response may occur after the backend has saved. Navigation and Logout remain available, cancel local waiting and ignore late responses, but cannot roll back the server. Return to Inventory or use Reload inventory to confirm the current quantity before making another change.

### Quantity-editing manual verification after review

1. Use mocked data first. Navigate to Inventory and verify product-record quantity differs from inventory quantity. Open Edit quantity on a known record and confirm the starting value and accessible label. Cancel and confirm no PATCH occurs.
2. Save zero and another valid absolute quantity. Check the exact ID-based PATCH URL, quantity-only JSON body, and authorization without copying or logging sensitive values. Delay the mocked response to confirm the table retains its old value, Save is disabled, and navigation/Logout remain usable. Success must update only that record's quantity and announce confirmation.
3. Try blank, negative, fractional and out-of-range values and confirm no network request. Confirm rows without valid IDs have no edit action.
4. Mock 400, 401, 403, 404, network/server failures and malformed/mismatched success responses. Confirm no automatic PATCH retry or success message. Reload inventory must issue GET only. Verify 401 asks for sign-in again while 403 retains the session.
5. Delay a save, navigate or log out, then return/sign in again. Resolve the old save as success or 401; it must neither alter the new screen/session nor display stale confirmation. Aborting locally may still leave a server-side change; use a read to check before resubmitting.

`npm test` covers these flows with fictional fixtures and mocked HTTP responses, including current-session changes. These tests do not prove live backend connectivity or visually verify browser behavior. Live manual testing remains deferred until review. No real user authentication or database changes are performed by the frontend test suite.


## Current account and creation permissions

After login, the app fetches GET `/api/auth/me` with the in-memory Bearer token. Email and role are checked at runtime; only ADMIN, MANAGER and EMPLOYEE roles are accepted. Account details stay in React memory and are cleared on logout or expiration. Loading and safe error/Retry account states keep Logout and navigation available. No creation controls appear before the role is confirmed. A 401 asks for sign-in again, while 403 reports access denied without treating credentials as invalid. Old account responses are ignored after session changes or unmount.

Confirmed ADMIN/MANAGER accounts see Add product and Add warehouse on the corresponding screens. EMPLOYEE accounts continue to view all lists and edit inventory quantities without these creation controls. The role comes from `/me`, never decoded token claims. It only controls which buttons are shown: backend authorization always decides whether a request is allowed, including role changes after account details were loaded.

## Create products and warehouses

Add product has labeled name, SKU, description, category, product quantity and price fields. Name/SKU are required and cannot be blank. Product quantity is the number recorded for the product; creating the product does not add warehouse stock. Quantity must be a nonnegative whole number supported by the backend. Price must be a nonnegative decimal with no assumed currency. The frontend preserves the exact decimal numeric JSON value sent to the backend BigDecimal without floating-point conversion or rounding; ordinary decimal notation is used instead of exponents. Optional description/category are sent as entered strings, including empty strings.

Add warehouse has required, nonblank name/location and nonnegative whole-number capacity. No capacity units are assumed. Save sends POST to the selected relative `/api` endpoint with Bearer authentication and only the intended fields, never an ID. Client validation occurs before any POST. Cancel before submission discards the form without a request. Duplicate saves are blocked during the saving state; navigation and Logout remain available.

Add waits until the corresponding list has loaded, including after an uncertain outcome is reloaded. A successful response must match the resource shape and include a usable created-record ID. Only then does the UI announce creation and refresh the list. If that list request fails, the confirmed-creation message remains alongside the list error: Retry reloads the list without repeating creation.

400 and 409 explain rejected/conflicting details. 403 reports access denied and prevents further submission from that form without logging out. Current-session 401 returns to login. Network/server failures or malformed success responses may happen after a record was created. The app states that creation could not be confirmed, disables Save in that form, and offers Reload list before another attempt. There are no automatic POST retries. Cancel cannot clear this uncertainty; the reload action remains available. Returning to another screen and back also reads the current list.

**Aborting or leaving a pending creation does not undo a server-side create.** The app ignores obsolete completions, including old 401 responses, but the server may still have created the record. Check the list before a manual retry. No full inventory editing, registration or refresh-token features are included. Deletion is available only to confirmed ADMIN accounts. Inventory creation is described below.

### Creation manual verification after review

1. Use mocked account responses for each role. Delay `/me` and confirm no Add controls appear until ADMIN/MANAGER is confirmed. Employees should retain list viewing and quantity editing. Check account retry, 401 and 403 behavior.
2. For each creation form, verify required labels, keyboard access and small-screen layout. Try blank required fields, negative/fractional/out-of-range quantities or capacity, and invalid price. Verify no request on invalid input or Cancel. Check zero and a precise decimal price with controlled fixtures; no currency or capacity units should appear.
3. Inspect mocked POST requests to confirm only intended fields and no ID are sent. Do not copy, record or log authorization values. Delay responses and verify duplicate submission is prevented, no premature success appears, and navigation/Logout remain usable.
4. Confirm a validated success refreshes the list. Then mock the refresh failing: the page must distinguish a created record from a failed list load, with no second POST when retrying the list.
5. Mock 400/401/403/409, network/server and malformed-response failures. Verify safe messages, no automatic POST retry and a GET-only reload after uncertain outcomes. Simulate permission revocation after `/me` to verify backend 403 handling.
6. During a pending account request or creation, navigate/log out and sign in again. Resolve the old request with success or 401; it must not grant controls, show stale confirmation, refresh another screen or expire the newer session.

Run `npm test`, `npm run build` and `npm run lint` from `frontend/`. Automated tests use fictional data and mocked HTTP responses; they do not establish live backend/proxy connectivity, persistence or real-user authorization. Visual/browser verification and live manual testing remain pending until review. Production hosting remains outside scope.


## Create inventory

Only confirmed ADMIN/MANAGER accounts see Add inventory. EMPLOYEE accounts can still view inventory and edit quantities but cannot create it. The existing backend remains authoritative; account roles are taken from `/api/auth/me`, never decoded token claims.

Opening the form loads products and warehouses from their authenticated GET endpoints. Options use positive safe record IDs as values and display product name/SKU or warehouse name/location. Records without usable IDs are excluded, while usable records are runtime-validated. Null names/locations have brief fallbacks. If there are no usable choices, the form explains that a product or warehouse must be created first. Failed choice requests have a Retry options action; no POST occurs during option loading or retry.

The form requires Product, Warehouse and Initial quantity. Quantity accepts zero and other whole numbers within the backend Java Integer range. Save sends exactly productId, warehouseId and quantity as JSON numbers to POST `/api/inventory`, with the memory-only Bearer token. It never sends an inventory ID or nested product/warehouse objects. The UI does not impose uniqueness on the selected product/warehouse pair, because the backend does not enforce that rule.

Save blocks duplicate submissions and announces saving. Cancel before submission discards the form with no POST; pending option requests are aborted/ignored. Navigation and Logout remain available throughout. Successful responses must match the inventory model and contain a valid created ID before confirmation and inventory-list reload. Quantity editing remains available on existing records. A confirmed creation remains distinguished from a subsequent list-load failure; retrying the list never repeats creation.

400/403/404/409 errors explain rejected details, denied access, missing selections or conflicts without exposing server details. 401 expires only the matching current session. Network/server/malformed-response failures may occur after persistence, so the form does not automatically retry POST. It preserves an uncertainty warning and offers Reload inventory (GET). Add stays disabled until that list read completes. **Aborting a request does not undo server-side creation.** Check the list before a new manual attempt.

Obsolete option/list/save responses are aborted and ignored on navigation, Cancel, logout, unmount or session change. Old success/401 responses cannot refresh another view, show stale confirmation or expire a newer session. Technical explanations about backend quantity fields, units, currency and view-only milestones are kept out of normal interface text; short labels and accessible table names remain. Product quantity and inventory quantity are separate backend fields even though each table now labels its own field simply Quantity.

### Inventory creation manual verification after review

1. With mocked `/me`, verify Add inventory for ADMIN and MANAGER only. EMPLOYEE and unverified accounts must not see it; employees must retain viewing and quantity editing.
2. Open Add inventory and delay product/warehouse GET responses. Verify loading, authenticated relative endpoints, option labels and IDs, safe errors/Retry options, and brief missing-prerequisite messages. Invalid or missing IDs must not be selectable. Try existing product/warehouse pairs as well; the UI must not reject duplicates on its own.
3. Check the form with keyboard/screen reader and at narrow/wide viewport sizes. Verify no developer notes/captions remain, tables have accessible names, and uncertainty warnings are preserved. Cancel should issue no POST. Blank/negative/fractional/out-of-range quantity or missing selections should be rejected locally. Zero should be accepted.
4. With a controlled mock, inspect the exact ID-only payload and Bearer authentication without recording sensitive values. Delay Save and confirm one POST, disabled duplicate submission, visible saving state, available navigation/Logout, and no success before confirmation.
5. Return a valid created inventory record, then separately fail the list refresh. Confirm the UI distinguishes creation success from list-read failure and Retry issues GET only.
6. Mock 400/401/403/404/409, network/server failures and invalid successful responses/IDs. Verify safe feedback, matching-session expiration for 401, retained authentication for 403, no automatic POST retry and GET-only reload for uncertain outcomes.
7. Delay options or Save, navigate away/log out and sign in again, then resolve the obsolete request with success or 401. No stale options, success, list updates or session expiration should affect the current view/session. Return and read the list before any manual retry; local abort cannot roll back server work.

Verification commands from `frontend/`: `npm test`, `npm run build`, `npm run lint`. Tests use mocked HTTP and fictional fixtures only. They do not establish live backend/proxy connectivity, persistence, actual database uniqueness or real-user authorization. Visual/browser verification and live manual testing remain pending until after review.


## Edit products and warehouses

Confirmed ADMIN/MANAGER accounts see Edit actions for existing product/warehouse records with positive safe IDs. Employees and unverified roles do not see these actions. The backend still authorizes every PUT; a role change after account loading can result in a safe 403 message without signing out.

Product forms retain the complete record, including description that is not shown in the table. Name, SKU, description, category, quantity and price are populated from the selected record. Untouched nullable description/category remain null in the PUT payload; only deliberate input changes replace those fields. Existing text and spacing are not silently trimmed during updates. Required name/SKU must be nonblank, quantity must be a nonnegative Java-int-range whole number, and price a nonnegative ordinary decimal. A null price must be filled before saving. IDs are not editable or included in request bodies.

The product response validator now requires description as a nullable string. The product loader also preserves the original JSON decimal price literal as local edit metadata using JSON parser source context, separate from the numeric model field. This prevents precise existing prices from being rounded just by opening/saving. Scientific response notation is expanded exactly; submitted decimal input is serialized without Number conversion. In older runtimes lacking JSON parser source context, the price edit field requires explicit re-entry rather than silently reusing a potentially rounded value. Current browser behavior should be checked during visual/manual review.

Warehouse screen state retains complete warehouse records and IDs. Its form populates name, location and capacity; required name/location must be nonblank and capacity must be a valid nonnegative whole number. Saves send only intended fields to PUT `/api/products/{id}` or `/api/warehouses/{id}` with memory-only Bearer authentication. There are no ID inputs or nested-entity updates.

Save blocks duplicate submission and announces saving. Cancel before saving discards local edits with no request. Only a validated response with the matching record ID announces an update and refreshes the list. Null/missing responses from existing PUT endpoints are not success. If the subsequent list refresh fails, the confirmed-update message remains separate from the list error; Retry reads only and never repeats the PUT. Close dismisses confirmation; selecting another Edit action opens that record's current values.

400/409 report rejected/conflicting details. 403 explains editing is not permitted without clearing authentication; 404 explains the record is missing. Current-session 401 returns to login. Network/server/malformed/mismatched/null successful responses may occur after the backend saved, so the form does not automatically retry and offers a list reload before another attempt. **Canceling local waiting or aborting a request cannot undo a server-side update.** Navigation, logout, unmount, selecting another record or replacing the session abort/ignore obsolete completions, including old success and 401 responses.

## Shared signed-in header

Exactly one Logout button lives alongside the application/account area at the top of the signed-in workspace. Desktop layout places it at the far right; the header wraps on narrow screens. It remains available during account loading/errors, resource loading/errors and pending mutations. Resource screens no longer render their own Logout buttons. Login appearance and the rest of the layout remain unchanged apart from the focused header placement and editing controls.

### Editing and header manual verification after review

1. With mocked accounts, check ADMIN/MANAGER Edit visibility for both resources, absence for EMPLOYEE/unverified roles, and invalid/missing record IDs. Verify employee viewing/quantity editing and all existing creation flows still work.
2. At desktop and narrow widths, check that there is exactly one top-header Logout button, aligned to the right and usable with keyboard/screen reader. Delay/fail account and each resource request and delay mutations; Logout and navigation must remain usable.
3. Open each Edit form and check every existing field, including non-table product description and null optional fields. Cancel and verify no PUT or displayed record change. Open and Save without changes against mocked data; null optional values and precise price digits must be preserved. Deliberately clear/edit optional text and verify only those values change. No ID field should exist.
4. Try zero, blank required fields, negative/fractional/out-of-range quantity/capacity, invalid price and a precise decimal price. Check invalid local inputs cause no PUT, and valid payloads contain only intended fields with the actual record ID in the URL. Do not record authentication values.
5. Delay a save and submit again; verify one PUT, saving state and no early confirmation. Return a valid matching response, then separately fail the list refresh: update success and list failure must remain distinct. Retry/reload must issue GET only.
6. Mock 400/401/403/404/409, network/server errors, null/malformed responses and mismatched IDs. No false success or automatic mutation retry should occur. Only current-session 401 should sign out.
7. While saving, select another record, navigate away, log out and sign in again, or replace the session. Resolve obsolete success/401 responses and confirm they cannot alter another form/view or sign out the new session. Read the list before manually retrying an uncertain save.

Run `npm test`, `npm run build`, `npm run lint` from `frontend/`. Tests use fictional fixtures and mocked HTTP, not real users or database records. They do not establish live backend/proxy connectivity, persistence or real-user authorization. Browser-rendered placement at actual viewport widths and live manual testing remain deferred until review.


## Delete products, warehouses and inventory

Only a confirmed ADMIN from `/api/auth/me` sees Delete actions. Managers/employees and unverified accounts do not; their existing creation/editing/view/quantity permissions are unchanged. The server still authorizes every request, so a later permission change can produce a safe 403 without logging out.

Delete actions target positive safe record IDs. An inline accessible confirmation identifies a product by name/SKU, warehouse by name/location, or inventory by its product and warehouse. Missing names use fallbacks. Explicit Delete and Cancel buttons prevent accidental submission; Cancel sends no DELETE. Duplicate submissions are blocked during the deleting state. Navigation and the single shared Logout remain available. Selecting another operation closes/aborts the old confirmation or editor rather than leaving conflicting forms open.

Requests use body-free DELETE `/api/products/{id}`, `/api/warehouses/{id}` or `/api/inventory/{id}` with the memory-only Bearer token and existing relative proxy. A successful empty response is accepted without JSON parsing; no row is removed optimistically. Only after success does the UI announce that the removal request completed and reload the list. A subsequent read failure is displayed separately; Retry reads only, never repeats DELETE.

A 404 displays not found without success. A current-session 401 returns to login; 403 explains deletion is not permitted without clearing authentication. 409 explains linked inventory only for the validated INVENTORY_REFERENCE_CONFLICT contract; other conflicts remain generic. Network/server/other uncertain failures explain that deletion could not be confirmed and offer a list reload to check whether the item still exists. DELETE is never automatically retried. **Aborting a request or leaving the page cannot undo server-side deletion.** Obsolete success/401 responses are ignored after navigation, logout, unmount, record selection or session changes.

### Inventory-reference conflicts and database verification

Referenced products/warehouses return HTTP 409 with code `INVENTORY_REFERENCE_CONFLICT` and a safe resource-specific message. The frontend validates this error shape and says inventory still uses the selected item. The row remains visible, and Cancel dismisses the message without another request. Server messages/exception details are never rendered verbatim. Unknown codes, invalid JSON or malformed fields remain generic conflicts. Server/network failures retain honest uncertain-outcome handling and a GET-only reload; they are never assumed to be inventory conflicts.

The backend locks the product/warehouse before checking references and deletes/flushes inside a READ COMMITTED transaction. Real InnoDB foreign keys serialize racing inventory writers: either deletion sees the committed reference and conflicts, or the competing reference cannot commit after its parent is deleted. No cascade or association detachment is performed. Unrelated integrity errors remain server failures rather than being mislabeled. Missing IDs keep the prior no-op success contract, so success wording acknowledges completion rather than proving this request newly deleted an existing row.

The backend persistence suite now starts a fresh disposable local MySQL instance with isolated data and schemas. It verifies real foreign keys, rollback and both race orderings without touching the project database. It skips explicitly when no suitable local mysqld binary is available; no database guarantees may be claimed from a skipped run. Details and the code/message contract are in [inventory deletion conflicts](../docs/inventory-deletion-conflicts.md). Existing deployed constraints and actual browser behavior still require separate review; frontend mocks alone do not prove persistence.

### Deletion manual verification after review

1. Start with mocked responses. Verify Delete visibility for confirmed ADMIN only across all three resources; MANAGER/EMPLOYEE/unverified accounts must not see it. Confirm their existing flows still work and there is one shared Logout button at desktop and narrow widths.
2. Open confirmations for records with recognizable fields and null names/associations. Check focus, accessible identification and keyboard access. Cancel and verify no DELETE. Check that create/edit/delete selections do not leave competing forms for the same item.
3. Delay Delete, then attempt duplicate submission. Confirm one request with actual ID, Bearer authorization and no body, with visible deleting state and usable navigation/Logout. Do not copy or record authorization values.
4. Return empty 200/204 responses, confirm success followed by list refresh, and separately fail the list refresh. Retry must issue GET only; it must not repeat DELETE. Mock 401/403/404/409 and network/server failures; missing items must not be announced as newly deleted, and generic errors must not claim linked inventory caused them.
5. Delay a deletion, change selection/navigate/log out and sign in again, then resolve obsolete success/401. It must not refresh another screen, confirm a different item or expire the new session. Read the list before a new manual attempt after uncertainty.
6. After review, any live persistence checks must use **disposable test records in a designated test database**, never real production records. Test unreferenced product/warehouse and inventory deletion first. A linked-record failure must be documented with its actual HTTP semantics; do not bypass constraints, detach associations or cascade deletes. Verify the specific conflict code/message and unchanged parent/inventory records; existing deployed constraints must be checked separately from the isolated automated tests.

Run `npm test`, `npm run build`, `npm run lint` from `frontend/`. Automated verification uses fictional fixtures and mocked HTTP responses only. It does not establish live connectivity, persistence or deployed foreign-key behavior; the separate backend suite provides isolated real-MySQL evidence. Browser-rendered confirmation flows and live manual testing remain pending until after review.


### Linked-conflict manual checks after review

1. Mock a product and warehouse 409 with the documented code/message and verify the concise inventory-use explanation, unchanged visible row and Cancel dismissal with no additional DELETE.
2. Mock unknown/missing codes, malformed JSON, empty/non-string messages and unrelated 409/500 responses. They must remain generic; server failures keep uncertainty/reload guidance even when their body contains the conflict code.
3. Preserve 401 expiration, 403 retention, no mutation retries, and stale response protection while navigating/logging out.
4. Any later live checks must use disposable test records in a designated test database. Link inventory to a parent, verify deletion conflicts without changing either record, then verify unlinked deletion separately. Do not bypass foreign keys or mutate real records to test the UI.

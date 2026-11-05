# Phase 6: disposable Compose HTTP smoke test

From the repository root, run:

```sh
python3 scripts/compose-smoke.py
```

Requires Python 3.9+, a running local Docker daemon, and Docker Compose v2+ with `up --wait` and JSON `config` support. No Python packages, Postman account, browser, host MySQL, or application configuration are needed. The first run may need network access to fetch Docker base images and build dependencies. A passing run exits 0; any assertion, startup or cleanup failure exits nonzero. Runtime credentials and tokens are never printed.

The runner uses the real `compose.yaml` and Dockerfiles. It generates a random `lm-smoke-*` project, an available loopback port other than 8082, unique backend/frontend image tags, database passwords, JWT key and account passwords. It bypasses the private `.env` with an explicit empty env file. Before building or starting, it checks that project resources, volume, networks and image tags do not exist, validates the resolved mounts, datasource, publication, networks, images and disabled demo flags, and freezes that configuration in a private temporary directory. MySQL and the backend have no published ports or host mounts. A port collision after selection causes failure and cleanup; no existing process is stopped.

All application requests go through the frontend's published HTTP port. Mutations are sent once, without automatic retries. Read-only readiness requests may retry after Nginx DNS refresh.

| Smoke assertion | Existing coverage reused as the contract |
| --- | --- |
| HTML SPA shell and linked built JavaScript/CSS return 200 with correct content types; protected products returns 401 | Compose healthchecks, frontend image/Compose docs; login component tests |
| Anonymous Employee/Admin registration, login, and exact `/api/auth/me` email/role | `RegistrationTests`, `AuthControllerTests`, `CurrentUserTests`, frontend registration fixtures |
| Employee DELETE of a disposable unlinked product returns 403 and retains it; Admin DELETE of the same ID returns 200 and removes it | `RoleAuthorizationTests`, frontend deletion tests |
| Employee receives seven units into zero-stock inventory; stored quantity, derived total and one exact actor-attributed history row match | `StockPersistenceTests`, frontend stock fixtures, stock movement API docs |
| Down without volume removal, then up; all three container IDs change, the same volume identity remains, both accounts sign in again, quantity and exact history survive | Earlier one-off Compose evidence; now repeatable |

This adds integration evidence for Nginx -> Spring Boot -> MySQL together. Existing Java tests retain deeper validation, rollback, concurrency, foreign-key and lifecycle coverage. Existing Vitest/jsdom tests retain rendering, validation, auth/session, stale-response and safe-error coverage with mocked fetch. The new runner does not replace those tests or import their language-specific fixtures; it follows their public payloads and assertions and reuses the production Compose configuration.

A `finally` block attempts cleanup after success, assertion/startup/build failure, Ctrl+C and SIGTERM. Cleanup uses only the validated random project and unique image tags, then checks that its containers, networks, volume and tags are gone. Temporary configuration and generated credentials are removed. Shared base images and Docker build cache remain; no prune or forced image removal is used. The runner also compares the normal `lagermanager` container IDs, start times, running states, image IDs, normal application image tags and volume identity before/after. It never connects to the Mac database or normal HTTP port. These identity checks are safeguards, not a full comparison of normal database contents.

To exercise the failure cleanup path deliberately:

```sh
python3 scripts/compose-smoke.py --fail-after-start
```

Expect exit 1 for the intentional failure **and** PASS cleanup/normal-stack messages. This uses another fresh project and does not perform the business flows. Cleanup errors are reported as failures, with the test project name retained in the output for investigation. No process can guarantee cleanup after SIGKILL, power loss or an unavailable Docker daemon; do not use broad prune commands to recover.

HTTP checks establish delivery of the sign-in SPA shell and its bundle, not JavaScript execution in a browser. Manual browser verification still needs actual login/registration interaction, role-specific controls, stock/history rendering, keyboard/focus behavior, responsive layout, navigation and session behavior. No browser or Chrome automation is used by this slice, and application/UI text is unchanged.

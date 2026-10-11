# Local verification record

Local checks were verified on 8 October 2026; hosted checks were verified on 11 October 2026. See the hosted section below for deployment evidence.

## Passed

- TypeScript checks for React and Express.
- 19 integration tests against PostgreSQL 18 in a separate disposable test database.
- 3 Chromium browser tests covering the full task workflow, live updates across separate browser contexts, chart rendering, mobile layout, own-task bid suppression, and navigation recovery.
- Desktop board, dashboard, task detail, and mobile board screenshots inspected.
- Production builds on Windows and inside the Node 24 Alpine Docker image.
- Local Compose startup: database health, migration runner, non-destructive seed skip, compiled Express startup.
- Compiled app smoke checks: `/health`, `/api/tasks`, JSON task detail, HTML direct task navigation, and dashboard navigation all returned 200 with the correct content type.
- Dependency installation/auditing reported zero known vulnerabilities after fixing the shell-quote development dependency through an override.

## Critical concurrency evidence

The integration suite does more than launch two promises: it holds the shared user row through a third connection, starts both assignment HTTP requests, verifies that both database transactions are waiting on locks, and only then releases the blocker. One task selects the shared bidder; the other selects fallback. A separate test without fallback requires one success and one conflict.

Also verified: same-task assignment charges capacity once, stale bids are skipped, no-winner results change nothing, deferred-constraint failures roll back audit records, and PostgreSQL emits SSE change notifications only for committed writes.

## Environment observations

Docker Desktop was started for local testing. Host PostgreSQL port 5432 conflicted with another installed instance, so this project's database uses host port 5433. Windows sandbox permissions required approved execution for local network access and Vite's filesystem resolution. These are workstation restrictions, not application failures or a cloud deployment.

## Scope of this evidence

The earlier local checks are functional verification, not a load test or external security audit. The app uses simulated identity and a small-team data model. Hosted behavior is documented below. Future uptime throughout the two-week review window cannot be established by a one-time check, and the human Loom recording remains pending.

## Hosted verification: 11 October 2026

The app is live at [https://taskbid-pisc.onrender.com](https://taskbid-pisc.onrender.com). Render logs confirmed a successful Docker build, both migrations, seed execution, and healthy startup. Both hosted resources use Free plans; PostgreSQL expires 10 November 2026.

Live checks passed for health, five demo users, all lifecycle stages, dashboard aggregates, stale-bid eligibility, simultaneous assignments choosing a single shared bidder plus fallback, audit records, completion workload release, and direct task-page HTML navigation. A bid submitted in a second browser tab appeared in the first without refresh, confirming hosted SSE invalidation. Separate verification tasks were used so seeded video scenarios remain available. This hosted verification supplements the earlier local record; it does not establish future uptime or replace the mandatory Loom recording.

Browser tests create named workflow tasks in the development database. They do not reset user data. Database integration fixtures are confined to the `_test` database. Demo data may therefore contain completed browser-test tasks after verification.

# Local verification record

Verified on 8 October 2026. Deployment and cloud verification are intentionally deferred.

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

This is local functional verification, not a load test, external security audit, or proof of hosting compatibility. The app uses simulated identity and a small-team data model. Actual deployment, two-week availability, production SSE/proxy behavior, live URL, and the human Loom recording still need verification before submission.

Browser tests create named workflow tasks in the development database. They do not reset user data. Database integration fixtures are confined to the `_test` database. Demo data may therefore contain completed browser-test tasks after verification.

# Free deployment: GitHub and Render

Prepared on 11 October 2026. This file describes the deployment configuration; it is not evidence of a completed live deployment. Record the verified URL and database expiry after creation.

## Keep the combined structure

This is one Git repository with separate React and Express packages. The production Docker image builds both; Express serves the React bundle, REST endpoints, and SSE stream under one HTTPS origin. PostgreSQL is a separate managed resource.

We do not need separate repositories or frontend/backend services. One origin avoids a frontend API URL configuration, cross-origin deployment settings, and two separate deployment processes. Node must remain a persistent web service because the implementation uses an SSE stream and a dedicated PostgreSQL LISTEN session.

Separate hosting remains possible: serve `apps/web/dist` on a static host, set `VITE_API_URL` before building, and set `WEB_ORIGIN` on Express. That would keep the frontend available while the backend sleeps, but adds configuration and does not remove backend cold starts. The current one-service option is simpler for the assignment.

## Resources and free-tier limits

`render.yaml` defines:

- A Docker web service, `taskbid`, with `plan: free`.
- PostgreSQL, `taskbid-db`, with `plan: free`.
- Both resources in Frankfurt for same-region database access.
- A secret database connection reference injected by Render, not a committed URL/password.
- `/health` as the database-backed health check.

Render's published free-tier limits include web service sleep after 15 minutes without inbound traffic, approximately one minute to wake, 750 free instance hours per workspace/month, and PostgreSQL expiry after 30 days. One free database is allowed per workspace. Free PostgreSQL has 1 GB storage and no managed backups. Check the account's existing resource usage before creating anything; never replace an existing free database automatically.

The assignment requires at least two weeks of availability after submission. Create the database sufficiently close to submission to cover that window, record its actual expiry date from Render, and keep the service within its usage limits. Reviewers may see a cold start. Free does not promise always-on performance. Select only Free plans and do not enable paid upgrades. If Render requires account verification, the account owner must complete it.

Source: [Render free-tier documentation](https://render.com/docs/free). The assignment's old 90-day database note no longer matches the current 30-day limit.

## Repository contents

Push the source, lockfile, raw SQL migrations, seed, Dockerfile, Render Blueprint, and documentation. Do not push `node_modules`, compiled bundles, `.env` files, database directories, screenshots/traces under `tmp`, credentials, or the confidential assignment PDF. The initial repository visibility should follow the owner's preference; a private repository requires reviewer invitations.

## GitHub steps

1. Authenticate to GitHub using the connector, GitHub CLI, or browser sign-in. Do not paste personal access tokens into the chat.
2. Create a repository named `taskbid` (or select a different available name) without generating a conflicting initial README.
3. Initialize this directory on branch `main`, commit the reviewed source, add that repository as `origin`, and push `main`.
4. Confirm GitHub contains the numbered SQL migrations and documentation and no generated/secret files.

If using an authenticated GitHub CLI, the publish command is `gh repo create taskbid --private --source=. --remote=origin --push`. Use `--public` only when public visibility has been chosen. Existing repository names or another account require selecting the correct owner first.

## Render steps

1. Connect the correct GitHub account to Render and grant access to the TaskBid repository.
2. Create a Blueprint from the repository and select `render.yaml` on `main`.
3. Review the resource preview: one Free web service and one Free PostgreSQL database. Do not accept any paid substitution.
4. Deploy the Blueprint. Render builds the Docker image and injects the internal PostgreSQL connection string.
5. Startup runs `npm run start:production`: apply migrations, seed an empty database, then start compiled Express. No paid pre-deploy hook or shell session is needed.
6. Render supplies `PORT` and `RENDER_EXTERNAL_URL`; Express binds `0.0.0.0` and uses the canonical URL as the default allowed browser origin.
7. Save the service's actual HTTPS URL and database expiry date. Use the real URL in the README after it has been checked, not a guessed subdomain.

The seed runner skips a database with users. Redeploying must not reset reviewer data. Migrations are forward-only and serialized by an advisory lock. Do not edit previously applied migration files after publication.

## Production database and real-time connection

The Render database connection is direct/session-capable. The dedicated LISTEN connection needs a persistent PostgreSQL session. Do not replace it with a transaction-pooling URL. Internal same-region connectivity does not need an external database connection URL.

For an alternative database provider, use its documented TLS-enabled connection string and a direct/session URL for LISTEN. A persistent listener can keep a serverless database awake and consume free compute, so do not choose a scale-to-zero database solely based on its advertised idle behavior. Check that provider's current quotas before switching.

## Live verification before submission

- GET `/health` and `/api/health`: 200 with `{status: 'ok'}`.
- Open the task board, dashboard, and a direct `/tasks/:id` URL after refresh.
- Verify demo users and seeded scenarios are present.
- Place a bid from another user and observe a second browser session updating without refresh.
- Verify capacity conflicts, assignment fallback, and task completion workload release.
- Confirm audit records show both old and new values.
- Demonstrate simultaneous assignments. Use disposable demo tasks on the live app; do not run the fixture-resetting integration suite against the production database.
- Confirm cold-start behavior after idle and that SSE reconnects/refetches.
- Record expiry, service plan, and sufficient availability past the submission window.
- Add the real live URL and later the Loom recording URL prominently in README.

## Deployment status

No GitHub repository URL or live service URL is recorded here yet. Account authentication, resource creation, and live verification must be completed before claiming this application is deployed.

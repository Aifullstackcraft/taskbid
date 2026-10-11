# Ten-minute walkthrough plan

This is an outline for a later human recording, not a completed Loom submission.

Live app: [https://taskbid-pisc.onrender.com](https://taskbid-pisc.onrender.com). Open it shortly before recording to allow any Free-instance cold start to finish. Start as Ayesha Khan. The seeded capacity-race and stale-bid tasks remain ready for demonstration. Ignore completed tasks titled "Deployment verification"; these are the separate hosted checks.

## 0:00–1:00: Product and architecture

Show the user switcher, task board, and dashboard. Explain the three parts: React, Express, PostgreSQL. State that bids offer hours and the lowest currently eligible user receives the task. Explain that identity is simulated.

## 1:00–3:00: Schema and constraints

Open `db/migrations/001_schema.sql` and `002_rules_and_audit.sql`. Point out unique user/task bids, partial unique accepted-bid index, exact numeric hours, lifecycle guards, ownership/capacity checks, and transaction-local audit actor. Explain why cross-table checks use triggers. Briefly show the deferred consistency check and what invalid partial write it catches.

## 3:00–5:00: Capacity race demonstration

Run `npm test`. Show the test that holds the shared user lock, starts two assignment requests, confirms both waiting transactions, and releases the lock. Explain 10h capacity versus 5h + 7h demand. Both requests can succeed only because one chooses fallback; only one may assign the shared user. Show the no-fallback test returning one success and one conflict. Explain that locking task rows alone would not protect the shared user.

## 5:00–6:00: Stale bid

Choose Ayesha and open the seeded stale-bid task. Sara's 3h bid no longer fits her 2h remaining capacity. Assign and show Bilal winning with 4h. Show the preserved rejected bid and audit trail. Explain why pending bids do not reserve capacity.

## 6:00–7:30: Browser workflow and live updates

Open the same open task in two browser sessions. Creator on one, bidder on the other. Submit a bid and show the other browser updating without refresh. Close, assign, start work as assignee, submit review, and complete as creator. Show workload returning on completion.

## 7:30–8:30: SQL and audit trade-offs

Show the dashboard CTE query. Explain independent aggregation to avoid duplicate task counts. Show the audit previous/new values and why they roll back with the business write. Explain that SSE notifications are refresh hints, not durable history.

## 8:30–9:15: What you are proud of

Use a concrete answer: the concurrency test establishes actual overlapping requests, and the database independently rejects invalid assignments. Mention one SQL numeric edge case or the rollback audit test if time allows.

## 9:15–10:00: What you would change with more time

Choose one or two: restricted database runtime role and real authentication, calendar-based capacity, targeted cache invalidation/pagination, or durable event delivery. Explain the current trade-off. Finish by showing the live deployed URL after deployment is completed. Do not claim cloud verification before it happens.

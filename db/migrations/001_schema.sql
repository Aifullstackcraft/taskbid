CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL CHECK(length(trim(name)) > 0),
 email text NOT NULL UNIQUE, hourly_rate numeric(10,2) NOT NULL CHECK(hourly_rate >= 0),
 current_workload numeric(10,2) NOT NULL DEFAULT 0,
 max_capacity numeric(10,2) NOT NULL CHECK(max_capacity > 0),
 CHECK(current_workload >= 0 AND current_workload <= max_capacity)
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL CHECK(length(trim(title)) > 0),
 description text NOT NULL, complexity smallint NOT NULL CHECK(complexity BETWEEN 1 AND 5),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','bidding_closed','assigned','in_progress','review','done')),
 created_by uuid NOT NULL REFERENCES users(id), deadline timestamptz NOT NULL,
 assignee_id uuid REFERENCES users(id), accepted_hours numeric(10,2) CHECK(accepted_hours > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status IN ('draft','open','bidding_closed') AND assignee_id IS NULL AND accepted_hours IS NULL)
 OR (status IN ('assigned','in_progress','review','done') AND assignee_id IS NOT NULL AND accepted_hours IS NOT NULL))
);
CREATE TABLE bids (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL REFERENCES tasks(id),
 user_id uuid NOT NULL REFERENCES users(id), hours numeric(10,2) NOT NULL CHECK(hours > 0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(task_id,user_id)
);
CREATE UNIQUE INDEX one_accepted_bid ON bids(task_id) WHERE status='accepted';
CREATE INDEX bid_ranking ON bids(task_id,hours,created_at,id);
CREATE INDEX tasks_status ON tasks(status);
CREATE INDEX tasks_assignee ON tasks(assignee_id,status);
CREATE INDEX tasks_deadline ON tasks(deadline);
CREATE TABLE audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, entity_type text NOT NULL, entity_id uuid NOT NULL,
 operation text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 old_values jsonb, new_values jsonb
);
CREATE INDEX audit_entity ON audit_log(entity_type,entity_id,id DESC);

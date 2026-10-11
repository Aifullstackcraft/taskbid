-- Task-first, then user locks: all API mutations follow this order.
CREATE FUNCTION guard_bid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t tasks%ROWTYPE; u users%ROWTYPE;
BEGIN
 SELECT * INTO t FROM tasks WHERE id=NEW.task_id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW.status <> 'pending' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='BID_MUST_START_PENDING'; END IF;
  IF t.created_by=NEW.user_id THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='OWN_TASK_BID'; END IF;
  IF t.status <> 'open' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BIDDING_CLOSED'; END IF;
  SELECT * INTO u FROM users WHERE id=NEW.user_id FOR UPDATE;
  IF u.current_workload+NEW.hours > u.max_capacity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CAPACITY_EXCEEDED'; END IF;
 ELSE
  IF NEW.task_id<>OLD.task_id OR NEW.user_id<>OLD.user_id OR NEW.hours<>OLD.hours OR NEW.created_at<>OLD.created_at THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='BID_IMMUTABLE';
  END IF;
  IF NEW.status<>OLD.status AND (OLD.status<>'pending' OR NEW.status NOT IN ('accepted','rejected') OR t.status<>'bidding_closed') THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_BID_TRANSITION';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bid_rules BEFORE INSERT OR UPDATE ON bids FOR EACH ROW EXECUTE FUNCTION guard_bid();

CREATE FUNCTION guard_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lifecycle text[]:=ARRAY['draft','open','bidding_closed','assigned','in_progress','review','done']; u users%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TASK_MUST_START_DRAFT'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='TASK_IDENTITY_IMMUTABLE'; END IF;
 IF NEW.status<>OLD.status AND array_position(lifecycle,NEW.status)<>array_position(lifecycle,OLD.status)+1 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='INVALID_STATUS_TRANSITION';
 END IF;
 IF OLD.assignee_id IS NOT NULL AND (NEW.assignee_id IS DISTINCT FROM OLD.assignee_id OR NEW.accepted_hours IS DISTINCT FROM OLD.accepted_hours) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ASSIGNMENT_IMMUTABLE';
 END IF;
 IF OLD.status='bidding_closed' AND NEW.status='assigned' THEN
  IF NOT EXISTS(SELECT 1 FROM bids WHERE task_id=NEW.id AND user_id=NEW.assignee_id AND hours=NEW.accepted_hours AND status='accepted') THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ACCEPTED_BID_REQUIRED';
  END IF;
  SELECT * INTO u FROM users WHERE id=NEW.assignee_id FOR UPDATE;
  IF u.current_workload+NEW.accepted_hours > u.max_capacity THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='CAPACITY_EXCEEDED'; END IF;
  UPDATE users SET current_workload=current_workload+NEW.accepted_hours WHERE id=NEW.assignee_id;
 ELSIF OLD.status='review' AND NEW.status='done' THEN
  UPDATE users SET current_workload=current_workload-OLD.accepted_hours WHERE id=OLD.assignee_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_rules BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_task();

-- Prevent manual workload edits from drifting away from accepted active tasks.
CREATE FUNCTION guard_workload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.current_workload<>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='WORKLOAD_MANAGED'; END IF;
 IF TG_OP='UPDATE' AND NEW.current_workload<>OLD.current_workload AND pg_trigger_depth()<2 THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='WORKLOAD_MANAGED';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workload_rules BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION guard_workload();

-- A bid and its assignment must agree at transaction commit, not at each intermediate statement.
CREATE FUNCTION check_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_key uuid; t tasks%ROWTYPE; accepted bids%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN task_key:=NEW.id; ELSE task_key:=NEW.task_id; END IF;
 SELECT * INTO t FROM tasks WHERE id=task_key;
 SELECT * INTO accepted FROM bids WHERE task_id=task_key AND status='accepted';
 IF t.assignee_id IS NULL AND accepted.id IS NOT NULL OR
    t.assignee_id IS NOT NULL AND (accepted.id IS NULL OR accepted.user_id<>t.assignee_id OR accepted.hours<>t.accepted_hours) THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='ASSIGNMENT_INCONSISTENT';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER task_assignment_consistency AFTER INSERT OR UPDATE ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_assignment();
CREATE CONSTRAINT TRIGGER bid_assignment_consistency AFTER INSERT OR UPDATE ON bids DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_assignment();

CREATE FUNCTION record_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE actor uuid; task_key uuid;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD)=to_jsonb(NEW) THEN RETURN NEW; END IF;
 actor:=nullif(current_setting('app.actor_id',true),'')::uuid;
 IF actor IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='AUDIT_ACTOR_REQUIRED'; END IF;
 INSERT INTO audit_log(entity_type,entity_id,operation,actor_id,old_values,new_values)
 VALUES(TG_TABLE_NAME,NEW.id,TG_OP,actor,CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 IF TG_TABLE_NAME='tasks' THEN task_key:=NEW.id; ELSE task_key:=NEW.task_id; END IF;
 PERFORM pg_notify('taskbid_changes',json_build_object('taskId',task_key,'entity',TG_TABLE_NAME,'actorId',actor)::text);
 RETURN NEW;
END $$;
CREATE TRIGGER task_audit AFTER INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE TRIGGER bid_audit AFTER INSERT OR UPDATE ON bids FOR EACH ROW EXECUTE FUNCTION record_change();
CREATE FUNCTION prevent_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='DELETE_NOT_SUPPORTED';
END $$;
CREATE TRIGGER tasks_no_delete BEFORE DELETE ON tasks FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER bids_no_delete BEFORE DELETE ON bids FOR EACH ROW EXECUTE FUNCTION prevent_delete();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION prevent_delete();

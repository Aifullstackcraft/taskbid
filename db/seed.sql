BEGIN;
INSERT INTO users(id,name,email,hourly_rate,max_capacity) VALUES
 ('00000000-0000-4000-8000-000000000001','Ayesha Khan','ayesha@example.test',65,40),
 ('00000000-0000-4000-8000-000000000002','Omar Ali','omar@example.test',55,10),
 ('00000000-0000-4000-8000-000000000003','Sara Ahmed','sara@example.test',70,24),
 ('00000000-0000-4000-8000-000000000004','Bilal Hassan','bilal@example.test',50,32),
 ('00000000-0000-4000-8000-000000000005','Maya Chen','maya@example.test',80,16);
SELECT set_config('app.actor_id','00000000-0000-4000-8000-000000000001',true);
DO $$
DECLARE task_key uuid; n int; target int; chosen uuid; offered numeric;
 titles text[]:=ARRAY['Explore search relevance','Build team activity feed','Add CSV export','Improve keyboard navigation','Capacity race: 5-hour task','Capacity race: 7-hour task','Stale bidder: choose the next user','Refactor billing adapter','Write onboarding checklist','Review accessibility fixes','Ship settings redesign','Expired task with no bids'];
BEGIN
 FOR n IN 1..12 LOOP
  task_key:=('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
  INSERT INTO tasks(id,title,description,complexity,created_by,deadline) VALUES(task_key,titles[n],
   CASE WHEN n IN (5,6) THEN 'Race demo: Omar has 10 hours total capacity. Assign these two tasks concurrently. Only one can go to Omar; the other falls back to Bilal.'
   WHEN n=7 THEN 'Sara bid 3 hours before taking a 22-hour assignment. She now has only 2 hours free, so assignment must choose Bilal at 4 hours.'
   ELSE 'Deliver a focused implementation with clear acceptance criteria, useful validation, and a short handoff note.' END,
   (n%5)+1,'00000000-0000-4000-8000-000000000001',now()+CASE WHEN n=12 THEN interval '-2 days' ELSE (n||' days')::interval END);
  target:=CASE WHEN n=1 THEN 1 WHEN n IN (2,3,4,12) THEN 2 WHEN n IN (5,6,7) THEN 3 WHEN n=8 THEN 4 WHEN n=9 THEN 5 WHEN n=10 THEN 6 ELSE 7 END;
  IF target>=2 THEN UPDATE tasks SET status='open' WHERE id=task_key; END IF;
  IF n IN (2,3,4,5,6,7,8,9,10,11) THEN
   chosen:=CASE WHEN n IN (5,6) THEN '00000000-0000-4000-8000-000000000002'::uuid WHEN n IN (7,8) THEN '00000000-0000-4000-8000-000000000003'::uuid ELSE '00000000-0000-4000-8000-000000000004'::uuid END;
   offered:=CASE WHEN n=5 THEN 5 WHEN n=6 THEN 7 WHEN n=7 THEN 3 WHEN n=8 THEN 22 ELSE 2 END;
   -- Defer the 22h acceptance until all bids are placed, creating an intentional stale bid.
   INSERT INTO bids(task_id,user_id,hours) VALUES(task_key,chosen,offered);
   IF n IN (5,6,7) THEN INSERT INTO bids(task_id,user_id,hours) VALUES(task_key,'00000000-0000-4000-8000-000000000004',offered+1); END IF;
  END IF;
  IF target>=3 THEN UPDATE tasks SET status='bidding_closed' WHERE id=task_key; END IF;
  IF target>=4 THEN
   UPDATE bids SET status='accepted' WHERE task_id=task_key AND user_id=chosen;
   UPDATE tasks SET status='assigned',assignee_id=chosen,accepted_hours=offered WHERE id=task_key;
  END IF;
  IF target>=5 THEN UPDATE tasks SET status='in_progress' WHERE id=task_key; END IF;
  IF target>=6 THEN UPDATE tasks SET status='review' WHERE id=task_key; END IF;
  IF target>=7 THEN UPDATE tasks SET status='done' WHERE id=task_key; END IF;
 END LOOP;
END $$;
COMMIT;

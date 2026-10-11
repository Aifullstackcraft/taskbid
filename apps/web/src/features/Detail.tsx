import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { statuses, type Task, type User, type Bid, type AuditEntry } from '@taskbid/contracts';
import { api } from '../api';
import { label, number, ErrorBox } from '../ui';
export function Detail({ user }: { user: User }) {
  const { id } = useParams(),
    client = useQueryClient(),
    [offered, setOffered] = useState(''),
    [notice, setNotice] = useState('');
  const task = useQuery({ queryKey: ['task', id], queryFn: () => api<Task>(`/tasks/${id}`) }),
    bids = useQuery({ queryKey: ['bids', id], queryFn: () => api<Bid[]>(`/tasks/${id}/bids`) }),
    audit = useQuery({
      queryKey: ['audit', id],
      queryFn: () => api<AuditEntry[]>(`/tasks/${id}/audit`),
    }),
    workload = useQuery({
      queryKey: ['workload', user.id],
      queryFn: () => api<User>(`/users/${user.id}/workload`),
    });
  const mutation = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method: string }) =>
      api(path, user.id, body, method),
    onSuccess: () => {
      setOffered('');
      setNotice('Saved. The workspace is up to date.');
      void client.invalidateQueries();
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: ['workload'] });
      void client.invalidateQueries({ queryKey: ['users'] });
    },
  });
  if (task.isPending) return <p className="loading">Loading task…</p>;
  if (!task.data)
    return (
      <section className="page">
        <ErrorBox error={task.error} />
      </section>
    );
  const t = task.data,
    remaining = Number(workload.data?.remaining_capacity ?? user.remaining_capacity),
    hasBid = bids.data?.some((b) => b.user_id === user.id),
    next = statuses[statuses.indexOf(t.status) + 1];
  const canAdvance =
    next &&
    (next === 'in_progress' || next === 'review'
      ? t.assignee_id === user.id
      : t.created_by === user.id);
  function submitBid(e: FormEvent) {
    e.preventDefault();
    mutation.mutate({
      path: `/tasks/${id}/bids`,
      body: { hours: Number(offered) },
      method: 'POST',
    });
  }
  return (
    <section className="page detail">
      <Link className="back" to="/">
        <ArrowLeft size={16} />
        Back to task board
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TASK DETAILS · LEVEL {t.complexity}</span>
          <h1>{t.title}</h1>
          <span className={`status-pill ${t.status}`}>{label(t.status)}</span>
        </div>
        {canAdvance &&
          (next === 'assigned' ? (
            <button
              className="primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ path: `/tasks/${id}/assign`, method: 'POST' })}
            >
              Assign lowest valid bidder
              <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="primary"
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  path: `/tasks/${id}/status`,
                  body: { status: next },
                  method: 'PATCH',
                })
              }
            >
              Move to {label(next)}
              <ArrowRight size={16} />
            </button>
          ))}
      </div>
      <ErrorBox error={mutation.error} />
      {notice && (
        <p className="success" role="status">
          <CheckCircle2 size={16} />
          {notice}
        </p>
      )}
      <div className="detail-grid">
        <div>
          <article className="panel">
            <h2>The brief</h2>
            <p className="description">{t.description || 'No description provided.'}</p>
            <div className="facts">
              <div>
                <span>Created by</span>
                <strong>{t.creator_name}</strong>
              </div>
              <div>
                <span>Deadline</span>
                <strong>{new Date(t.deadline).toLocaleString()}</strong>
              </div>
              <div>
                <span>Assigned to</span>
                <strong>{t.assignee_name ?? 'Awaiting assignment'}</strong>
              </div>
              <div>
                <span>Accepted hours</span>
                <strong>{t.accepted_hours ? `${number(t.accepted_hours)} hrs` : '—'}</strong>
              </div>
            </div>
          </article>
          <article className="panel bids-panel">
            <h2>
              Bids <span className="count">{bids.data?.length ?? 0}</span>
            </h2>
            <p className="muted">Lowest hours first. Equal bids are ordered by time placed.</p>
            <ErrorBox error={bids.error} />
            {bids.isPending ? (
              <p>Loading bids…</p>
            ) : !bids.data?.length ? (
              <p className="empty">No bids yet. Be the first to make an offer.</p>
            ) : (
              <div className="bid-list">
                {bids.data.map((b, i) => (
                  <div className="bid-row" key={b.id}>
                    <span className="rank">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <strong>{b.user_name}</strong>
                      <small>{new Date(b.created_at).toLocaleString()}</small>
                    </div>
                    <span className="bid-state">
                      {b.status === 'pending' && !b.currently_eligible
                        ? 'Capacity changed'
                        : b.status}
                    </span>
                    <strong className="bid-hours">
                      {number(b.hours)}
                      <small> hrs</small>
                    </strong>
                  </div>
                ))}
              </div>
            )}
          </article>
          <article className="panel">
            <h2>Activity & audit trail</h2>
            <ErrorBox error={audit.error} />
            <div className="audit-list">
              {audit.data?.map((a) => (
                <details key={a.id}>
                  <summary>
                    <span>
                      {a.actor_name ?? 'System'} · {a.entity_type === 'tasks' ? 'Task' : 'Bid'}{' '}
                      {a.operation.toLowerCase()}
                    </span>
                    <small>{new Date(a.changed_at).toLocaleString()}</small>
                  </summary>
                  <div className="audit-values">
                    <div>
                      <strong>Previous values</strong>
                      <pre>{JSON.stringify(a.old_values, null, 2)}</pre>
                    </div>
                    <div>
                      <strong>New values</strong>
                      <pre>{JSON.stringify(a.new_values, null, 2)}</pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </article>
        </div>
        <div>
          <article className="capacity-panel">
            <span className="eyebrow">YOUR WORKLOAD</span>
            <h2>
              {number(remaining)}
              <small> hrs available</small>
            </h2>
            <progress
              value={Number(workload.data?.current_workload ?? user.current_workload)}
              max={Number(user.max_capacity)}
            />
            <p>
              {number(workload.data?.current_workload ?? user.current_workload)} of{' '}
              {number(user.max_capacity)} hours committed
            </p>
            <ErrorBox error={workload.error} />
          </article>
          <article className="panel">
            <h2>Place your bid</h2>
            {t.status !== 'open' ? (
              <p className="muted">
                Bidding is {t.status === 'draft' ? 'not open yet' : 'closed'} for this task.
              </p>
            ) : t.created_by === user.id ? (
              <p className="muted">You created this task. Other team members can bid.</p>
            ) : hasBid ? (
              <p className="success">Your bid is recorded. Each person can bid once.</p>
            ) : (
              <form onSubmit={submitBid}>
                <p className="muted">
                  How many hours will you need? Pending bids don’t reserve capacity.
                </p>
                <label>
                  Hours offered
                  <input
                    aria-label="Hours offered"
                    type="number"
                    min="0.01"
                    max={remaining}
                    step="0.01"
                    value={offered}
                    onChange={(e) => setOffered(e.target.value)}
                    required
                  />
                </label>
                <p className="hint">
                  Maximum right now: {number(remaining)} hrs. Capacity is checked again when you
                  submit.
                </p>
                <button
                  className="primary full"
                  disabled={
                    mutation.isPending ||
                    remaining <= 0 ||
                    !offered ||
                    Number(offered) > remaining ||
                    Number(offered) <= 0
                  }
                >
                  Submit bid
                  <ArrowRight size={16} />
                </button>
              </form>
            )}
          </article>
        </div>
      </div>
    </section>
  );
}

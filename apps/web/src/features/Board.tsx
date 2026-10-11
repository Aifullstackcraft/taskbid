import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, Clock } from 'lucide-react';
import { statuses, type Task, type User } from '@taskbid/contracts';
import { CreateTask } from './CreateTask';
import { api } from '../api';
import { label, date, number, ErrorBox } from '../ui';
export function Board({ user }: { user: User }) {
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') }),
    [creating, setCreating] = useState(false),
    [search, setSearch] = useState('');
  const visible = (tasks.data ?? []).filter((t) =>
    t.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR TEAM, IN MOTION</span>
          <h1>Task board</h1>
          <p>Discover work, place a bid, and move things forward.</p>
        </div>
        <button className="primary" onClick={() => setCreating(true)}>
          <Plus size={17} />
          Create task
        </button>
      </div>
      <div className="summary-strip">
        <div>
          <span>Available capacity</span>
          <strong>
            {number(user.remaining_capacity)}
            <small> / {number(user.max_capacity)} hrs</small>
          </strong>
        </div>
        <div>
          <span>Open for bidding</span>
          <strong>
            {(tasks.data ?? []).filter((t) => t.status === 'open').length}
            <small> tasks</small>
          </strong>
        </div>
        <div>
          <span>Your active assignments</span>
          <strong>
            {
              (tasks.data ?? []).filter((t) => t.assignee_id === user.id && t.status !== 'done')
                .length
            }
            <small> tasks</small>
          </strong>
        </div>
        <div className="strip-caption">
          <Clock size={19} />
          <p>
            Bid in hours.
            <br />
            Keep your workload balanced.
          </p>
        </div>
      </div>
      <div className="board-toolbar">
        <span>
          All tasks <b>{tasks.data?.length ?? 0}</b>
        </span>
        <input
          aria-label="Search tasks"
          placeholder="Search tasks…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ErrorBox error={tasks.error} />
      {tasks.isPending ? (
        <p className="loading">Loading tasks…</p>
      ) : (
        <div className="board">
          {statuses.map((status) => (
            <section className="column" key={status}>
              <h2>
                <span className={`status-dot ${status}`} />
                {label(status)}
                <span className="count">{visible.filter((t) => t.status === status).length}</span>
              </h2>
              <div className="cards">
                {visible
                  .filter((t) => t.status === status)
                  .map((t) => (
                    <Link to={`/tasks/${t.id}`} className="task-card" key={t.id}>
                      <div className="card-top">
                        <span className="complexity">LEVEL {t.complexity}</span>
                        {t.created_by === user.id && <span className="mine">Yours</span>}
                      </div>
                      <h3>{t.title}</h3>
                      <p>{t.description}</p>
                      <div className="card-meta">
                        <span>
                          <Clock size={13} />
                          <span
                            className={
                              new Date(t.deadline) < new Date() && t.status !== 'done'
                                ? 'overdue'
                                : ''
                            }
                          >
                            {date(t.deadline)}
                          </span>
                        </span>
                        <span>
                          {t.bid_count} {t.bid_count === 1 ? 'bid' : 'bids'}
                        </span>
                      </div>
                      <div className="card-footer">
                        <span>{t.assignee_name ?? t.creator_name}</span>
                        <strong>
                          {t.lowest_bid ? `${number(t.lowest_bid)} hrs` : 'No bids yet'}
                        </strong>
                      </div>
                    </Link>
                  ))}
                {!visible.some((t) => t.status === status) && (
                  <div className="empty-column">No tasks here</div>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {creating && <CreateTask user={user} close={() => setCreating(false)} />}
    </section>
  );
}

import { type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Task, type User } from '@taskbid/contracts';
import { api } from '../api';
import { ErrorBox } from '../ui';
export function CreateTask({ user, close }: { user: User; close: () => void }) {
  const client = useQueryClient(),
    navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (body: unknown) => api<Task>('/tasks', user.id, body, 'POST'),
    onSuccess: (t) => {
      void client.invalidateQueries();
      close();
      navigate(`/tasks/${t.id}`);
    },
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    mutation.mutate({
      title: f.get('title'),
      description: f.get('description'),
      complexity: Number(f.get('complexity')),
      deadline: new Date(String(f.get('deadline'))).toISOString(),
    });
  }
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <h2 id="create-title">Create a task</h2>
        <p>Start with a draft. Open bidding when you’re ready.</p>
        <form onSubmit={submit}>
          <label>
            Title
            <input name="title" maxLength={160} required autoFocus />
          </label>
          <label>
            Description
            <textarea name="description" rows={4} maxLength={10000} />
          </label>
          <div className="form-row">
            <label>
              Complexity
              <select name="complexity">
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <label>
              Deadline
              <input type="datetime-local" name="deadline" required />
            </label>
          </div>
          <ErrorBox error={mutation.error} />
          <div className="actions">
            <button type="button" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

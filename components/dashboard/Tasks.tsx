'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText, formatTime } from './api';
import type { Message, Task, TaskStatus } from './types';

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'open',
  done: 'done',
  needs_info: 'needs info',
  failed: 'failed',
};

const FILTERS: Array<{ value: '' | TaskStatus; label: string }> = [
  { value: '', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'needs_info', label: 'Needs info' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
];

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`dash-pill dash-pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

function Json({ value }: { value: unknown }) {
  return (
    <pre className="dash-json" translate="no">
      <code translate="no">{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function TaskRow({ task }: { task: Task }) {
  const [thread, setThread] = useState<Message[] | null>(null);
  const [threadError, setThreadError] = useState('');
  const [loading, setLoading] = useState(false);

  async function loadThread() {
    setLoading(true);
    setThreadError('');
    try {
      const data = await api<{ task: Task; messages: Message[] }>(`/api/v1/tasks/${task.id}`);
      setThread(data.messages);
    } catch (err) {
      setThreadError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <li>
      <details className="dash-task">
        <summary>
          <span className="dash-task-title">{task.title}</span>
          <span className="dash-task-to">
            <span translate="no">{task.from}</span> → <span translate="no">{task.to}</span>
          </span>
          <StatusPill status={task.status} />
          <time className="dash-task-time" dateTime={task.created_at}>
            {formatTime(task.created_at)}
          </time>
        </summary>
        <div className="dash-task-body">
          <dl className="dash-dl">
            <div>
              <dt>Task id</dt>
              <dd>
                <code translate="no">{task.id}</code>
              </dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatTime(task.updated_at)}</dd>
            </div>
            {task.completed_at ? (
              <div>
                <dt>Closed</dt>
                <dd>{formatTime(task.completed_at)}</dd>
              </div>
            ) : null}
          </dl>
          {task.input ? (
            <>
              <h4>Form fields (untrusted)</h4>
              <dl className="dash-dl">
                {Object.entries(task.input).map(([key, value]) => (
                  <div key={key}>
                    <dt>{fieldLabel(task.input_schema, key)}</dt>
                    <dd className="dash-pre-text">{Array.isArray(value) ? value.join(', ') : String(value)}</dd>
                  </div>
                ))}
              </dl>
              <h4>Notes</h4>
              <p className="dash-pre-text">{task.description || 'None'}</p>
            </>
          ) : (
            <>
              <h4>Description</h4>
              <p className="dash-pre-text">{task.description}</p>
            </>
          )}

          {task.status === 'done' ? (
            <>
              <h4>Validated result</h4>
              <Json value={task.result} />
            </>
          ) : null}
          {task.question ? (
            <>
              <h4>Question for {task.from}</h4>
              <p className="dash-pre-text">{task.question}</p>
            </>
          ) : null}
          {task.fail_reason ? (
            <>
              <h4>Why it failed</h4>
              <p className="dash-pre-text">{task.fail_reason}</p>
            </>
          ) : null}

          <details className="dash-sub">
            <summary>Result schema</summary>
            <Json value={task.result_schema} />
          </details>

          {thread === null ? (
            <button type="button" className="dash-textbtn" onClick={loadThread} disabled={loading}>
              {loading ? 'Loading thread…' : 'Show thread messages'}
            </button>
          ) : thread.length === 0 ? (
            <p className="dash-muted">No messages in this task’s thread.</p>
          ) : (
            <>
              <h4>Thread</h4>
              <ol className="dash-thread">
                {thread.map((m) => (
                  <li key={m.id}>
                    <p className="dash-muted">
                      <span translate="no">{m.from}</span> → <span translate="no">{m.to}</span> ·{' '}
                      {formatTime(m.created_at)}
                    </p>
                    <p className="dash-pre-text">{m.body}</p>
                  </li>
                ))}
              </ol>
            </>
          )}
          {threadError ? (
            <p className="dash-err" role="alert">
              {threadError}
            </p>
          ) : null}
        </div>
      </details>
    </li>
  );
}

export function Tasks({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<'' | TaskStatus>('');
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    const q = new URLSearchParams({ limit: '100' });
    if (status) q.set('status', status);
    return (await api<{ tasks: Task[] }>(`/api/v1/tasks?${q}`)).tasks;
  }, [status]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setTasks(await fetchTasks());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetchTasks().then(
      (list) => {
        if (cancelled) return;
        setTasks(list);
        setError('');
      },
      (err: unknown) => {
        if (!cancelled) setError(errorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchTasks, refreshKey]);

  return (
    <section className="dash-card" aria-labelledby="tasks-h">
      <div className="dash-card-head">
        <div>
          <h2 id="tasks-h">Tasks</h2>
          <p className="dash-muted">
            Every task in this workspace, newest first. Read-only: agents open and close tasks over MCP.
          </p>
        </div>
        <div className="dash-filter">
          <label htmlFor="task-status">Status</label>
          <select id="task-status" value={status} onChange={(e) => setStatus(e.target.value as '' | TaskStatus)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <button type="button" className="dash-textbtn" onClick={() => void load()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {error ? (
        <p className="dash-err" role="alert">
          {error}
        </p>
      ) : null}
      {tasks === null ? (
        <p className="dash-muted">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="dash-empty">
          {status ? 'No tasks with this status.' : 'No tasks yet. They appear here as soon as one agent creates a task for another.'}
        </p>
      ) : (
        <ul className="dash-tasks">
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Label for a form field: its schema title, else the key with spaces. Rendered as text only. */
function fieldLabel(schema: Record<string, unknown> | null, key: string): string {
  const properties = schema?.properties as Record<string, { title?: unknown }> | undefined;
  const title = properties?.[key]?.title;
  if (typeof title === 'string' && title.trim()) return title;
  const spaced = key.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, errorText } from './api';

const MAX = 80;

/** Workspace heading with an inline rename (PATCH /api/v1/workspaces/current). */
export function WorkspaceName({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [draft, setDraft] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
    else if (wasEditing.current) editRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    const value = draft.trim();
    if (!value || value.length > MAX) {
      setError(`Use 1 to ${MAX} characters.`);
      return;
    }
    if (value === name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { workspace } = await api<{ workspace: { name: string } }>('/api/v1/workspaces/current', {
        method: 'PATCH',
        body: { name: value },
      });
      setName(workspace.name);
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 404 || err.status === 405)
          ? 'Renaming isn’t available on this server yet.'
          : errorText(err),
      );
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="dash-ws-name">
        <h1 id="ws-h">{name}</h1>
        <button
          ref={editRef}
          type="button"
          className="dash-textbtn"
          onClick={() => {
            setDraft(name);
            setError('');
            setEditing(true);
          }}
        >
          Rename<span className="vh"> workspace</span>
        </button>
      </div>
    );
  }

  return (
    <>
      <h1 id="ws-h" className="vh">
        {name}
      </h1>
      <form className="dash-rename" onSubmit={save} noValidate>
        <label htmlFor="ws-name">Workspace name</label>
        <div className="dash-rename-row">
          <input
            ref={inputRef}
            id="ws-name"
            name="name"
            type="text"
            maxLength={MAX}
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby="ws-name-msg"
          />
          <button className="btn" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="dash-textbtn" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
        </div>
        <p className={error ? 'form-msg err' : 'form-msg'} id="ws-name-msg" role="status" aria-live="polite">
          {error}
        </p>
      </form>
    </>
  );
}

'use client';

import { useState, type FormEvent } from 'react';
import { api, errorText } from './api';

/** Mirrors HANDLE_PATTERN in lib/constants. The API checks it too. */
const HANDLE = /^[a-z][a-z0-9-]{1,31}$/;
const RULE = '2 to 32 characters: lowercase letters, numbers or hyphens, starting with a letter.';

/** Workspace handle for shared-agent addresses (PATCH /api/v1/workspaces/current { handle }). */
export function WorkspaceHandle({
  handle,
  shared,
  onSaved,
}: {
  handle: string | null;
  /** How many agents are shared now. Changing the handle moves their addresses. */
  shared: number;
  onSaved: (handle: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function save(ev: FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const value = draft.trim().replace(/^@/, '').toLowerCase();
    if (!HANDLE.test(value)) {
      setError(RULE);
      return;
    }
    if (value === handle) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const { workspace } = await api<{ workspace: { handle: string | null } }>('/api/v1/workspaces/current', {
        method: 'PATCH',
        body: { handle: value },
      });
      onSaved(workspace.handle ?? value);
      setSaved(true);
      setEditing(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="dash-handle">
        {handle ? (
          <p>
            <span className="dash-muted">Handle</span> <code translate="no">@{handle}</code>{' '}
            <button
              type="button"
              className="dash-textbtn"
              onClick={() => {
                setDraft(handle);
                setError('');
                setSaved(false);
                setEditing(true);
              }}
            >
              Change<span className="vh"> handle</span>
            </button>
          </p>
        ) : (
          <p>
            <span className="dash-muted">No handle yet. Set one to share agents with other teams.</span>{' '}
            <button
              type="button"
              className="dash-textbtn"
              onClick={() => {
                setDraft('');
                setError('');
                setSaved(false);
                setEditing(true);
              }}
            >
              Set handle
            </button>
          </p>
        )}
        {saved ? (
          <p className="dash-ok dash-row-ok" role="status">
            Handle saved.
          </p>
        ) : null}
      </div>
    );
  }

  const preview = draft.trim().replace(/^@/, '').toLowerCase() || 'handle';
  return (
    <form className="dash-rename dash-handle-form" onSubmit={save} noValidate>
      <label htmlFor="ws-handle">Workspace handle</label>
      <div className="dash-rename-row">
        <span className="dash-handle-at" aria-hidden="true">
          @
        </span>
        <input
          id="ws-handle"
          name="handle"
          type="text"
          maxLength={33}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="yourteam"
          value={draft}
          readOnly={busy}
          onChange={(e) => {
            setDraft(e.target.value);
            setError('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) setEditing(false);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby="ws-handle-hint ws-handle-msg"
        />
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="dash-textbtn" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </button>
      </div>
      <p className="dash-hint" id="ws-handle-hint">
        {RULE} Shared agents get an address like <code translate="no">@{preview}/agent-name</code>.
        {handle && shared > 0
          ? ` Changing it changes the address of your ${shared === 1 ? 'shared agent' : `${shared} shared agents`}.`
          : ''}
      </p>
      <p className={error ? 'form-msg err' : 'form-msg'} id="ws-handle-msg" role="status" aria-live="polite">
        {error}
      </p>
    </form>
  );
}

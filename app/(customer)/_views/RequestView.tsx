'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleAlert, Eye, Hourglass, Loader2, MessageCircleQuestion } from 'lucide-react';
import { answerRequest, getBot, getRequest } from '../_lib/api';
import { ApiError, type Branding, type CustomerRequest } from '../_lib/types';
import { Button } from '../_ui/button';
import { Label } from '../_ui/label';
import { Textarea } from '../_ui/textarea';
import { BrandFrame } from '../_components/Frame';
import { PlainValues } from '../_components/PlainValues';
import { StatusBadge } from '../_components/StatusBadge';
import { failCopy, statusCopy } from '../_components/status';
import { usePoll } from '../_components/usePoll';
import { cn } from '../_lib/utils';
import { Account, Loading, NotFound, when } from './common';

const WAITING = new Set(['in_review', 'open', 'awaiting_release']);

export function RequestView({ agentId, taskId }: { agentId: string; taskId: string }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [req, setReq] = useState<CustomerRequest | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      setReq((await getRequest(taskId)).request);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setMissing(true);
    }
  }, [taskId]);

  useEffect(() => {
    getBot(agentId).then((b) => setBranding(b.bot.branding), () => setMissing(true));
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [agentId, load]);

  // Spec 15.9: every 5 s for 2 minutes, then every 15 s; stop on done/failed and while a question is open.
  usePoll(load, (ms) => (ms < 120000 ? 5000 : 15000), Boolean(req && WAITING.has(req.status)));

  if (missing) return <NotFound message="We couldn't find that request." />;
  if (!branding || !req) return <Loading />;
  const name = branding.display_name;
  const copy = statusCopy(req.status, name);

  return (
    <BrandFrame branding={branding} agentId={agentId} account={<Account />}>
      <Link href={`/c/${agentId}/requests`} className="-ml-2 inline-flex h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Your requests
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-[26px] leading-tight font-semibold tracking-tight">{req.title}</h1>
        <StatusBadge status={req.status} name={name} />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Sent {when(req.created_at).replace(/^Today/, 'today')}</p>

      <div className="mt-6 grid gap-4">
        {WAITING.has(req.status) && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6" aria-live="polite">
            <div className="flex items-start gap-4">
              <span className={cn('grid size-11 shrink-0 place-items-center rounded-full', req.status === 'open' ? 'bg-primary text-primary-foreground' : 'bg-accent text-primary-text')}>
                {req.status === 'open' ? <Loader2 className="size-5 animate-spin" /> : req.status === 'in_review' ? <Hourglass className="size-5" /> : <Eye className="size-5" />}
              </span>
              <div>
                <h2 className="text-[17px] leading-snug font-semibold">{copy.title}</h2>
                <p className="mt-1 text-[15px] text-muted-foreground">{copy.body}</p>
              </div>
            </div>
          </section>
        )}

        {req.status === 'needs_info' && req.question && <AnswerCard req={req} name={name} onAnswered={setReq} />}

        {req.status === 'done' && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-[17px] font-semibold">
              <CheckCircle2 className="size-5 text-emerald-700" /> Answer from {name}
            </h2>
            {req.result_display.length ? <PlainValues rows={req.result_display} emphasize /> : <p className="text-muted-foreground">No details were included.</p>}
          </section>
        )}

        {req.status === 'failed' && <FailedCard req={req} name={name} />}

        {req.answers.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="mb-3 text-[15px] font-semibold">Questions and answers</h2>
            <ol className="grid gap-4">
              {req.answers.map((a) => (
                <li key={a.asked_at} className="grid gap-2 text-[15px]">
                  <p className="rounded-xl rounded-tl-sm bg-muted px-3.5 py-2.5 whitespace-pre-wrap">{a.question}</p>
                  <p className="ml-8 rounded-xl rounded-tr-sm bg-accent px-3.5 py-2.5 whitespace-pre-wrap">{a.answer}</p>
                </li>
              ))}
            </ol>
          </section>
        )}

        {(req.input_display.length > 0 || req.notes) && (
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-[15px] font-semibold">What you sent</h2>
            {req.input_display.length > 0 && <PlainValues rows={req.input_display} />}
            {req.notes && (
              <div className={cn(req.input_display.length > 0 && 'mt-3 border-t border-border pt-3')}>
                <p className="text-sm text-muted-foreground">{req.input ? 'Notes' : 'Your message'}</p>
                <p className="mt-0.5 text-[15px] whitespace-pre-wrap">{req.notes}</p>
              </div>
            )}
          </section>
        )}
      </div>
    </BrandFrame>
  );
}

function FailedCard({ req, name }: { req: CustomerRequest; name: string }) {
  const copy = failCopy(req.fail_code, name);
  return (
    <section className="rounded-2xl border border-border bg-muted/60 p-5 sm:p-6" role="status">
      <h2 className="flex items-center gap-2 text-[17px] leading-snug font-semibold">
        <CircleAlert className="size-5 shrink-0 text-muted-foreground" /> {copy.title}
      </h2>
      {req.fail_message && (
        <figure className="mt-3 rounded-xl border border-border bg-card px-4 py-3">
          <figcaption className="text-sm text-muted-foreground">Message from {name}</figcaption>
          {/* Bot text, untrusted: rendered as a plain string, never as HTML or a link. */}
          <blockquote className="mt-1 text-[15px] whitespace-pre-wrap">{req.fail_message}</blockquote>
        </figure>
      )}
      <p className="mt-3 text-[15px] text-muted-foreground">{copy.body}</p>
      {req.fail_code !== 'declined_by_owner' && (
        <Button asChild variant="outline" className="mt-4 h-12 w-full rounded-xl bg-card text-base sm:w-auto sm:px-6">
          <Link href={`/c/${req.bot.agent_id}/new/${req.offer}`}>Send it again</Link>
        </Button>
      )}
    </section>
  );
}

function AnswerCard({ req, name, onAnswered }: { req: CustomerRequest; name: string; onAnswered: (r: CustomerRequest) => void }) {
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim()) return setError('Required.');
    setBusy(true);
    setError(null);
    try {
      onAnswered((await answerRequest(req.id, answer)).request);
    } catch (err) {
      if (err instanceof ApiError) setError(err.details?.fields?.answer ?? err.message);
      else setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="border-l-4 border-brand-accent p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-muted-foreground">
          <MessageCircleQuestion className="size-5 text-primary-text" /> {name} asks
        </h2>
        <p className="mt-2 text-[18px] leading-snug font-medium whitespace-pre-wrap">{req.question}</p>
        <form onSubmit={send} noValidate className="mt-5 grid gap-2">
          <Label htmlFor="vt-answer" className="text-[15px]">
            Your answer
          </Label>
          <Textarea
            id="vt-answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            maxLength={2000}
            rows={4}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'vt-answer-error' : undefined}
            className="min-h-28 rounded-xl bg-card px-3.5 py-3 text-base md:text-base"
          />
          {error && (
            <p id="vt-answer-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy} className="mt-2 h-12 w-full rounded-xl text-base font-semibold">
            {busy && <Loader2 className="animate-spin" />} Send answer
          </Button>
        </form>
      </div>
    </section>
  );
}

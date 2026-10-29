'use client';

import { useMemo, useState } from 'react';
import { useForm, type ControllerRenderProps, type FieldValues } from 'react-hook-form';
import { AlertCircle, Loader2 } from 'lucide-react';
import { createRequest } from '../_lib/api';
import { controlFor, checkField, labelFor, optionsFor, orderedFields } from '../_lib/schema';
import { ApiError, type CustomerRequest, type InputField, type InputObject, type InputValue, type Job, type TextField } from '../_lib/types';
import { Alert, AlertDescription, AlertTitle } from '../_ui/alert';
import { Button } from '../_ui/button';
import { Checkbox } from '../_ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '../_ui/form';
import { Input } from '../_ui/input';
import { RadioGroup, RadioGroupItem } from '../_ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../_ui/select';
import { Textarea } from '../_ui/textarea';
import { cn } from '../_lib/utils';

/** Form values: numbers stay strings while typing and are parsed to JSON numbers on submit (spec 7). */
type Values = Record<string, string | boolean | string[]>;
const NOTES = 'notes';

function initialValue(f: InputField): string | boolean | string[] {
  switch (f.type) {
    case 'boolean':
      return f.default ?? false;
    case 'array':
      return f.default ?? [];
    case 'number':
    case 'integer':
      return f.default !== undefined ? String(f.default) : '';
    case 'string':
      return f.default ?? '';
  }
}

/** Turn a form value into what the API gets; undefined means "leave it out" (spec 7: no empty strings). */
function toJson(f: InputField, v: string | boolean | string[]): InputValue | undefined {
  if (f.type === 'boolean') return Boolean(v);
  if (f.type === 'array') return (v as string[]).length ? (v as string[]) : undefined;
  if (f.type === 'number' || f.type === 'integer') {
    const s = String(v).trim();
    return s === '' ? undefined : Number(s);
  }
  const s = String(v);
  return s.trim() === '' ? undefined : s;
}

const field = 'h-12 rounded-xl bg-card px-3.5 text-base shadow-none md:text-base';
const choiceRow =
  'flex min-h-12 w-full items-center gap-3 rounded-xl border border-input bg-card px-3.5 py-3 text-[15px] transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/30';

export function JobForm({
  agentId,
  job,
  businessName,
  disabled = false,
  onSent,
  onPending,
}: {
  agentId: string;
  job: Job;
  businessName: string;
  /** Section 17.1: pending customers see the form but can't use it. */
  disabled?: boolean;
  onSent: (r: CustomerRequest) => void;
  /** Called on R5 403 pending_approval so the page can re-read the share. */
  onPending?: () => void;
}) {
  const schema = job.input_schema;
  const fields = useMemo(() => (schema ? orderedFields(schema) : []), [schema]);
  const required = useMemo(() => new Set(schema?.required ?? []), [schema]);
  const defaults = useMemo(() => {
    const d: Values = Object.fromEntries(fields.map(([k, f]) => [k, initialValue(f)]));
    d[NOTES] = '';
    return d;
  }, [fields]);
  const form = useForm<Values>({ defaultValues: defaults, mode: 'onTouched' });
  const [formError, setFormError] = useState<{ title: string; body: string } | null>(null);
  const notesShown = !schema || job.notes_enabled;
  const notesRequired = !schema;
  const { isSubmitting } = form.formState;

  async function submit(values: Values) {
    setFormError(null);
    const input: InputObject = {};
    for (const [k, f] of fields) {
      const v = toJson(f, values[k]);
      if (v !== undefined) input[k] = v;
    }
    const notes = String(values[NOTES] ?? '').trim();
    try {
      const res = await createRequest(agentId, {
        offer: job.name,
        ...(schema ? { input } : {}),
        ...(notesShown && notes ? { notes } : {}),
        client_request_id: crypto.randomUUID(), // the button is disabled while sending, so one id per click (spec 15.6)
      });
      onSent(res.request);
    } catch (e) {
      if (!(e instanceof ApiError)) {
        setFormError({ title: "That didn't go through", body: 'Check your connection and try again.' });
        return;
      }
      const map = e.details?.fields ?? {};
      const known = new Set([...fields.map(([k]) => k), NOTES]);
      const leftovers: string[] = [];
      for (const [key, message] of Object.entries(map)) {
        if (known.has(key)) {
          form.setError(key, { type: 'server', message });
        } else leftovers.push(message);
      }
      // Move focus to the first field the server flagged (FormControl marks it aria-invalid).
      requestAnimationFrame(() => document.querySelector<HTMLElement>('.vt-root form [aria-invalid="true"]')?.focus());
      if (e.code === 'pending_approval') {
        setFormError({ title: `Waiting for approval from ${businessName}`, body: 'You can send this once they approve you.' });
        onPending?.();
      } else if (e.code === 'share_revoked') setFormError({ title: `You can't send new requests to ${businessName}`, body: e.message });
      else if (e.code === 'rate_limited') setFormError({ title: "You've reached today's limit", body: 'You can send more requests tomorrow. Your past requests are still here.' });
      else if (e.code === 'invalid_input' || e.code === 'validation_error')
        // `_form` / unknown-key errors are about the schema, not something the customer can fix by hand.
        setFormError({
          title: 'Some fields need fixing',
          body: leftovers.length ? 'Check the fields marked below. If this keeps happening, reload the page: the form may have changed.' : 'Check the fields marked below.',
        });
      else setFormError({ title: "That didn't go through", body: e.message });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} noValidate>
        <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-6 border-0 p-0 disabled:opacity-60">
        {formError && (
          <Alert variant="destructive" className="rounded-xl border-destructive/30 bg-red-50/60" role="alert">
            <AlertCircle />
            <AlertTitle>{formError.title}</AlertTitle>
            <AlertDescription>{formError.body}</AlertDescription>
          </Alert>
        )}

        {fields.map(([key, f]) => (
          <FormField
            key={key}
            control={form.control}
            name={key}
            rules={{ validate: (v) => checkField(f, toJson(f, v), required.has(key)) ?? true }}
            render={({ field: rhf }) => <SchemaControl name={key} f={f} required={required.has(key)} rhf={rhf} />}
          />
        ))}

        {notesShown && (
          <FormField
            control={form.control}
            name={NOTES}
            rules={{
              validate: (v) => {
                const s = String(v ?? '').trim();
                if (notesRequired && !s) return 'Required.';
                if (s.length > job.notes_max) return `Use ${job.notes_max.toLocaleString('en-CA')} characters or fewer.`;
                return true;
              },
            }}
            render={({ field: rhf }) => (
              <FormItem>
                <FieldLabel required={notesRequired}>{notesRequired ? 'What do you need?' : 'Notes'}</FieldLabel>
                <FormControl>
                  <Textarea
                    {...rhf}
                    value={String(rhf.value ?? '')}
                    maxLength={job.notes_max}
                    rows={notesRequired ? 6 : 4}
                    placeholder={notesRequired ? 'A few words is enough.' : 'Anything else we should know?'}
                    className="min-h-28 rounded-xl bg-card px-3.5 py-3 text-base md:text-base"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="pt-1">
          <Button type="submit" disabled={disabled || isSubmitting} className="h-12 w-full rounded-xl text-base font-semibold">
            {isSubmitting ? (
              <>
                <Loader2 className="animate-spin" /> Sending
              </>
            ) : disabled ? (
              'Available once approved'
            ) : (
              'Send request'
            )}
          </Button>
        </div>
        </fieldset>
      </form>
    </Form>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required: boolean }) {
  return (
    <FormLabel className="text-[15px] font-medium text-foreground data-[error=true]:text-destructive">
      {children}
      {required ? (
        <span className="text-primary-text" aria-hidden>
          *
        </span>
      ) : (
        <span className="text-sm font-normal text-muted-foreground">(optional)</span>
      )}
      {required && <span className="sr-only">(required)</span>}
    </FormLabel>
  );
}

function SchemaControl({ name, f, required, rhf }: { name: string; f: InputField; required: boolean; rhf: ControllerRenderProps<FieldValues, string> }) {
  const kind = controlFor(f);
  const label = labelFor(name, f);
  let help = f.description;
  if (f.type === 'array' && f.maxItems) help = [help, `Pick up to ${f.maxItems}.`].filter(Boolean).join(' ');

  if (kind === 'boolean') {
    return (
      <FormItem>
        <label className={cn(choiceRow, 'items-start')}>
          <FormControl>
            <Checkbox checked={Boolean(rhf.value)} onCheckedChange={(v) => rhf.onChange(v === true)} onBlur={rhf.onBlur} className="mt-0.5 size-5" />
          </FormControl>
          <span className="grid gap-0.5">
            <span className="font-medium">{label}</span>
            {f.description && <span className="text-sm text-muted-foreground">{f.description}</span>}
          </span>
        </label>
        <FormMessage />
      </FormItem>
    );
  }

  return (
    <FormItem>
      <FieldLabel required={required}>{label}</FieldLabel>
      {help && kind !== 'text' && kind !== 'number' && kind !== 'textarea' && <FormDescription className="-mt-1">{help}</FormDescription>}
      <FormControl>{renderControl(kind, f, rhf, name)}</FormControl>
      {help && (kind === 'text' || kind === 'number' || kind === 'textarea') && <FormDescription>{help}</FormDescription>}
      <FormMessage />
    </FormItem>
  );
}

function renderControl(kind: ReturnType<typeof controlFor>, f: InputField, rhf: ControllerRenderProps<FieldValues, string>, name: string) {
  switch (kind) {
    case 'text': {
      if (f.type !== 'string' || f.enum) return null;
      const t = f as TextField;
      return (
        <Input
          {...rhf}
          value={String(rhf.value ?? '')}
          maxLength={t.maxLength}
          minLength={t.minLength}
          pattern={t.pattern}
          autoComplete={name.includes('postal') ? 'postal-code' : name === 'phone' ? 'tel' : 'off'}
          inputMode={name === 'phone' ? 'tel' : undefined}
          className={field}
        />
      );
    }
    case 'textarea':
      if (f.type !== 'string') return null;
      return <Textarea {...rhf} value={String(rhf.value ?? '')} maxLength={(f as TextField).maxLength} rows={3} className="min-h-24 rounded-xl bg-card px-3.5 py-3 text-base md:text-base" />;
    case 'number':
      if (f.type !== 'number' && f.type !== 'integer') return null;
      return (
        <Input
          {...rhf}
          value={String(rhf.value ?? '')}
          type="number"
          inputMode={f.type === 'integer' ? 'numeric' : 'decimal'}
          step={f.type === 'integer' ? 1 : 'any'}
          min={f.minimum}
          max={f.maximum}
          className={cn(field, 'max-w-[200px] tabular-nums')}
        />
      );
    case 'radio':
      if (f.type !== 'string' || !f.enum) return null;
      return (
        <RadioGroup value={String(rhf.value ?? '')} onValueChange={rhf.onChange} onBlur={rhf.onBlur} className="grid grid-cols-2 gap-2">
          {optionsFor(f).map((o) => (
            <label key={o.value} className={choiceRow}>
              <RadioGroupItem value={o.value} className="size-5" />
              <span>{o.label}</span>
            </label>
          ))}
        </RadioGroup>
      );
    case 'select':
      if (f.type !== 'string' || !f.enum) return null;
      return (
        <Select value={String(rhf.value ?? '') || undefined} onValueChange={rhf.onChange}>
          <SelectTrigger onBlur={rhf.onBlur} className="h-12! w-full rounded-xl bg-card px-3.5 text-base">
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {optionsFor(f).map((o) => (
              <SelectItem key={o.value} value={o.value} className="min-h-11 rounded-lg text-base">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case 'multi': {
      if (f.type !== 'array') return null;
      const value = (rhf.value as string[]) ?? [];
      const full = f.maxItems !== undefined && value.length >= f.maxItems;
      return (
        <div role="group" className="grid gap-2">
          {optionsFor(f).map((o) => {
            const on = value.includes(o.value);
            return (
              <label key={o.value} className={cn(choiceRow, !on && full && 'opacity-50')}>
                <Checkbox
                  checked={on}
                  disabled={!on && full}
                  onBlur={rhf.onBlur}
                  onCheckedChange={(c) => rhf.onChange(c ? [...value, o.value] : value.filter((v) => v !== o.value))}
                  className="size-5"
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      );
    }
  }
}

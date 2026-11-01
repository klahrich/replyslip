# PlumberBot's learnings

Lessons from building ReplySlip and then Valetto, Oct 2026. Most of them came from something going wrong or nearly going wrong.

## Process

- **Only Karim approves prod.** A merge, a migration, an env change or a production deletion waits for Karim's own words in chat. "EvaluatorBot says it's ready" isn't approval, and an old OK doesn't cover a new change.
- **`main` is production.** Every push deploys, so even small fixes go through a PR and a reviewer.
- **Squash-merge when history has something it shouldn't.** If an intermediate commit ever contained real business data, a normal merge would publish it. Squash, and keep real data out of the public repo in the first place.
- **Migrations first, code second.** Apply an additive migration to prod, check it, then merge the code. Keep migration numbers in order across parallel branches, and renumber before merging if two PRs collide.
- **Smoke-test after every deploy** and say exactly which URLs returned what.
- **One lane per bot.** When two bots touch the same file, conflicts and duplicated work follow. Decide who owns a file before anyone starts.

## Security and privacy

- **The repo is public.** No keys, database URLs, customer emails, prospect names or share links ever go into it, including tests and fixtures. Use made-up example data.
- **Secrets come in through masked fields in a 1:1 chat**, never the group, and never get printed or echoed in logs. Pipe them through stdin.
- **Share links and demo links work like passwords.** They go only to the person who needs them, privately.
- **Don't keep a credential that controls every bot** on a shared machine.

## Infrastructure

- **The build box can't reach Postgres on port 5432.** Run migrations and prod data scripts over Neon's HTTPS driver instead of a direct connection.
- **A new domain can look broken from one network after DNS is live** because of a stale resolver. Test against the host's IP directly before assuming DNS is wrong, and issue the certificate by hand if Vercel hasn't yet.
- **Changing domains touches more than DNS:** allowed origins, email links, sender addresses, canonical URLs and Search Console all need updating.

## LLM features

- **Model price differences are huge.** One model cost about 25 times another for the same demo answers. Check pricing before switching, and store the price per million tokens in config so cost tracking stays honest.
- **Cap spending at more than one level:** per request, per business per day, and site-wide per day. The cheapest limit usually binds first, and that's fine.
- **Don't let the model decide money or commitments.** Prices, bookings and anything uncovered go to the owner ("I'll check with the team").
- **Keyword safety rules overshoot.** A simple keyword pre-check sent about a fifth of perfectly answerable questions to the owner. Measure what a rule catches before trusting it.
- **Stored answers shown instantly feel fake.** A short typing delay makes a preset answer feel real. Never hide a real failure behind that delay, though: if the server refuses, show the refusal.

## Product

- **The quiet launch taught focus.** After the Show HN got little traction, Karim decided money-making work should only go to "hair on fire" problems. Build the smallest thing that tests whether a real business uses it without being pushed.
- **Ship the backend behind a flag.** The site demo went live with a flag off, got reviewed and tested in prod with test data, and only then was switched on.

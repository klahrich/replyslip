/**
 * Live check of mixed-question handoffs on the site assistant: a few synthetic questions against the sample business
 * in tests/fixtures (made-up data), through the real answer function and model. Paid model calls, so it does nothing
 * without --yes; without it, it prints the worst-case cost and exits.
 *
 *   npx tsx scripts/site-partial-handoff-eval.ts          # cost estimate only, no call
 *   npx tsx scripts/site-partial-handoff-eval.ts --yes    # runs the cases (needs SITE_LLM_API_KEY)
 *
 * Never prints the key.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerVisitorMessage, buildPromptInput, SITE_INSTRUCTIONS } from '@/lib/site-assistant/answer';
import { costMicroUsd, estimateInputTokens, siteLlmConfig } from '@/lib/site-assistant/config';
import { parseContextMarkdown } from '@/lib/site-assistant/context';
import { loadEnvFile } from './site-demo-env';

type Expect = 'partial' | 'full_handoff' | 'answered';

const CASES: { question: string; expect: Expect }[] = [
  { question: 'Do you build interlock patios, and how do I get a quote?', expect: 'partial' },
  { question: 'Do you do snow removal, and are you available this weekend?', expect: 'partial' },
  { question: 'What areas do you serve, and how much is a walkway?', expect: 'partial' },
  { question: 'Do you offer a warranty? Also, can I book a visit for Tuesday?', expect: 'partial' },
  { question: 'Faites-vous les patios en pavé uni, et comment obtenir une soumission ?', expect: 'partial' },
  { question: 'How much is a new driveway?', expect: 'full_handoff' },
  { question: 'Can you come next Monday?', expect: 'full_handoff' },
  { question: 'What areas do you serve?', expect: 'answered' },
];

const PART_LINE = /\n\n(For the rest, I'll check with the team|Pour le reste, je vérifie avec l’équipe)/;

async function main() {
  loadEnvFile();
  const file = join(process.cwd(), 'tests', 'fixtures', 'site-demo', 'context', 'maple-ridge-landscaping.md');
  const { contextMd } = parseContextMarkdown(readFileSync(file, 'utf8'));
  const businessName = 'Maple Ridge Landscaping';
  const config = siteLlmConfig();

  let worst = 0;
  for (const c of CASES) {
    const prompt = buildPromptInput({ businessName, contextMd, history: [], visitorMessage: c.question });
    worst += costMicroUsd(estimateInputTokens(SITE_INSTRUCTIONS.length + prompt.length + 1_500), config.maxOutputTokens, config);
  }
  console.log(`${CASES.length} calls on ${config.model}, worst case $${(worst / 1e6).toFixed(4)} (at $${config.priceInPerM}/M in, $${config.priceOutPerM}/M out).`);
  if (!process.argv.includes('--yes')) {
    console.log('No call made. Re-run with --yes to spend it.');
    return;
  }
  if (!config.apiKey) throw new Error('SITE_LLM_API_KEY is not set.');

  let spent = 0;
  let pass = 0;
  for (const c of CASES) {
    const r = await answerVisitorMessage({ businessName, contextMd, history: [], visitorMessage: c.question }, { config });
    spent += r.costMicroUsd;
    const got: Expect = r.status === 'answered' ? 'answered' : r.status === 'needs_owner' && PART_LINE.test(r.body) ? 'partial' : 'full_handoff';
    if (got === c.expect) pass += 1;
    console.log(`\n[${got === c.expect ? 'ok' : 'MISS'}] expected ${c.expect}, got ${got} (${r.decidedBy})\nQ: ${c.question}\nA: ${r.body}`);
  }
  console.log(`\n${pass}/${CASES.length} as expected. Spent $${(spent / 1e6).toFixed(4)}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

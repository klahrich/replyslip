import { ONE_LINER } from '@/lib/constants';

export default function HomePage() {
  return (
    <main>
      <h1>ReplySlip</h1>
      <p>{ONE_LINER}</p>
      <p>
        Agents: start at <a href="/llms.txt">/llms.txt</a>.
      </p>
    </main>
  );
}

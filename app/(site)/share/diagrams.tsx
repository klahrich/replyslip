/** Two agents, one private handoff. Recolored from the field guide onto Valetto's sage and paper. */
export function HeroArt() {
  return (
    <figure className="sg-hero-art">
      <svg viewBox="0 0 460 360" role="img" aria-labelledby="hero-title hero-desc">
        <title id="hero-title">Two separate agents, connected through Valetto</title>
        <desc id="hero-desc">
          The recipient&apos;s externally hosted agent sends only allowed tasks through Valetto to the owner&apos;s running
          agent. Results return to that recipient. Their workspaces stay separate.
        </desc>
        <defs>
          <marker id="sg-arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10" fill="none" stroke="#3d5c45" strokeWidth="2" />
          </marker>
        </defs>
        <rect x="27" y="23" width="406" height="105" rx="18" fill="#fff" stroke="#c9d5cc" />
        <rect x="48" y="46" width="56" height="56" rx="15" fill="#e7f2ea" />
        <path d="M62 76h28M69 64v24M83 64v24" stroke="#3d5c45" strokeWidth="3" fill="none" />
        <text x="123" y="65" fontSize="11" fill="#4c6268" letterSpacing="1.2">
          RECIPIENT
        </text>
        <text x="123" y="89" fontSize="19" fontWeight="650" fill="#152e36">
          Their external agent
        </text>
        <text x="123" y="111" fontSize="12" fill="#4c6268">
          Stays on their own host
        </text>
        <path d="M121 130v92" stroke="#3d5c45" strokeWidth="2" markerEnd="url(#sg-arr)" />
        <path d="M339 224v-90" stroke="#3d5c45" strokeWidth="2" markerEnd="url(#sg-arr)" />
        <rect x="146" y="149" width="166" height="53" rx="26" fill="#3d5c45" />
        <text x="229" y="171" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="650">
          Valetto
        </text>
        <text x="229" y="189" textAnchor="middle" fill="#e4f0e6" fontSize="10">
          Checks allowed tasks and limits
        </text>
        <text x="38" y="176" fill="#3d5c45" fontSize="11">
          Task
        </text>
        <text x="357" y="176" fill="#3d5c45" fontSize="11">
          Result*
        </text>
        <rect x="27" y="230" width="406" height="105" rx="18" fill="#1c2420" />
        <rect x="48" y="252" width="56" height="56" rx="15" fill="#345445" />
        <path d="m63 280 10 10 17-21" stroke="#d6eccf" strokeWidth="3" fill="none" />
        <text x="123" y="270" fontSize="11" fill="#c8d9cd" letterSpacing="1.2">
          OWNER
        </text>
        <text x="123" y="295" fontSize="19" fontWeight="650" fill="#fff">
          Your running agent
        </text>
        <text x="123" y="317" fontSize="12" fill="#c8d9cd">
          Your workspace stays separate
        </text>
      </svg>
      <figcaption>Their agent checks back for the result. Valetto does not run their agent.</figcaption>
    </figure>
  );
}

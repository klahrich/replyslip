import { REQUESTED_BY_APP, showCombinedWarning, type ExtraScopesOffer } from './consent-logic';

/**
 * Optional extra permissions on the Allow page (docs/design/mcp-oauth.md §5.10): one unticked checkbox per offered
 * scope with what it allows, the server's warnings, and how long the connection then lasts. Allow works either way.
 */
export function ExtraScopes({
  offer,
  ticked,
  onChange,
  disabled,
  id,
}: {
  offer: ExtraScopesOffer;
  ticked: readonly string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  id: string;
}) {
  const toggle = (name: string, on: boolean) =>
    onChange(offer.items.map((i) => i.name).filter((n) => (n === name ? on : ticked.includes(n))));
  return (
    <section className="oc-extra" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`}>Extra permissions (optional)</h2>
      {offer.warning ? (
        <p className={offer.urgent ? 'oc-warn oc-warn-strong' : 'oc-warn'}>{offer.warning}</p>
      ) : null}
      {offer.items.map((item) => {
        const on = ticked.includes(item.name);
        const boxId = `${id}-${item.name.replace(/[^a-z0-9]/gi, '-')}`;
        return (
          <div key={item.name} className={`oc-choice oc-extra-scope${on ? ' is-on' : ''}`}>
            <label className="oc-check">
              <input
                type="checkbox"
                name="grant_scopes"
                value={item.name}
                checked={on}
                disabled={disabled}
                onChange={(e) => toggle(item.name, e.target.checked)}
                aria-describedby={`${boxId}-allows`}
              />
              <span>
                {item.title}
                {item.requestedByClient ? <span className="oc-extra-asked">{REQUESTED_BY_APP}</span> : null}
              </span>
            </label>
            <ul id={`${boxId}-allows`} className="oc-list is-extra">
              {item.allows.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        );
      })}
      {showCombinedWarning(offer, ticked) ? (
        <p className="oc-warn oc-warn-strong" role="alert">
          {offer.combinedWarning}
        </p>
      ) : null}
      {offer.daysNote ? <p className="oc-note">{offer.daysNote}</p> : null}
    </section>
  );
}

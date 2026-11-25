import type { TaskTerms } from '@porden/contracts';
export function Terms({ terms }: { terms: TaskTerms }) {
  return (
    <>
      <h3>{terms.goal}</h3>
      {terms.budget && (
        <p>
          <strong>Budget:</strong> {terms.budget.currency}{' '}
          {(terms.budget.amountMinor / 100).toFixed(2)}
        </p>
      )}
      <h4>Constraints</h4>
      {terms.constraints.length ? (
        <ul>
          {terms.constraints.map((value, index) => (
            <li key={index}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>No additional constraints.</p>
      )}
      <h4>Acceptance criteria</h4>
      <ul>
        {terms.acceptanceCriteria.map((value, index) => (
          <li key={index}>{value}</li>
        ))}
      </ul>
      {terms.completedWork?.length ? (
        <>
          <h4>Completed work</h4>
          <ul>
            {terms.completedWork.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </>
      ) : null}
      {terms.remainingWork?.length ? (
        <>
          <h4>Remaining work</h4>
          <ul>
            {terms.remainingWork.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </>
      ) : null}
      {terms.openQuestions?.length ? (
        <>
          <h4>Open questions</h4>
          <ul>
            {terms.openQuestions.map((value, index) => (
              <li key={index}>{value}</li>
            ))}
          </ul>
        </>
      ) : null}
      {terms.nextStep && (
        <p>
          <strong>Next step:</strong> {terms.nextStep}
        </p>
      )}
      <h4>Provided evidence</h4>
      <p className="muted">
        References supplied by the sender. Porden does not verify their truth.
      </p>
      {terms.evidence?.length ? (
        terms.evidence.map((reference, index) => {
          const claim = 'claim' in reference ? reference.claim : undefined;
          const source = 'source' in reference ? reference.source : undefined;
          const sourceUrl =
            source?.url ?? ('sourceUrl' in reference ? reference.sourceUrl : undefined);
          const locator =
            source?.locator ?? ('locator' in reference ? reference.locator : undefined);
          const excerpt =
            source?.excerpt ?? ('excerpt' in reference ? reference.excerpt : undefined);
          return (
            <article className="evidence" key={index}>
              {claim && (
                <p>
                  <strong>{claim}</strong>
                </p>
              )}
              {sourceUrl && (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open source: {sourceUrl}
                </a>
              )}
              {locator && <p>Location: {locator}</p>}
              {excerpt && <blockquote>{excerpt}</blockquote>}
            </article>
          );
        })
      ) : (
        <p>No evidence references supplied.</p>
      )}
    </>
  );
}

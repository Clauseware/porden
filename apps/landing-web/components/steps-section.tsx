import type { ReactNode } from 'react';
import { CopyButton } from './copy-button';
import { CheckIcon } from './icons';
import { Illo, type IlloName } from './illo';

type Step = {
  num: string;
  title: string;
  text: string;
  checks: [string, string];
  file: string;
  copyText: string;
  copyLabel: string;
  code: ReactNode;
  illo: IlloName;
};

const createText = `import { createHandoffClient } from '@porden/sdk';

// Server-side only. Keep the token out of browser bundles.
const porden = createHandoffClient({
  baseUrl: 'https://porden.example/api/v2',
  token: process.env.PORDEN_INTEGRATION_TOKEN,
});

const created = await porden.createHandoff({
  requestId: crypto.randomUUID(),
  receiverOrganizationId,
  terms: {
    goal: 'Purchase replacement supplies',
    constraints: ['Do not exceed the authorized budget'],
    acceptanceCriteria: ['Provide a purchase receipt'],
    budget: { amountMinor: 50000, currency: 'USD' },
  },
});`;

const checkText = `// Poll the server's state. Do not assume an approval.
const scope = await porden.getAuthorization(created.handoff.id, 1);

if (scope.eligible) {
  // The exact version is authorized.
}`;

const acceptText = `// Receiver side. The receipt records acceptance,
// not that the work is done.
await porden.acceptHandoff(created.handoff.id, {
  requestId: crypto.randomUUID(),
  version: 1,
});`;

const steps: Step[] = [
  {
    num: '01',
    title: 'Create the handoff',
    text: 'The sender gives the receiver a goal, constraints, acceptance criteria and a budget. Those terms become a locked version.',
    checks: ['Server-side SDK', 'Retries reuse the request ID'],
    file: 'create-handoff.ts',
    copyText: createText,
    copyLabel: 'Copy code',
    code: (
      <code>
        <span className="k">import</span> {'{ createHandoffClient }'}{' '}
        <span className="k">from</span> {"'@porden/sdk'"};{'\n\n'}
        <span className="c">{'// Server-side only. Keep the token out of browser bundles.'}</span>
        {'\nconst porden = createHandoffClient({\n  baseUrl: '}
        {"'https://porden.example/api/v2'"}
        {',\n  token: process.env.PORDEN_INTEGRATION_TOKEN,\n});\n\n'}
        <span className="k">const</span> created = <span className="k">await</span>{' '}
        {
          'porden.createHandoff({\n  requestId: crypto.randomUUID(),\n  receiverOrganizationId,\n  terms: {\n    goal: '
        }
        {"'Purchase replacement supplies'"}
        {',\n    constraints: ['}
        {"'Do not exceed the authorized budget'"}
        {'],\n    acceptanceCriteria: ['}
        {"'Provide a purchase receipt'"}
        {'],\n    budget: { amountMinor: 50000, currency: '}
        {"'USD'"}
        {' },\n  },\n});'}
      </code>
    ),
    illo: 'locked-version',
  },
  {
    num: '02',
    title: 'Wait for approval when required',
    text: 'If the sender requires it, a human approver reviews the exact terms in the dashboard. Your integration reads the server’s authorization state instead of assuming an approval.',
    checks: ['Approval is the sender’s policy', 'Reads never create receipts'],
    file: 'check-authorization.ts',
    copyText: checkText,
    copyLabel: 'Copy code',
    code: (
      <code>
        <span className="c">{"// Poll the server's state. Do not assume an approval."}</span>
        {'\n'}
        <span className="k">const</span> scope = <span className="k">await</span>{' '}
        {'porden.getAuthorization(created.handoff.id, 1);\n\n'}
        <span className="k">if</span> {'(scope.eligible) {\n  '}
        <span className="c">{'// The exact version is authorized.'}</span>
        {'\n}'}
      </code>
    ),
    illo: 'handoff-steps',
  },
  {
    num: '03',
    title: 'The receiver accepts',
    text: 'The receiving organization accepts the exact approved version, and the acceptance is recorded with a signed receipt. The receipt means accepted, not resolved.',
    checks: ['Acceptance comes before execution', 'A revision creates a new version'],
    file: 'accept-handoff.ts',
    copyText: acceptText,
    copyLabel: 'Copy code',
    code: (
      <code>
        <span className="c">{'// Receiver side. The receipt records acceptance,'}</span>
        {'\n'}
        <span className="c">{'// not that the work is done.'}</span>
        {'\n'}
        <span className="k">await</span>{' '}
        {
          'porden.acceptHandoff(created.handoff.id, {\n  requestId: crypto.randomUUID(),\n  version: 1,\n});'
        }
      </code>
    ),
    illo: 'receiver',
  },
];

export function StepsSection() {
  return (
    <section className="section wrap" id="how" aria-labelledby="how-title">
      <div className="head">
        <h2 id="how-title">Hand off a task in three steps</h2>
        <p className="lead">
          A handoff carries exact terms from one organization to another. Every recorded step has a
          signed receipt.
        </p>
      </div>
      <ol className="steps">
        {steps.map((s) => (
          <li className="step" key={s.num}>
            <div className="step__copy">
              <p className="step__num" aria-hidden="true">
                {s.num}
              </p>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
              <ul className="checks">
                {s.checks.map((c) => (
                  <li key={c}>
                    <CheckIcon />
                    {c}
                  </li>
                ))}
              </ul>
              <div className="code">
                <div className="code__bar">
                  <span>{s.file}</span>
                  <CopyButton text={s.copyText} label={s.copyLabel} />
                </div>
                <pre>{s.code}</pre>
              </div>
            </div>
            <div className="step__well well well--inset">
              <Illo name={s.illo} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

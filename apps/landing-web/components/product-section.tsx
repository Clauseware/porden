import type { ReactNode } from 'react';
import { CopyButton } from './copy-button';
import {
  ApprovalIcon,
  ArrowIcon,
  CheckCircleIcon,
  HistoryIcon,
  ReceiptIcon,
  VersionsIcon,
} from './icons';
import { Illo, type IlloName } from './illo';
import { Tabs, type TabItem } from './tabs';

type Product = {
  id: string;
  name: string;
  note: string;
  icon: ReactNode;
  illo: IlloName;
  title: string;
  text: string;
  more: string;
};

const products: Product[] = [
  {
    id: 'versions',
    name: 'Versions',
    note: 'Exact terms, locked',
    icon: <VersionsIcon />,
    illo: 'versions',
    title: 'Terms you can point to by version',
    text: 'Each version holds the goal, constraints, acceptance criteria and budget as they were sent, and it never changes. A revision creates a new version, and the original stays on record.',
    more: 'See how versions work',
  },
  {
    id: 'approval',
    name: 'Approval',
    note: 'A person, when required',
    icon: <ApprovalIcon />,
    illo: 'approval',
    title: 'A person approves the exact terms, when the sender requires it',
    text: 'Human approval is the sender’s policy. When it is on, version 1 stays a draft until an approver reviews and approves it in the dashboard. When it is off, the version is recorded as approved at creation.',
    more: 'See how approval works',
  },
  {
    id: 'acceptance',
    name: 'Acceptance',
    note: 'The receiver confirms',
    icon: <CheckCircleIcon />,
    illo: 'acceptance',
    title: 'The receiver accepts the exact version',
    text: 'The receiving organization accepts an approved version. Acceptance is separate from approval, and it is required before execution or completion.',
    more: 'See how acceptance works',
  },
  {
    id: 'receipts',
    name: 'Receipts',
    note: 'Signed, not resolved',
    icon: <ReceiptIcon />,
    illo: 'receipts',
    title: 'A signed receipt for each recorded action',
    text: 'A receipt names who acted, the action, the time, the exact version and a digest of its terms. It means the action was accepted, not that the work is resolved.',
    more: 'See how receipts work',
  },
  {
    id: 'history',
    name: 'History',
    note: 'One shared record',
    icon: <HistoryIcon />,
    illo: 'history',
    title: 'One history for the whole workflow',
    text: 'Linked handoffs appear in one chronological workflow history. A revision, its decision and a return handoff each keep their own versions and receipts.',
    more: 'See the history',
  },
];

const items: TabItem[] = products.map((p) => ({
  id: p.id,
  name: p.name,
  note: p.note,
  icon: p.icon,
  panel: (
    <>
      <div className="panel__copy">
        <h3>{p.title}</h3>
        <p>{p.text}</p>
        <a className="more" href="#how">
          {p.more}
          <ArrowIcon />
        </a>
      </div>
      <Illo name={p.illo} />
    </>
  ),
}));

const installText = "import { createHandoffClient } from '@porden/sdk';";

const install = (
  <div className="install">
    <p>A typed SDK for your server</p>
    <div className="code code--line">
      <pre id="code-install">
        <code>
          <span className="k">import</span> {'{ createHandoffClient }'}{' '}
          <span className="k">from</span> {"'@porden/sdk'"};
        </code>
      </pre>
      <CopyButton text={installText} label="Copy import" />
    </div>
  </div>
);

export function ProductSection() {
  return (
    <section className="section wrap" id="product" aria-labelledby="product-title">
      <div className="head">
        <h2 id="product-title">Everything a handoff carries</h2>
        <p className="lead">
          Five parts of one handoff, kept in one record that both organizations can see.
        </p>
      </div>
      <Tabs items={items} install={install} />
    </section>
  );
}

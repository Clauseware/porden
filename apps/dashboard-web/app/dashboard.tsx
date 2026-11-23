'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  createHandoffClient,
  getErrorMessage,
  HandoffWriteUnknown,
  PordenError,
} from '@porden/sdk';
import {
  HandoffStatus,
  type Principal,
  type HandoffDetail,
  type HandoffMutation,
  type HandoffList,
  type Organization,
} from '@porden/contracts';
import type { z } from 'zod';
import { Terms } from './terms';

const client = createHandoffClient();
type OrganizationValue = z.infer<typeof Organization>;
export default function Dashboard({ initialId }: { initialId?: string }) {
  const [principal, setPrincipal] = useState<Principal>();
  const [organizations, setOrganizations] = useState<OrganizationValue[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [tab, setTab] = useState<'handoffs' | 'approvals'>('handoffs');
  const [list, setList] = useState<z.infer<typeof HandoffList>>(),
    [approvals, setApprovals] = useState<HandoffDetail[]>([]);
  const [loadedDetail, setDetail] = useState<HandoffDetail>(),
    [history, setHistory] = useState<HandoffDetail[]>([]);
  const [status, setStatus] = useState(''),
    [direction, setDirection] = useState(''),
    [page, setPage] = useState(1);
  const [pending, setPending] = useState<string>(),
    [reviewed, setReviewed] = useState('');
  const canApprove = principal?.kind === 'human' && principal.role === 'approver';
  const detail = loadedDetail?.id === initialId ? loadedDetail : undefined;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await client.session(),
          directory = await client.organizations();
        if (active) {
          setPrincipal(session.principal);
          setOrganizations(directory.items);
          setPending(sessionStorage.getItem(`porden-pending:${session.principal.id}`) || undefined);
        }
      } catch (cause) {
        if (active && !(cause instanceof PordenError && cause.status === 401))
          setError(getErrorMessage(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!principal) return;
    let active = true;
    const refresh = async () => {
      try {
        const caller = (await client.session()).principal;
        if (
          caller.id !== principal.id ||
          caller.organizationId !== principal.organizationId ||
          caller.role !== principal.role
        )
          throw new PordenError('SESSION_CHANGED', 401);
        const result = await client.listHandoffs({
          page,
          limit: 10,
          ...(status ? { status: HandoffStatus.parse(status) } : {}),
          ...(direction === 'sent' || direction === 'received' ? { direction } : {}),
        });
        if (active) setList(result);
        if (canApprove) {
          const inbox = await client.listPendingApprovals();
          if (active) setApprovals(inbox.items);
        }
        if (initialId) {
          const row = await client.getHandoff(initialId);
          const workflow = await client.getWorkflowHistory(row.workflowId);
          if (active) {
            setDetail(row);
            setHistory(workflow.items);
          }
        }
      } catch (cause) {
        if (active) {
          setError(getErrorMessage(cause));
          setList(undefined);
          setApprovals([]);
          setDetail(undefined);
          setHistory([]);
          if (cause instanceof PordenError && cause.status === 401) {
            setPrincipal(undefined);
            setPending(undefined);
            setNotice('');
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [principal, canApprove, page, status, direction, initialId]);

  async function signIn(form: FormData) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const session = await client.signIn({
        login: String(form.get('login')),
        password: String(form.get('password')),
      });
      const directory = await client.organizations();
      setPrincipal(session.principal);
      setOrganizations(directory.items);
      setPending(sessionStorage.getItem(`porden-pending:${session.principal.id}`) || undefined);
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  function clearPending() {
    if (principal) sessionStorage.removeItem(`porden-pending:${principal.id}`);
    setPending(undefined);
  }
  async function perform(action: (requestId: string) => Promise<z.infer<typeof HandoffMutation>>) {
    if (!principal || pending) return;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setError('');
    setNotice('');
    setPending(requestId);
    sessionStorage.setItem(`porden-pending:${principal.id}`, requestId);
    try {
      const caller = (await client.session()).principal;
      if (
        caller.id !== principal.id ||
        caller.organizationId !== principal.organizationId ||
        caller.role !== principal.role
      )
        throw new PordenError('SESSION_CHANGED', 401);
      const result = await action(requestId);
      clearPending();
      setDetail(result.handoff);
      setNotice(
        `Saved ${result.receipt.action} for version ${result.receipt.version}. Receipt ${result.receipt.receiptId}.`,
      );
      setReviewed('');
    } catch (cause) {
      if (!(cause instanceof HandoffWriteUnknown)) clearPending();
      setError(getErrorMessage(cause));
      if (cause instanceof PordenError && cause.status === 401) {
        setPrincipal(undefined);
        setDetail(undefined);
        setHistory([]);
      }
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!pending) return;
    setBusy(true);
    setError('');
    try {
      const result = await client.reconcileOperation(pending);
      setDetail(result.handoff);
      clearPending();
      setNotice(`Recovered ${result.receipt.action}. Receipt ${result.receipt.receiptId}.`);
    } catch (cause) {
      setError(
        cause instanceof PordenError && cause.status === 404
          ? 'No committed receipt is visible yet. The operation remains unknown. Check again before another submission.'
          : getErrorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setError('');
    try {
      await client.signOut();
      setPrincipal(undefined);
      setDetail(undefined);
      setHistory([]);
      setList(undefined);
      setApprovals([]);
      setPending(undefined);
      setReviewed('');
      setNotice('');
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const revision = detail?.revisions.find((item) => item.id === detail.pendingRevisionId);
  const current = detail?.versions.find((item) => item.version === detail.currentVersion);
  const proposed = detail?.versions.find((item) => item.version === revision?.proposedVersion);
  const reviewKey = detail
    ? `${detail.id}:${revision?.proposedVersion || detail.currentVersion}:${revision?.id || 'original'}`
    : '';
  const ownSender = principal?.organizationId === detail?.senderOrganizationId;
  const organizationName = organizations.find(
    (item) => item.id === principal?.organizationId,
  )?.name;
  return (
    <>
      <header>
        <Link className="brand" href="/">
          porden
        </Link>
        <span>Handoffs with accountable decisions</span>
        {principal && (
          <button disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        )}
      </header>
      <h1>{detail ? 'Handoff detail' : 'Organization handoffs'}</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {pending && (
        <section className="notice" aria-label="Uncertain operation">
          <h2>Check the existing operation</h2>
          <p>Operation {pending}. New decisions are paused until its outcome is known.</p>
          <button disabled={busy} onClick={() => void reconcile()}>
            Check operation receipt
          </button>
        </section>
      )}
      {!principal ? (
        loading ? (
          <p role="status">Checking your session…</p>
        ) : (
          <form action={signIn} className="panel">
            <h2>Sign in to Porden</h2>
            <label>
              Login
              <input name="login" autoComplete="username" required maxLength={200} />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
        )
      ) : (
        <>
          <p>
            Organization: <strong>{organizationName}</strong> · {principal.name} · {principal.role}
          </p>
          <nav aria-label="Dashboard">
            <Link href="/">All handoffs</Link>
            <button aria-pressed={tab === 'handoffs'} onClick={() => setTab('handoffs')}>
              Handoffs
            </button>
            {canApprove && (
              <button aria-pressed={tab === 'approvals'} onClick={() => setTab('approvals')}>
                Approvals ({approvals.length})
              </button>
            )}
          </nav>
          {loading && <p role="status">Loading handoffs…</p>}
          {!initialId && tab === 'handoffs' && (
            <>
              <div className="filters">
                <label>
                  Status
                  <select
                    aria-label="Status"
                    value={status}
                    onChange={(event) => {
                      setStatus(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">All statuses</option>
                    {HandoffStatus.options.map((value) => (
                      <option key={value} value={value}>
                        {value.replaceAll('_', ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Direction
                  <select
                    aria-label="Direction"
                    value={direction}
                    onChange={(event) => {
                      setDirection(event.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Sent and received</option>
                    <option value="sent">Sent</option>
                    <option value="received">Received</option>
                  </select>
                </label>
              </div>
              {list && (
                <>
                  <div className="table-scroll">
                    <table>
                      <caption>Handoffs visible to your organization</caption>
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Direction / counterparty</th>
                          <th>Status</th>
                          <th>Version</th>
                          <th>Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {list.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <Link href={`/handoffs/${item.id}`}>{item.goal}</Link>
                            </td>
                            <td>
                              {item.senderOrganizationId === principal.organizationId
                                ? `Sent to ${item.receiverName}`
                                : `Received from ${item.senderName}`}
                            </td>
                            <td>{item.status.replaceAll('_', ' ')}</td>
                            <td>{item.currentVersion}</td>
                            <td>{new Date(item.updatedAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {list.total === 0 && <p>No handoffs match these filters.</p>}
                  <div className="actions">
                    <button disabled={page === 1 || loading} onClick={() => setPage(page - 1)}>
                      Previous page
                    </button>
                    <span>
                      Page {page} · {list.total} handoffs
                    </span>
                    <button
                      disabled={page * list.limit >= list.total || loading}
                      onClick={() => setPage(page + 1)}
                    >
                      Next page
                    </button>
                  </div>
                </>
              )}
            </>
          )}
          {tab === 'approvals' && canApprove && (
            <section>
              <h2>Approval inbox</h2>
              <p>Only requests your organization is authorized to decide appear here.</p>
              {!loading && !approvals.length && <p>No pending approvals.</p>}
              {approvals.map((item) => (
                <article key={item.id} className="panel">
                  <Link href={`/handoffs/${item.id}`}>{item.goal}</Link>
                  <p>
                    {item.pendingRevisionId
                      ? 'Changed terms awaiting authorization'
                      : 'Original terms awaiting authorization'}{' '}
                    · {item.senderName} → {item.receiverName}
                  </p>
                </article>
              ))}
            </section>
          )}
          {detail && current && (
            <>
              <section className="panel">
                <h2>
                  {detail.senderName} → {detail.receiverName}
                </h2>
                <p>
                  Handoff <code>{detail.id}</code>
                </p>
                <p>
                  Status: <strong>{detail.status.replaceAll('_', ' ')}</strong> · Current version{' '}
                  {detail.currentVersion} · Approved version {detail.approvedVersion ?? 'none'} ·
                  Accepted version {detail.acceptedVersion ?? 'none'}
                </p>
                <p>
                  {detail.status === 'awaiting_approval'
                    ? 'Execution authorization is blocked while the revision is pending.'
                    : detail.status === 'accepted'
                      ? 'The accepted current version is authorized at the Porden API boundary.'
                      : 'This handoff is not currently eligible for execution.'}
                </p>
              </section>
              <div className="comparison">
                <section className="panel">
                  <h2>
                    {proposed ? 'Previously authorized terms' : 'Current terms'} · version{' '}
                    {current.version}
                  </h2>
                  <Terms terms={current.terms} />
                  <p className="digest">Digest: {current.termsSha256}</p>
                </section>
                {proposed && revision && (
                  <section className="panel">
                    <h2>Proposed terms · version {proposed.version}</h2>
                    <p>Reason: {revision.reason}</p>
                    <p>
                      Proposed by {revision.proposerId} at{' '}
                      {new Date(revision.createdAt).toLocaleString()}
                    </p>
                    <Terms terms={proposed.terms} />
                    <p className="digest">Digest: {proposed.termsSha256}</p>
                  </section>
                )}
              </div>
              {ownSender && canApprove && (detail.status === 'draft' || revision) && (
                <section className="panel">
                  <h2>Decide exact terms</h2>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={reviewed === reviewKey}
                      onChange={(event) => setReviewed(event.target.checked ? reviewKey : '')}
                    />
                    I reviewed version {revision?.proposedVersion || detail.currentVersion}, its
                    constraints, acceptance criteria and evidence.
                  </label>
                  <div className="actions">
                    <button
                      disabled={busy || Boolean(pending) || reviewed !== reviewKey}
                      onClick={() =>
                        void perform((requestId) =>
                          revision
                            ? client.decideRevision(detail.id, revision.id, {
                                requestId,
                                version: revision.proposedVersion,
                                decision: 'approved',
                              })
                            : client.approveHandoff(detail.id, {
                                requestId,
                                version: detail.currentVersion,
                              }),
                        )
                      }
                    >
                      Approve version {revision?.proposedVersion || detail.currentVersion}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy || Boolean(pending) || reviewed !== reviewKey}
                      onClick={() =>
                        void perform((requestId) =>
                          revision
                            ? client.decideRevision(detail.id, revision.id, {
                                requestId,
                                version: revision.proposedVersion,
                                decision: 'rejected',
                              })
                            : client.cancelHandoff(detail.id, {
                                requestId,
                                version: detail.currentVersion,
                              }),
                        )
                      }
                    >
                      {revision ? 'Reject revision' : 'Decline original request'}
                    </button>
                  </div>
                </section>
              )}
              {ownSender &&
                ['draft', 'approved', 'accepted', 'awaiting_approval'].includes(detail.status) && (
                  <button
                    className="secondary"
                    disabled={busy || Boolean(pending)}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Cancel this handoff and block further execution authorization?',
                        )
                      )
                        void perform((requestId) =>
                          client.cancelHandoff(detail.id, {
                            requestId,
                            version: detail.currentVersion,
                          }),
                        );
                    }}
                  >
                    Cancel handoff
                  </button>
                )}
              <section className="panel">
                <h2>Version history</h2>
                {detail.versions.map((item) => (
                  <details key={item.version}>
                    <summary>
                      Version {item.version} · {new Date(item.createdAt).toLocaleString()} ·{' '}
                      {item.createdBy}
                    </summary>
                    <Terms terms={item.terms} />
                    <p className="digest">Digest: {item.termsSha256}</p>
                  </details>
                ))}
                {detail.revisions.map((item) => (
                  <p key={item.id}>
                    Revision {item.proposedVersion}: {item.status}
                    {item.decidedBy
                      ? ` by ${item.decidedBy} at ${new Date(item.decidedAt!).toLocaleString()}`
                      : ''}
                  </p>
                ))}
              </section>
              <section className="panel">
                <h2>Receipts and audit history</h2>
                <ol>
                  {detail.receipts.map((receipt) => (
                    <li key={receipt.receiptId}>
                      <strong>{receipt.action.replaceAll('_', ' ')}</strong> · version{' '}
                      {receipt.version} · {new Date(receipt.occurredAt).toLocaleString()}
                      <p>
                        {receipt.principalKind} {receipt.principalId} · organization{' '}
                        {receipt.organizationId}
                      </p>
                      {receipt.note && <p>{receipt.note}</p>}
                      <details>
                        <summary>Signed receipt {receipt.receiptId}</summary>
                        <p className="digest">Terms digest: {receipt.termsSha256}</p>
                        <code className="token">{receipt.signedReceipt}</code>
                      </details>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="panel">
                <h2>Linked workflow</h2>
                <p>
                  <code>{detail.workflowId}</code>
                </p>
                <ol>
                  {history.map((item) => (
                    <li key={item.id}>
                      <Link href={`/handoffs/${item.id}`}>
                        {item.senderName} → {item.receiverName}: {item.goal}
                      </Link>{' '}
                      · {item.status} · {new Date(item.createdAt).toLocaleString()}
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </>
      )}
      <footer>
        Porden records authorization and provenance. External agents remain responsible for actions
        outside its API boundary.
      </footer>
    </>
  );
}

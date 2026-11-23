'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  createHandoffClient,
  getErrorMessage,
  HandoffWriteUnknown,
  PordenError,
} from '@porden/sdk';
import type {
  HandoffDetail,
  HandoffSummary,
  HandoffMutation,
  HandoffAuthorization,
  Principal,
  Organization,
  TaskTerms,
} from '@porden/contracts';
import type { z } from 'zod';

const client = createHandoffClient();
export default function TaskConsumer({ company }: { company: string }) {
  const [principal, setPrincipal] = useState<Principal>(),
    [organizations, setOrganizations] = useState<z.infer<typeof Organization>[]>([]);
  const [handoffs, setHandoffs] = useState<z.infer<typeof HandoffSummary>[]>([]),
    [selectedId, setSelectedId] = useState<string>(),
    [loadedSelected, setSelected] = useState<HandoffDetail>();
  const selected = loadedSelected?.id === selectedId ? loadedSelected : undefined;
  const [authorization, setAuthorization] = useState<z.infer<typeof HandoffAuthorization>>();
  const [previous, setPrevious] = useState<HandoffDetail>(),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState<string>();
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const session = await client.session(),
          directory = await client.organizations();
        if (active) {
          setPrincipal(session.principal);
          setOrganizations(directory.items);
          setPending(
            sessionStorage.getItem(`porden-consumer-pending:${session.principal.id}`) || undefined,
          );
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
        const list = await client.listHandoffs({ limit: 100 });
        if (active) setHandoffs(list.items);
        if (selectedId) {
          const row = await client.getHandoff(selectedId),
            scope = await client.getAuthorization(selectedId, row.currentVersion);
          if (active) {
            setSelected(row);
            setAuthorization(scope);
          }
        }
      } catch (cause) {
        if (active) {
          setError(getErrorMessage(cause));
          setSelected(undefined);
          setHandoffs([]);
          setAuthorization(undefined);
          if (cause instanceof PordenError && cause.status === 401) {
            setPrincipal(undefined);
            setSelected(undefined);
            setHandoffs([]);
            setAuthorization(undefined);
            setPending(undefined);
            setNotice('');
            setPrevious(undefined);
            setSelectedId(undefined);
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [principal, selectedId]);
  async function login(form: FormData) {
    setBusy(true);
    setError('');
    try {
      const session = await client.signIn({
        login: String(form.get('login')),
        password: String(form.get('password')),
      });
      const directory = await client.organizations();
      setPrincipal(session.principal);
      setOrganizations(directory.items);
      setPending(
        sessionStorage.getItem(`porden-consumer-pending:${session.principal.id}`) || undefined,
      );
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  function clearPending() {
    if (principal) sessionStorage.removeItem(`porden-consumer-pending:${principal.id}`);
    setPending(undefined);
  }
  async function perform(action: (requestId: string) => Promise<z.infer<typeof HandoffMutation>>) {
    if (!principal || pending) return;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setError('');
    setNotice('');
    setPending(requestId);
    sessionStorage.setItem(`porden-consumer-pending:${principal.id}`, requestId);
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
      setSelectedId(result.handoff.id);
      setSelected(result.handoff);
      setAuthorization(undefined);
      setNotice(
        `Saved ${result.receipt.action} for version ${result.receipt.version}. Receipt ${result.receipt.receiptId}.`,
      );
    } catch (cause) {
      if (!(cause instanceof HandoffWriteUnknown)) clearPending();
      setError(getErrorMessage(cause));
      if (cause instanceof PordenError && cause.status === 401) {
        setPrincipal(undefined);
        setSelected(undefined);
        setHandoffs([]);
        setAuthorization(undefined);
        setSelectedId(undefined);
        setPrevious(undefined);
        setPending(undefined);
        setNotice('');
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
      setSelectedId(result.handoff.id);
      setSelected(result.handoff);
      clearPending();
      setNotice(`Recovered ${result.receipt.action}; no write was repeated.`);
    } catch (cause) {
      setError(
        cause instanceof PordenError && cause.status === 404
          ? 'No committed operation receipt is visible yet. Keep checking before another submission.'
          : getErrorMessage(cause),
      );
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await client.signOut();
      setPrincipal(undefined);
      setSelected(undefined);
      setSelectedId(undefined);
      setHandoffs([]);
      setPrevious(undefined);
      setPending(undefined);
      setAuthorization(undefined);
      setError('');
      setNotice('');
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function create(form: FormData) {
    const claim = String(form.get('claim') || ''),
      sourceUrl = String(form.get('source') || '');
    if (Boolean(claim) !== Boolean(sourceUrl)) {
      setError('Provide both an evidence claim and its source URL.');
      return;
    }
    const terms: TaskTerms = {
      goal: String(form.get('goal')),
      constraints: String(form.get('constraints')).split('\n').filter(Boolean),
      acceptanceCriteria: String(form.get('criteria')).split('\n').filter(Boolean),
      budget: { amountMinor: Math.round(Number(form.get('budget')) * 100), currency: 'USD' },
      ...(claim
        ? {
            evidence: [
              {
                claim,
                source: {
                  url: sourceUrl,
                  locator: String(form.get('locator') || ''),
                  excerpt: String(form.get('excerpt') || ''),
                },
              },
            ],
          }
        : {}),
    };
    await perform((requestId) =>
      client.createHandoff({
        requestId,
        receiverOrganizationId: String(form.get('receiver')),
        terms,
        ...(previous ? { previousHandoffId: previous.id, workflowId: previous.workflowId } : {}),
      }),
    );
  }
  const current = selected?.versions.find((item) => item.version === selected.currentVersion);
  const received = selected?.receiverOrganizationId === principal?.organizationId;
  const disabled = busy || Boolean(pending);
  return (
    <div className="task-consumer">
      <header>
        <Link href="/">porden / {company}</Link>
        <span>Independent task consumer</span>
        {principal && (
          <button disabled={busy} onClick={() => void signOut()}>
            Sign out of tasks
          </button>
        )}
      </header>
      <h1>{company} tasks</h1>
      <p>
        This application uses the Porden SDK. Human authorization happens separately in the Porden
        dashboard.
      </p>
      {error && (
        <p className="task-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="task-notice" role="status">
          {notice}
        </p>
      )}
      {pending && (
        <section className="task-card">
          <h2>Write outcome unknown</h2>
          <p>Operation {pending}. New writes are paused.</p>
          <button disabled={busy} onClick={() => void reconcile()}>
            Check operation receipt
          </button>
        </section>
      )}
      {!principal ? (
        loading ? (
          <p role="status">Checking task session…</p>
        ) : (
          <form action={login} className="task-card">
            <h2>Sign in to task integration</h2>
            <label>
              Task login
              <input name="login" autoComplete="username" required />
            </label>
            <label>
              Task password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button disabled={busy}>Sign in to tasks</button>
          </form>
        )
      ) : (
        <>
          <p>
            Signed in as {principal.name} ·{' '}
            {organizations.find((item) => item.id === principal.organizationId)?.name}
          </p>
          <section className="task-card">
            <h2>{previous ? 'Send linked return handoff' : 'Send a task'}</h2>
            {previous && (
              <p>
                Previous completed handoff: {previous.id}.{' '}
                <button onClick={() => setPrevious(undefined)}>Start unrelated task</button>
              </p>
            )}
            <form key={previous?.id || 'new'} action={create}>
              <label>
                Receiver organization
                <select
                  name="receiver"
                  aria-label="Receiver organization"
                  required
                  defaultValue={previous?.senderOrganizationId}
                >
                  {organizations
                    .filter(
                      (item) =>
                        item.id !== principal.organizationId &&
                        (!previous || item.id === previous.senderOrganizationId),
                    )
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Task goal
                <input
                  name="goal"
                  required
                  maxLength={2000}
                  defaultValue={
                    previous ? 'Return purchase report' : 'Purchase replacement supplies'
                  }
                />
              </label>
              <label>
                Constraints, one per line
                <textarea
                  name="constraints"
                  maxLength={30000}
                  defaultValue="Do not exceed the authorized budget"
                />
              </label>
              <label>
                Acceptance criteria, one per line
                <textarea
                  name="criteria"
                  required
                  maxLength={30000}
                  defaultValue="Provide a purchase receipt"
                />
              </label>
              <label>
                Budget (USD)
                <input
                  name="budget"
                  type="number"
                  min="0"
                  max="10000000000"
                  step="0.01"
                  required
                  defaultValue="500"
                />
              </label>
              <fieldset>
                <legend>Optional provided evidence</legend>
                <label>
                  Evidence claim
                  <input name="claim" maxLength={1000} />
                </label>
                <label>
                  Source URL
                  <input name="source" type="url" maxLength={2048} />
                </label>
                <label>
                  Source location
                  <input name="locator" maxLength={500} />
                </label>
                <label>
                  Source excerpt
                  <textarea name="excerpt" maxLength={4000} />
                </label>
              </fieldset>
              <button disabled={disabled}>Create handoff</button>
            </form>
          </section>
          <section className="task-card">
            <h2>Sent and received handoffs</h2>
            {loading && <p role="status">Refreshing task status…</p>}
            {!loading && !handoffs.length && <p>No handoffs yet.</p>}
            <ul>
              {handoffs.map((item) => (
                <li key={item.id}>
                  <button
                    className="task-link"
                    onClick={() => {
                      setSelectedId(item.id);
                      setSelected(undefined);
                      setAuthorization(undefined);
                    }}
                  >
                    {item.goal}
                  </button>{' '}
                  · {item.senderName} → {item.receiverName} · {item.status.replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
          </section>
          {selected && current && (
            <section className="task-card" aria-label="Selected task">
              <h2>{selected.goal}</h2>
              <p>
                Handoff ID: <code>{selected.id}</code>
              </p>
              <p>
                Status: <strong data-testid="task-status">{selected.status}</strong> · Current
                version {selected.currentVersion} · Approved version{' '}
                {selected.approvedVersion ?? 'none'} · Accepted version{' '}
                {selected.acceptedVersion ?? 'none'}
              </p>
              <p data-testid="execution-authorization">
                Execution authorization:{' '}
                {authorization?.eligible ? 'authorized' : authorization?.reasonCode || 'checking'}
              </p>
              <h3>Exact current terms</h3>
              <p>
                {current.terms.budget?.currency}{' '}
                {((current.terms.budget?.amountMinor || 0) / 100).toFixed(2)}
              </p>
              <h4>Constraints</h4>
              <ul>
                {current.terms.constraints.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ul>
              <h4>Acceptance criteria</h4>
              <ul>
                {current.terms.acceptanceCriteria.map((value, index) => (
                  <li key={index}>{value}</li>
                ))}
              </ul>
              {current.terms.completedWork?.length ? (
                <>
                  <h4>Completed work</h4>
                  <ul>
                    {current.terms.completedWork.map((value, index) => (
                      <li key={index}>{value}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {current.terms.remainingWork?.length ? (
                <>
                  <h4>Remaining work</h4>
                  <ul>
                    {current.terms.remainingWork.map((value, index) => (
                      <li key={index}>{value}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {current.terms.openQuestions?.length ? (
                <>
                  <h4>Open questions</h4>
                  <ul>
                    {current.terms.openQuestions.map((value, index) => (
                      <li key={index}>{value}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {current.terms.nextStep && (
                <p>
                  <strong>Next step:</strong> {current.terms.nextStep}
                </p>
              )}
              <h4>Provided evidence</h4>
              <p>Supplied provenance, not verified facts.</p>
              {current.terms.evidence?.map((reference, index) => {
                const claim = 'claim' in reference ? reference.claim : undefined;
                const source = 'source' in reference ? reference.source : undefined;
                const sourceUrl =
                  source?.url ?? ('sourceUrl' in reference ? reference.sourceUrl : undefined);
                const locator =
                  source?.locator ?? ('locator' in reference ? reference.locator : undefined);
                const excerpt =
                  source?.excerpt ?? ('excerpt' in reference ? reference.excerpt : undefined);
                return (
                  <article key={index}>
                    {claim && <p>{claim}</p>}
                    {sourceUrl && (
                      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                        Open source
                      </a>
                    )}
                    {locator && <p>{locator}</p>}
                    {excerpt && <blockquote>{excerpt}</blockquote>}
                  </article>
                );
              })}
              {selected.status === 'draft' && (
                <p>Awaiting a sender-side human approver in the Porden dashboard.</p>
              )}
              {selected.status === 'awaiting_approval' && (
                <p>
                  The proposed version is blocked. This consumer polls Porden for the decision every
                  three seconds.
                </p>
              )}
              {received && selected.status === 'approved' && (
                <div className="task-actions">
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform((requestId) =>
                        client.acceptHandoff(selected.id, {
                          requestId,
                          version: selected.currentVersion,
                        }),
                      )
                    }
                  >
                    Accept version {selected.currentVersion}
                  </button>
                  <button
                    disabled={disabled}
                    onClick={() =>
                      void perform((requestId) =>
                        client.rejectHandoff(selected.id, {
                          requestId,
                          version: selected.currentVersion,
                        }),
                      )
                    }
                  >
                    Refuse handoff
                  </button>
                </div>
              )}
              {received && ['approved', 'accepted'].includes(selected.status) && (
                <form
                  action={async (form) => {
                    const proposedTerms = {
                      ...current.terms,
                      budget: {
                        amountMinor: Math.round(Number(form.get('revisedBudget')) * 100),
                        currency: 'USD',
                      },
                    };
                    await perform((requestId) =>
                      client.proposeRevision(selected.id, {
                        requestId,
                        version: selected.currentVersion,
                        terms: proposedTerms,
                        reason: String(form.get('reason')),
                      }),
                    );
                  }}
                >
                  <h3>Request revised terms</h3>
                  <label>
                    Proposed budget (USD)
                    <input
                      name="revisedBudget"
                      type="number"
                      min="0"
                      max="10000000000"
                      step="0.01"
                      required
                      defaultValue="550"
                    />
                  </label>
                  <label>
                    Reason for revision
                    <input
                      name="reason"
                      required
                      maxLength={2000}
                      defaultValue="Supplier price increased"
                    />
                  </label>
                  <button disabled={disabled}>Propose revision</button>
                </form>
              )}
              {received && selected.status === 'accepted' && (
                <form
                  action={async (form) => {
                    const outcome = form.get('outcome');
                    if (outcome !== 'completed' && outcome !== 'failed') return;
                    await perform((requestId) =>
                      client.finishHandoff(selected.id, {
                        requestId,
                        version: selected.currentVersion,
                        status: outcome,
                        note: String(form.get('note')),
                      }),
                    );
                  }}
                >
                  <h3>Report task outcome</h3>
                  <label>
                    Outcome
                    <select name="outcome" aria-label="Outcome">
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                    </select>
                  </label>
                  <label>
                    Outcome note
                    <input name="note" required maxLength={2000} />
                  </label>
                  <button disabled={disabled || !authorization?.eligible}>Record outcome</button>
                </form>
              )}
              {!received &&
                ['draft', 'approved', 'accepted', 'awaiting_approval'].includes(
                  selected.status,
                ) && (
                  <button
                    disabled={disabled}
                    onClick={() => {
                      if (window.confirm('Cancel this task handoff?'))
                        void perform((requestId) =>
                          client.cancelHandoff(selected.id, {
                            requestId,
                            version: selected.currentVersion,
                          }),
                        );
                    }}
                  >
                    Cancel task
                  </button>
                )}
              {received && selected.status === 'completed' && (
                <button
                  disabled={disabled}
                  onClick={() => {
                    setPrevious(selected);
                    setNotice('Linked return form is ready above.');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Send linked return
                </button>
              )}
              <h3>Independent receipts</h3>
              <ul>
                {selected.receipts.map((receipt) => (
                  <li key={receipt.receiptId}>
                    {receipt.action} · version {receipt.version} · {receipt.receiptId}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      <footer>
        Porden enforces authorization at its API boundary. This demo does not purchase supplies or
        execute external actions.
      </footer>
    </div>
  );
}

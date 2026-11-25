import type { ClaimEvaluation, ClaimPolicy, OrderFacts } from '@porden/contracts/delivery-claims';

// Runs one damaged-parcel claims turn on an organization's own nsDeploy engine. The page supplies
// grounded facts (order record, courier policy evaluation); the agent proposes exactly one
// site action; the site's server enforces consent, pricing and policy when it is submitted.
export type ClaimTask =
  | { task: 'file_claim'; customerMessage: string; order: OrderFacts; courierPolicy: ClaimPolicy }
  | {
      task: 'answer_clarification';
      customerMessage: string;
      handoffId: string;
      version: number;
      clarification: { id: string; missingInformation: string[]; reason: string };
    }
  | {
      task: 'review_claim';
      handoffId: string;
      version: number;
      status: string;
      evaluation: Pick<ClaimEvaluation, 'findings' | 'allowed' | 'parameters' | 'policyId'>;
      staffNote?: string;
    }
  | { task: 'complete_claim'; handoffId: string; version: number };

export const claimActionFor = {
  file_claim: 'merchant_file_claim',
  answer_clarification: 'merchant_answer_clarification',
  review_claim: 'courier_claim_decision',
  complete_claim: 'courier_claim_decision',
} as const;

type Component = { id: string; kind?: string };
type Binding = { action: string; arguments: Record<string, unknown> };
export type ClaimEngine = {
  runTurn(text: string): Promise<{
    turnId: string;
    text: string;
    presentation?: { components: Component[] };
  }>;
  submitActions(input: {
    turnId: string;
    componentId: string;
    values: unknown;
  }): Promise<Array<{ status: string; requestId: string; result: unknown; error?: string }> | null>;
};

export type ClaimTurn =
  | {
      kind: 'proposal';
      turnId: string;
      componentId: string;
      action: string;
      arguments: Binding['arguments'];
      text: string;
    }
  | { kind: 'none'; text: string }
  | {
      kind: 'invalid';
      text: string;
      reason: 'MULTIPLE_PROPOSALS' | 'WRONG_ACTION' | 'WRONG_HANDOFF';
    };

export async function proposeClaimAction(
  engine: ClaimEngine,
  actionBindings: (component: Component) => Binding[],
  task: ClaimTask,
): Promise<ClaimTurn> {
  const result = await engine.runTurn(JSON.stringify(task));
  const components = (result.presentation?.components ?? []).filter(
    (component) => actionBindings(component).length > 0,
  );
  if (!components.length) return { kind: 'none', text: result.text };
  const bindings = actionBindings(components[0]);
  if (components.length !== 1 || bindings.length !== 1)
    return { kind: 'invalid', text: result.text, reason: 'MULTIPLE_PROPOSALS' };
  const [binding] = bindings;
  if (!binding.action.endsWith(`#${claimActionFor[task.task]}`))
    return { kind: 'invalid', text: result.text, reason: 'WRONG_ACTION' };
  if (
    'handoffId' in task &&
    (binding.arguments.handoffId !== task.handoffId || binding.arguments.version !== task.version)
  )
    return { kind: 'invalid', text: result.text, reason: 'WRONG_HANDOFF' };
  return {
    kind: 'proposal',
    turnId: result.turnId,
    componentId: components[0].id,
    action: binding.action,
    arguments: binding.arguments,
    text: result.text,
  };
}

/** Submits after the person reviewed the proposal. Unknown outcomes must be reconciled, not retried. */
export async function submitClaimProposal(
  engine: ClaimEngine,
  proposal: Extract<ClaimTurn, { kind: 'proposal' }>,
) {
  const receipts = await engine.submitActions({
    turnId: proposal.turnId,
    componentId: proposal.componentId,
    values: proposal.arguments,
  });
  if (!receipts) return { status: 'cancelled' as const };
  const [receipt] = receipts;
  if (receipts.length === 1 && receipt.status === 'succeeded')
    return { status: 'succeeded' as const, result: receipt.result };
  // The runtime reports every failure as unknown; the site action marks definite refusals.
  const error = receipt?.error ?? '';
  const refused = /^Claim request refused: ([A-Z_0-9]+)/.exec(error);
  if (refused) return { status: 'refused' as const, code: refused[1] };
  const operation = /operations\/([0-9a-f-]{36})/.exec(error);
  return { status: 'unknown' as const, operationId: operation?.[1] };
}

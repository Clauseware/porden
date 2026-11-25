// Runs only inside an official merchant or courier action bridge.
export async function registerActions(actions) {
  const operationId = async (value) => {
    if (typeof value !== 'string' || !value || value.length > 500)
      throw Error('A valid operation ID is required');
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
      return value;
    // nsDeploy IDs contain ':'; preserve their identity as a deterministic UUID for REST reconciliation.
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode('porden-runtime-operation:' + value),
      ),
    );
    bytes[6] = (bytes[6] & 15) | 128;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const policy = await fetch('/action-policy.json');
  if (!policy.ok) throw Error('Porden action discovery unavailable');
  const { callerOrigins, role } = await policy.json();

  const legacySchema = await fetch('/api/v1/case-types');
  if (legacySchema.ok) {
    const { actionSchema } = await legacySchema.json();
    actions.register({
      name: 'create_damage_case',
      description: 'Create the exactly approved legacy delivery damage case.',
      effect: 'write',
      availability: 'bridge',
      callerOrigins,
      inputSchema: actionSchema,
      async execute(args, context) {
        const auth = await fetch('/api/v1/session', {
          credentials: 'include',
          signal: context.signal,
        });
        if (!auth.ok) throw Error('Sign in to the courier site first');
        const { csrf } = await auth.json();
        const response = await fetch('/api/v1/cases', {
          method: 'POST',
          credentials: 'include',
          signal: context.signal,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ ...args, requestId: context.requestId }),
        });
        if (!response.ok)
          throw Error(
            `Courier write returned HTTP ${response.status}; check status before trying again`,
          );
        return response.json();
      },
    });
  }

  const terms = {
    type: 'object',
    additionalProperties: false,
    properties: {
      goal: { type: 'string' },
      constraints: { type: 'array', items: { type: 'string' } },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
      executionScopes: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['action', 'parametersSha256'],
          properties: {
            action: { type: 'string' },
            parametersSha256: { type: 'string', minLength: 64, maxLength: 64 },
          },
        },
      },
      budget: {
        type: 'object',
        properties: { amountMinor: { type: 'integer' }, currency: { type: 'string' } },
        required: ['amountMinor', 'currency'],
      },
      completedWork: { type: 'array', items: { type: 'string' } },
      remainingWork: { type: 'array', items: { type: 'string' } },
      openQuestions: { type: 'array', items: { type: 'string' } },
      nextStep: { type: 'string' },
      evidence: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            claim: { type: 'string' },
            sourceUrl: { type: 'string' },
            source: {
              type: 'object',
              additionalProperties: false,
              properties: {
                url: { type: 'string' },
                locator: { type: 'string' },
                excerpt: { type: 'string' },
              },
              required: ['url'],
            },
            locator: { type: 'string' },
            excerpt: { type: 'string' },
          },
        },
      },
    },
    required: ['goal', 'constraints', 'acceptanceCriteria'],
  };
  const inputSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['operation'],
    properties: {
      operation: {
        type: 'string',
        enum: [
          'create',
          'accept',
          'reject',
          'revise',
          'finish',
          'clarify',
          'resolve_clarification',
        ],
      },
      handoffId: { type: 'string' },
      receiverOrganizationId: { type: 'string' },
      version: { type: 'integer', minimum: 1 },
      terms,
      reason: { type: 'string' },
      status: { type: 'string', enum: ['completed', 'failed'] },
      note: { type: 'string' },
      criterionResults: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionIndex', 'met'],
          properties: {
            criterionIndex: { type: 'integer', minimum: 0, maximum: 29 },
            met: { type: 'boolean' },
            reason: { type: 'string' },
          },
        },
      },
      missingInformation: { type: 'array', minItems: 1, items: { type: 'string' } },
      clarificationId: { type: 'string' },
      response: { type: 'string' },
      workflowId: { type: 'string' },
      previousHandoffId: { type: 'string' },
    },
  };
  const session = async (signal) => {
    const response = await fetch('/api/v2/session', { credentials: 'include', signal });
    if (!response.ok) throw Error('Sign in to the Porden platform first');
    return response.json();
  };
  const call = async (path, body, context) => {
    const headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': context.csrf };
    let response;
    try {
      response = await fetch(`/api/v2${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'include',
        signal: context.signal,
        headers: body === undefined ? {} : headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      if (body !== undefined)
        throw Object.assign(Error('Porden write outcome is unknown'), { unknown: true, cause });
      throw cause;
    }
    if (!response.ok) {
      if (body !== undefined && response.status >= 500)
        throw Object.assign(Error('Porden write outcome is unknown'), { unknown: true });
      throw Error(`Porden handoff returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch (cause) {
      if (body !== undefined)
        throw Object.assign(Error('Porden write response is unknown'), { unknown: true, cause });
      throw cause;
    }
  };
  actions.register({
    name: 'porden_handoff',
    description:
      'Create, accept, reject, revise, clarify, resolve clarification, or finish a versioned Porden task handoff. Completion requires a result for every zero-based acceptance criterion; unmet criteria require reasons. Clarification supplies information; changed terms require revision.',
    effect: 'write',
    availability: 'bridge',
    callerOrigins,
    inputSchema,
    async execute(args, context) {
      const { csrf } = await session(context.signal);
      const body = { requestId: await operationId(context.requestId), version: args.version };
      try {
        switch (args.operation) {
          case 'create':
            return await call(
              '/handoffs',
              {
                requestId: body.requestId,
                receiverOrganizationId: args.receiverOrganizationId,
                terms: args.terms,
                workflowId: args.workflowId,
                previousHandoffId: args.previousHandoffId,
              },
              { ...context, csrf },
            );
          case 'accept':
          case 'reject':
            return await call(`/handoffs/${args.handoffId}/${args.operation}`, body, {
              ...context,
              csrf,
            });
          case 'revise':
            return await call(
              `/handoffs/${args.handoffId}/revisions`,
              { ...body, terms: args.terms, reason: args.reason },
              { ...context, csrf },
            );
          case 'finish':
            return await call(
              `/handoffs/${args.handoffId}/finish`,
              {
                ...body,
                status: args.status,
                note: args.note,
                criterionResults: args.criterionResults,
              },
              { ...context, csrf },
            );
          case 'clarify':
            return await call(
              `/handoffs/${args.handoffId}/clarifications`,
              { ...body, missingInformation: args.missingInformation, reason: args.reason },
              { ...context, csrf },
            );
          case 'resolve_clarification':
            return await call(
              `/handoffs/${args.handoffId}/clarifications/resolve`,
              { ...body, clarificationId: args.clarificationId, response: args.response },
              { ...context, csrf },
            );
        }
      } catch (error) {
        if (error?.unknown)
          throw Error(
            `Write outcome unknown. Reconcile operationId ${body.requestId} with porden_handoff_read; do not retry this write.`,
          );
        throw error;
      }
    },
  });

  actions.register({
    name: 'porden_handoff_read',
    description:
      'Read handoff details, authorization, workflow history, or an uncertain operation result.',
    effect: 'read',
    availability: 'bridge',
    callerOrigins,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operation'],
      properties: {
        operation: {
          type: 'string',
          enum: ['list', 'detail', 'authorization', 'history', 'reconcile'],
        },
        handoffId: { type: 'string' },
        operationId: { type: 'string' },
        version: { type: 'integer', minimum: 1 },
        direction: { type: 'string', enum: ['sent', 'received'] },
        status: { type: 'string' },
      },
    },
    async execute(args, context) {
      await session(context.signal);
      const query = new URLSearchParams();
      if (args.operation === 'list') {
        if (args.direction) query.set('direction', args.direction);
        if (args.status) query.set('status', args.status);
        return call(`/handoffs?${query}`, undefined, context);
      }
      if (args.operation === 'reconcile') {
        if (!args.operationId) throw Error('An operationId is required for reconciliation');
        return call(`/operations/${await operationId(args.operationId)}`, undefined, context);
      }
      if (!args.handoffId) throw Error('A handoffId is required for this read');
      if (args.operation === 'detail')
        return call(`/handoffs/${args.handoffId}`, undefined, context);
      if (args.operation === 'authorization') {
        if (!args.version) throw Error('A version is required for authorization lookup');
        query.set('version', String(args.version));
        return call(`/handoffs/${args.handoffId}/authorization?${query}`, undefined, context);
      }
      return call(`/workflows/${args.handoffId}`, undefined, context);
    },
  });

  // Damaged-parcel claims example. These actions stay on their own site (local-only); the
  // site's server enforces consent, pricing and policy, so the model only proposes arguments.
  const siteWrite = async (path, body, signal) => {
    const auth = await fetch('/api/v1/session', { credentials: 'include', signal });
    if (!auth.ok) throw Error('Sign in to this site first');
    const { csrf } = await auth.json();
    let response;
    try {
      response = await fetch(path, {
        method: 'POST',
        credentials: 'include',
        signal,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      });
    } catch (cause) {
      throw Object.assign(Error('Claim write outcome is unknown'), { unknown: true, cause });
    }
    if (response.status >= 500)
      throw Object.assign(Error('Claim write outcome is unknown'), { unknown: true });
    const result = await response.json().catch((cause) => {
      throw Object.assign(Error('Claim write response is unknown'), { unknown: true, cause });
    });
    if (!response.ok)
      throw Error(`Claim request refused: ${result?.error?.code || response.status}`);
    return result;
  };
  const claimWrite = async (path, body, signal) => {
    try {
      return await siteWrite(path, body, signal);
    } catch (error) {
      if (error?.unknown)
        throw Error(
          `Write outcome unknown. Check /api/v1/claims/operations/${body.requestId}; do not retry this write.`,
        );
      throw error;
    }
  };
  // The runtime carries action results into later model calls. Signed receipt tokens and the copy
  // of the latest receipt are for verifiers, not the model; the handoff keeps every receipt's claims,
  // approvals, versions and executions, and the server keeps the signed receipts.
  const withoutSignedReceipts = ({ receipt: _receipt, ...result }) =>
    result.handoff?.receipts
      ? {
          ...result,
          handoff: {
            ...result.handoff,
            receipts: result.handoff.receipts.map(
              ({ signedReceipt: _signed, ...claims }) => claims,
            ),
          },
        }
      : result;
  if (role === 'courier')
    actions.register({
      name: 'courier_claim_decision',
      description:
        'Record the courier decision on a damaged-parcel claim: accept, reject, clarify (ask for missing information), counter (offer partial_refund or reship; the server computes the amount and terms), or complete after the case exists. The courier server refuses any decision its claims policy does not allow.',
      effect: 'write',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['handoffId', 'version', 'decision', 'reason'],
        properties: {
          handoffId: { type: 'string', minLength: 36, maxLength: 36 },
          version: { type: 'integer', minimum: 1 },
          decision: {
            type: 'string',
            enum: ['accept', 'reject', 'clarify', 'counter', 'complete'],
          },
          reason: { type: 'string', minLength: 1, maxLength: 2000 },
          missingInformation: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', enum: ['photo_of_damage'] },
          },
          remedy: { type: 'string', enum: ['partial_refund', 'reship'] },
        },
      },
      async execute(args, context) {
        const { handoffId, ...decision } = args;
        return withoutSignedReceipts(
          await claimWrite(
            `/api/v1/claims/${encodeURIComponent(handoffId)}/decisions`,
            { ...decision, requestId: await operationId(context.requestId) },
            context.signal,
          ),
        );
      },
    });
  if (role === 'merchant') {
    actions.register({
      name: 'merchant_file_claim',
      description:
        "File the customer's damaged-parcel claim for order DEMO-1042 with the courier. Submitting it is the customer's consent to share the listed fields. Order facts and refund amounts come from the merchant's order system; partialRefundMinor is only the customer's own stated amount in cents.",
      effect: 'write',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['damageDescription', 'photoProvided', 'remedy'],
        properties: {
          damageDescription: { type: 'string', minLength: 8, maxLength: 500 },
          deliveryAddress: { type: 'string', minLength: 5, maxLength: 250 },
          photoProvided: { type: 'boolean' },
          remedy: { type: 'string', enum: ['full_refund', 'partial_refund', 'reship'] },
          partialRefundMinor: { type: 'integer', minimum: 1 },
        },
      },
      async execute(args, context) {
        const data = {
          orderReference: 'DEMO-1042',
          damageDescription: args.damageDescription,
          ...(args.deliveryAddress ? { deliveryAddress: args.deliveryAddress } : {}),
        };
        if (args.remedy === 'partial_refund' && !args.partialRefundMinor)
          throw Error('A partial refund needs the amount the customer asked for');
        return claimWrite(
          '/api/v1/claims',
          {
            requestId: await operationId(context.requestId),
            data,
            approvedFields: Object.keys(data),
            photoProvided: args.photoProvided,
            requestedResolution:
              args.remedy === 'partial_refund'
                ? { remedy: 'partial_refund', amountMinor: args.partialRefundMinor }
                : { remedy: args.remedy },
          },
          context.signal,
        );
      },
    });
    actions.register({
      name: 'merchant_answer_clarification',
      description:
        "Send the customer's answer to the courier's clarification request. The answer supplies information only; it never changes the claim terms.",
      effect: 'write',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['handoffId', 'version', 'clarificationId', 'response'],
        properties: {
          handoffId: { type: 'string', minLength: 36, maxLength: 36 },
          version: { type: 'integer', minimum: 1 },
          clarificationId: { type: 'string', minLength: 36, maxLength: 36 },
          response: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
      async execute(args, context) {
        const { handoffId, ...answer } = args;
        return withoutSignedReceipts(
          await claimWrite(
            `/api/v1/claims/${encodeURIComponent(handoffId)}/clarifications/resolve`,
            { ...answer, requestId: await operationId(context.requestId) },
            context.signal,
          ),
        );
      },
    });
  }
}

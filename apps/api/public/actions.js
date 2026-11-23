// Runs only inside an official merchant or courier action bridge.
export async function registerActions(actions) {
  const policy = await fetch('/action-policy.json');
  if (!policy.ok) throw Error('Porden action discovery unavailable');
  const { callerOrigins } = await policy.json();

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
      operation: { type: 'string', enum: ['create', 'accept', 'reject', 'revise', 'finish'] },
      handoffId: { type: 'string' },
      receiverOrganizationId: { type: 'string' },
      version: { type: 'integer', minimum: 1 },
      terms,
      reason: { type: 'string' },
      status: { type: 'string', enum: ['completed', 'failed'] },
      note: { type: 'string' },
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
    description: 'Create, accept, reject, revise, or finish a versioned Porden task handoff.',
    effect: 'write',
    availability: 'bridge',
    callerOrigins,
    inputSchema,
    async execute(args, context) {
      const { csrf } = await session(context.signal);
      const body = { requestId: context.requestId, version: args.version };
      try {
        switch (args.operation) {
          case 'create':
            return await call(
              '/handoffs',
              {
                requestId: context.requestId,
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
              { ...body, status: args.status, note: args.note },
              { ...context, csrf },
            );
        }
      } catch (error) {
        if (error?.unknown)
          throw Error(
            `Write outcome unknown. Reconcile operationId ${context.requestId} with porden_handoff_read; do not retry this write.`,
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
        return call(`/operations/${args.operationId}`, undefined, context);
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
}

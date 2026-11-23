// Runs only inside the official receiver-origin action bridge.
export async function registerActions(actions) {
  const policy = await fetch('/action-policy.json');
  const schemaResponse = await fetch('/api/v1/case-types');
  if (!policy.ok || !schemaResponse.ok) throw Error('Courier discovery unavailable');
  const { callerOrigins } = await policy.json();
  const { actionSchema } = await schemaResponse.json();
  actions.register({
    name: 'create_damage_case',
    description: 'Create the exactly approved delivery damage case.',
    effect: 'write',
    availability: 'bridge',
    callerOrigins,
    inputSchema: actionSchema,
    async execute(args, context) {
      const session = await fetch('/api/v1/session', {
        credentials: 'include',
        signal: context.signal,
      });
      if (!session.ok) throw Error('Sign in to the courier site first');
      const { csrf } = await session.json();
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

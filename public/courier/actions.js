// Loaded by nsDeploy only on the courier origin, including its confirmation popup.
export async function registerActions(actions) {
  // Both development origins are published by the local server, never by the caller.
  const policyResponse = await fetch('/action-policy.json');
  if (!policyResponse.ok) throw new Error('Courier caller policy unavailable');
  const { callerOrigins } = await policyResponse.json();
  actions.register({
    name: 'create_damage_case',
    description: 'Submit a customer-approved courier damage investigation.',
    effect: 'write',
    availability: 'bridge',
    callerOrigins,
    inputSchema: {
      type: 'object',
      properties: {
        orderReference: { type: 'string', maxLength: 100 },
        damageDescription: { type: 'string', minLength: 8, maxLength: 500 },
        deliveryAddress: { type: 'string', maxLength: 250 },
      },
      required: ['orderReference', 'damageDescription'],
    },
    async execute(args, context) {
      // Runtime IDs contain ':'. Hash the full stable ID to keep the API contract intact.
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(context.requestId));
      const transferId = 'handoff_' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      const sessionResponse = await fetch('/api/session', { credentials: 'include' });
      if (!sessionResponse.ok) throw new Error('Courier authentication required');
      const { csrf } = await sessionResponse.json();
      const response = await fetch('/api/cases', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ ...args, transferId }),
        signal: context.signal,
      });
      if (!response.ok) {
        // The official runtime classifies remote write failures conservatively.
        throw new Error(`Courier write returned HTTP ${response.status}`);
      }
      return { ...await response.json(), transferId };
    },
  });
}

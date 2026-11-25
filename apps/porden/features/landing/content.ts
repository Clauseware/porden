/** Landing page copy and data. Sections import from here, so wording changes live in one place. */

/** Sections linked from the nav and the footer. */
export const navigation = [
  { href: '#how', label: 'How it works' },
  { href: '#guarantees', label: 'Guarantees' },
  { href: '#developers', label: 'Developers' },
  { href: '#faq', label: 'FAQ' },
];

/** The band of words under the hero. */
export const marqueeWords = [
  'Approved',
  'Handed off',
  'Accepted',
  'Signed',
  'Verified',
  'Never resent',
  'One record',
  'Your data, your side',
];

/** The SDK example in the Developers section. */
export const sdkSnippet = `import { createPordenClient } from '@porden/sdk';

const client = createPordenClient({
  senderApiBaseUrl: '/api',
  runtimeAssetBaseUrl: '/runtime',
  model: 'your-tool-calling-model',
});

const draft = await client.createDraft({
  recipientOrigin: 'https://partner.example',
  caseType: 'your_case_type',
  data: { /* fields the receiving organization accepts */ },
});

const outcome = await client.transfer({
  transferId: draft.id,
  approvedFields: ['fieldYouMayShare'],
  confirm: (review) => showApproval(review),
});

// Unknown outcome? Reconcile read-only. Never repeat the write.
await client.reconcile(draft.id);`;

/** What the developer stack is made of, shown under the Developers heading. */
export const developerStack = [
  'Zod contracts',
  'Hono API per organization',
  'PostgreSQL per organization',
  'Signed receipts',
];

/** The FAQ, in order. The first one starts open. */
export const faqs = [
  {
    q: 'Does a receipt mean the work is done?',
    a: 'No. It proves the other organization accepted the handoff into its system — not that the work behind it is finished.',
  },
  {
    q: 'What if the other side says no?',
    a: 'Nothing is created there, and your side shows the refusal plainly. A refusal is never presented as a success.',
  },
  {
    q: 'Can a model change what was approved?',
    a: 'No. Extra or altered fields are caught before anything leaves, and the handoff stops there.',
  },
  {
    q: 'Is Porden ready for production?',
    a: 'Not yet. It is a working build for the Open Agentic Web Challenge. Public deployment and repeated live-model runs are still being verified.',
  },
];

/** The states a handoff moves through, shown in the hero's handoff record. */
export const handoffStages = [
  { label: 'Approved', detail: 'Three fields, by a person on your side' },
  { label: 'Handed off', detail: 'Through the Agentic Web runtime' },
  { label: 'Accepted', detail: 'Checked against their own rules' },
  { label: 'Receipt verified', detail: 'Signature checked on your side' },
];

/** The four steps of a handoff. `figure` picks the drawing on each card. */
export const steps = [
  {
    figure: 'comb',
    title: 'Approve',
    body: 'Someone approves exactly which details may leave. Everything else stays where it is.',
  },
  {
    figure: 'rings',
    title: 'Hand off',
    body: 'Your agent delegates to theirs through the open Agentic Web runtime. No private relay.',
  },
  {
    figure: 'gate',
    title: 'Accept',
    body: 'The other organization checks the request against its own rules and confirms the write itself.',
  },
  {
    figure: 'seal',
    title: 'Prove',
    body: 'A signed receipt comes back, and your side verifies it before anything is called done.',
  },
] as const;

/**
 * The four promises in the Guarantees section, in the order their shapes morph.
 * `label` captions the drawing while that promise is active.
 */
export const guarantees = [
  {
    title: 'Only approved details travel',
    body: 'Approval is bound to the exact values and the recipient. Whatever was left out stops at the gate.',
    label: 'Approved',
  },
  {
    title: 'Never resent blindly',
    body: 'A lost response stays unknown. Porden checks the other side read-only — it never sends the same work twice.',
    label: 'Unknown, checking',
  },
  {
    title: 'One request, one record',
    body: 'However many times a request arrives, the other side keeps exactly one record and one receipt.',
    label: 'One record',
  },
  {
    title: 'Each side keeps its own data',
    body: 'Separate APIs, databases and keys. Neither organization can reach into the other.',
    label: 'Two sides',
  },
];

import { DamageData, Fields, type ApproveTransfer } from '@porden/contracts';

// The merchant keeps only a hash of what the customer consented to share, and the claim record does
// not hold the text. To send the case later, this tab remembers exactly what was consented to
// when the claim was filed. It is session storage, and it is removed as soon as the case can no
// longer be sent: after it is sent, or when the claim is cancelled, refused, completed or closed.
export type SavedConsent = { data: DamageData; approvedFields: ApproveTransfer['approvedFields'] };

const key = (handoffId: string) => `porden-claim-consent:${handoffId}`;

export function saveConsent(handoffId: string, value: SavedConsent) {
  try {
    sessionStorage.setItem(key(handoffId), JSON.stringify(value));
  } catch {
    // Storage is blocked: the case can then only be sent from a tab that still has the details.
  }
}

export function clearConsent(handoffId: string) {
  try {
    sessionStorage.removeItem(key(handoffId));
  } catch {
    // Nothing to remove if storage is blocked.
  }
}

// A damaged or unexpected value counts as "not saved". It is checked with the contract's schemas.
export function loadConsent(handoffId: string): SavedConsent | undefined {
  try {
    const raw = sessionStorage.getItem(key(handoffId));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const data = DamageData.safeParse('data' in value ? value.data : undefined);
    const approvedFields = Fields.safeParse(
      'approvedFields' in value ? value.approvedFields : undefined,
    );
    return data.success && approvedFields.success
      ? { data: data.data, approvedFields: approvedFields.data }
      : undefined;
  } catch {
    return undefined;
  }
}

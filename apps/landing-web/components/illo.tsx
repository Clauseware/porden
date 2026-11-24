import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type IlloName =
  | 'handoff-stage'
  | 'versions'
  | 'history'
  | 'acceptance'
  | 'receipts'
  | 'approval'
  | 'locked-version'
  | 'handoff-steps'
  | 'receiver'
  | 'handoff-transfer';

// The animated SVGs live in apps/landing-web/illos. They are inlined so they can read the
// page's --illos-* colour variables, and IlloPlayback pauses them while off screen.
export function Illo({ name, className }: { name: IlloName; className?: string }) {
  const svg = readFileSync(join(process.cwd(), 'illos', `${name}.svg`), 'utf8').trim();
  return (
    <div
      className={className ? `illo ${className}` : 'illo'}
      data-illos=""
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

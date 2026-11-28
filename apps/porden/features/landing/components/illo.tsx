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

/** Each asset draws its art on the left of a 720×460 box and keeps the right for labels, so
 *  it sits off centre once the labels hide. These boxes trim an asset to its art (measured with
 *  getBBox, plus a 12px margin) so it centres in a small frame. Re-measure if an asset changes. */
const crops = {
  approval: '86 77 388 319',
  'handoff-transfer': '120 37 373 363',
  acceptance: '65 20 398 419',
  receipts: '99 60 386 351',
} satisfies Partial<Record<IlloName, string>>;

export type CroppableIllo = keyof typeof crops;

const fullBox = 'width="720" height="460" viewBox="0 0 720 460"';

// The animated SVGs live in apps/porden/illos. They are inlined so they can read the
// page's --illos-* colour variables, and IlloPlayback pauses them while off screen.
export function Illo(
  props:
    | { name: IlloName; crop?: false; className?: string }
    | { name: CroppableIllo; crop: true; className?: string },
) {
  const { name, className } = props;
  const svg = readFileSync(join(process.cwd(), 'illos', `${name}.svg`), 'utf8').trim();
  let html = svg;
  if (props.crop) {
    if (!svg.includes(fullBox)) throw new Error(`${name}.svg no longer has its 720×460 box`);
    html = svg.replace(fullBox, `viewBox="${crops[props.name]}"`);
  }
  return (
    <div
      className={className ? `illo ${className}` : 'illo'}
      data-illos=""
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

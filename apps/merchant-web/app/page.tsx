import Handoff, { type DebugState } from './handoff';
const debugStates: readonly DebugState[] = ['empty', 'success', 'error'];
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ debug?: string | string[] }>;
}) {
  const { debug } = await searchParams;
  const state =
    process.env.NODE_ENV === 'production'
      ? undefined
      : debugStates.find((candidate) => candidate === debug);
  return <Handoff debug={state} />;
}

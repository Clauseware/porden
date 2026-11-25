import { PublicConfig } from '@porden/contracts';
import type { ClaimEngine } from '../../../claims-agent';

// Loads the nsDeploy runtime the same way packages/sdk/src/delivery.ts does: from /runtime, with the
// server-side model route. Everything the runtime returns is checked here, so nothing is asserted.
type Binding = { action: string; arguments: Record<string, unknown> };
type Component = { id: string; kind?: string };
export type RuntimeEngine = ClaimEngine & {
  onActionConfirm?: (items: unknown[]) => Promise<unknown>;
};
export type Agent = {
  engine: RuntimeEngine;
  actionBindings: (component: Component) => Binding[];
};

const load = (file: string): Promise<unknown> =>
  import(/* webpackIgnore: true */ /* @vite-ignore */ `/runtime/${file}`);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isBinding(value: unknown): value is Binding {
  return isObject(value) && typeof value.action === 'string' && isObject(value.arguments);
}
function isEngine(value: unknown): value is RuntimeEngine {
  return (
    isObject(value) &&
    typeof value.runTurn === 'function' &&
    typeof value.submitActions === 'function'
  );
}

export async function loadAgent(): Promise<Agent> {
  const response = await fetch('/api/config');
  const config = PublicConfig.safeParse(await response.json());
  if (!response.ok || !config.success) throw new Error('CONFIG_UNAVAILABLE');
  const [engineModule, actionsModule, transportModule] = await Promise.all([
    load('engine.js'),
    load('actions.js'),
    load('action-transport.js'),
  ]);
  if (!isObject(engineModule) || typeof engineModule.Engine !== 'function')
    throw new Error('RUNTIME_UNAVAILABLE');
  if (!isObject(actionsModule) || typeof actionsModule.actionBindings !== 'function')
    throw new Error('RUNTIME_UNAVAILABLE');
  if (!isObject(transportModule) || typeof transportModule.reviewActions !== 'function')
    throw new Error('RUNTIME_UNAVAILABLE');
  const bindings = actionsModule.actionBindings;
  const review = transportModule.reviewActions;
  const engine: unknown = Reflect.construct(engineModule.Engine, [
    {
      originUrl: location.origin,
      byokKey: 'server-openrouter',
      routerOverride: new URL('/api/llm', location.origin).href,
      modelOverride: config.data.openrouterModel,
    },
  ]);
  if (!isEngine(engine)) throw new Error('RUNTIME_UNAVAILABLE');
  // The person decides: the runtime's own dialog shows the proposed action before it is sent.
  engine.onActionConfirm = (items) => review(items, 'Review before sending');
  return {
    engine,
    actionBindings: (component) => {
      const found: unknown = bindings(component);
      return Array.isArray(found) ? found.filter(isBinding) : [];
    },
  };
}

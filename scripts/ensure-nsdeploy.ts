import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PIN = '486ecf26aa8775963f9b765f894734bef1ac9817';
const REPO = 'https://github.com/cognizant-ai-lab/nsdeploy.git';
const ROOT = resolve('vendor/nsdeploy');
const RUNTIME = resolve(ROOT, 'nsdeploy/runtime/engine.js');

async function run(command: string[], cwd?: string) {
  const child = Bun.spawn(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${command.join(' ')}`);
}

async function currentHead(): Promise<string | undefined> {
  if (!existsSync(resolve(ROOT, '.git'))) return undefined;
  const child = Bun.spawn(['git', '-C', ROOT, 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'pipe' });
  const out = await new Response(child.stdout).text();
  if ((await child.exited) !== 0) return undefined;
  return out.trim();
}

async function ensure() {
  if (process.env.PORDEN_SKIP_NSDEPLOY === '1') return;
  if (process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true') return;

  const hasCheckout = existsSync(resolve(ROOT, '.git'));

  if (existsSync(RUNTIME)) {
    // A copy without its own .git cannot be cloned over or checked against the pin; use it as is.
    if (!hasCheckout) {
      console.log('nsDeploy runtime already present in vendor/nsdeploy (no Git checkout, revision not verified)');
      return;
    }
    if ((await currentHead()) === PIN) return;
  }

  if (hasCheckout) {
    await run(['git', '-C', ROOT, 'fetch', 'origin', PIN, '--depth', '1']);
    await run(['git', '-C', ROOT, 'checkout', '--detach', PIN]);
    console.log(`Checked out nsDeploy at ${PIN} in vendor/nsdeploy`);
    return;
  }

  await run(['git', 'clone', REPO, ROOT]);
  await run(['git', '-C', ROOT, 'checkout', '--detach', PIN]);
  console.log(`Cloned nsDeploy at ${PIN} into vendor/nsdeploy`);
}

ensure().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
# nsDeploy (local only)

This directory is **not** pushed to Git. `bun install` runs `scripts/ensure-nsdeploy.ts` and clones the pin below into `vendor/nsdeploy/`.

| Field | Value |
| --- | --- |
| Upstream | https://github.com/cognizant-ai-lab/nsdeploy |
| Revision | `486ecf26aa8775963f9b765f894734bef1ac9817` |
| Runtime path | `vendor/nsdeploy/nsdeploy/runtime/` |

You need **Git** on your PATH. To fetch without a full install, run `bun run vendor:nsdeploy`. To skip the step, set `PORDEN_SKIP_NSDEPLOY=1`.

Do not edit files under `vendor/nsdeploy/`. Bump the pin in `scripts/ensure-nsdeploy.ts` and this file when you upgrade upstream.
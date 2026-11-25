# Contributing to Porden

## Branches and releases

`main` is release-only. Day-to-day work merges into `dev`.

1. Branch from `dev` and open a pull request into `dev`. It needs one approval and a passing `Apps quality` check.
2. Releases go from `dev` to `main`. Only that head branch is allowed, and the `Branch policy` workflow fails any other pull request into `main`. Only @TraFost approves and merges to `main`.
3. Do not commit or push to `main` directly, and do not target `main` from a feature branch.

## Before you open a pull request

```sh
bun run format
bun run check:apps
bun run test:unit
```

`format` and `check:apps` cover `apps/` only. Do not reformat `packages/`, `vendor/` or applied migrations. [AGENTS.md](AGENTS.md) lists the conventions the codebase follows.

Use Bun 1.4.3, the version pinned in `packageManager`. Older versions cannot read `bun.lock` and rewrite it.

## API tests

The API tests need the local Compose database. They create unique schemas and remove them afterwards. Never point them at production.

```sh
docker compose -f infra/postgres/compose.yml up -d --wait

# bash, zsh
export PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'
# PowerShell
$env:PORDEN_TEST_DATABASE_URL='postgres://porden_admin:local-admin-only@127.0.0.1:54329/porden_test'

bun run test:api
```

## Browser and real-model tests

The browser suites run against production builds, so build first:

```sh
bun run build:dashboard
bun run build:merchant
bun run build:courier
```

| Command                         | Covers                                                                    | Model    |
| ------------------------------- | ------------------------------------------------------------------------- | -------- |
| `bun run test:platform:browser` | Platform demo across the dashboard and both `/tasks` consumers            | None     |
| `bun run test:porden:browser`   | Transfer flow: consent, cancellation, refusal, tampering, lost responses  | Scripted |
| `bun run test:claims:browser`   | Claim workflow: negotiation, adversarial proposals, cross-site boundaries | Scripted |
| `bun run test:default-router`   | Published networks through each site's default model route, no browser    | Fake     |
| `bun run test:porden:live`      | Transfer flow with the configured model                                   | Real     |
| `bun run test:claims:live`      | Claim workflow evaluation with the configured model                       | Real     |

Things to know:

- **Playwright.** The suites import `playwright`. To use an existing installation, set `HANDOFF_PLAYWRIGHT_MODULE` to the file URL of its `index.mjs` and `HANDOFF_CHROME` to the Chromium executable.
- **Database.** Every suite except the two `test:porden:*` commands requires `PORDEN_TEST_DATABASE_URL`. Those two use the local organization databases, which `PORDEN_MERCHANT_DATABASE_URL` and `PORDEN_COURIER_DATABASE_URL` can override.
- **Default router.** `test:default-router` downloads a pinned copy of the challenge's reference runtime into `tmp/`, so it needs network access. It does not need the production builds.
- **Ports.** The suites start their own servers on ports 4100, 4200, 4300, 5100, 5200 and 5300. Stop the dev servers first and run the suites one after the other.
- **Repeats.** Set `PORDEN_RUNS` to repeat `test:porden:browser` or `test:porden:live`. Pass `-- --runs 20` to `test:claims:live`.
- **Real-model runs** need the provider settings from [`.env.example`](.env.example) in the root `.env`. A provider failure is a failed run. To retry only the rate-limited runs of an earlier evaluation, run `bun tests/claims_live_eval.ts --resume <evidence directory>`.
- **Evidence.** Reports, traces and screenshots are written to timestamped directories under `tmp/`, which Git ignores. Record the results you observed, not the commands you configured.

## Prototype tests

The original Node and SQLite prototype (`server.mjs`) keeps its own tests. They need Python with `pytest` and `cryptography`.

```sh
bun run test
bun run test:config
```

[docs/WORKSPACE.md](docs/WORKSPACE.md) describes the prototype and its browser tests.

## Database changes

Add a new migration for every schema change. Do not edit a migration that may already have been applied. [docs/WORKSPACE.md](docs/WORKSPACE.md) explains how to generate migrations for the organization databases.

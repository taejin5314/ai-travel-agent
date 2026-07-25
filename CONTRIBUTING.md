# Contributing

Thanks for working on **ai-travel-agent**. This is a short quickstart. The
authoritative rules for both humans and AI agents live in
**[AGENTS.md](./AGENTS.md)** — read it before you start.

## Local setup

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

## Before you open a PR

```bash
pnpm verify     # typecheck + lint + test + build — must pass
```

See [README.md](./README.md) for the full command list.

## Workflow

1. Pick an issue and read its acceptance criteria.
2. Create a branch: `type/short-description` (`docs/…`, `feat/…`, `fix/…`, `chore/…`, `test/…`).
3. Make the **smallest** change that satisfies the issue, and add/update tests.
4. Run `pnpm verify` and self-review your diff.
5. Open a **Draft PR** using the template; fill every section.
6. Wait for CI (`verify`) to go green, then a human reviews and merges.

`main` is **protected**: no direct pushes, and every change lands through a
reviewed PR with passing CI. Agents never self-merge.

## Deploys

Production is deployed **only** by an explicit human **Promote to Production** in
Vercel — never automatically on merge.

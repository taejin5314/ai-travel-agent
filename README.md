# ai-travel-agent

[![PR Checks](https://github.com/taejin5314/ai-travel-agent/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/taejin5314/ai-travel-agent/actions/workflows/pr-checks.yml)

An AI trip-planning web app, first supporting **Osaka & Kyoto**. Given travel
dates, lodging, party size, must-visit places, interests, pace and constraints,
it produces a validated day-by-day itinerary using real place data, travel
times, opening-hours checks, and must-visit coverage.

> **Status:** building the safe, automatable development foundation.
> The AI trip-planning features are not implemented yet.

## Tech stack

- Next.js 16 (App Router) · React 19 · TypeScript (strict)
- Tailwind CSS 4
- Vitest for unit tests
- Zod for runtime validation of all external/model data
- pnpm

## Getting started

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Local dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | `tsc --noEmit` (strict) |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest (CI mode) |
| `pnpm test:watch` | Vitest watch mode |
| `pnpm coverage` | Vitest with coverage |
| `pnpm verify` | typecheck + lint + test + build (run before every PR) |

## Architecture

Layered, with a strict inward dependency direction. See
[AGENTS.md](./AGENTS.md) for the full rules.

```
app → agent → providers(ports) → domain
       └──────── validators ─────┘
```

- `src/domain` — pure types + Zod schemas
- `src/validators` — deterministic time/conflict/opening-hours checks (no LLM)
- `src/providers` — external adapters behind interfaces (mock now; Google/LLM later)
- `src/agent` — AI workflow + prompts (later)

## Development workflow

All changes go through a branch and a Pull Request — **`main` is protected and
cannot be pushed to directly.** CI runs typecheck, lint, test and build on every
PR. Production is deployed only by an explicit human **Promote to Production** in
Vercel, never automatically.

The authoritative rules for humans and AI agents live in **[AGENTS.md](./AGENTS.md)**.
New here? Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

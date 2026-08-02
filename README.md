# ai-travel-agent

[![PR Checks](https://github.com/taejin5314/ai-travel-agent/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/taejin5314/ai-travel-agent/actions/workflows/pr-checks.yml)

An AI trip-planning web app, first supporting **Osaka & Kyoto**. Given travel
dates, lodging, party size, must-visit places, interests, pace and constraints,
it produces a validated day-by-day itinerary using real place data, travel
times, opening-hours checks, and must-visit coverage.

> **Status:** live on real Google Places/Routes data, with a **deterministic**
> planner — no model is involved yet. Enter your preferences at `/plan` and you
> get a validated day-by-day itinerary with travel times, saved behind a
> shareable link. Real LLM calls, authentication, payments and a real database
> are still gated behind explicit issues (see [AGENTS.md](./AGENTS.md) §1).

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

Set `GOOGLE_MAPS_API_KEY` in `.env.local` (see `.env.example`) to plan against
real Places/Routes data. **Without it the app still works**, falling back to the
mock catalog in `fixtures/places.json` — which is also what keeps dev, CI and
every test offline and deterministic.

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
| `pnpm eval` | Run the eval scenarios against the mock catalog (offline) |
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
- `src/providers` — external adapters behind interfaces: `mock/` and `google/`
  are live, `llm/` is a stub that throws until the LLM phase is approved
- `src/agent` — the deterministic planner (AI workflow + prompts come later)
- `src/db` — `ItineraryStore` behind an in-memory implementation
- `src/evals` — scenarios, scorer, and a committed baseline scorecard

Tests live beside the code they cover (`src/**/*.test.ts`).

## Development workflow

All changes go through a branch and a Pull Request — **`main` is protected and
cannot be pushed to directly.** CI runs typecheck, lint, test and build on every
PR. Production is deployed only by an explicit human **Promote to Production** in
Vercel, never automatically.

The authoritative rules for humans and AI agents live in **[AGENTS.md](./AGENTS.md)**.
New here? Start with **[CONTRIBUTING.md](./CONTRIBUTING.md)**.

# AGENTS.md — Source of Truth for AI Agents & Humans

This file is the **single source of truth** for how any AI coding agent (or human)
works in this repository. `CLAUDE.md` simply imports this file. Read it fully
before starting any task.

> 이 문서는 이 저장소에서 일하는 모든 AI 에이전트와 사람의 **유일한 규칙 원천**입니다.
> 작업 시작 전에 반드시 전체를 읽으세요.

---

## 1. Product (what we are building)

An AI trip-planning web app, first supporting **Osaka & Kyoto**. Users enter
travel dates, lodging location, party size, must-visit places, interests, pace
and constraints; the app returns a validated day-by-day itinerary based on real
place data, travel times, opening hours, and must-visit coverage.

**Where we are:** the development foundation is in place, and so is a
**deterministic** planner — `src/agent/planTrip.ts` builds a validated
day-by-day itinerary from real Google Places/Routes data, scored by the eval
scenarios in `src/evals/`. No model is involved anywhere yet.

**Still gated — do not implement until an issue explicitly asks:**
authentication, payments, real LLM calls, and any real (non in-memory)
database. `src/providers/llm/stub.ts` throws by design.

---

## 2. Architecture & layer boundaries

Every path below exists today; anything planned is marked as such with its
issue. Keep it that way — a tree that lists directories we never built is how
an agent ends up importing from nowhere.

```
src/
  app/          Next.js routes, server actions, UI (React)
  domain/       Pure TS types + Zod schemas. NO external deps, NO IO.
  validators/   Deterministic checks (time, conflicts, opening hours,
                must-visit coverage). Depends only on domain. NO LLM.
  providers/    External adapters behind interfaces (ports.ts).
                mock/ · google/ (live) · llm/ (stub that throws).
  agent/        Planner +, later, AI workflow and prompts. Receives providers
                via ports (DI). Delegates time/conflict decisions to validators.
  db/           Data layer behind ItineraryStore. In-memory only; a real
                database is still gated (§1).
  evals/        Scenarios, scorer, and committed baseline scorecard.
  lib/          Shared utils (config; time zones and logging as needed).
scripts/        run-scenario.ts (offline evals) · smoke-google.ts (manual,
                live, never in CI)
fixtures/       mock catalog + future record/replay data (JSON)
```

**Tests live next to the code they cover** — `src/**/*.test.ts`, picked up by
`vitest.config.ts`. There is no top-level `tests/` directory; a future e2e
suite would be the reason to add one.

**Dependency direction (arrows point inward; inner layers are pure):**

```
app  →  agent  →  providers(ports)  →  domain
 │        │            │
 └────────┴──→ validators ──→ domain
```

Hard rules:

- `domain/` imports nothing from other layers (Zod allowed for schemas). No IO.
- Never import against the arrows (e.g. `domain` importing `providers`).
- **React components must never call a provider or external API directly.**
  UI → server action / route handler → agent/providers.
- **Untrusted input** (LLM output, external API responses) must pass a Zod
  parse at the `providers` boundary before becoming a domain type.
- **Time math, schedule conflicts, and date validation are done by plain
  TypeScript in `validators/`, never by an LLM.** Any itinerary produced by an
  agent must pass `validators/` before being shown to a user.

---

## 3. Golden safety rules (non-negotiable)

An agent must NEVER:

1. Push directly to `main` (it is protected — always use a branch + PR).
2. Merge its own PR, or enable auto-merge.
3. Deploy to production, or promote a Vercel deployment to Production.
4. Access or modify a production database.
5. Run destructive/irreversible migrations automatically.
6. Change GitHub branch protection, rulesets, or CI safety gates.
7. Print, log, or commit secrets, API keys, tokens, or `.env*` contents.
8. Delete or weaken tests to make CI pass (see §5).
9. Weaken TypeScript `strict`, disable lint rules, or add `// @ts-ignore` /
   `eslint-disable` to silence a real problem.

Work requiring **explicit human approval** before implementation:
payments, authentication, authorization, and any deletion of user data.

**Auto-fix limit:** if checks fail, retry at most **2 times**. After the 2nd
failure, STOP, do not force a workaround, and report the root cause plus the
human decision needed.

---

## 4. Development workflow (every task)

1. Read the full GitHub Issue and its acceptance criteria.
2. Investigate related code and existing patterns.
3. Write a short implementation plan.
4. Implement the **smallest** change that satisfies the criteria.
5. Add or update tests.
6. Run `pnpm verify` (typecheck + lint + test + build).
7. Self-review the diff.
8. Commit to a dedicated branch (`type/short-description`).
9. Open a **Draft Pull Request**.
10. In the PR, report: change summary · linked Issue · acceptance criteria
    checklist · tests run · screenshots (UI changes) · risks · rollback steps.

Branch naming: `docs/…`, `feat/…`, `fix/…`, `chore/…`, `test/…`.
Keep one Issue → one small PR. Do not bundle unrelated changes.

---

## 5. Testing rules

- Never delete a test, skip it (`.skip`), lower coverage thresholds, or loosen
  an assertion to get CI green. If a test is genuinely wrong, explain why in the
  PR and get human sign-off.
- New behavior needs a test. Bug fixes need a regression test.
- Tests must be deterministic: inject clocks/seeds, use fixtures or
  record/replay — never hit real external services in unit/CI tests.
- Eval scenarios (`src/evals/`) run inside `pnpm test`, so CI scores every
  change. A baseline diff is not automatically a failure — regenerate with
  `pnpm eval --update` and put the before/after in the PR for a human to read.
- `AGENTS.md`, `.github/`, `vitest.config.ts` and a future `tests/` are owned
  via CODEOWNERS; changes there get extra human scrutiny.

---

## 6. Commands

```bash
pnpm dev         # local dev server
pnpm build       # production build
pnpm typecheck   # tsc --noEmit (strict)
pnpm lint        # eslint
pnpm test        # vitest run (CI mode)
pnpm test:watch  # vitest watch
pnpm coverage    # vitest run --coverage
pnpm eval        # eval scenarios against the mock catalog (offline)
pnpm verify      # typecheck + lint + test + build (run before every PR)
```

Package manager is **pnpm**. Node is pinned via `engines` (>=20.9.0).

---

## 7. External data & models are always untrusted

Every value coming from an LLM, Google Places, Google Routes, or any network
call is untrusted input. It must be validated with Zod at the `providers`
boundary and re-checked by deterministic `validators/` before use. Never let a
model decide dates, durations, or whether two activities conflict.

---

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

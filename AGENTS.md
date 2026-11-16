# Shared agent instructions — MARC for MATA v2

This is the common project guide for Codex, Claude Code, and other coding agents.
Read this file and [PLAN.md](PLAN.md) before beginning work. Agents that do not
automatically discover `AGENTS.md` should be explicitly directed to read both.
Use [README.md](README.md) for setup, environment variables, and API reference.

## Goal

Complete MARC as a trustworthy, accessible, cohesive transit tool for Memphis
riders: accurate and honestly labelled bus information, usable trip planning on
desktop and phones, working accessibility reporting, and protected administration.
Data reliability takes priority over visual polish. A working map alone does not
mean the product is complete.

Live frontend: <https://marc-mata-bus.vercel.app/>.
Local code, another worktree, and the deployed website can differ; always identify
which one you inspected before making claims about current behavior.

## Current authorization

The current request is **documentation only**. Do not change application code,
dependencies, GTFS files, workflows, configuration, or existing worktree changes
as part of this task. Do not commit, push, merge, or deploy for this handoff.
The backlog in `PLAN.md` describes future work; it does not authorize implementing
it now. A later user request to implement work supersedes this documentation-only
boundary for that requested scope.

## Repository map

| Area | Location |
| --- | --- |
| Next.js / React / TypeScript frontend | `apps/frontend` |
| Home/map composition | `apps/frontend/src/app/HomeClient.tsx` |
| Map, bus models, planner, report modal | `apps/frontend/src/app/components/` |
| Public reporting page | `apps/frontend/src/app/access/page.tsx` |
| Admin UI and frontend login endpoint | `apps/frontend/src/app/admin/page.tsx`, `apps/frontend/src/app/api/admin/auth/route.ts` |
| Flask API | `apps/backend/app/api/` |
| Feed client and GTFS matching/planning | `apps/backend/app/services/` |
| Bundled schedules and refresh script | `apps/backend/GTFS/`, `apps/backend/scripts/update_gtfs.py` |
| Backend tests | `apps/backend/tests/` |
| Scheduled refresh | `.github/workflows/refresh-gtfs.yml` |

## Product requirements for future implementation

- Preserve `live`, `mock`, and `unavailable` feed states end to end. Demo data
  must be explicitly enabled and visibly labelled. Never silently replace a
  failing live feed with sample vehicles or count those vehicles as live.
- Distinguish feed availability, data freshness, route-match confidence, and
  schedule validity. A successful fetch or consistent match is not proof that
  a vehicle is on the correct route. Do not fabricate timestamps or confidence.
- Preserve schedule-expiry warnings and holiday handling. Planning against an
  expired calendar is an approximation, not a confirmed departure prediction.
- Keep coordinates honest: do not move buses onto route geometry to hide a
  mismatch. Investigate mapping, trip direction, shapes, detours, and stale data.
- Use real reporting data or explicit empty/error states. Do not present
  hardcoded sample reports, local counters, or account placeholders as real.
- Enforce admin authorization on the backend. A frontend login screen or
  `sessionStorage` flag does not protect direct API calls.
- Use a shared navigation and visual system. Make core rider flows usable by
  keyboard, with readable text, labelled controls, and accessible feedback.
- Preserve existing map selection, route highlighting, trip planning, reporting,
  source labels, and schedule warnings when changing layouts.
- Never put private credentials in client code, documentation, logs, or commits.
  `NEXT_PUBLIC_*` values are public and are compiled into the frontend build.

## Starting and coordinating future work

1. Read this guide, the plan, and relevant code. Inspect `git status --short
   --branch`, `git worktree list`, and recent commits before editing.
2. Check the outstanding `claude/app-shell` worktree described in the plan.
   Its uncommitted changes are existing work to preserve, not scratch files.
   Do not reset, clean, overwrite, stage, or commit another agent's work.
3. Select a bounded plan item and record its owner, branch/worktree, scope,
   dependencies, and acceptance checks in `PLAN.md`.
4. If multiple agents are used, assign separate branches/worktrees and clear file
   ownership. Agree API contracts before parallel frontend/backend edits. One
   integration owner updates shared files and resolves overlaps deliberately.
   This guide does not require spawning agents for every task.
5. Implement only the requested scope. Keep unrelated refactors separate.
6. Validate the changed behavior and update the plan with evidence, limitations,
   and next steps. Record commit/PR/deployment identifiers only when they exist.

## Validation reference

For future code changes, use the checks relevant to the scope. These commands
are a reference, not a statement that they passed during this documentation task.

Frontend, from `apps/frontend` with dependencies installed:

```sh
npx tsc --noEmit
npm run lint
npm run build
```

Backend, from `apps/backend` with `requirements-dev.txt` installed:

```sh
PYTHONDONTWRITEBYTECODE=1 python -m pytest -q -p no:cacheprovider
```

Tracked Python bytecode exists; avoid modifying it incidentally while testing.
For UI changes, exercise desktop and phone widths plus keyboard navigation.
For data/auth changes, cover failure paths, demo/unavailable states, expired
schedules, and unauthorized direct requests as applicable. Use controlled test
data for report creation/resolution; do not mutate production reports for QA.

Keep test results precise: local checks do not verify deployment, and historical
Claude test results are not results from the current session. Report existing
failures separately from failures introduced by a change.

## Handoff format

Update the relevant plan item with:

- Task and status: planned / in progress / blocked / implemented / verified.
- Owner, branch/worktree, and files or API contracts changed.
- Checks actually run and their results; include viewports for UI verification.
- Open questions, blockers, and the smallest useful next step.
- Commit/PR references and deployment verification, if applicable.

Keep durable instructions here and changing progress in `PLAN.md`. Do not create
separate competing plans for individual tools.

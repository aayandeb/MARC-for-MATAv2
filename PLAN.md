# MARC for MATA v2 — completion and handoff plan

Baseline recorded: **15 November 2026**.
Shared operating instructions: [AGENTS.md](AGENTS.md).
Live frontend: <https://marc-mata-bus.vercel.app/>.

## Outcome

Deliver a complete, credible transit experience: riders can understand whether
bus information is live and reliable, plan trips on desktop and phones, submit
and view real accessibility reports, and navigate a consistent, accessible UI.
Administrators can manage reports through protected endpoints.

This handoff is **documentation only**. All unchecked work below is proposed for
a future implementation request. No application changes or deployment are part
of this task.

## Evidence and baseline

Sources: the user's pasted Claude Code conversation, plus read-only inspection
of the local repository and the existing navigation worktree. The live site,
Vercel logs/settings, GitHub Action runs, and test suite were **not** checked in
this documentation session. Historical live-site observations require rechecking.

| Item | State at handoff | Evidence / limitation |
| --- | --- | --- |
| Main checkout | `main`, commit `129d7c2`; initially clean | Includes merged data/GTFS fixes and refresh-workflow fix. |
| Feed honesty | Implemented on main | `mata_client.py` returns explicit `live` / `unavailable` / opt-in `mock`; vehicles API exposes `source`; frontend consumes it. Production state unverified. |
| Schedule maintenance | Implemented on main | Refresh script, calendar exceptions, expiry fallback, planner warning, and `/api/schedule/status` exist. |
| Bundled service window | 15 Nov–5 Dec 2026 | Read from `apps/backend/GTFS/calendar.txt`; this is a dated snapshot, not a perpetual validity claim. |
| Automated GTFS refresh | Workflow present on main | Monday 09:17 UTC and manual trigger; changed feed runs tests before commit/push, unchanged feed skips them. Actual run success and backend redeployment unverified. |
| Shared navigation shell | Uncommitted in separate worktree | `claude/app-shell` has modified home/report pages, new `AppShell.tsx`, and staged deletions of `Header`, `LeftNav`, and `BottomNav`. Not on main. |
| Mobile planner | Still incomplete on main | Desktop sidebar is hidden below `md`; `RouteFAB.tsx` has no click handler. |
| Public reporting page | Still incomplete on main | `/access` contains sample report content and an unwired submission flow. Bus-modal reporting is a separate existing flow to preserve. |
| Admin protection | Missing backend checks on main | `app/api/admin.py` lists/resolves reports without auth; frontend uses a sessionStorage login flag. |
| Off-route reliability | Open | Matching already uses proximity heuristics; vehicles API does not expose match confidence or an off-route flag. Existing heuristics do not establish ground truth. |

Claude's earlier report of 28 stationary mock buses and route offsets up to
7.1 km described the deployment **before** the merged source-label fixes. Do not
repeat those observations as current production facts. The reason the upstream
feed failed was not established. Likewise, Claude reported 32 backend tests
passing and local planner success after the GTFS changes; those are historical
results, not newly run checks.

### Preserve the unfinished navigation work

At handoff, `claude/app-shell` points to the same base commit as main and is checked
out at:

```text
.claude/worktrees/website-completion-design-d86366
```

Its changes are **not captured by the branch commit**. Switching to the branch,
merging it, or cherry-picking its current tip will not recover those edits.
Inspect both staged and unstaged diffs and the untracked `AppShell.tsx` in that
worktree before integrating. Do not delete or clean it.

Claude reported a desktop rail/mobile bottom bar with Map and Report destinations,
active/focus states, removal of fake navigation/account controls, and repositioning
of the champion badge. It reported browser, typecheck, and build success; recheck
these before integration. Admin remains outside the shell.

## Ordered backlog and acceptance criteria

Status key: **planned** = not started here; **verify/integrate** = existing work
needs review; **implemented, verify deployment** = present locally, runtime unknown.
No implementation owner is assigned by this documentation handoff.

### P0 — trustworthy data and protected administration

- [ ] **D1 — Verify feed honesty in production.** Status: implemented, verify deployment.
  Check the frontend's actual backend origin, vehicle response, feed settings,
  function logs, and UI states. Determine why real data was unavailable without
  exposing credentials. Acceptance: live/demo/unavailable are distinct; failed
  fetches and stale positions cannot appear as fresh live service; zero vehicles
  does not make unsupported claims about upstream health. Document what was verified.
- [ ] **D2 — Validate route assignments and position freshness.** Status: planned.
  Trace raw feed IDs, timestamps, coordinates, GTFS mapping, direction, and chosen
  shapes using representative vehicles. Add defensible match/age diagnostics and
  rider-facing uncertainty handling; account for detours and layovers. Choose and
  document thresholds from evidence rather than blindly adopting the old 1 km
  audit cutoff. Acceptance: uncertain matches are flagged or omit misleading
  route overlays; original coordinates remain intact; correct matches still work.
- [ ] **D3 — Verify schedule maintenance end to end.** Status: implemented, verify deployment.
  Check changed/unchanged/failing workflow runs and whether committed updates
  actually redeploy the backend. Confirm service dates, holiday exceptions,
  next departures, and expired-calendar warning locally and after deployment.
  Acceptance: refresh failure is visible, invalid feeds do not replace valid data,
  and approximate outdated schedules are never presented as confirmed service.
- [ ] **S1 — Protect admin APIs.** Status: planned.
  Design server-validated authentication spanning the Next.js frontend and Flask
  backend; protect listing and both POST/DELETE resolve methods. Keep secrets
  server-side and define session expiry/logout behavior. Acceptance: direct
  unauthenticated/invalid/expired requests fail before database operations;
  authorized listing/resolution works; browser storage alone grants no access.

### P1 — complete the core rider flows

- [ ] **U1 — Review and integrate the existing app shell.** Status: verify/integrate.
  Recover the worktree changes above, inspect the full diff, and revalidate.
  Acceptance: Map and Report are reachable on desktop and phones, active/focus
  states work, dead links/placeholders are removed, and navigation does not cover
  map attribution or controls. Decide admin shell integration deliberately.
- [ ] **U2 — Build the mobile trip-planner sheet.** Status: planned; depends on U1 layout.
  Wire the route button to a reusable planner flow rather than a divergent copy.
  Acceptance: origin/destination search, geolocation, results, departures, route
  selection, loading/empty/error/expired states work on phones; keyboard and
  screen-reader access, focus return, dismissal, and scrolling work; desktop
  planning and map interactions remain usable.
- [ ] **R1 — Connect `/access` to real reports.** Status: planned.
  Reuse the reports API and existing bus-modal behavior as appropriate. Define
  route/bus association and the fields the API actually accepts. Acceptance:
  validated submission persists, real reports replace samples, refresh preserves
  results, errors/storage-unavailable states are clear, and failed requests never
  show success. Preserve optional photo/AI behavior with explicit failure feedback.
- [ ] **U3 — Add honest loading, empty, and failure states.** Status: planned.
  Cover map initialization, stops, vehicles, search/planning, and reports; replace
  refresh-reset counters with backed data or remove them. Acceptance: failures
  are distinguishable from valid empty results and offer a useful recovery path.

### P2 — cohesive design and accessibility

- [ ] **V1 — Establish shared visual rules.** Status: planned.
  Align map/report/admin typography, spacing, cards, buttons, and colors using
  existing tokens/components. Increase tiny planner/report text and review the
  280px desktop sidebar. Acceptance: readable content and consistent controls
  without clipping on phones, desktop, or enlarged text.
- [ ] **V2 — Improve map clarity and information hierarchy.** Status: planned.
  Review bus colors/scaling at useful zooms, popup layout, labelled occupancy
  (only if supported by real data), readable stop names, internal IDs, and badge
  placement. Give the idle sidebar a useful next action. Acceptance: vehicles,
  selected routes, controls, attribution, and content remain clear together.
- [ ] **A1 — Accessibility pass across core flows.** Status: planned; continuous with UI work.
  Audit labelled icon controls, keyboard-operable search/listboxes, focus order,
  modal/sheet focus, contrast, touch targets, landmarks, and announced feedback.
  Acceptance: plan a trip and submit a report using the keyboard, without traps;
  labels/states make sense to a screen reader and zoomed layouts remain usable.
- [ ] **V3 — Finish page metadata and theme decisions.** Status: planned.
  Give routes meaningful titles; decide whether a complete dark theme is needed
  after core usability work. Dark mode is optional polish, not a blocker by itself.

### P3 — maintenance and release verification

- [ ] **M1 — Investigate map hot-reload crash.** Status: reported, reproduce first.
  Claude observed a `getLayer` crash during development hot reload. Capture a
  reproduction and check layer lifecycle; also check fresh load and resizing.
- [ ] **M2 — Clean generated/starter artifacts.** Status: planned.
  Review tracked `.DS_Store`/bytecode and unused starter SVGs; remove only verified
  unused files and adjust ignore rules in a dedicated change.
- [ ] **M3 — Add focused coverage for remaining work.** Status: planned.
  Extend existing backend tests for data reliability/auth/reporting and add
  appropriate UI checks for navigation, mobile planning, and report submission.
  Historical claims that the backend has only one test file are now outdated.
- [ ] **M4 — Verify the release.** Status: planned, after core blockers.
  Run relevant checks, test desktop/phone/keyboard flows against the intended
  frontend/backend pair, and record deployed revisions and remaining limitations.

## Completion criteria

The core completion milestone requires P0 and P1 acceptance checks plus readable,
consistent, accessible core flows from P2. Optional dark mode and cosmetic cleanup
can follow. A release is ready when:

1. Riders can distinguish real, demo, unavailable, stale, and uncertain information.
2. Schedule freshness and updates are verified, with visible approximation warnings.
3. Desktop and phone users can navigate, plan trips, and submit/view real reports.
4. Direct unauthorized admin requests are rejected by the backend.
5. Keyboard and responsive checks pass for core flows, with meaningful errors.
6. Relevant tests/build checks pass and the deployed behavior is separately verified.

## Suggested future work boundaries

If the user chooses parallel agents, split ownership into data reliability
(D1–D3), backend admin security (S1), navigation/mobile UI (U1–U2), and reporting
(R1). Coordinate API changes before consumer edits. `HomeClient.tsx`, `Sidebar.tsx`,
`/access`, and global styles are likely overlap points: assign one owner per file
at a time. Apply shared visual/accessibility decisions across these tasks, then
have one integration owner run combined checks and update this plan.

Suggested next implementation step: preserve and review the unfinished app-shell
diff, while prioritizing production data verification and backend admin protection.
Do not recreate work already merged on main.

## Work log

| Date | Scope | Result | Validation / next step |
| --- | --- | --- | --- |
| 2026-11-15 | Documentation handoff | Added shared agent guide and completion plan; no application changes | Compared pasted history with main, calendar, workflow, APIs, and navigation worktree. No tests or live-site audit run. Await a future implementation request. |

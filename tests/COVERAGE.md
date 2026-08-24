# Render-golden coverage — what is actually covered, and what is not

`tests/render_golden_test.ts` renders all **50** surfaces of the two apps and diffs each one against a
committed golden under `tests/golden/`. This file is the honest accounting of what those 50 goldens do
and do not hold, because a coverage number nobody has qualified is worse than no number.

Regenerate deliberately, then read the diff before committing:

```bash
deno run -A tools/render_probe.ts tests/golden
git diff tests/golden/
```

## The inventory (verified against the code, not the spec)

| | count | source of truth |
|---|---|---|
| Finance OS tabs | 22 | `render(t)` — `app.html:1512`; tab divs `app.html:1124` |
| HR OS nav views | 14 | `hrRender()` — `hros.html:1683` |
| …of which `dashboard` is itself a dispatcher | −1 +5 | `HR_DASH.page` — `hros.html:1879` |
| …plus `leave`, which `hros.html:1553` dispatches to two DIFFERENT screens by role | +1 | `HR_EMP_MODE?hrEmpLeave():hrLeave()` |
| …plus `expenses`, which `hrRC()` dispatches over `RC.page` — Submit and a claim's detail | +2 | `hrRCForm()` / `hrRCDetail()` — `hros.html:2000`, `:2513` |
| …plus `expenses` again, in EMPLOYEE mode: two tabs and four different scopes | +1 | `RC.me.isAdmin===false` — `hros.html:1785`, `:1821` |
| …plus `expenses` admin: the Dashboard and Settings' five tabs | +6 | `hrRCDash()` / `hrRCSettings()` — `hros.html:2611`, `:2619` |
| **total surfaces** | **50** | |

All 50 render real, populated content — no surface is covered by an empty state or an error panel, and
`renderSurface()` throws rather than capturing a golden if a screen asks for an action with no fixture.
Smallest golden is 8 lines (`finance.bankfeed`, which genuinely is a launcher button); largest is 847
(`finance.info`). 9,601 lines of committed baseline in total.

## Covered: 50 / 50. Complete for the screen: 44 / 50

Six goldens record a **narrower slice** than the screen can show. They are real coverage of the default
state — the state an operator lands on — but the branch listed is not in the golden.

| surface | in the golden | not in the golden | why |
|---|---|---|---|
| `finance.ap` | inbox list, automation stats, filters | `apRenderDetail()`, `apRenderRules()`, `apRenderSettings()` | all three are behind `AP_DETAIL` / `AP_SHOW_RULES` / `AP_SHOW_SETTINGS`, which default closed. They are panels of the tab, not tabs. |
| `finance.users` | the Users sub-view | Roles, Sessions, Audit, Xero sync sub-views | `renderUsers()` paints a sub-nav and calls `usersView('users')`. The other four are sub-pages of one tab; the spec counts the tab, so they sit outside the 40. |
| `finance.ocr` | the upload form and the “Scan with camera” button | the DocScanner overlay itself | `DocScanner.open()` mounts a camera overlay and needs `getUserMedia` + a real canvas. Another change is unifying DocScanner across both files; a golden of it now would be captured against code that is moving. |
| `hr.clock` | status card, today’s punches, work schedule, mobile tab bar | `hrPushCard()` | it returns `''` unless `PUSH.supported`, which needs `PushManager` on `window`. Stubbing one would assert against a stub, not against the app. |
| `hr.employees` | the employee list, filters and search | `hrEmpForm()` | the edit form is the `HR.editEmp !== null` branch of the same view. |
| `hr.leave` | the ADMIN screen — `hrLeave()` | the EMPLOYEE screen — `hrEmpLeave()` | one nav id, two screens (`hros.html:1553`). `hr.leave.emp` is the other one, captured separately: for as long as it was not, the React port of the employee half could be — and was — missing entirely while this golden stayed green. |
| `hr.expenses` | the claims list | — | all five RC.page states are now their own surfaces. |

Every one of those is a fixture/state change away, not an app change. They are listed rather than
quietly padded into the count.

## Not covered at all, and deliberately

- **`HR_EMP_MODE`, except where a screen only exists there.** `hr.clock` and `hr.payslip` are in
  `HR_EMP_NAV` and not in `HR_NAV`, so they are captured in employee mode — an admin reaching them gets
  a fallback "HR OS / HR" page head, and `hrEmpPayslipsLoad` refuses to repaint at all
  (`HR.view==='payslip' && HR_EMP_MODE`), which is how the first cut of this file captured a loading
  spinner as a whole screen's golden. The other eleven views are captured as a master admin, so the
  employee-mode variant of `profile` is **not** covered. `leave` and `expenses` now are — `hr.leave.emp`
  and `hr.expenses.emp` — each because the React port of the employee half was, or would have been,
  missing entirely while the admin golden stayed green.
- **Role variants** — `HR_VIEWER` (view-only) and non-`HR_MASTER` change what `hrRender()` will even
  route to. Captured as `HR_MASTER=true, HR_VIEWER=false`.
- **Modals and overlays** — `hrAttEditModal`, the confirm dialog, the 2FA prompt, `userForm`,
  `sbiPayeeForm`, the WHT computation page (which `wht_test.ts` covers separately by assertion).
- **Anything after an interaction** — a click, a typed filter, a file drop. These goldens are the
  first paint of each screen.

## Known limits of the harness itself

Written down because each one is a way a golden could pass while the real page is broken:

1. **`document.getElementById` never returns `null`.** It hands back a recording stub for any id. A
   renderer that branches on “is this element on the page yet” always takes the present branch.
2. **Layout is invisible.** This compares HTML, not CSS or geometry. A screen that renders perfect
   markup into a `display:none` container passes.
3. **Delayed timers are inert.** `setTimeout(fn, 0)` runs (that is how the apps defer their data load);
   anything with a delay does not. Poll loops, the 1-second clock tick and toasts are out of scope.
4. **The fixtures are shaped, not captured.** They are built from each renderer and its handler in
   `supabase/functions/portal/`, with plausible Malaysian figures. No production data is in this repo.
   If a handler changes the *shape* of what it returns, these goldens will not notice — that is what
   `tests/route_parity_test.ts` is for.
5. **One company, one month, one clock.** Every golden is `2026-08-18T09:30Z`, pinned to UTC, with
   `Math.random` stubbed. Month-boundary and multi-tenant behaviour is not swept.

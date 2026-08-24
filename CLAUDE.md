# CTG Finance Portal — working agreement

## Repos

| remote | repo | role |
|---|---|---|
| `ctg` | `CTG-Business/ctg-finance-portal` (private) | **source of truth.** All work lands here, **via PR only.** |
| `origin` | `sscctgfinance-cmd/ctg-finance-portal` (**public**) | deploy target — GitHub Pages + the Supabase edge-function deploy. Takes `main` and nothing else. |

**`origin` is the PUBLIC one, and that is deliberate.** The remotes were swapped so GitHub Desktop —
which is signed in as `sscctgfinance-cmd` — pushes to the repo that account actually owns. Pointed at
the private repo it could only ever fail, with *"the repository does not seem to exist anymore"*, which
is what GitHub returns for a private repo you cannot see. Deploying is now the ordinary
`git push origin main` the operator already does from Desktop.

⚠️ **The cost of that swap, and what covers it:** `git push -u origin <branch>` — the habit of every PR —
would now put a work-in-progress branch on a PUBLIC repo. The pre-push hook refuses every ref except
`main` on that remote, so the wrong move fails loudly instead of quietly publishing. Feature branches go
to `ctg`.

That deploy remote still exists because the live site staff use is
`https://sscctgfinance-cmd.github.io/ctg-finance-portal/`. Pages is **not** enabled on CTG-Business, so
cutting that remote loose would freeze the live site while `ctg` kept accepting merges — the failure
would be silent and would surface as "why is my fix not live?" days later.

## Never push to `ctg/main`

A `pre-push` hook refuses it. After a fresh clone, install it:

```bash
cp .githooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
```

It is **copied into `.git/hooks/`, not activated via `core.hooksPath=.githooks`**. That was the first
attempt and it was wrong: `.githooks/` is version-controlled, so the hook only existed on branches that
contained it — and `main`, the branch it exists to protect, did not. The guard silently disappeared
exactly where it mattered, and a test push to the source-of-truth main sailed straight through.

**The hook keys on the remote's URL, not its name.** It used to test `remote_name = "origin"`, which was
correct only while `origin` happened to be CTG-Business; after the swap that same hook would have blocked
the DEPLOY and waved a direct push through to the source of truth — backwards, and silently. A URL cannot
be renamed out from under a guard.
`.git/hooks/` is outside version control, so the hook is active whatever is checked out.

Normal flow:

```bash
git switch -c fix/short-description
# ...work...
git push -u ctg fix/short-description
```

Then open the PR from the link git prints. Merge on GitHub.

## The backend lives in `supabase/functions/portal/` — and only there

If you have edited `portal_current.ts` before: **it is gone** (v209). It was a byte-identical duplicate
of the edge function at the repo root, and the deploy workflow copied it over
`supabase/functions/portal/index.ts` on every deploy. That could not survive the function becoming more
than one file, and a stale 608 KB copy is worse than no copy. CI now fails if it comes back.

The function is four files, all in `supabase/functions/portal/`:

| file | what is in it |
|---|---|
| `index.ts` | the router — `Deno.serve`, the GET/webhook/inbound-email entry points, the auth and tenant gates, and the dispatch to the two handler chains. ~110 lines. |
| `lib.ts` | shared library both halves use: Supabase client, `j()`/CORS, auth + role + tenant guards, TOTP, the Xero OAuth/REST client and cache, the P&L parser, OCR / Document AI, the AP inbound-email pipeline, cron internals. |
| `hr.ts` | HR OS: the reimbursement/claim/leave helpers, the Malaysian statutory payroll engine, and the `hr_` / `attendance_` / `clock_` handler chain. |
| `finance.ts` | Finance OS + platform: cron, login/2FA, users & roles, CTG SSO access, o2o, Xero sync, AP inbox, WHT, SBI, P&L, close, collections, company documents. |

Supabase bundles the whole directory, so relative imports work and the deploy is still one command.
**The URL, the function name `portal`, and the `{api:"..."}` POST protocol have not changed** and must
not — Supabase cron, Xero webhooks, inbound email (Postmark/Resend/SendGrid) and service-worker push
all hold that URL.

Dependencies run one way: `lib.ts` ← `hr.ts` ← `finance.ts` ← `index.ts`. Nothing imports back up the
chain. Put a helper in `lib.ts` only if both halves use it; HR-only helpers belong in `hr.ts` (the
payroll tests lift the engine out of that file by name — see `tools/extract.ts`).

**The handler chain is order-sensitive.** It is one first-match `if (api === "...")` chain, still in its
original order, split across `finance.ts` and `hr.ts` with the HR view-only gate sitting between them in
`index.ts`. Adding a handler is fine; **reordering one across that gate changes who may call it.** Four
handlers are groups (`ctg_access_*`, `clock_*`, `hr_tp1_*`, `hr_stat_ids_*`) that do shared auth in an
outer block before inner per-action branches — never lift an inner branch out of its group.

`tests/route_parity_test.ts` boots the function offline and replays an anonymous POST against all 203
actions, comparing against `tests/route_parity.golden.jsonl`. If you change what an action returns to an
unauthenticated caller on purpose, regenerate it:

```bash
deno run -A tools/route_probe.ts supabase/functions/portal/index.ts tests/route_parity.golden.jsonl
```

## Shared frontend code lives in the root `.js` files

`app.html` and `hros.html` are ~500 KB single-file apps that duplicated code freely. Code that is not UI
now lives in classic scripts loaded before each file's inline `<script>`:

| file | what is in it | loaded by |
|---|---|---|
| `myt.js` | Malaysian time — the ONE `+8h`/`getUTC*` definition, and the `datetime-local` read/write pair (v224) | both |
| `common.js` | the ~20 top-level helpers (PR #28) and `DocScanner`, the camera → edge-detect → PDF pipeline (v212) | both |
| `payroll.js` | the Malaysian statutory engine — EPF, SOCSO, EIS, LINDUNG 24, PCB, and the gazetted tables (v213) | `hros.html` |
| `hr-docs.js` | the statutory FILE layouts (KWSP/ASSIST/CP39/bank) and the payslip / EA / Form E jsPDF drawers (v213), plus the year-end FIGURES — `hrYePaid`, `hrFormEStats` and the whole CP8D file (v222) | `hros.html` |
| `wht.js` | the withholding-tax computation — s.109/s.109B, gross vs net basis, the s.26A service tax and the s.109(2) increase, plus the charging-section table (v215) | `app.html` |
| `o2o.js` | the O2O pharmacy-billing computation — the SKU/Package grouping, the date guard, the 19.2% commission and its master-record override, and the invoice numbering (v217) | `app.html` |
| `salesrecon.js` | the Sales Reconciliation computation — the content-based column/SO/date recognition, the four passes (order lookup → lines → YRDZ numbering → SO suffixing → tally), the Xero CSV and the post body (v219) | `app.html` |
| `gateway.js` | the Gateway → Xero conversion — the four per-gateway parsers (Payex / Atome / HitPay / NTT Data), the column detection, the totals, the data-check block, the CSV and its filename (v219) | `app.html` |
| `pnl.js` | the P&L Analysis model — the cell accessors, `pnlBuild`'s grid (sections, subtotals, Gross Profit, the cost blocks, the % basis), the CSV and its filename (v220) | `app.html` |
| `ap.js` | the AP Inbox's one client-owned rule — `apDeriveKeyword()`, the GL-coding keyword a reviewed bill teaches the engine (v221) | `app.html` |

They are prep for the Next.js migration: this is the code React must import rather than re-express (see
`data/decisions/finance-portal-nextjs-committed.md`). Each file's own header states its contract; the
rules they all share:

- **Classic scripts, never `type="module"`.** The apps wire ~450 inline `onclick="..."` handlers that
  resolve names as globals at click time, and a module's top-level declarations are not global.
- **Nothing runs at load time that reads per-app state.** `DocScanner`'s IIFE and the `typeof module`
  export lines are the only load-time code; none of them touch app state.
- **`DocScanner` is a top-level `const`, so it is NOT on `window`.** Classic scripts share one global
  lexical environment, which is how both apps still reach it by name. `window.DocScanner` is `undefined`,
  and assuming otherwise has already caused a silent fallback to the file picker once — see the comment at
  `hrRCScanTrigger()` in `hros.html`.
- **One documented exception to "reads no app state":** `hrDrawPayslip` reads `HR_EMPLOYER`/`HR_COMPANY`,
  which stay in `hros.html`. `hr-docs.js`'s header says what a bundler has to do about it.

**No shared root `.js` may set a page-relative asset `src`.** A relative `src` resolves against the
DOCUMENT, and the legacy apps are FILES at the root while the React routes are DIRECTORIES
(`trailingSlash: true`), so `./jspdf.umd.min.js` in `DocScanner`'s lazy PDF loader was correct from
`/app.html` and a 404 from `/finance/upload/` — and `common.js` swallows the rejection into
`toast('Failed to build document')`, so every scan on both React scanner screens ended in nothing with
the page looking fine. Resolve against the SCRIPT's own URL instead (`document.currentScript.src`,
captured at load time), which also carries `NEXT_PUBLIC_BASE_PATH` for free without the shared file
knowing a base path exists — React injects these files through `legacyUrl()`, so the prefix is already
there. `tests/docscanner_pdf_url_test.ts` drives common.js's own loader source from four page depths and
sweeps every non-vendored root `.js` for the general form.

**`xlsx.full.min.js` is NOT in `app.html`'s head — `gwLoadXlsx()` loads it on demand.** 952 KB raw,
335 KB gzipped: 54% of everything a Finance page used to transfer, paid by all 22 tabs when six
functions touch it. That one loader (in app.html's Gateway section, Gateway's by birth) is now the
app's ONLY xlsx entry point — `o2oPick`, `o2oOnTenantChange`, `exportCurrent`, `reconPick`, `srFiles`
and `gwHandleFiles` all go through it. It memoises on `window.XLSX` AND queues concurrent callers, so
two exports fired before the fetch lands share one download and BOTH complete; a hand-rolled second
loader is what drops the queued one, and an export that silently does nothing is worse than a slow
page. `tests/xlsx_lazy_test.ts` drives every one of them through `tests/render_harness.ts` with XLSX
genuinely absent, and pins the call-site SET — a bare `XLSX.` added to a cold path is a ReferenceError
no golden can see, because a golden never presses a button. Its own lesson, and the general form of
this file's recurring one: the obvious test for `o2oOnTenantChange` reached it THROUGH `o2oPick`, which
had already loaded the engine, so unwrapping it passed everything; the state that distinguishes them
(`O2O_BUF` set, XLSX absent — what `gwLoadXlsx`'s `onerror` leaves behind) needed its own test.
`jszip.min.js` (98 KB) is still eager, and the React side carries FIVE spellings of the same injector
across `o2o`, `recon`, `salesrecon`, `gateway` and `app/finance/layout.tsx` (v223's ⬇ Export). Both are
named seams, not oversights — but read this before consolidating them: **only the layout's memoises the
in-FLIGHT promise.** `o2o`'s `loadScript`, the one this paragraph used to nominate, checks `window.XLSX`
and otherwise injects, so two callers before the first load lands inject two tags; that is the same
"drops the queued one" failure the paragraph above says a hand-rolled second loader causes, in the
spelling it recommended. Standardise on the queueing shape, whichever file it ends up in.

**A new shared `.js` file is covered automatically — as long as the app loads it.** `tools/extract.ts`
reads each page's own `<script src=>` tags (skipping `*.min.js` vendored libs), so every test that
evaluates `inlineScript()` — the 44 goldens included — parses and runs your file too, and
`tests/shared_scripts_test.ts` fails if one is missing, empty or unparseable. The `cp common.js` step in
`.github/workflows/ci.yml` is still by name and still only covers `common.js`; that gap is now closed
from the tests side, so you do not have to edit the workflow.

## Tabs are addressable by URL fragment

`app.html#tab=wht` and `hros.html#tab=payroll` open that screen, and Back/Forward move between screens
(v213 — `tab()` in `app.html`, `hrNav()` in `hros.html`). The scheme is `tab=<id>` and not a bare `#wht`
because the bare fragment already means other things: `#clock` / `#claims` are what `sw.js` navigates a
push notification to, `#expenses` is read by `hrEmpBoot()`, and `#sso_token=` carries the SSO handoff.
Do not add a second scheme. HR OS employee mode is deliberately not covered — `hrEmpBoot()` picks that
landing view from the employee's pay type.

## The React app lives in `web/` — every screen of both apps is the list in `web/src/nav.ts`

`web/` is a Next.js 16 App Router app, added by the HR Access pilot (v214). It is **additive**: not one
byte of `app.html`, `hros.html`, `index.html`, `sw.js`, `manifest.json` or the five vendored libraries
moved or changed, and the legacy screen the pilot mirrors is still the one staff use.

| file | what it is |
|---|---|
| `web/src/<screen>.tsx` | the screen: a **pure function of its props**. No fetch, no `localStorage`, no `window`. |
| `web/app/<area>/<screen>/page.tsx` | the route: `'use client'`, holds state, loads data, wires handlers. |
| `web/tests/parity.ts` | the relaxation layer — why the two renderers may differ, and why each difference is safe. |
| `web/tests/<screen>.parity.test.tsx` | renders the pure component and diffs it against `tests/golden/<id>.html`. |
| `web/src/nav.ts` | the 36 screens of both apps, the `migrated` flag, and every permission predicate. |
| `web/src/hr-shell.tsx`, `web/src/finance-shell.tsx` | the chrome, one per app, pure. See "The shell is…" below. |

That split is the whole mechanism. Keep it: only the pure half can be diffed against a golden, so a
screen that puts a `useEffect` in `src/` has stepped outside the thing that proves it was migrated
correctly.

**Client-only, and no `app/api/`.** Not a hosting constraint any more — Vercel runs a server — but the
backend is not moving: Xero webhooks, Supabase cron and inbound email all hold the edge
function's URL. A second server in front of it buys nothing and adds a failure mode.

**The session is not bridged and must not be.** `web/src/portal.ts` reads the same
`localStorage['ctg_portal_token']` (and `hr_tenant`) that both legacy apps read. Same origin ⇒ already
signed in. If you are writing an auth bridge, the origin is wrong — fix that instead.

**Base path is one value**, `NEXT_PUBLIC_BASE_PATH`, read in `next.config.mjs` and `web/src/portal.ts`.
There is still not one root-absolute path written by hand anywhere in this repo. Keep it that way.

**The legacy stylesheets are generated, and there are TWO — one per route tree.**
`web/scripts/sync-legacy-css.mjs` writes `web/app/hr/legacy.css` from `hros.html` and
`web/app/finance/legacy.css` from `app.html` on every dev/build/test; both are gitignored and CI fails if
either is committed. Never hand-copy CSS instead. The root layout imports NEITHER — `app/hr/layout.tsx`
and `app/finance/layout.tsx` each import their own, so exactly one reaches any page. That is not tidiness:
the two apps share ~85% of their rules but **38 selectors carry different declarations**, including the
whole `:root` token set (`--panel` is `#141E30` in one and `var(--surface)` in the other), `body`, `.btn`
(min-height 36px vs 44px), `.panel`, `.pill` and `.bigtable td`. Concatenating them means whichever loads
second silently restyles the other app's screens, and nothing would catch it — the parity tests compare
markup, not CSS. A third legacy app is one line in `SOURCES`, one layout, one `.gitignore` line and one
name in CI's "Nothing generated got committed" step (there is no glob).

Run both worlds on ONE origin (which is what makes the shared session real):

```bash
cd web && npm install && npm run build && cd ..
deno run -A tools/serve_both.ts        # /hros.html and /hr/access/ on 127.0.0.1:8765
```

`tools/serve_both.ts` serves repo-root files first and falls through to `web/out`, which is how Vercel
will behave once the legacy files move into `public/` — so `public/index.html` will shadow the React
root route there too. It also answers `/__fixtures/portal` from `tests/render_fixtures.ts`, so the app
can be driven end-to-end without production credentials.

### Migrating the next screen

1. Write `web/src/<screen>.tsx` as a pure component, mirroring the legacy renderer element for element —
   the golden is the contract, so a tidy-up is a diff. Restyling is a separate, visible change.
2. Copy `web/tests/hr-access.parity.test.tsx`, point it at the new golden id and fixture.
3. Make it pass. **Do not add a relaxation to `web/tests/parity.ts` to make a diff go away** without
   proving it cannot hide a real change, and adding a case to the "still bites" block.
4. Leave the legacy screen in place. Deleting it is a later, separate decision.

**`assertHandlerParity()` is copied into each screen's test, not shared.** `web/tests/handlers.ts` is
shared by every screen, so migrations running in parallel are told not to touch it; each test therefore
carries its own small wrapper around the two halves that file exports. Once the in-flight migrations have
landed, folding those identical wrappers back into `handlers.ts` is a safe single change.

**A screen whose rows are identified by a bare integer needs its handler check widened, in its own test
file.** `goldenHandlers()` in `web/tests/handlers.ts` collects QUOTED literals, because on the first two
screens a row is a quoted id (`'u9'`, `'out'`). `hr.approvals` identifies a row by its index —
`hrApvLeaveSet(0,this.value)` — so quoted-only extraction returns `[]` for every row handler and the
parity check would pass with every row wired to level 0. `web/tests/hr-approvals.parity.test.tsx` reads
the golden side with a local `identArgs()` that takes quoted literals AND bare integers; that is a
superset of `goldenHandlers().args`, so it can only tighten the check, and it lives in the screen's own
test rather than in the shared file. Widen the same way, not `handlers.ts`, until a screen proves the
shared default is wrong. `hr.leave` needs BOTH kinds in one comparison — quoted ids for the row buttons
(`hrDecideLeave('lv1','approve')`) and bare integers for the flow levels — and the same `identArgs()`
covers it, so copy it rather than inventing a third extractor.

**A branch the golden does not hold is not covered — say so where you write it.** A golden is one state
of one screen, so empty tables, loading panels and modals never appear in it (`hr.attendance.html` was
captured with data loaded and `ATT.editRow === null`). Mirror them from the legacy source anyway when
leaving them out would wire a button to nothing, and note in the file that the parity test does not reach
them.

**Shared root `.js` is IMPORTED by `web/`, not copied.** `web/src/hr-calculator.tsx` imports the
statutory engine from `../../payroll.js` — the same file `hros.html` loads as a classic script — so the
migration cannot fork the maths. Two things make that resolve: `payroll.d.ts` next to it (web's tsconfig
sets `allowJs: false`, and an ambient wildcard module does not apply to a relative specifier), and
`turbopack.root` pointing at the repo root in `next.config.mjs` (Turbopack will not resolve above its
project root). Declarations only in the `.d.ts` — a rate or table row copied there is a second copy of
the maths that nothing checks. `hr-docs.d.ts` is the same arrangement for `hr-docs.js`, which
`web/src/hr-expenses.tsx` imports for `hrCsv`/`hrBankCode` — the bank BIC table and the CSV quoting rule
are bytes that leave the building, so they are imported, never re-typed.

**A file a screen EXPORTS is not markup and no golden sees it — pin it in the screen's own test.**
`hrRCExportBank()` (hros.html:1849) writes a real bank payment file, and v157 was a TOTAL trailer in it:
a payment row, payee "TOTAL", for the whole batch. `web/src/hr-expenses.tsx` splits it as
`bankFile(claims, ids, today)` — a pure function returning the rows, with the download and the toast left
in the route — precisely so `web/tests/hr-expenses.parity.test.tsx` can assert no row carries TOTAL. Every
other statutory export in this repo ends with one (`hrExpStatutory`, hros.html:4448); a bank file must
not. Split the same way for any export you migrate.

**A handler that calls no screen function needs a positional escape, in the screen's own test.**
`goldenHandlers()` reads `onclick="event.stopPropagation()"` (the selection cell, hros.html:1834) as a
handler with no arguments, but `reactHandlers()` invoking the React equivalent records nothing, so the
two lists fall out of step. `web/tests/hr-expenses.parity.test.tsx` allows a handler to record nothing
only where the golden's own text at that position is `event.stopPropagation()` — so a handler that
quietly stopped calling anything still fails. Note also that `reactHandlers()` invokes with a bare
`{target:{value}}` stub, so such a handler must be written `e.stopPropagation?.()`.

**A legacy screen can emit markup React cannot, and that is a finding, not a relaxation.** `ln()`
(hros.html:4837) writes TWO `style=` attributes on one span, so the colour it means to apply has never
reached the DOM — a parser drops a duplicate attribute. React cannot emit one at all.
`web/tests/hr-calculator.parity.test.tsx` applies the parser's own rule to both sides in its OWN file
(`dedupeAttrs`), with the same justification the six in `parity.ts` carry and its own "cannot hide"
cases. Do the same before widening `parity.ts`: one screen is not evidence about the shared layer.

**A screen whose markup shows a time or a date needs the zone pinned in its own test.** The goldens
were captured with `tests/render_harness.ts`'s UTC override on `Date.prototype.toLocale*`; vitest runs
in the machine's zone, so `toLocaleTimeString` output would differ by wall-clock luck. See the
`beforeAll` in `web/tests/hr-clock.parity.test.tsx` — it re-applies the same override for one file and
restores it. That changes what both sides are READ under, not what counts as a match, so it is not a
relaxation and does not belong in `web/tests/parity.ts`.

**A screen whose markup is DERIVED from the current date needs that derivation lifted out of the
component.** Different problem from the zone pin above: `hr.yearend` builds its Y/A dropdown and its
default year from `new Date().getFullYear()` (hros.html:4921-4922), so a component that read the clock
itself would render 2026…2022 today and start failing on 1 Jan. `web/src/hr-yearend.tsx` exports
`taxYears(now)` and `defaultTaxYear(now)` as pure functions of a Date they are HANDED — the route hands
them the real one, the test hands them `tests/render_harness.ts`'s `FIXED_MS` instant. That keeps the
derivation under test (a shifted dropdown diffs) instead of moving it somewhere the golden cannot see it.

`hr.yearend` is also the second screen to need the bare-integer widening described above (`hrExpEA(0)`,
where `0` is the sentinel for "every paid employee"), and **`hr.dashboard` is the third** — its period
arrows are `hrDashStep(-1)` and `hrDashStep(1)`, so quoted-only extraction returns `[]` for BOTH and the
check would pass with ‹ and › swapped. Its `identArgs()` also keeps the SIGN, which the other two did not
need. Three screens carrying the same local widening is now the majority, so folding it into
`goldenHandlers()` is the next single change to make in `handlers.ts` — do it once the in-flight
migrations have landed, in the same pass as the `assertHandlerParity()` wrappers.

**A screen that DRAWS is compared by its coordinates, and that is the point.** `hr.dashboard`'s two
hand-rolled SVG builders (`hrDashLine` at hros.html:1678, `hrDashBars` at :1674) put computed numbers
straight into attribute values — `d="M42.0 15.5 L142.8 15.5 …"`, `width:97.31958762886599%`. Nothing in
`relax()` touches an attribute VALUE, so those diff to the last digit, which is what makes a rounding
change or an off-by-one in the padding catchable rather than a silent visual lie. Port such maths
character for character; a coordinate you believe is wrong is a `needs-decision:`, not a fix. Two React
spellings will quietly break it: a NUMERIC style value (React renders `opacity: .10` as `0.1` and appends
`px` to a bare `width`), and adjacent `{a} {b}` text expressions — build the string in JS and interpolate
once. `web/src/hr-dashboard.tsx` uses strings for every style value for exactly that reason.

**A screen with two modes behind one route needs both ported, and the mode the golden misses tested
another way.** `hr.employees` is the first: `HR.editEmp` is `null` after every `hrNav()`
(hros.html:1457), so the golden holds the DIRECTORY and the profile FORM appears in no golden at all.
`web/tests/hr-employees.parity.test.tsx` covers it against the contract that actually governs it — the
`hr_*` element ids `hrSaveEmp()` (hros.html:2886) reads the form back out of the DOM by, extracted from
`hros.html` at run time so the check cannot drift from the function it protects. A field that loses its
id there saves as blank, which on that form is a wiped bank account or IC and no error anywhere. Do the
same rather than inventing a golden.

**When a mode is a WHOLE OTHER SCREEN, capture the golden — `hr.leave` is where "tested another way"
was not enough.** `hros.html:1553` is `body=(HR_EMP_MODE?hrEmpLeave():hrLeave())`: one nav id, two
renderers, two data sources, two page heads. Only the admin one was ported, `nav.ts` said `leave` was
migrated for BOTH navs, and so every non-admin — the largest population in the product, mostly on
phones — tapped Leave and got `⚠️ unauthorized`, because the route's only load was `hr_leave_admin` and
`hrCanView()` (hr.ts:1541 → lib.ts:131) does not include `employee`. `tests/golden/hr.leave.html` stayed
green throughout: **a golden cannot see a screen that is never mounted.** The fix was a 41st surface,
`hr.leave.emp`, which is one entry in `tests/render_surfaces.ts` — cheap, and the only thing that makes
the second renderer diffable at all. Distinguish this from `hr.employees` above: there the second mode
is the SAME renderer's other branch, here it is a different function entirely.

**A screen-level parity test cannot see a missing ROUTE, so pin the branch by SOURCE.** The corollary,
and the reason F2 survived: `web/tests/hr-emp-leave.parity.test.tsx` reads `app/hr/leave/page.tsx` at
run time (comments blanked first — the file's own header names `hr_leave_admin` while explaining the
bug, which is `tests/forwarding_page_test.ts`'s lesson again) and asserts three things: it mounts the
employee screen, it decides with `hrRole().empMode` and nothing hand-rolled, and it asks the server for
NOTHING but `me` before that gate. The third is `finance.users`' finding — a gate that exists but sits
downstream of the load leaves the employee eating the same 401. All three were verified by introducing
the defect. Note also which way the failure falls: on a `me` that fails the route picks EMPLOYEE mode,
because the admin screen is everyone's leave plus the approval-chain editor.

**`hrRole('')` is NOT employee mode, whatever nav.ts's own doc comment says.** `empMode` is
`!!r && r !== 'admin' && …` (nav.ts:150), so an empty role is all three flags false and `hrNavFor()`
hands it the ADMIN nav. The comment above that function claims the opposite. Pinned as-is in
`hr-emp-leave.parity.test.tsx`; changing it moves the nav for every login with no role, which is a
decision, not a migration detail.

**A legacy attribute value written without `esc()` is the same finding as the duplicate `style=`.**
`hrEmpCard()` (hros.html:2712) writes `title="… submit claims & clock in"` with a bare `&`; a parser
reads that and `&amp;` as the same character, but React's attribute escaper can only emit the second.
`web/tests/hr-employees.parity.test.tsx`'s `decodeAttrAmp` applies the parser's rule to both sides in its
OWN file, narrowed to `&amp;` inside a double-quoted attribute value, with its own "cannot hide" cases —
same treatment as `hr-calculator`'s `dedupeAttrs`. Two screens have now needed a screen-local rule and
neither moved into `web/tests/parity.ts`; a third of the same KIND is what would justify that.

**The bare-integer handler widening is now in SIX screens' test files** — `hr.approvals`, `hr.leave`,
`hr.yearend`, `hr.dashboard`, `hr.employees` (`hrEditEmp(0)`, where `0` is `hrEditEmp()`'s sentinel
for "a blank record") and `hr.payslip`, where EVERY handler is one (`hrEmpPayslipDownload(0..2)`, the
index into the employee's own payslips — quoted-only extraction would pass with all three rows
downloading the same month). The paragraphs above still read "two screens is not yet a case"; that count is
spent. `identArgs()` is now six identical copies, and folding it into `web/tests/handlers.ts` alongside
the identical `assertHandlerParity()` wrappers is one safe change to make once the in-flight migrations
have landed. Until then, keep copying it — do not edit the shared file mid-flight.

**A legacy screen that writes a NAMED character reference cannot be matched byte for byte.** `hrPayHub()`
quotes UOB's and LHDN's own wording with `&ldquo;` / `&rdquo;` / `&rsquo;` written into the HTML string
(hros.html:4035, :4038, :4041), so the golden holds the eight characters `&ldquo;`. React's text escaper
emits only `& < > " '` as references — a `“` in JSX comes out as the character, and the literal string
`"&ldquo;"` comes out as `&amp;ldquo;`. `web/tests/hr-payroll.parity.test.tsx` decodes exactly those three
to their characters on BOTH sides (`decodeNamedRefs`), with the same justification and "cannot hide" cases
`parity.ts`'s six carry. Same rule as `dedupeAttrs` and `decodeAttrAmp`: it lives in the screen's own
file, not `parity.ts`. That makes THREE screen-local rules, but three of three different KINDS — a
duplicate attribute, an unescaped `&` in an attribute, a named reference in text — so none of them is yet
evidence about the shared layer. A second screen needing THIS one is what would move it.

**A screen with argument-free buttons needs handler IDENTITY compared, not just arguments.**
`assertHandlerParity()` compares the quoted arguments, so `onclick="hrEmployerToggle()"` and
`onclick="hrRatesToggle()"` are both `[]` and the Company button opening the rates editor passes.
`hr-payroll`'s test adds a golden-DERIVED map from the legacy function name to the prop it became
(`LEGACY_TO_PROP`) and compares that sequence too — a strict widening, in the screen's own file. Do the
same rather than trusting the label text, which `relax()` compares but a mis-wire does not change. `hr.profile`
is the second, and there EVERY handler is argument-free, which also breaks the shared guard-the-guard:
hr-clock's `expect(want.some(h => h.args.length > 0))` is unsatisfiable on such a screen. Replace it —
do not drop it — with "every golden handler name resolved to a known prop", so a new legacy button is
still a failure rather than a silent fall-through of `LEGACY_TO_PROP`'s `?? h.raw`.

**`payroll.d.ts` now declares `hrCompute`** — the whole payroll engine, imported by `web/src/hr-payroll.tsx`
so the grid cannot fork the maths. Its field-whitelist warning (hros.html:3732) travels with the call: a
field dropped there makes the browser and the server disagree and 409s the entire company's finalise.

**A screen's PERMISSION gate can live upstream of its renderer — port it into the route and pin it from
`src/`.** `hrClaims()` (hros.html:3699) has no role check in it at all; `hrRender()` does, at
hros.html:1531, forcing `HR.view` away from `claims` whenever `HR_EMP_MODE` is set. So `hr.claims` is an
ADMIN screen (it is in `HR_NAV` under "People", not `HR_EMP_NAV`) whose golden was captured with
`HR_EMP_MODE=false` and no extra setup, and a React port that only mirrors the renderer would serve every
employee's name, category and amount — plus buttons deciding their money — to anyone who typed the URL.
`web/src/hr-claims.tsx` exports `isEmpMode(role)` / `claimsReachable(role)` as pure mirrors of
hros.html:1368 and :1531, `web/app/hr/claims/page.tsx` refuses to load or render on a false, and the
screen's own test pins both directions. Putting the predicate in the route instead would place it where
no test can reach it. Check for such a gate before assuming a renderer is the whole screen.

**`hrClaims()` does NOT wrap its Approve/Reject buttons in `hrRW()`** (hros.html:1374, :3702), unlike
every other admin screen in `hros.html`, so a `viewer` role sees live write controls there. Its golden
was captured with `HR_VIEWER=false` and holds no evidence either way, so the React port mirrors it
as-is — adding the gate is a deliberate behaviour change, not a migration detail.

**A bare `&` in TEXT is the same finding as the one in an attribute, and it is a SEPARATE rule.**
`hrEmpPayslipsRender()`'s footnote (hros.html:3216) writes `EPF/SOCSO/EIS/PCB & deductions` without
`esc()`, and React's text escaper always emits `&amp;`.
`web/tests/hr-payslip.parity.test.tsx`'s `decodeTextAmp` decodes `&amp;` OUTSIDE tags only, and never
where it prefixes another reference — so hr-payroll's doubly-escaped `&amp;ldquo;` is untouched. That
makes FOUR screen-local rules of four kinds; hr-employees' `decodeAttrAmp` is the attribute-only
sibling, and the two together are the first pair close enough that folding a single `&` rule into
`web/tests/parity.ts` is worth deciding once the in-flight migrations have landed.

**Employee-mode screens are a permission boundary: assert the WITHHELD direction.** `hr_my_payslips`
returns `employer` (the company's statutory registration numbers) and `leaveBal` purely so
`hrEmpPayslipDownload()` can draw them into the PDF; the legacy screen renders neither.
`web/tests/hr-payslip.parity.test.tsx` asserts they are absent from the markup, that there is no
`<select>` or employee id anywhere on the screen, and that the only buttons are the per-row PDF
downloads — so a future change that exposes one fails there rather than on someone's screen. `hr.profile`
is the second: it is handed the whole `hr_employees` row — `basic_salary`, `fixed_allowance`, `pay_type`,
`status` — and renders eight fields as read-only text and the pay fields not at all, so its test asserts
no pay figure in the markup, no editable control inside the HR-managed card and no colleague's name.
Guard the guard there too: assert the fixture really carries what must not leak.

**`hr-docs.d.ts` now declares `hrEmpView` and `hrDrawPayslip`**, imported by
`web/app/hr/payslip/page.tsx` so the PDF an employee downloads from React is drawn by the same shared
file `hros.html` loads. `hrDrawPayslip` reads `HR_EMPLOYER`/`HR_COMPANY` as globals (hr-docs.js's own
header says so): the route sets them on `window` before the call, exactly as the legacy caller does.

**A screen that WRITES needs its POST body split out as a pure function and pinned against the legacy
source.** Same rule as the exported bank file above, for the other direction: no golden sees a request
body, so `hrEmpProfileSave()` (hros.html:3383) becomes `profileBody()` in `web/src/hr-profile.tsx` — the
body only, with the fetch, the button state and the toast left in the route. Two things get proven there
and nowhere else. (1) The FIELD SET, read out of `hros.html` at run time rather than retyped in the test
— a retyped list agrees with a widened port by construction, and a field the legacy held read-only is a
privilege escalation however innocent it looks. (2) The TARGET: `hr_my_profile_save` resolves the
employee from the token (`hr.ts:1362`) and the request carries no id, so the proof is the negative —
assert no key is or contains one. `web/tests/hr-profile.parity.test.tsx` also pins the v159 rule that
lives half in each half: an ABSENT `bankCode` means "unchanged", an empty one means "clear it", and the
form paints before `hr_banks_list` resolves.

**A route that reads the company list must keep the `tenant_id`, and EVERY company-scoped call must
carry it.** `hr.yearend` kept only `tenant_name`, so `hr_annual` and `hr_bootstrap` both went out
without a tenant and the screen was `⚠️ no company selected` for everyone. The two failure MODES are
what to learn: `hr_annual` (hr.ts:2876) refuses a blank tenant outright, so it is loud — but
`hr_bootstrap` (hr.ts:979) answers `ok` with an EMPTY employee list, so the same omission there is a
blank picker and no error anywhere. **`tools/serve_both.ts`'s fixture server answers by ACTION NAME and
ignores the tenant**, so neither is reproducible under fixtures and no golden or rendered output sees a
request body. Pin it by SOURCE, in the screen's own test — that the body carries `tenant:` AND that what
it carries is a `.tenant_id`, since sending the NAME satisfies the first check and matches no row. The
layout's picker writes `hr_tenant` and RELOADS (`app/hr/layout.tsx:142`), which is why reading the key
once on mount is correct.

### The exports and the drawing surfaces — v222, the gap after all 36 screens

Every screen was migrated before any of the **files** was. These five are what closed that gap on the HR
side; the payroll statutory-file builders (`hrExpBank` / `hrExpKwsp` / `hrExpAssist` / `hrExpCp39` /
`hrExpSummary` / `hrExpPayslips`) are the seam still open, and `web/app/hr/payroll/page.tsx` still hands
them off. **`HR.submitPack`'s tracker takes the pack as a PROP**, so whoever ports those builders wires
one prop and the panel appears.

**💾 Save entries and Finalise are migrated (F1).** The captain's decision was: match the legacy exactly
— Save sends a DELTA, only the cells that differ from each employee's base record, because that is the
shape `hr_payroll_grid_save` stores and `hr_payroll_finalise` recomputes from. NOT a full row per
employee (React shipped that against `hr_payroll_save_entries`, which the server does not implement, so
Save silently 400'd and Finalise sent no `rows` and was refused "no rows to finalise"). The diff is
`gridSaveAdjustments()` and the finalise rows are `finaliseRows()`, both pure in `web/src/hr-payroll.tsx`
mirroring `hrGridSave()`/`hrFinalise()` (hros.html:4304/:4364) and pinned in
`web/tests/hr-payroll-writes.test.tsx` — that test fails if either reverts to the wrong shape. Both
writes carry the pre-finalise "save first" guard and a SYNCHRONOUS `useRef` double-submit guard (not
`useState`, PR #112). The 13 file/export controls (statutory files, payslip PDF, email, Xero journal,
ZIP pack) are STILL the open seam and still `toLegacy()` in the route.

**The Payroll screen's three RECORD editors are migrated — ⚙️ Rates, 🏢 Company, 🆔 Statutory numbers.**
Distinguish them from the file builders above: a record editor is a form over data an admin already
edits, so it was independent of the (now-closed) payroll save/finalise decision. None of the three is in a
golden (all three render only on a flag every surface was captured with false), so they live in
`web/tests/hr-payroll-editors.test.tsx`, pinned by assertion, and `tests/golden/hr.payroll.html` did not
move. Three things they establish:

- **`hr_payroll_data` carries NO employer record** (hr.ts:1749) — the legacy has one only because
  `hr_bootstrap` put it in `HR.data`. The Company panel therefore FETCHES on open, which gives it a
  loading state the legacy has no equivalent of. Do not add the employer to `hr_payroll_data` for this;
  a panel almost nobody opens should not widen every payroll load.
- **`hr_rates_save` takes no tenant.** One `hr_statutory_rates` row drives every company, which is why
  the server demands a full-scope admin. The body must also start from the CURRENT rates object (v157) —
  it used to replace the row wholesale, destroying any key the panel does not draw — and it reads the six
  DISABLED SOCSO/EIS boxes back, because a disabled input still has a value and dropping them sends
  all-null, which hr.ts:2745 refuses outright.
- **`numRO()` (hros.html:4143) writes TWO `style=` attributes on one input**, by string-replacing
  `<input` into an already-styled tag — so the width, padding and right-align of the six reference-only
  rate boxes have never reached the DOM. `ln()`'s finding (hros.html:4837) in its third place. Mirrored
  as the DOM the legacy actually has, reported not fixed.

**The year-end statutory figures are LIFTED, and the question that decided it is not "does the server
re-derive this?".** `hrDrawEA` and `hrDrawFormE` were already in `hr-docs.js`, so the two PDFs could not
fork — but the numbers they are drawn FROM, and the whole of CP8D, were assembled inside hros.html's
export buttons. Nothing about a filed figure is re-derived anywhere: a second copy is a filing that
eventually disagrees with itself, and it disagrees with LHDN's copy, not with a screen. So `hrYePaid`,
`hrFormEStats`, `hrCp8dFile` and `HR_EA_ZERO` moved into `hr-docs.js` (declared in `hr-docs.d.ts`,
imported by `web/src/hr-yearend.tsx` and its route); hros.html keeps choosing the employee, loading
jsPDF, saving the file and the toast. `tests/yearend_files_test.ts` is the gate and runs through the
LEGACY caller, so it fails wherever the defect is introduced.

**A CP8D file must not end with a total row, and this is the SECOND time that trap has been found here.**
The first was v157's TOTAL trailer in the bank payment file (hros.html:1849) — a payment row, payee
"TOTAL", for the whole batch. CP8D is one record per employee and a trailing total is read by the
uploader as one more employee. Check every file your change produces for the equivalent, and note the
CP8D-specific half: the CSV an operator REVIEWS and the TXT that is UPLOADED must carry the same values,
because a review copy that can disagree with the file proves nothing. Both are asserted.

**Two zone-dependent derivations on a statutory form are pinned by their SOURCE, mirrored not fixed.**
`hrFormEStats` reads `new Date(e.join_date).getFullYear()` and `hrFmtDMY` reads `getDate()/getMonth()`
off a `new Date('YYYY-MM-DD')` — midnight UTC through a LOCAL getter. At UTC+8 (this machine and CI)
every output assertion passes either way; west of Greenwich a 1 January hire drops out of Form E's
`newHires` and a cessation date is declared as the previous day. `finance.calendar`'s finding, on the HR
side, and the same treatment: the source is pinned so a change is deliberate, and changing a declared
figure is a decision, not a migration detail.

**A DRAWING SURFACE has no markup to diff, so its contract is what it captures and what it stores.**
`hrSigBind()` (hros.html:3327) is now `web/app/hr/profile/page.tsx`'s canvas effect, and the parts that
are not device code are pure functions in `web/src/hr-profile.tsx` — `sigTrimBox()` (the ink bounding box
plus its 6px margin, `null` for a pad nobody drew on), `sigUploadSize()`, `sigStoreRefusal()`,
`sigFileRefusal()`. The alpha threshold is `> 8`, not `> 0`: antialiasing leaves a haze, and a lower bar
turns an untouched pad into somebody's signature on a claim form. Split a drawing surface the same way.

**The installable HR app and Web Push are RETIRED — v224, a captain decision at the `os.ctg4u.com`
cutover.** Rationale: every push reminder already went out by email as well, so retiring the phone nudge
loses no channel. Gone from both halves — `hros.html`'s manifest link and iOS install metadata, its
`PUSH` block and card, `web/src/hr-clock.tsx`'s `PushCard`, and the device half in
`web/app/hr/clock/page.tsx`. Gone from the server — `push_pubkey`, `push_subscribe`, `push_test`,
`push_pending`, `approval_reminders`, `clockin_reminder_run`, and the whole VAPID stack in `lib.ts`.
Three things about that are load-bearing and easy to get wrong:

- **`push_unsubscribe` is deliberately KEPT.** The forwarding page on the old GitHub Pages origin calls
  it while unregistering `sw.js`, and with the sender gone the 404/410 prune inside `pushToEmployee()`
  never runs again — so it is now the *only* way a row leaves `hr_push_subscriptions`. `sw.js`,
  `manifest.json` and `logo.png` stay in the repo for the same reason: the old origin must still be able
  to unregister what it installed.
- **The EMAIL clock reminder is a DIFFERENT handler with a name one word away.** `cron_clock_reminders`
  (`hr.ts`) is the survivor and must stay scheduled; `clockin_reminder_run` was the push one and is gone.
  Confusing them silences the channel the retirement was justified by.
- **Removing the card moved NO golden**, and that is the interesting part: `hrPushCard()` returned `''`
  unless `PUSH.supported`, which reads `'serviceWorker' in navigator`, so the offline harness could never
  reach it. `tools/render_probe.ts` regenerates all 40 surfaces byte-identical. A feature invisible to
  the goldens is also a feature the goldens cannot protect — `web/tests/hr-clock.parity.test.tsx` pins
  its absence on both sides by reading `hros.html` and `hr.ts` at run time instead.

Two captain actions this could not do from the repo: **unschedule the two pg_cron jobs** that call
`clockin_reminder_run` and `approval_reminders` (they now hit a removed action every run), and **drop
`hr_push_reminder_log` / `hr_push_config`, then `hr_push_subscriptions` LAST**, after the forwarding
page has stopped needing `push_unsubscribe`.

**Two regions of these screens exist in no golden and never can** (`hrPushCard()` was the third until
v224 retired it — see above). `hrTp1Panel()` and `HR.submitPack` are both reset by navigation
(hros.html:3843, :4375). All three are mirrored from the legacy source and asserted in their screens'
own tests; none needed a seventh relaxation, and `web/tests/parity.ts` and `web/tests/handlers.ts` were
again untouched. Note while you are there that `hrTp1Panel()` writes a category label with a bare `&`
(hros.html:3889, `Medical & education insurance`) — hr-payslip's `decodeTextAmp` finding, in a place no
golden can see it.

### Finance OS screens are NOT HR screens — `finance.wht` is the pilot for the other 21

`web/src/finance-wht.tsx` + `web/app/finance/wht/page.tsx` + `web/tests/finance-wht.parity.test.tsx` are
the first screen out of `app.html`. The split, the pure-component rule and `relax()` are all unchanged —
Finance needed no seventh relaxation — but four things differ and every Finance screen inherits them.

**The route is `web/app/finance/<tab-id>/`, where `<tab-id>` is the tab's own `data-t`.** The same string
`render(t)` dispatches on (app.html:1538), `#tab=<id>` addresses (v213), and the golden is named for
(`finance.<id>`). One id, four places, no mapping table.

**A Finance golden holds NO chrome, so a Finance screen is SMALLER than the HR equivalent.** `hrRender()`
writes a page head into `#hr` before calling the screen's renderer, which is why every HR component
reproduces one. `render(t)` does not — it dispatches straight to `renderWht()`, which owns every byte of
the `#wht` tab div. Finance's chrome (tab rail, company picker, bell) is static markup outside every tab
div and outside every golden, so there is nothing to pass in and no `companyName` prop. A Finance golden
also has ONE section, not two.

**`render(t)`'s `asyncTabs` list (app.html:1504) does not need porting — it is an INVENTORY.** The
`spin(t)` skeleton exists because the legacy app overwrites one shared div by `innerHTML`, so without a
placeholder the operator stares at the previous tab. React renders a loading state as an ordinary branch.
But the list is worth reading: a tab on it fetches before it can paint and its route needs a load step;
a tab not on it (`o2o`, `qinv`, `gateway`, `recon`, `upload`, `collections`…) renders from what it has.

**Check for a permission gate BEFORE assuming a Finance renderer is the whole screen — the mechanism is
different from HR's.** HR gates inside `hrRender()` (hros.html:1531). Finance gates in `showApp()` at
**app.html:1420-1434**, by hiding the tab: seven of the 22 name `!canManage` (`PERMS.manage_users`), two
are force-hidden today (`ocr`, `ap` — Claude vision credits), and the rest key off `PERMS.features`.
Read that block as a whole before trusting one line of it — `users` and `ctgaccess` are gated by two
STANDALONE `if`s above the `if/else if` chain, so `users` also falls through to the chain's final `else`
and its `!canManage` toggle is overwritten by `feats.indexOf('users')<0`. Whoever ports the Users tab
owns that; `wht` is inside the chain and has no such problem.
`renderWht()` itself has no role check at all, so a port that mirrored only the renderer would serve
non-resident payees' names, TINs, treaty positions and withheld tax to anyone who typed the URL. Mirror
that line as a pure predicate exported FROM `src/` (`whtReachable()`), gate in the route, and pin both
directions plus the withheld direction in the screen's test. The server is stricter still — every `wht_*`
handler requires `superAdmin` (finance.ts:1194) — so the client gate is tab visibility, not the boundary.

**`finance.wht` needed BOTH established handler widenings in one file**, and no new one: `identArgs()`
for bare-integer row ids (`whtOpen(1)` — the seventh screen to need it) and a golden-derived
`LEGACY_TO_PROP` for the argument-free buttons. Its `LEGACY_TO_PROP` is keyed on the WHOLE raw text
first, because one of app.html's handlers is an inline statement rather than a call
(`onclick="WHT.payees=!WHT.payees;renderWht()"`) — Finance writes several of those and HR writes almost
none. Keep copying both into each screen's own test; do not edit `web/tests/handlers.ts` mid-flight.

**Two legacy findings raised by this port and deliberately NOT fixed:** `whtPayeeForm`'s rate box saves a
BLANK as `0` (withhold nothing) rather than leaving the rate alone — `pct()` at app.html:3484 is
`isFinite(Number(''))` → `isFinite(0)` → true. And `renderWht()` wraps nothing in a viewer check. Both
are mirrored as-is and pinned in the screen's test; changing either is a behaviour change, not a
migration detail.

**`whtDocHtml()` (`WHT.page==='doc'`) is a sibling PAGE `renderWht()` dispatches to, not a branch of the
list renderer.** It was the pilot's honest strangler edge — `onOpen`/`onNew` handed off to
`app.html#tab=wht` — and it is now migrated to `app/finance/wht/doc/?id=`. See "SIBLING PAGES are not
screens" below for how a sibling page is routed and tested.

**A screen with NO handlers still uses `assertHandlerParity()` — the empty golden IS the assertion.**
`finance.bankfeed` is the first: its launch control is an `<a href target="_blank" rel="noopener
noreferrer">`, so the golden carries not one `on*=`. R1 strips handlers from the string diff, so a port
that turned that anchor into a `<button onClick>` would look identical and would have silently dropped
the href, the new tab and the `noopener` that stops the opened program reaching back through
`window.opener`. The shared guard-the-guard (`want.length > 0`) is unsatisfiable there; replace it — do
not drop it — with `expect(want).toEqual([])`, so a legacy button added later fails rather than passing
vacuously, and pin the anchor's attributes alongside it.

**A NUMERIC character reference is the same finding as `hr.payroll`'s named ones.** `renderBankFeed()`
writes `&#8599;` (↗) into its HTML string (app.html:4063), and React's text escaper emits only
`& < > " '` as references — so neither side can be spelled into the other.
`web/tests/finance-bankfeed.parity.test.tsx`'s `decodeNumericRefs` decodes `&#…;` on BOTH sides in its
OWN file, with the same justification and "cannot hide" cases the six in `parity.ts` carry (including
that it must NOT decode `&amp;#8599;`, the defect where the entity prints on the button). That is the
SECOND screen of the character-reference kind, which by the rule above `hr-payroll`'s paragraph is what
would justify folding ONE reference-decoding rule into `web/tests/parity.ts` — do it in the same pass as
`identArgs()` and the `assertHandlerParity()` wrappers, once the in-flight migrations have landed.

**A `loaded.<tab>` flag is not screen behaviour and does not port.** It belongs to `tab()`
(app.html:1503) — `if(!loaded[t]) render(t)` — and stops a tab switch re-running a fetch and re-painting
the shared div by `innerHTML`. `render(t)` already sets `loaded[t]=true` before it dispatches
(app.html:1539), so the assignment inside a renderer is a no-op. There is no React equivalent to write:
a component is re-rendered freely and is a pure function of props, so a render-once flag in one is state
that can only go stale.

**An ASYNC renderer writes its div TWICE, and the SECOND write is the golden — check, do not assume.**
`renderApprovals()` (app.html:2358) calls `spin('approvals')` (app.html:1536) before it awaits
`{api:'pending'}`, then overwrites `#approvals` with the result. The harness records innerHTML writes by
element id and the last one wins, so `tests/golden/finance.approvals.html` holds the LOADED table and no
skeleton — the OPPOSITE of `finance.qinv`, where the renderer kept going after its write. Both cases come
from the same question, which is the one to ask of every async tab on `render(t)`'s `asyncTabs` list
(app.html:1504): what does the renderer do AFTER its final `innerHTML=`? `renderApprovals()` does
nothing, so the golden is the screen an operator sees and the skeleton is a branch outside it —
`web/src/finance-approvals.tsx` mirrors `spin()` character for character and pins it by assertion.
**`bills === null` (still loading) and a response that carried no `bills` array (app.html:2362, "No
data") are DIFFERENT documents**; collapsing them into one prop paints "No data" during every load.

**A screen of visually identical rows is where a wrong index is invisible — `finance.approvals` is the
first.** Three rows of company / vendor / figure, and each carries
`approve(tenant, invoice, 'approve'|'reject', i)`. R1 strips all of it from the diff, so a Reject button
posting `approve`, an off-by-one `i`, or a row bound to another company's `invoice_id` all pass the
string comparison — and the act is applied or VOIDED in a real Xero ledger. `identArgs()` (the eighth
screen to copy it) is what puts the bare-integer index back; the screen's test drives each mis-binding as
its own case. The busy row is mirrored, not invented: `approve()` sets `opacity:.5;pointer-events:none`
(app.html:2411), which does **not** stop a keyboard activation, so the route also refuses a repeat
decision on a row already in flight — belt and braces over a real legacy gap, not a change to the screen.

**Approvals' gate is the FEATURE flag.** `approvals` is named nowhere in `showApp()`'s branches, so it
falls through to app.html:1434's final `else`. That is now four Finance screens (`collections`, `recon`,
`qinv`, `approvals`) whose gate was NOT their admin-gated neighbours' `!canManage` — read the block, do
not copy a line.

**Reject voids a bill and the legacy asks first.** `showConfirm()` (app.html:2395) is one of the four
modals that were not migrated. `web/app/finance/approvals/page.tsx` uses the browser's own `confirm()`
with the same two sentences rather than dropping the question — a handoff is not available for a control
that lives inside the screen, and silently removing the only thing between a mis-click and a voided
supplier bill is not a migration detail.

**Every legacy `runOnce(...)` is a double-submit guard, and a React port that drops it is a hole in a
ported pattern, not a missing one.** `runOnce` (app.html:1367) disables the button, relabels it and
restores it in `finally`; grep it to find every call site that needs one. React does it INLINE on each
screen — a state flag, an early return in the handler, a `disabled` prop, the release in `finally` so one
network error does not strand the operator — see `finance/qinv` (`busy`) and `finance/salesrecon`
(`posting`). Do NOT build a shared wrapper. Two traps: a flag derived from the RESPONSE (`canIssue` was
`out.kind === 'preview'`, and `out` only changes after the await) leaves the button live for the whole
request — a second set of REAL Xero invoices, one per pharmacy. (`o2o_issue`, finance.ts:609, now ALSO
dedupes server-side: before posting it queries Xero for a non-VOIDED ACCREC invoice under the batch's
`reference` and adopts the existing batch instead of creating a second — the same guard `hr_rc post_xero`
uses at hr.ts:2500, on top of the button guard, because the Xero Idempotency-Key backstop is void the
moment a retry's payload differs. The client guard is still the first line, not a substitute.)
And the route half has no output to assert through, so pin it by SOURCE with comments
blanked, as `web/tests/finance-o2o.parity.test.tsx` does. `disabled={false}` renders no attribute, so no
golden moves.

**A Finance golden can hold almost NOTHING of the screen — `finance.collections` is the case.**
`renderCollections()` (app.html:2425) writes a panel, a paragraph, one button and an EMPTY `#collres`;
every figure the screen ever shows is written into that div by `trigColl()` after the action runs, and
the busy button is mutated imperatively. So the diff proves the copy and the wiring and nothing else,
and `web/tests/finance-collections.parity.test.tsx` carries its own assertions for both `#collres`
states and the busy button. Where a screen's whole useful output is dynamic, a golden-only check is
false confidence — say so in the file and assert the rest.

**Not every Finance gate is `!canManage`.** `finance.wht` is in `showApp()`'s named branches; `collections`
falls through to the chain's final `else` (app.html:1434), so its rule is `feats.indexOf(id)<0` — a
FEATURE flag, not a role. `collectionsReachable()` mirrors that one line from `web/src/finance-collections.tsx`.
Read app.html:1420-1434 as a whole before assuming which kind a tab is.

**Inline styles do not always need the pilot's `st()` splitter.** `web/src/finance-collections.tsx` has
four short styles and writes them as plain objects with STRING values in the legacy declaration order,
which React serialises byte-identically. That only holds while every value is a string and the order
matches; a numeric value or a re-ordered object is the silent break `st()` exists to prevent, so a screen
with more than a handful of declarations should still copy it.

**The Collections button SENDS MAIL, and the copy above it is a promise about who receives it.** The
single action is `{api:'collections'}` → `portal_trigger_collections` (finance.ts:610). `previewBody()`
is split out of the route and pinned against `trigColl()`'s own text in app.html, and handler parity
(`LEGACY_TO_PROP`, since the handler is argument-free) proves the button reaches that action and no
other. Any migrated screen whose button has an outward-facing effect deserves the same two pins.

**`finance.recon` (Bank Rec) adds three more.** Its gate is the FEATURE kind `collections` describes
above, not `!canManage` — `reconReachable()` mirrors app.html:1434 — and its golden is the same
almost-nothing shape: `renderRecon()` writes `#rc_out` empty and `reconRun()` fills it later, so the
cards, the match table and `bankParse()` are all outside the diff and are pinned in the screen's own
test.

**Where the legacy reads a control back out of the DOM, keep the control UNCONTROLLED and keep its id.**
`reconRun()` reads the company from `document.getElementById('rc_co').value`. Making that `<select>`
controlled would add an `onChange` the golden does not carry (handler parity fails) and a `selected`
attribute that only relaxation R5 would absorb. Uncontrolled with the legacy id matches byte for byte,
and the route reads the same id — the same contract the WHT payee form's `wp_*` ids carry.

**Bank Rec matches by AMOUNT, and the client resolves none of it.** `bank_reconcile` (finance.ts:849)
builds one `docs` list — ACCREC first, then ACCPAY — and per bank line takes the FIRST doc within 1 sen
that is not already `used`. Two invoices for the same figure are separated only by that order. The React
screen renders `results[i].match` positionally and must never sort, group or de-duplicate: a port that
tidied a duplicate or re-derived a match would reconcile a payment against a different invoice with
nothing on screen looking wrong. `web/src/finance-recon.tsx` splits `bankLines()` (app.html:5934's
`bankParse` minus the XLSX decode) and `reconcileBody()` out as pure functions for the same reason
`bankFile()`/`profileBody()` were split on the HR side — `reconcileBody('')` throws rather than
defaulting to the first company, because a statement posted with the wrong tenant matches against
another company's ledger and every ✓ is a lie.

**A vendored library a Finance route needs is loaded from the same origin, not imported.**
`xlsx.full.min.js` is injected on first use in `web/app/finance/recon/page.tsx`, exactly as
`app/hr/payslip/page.tsx` injects `jspdf.umd.min.js`.

**A golden can hold an INTERMEDIATE state, and `finance.qinv` is the first that does.** `renderQinv()`
(app.html:3356) writes the form and then calls `qiAddLine()`, which appends a line row with
`appendChild`. `tests/render_harness.ts` records innerHTML writes to elements with ids, so the row never
reached `tests/golden/finance.qinv.html` and `#qi_lines` is captured EMPTY — while every operator sees
one row. The React screen therefore takes a `lines` count whose GOLDEN value is `0` and whose route
value is `1`. Before assuming a golden is the screen an operator sees, check whether the legacy renderer
does anything after the innerHTML write; `.value=`, `appendChild` and `classList` are all invisible to
the harness (`qi_date`'s date is the same story, which is why the component renders no `value`
attribute).

**A Finance screen whose form is read back out of the DOM stays UNCONTROLLED, and its ids AND classes
are the contract.** `qiCollect()` (app.html:4693) reads `#qi_lines > div` and each row's `.qi-desc` /
`.qi-qty` / `.qi-amt` / `.qi-acct`. `web/src/finance-qinv.tsx` keeps every one, and
`web/tests/finance-qinv.parity.test.tsx` extracts both name sets from `app.html` at run time — the
`whtSavePayee()` treatment, widened to classes because a row has no id. A controlled port would also
diff: React emits `value=""` on a controlled input and no golden has one.

**`finance.qinv`'s gate is the FEATURE flag, not `manage_users`.** Quick Invoice is named nowhere in
`showApp()`'s chain (app.html:1420-1434), so it falls through to the final
`else el.classList.toggle('hide', feats.indexOf(t)<0)`. Copying its admin-gated neighbours' line
(`wht`, `selfbill`, `gateway`, `bankfeed`, `salesrecon` are all `!canManage`) would both over- and
under-grant. `qinvReachable()` mirrors the real line and the screen's test pins that it is NOT the admin
gate.

**Not every screen with numbers on it has maths to lift.** The brief's rule — check for shared code
before writing arithmetic — was applied to `finance.qinv` and came back empty: the only computation is
the preview's `Σ qty × unit_amount`, and the AUTHORITATIVE total is the server's
(`finance.ts:780`, and Xero's own `iv.Total` on a live post). That is a display echo, not a second copy
of a formula the way a second `whtCompute` would be, and inventing a `qinv.js` for one `reduce` would be
a larger change than the migration. `qiCollect()` is not liftable as-is either — it reads the DOM. What
IS lifted into `src/` is the part with one right answer: `collect()` (which typed lines become invoice
lines), `invoiceBody()` (the POST, including the contact_id-XOR-contact_name rule) and
`todayLocalISO()` (the +8h MYT date, as a pure function of an instant — hr.yearend's rule).

**A golden whose renderer does nothing after its innerHTML write IS the screen — check, then say so.**
`finance.upload` is the counter-case to `finance.qinv` above: `renderUpload()` (app.html:2450) ends with
`UP_SCAN=null` and nothing else — no `appendChild`, no `.value=`, no timeout, no fetch — and `upload` is
not on `asyncTabs`, so `tests/golden/finance.upload.html` really is the initial screen. That is asserted
against app.html's own text in `web/tests/finance-upload.parity.test.tsx` rather than left as a claim, so
a later `qiAddLine`-style line added to the renderer fails a test instead of silently invalidating a diff.
Do the same check before trusting any remaining golden.

**A Finance screen that takes files IN pins the SOURCE rule, not just the body.** `doUpload()`
(app.html:2487) decides between a scanned PDF and the file picker, refuses nothing-selected and refuses
over 15MB — all before the FileReader. `chooseUpload()` in `web/src/finance-upload.tsx` is that rule as a
pure function, and `uploadBody()` throws on a blank tenant for the same reason `reconcileBody('')` does:
a document filed against the wrong company sits in another company's payables inbox and nothing on screen
says so.

**A route that needs a common.js TOP-LEVEL CONST reaches it by indirect `eval`, not `window`.**
`web/app/finance/upload/page.tsx` is the first: `DocScanner` is a top-level `const` in `common.js`, so it
is in the global LEXICAL environment and `window.DocScanner` is `undefined` (CLAUDE.md says so above, and
it has already caused a silent fallback once). A module cannot import it either — `common.js` is a
classic script with no exports. `(0, eval)('typeof DocScanner !== "undefined" ? DocScanner : null')` runs
at global scope and resolves against exactly that environment; the script is injected from the same
origin, as `app/hr/payslip/page.tsx` injects jspdf. Four lines, and the 600-line camera pipeline stays
unforked — which is the whole point of the shared-`.js` rule.

**A tab that is switched OFF is migrated as OFF, and the re-enable instruction is ported as code.**
`finance.ocr` is the first: app.html:1427 is `el.classList.toggle('hide', true)` — hidden from EVERYONE,
not `!canManage` and not a feature flag — because the Claude vision credits ran out on 2026-07-09, and
the line's own comment says to flip `true`→`!canManage` after a top-up. `ocrReachable()` therefore
returns `false` for every login, and `ocrReachableAfterTopUp()` sits beside it as the intended rule with
its own test, so the instruction survives as something that runs rather than as a comment to rediscover.
`web/tests/finance-ocr.parity.test.tsx` also pins app.html's line verbatim, so re-enabling the legacy tab
fails the React screen's test rather than silently leaving the two out of step. Do not "helpfully" restore
a tab someone turned off.

**A screen whose whole life is in one empty div needs its states listed and asserted.** `renderOcr()`
passes the after-the-innerHTML-write check above (it resets four globals, sets `loaded.ocr`, and stops),
so `finance.ocr`'s golden IS the initial screen — and the initial screen is almost nothing. `#ocr_out` holds
SEVEN things (picked file, camera scan, reading spinner, PDF refusal, failure, the editable bill form, the
posted confirmation) and the golden holds none of them. The bill form is uncontrolled and its `data-k` /
`data-li-i` / `data-li-k` attributes are the contract `ocrPostBill()` (app.html:7215) reads it back by —
the `qi_*` treatment, extracted from `app.html` at run time. A field that loses `data-k` posts as ABSENT
on a real draft bill in Xero. `collectLines()` carries app.html:7226's filter (`description ||
unit_amount || Number(quantity) > 0`): a row with an amount and no description is KEPT, and tidying that
to "needs a description" drops money off a bill with nothing on screen changing.
**`finance.o2o` is the opposite call, and the test is who owns the total.** Quick Invoice's authority is
the server's; O2O's is the CLIENT's — `o2o_issue` (finance.ts:626) recomputes NOTHING, it forwards
`Quantity` / `UnitAmount` / `DiscountRate` straight into the Xero payload. So the arithmetic was lifted
into `o2o.js` (wht.js's arrangement: classic script in `app.html`, `o2o.d.ts` beside it,
`web/src/finance-o2o.tsx` imports it) rather than mirrored, and app.html keeps only the two DOM-facing
halves — the XLSX decode in `o2oParse()` and the form read in `o2oBuildInvoiceNumbers()`. Ask "does the
server re-derive this figure?" before deciding; the answer, not the shape of the code, is what decides.

**The header total is the sum of the ROUNDED lines, never the rounded discount of the gross.** Each line
is `Math.round(gross × (1 − rate/100) × 100)/100` and `total` sums those. The two agree on most data and
diverge by a sen or two on some (50.01 + 50.02 → 80.83 per line, 80.82 from the gross), and only the
per-line answer is the invoice, because Xero re-totals from the line figures. Pinned in
`web/tests/finance-o2o.parity.test.tsx` with a fixture chosen to diverge — a fixture that happens to
agree proves nothing here.

**Three states, not two, for the invoice numbering.** `o2oInvoiceNumbers()` returns `[]` ("let Xero
number them"), `null` ("the operator typed something invalid — do not post") or the numbers. Collapsing
`null` into `[]` posts an unnumbered batch the operator meant to control, and nothing on screen says so.

**`finance.o2o` passes the same post-`innerHTML` check `finance.upload` describes above** — `renderO2O()`
does only `loaded.o2o=true` after its write — with one detail worth carrying: both of its dates are
written INSIDE the html string, so unlike `qi_date` they DO reach the golden. The negative is asserted
out of `app.html` in the screen's own test, the same way Upload's is.

**An O2O screen is one where the same control means different money depending on the company.**
`o2oOnTenantChange()` re-parses the SAME workbook when the target changes, because Skindae groups by
fixed SKU and every other tenant groups by the Package column. `initTenant()` / `isSkindae()` are pure
mirrors in `src/`; the route holds the raw bytes in a ref (`O2O_BUF`) and re-parses, as the legacy does.
Its gate is the FEATURE kind — app.html:1434's final `else` — not `!canManage`, which its neighbours
`wht`, `selfbill`, `gateway`, `bankfeed` and `salesrecon` all use. The screen's test reads
`showApp()`'s block out of `app.html` and asserts `o2o` is named in no branch of it, so the predicate
cannot quietly stop mirroring the app.

**`finance.salesrecon` is the THIRD lift, and it was decided the same way O2O's was — by reading the
server.** `sr_post_invoices` (finance.ts:853) recomputes nothing: it forwards `it.number`, `it.date`,
`it.due`, `it.desc`, `it.qty`, `it.amount` and `it.account` straight into the Xero `Invoices` payload
(finance.ts:870-875), reformatting only DD-MM-YYYY → ISO. So the client owns the figures AND the invoice
numbers, and the arithmetic moved into `salesrecon.js` (with `salesrecon.d.ts` beside it) rather than
being mirrored. app.html keeps only the DOM-facing halves: `srSheetRows()`'s XLSX decode, the render
functions, and `srBuild()`'s I/O — the two Xero lookups, the `confirm()` and the toasts. **Passes 2 and 3
MUTATE `l.inv` in place**, exactly as the legacy loops do; a port that copied the array would have two
arrays that can disagree about an invoice number.

**`srApplySoSuffix` is the one to read before touching anything here.** `sr_so_suffix` reports, per SO,
whether the BASE number is already in Xero and what the highest `_N` is. Three branches, and collapsing
any of them re-offers a number that already exists — Xero rejects the whole batch, or worse, the operator
retries into a partial import. Same class as `o2oInvoiceNumbers()`'s three states.

**Its gate is the ADMIN one and it is named in `showApp()`'s chain** — app.html:1433, `!canManage`,
because it creates draft Sales Invoices in a real ledger. NOT the feature-flag fall-through its
neighbours `recon`, `qinv`, `collections`, `approvals` and `o2o` use. `renderSalesRecon()` has no role
check at all; the server wants `superAdmin` on all three `sr_*` handlers (finance.ts:857, 899, 926).

**Its golden IS the screen on tab open — the `finance.upload` case, checked rather than assumed.** After
its single `innerHTML=` write, `renderSalesRecon()` does four `addEventListener` calls (drag on
`#sr-drop`, change on `#sr-fi`) and nothing else — no `appendChild` (`finance.qinv`), no `.className=`
(`finance.users`). Listeners are invisible to the harness AND carry no attribute, so the React port
attaches them **in the route by the same element ids** rather than as props; adding them as props would be
four handlers the golden does not carry. The screen has ONE mode, no sub-views, and nothing hands off.
What the golden does not reach is `#sr-result`'s BODY — it is captured `hide` with every div empty — so
the cards, the account table, the tally and the 150-row preview are pinned by assertion.

**A strangler edge goes STALE when its target is migrated, and nothing fails when it does.** The "add
this pharmacy to the master" link was an honest handoff to `app.html#tab=pharm` when O2O shipped; the
Pharmacies detail form was migrated afterwards and nobody came back, so for several versions the link
threw the operator out of the React app mid-invoice on a comment that said Pharmacies was unmigrated.
It now goes to `app/finance/pharm/detail/?new=1&name=` — and the fix was not just the URL: the legacy's
delegated listener (app.html:3129-3142) also PREFILLS the name and focuses it, which is the whole point
of the link (the operator clicked because that pharmacy is missing). A handoff that drops what the
legacy did on the other side is worse than the handoff. **When you migrate a screen, grep `legacyUrl(`
for links INTO it.** Everything else here, including the Xero-contact search/link and the JSZip PDF
batch, is ported: an operator who posts live from React would otherwise lose the invoice PDFs, and the
batch only exists in that page's memory.

**A gate can be "always visible, gated SERVER-SIDE" — `finance.pharm` is the first, and the interesting
direction is the REFUSAL.** app.html:1425 is `el.classList.remove('hide')`: no role, no feature flag, and
`portal_pharmacy_list` decides. So `pharmReachable()` is `true` and the branch carrying the security
meaning is what `renderPharm()` (app.html:6603) writes when the server says `ok:false` — a 🔒 panel
naming SKINDAE. A port that rendered an empty table there turns a refusal into "this company has no
pharmacies", which reads as success; no golden holds it, so
`web/tests/finance-pharm.parity.test.tsx` pins the panel AND the negatives (no table, no counts, no
stale list leaking past it). Note the one place `web/src/portal.ts` cannot mirror app.html: common.js
RETURNS an HTTP-200 `{ok:false}` (→ 🔒) and THROWS otherwise (→ ⚠️), while `portal.ts` throws on both,
so the route splits on `e instanceof TypeError` — the safe direction, since it can only over-state a
refusal. `pharmRenderDetail()` (the seven-section profile form, its save/delete and the Xero-link modal)
is a sibling PAGE, not a branch; it is migrated to `app/finance/pharm/detail/?id=`, and it renders the
SAME `Refused` panel this list does — see "SIBLING PAGES are not screens" below.

**A legacy `onmouseover="this.style.background='…'"` is hr-expenses' `event.stopPropagation()` case, not
a new one.** `finance.pharm`'s rows are the first with hover handlers: they repaint the row and call no
screen function, so `reactHandlers()` records nothing for them and the two handler lists fall out of
step. Its test escapes them POSITIONALLY against the golden's own text (so a row handler that quietly
stopped calling anything still fails) and pins the COLOUR each one paints separately, out of the golden.
React needs the guard `if (e && e.currentTarget && e.currentTarget.style)` because the shared walker
invokes every handler with a bare `{target:{value}}` stub.

**A golden can hold TWO sections of one Finance screen, and one of them an INTERMEDIATE state.**
`finance.ctgaccess` is the case, and it sharpens the `finance.qinv` rule above. `renderCtgAccess()`
(app.html:4981) writes `#ctgaccess` — the panel, with a LOADING spinner inside `#ctga_body` — and then
calls `ctgaLoad()`, which awaits the fetch and overwrites `#ctga_body`. Those are two DIFFERENT element
ids, so the harness's last-write-wins is per id and both survive: the golden carries `<!-- #ctgaccess -->`
holding the spinner and `<!-- #ctga_body -->` holding the loaded directory. The `#ctgaccess` section is
therefore the frame at t=0 and not the screen an operator sees. `web/src/finance-ctgaccess.tsx` splits
`Screen` (the panel) from `Body` (whatever is inside `#ctga_body`) so each section is diffed against the
state it was captured in; the screen's test proves the claim by reading `renderCtgAccess()` out of
app.html rather than asserting it. Ask which IDS a renderer writes, not just how many times.

**`ctgaccess` is where `showApp()`'s `if/else if` chain RESTARTS, and that is its whole gate.**
app.html:1423 is a second STANDALONE `if` — `if(t==='ctgaccess') … else if(t==='info') …` — so CTG Access
takes its own branch and never reaches the final `else`. It is `manage_users` and only that. The `users`
line one above it is the opposite quirk (set by `!canManage`, then overwritten by the final `else`), so
copying either neighbour is wrong in both directions. `ctgAccessReachable()` mirrors the real line and the
screen's test pins the two-line source text verbatim.

**A screen-local character-reference rule now exists on THREE screens, of both spellings.**
`finance.ctgaccess` writes `&middot;`, `&hellip;`, `&mdash;` AND `&#8635;`, so its `decodeRefs` covers the
named and numeric forms in one function — after `hr.payroll`'s named-only and `finance.bankfeed`'s
numeric-only. It stays in the screen's own file (parity.ts is shared with in-flight migrations), it
decodes only the three names app.html actually writes here, it never touches `&amp;`-prefixed text, and it
leaves `"`/`'` to R6 — decoding a quote before R4 parses attributes breaks the parse. Folding ONE
reference rule into `web/tests/parity.ts` is now overdue; do it in the same pass as `identArgs()` and the
`assertHandlerParity()` wrappers.

**A golden can hold THREE sections, and `finance.users` is the case.** `renderUsers()` (app.html:5102)
writes `#users` — the sub-nav plus the empty `#uv_body`/`#user_modal`/`#role_modal` divs — and
`usersLoad()` then writes `#uv_body` (the panel, spinner inside) and `#users_out` (the loaded table).
Three ids, so last-write-wins keeps all three, one per legacy statement. The screen is therefore three
components, each diffed against its own section, with handler parity run PER SECTION: concatenating them
would compare a sub-nav handler against a row handler the first time either list shifted. Same question
`finance.ctgaccess` above asks — which IDS does the renderer write?

**And it is the `finance.qinv` trap in a form neither `qinv` nor `ctgaccess` shows: a `.className=`.**
`renderUsers()`'s last statement is `usersView(USERS_VIEW||'users')`, which reassigns every sub-nav
button's className (app.html:5116). The harness records innerHTML writes, so the golden carries
`class="btn sm"` on all five buttons while every operator sees `uv_users` highlighted as `btn sm p`.
`UsersSubnav` takes an `active` prop whose GOLDEN value is `null` and whose route value is the live
sub-view, and the screen's test pins both statements out of app.html so the claim cannot rot.

**The `users` gate quirk `finance.ctgaccess` names above is now OWNED.** `usersReachable()` in
`web/src/finance-users.tsx` mirrors the effective rule — the FEATURE flag, because app.html:1422's
`!canManage` is overwritten by the chain's final `else` — pinned in both directions and against the
shipped `my_perms` fixture, whose feature list deliberately omits `users`. ALL FIVE sub-views are now
migrated — see "A migrated SCREEN is not a migrated TAB" below; what still hands off from this tab is the
six advanced Xero tools below the webhook panel. `🔑 Reset` is `prompt()` plus one POST, with
`resetBody()` split out and pinned against `userReset()`'s own text — no golden sees a request that sets
someone's password.

**`finance.selfbill` is Quick Invoice's case, decided by reading the SERVER.** `sbi_save`
(finance.ts:1394-1401) recomputes gross, `wht_amount` and `net_payable` itself and stores its own
figures, so `sbiRecalc()` is a preview an operator reads, not a second copy of the maths — nothing was
lifted, where `wht.js` and `o2o.js` were. Ask "does the server re-derive this figure?" first; the answer
decides, not the shape of the code. Its one mirrored gap: the preview's net is `gross − wht` while the
server's is `gross + sst − wht`, so a record carrying SST previews low. They agree on everything the
form can produce (it has no SST input — app.html:4399's H7 comment), and both halves are pinned in the
screen's test rather than "fixed".

**`finance.selfbill`'s gate is the ADMIN one and the legacy line says why: it CREATES PAYMENTS.**
app.html:1429, `!canManage` — inside `showApp()`'s chain, not the final `else` its neighbours
`approvals`/`collections`/`recon`/`qinv`/`o2o` fall through to. `renderSelfbill()` has no role check at
all, and the payees panel is a table of individuals' IC numbers and bank accounts, so a renderer-only
port leaks those plus buttons that approve and post payments. The route refuses to LOAD on a false.

**A screen-local handler rule can be needed for a BARE BOOLEAN, and this is the first.** Both Xero
buttons are `sbiPostXero(id, posted)`; `false` posts a SUBMITTED bill and `true` only re-attaches a PDF
to the bill already there. `identArgs()`'s established integer widening reads both as `['12']`, so
`web/tests/finance-selfbill.parity.test.tsx` widens it once more with `\b(true|false)\b` — strictly
additive, in the screen's own file, with a case proving integer-only extraction would not catch the
swap. Copy that, not `web/tests/handlers.ts`.

**A screen can need BOTH reference-decoding rules in one comparison.** `sbiRender()` writes `&rsquo;`,
`&mdash;`, `&ldquo;`, `&rdquo;` and `&rarr;` alongside the numeric `&#8635;`, so the screen's test
carries ONE `decodeRefs` covering hr-payroll's named kind and finance-bankfeed's numeric kind together —
still screen-local, still with its own "cannot hide" block, and still leaving `&amp;` alone so the
doubly-escaped defect stays visible. That is now three screens of the character-reference kind; folding
one such rule into `web/tests/parity.ts` is the change to make once the in-flight migrations land.

**An EMPTY `style=""` is a fifth screen-local kind, and React cannot emit it at all.** `finance.close`
is the case: `closeLoad()` interpolates a conditional straight into an attribute (app.html:5754,
`'<b style="'+(t.status==='done'?'opacity:.55':'')+'">'`), so four of the five golden rows carry
`style=""`. An empty style object, an empty declaration value and `undefined` all serialise to NO
attribute in react-dom/server, so neither side can be spelled into the other.
`web/tests/finance-close.parity.test.tsx`'s `dropEmptyStyle` removes exactly ` style=""` from BOTH
sides, in the screen's own file — same treatment as `dedupeAttrs` and `decodeAttrAmp`, and narrow enough
that any style with content, and every OTHER empty attribute (`value=""` is load-bearing on that same
screen), still diffs.

**A golden handler whose argument is a ternary over `this.checked` needs the STUB's semantics applied to
the golden, not a relaxation.** `goldenHandlers()` collects every quoted literal, so
`closeSet('c1',this.checked?'done':'pending')` yields THREE — the row id plus both branches — while
`reactHandlers()` invokes with `{target:{value}}` carrying no `checked`, so the React side takes the
false branch and records two. `finance.close`'s `stubArgs()` collapses `this.checked?'A':'B'` to `'B'`
before reading the literals: a mirror of the stub, in the screen's own file, and a TIGHTENING — a port
that inverted the mapping records `'done'` where the golden-derived expectation is `'pending'`. The true
branch is unreachable through the shared stub, so it is driven directly against the component in the
same test; do that too rather than leaving half the mapping uncovered.

**`finance.close` is `finance.ctgaccess`'s two-section shape, with a wrinkle: TWO different loading
documents.** `renderClose()` writes `#close` (the frame, holding `<div id="close_out"
class="muted">Loading…</div>`) and then `closeLoad()` overwrites `#close_out` — different ids, so both
writes survive and the `#close` section is the frame at t=0. But the muted bare-text "Loading…" the
frame carries is NOT the `<div class="load"><span class="spin">` that `closeLoad()` paints while its
fetch is in flight; collapsing the two into one null state loses the golden. Its gate is the FEATURE
kind (app.html:1434's final `else` — `close` is named in no branch), while the server requires
`isAdmin` on both `close_list` and `close_update` (finance.ts:819, :826). Nothing was lifted: the
progress percentage is a display echo of rows the server owns, `finance.qinv`'s case.

**`sbiInvoiceHTML()` is ported, not handed off.** It is a DOCUMENT that leaves the building — the
supplier's and the auditor's copy of a payment — so it gets `bankFile()`'s treatment: a pure
`invoiceDocHtml()` in `src/` returning the string, `window.open` left in the route, and the payment
block and the LHDN declaration pinned by assertion. Distinguish it from `whtDocHtml()`, which is a
sibling PAGE the legacy renderer dispatches to and therefore gets its own route.

**A derivation whose defect is ZONE-DEPENDENT must be pinned in the SOURCE, not by its output.**
`finance.calendar`'s `dueLabel()` mirrors app.html:6929, which splits the `YYYY-MM-DD` string by hand and
says why: `new Date('2026-07-30')` is midnight UTC and prints 29 Jul west of Greenwich. A React port
rewritten with the Date constructor passed EVERY output assertion in the screen's test — because this
machine, and CI, sit in MYT — and would print the day before for an operator in London. On a compliance
calendar that is a missed statutory filing. No output check can see it: it is a property of the
environment, not of the value. `web/tests/finance-calendar.parity.test.tsx` therefore reads
`web/src/finance-calendar.tsx` at run time and asserts `dueLabel()`'s body contains no `new Date` /
`getMonth` / `toLocale`, comments stripped. Distinguish this from `hr.clock`'s zone PIN (which changes
what both sides are READ under) and `hr.yearend`'s lifted `taxYears(now)` (which makes the clock a prop):
here there is no clock at all, and the guard's job is to keep it that way.

**`finance.calendar` is NOT a calendar grid, and its gate is `finance.pharm`'s kind.** The migration
brief flagged `calRender()` (app.html:6907) as the screen likeliest to be left on legacy code, expecting
a hand-built month grid. It is four filter buttons, four count cards and one table bucketed by
`x.urgency` — a string the SERVER sends, alongside `days_until`. The client derives neither, so there was
nothing to lift (Quick Invoice's case, not `wht.js`'s). app.html:1426 is `el.classList.remove('hide')`,
inside the `if/else if` chain that restarts at `ctgaccess` — so it never reaches the final `else` and the
feature flag never applies. Its own gap, mirrored not fixed: the overdue pill is `Math.abs(days)`, so a
`days_until` whose sign flipped under an unchanged `urgency` prints identically.

**`finance.gateway` is the strongest LIFT case in the repo, and `gateway.js` is the sixth shared file.**
Ask the standard question — does the server re-derive this figure? — and here the answer is that there
IS no server: the Gateway → Xero converter posts nothing. The CSV is written in the browser and imported
straight into a real ledger, so unlike O2O (which at least posts through `o2o_issue`) and unlike Quick
Invoice (whose authority is Xero's own `iv.Total`) there is no second computation anywhere that could
disagree and be noticed. The four per-gateway parsers, `gwDetect`, `gwTotals`, `gwWarning`,
`gwAuditLines`, `gwCSV` and `gwOutName` therefore moved into `gateway.js` (loaded by `app.html`, typed by
`gateway.d.ts`, imported by `web/src/finance-gateway.tsx`); the converters' ONLY change is taking the
loaded files and the audit accumulator as arguments instead of reading `GW`. The XLSX decode, the DOM
reads and the blob stay in `app.html`/the route, the same split `bankLines()` uses.

**A renderer's follow-up call can produce a SECOND golden section AND three invisible mutations at once
— `finance.gateway` is the worst case of the intermediate-state trap so far.** `renderGateway()`
(app.html:3769) writes `#gateway` and then calls `gwSetProv('payex')`, which does four things the
harness cannot record (`classList.toggle('p')` on the provider tabs, `.textContent` on `#gw-drop-title`
and `#gw-chip-b-t`, `.disabled` on `#gw-convert`) and one it can: `#gw-ref`.innerHTML. That last one is
an element WITH an id nested INSIDE `#gateway`, so `tests/golden/finance.gateway.html` carries an empty
`<select id="gw-ref">` in its `#gateway` section and the four Payex options in a separate `#gw-ref`
section. Two of the invisible mutations genuinely diverge: the golden shows NO highlighted provider and
says "Settlements (payout + fees)" where the live Payex screen says "MDR". So `provider` is
`GwProvider | null`, `null` being the t=0 frame — `finance.users`' `active` prop, in a screen that needed
it for three separate mutations. Ask which ids a renderer writes AND what it assigns after the write.

**A screen whose tabs are MODES has as many modes as tabs, and one golden covers one of them.**
`finance.gateway`'s four provider buttons each select a different set of column names, a different fee
model and a different file layout; the golden covers Payex at t=0 with nothing loaded and `#gw-result`
hidden. Atome, HitPay (the only DERIVED fee rate) and NTT Data (single-file, payout dated on the
transaction date) are outside the diff entirely, as is every figure the screen exists to produce, and
they are pinned by assertion in the screen's own test against `gateway.js`'s real output.

**`finance.pnl` is the SIXTH lift, and it was decided the same way Gateway's was — by reading the
server.** `pnl_analysis` (finance.ts:2034) is a pass-through to the `portal_pnl_analysis` RPC: it sends
per-account `rows[].by_month[m]` and per-month `totals[m]` and re-derives NOTHING, and the screen posts
nothing back (`export_log` carries a row COUNT, not a figure). So every subtotal on a P&L — the section
totals, Gross Profit, each cost block, Total Operating Expenses, the row totals and every % — is derived
in the browser with no second computation anywhere that could disagree and be noticed. `pnl.js` (with
`pnl.d.ts` beside it) is that model plus the CSV; app.html keeps only the DOM-facing halves —
`renderPnl`/`pnlRender`, `pnlCell`, `pnlChip`, `pnlBlockChart` and the download. The ONE thing
deliberately NOT lifted is Net Profit: it is Xero's own figure, taken from `totals[m].net_profit` and
never recomputed as revenue − expenses.

**Its golden is the LOADED screen, and that is the `finance.approvals` case — `renderPnl()` and
`pnlRender()` write the SAME element id.** The spinner goes into `#pnl`, the fetch resolves, and
`pnlRender()` overwrites `#pnl`; last-write-wins is per id, so the skeleton is a branch outside the
diff, not a second section. `pnlRender()`'s `el.innerHTML=` is its last statement — no `appendChild`, no
`.value=`, no `classList` — so unlike `finance.qinv`, `finance.users` and `finance.gateway` there is no
invisible mutation the golden is missing. Its gate is the FEATURE kind (`pnl` is named in no branch of
app.html:1420-1439, so it falls through to the final `else`), while `renderPnl()` itself has no role
check at all.

**A screen can have many modes and one baseline — count them and say which.** `finance.pnl` has THREE
pre-load documents (spinner / `!r.ok` refusal / thrown error) and six independent binary modes once
loaded: account grid vs monthly-totals fallback, 6 vs 12 months, show-zero off vs on, chart with cost
blocks vs "no cost-block data", consolidated vs company-scoped, `generated_at` present vs absent. The
golden covers ONE combination and none of the three pre-load documents, so everything else is pinned by
assertion in the screen's own test — including the whole stacked chart, which the fixture's missing
`blocks` array puts outside the diff entirely.

**A guard that only reads the OUTPUT can miss the half of a defect that has no output.** Removing
`Math.max(0, …)` from `pnlBlockChart`'s stack total leaves every bar SEGMENT untouched — only positive
blocks are drawn — and moves only the total label printed above the bar, so `height="-"` and the
tooltips can never catch it. The first cut of `finance-pnl`'s chart test asserted exactly those and went
green on the defect. Read what each clamp, filter or `Math.max` actually changes before writing the
assertion that protects it.

**A "carries every `data-*` name" check is NOT a check that each field reads the RIGHT value —
`finance.ap` is where that gap was found.** The `qi_*` / `data-k` treatment every uncontrolled Finance
form uses extracts the attribute NAMES from the legacy at run time and asserts each appears. Swapping
`fld('Total','total',ai.total,'number')`'s source to `ai.invoice_no` in the shipped component passed
EVERY such check plus the golden diff — and posts `Number('INV-9')||0`, a real Xero bill for RM 0.00
with the invoice number nowhere on it. `web/tests/finance-ap.parity.test.tsx` closes it by reading the
label→key→SOURCE triples out of app.html's own `fld(...)` calls, rendering with one distinct sentinel
per verdict field, and asserting each `data-bk` input carries ITS source's sentinel and its declared
`type`. Do the same wherever a form's fields are populated from one object — the name check alone is
half a guard.

**A `toLocale*` whose zone the legacy pins EXPLICITLY still needs the Calendar's source pin.**
`finance.ap`'s three date calls all pass `timeZone:'Asia/Kuala_Lumpur'` (app.html:6821, :6913, :6960),
so unlike `hr.clock` the screen needs no zone override in its test — the harness spreads the caller's
options last, so the explicit zone wins on both sides. But DELETING that one option is invisible here
and on CI (both UTC+8) and prints the PREVIOUS DAY west of Greenwich: the fixture's 2026-08-17T02:14Z
reads "17 Aug, 10:14" zoned and "16 Aug, 22:14" unzoned. Verified by breaking the shipped component —
every output assertion still passed and only the source pin went red. So the rule generalises: where a
screen formats an instant, assert the SOURCE carries the zone, not just that the output looks right.

**`ap.js` is the eighth shared file, and it is ten lines — lift by the SERVER test, not by size.**
`finance.ap` is otherwise a NOT-lifted screen (the stat banner is a display echo, and `ap_post`
finance.ts:1838 rebuilds the entire Xero payload itself, taking the TENANT from the inbox row so the
client cannot bind a bill to the wrong company). The one exception is `apDeriveKeyword()`: the client
derives the GL-coding keyword and `ap_rule_save` (finance.ts:1899) stores it verbatim, so a second copy
could drift by one stop word and silently teach a different Chart-of-Account for every future bill
matching it. Ask "does the server re-derive this?" per FUNCTION, not per screen.

**`finance.ap` is the second tab hidden from everyone, and the pair is now a pattern.** app.html:1428
is `el.classList.toggle('hide', true)` with the same 2026-07-09 Claude-vision-credit comment `ocr` (:1427)
carries. Both export `<x>Reachable()` returning `false` AND `<x>ReachableAfterTopUp()` — the intended
admin-only rule — with the route pinned to the first and both tested. Re-enabling either is one line in
app.html and one in `src/`, with its behaviour already proven.

**A Finance screen can have four REGIONS inside one golden section, three of whose bodies the golden
never reaches.** `finance.ap`'s `#ap` is a single write (the `finance.approvals` case — `spin('ap')`
then `apRender()` overwrite the SAME id, so last-write-wins keeps the loaded screen, and `apRender()`
does nothing after its write). But inside it sit the stat banner, the inbox panel, and two COLLAPSED
panels whose bodies (`apRenderRules()`, `apRenderSettings()`) render only on a flag the golden captured
`false` — plus `apRenderDetail()`, the screen's largest renderer, behind `AP_DETAIL === null`, and
`apShowPreviewModal()`, which appends to `document.body` and is not in `#ap` at all. Count regions, not
sections, and say in the PR how many the golden covers.
**`finance.overview` is the first screen whose renderer writes into the SHELL, and the first whose
`insertAdjacentHTML` reaches a golden.** Its golden has FOUR sections. Three are `renderOverview()`'s own
ids; the fourth is `#last-refresh` — app.html:1117's chrome div, which `web/src/finance-shell.tsx:127`
already renders EMPTY and which app.html:2140 reaches out and fills. The React port keeps it a pure
component (`LastRefresh`) so the golden section can diff it, and the route `createPortal`s it into the
shell's div; the shell itself is untouched. The other surprise is that `tests/render_harness.ts:104`
implements `insertAdjacentHTML` as an APPEND to the same recorded string, so the two placeholder divs
`renderOverview()` appends (app.html:2139) ARE in the `#overview` section, empty, while `#ov-trend` and
`#ov-charts` carry their loaded contents as their own sections. `.className=` / `.value=` / `appendChild`
are the invisible ones; `insertAdjacentHTML` is not. This screen passes the after-the-write check
(app.html:2138-2141 does none of the four), and its test asserts that out of app.html rather than claiming it.

**Overview is where "does the server re-derive this figure?" gets its third answer: neither.** It posts
nothing, exports nothing and creates nothing — every figure is a sum of server-supplied per-company
values or an SVG coordinate — so it is `finance.qinv`'s case, not `gateway.js`'s. It is also not
mechanically liftable: `ovPnlBars` / `ovMarginLine` / `ovVendorBars` / `ovCumNet` / `ovDonut` / `ovBars`
build the coordinate and the `<rect>` in one expression, so a shared module would have to return markup.
`hr.dashboard`'s rule applies instead — port coordinate for coordinate and let the golden diff it to the
last digit. Its gate is the FEATURE kind (app.html:1434's final `else`; `overview` is named in no branch).

**Two defects that a plausible test suite does NOT catch — found by introducing them, which is the only
way to know.** (1) `okRows.reduce` → `cs.reduce` in the period mode, i.e. counting a company whose live
Xero fetch failed: it passes against an all-NULL fixture, because `+null` is 0 and the total does not
move. The row that moves it is one the server FLAGGED while still returning figures, which is what
app.html:2113's `c.error || c.income === null` is really about — drive that, not the null row. (2)
Re-rounding a chart coordinate: `Number(x.toFixed(2)).toFixed(1)` is the same string, so a defect written
that way is a no-op. Drive the component's OWN output as well as a mutated golden.

**`web/tests/shell.test.tsx`'s unmigrated example is derived from `FINANCE_NAV`, and since Company Info
there are NO unmigrated entries left — so it also proves the rule against a SYNTHETIC one.** Deriving it
was what let the last migrations land without editing that shared file; but with the set empty both
`unmigrated` loops would pass vacuously, and a guard that cannot fail is not a guard. They are kept (a
screen added to either legacy app lands here unmigrated), the fact that emptied them is asserted
explicitly, and the `#tab=` rule is checked against `{...e, migrated:false}` for all 36 — strictly more
than the real subset ever covered. Do the same rather than deleting an assertion its data outgrew.
**`finance.cfo` is the counter-case to the intermediate-state trap, and both halves of the question
matter.** The CFO Cockpit's golden has TWO sections and BOTH are loaded states — the opposite of
`finance.ctgaccess` and `finance.gateway`, for two different reasons. `renderCFO()` writes a spinner
into `#cfo` and `cfoRender()` overwrites THE SAME id, so last-write-wins erases it (`finance.approvals`'
case); `cfoRender()`'s markup then contains `<div id="cfo-analytics">`, so the `#cfo` section holds that
EMPTY while `cfoAnalyticsLoad()`/`cfoAnalyticsRender()` fill it as its own section — and within that id
last-write-wins again. So ask BOTH halves of the question of every remaining screen: which IDS does the
renderer write, and what does it do AFTER each write? Here the answer after the `#cfo` write is
`loaded.cfo=true` (a no-op) and one loader call, and `cfoAnalyticsRender()` does nothing at all — both
pinned out of app.html in `web/tests/finance-cfo.parity.test.tsx` rather than asserted from memory.

**A read-only dashboard is the clearest "do not lift" there is — `finance.cfo` is `finance.overview`'s
"neither" answer, reached one question earlier.** Before asking whether the server re-derives a figure,
ask whether anything **leaves the building.** CFO Cockpit posts nothing, exports nothing and creates
nothing; `group_dashboard` and `fin_analytics` own every authoritative figure, and what the client
derives (margins, MoM, the P&L footer, bar widths, chart geometry) is a display echo. On a dashboard
that first question settles the second, and it settles it without reading the server at all. Its ten
chart builders are therefore mirrored coordinate for coordinate — `hr.dashboard`'s rule, the same call
Overview made for the same reason — and the goldens diff them to the last digit.

**A threshold no test CROSSES is a threshold a port can move, and a golden cannot see it.** The strongest
finding of this migration, from deliberately breaking the shipped component: widening the intercompany
red/green rule from `Math.abs(diff) > 1` to `> 100` — hiding a RM 99 disagreement between two companies'
ledgers — passed every test in the file, because the fixture's difference (500) is on the same side of
both. A case that only moves the DATA to the other side proves the branch exists, not where the boundary
is. Drive such rules AT the boundary (1 vs 1.01, both signs). The same pass found a second: an assertion
looking for a bare `🔴` passed with the health-dot fall-through inverted, because the alerts panel above
prints one too — scope a colour/glyph assertion to its own cell, not to the document.

**`finance.cfo` needed TWO screen-local rules, both of established kinds, and no seventh relaxation.**
`decodeRefs` (`&rarr; &divide; &times;`) is the FOURTH screen of the character-reference kind after
`hr.payroll`, `finance.bankfeed` and `finance.ctgaccess`; `decodeTextAmp` (the bare `&` in `P&L`) is the
SECOND of hr.payslip's kind. Note the interaction the fourth copy makes explicit: such a rule must NOT
decode `&nbsp;`, because parity.ts's R2 deliberately canonicalises the CHARACTER to that ENTITY so a
dropped nbsp stays visible — decoding it hands back the exact silent failure R2 exists to prevent. That
case is in the file's `still bites` block. Folding one reference rule into `web/tests/parity.ts` is now
four screens overdue.

**`ytdYear(now)` is the third lifted clock derivation** (after `hr.yearend`'s `taxYears(now)` and
`finance.qinv`'s `todayLocalISO()`), and the THIRD screen to pin the IMPLEMENTATION rather than the
output — after `finance.calendar`'s `dueLabel()` and `finance.ap`'s explicit `timeZone` option, which is
the same finding in its third form: `cfoRender()`'s `new Date(Date.now()+8*3600000).getUTCFullYear()` is
the MYT year computed
without a timezone database, and rewriting it as `getFullYear()` is invisible to every output check this
fleet can run — `finance.calendar`'s finding. Distinguish it from the analytics stamp on the same screen,
which is `hr.clock`'s case (the instant is DATA; only the zone it is read in varies) and is pinned by
re-applying the harness's UTC override for the length of the test file.

**`finance.info` (Company Info) was the LAST screen, and the strangler is complete.** All 36 screens of
both apps have React routes; `web/src/nav.ts` carries `migrated: true` on every entry. Its golden is the
biggest in the repo (57 KB) and holds TWO sections, NEITHER of them an intermediate state — the rarer
answer to the question `finance.qinv`/`finance.users`/`finance.gateway` raise. `renderInfo()` writes
`spin('info')` and `infoRender()` overwrites the SAME id (`finance.approvals`' case, so the skeleton is
gone), and `infoRender()` then calls `infoRenderSearch()`, which writes `#info-search-results` — a NESTED
id (`finance.gateway`'s `#gw-ref` shape) that a blank query fills with the EMPTY STRING. The one
imperative mutation, `box.style.display`, happens to agree with the inline style the `#info` markup
already carries, which is why this screen needed no `active`-style t=0 prop.

**Its screen-local rule is an EMPTY CSS DECLARATION, `;;` — the seventh kind, and React cannot emit it.**
app.html:5985 interpolates a conditional straight into a style attribute, so eight Quick-view fields
carry `style="font-size:13px;;margin-top:2px;…"`; React's style serialiser emits nothing at all for an
empty value. `collapseEmptyDecl` in `web/tests/finance-info.parity.test.tsx` turns `;;` into `;` inside a
`style="…"` value on BOTH sides and nowhere else — `finance.close`'s `dropEmptyStyle` family, narrower.
`tests/golden/finance.info.html` is the ONLY golden in the repo containing `;;`. **parity.ts's six
relaxations were again untouched, which is now what all 36 screens have done.**

**Its handler parity needed the bare-word widening in a THIRD spelling, and a `&quot;` decode.**
`infoCopy()`'s argument is written with `JSON.stringify(v).replace(/"/g,'&quot;')`, so the golden carries
no real quotes and `goldenHandlers()` returns `[]` for every one of the two dozen 📋 buttons; and
`infoFolderOpen(f1)` / `infoDocDownload(d1)` interpolate an id UNQUOTED. Both live in the screen's own
file. **The in-flight migrations this file kept deferring to HAVE now landed**, so the three
consolidations it names are unblocked and safe to do in one pass: fold `identArgs()` and the identical
`assertHandlerParity()` wrappers into `web/tests/handlers.ts`, and fold ONE character-reference decoder
into `web/tests/parity.ts` (five screens now carry one) — taking care that it must NOT decode `&nbsp;`,
which R2 deliberately canonicalises the other way.

**Nothing was lifted, and the reason is worth reading before the next screen like it.** `company_info_save`
(finance.ts:2473) forwards `p_patch` verbatim and re-derives nothing, so the client owns what it POSTS —
but nothing this screen COMPUTES is posted: the patch is the operator's own typing, read back out of the
form. The fill badges, their colour and `infoDocBytes()` never leave. That is Quick Invoice's case. What
IS split into `src/` is the part that does leave: `savePatch()` (blank capital DELETED not posted as 0,
blank date deleted), `saveBody()` (throws on a blank tenant, `reconcileBody('')`'s rule) and
`printDocHtml()` (`sbiInvoiceHTML()`'s treatment — a report an auditor reads, so the string is pure and
`window.open` stays in the route).

**Two clocks, and they are NOT the same one.** The document-expiry badge compares `todayLocalISO()`
(app.html:1263 — MYT by construction) against `inDaysLocalISO(90)` (common.js:28 — the MACHINE's zone,
via `localISO()`'s `getFullYear/getMonth/getDate`). Mirrored, not fixed, and BOTH pinned by their SOURCE
— `finance.calendar`'s finding in its fourth form. No fixture document carries an `expiry_date`, so all
three badge branches are outside the golden entirely.

**SEVEN defects passed a plausible test suite here, and every one was found by introducing it.** Worth
the pattern, not just the list: each was invisible because the FIXTURE happened to sit on the safe side
of the branch. The sidebar's ●/○ dots hardcoded to ● (the golden's company is 19/19); the company-tab
highlight following the FIRST company (the golden's active company IS the first); the website link
dropping its `https://` prefix (the fixture's website already has a scheme, so a bare domain resolves
RELATIVE to the page); a file row wired to `docs[0]` (the fixture leaves one document in the root); the
search summary slicing VALUES instead of COLUMNS (no fixture row has a blank leading column); the
Move-to dropdown offering the folder a file is already in; and `preventDefault`/`stopPropagation`
disappearing from the 19 sidebar anchors, the breadcrumb and the folder 🗑 — where the recorded ARGUMENT
is identical either way, so handler parity cannot see it. **Ask of each guard which side of its branch
the fixture sits on**, and drive the other one.

### The portal is ALWAYS MALAYSIAN TIME, and `myt.js` is the only place that is written

**v224, and it is a behaviour change to live software, not a migration detail.** Both legacy apps are
what staff use, and the module below is loaded by both, so what changed is what staff see today.

`myt.js` (+ `myt.d.ts`) is the sixth-and-a-half shared root script: `mytDate` / `mytISO` /
`mytISOPlusDays` / `mytYMD` / `mytDtLocal` / `mytFromDtLocal`, loaded by `app.html` and `hros.html`
BEFORE `common.js` and imported by `web/` the way `payroll.js` is. Malaysia is UTC+8 with no DST, so
`+8h` read back through `getUTC*` is Malaysian wall time in every browser **with no timezone database**
— which is why it is arithmetic and not `timeZone: 'Asia/Kuala_Lumpur'`. Read its header before adding
a date anywhere; it names what is deliberately NOT Malaysian.

**`todayLocalISO()` used to be two different functions** — app.html's was MYT, hros.html's was the
MACHINE's zone. Same name, two apps, two answers. Both now delegate. That trap is closed, and the
audit asserts it stays closed in both directions.

**Three carve-outs, and they are decisions, not misses.** A date that feeds a **filed or reported
figure** does not move without finance sign-off: `hrFormEStats()` (hr-docs.js:267, the captain's
explicit carve-out — a 1 January hire dropping out of Form E's `newHires`), `hrFmtDMY()`
(hr-docs.js:229 — a cessation date on an EA form / CP8D, and `deno test` under a western zone fails on
it **today**, before and after v224), and `myLindungActive()`'s no-period fallback (payroll.js:48).
`web/tests/timezone-audit.test.tsx` pins all three as carve-outs, so "finishing the job" is a red test
rather than a silent filing change.

**What is deliberately still not Malaysian, and why it CANNOT be here:** the BARE `toLocale*` calls that
display an INSTANT (a punch time, a password-reset stamp). `tests/render_harness.ts` makes the local
getters read as UTC and forces `timeZone:'UTC'` on every `toLocale*`, so shifting one by 8 hours moves a
committed golden — and regenerating 44 goldens is a bigger, separate change. The consequence is real and
worth knowing: an admin abroad sees a Malaysian hour in the punch EDITOR and their own in the punch
TABLE beside it. Fixing that means regenerating goldens on purpose.

### Every date read in `web/` is inventoried and pinned — `web/tests/timezone-audit.test.tsx`

This fleet and CI both sit at UTC+8, where a whole class of defect is invisible: `new Date('2026-07-30')`
is midnight UTC and prints 29 Jul west of Greenwich. The Calendar port was rewritten that way and all 29
of its tests still passed. **An output assertion cannot see this. The guard has to be on the source —
and the suite has to be RUN somewhere else.** `TZ=America/New_York npm test` in `web/` is the other half
and is green; a fix that is only green at UTC+8 has proven nothing. v224 measured it: the same
machine-zone regression trips **11** tests in New York and **2** at UTC+8, one of those a source pin.
A test FIXTURE built from local parts (`new Date(2026, 7, 18, 12)`) is the same trap one level up — it
is a different instant in every zone, and it made `finance-o2o.parity` fail in New York until it became
an epoch instant.

That file is the audit. It scans every `.ts`/`.tsx` under `web/src` and `web/app` for date tokens in
CODE (comments blanked — several files QUOTE `new Date` to explain why they do not call it), and every
hit must be accounted for by an `INVENTORY` entry whose per-file COUNT matches. **A date read added
anywhere fails there until somebody classifies it** — that count is what stops the audit becoming a
snapshot. Four kinds are pinned, and mixing them up is the defect:

| kind | shape | where |
|---|---|---|
| MYT | `Date.now() + 8*3600000` read back with `getUTC*` | `myt.js`, plus eight inline copies in `web/` that predate it and are individually pinned |
| MYT_SHARED | delegates to a `myt*` helper and spells no clock idiom of its own | every derivation v224 converted |
| LOCAL | `getFullYear/getMonth/getDate` on a bare `new Date()` | two left, both zone-FREE: `finance-qinv`'s `fmtDate` and `hr-payroll`'s `dueInfo` subtraction |
| UTC | `toISOString()` | the punch POST — an instant, correctly zone-free |
| BARE | `toLocaleString()` with no locale and no `timeZone` | app.html:4919/:4978, hros.html:4303 — an instant DISPLAYED, and pinned by the goldens |

**The strongest single line in it is the blanket: nothing in `web/` may pass a `timeZone` except
`finance-ap.tsx`, whose legacy passes one.** Adding `Asia/Kuala_Lumpur` to any zone-less `toLocale*` is
an *improvement* that makes React and the legacy disagree about when something happened — and it passes
every output assertion here. Three such additions passed the whole suite before that line existed.

**The audit's own first cut had seven guards that did not bite**, all found by introducing the defect
rather than by reading: the named helpers were pinned and the INLINE reads — a `useState` initialiser, a
JSX expression, a one-line arrow — were not. They are the `SNIPPETS` table now. Note also that
`finance-overview.parity.test.tsx`'s harness override forces `timeZone:'UTC'` **last**, overriding the
caller, where `hr-clock`/`hr-attendance`/`finance-cfo` spread the caller last — so on Overview a zone
added to the component is invisible to the golden as well. Pin by source, not by output.

**No category (b) was found: not one React date read exists that the legacy does not have at the same
point.** v224 then converted the zone-blind ones in BOTH renderers in one commit, which is the only way
to change one — a React-only fix makes the two apps disagree about what day it is, and no golden and no
output assertion on this fleet can see that either.

**A `datetime-local` box is a PAIR, and a pair that agrees with itself proves nothing.** `hrDtLocal()`
filled the punch editor with the machine's wall clock and `hrAttSave()` read it back with
`new Date(value)`: a perfect round trip, invisible to every test, showing an admin outside Malaysia an
hour the punch was never at — so correcting the NOTE on that form re-posted a MOVED punch. Somebody's
paid hours. `mytDtLocal`/`mytFromDtLocal` are the replacement pair and the audit drives the round trip
across a month end AND asserts what the box SHOWS, because only the second half catches a machine-zone
rewrite. Note also that `null` there means "no instant" and must stay empty: a helper that read a null
`clock_out` as "now" puts the current time in an OPEN punch's box, one Save from clocking that person
out.

### SIBLING PAGES are not screens, and they live NESTED under their tab's route

A migrated renderer can dispatch to another PAGE rather than render a branch: `renderWht()` swaps `#wht`
between `whtListHtml()` and `whtDocHtml()`, `pharmRender()` between the list and `pharmRenderDetail()`,
`hrApprovalsRender()` between `hrApvLeave()` and `hrApvRc()`. Those three were the last handoffs back to
the legacy apps and are now ported: `web/src/finance-wht-doc.tsx`, `web/src/finance-pharm-detail.tsx`,
`web/src/hr-approvals-rc.tsx`, with routes at `app/finance/wht/doc/`, `app/finance/pharm/detail/` and
(no new route) the existing `/hr/approvals/` under `tab === 'rc'`.

**A sibling page's route is NESTED under the tab's own directory and takes `?id=`.** `web/tests/shell.test.tsx`
checks `app/finance/`'s **top-level** directories against `nav.ts`'s 22 tab ids, so a top-level
`wht-doc/` would fail it — and should: a sibling page is not a nav entry and must never become one.
`useSearchParams()` needs a Suspense boundary under `output: 'export'`; read `location.search` in the
mount effect instead.

**No golden holds any of them, which changes the job.** With no baseline there is no `relax()` diff to
lean on, so each test asserts STRUCTURE — the field ids the legacy reads the form back by, the POST
body, the printed document's own text, and which control is bound to which row — and reads every claim
about the legacy out of `app.html` / `hros.html` at run time. Whether to capture new goldens: see
`tests/COVERAGE.md` and the note at the end of this section.

**An uncontrolled legacy form ports as UNCONTROLLED + a re-mount key.** All three legacy pages read
their form back out of the DOM (`whtSync()`, `pharmCollect()`, `hrApvWfSyncInputs()`), and all three
re-materialise every input by rewriting `innerHTML` whenever state changes a field from OUTSIDE it —
picking a payee rewrites the WHT rate box, adding a step re-renders the workflow form. The React
equivalent is `defaultValue` + the legacy ids + bumping a `gen` counter used as the component's `key` on
exactly those events. Typing never bumps it, so the caret never moves. Going controlled instead is a
caret-jump on every keystroke that moves a derived cell.

**A page that can be REFUSED must render the refusal as a refusal on the sibling page too.** Pharmacies
is gated server-side, and the detail page loads `pharmacy_list` itself (a URL cannot rely on
`PHARM_DATA` already being in memory). `Refused` / `Failed` are exported from `web/src/finance-pharm.tsx`
and imported by the detail page rather than re-written: an empty TABLE reads as "no pharmacies", an
empty FORM reads as "this pharmacy has no details" and comes with a Save button.

**Three legacy findings raised here and deliberately NOT fixed.** (1) `whtDocHtml()` writes TWO `style=`
attributes twice — on the "Fee (RM)" header (app.html:3438) and on the "Total payable to LHDN" cell
(app.html:3449) — so that column's min-width and that figure's coral colour have never reached the DOM.
Same finding as `ln()` (hros.html:4837); React cannot emit a duplicate attribute, so the port matches the
DOM the legacy actually has. (2) `whtRecalc()` (app.html:3369) never updates `w_grossbase`, so typing an
amount moves the tax and leaves the fee it was charged on stale; the React port derives everything in one
pass and *cannot* reproduce it — a divergence in the safe direction. (3) `tests/render_fixtures.ts`'s
`hr_rc_config.role_approvers` writes `claim_role`, but the server returns `hr_claim_role_approvers.*`
(hr.ts:1966) where the column is `role` — which is what `hrApvRc()` groups by. Under that fixture every
role reads "none", which is the same output a broken grouping gives, so `web/tests/hr-approvals-rc.parity.test.tsx`
builds its own approver rows in the server's shape.

**Two guards that did NOT bite, found by introducing the defect.** Counting a printed document's
DESCRIPTIONS does not catch blank rows reaching a statutory filing — a blank row has no description
either; count ROWS. And "the Xero suggestion is computed over the whole contact list, not the filtered
one" is UNOBSERVABLE in the markup (the badge can only land on a row that survived the filter), so it is
pinned against app.html's source instead of asserted through a render. Ask of every guard which side of
its branch the fixture sits on, and whether the property is visible in the output at all.

### A migrated SCREEN is not a migrated TAB — `finance.users` had five sub-views and shipped one

The 36-screen strangler counted `render(t)` targets. `finance.users` is one of them and is really FIVE
screens behind one `data-t`: `usersView()` (app.html:4680) dispatches over `users` / `roles` / `sessions`
/ `audit` / `xero`, plus two modals (`userForm()`, `roleForm()`). Only `users` had a golden, because
`renderUsers()` opens on `USERS_VIEW||'users'` and the harness never reached the other four renderers.
All five now render in `web/app/finance/users/page.tsx`; the rules that came out of closing that gap:

**Where there is no golden, pin the legacy's own STRING LITERALS and render every branch.**
`web/tests/finance-users-subviews.test.tsx`'s `pinsLegacyMarkup()` reads each legacy renderer out of
app.html at run time, extracts every complete markup fragment it concatenates, puts BOTH sides through
the same `relax()` the 36 golden diffs use, and requires each fragment to appear in the React render of
the state that produces it. That is byte-level on everything the legacy spells statically AND it reaches
branches no golden can hold (empty tables, error boxes, the not-configured webhook panel) — but it
CANNOT see two correct fragments emitted in the wrong ORDER, so per-row handler binding and per-figure
assertions still carry that half. Two mechanical traps, both solved in that file: app.html contains
REGEX literals whose `[' ]` classes desync a whole-file quote scanner (`whoSafe`'s
`.replace(/['\\]/g,'')`, app.html:4704), so literals are read LINE BY LINE and an unbalanced line is
dropped — with an assertion that no dropped line carried markup; and a fragment that begins or ends
mid-attribute cannot survive R4's attribute SORT, so it is discarded rather than compared under a rule
that would pass either way. React also fixes `value` at the END of an `<input>` however the JSX orders
it, which is why every "is this box ticked" check reads the whole tag, not a position inside it.

**A conditional space in the legacy is not the same document as an unconditional one.** `normalise()`
splits on `><` only, so `'</b> '+pill+'<br>'` with an empty pill is ONE line (`</b> <br>`) while
`</b><br/>` is two. Transcribe `{' '}` unconditionally where the legacy concatenates a bare space, and
conditionally where the legacy puts the space inside the conditional string (`roleDelete`'s
`' <button…'`). Every screen-local markup pin turns on this.

**A tab whose sub-views each fetch needs ONE gate, and the test must prove nothing loads before it.**
The first cut of `every sub-view sits behind the SAME single gate` asserted only that one mount effect
existed and mentioned `my_perms` — and inserting `loadAudit();` in front of that call PASSED. The guard
now splits the effect at `if (usersReachable(p))` and requires the part before it to contain no load and
to ask the server for nothing but `my_perms`. Same class as `finance.info`'s seven: ask which side of
its branch the check actually sits on.

**A WITHHELD-direction assertion driven only by the fixture is not a guard.** `sessions_list` sends a
shortened token, so "the markup contains no 40-character string" passed with the component ALSO printing
a full token. It now hands the component a session carrying a secret that must not reach the screen and
checks for that secret. Drive the leak, do not observe its absence.

**A handler with no identifying argument is pinned through the attribute it reads.**
`onclick="sessionRevoke(this.dataset.sid,this.dataset.who)"` carries no quoted literal and no bare
integer, so every established widening returns `[]` for every row. What is comparable is that the
`data-sid` rendered into row i equals the sid row i's handler dispatches — a mismatch signs the wrong
person out. Same shape for any legacy handler that passes its row through `this.dataset`.

**Read the SERVER per function, and the answer here was "nothing to lift" in both directions.** No
arithmetic exists on any of the four sub-views: `relSec()` is a duration format, the three Xero stat
cards are server-owned counts, and `auditDetail()` is a display string. The one thing lifted OUT of the
route is what LEAVES — `roleSaveBody`, `roleDeleteBody`, `revokeBody`, `userSaveBody`, `ufTenants`,
`webhookKeyBody`, `xeroActionBody` — each pinned against its legacy caller's own text.

**`ufTenants()` is `finance.qinv`'s split, and both of its rules are invisible in markup.** Only TICKED
rows are sent (the server replaces the whole set, so sending an unticked row GRANTS the company it was
meant to remove), and a blank per-company override is sent as `null` not `''` (`null` means "inherit the
global role"; `''` is a role name no `roles_list` row matches, and `roleLabelFor()` prints an unmatched
name raw). The DOM read that produces its input stays in the route, as `qiCollect()` does.

**`FEATURE_META` (app.html:4846) is the permission VOCABULARY and is NOT `nav.ts`'s 22 Finance tabs.**
Ten entries. A key added is offered as grantable whether or not `showApp()` would honour it; a key
removed can never be granted through the roles form again. Twelve Finance tabs are deliberately absent.
Copied verbatim, pinned against app.html's own text, and the absences asserted by name.

**`roleKey()` is what stops an edit renaming a role.** `roleSave()` slugs the typed key only when
`RF_NAME` is null — i.e. on a CREATE. On an edit the disabled input is ignored, because a renamed role
stops matching `PERMS.role` and every user holding it loses every tab at once.

**Three irreversible-ish Xero actions: mirror the legacy's gap in the MARKUP, close it in the ROUTE.**
`xeroBackfill` / `xeroDeltaNow` / `xeroSyncNow` each disable ONLY the button that was clicked
(app.html:4990, :5033, :5041), so a second, DIFFERENT sync can start against a live Xero connection while
the first runs. `XeroPanel` reproduces that exactly (`busy` names one button); `onXeroAction` refuses a
repeat. `finance.approvals`' treatment of the same class of gap.

**`xeroSyncLoad()` writes SEVEN panels in one statement and only the first was in scope.** 🏢 Company
names, 🩺 sync health, 🔬 live AR audit, 🔧 force-resync, 🧨 emergency rebuild and 💰 AR aging hand off
to `app.html#tab=users` and are named as data in `XERO_HANDOFF_PANELS`, with a test that reads the six
titles back out of app.html — so the handoff cannot silently stop naming one. Emergency rebuild WIPES a
company's cached invoice history before re-pulling from 2015; that is not a migration detail.

**`auditLoad()` and `xeroSyncLoad()` both format an instant with a bare `toLocaleString()`** — no locale,
no `timeZone` — unlike `finance.ap`, which passes `Asia/Kuala_Lumpur` to all three of its date calls.
Mirrored, not fixed, and pinned BY SOURCE on both sides: this fleet and CI sit at UTC+8, so ADDING the
zone (an improvement) passes every output assertion while making the two renderers disagree about when a
password was reset. `finance.calendar`'s finding in its fifth form. Note also that `xeroSyncLoad()`'s
Live AR audit panel reuses the element id `audit_out` that `auditLoad()` writes — harmless only because
`#uv_body` is replaced wholesale between sub-views.

**The audit log is READ ONLY and the test asserts the withheld direction.** One control (↻ Refresh), no
input, no select, no form, no second button — in the loaded state AND the empty state — and the route
asks for exactly `audit_list` on that sub-view. It is the record of who changed the permissions the other
three sub-views hand out, and five of the seven actions `actMeta` names are this screen's own.

### `hr.expenses` was the same gap on the HR side — v225, the EMPLOYEE half of Reimbursement

`hrRC()` (hros.html:1783) is a tab bar over FIVE bodies dispatched on `RC.page` — list / form / detail /
dashboard / settings — behind one nav id. Only the list was migrated, so **no employee could file an
expense claim from React at all**: Submit and a claim's detail did `window.location.href` back to
hros.html. `finance.users`' lesson, in HR. v225 migrates list + form + detail; Dashboard and Settings
are admin-only and still hand off, and the on-page banner names them.

**Two defects were already live in that route and NEITHER is visible to any golden.** (1) `hr_companies`
(hr.ts:815) requires `hrCanView()` — admin / hr_admin / viewer — and the route awaited it FIRST, so every
plain `employee` got `⚠️ unauthorized` as the whole page and could not see even their own claims. That is
`hr.leave`'s F2 and `finance.users`' "a gate downstream of the load" at once; `hr_rc_config` answers for
an employee AND says which shape to render, so it is loaded first and `hr_companies` only inside the
admin branch. (2) The company was kept by NAME, so every call went out with no `tenant` and
`hr_rc_list`'s admin branch (hr.ts:2549) answered `ok` with an EMPTY list — `hr.yearend`'s `hr_bootstrap`
finding, silent the same way. Both are pinned by SOURCE in `web/tests/hr-expenses-emp.parity.test.tsx`.

**THE DOUBLE-SUBMIT GUARD HAS TO BE A REF, AND `useState` LOOKS IDENTICAL UNTIL YOU TAP FIVE TIMES.**
`hrRCSave()` opens with `if(RC._saving) return;` (hros.html:2083) — a plain mutable flag, set
SYNCHRONOUSLY. Written with `useState` first, this route recorded **five `hr_rc_save` and five
`hr_rc_submit` calls** from five taps in one tick: every handler read the same `false` out of one
closure, and `disabled={saving}` does not help because the attribute lands on the NEXT render, after the
burst. Five such holes were fixed in PRs 108/109 and this would have been the sixth. It was found by
driving a real browser, not by a test — no output assertion this fleet can run sees it. `savingRef` /
`detailBusyRef` / the scan modal's `busyRef` are the shape; the state flags stay, but only to grey the
control out. **Check every React `runOnce`/busy port this way.**

**Three surfaces, not one — 42, 43 and 44.** `hr.expenses.form`, `hr.expenses.detail` and
`hr.expenses.emp` (the two-tab, four-scope shape `RC.me.isAdmin===false` produces). `hr.leave`'s rule:
when a mode is a WHOLE OTHER SCREEN behind one nav id, capture the golden — a golden cannot see a screen
that is never mounted.

**`src/hr-rc-pdf.ts` is a KNOWN FORK of `hrRCBuildFormPdf()` (hros.html:1895) and is held by
EXTRACTION.** Everywhere else a drawer both halves need lives in `hr-docs.js` so it cannot fork; v225's
brief forbade editing hros.html, and lifting a function means deleting it from there.
`web/tests/hr-expenses-pdf.test.tsx` therefore pulls `hrRCBuildFormPdf` out of hros.html at run time,
runs it and the React copy against the SAME recording jsPDF stub, and requires the two call logs to be
identical — every coordinate, every font size, every string, in order. That is as strong as importing
it. **Folding it into `hr-docs.js` is the right next change**: one edit to hros.html and one import.
`hrRCParseEinv` is held the same way in `web/tests/hr-expenses-scan.test.tsx`.

**The scanner splits like `hr.profile`'s signature pad.** Every DECISION — the auto-crop heuristic and
its three bails, the 12px tap discard, the rotate sizing, the QR parse, the OCR field mapping — is a
pure function in `src/hr-rc-scan.ts` with its own test; the canvas and the pointer events are
`app/hr/expenses/scan-modal.tsx`. The camera itself is `DocScanner` in `common.js`, SHARED and reached
by indirect `eval` (`app/finance/upload/page.tsx`'s precedent). **The QR beats the OCR** for the
e-invoice identity — it is read off the document with no model in the loop — and every OCR assignment is
truthiness-guarded, because an unguarded port BLANKS a vendor name the employee typed when the next scan
comes back empty.

**Three legacy findings raised here and deliberately NOT fixed.** (1) `hrRCDetail()` derives `pending`
from the STATUS alone (hros.html:2516), so the "Approver actions" panel — Approve / Reject / Override —
renders for the claim's OWNER on their own Submitted claim; `hr_rc_decide` refuses them, so it errors on
click. `hrClaims()` not wrapping its decisions in `hrRW()` is the same class. (2)
`hrRCFormAndReceipts()`'s toast branches on `added`, so a merge where every receipt failed to fetch
reports "Form generated ✓ (no receipts attached)" rather than naming the failures (hros.html:1985).
(3) `tests/render_fixtures.ts`'s `hr_rc_list` rows are in the wrong SHAPE — `employee_name` /
`total_amount` / `status:"pending_approval"` where `hrRCList()` reads `hr_employees.name`,
`hr_claim_types.name` and `amount` — so `tests/golden/hr.expenses.html` holds `—`, `—` and **RM 0.00**
for all three claims. The same class as the `role_approvers` finding above, and left alone because
correcting it moves a committed golden that is not this change's to move.

### The shell is `web/src/nav.ts` + one component per app, and the nav lists ALL 36 screens

The chrome landed after the first fifteen screens, not before them. `web/app/hr/layout.tsx` and
`web/app/finance/layout.tsx` are now `'use client'` and hold the session, the role, the companies and the
theme; `web/src/hr-shell.tsx` and `web/src/finance-shell.tsx` are pure components, same split as a screen.
**A route page therefore renders no `#app` and no `<main>`** — the shell owns both, once. A page that
needs to read its own DOM back keeps a plain `<div ref>`.

**`web/src/nav.ts` is the one list, and every one of its 36 entries is now `migrated: true`.** 14 HR
views and 22 Finance tabs. `href()` turns that flag into either `/<app>/<id>/` or the legacy file at
`#tab=<id>`, which is what that fragment scheme (v213) is for. **Keep the flag and keep the legacy
branch**: both legacy apps are still live and still what staff use, so a screen added to `app.html` or
`hros.html` tomorrow arrives here unmigrated and needs somewhere to point. Adding a screen is ONE line
here; `web/tests/shell.test.tsx` fails if this list, the legacy apps' own nav declarations, and the route
directories on disk disagree, so it cannot be forgotten.

**Every permission rule is in `nav.ts` as a pure predicate, and the shell test asserts the WITHHELD
direction.** `hrRole()` mirrors hros.html:1361-1368, `hrNavFor()` mirrors `hrSidebar()`'s filter
(hros.html:1508), `financeTabHidden()` transcribes `showApp()`'s pass (app.html:1420-1434) branch for
branch — including the `users` quirk CLAUDE.md already flags, so the nav follows the FEATURE flag rather
than `manage_users`, as app.html actually does. A nav that renders an admin entry an unauthorised person
can click is a real defect even when the destination refuses: it advertises what exists and where.

**The 18 HR goldens already carry the sidebar, and the shell test diffs against it.** Each has a
`#hr_nav` section (`hr.clock` and `hr.payslip` also carry `#emp-mobnav`) — `hrSidebar()`'s own output in
three permission states: Master Admin without an employee record (`hr.access`, 11 entries), with one
(`hr.profile`, 12), and employee mode (`hr.clock` / `hr.payslip`, 5). Those are not the shell's CONTRACT
(report.md §3.5 puts chrome outside the screen-by-screen strangler) but they are free byte-level evidence,
so they are used as one. The single allowance is `unifyNavTag()`: the legacy item is a `<button onclick>`
and the React one is an `<a href>`, so both sides are normalised to `button` and `href` is dropped —
which is why the href is asserted separately, for all 36 screens.

**`web/src/shell.css` is the only hand-written CSS in `web/`, and must stay tiny.** Five selectors,
`text-decoration: none`, because the nav became anchors and neither legacy stylesheet ever had an anchor
to reset. Legacy CSS still comes only from `scripts/sync-legacy-css.mjs`.

**Nothing in the Finance chrome hands off any more.** Security/2FA, Alerts, Export and Change password
were four labels linking into the legacy app because none had a React equivalent; all four are ported
(see "The shell's own chrome" below and the v223 section under it), and with every screen and the three
sibling PAGES migrated, **the six advanced Xero tools inside `finance.users` are the only handoffs the
nav still makes.** `web/public/ctg-logo.png` is app.html's inlined base64 brand mark, decoded once.

### The shell's own chrome — five files, and the rules they carry

The list that used to sit here ("no toast, no confirm/credentials modal, one light frame, every nav click
a full page load") is closed. What replaced it, and what each one is NOT:

| file | what it is |
|---|---|
| `web/src/toast.tsx` | `toast(msg,isErr)` — common.js:29's signature and its 2400/240ms queue, plus the pure `#toast` div |
| `web/src/confirm.tsx` | `showConfirm(title,msg,okTxt,okCls)` — app.html:2402's Promise, and `#cf-overlay` |
| `web/src/password-modal.tsx` | the credentials modal — app.html:1186 + `openPwModal()`, INCLUDING the forced branch |
| `web/src/icons.tsx` | `ICONS` + `ic(n,s)` — hros.html:1219-1241, in one place |
| `web/src/theme.ts` + `web/src/spa-nav.ts` | the before-paint theme decision, and which clicks are client-side |

**`toast()` and `showConfirm()` are module-level functions, not hooks or context.** The legacy signatures
are called from ~200 places across both apps, most of them halfway down an async save, so keeping them
means a route swaps one call for one call. One host per app layout, which is what the legacy `#toast` and
`#cf-overlay` divs already are. **`showConfirm()` with no host mounted resolves FALSE** — every caller
reads it as "may I do the irreversible thing".

**No route may call the browser's `alert()` or `confirm()` any more**, and
`web/tests/shell-chrome.test.tsx` WALKS `web/app/**` for both — at any depth. It read one level deep at
first, and the three sibling PAGES then landed with four `confirm()`s between them that the scan could
not see. The same walk now derives the client-side-nav check, so a route added at a depth `spaTarget()`
does not reach fails there rather than quietly degrading to a full page load. `prompt()` IS still the browser's, in
seven places, deliberately: a text prompt is not one of the two controls that were ported, and the legacy
uses the native one too (hros.html:2676, app.html:7063). That count is asserted, so an eighth is a
decision someone has to make on purpose.

**The credentials modal is ONE component for both apps, and the forced branch is the security-carrying
half.** `enterApp()` hides the entire app and opens it with no Cancel and no × when the server says
`must_change_pw` (app.html:2665, hros.html:1356). React had no equivalent at all, so an operator handed a
one-time password could use every migrated screen and never be asked to replace it. Both layouts now
refuse to render anything else on that flag. The two legacy dialogs post the same `changepw` and enforce
the same `pwValid`; they differ only in trim, so they are one port (Finance's, the richer one).

**An HR-only login (employee / view-only / hr_admin) gets the "HR OS access only" gate, not the empty
shell — the C6 gap.** `enterApp()` (app.html:2671) checks `HR_ONLY_ROLES_FE` BEFORE `must_change_pw` and
shows `showHrOnlyGate()` (app.html:2653); React had no equivalent, so such a login landed on the empty
Finance shell (`financeNavFor(null)` renders no tabs) plus each screen's own server refusal.
`web/src/finance-hr-only-gate.tsx` is the pure gate (`isHrOnly(role)` + the branded panel with the HR OS
jump and Sign out); `app/finance/layout.tsx` sets `hrOnly` when `me` resolves and returns the gate before
the password gate, mirroring `enterApp()`'s order. No golden holds it (chrome, like the shell);
`web/tests/finance-hr-only-gate.test.tsx` pins the role set against app.html and both directions.

**Client-side navigation is a delegated listener, and it STOPS at the app boundary.** `spaTarget()`
(`web/src/spa-nav.ts`) is the pure rule; `useSpaNav()` in each layout is the wiring. It matches a screen
(`/finance/wht/`) and ONE segment below it — a SIBLING PAGE, `/finance/wht/doc/` and
`/finance/pharm/detail/`. It routes `/hr/…` → `/hr/…` and `/finance/…` → `/finance/…` and NOTHING else — every legacy handoff, the landing page and the
cross-app jump stay real document loads. That is not a limitation: `app/hr/layout.tsx` and
`app/finance/layout.tsx` import DIFFERENT generated stylesheets that disagree on 38 selectors, so a
client-side hop between them would have both alive at once and would silently restyle one app with the
other's `:root` — the exact failure that file scoping exists to prevent. It is also what the legacy jump
between two HTML files has always been. The nav stays PURE ANCHORS with no handler props, so
`web/tests/shell.test.tsx`'s "the nav is anchors" assertion is untouched.

**The theme is decided in `<head>`, and `web/src/theme.ts` owns both key names.** The old comment here
said the root layout could not know which of `hros_theme` / `ctg-theme` to read. It can: the URL says
which app the page is, and `/hr/…` vs `/finance/…` is the same mapping the two layouts apply by being
where they are. **A FLASH IS INVISIBLE TO AN OUTPUT ASSERTION** — the end state is identical either way,
only the timing differs — so the test pins the IMPLEMENTATION (the script is rendered from the root
layout's `<head>`, and never writes the key back). Same finding as `finance.calendar`'s `dueLabel()`, in
its fifth form.

**`ic()` was duplicated FOUR times in `web/src/` and had six of its twenty keys.** It is now one file,
holding hros.html's own path STRINGS rendered through `dangerouslySetInnerHTML` — hand-converting twenty
`<path>` strings to JSX is twenty chances to drop a digit off a coordinate, and a wrong coordinate is a
wrong glyph no reviewer catches. The test parses hros.html's `ICONS` at run time and diffs every key at
every size the chrome uses. **Seam left named, not taken:** `hr-access.tsx`, `hr-payslip.tsx` and
`hr-employees.tsx` still carry their own two-key copies; folding them in is a one-line import each with
byte-identical output, and they belong to other owners.

**Two legacy findings, both mirrored rather than fixed, both pinned.** (1) `hros.html:1139` is
`<div id="toast">` with NO `class="toast"` — app.html:1184 has it — and neither stylesheet carries a
`#toast` selector, so in HR OS today a toast is unstyled body text at the bottom of the document and the
`.show` transition never runs. The React port renders the class in both apps, i.e. the toast hros.html's
own stylesheet describes; the legacy markup is asserted so a fix there surfaces here. (2) `.btn.d` is
`color: var(--red-soft)` (app.html:88) but the light theme's `.btn` rule wins, so the destructive button
in the confirm dialog is grey in both apps.

**One guard was missing and was found by breaking the code, which is the only way.** `pwError()`'s ladder
order (app.html:2628-2632) survived having its last two rules SWAPPED with every assertion still passing:
"must be different from the current one" and "do not match" are both TRUE for a reused-and-mistyped
password, so only an input satisfying both — old === new AND new !== confirm — can see which rule the
ladder reaches first. Ask of every ordered rule set which input distinguishes the order, not just which
inputs reach each branch.

### The last three chrome dialogs — v223, and the Finance top bar now links nowhere

`src/finance-security.tsx` (🔐 Account security / TOTP), `src/finance-alerts.tsx` (🔔 the bell) and
`src/finance-export.ts` (⬇ Export) close the three handoffs the paragraph above used to name. **The
Finance shell now renders no anchor into `app.html` at all**, which `web/tests/shell-chrome.test.tsx`
asserts as a negative — the six advanced Xero tools inside `finance.users` are the only handoffs left.

**Security is FINANCE-ONLY, because that is where the legacy control is.** app.html:1104 has the button;
hros.html's sidebar foot has never had one, and TOTP is enforced at both apps' login regardless. Giving
HR OS a control the legacy never offered is a feature, not a migration — pinned by reading both legacy
files at run time, so a button added to hros.html surfaces as a failure here.

**A dialog whose HOST cannot be mounted still needs its decisions driven — split the effect out.**
vitest runs `environment: 'node'` and all 52 test files depend on that, so `SecurityHost` cannot be
rendered. `submitEnroll(step, verify)` and `submitDisable(step, disable)` are therefore pure functions
of their inputs plus ONE injected effect (`bankFile()`'s split, for an async path): `{enabled:true}` is
returned on exactly one branch, after `verify` RESOLVED, and that is drivable. What is left in the host
— which literal each result becomes — has no output, so it is pinned by SOURCE (`finance.calendar`'s
rule), including that `h.onChanged(` appears exactly twice.

**Two defects passed everything and were found only by introducing them, both in the bell.** Deleting
`e.stopPropagation()` from the bell (app.html:2744) changes no argument, no text and no markup — and
makes the panel open and close in the same click, so the bell looks dead. And an always-`display:flex`
badge renders as an empty span, so every output check passes while every operator carries a permanent
dot. Both are `finance.info`'s class; the guards now drive a spy event and read the badge's own style.
A third: the four argument-free chrome controls (bell / Security / Export / Change Password) are
indistinguishable by "it is wired", so their PROP IDENTITY is compared as a sequence — `hr.payroll`'s
`LEGACY_TO_PROP` finding, in the chrome.

**`exportCurrent()`'s file-name date is `toISOString()`, i.e. UTC, and it is mirrored.** In MYT that is
the PREVIOUS day for the first eight hours of every morning, so a 07:00 export on the 1st is filed under
last month. `finance.calendar`'s finding in its sixth form: the instant is an ARGUMENT
(`exportFileName(tab, co, now)`) so the divergence is drivable on a UTC+8 machine, and the function body
is asserted to contain no local getter. Its sibling gap is app.html's own `coName.indexOf('All')<0`,
which drops any company whose slug contains those three letters from the file name.

**The chrome cannot reach a screen's model, so `render(t)`'s one export special case is a
REGISTRATION.** app.html:5277 dispatches `pnl` to `pnlExportCsv()` by name because the P&L grid is not a
`.bigtable`; `registerScreenExport()` is that dispatch, called from `app/finance/pnl/page.tsx` with the
same `onExport` its own ⬇ Export CSV button uses, so the two controls cannot produce different files.
Scraping the grid instead would export FORMATTED cells where the legacy exports raw numbers. The scrape
is scoped to a `<div ref>` around the layout's children, never `document` — a document-wide scrape puts
the chrome, and once another screen has rendered another company's figures, into the workbook.

**The QR image hands the TOTP secret to a third party, and that is app.html's behaviour.**
app.html:2562 puts the whole `otpauth://` URL — which contains the shared secret — into a query string
for `api.qrserver.com`. Drawing it locally means a new vendored dependency, which is a decision above a
migration, so it is mirrored and `qrSrc()` is pinned by a test rather than buried. Note while you are
there that react-dom 19 emits a `<link rel="preload" as="image">` for it, so that URL is in the markup
TWICE where app.html writes it once — which is why the leak checks strip tags rather than count
occurrences.

**Still not done:** the session-expired and idle-timeout modals (app.html:1376, :2685) have no React
equivalent — a React-only operator's session dies silently. `prompt()` is still native. The toast
QUEUE's timing, the confirm's Escape listener and the alert panel's click-away listener are not covered
by a test: vitest runs `environment: 'node'` and all 52 test files depend on that, so adding jsdom for
three behaviours was not worth it.

**Unsaved-work protection is `web/src/unsaved.ts` — the React mirror of `UNSAVED_CHANGES` (app.html:1286)
and `HR.pay.dirty` (hros.html:1404).** One process-wide dirty flag keyed by opaque id; a screen registers
via `useUnsavedGuard(dirty)`. Two consumers read it: the `beforeunload` guard installed in that module,
and the in-app nav confirm added to `use-spa-nav.ts` — a client-side `router.push` UNMOUNTS the dirty
screen and drops its `useState`, which the legacy's global state never did, so the nav-away path ASKS
first via `showConfirm`. Wired on Payroll, Company Info and Pharmacy detail (their `dirty` states). The
pure flag is tested in `web/tests/unsaved.test.tsx`; the hook itself is not (vitest is `node`).

**A failed initial load is `web/src/failed-load.tsx`, NOT a bare `<Panel>⚠️ {err}</Panel>` — the C2
gap.** app.html:1574-1600 categorises a failed `render(t)` into session / network / server and offers
Retry + Go to Overview (session offers Sign in instead) with a `<details>` technical message; every
React route used to dead-end on a bare error panel whose only escape was a browser reload. `FailedLoad`
mirrors it: `categorizeFailure()` is the pure taxonomy (pinned in `web/tests/failed-load.test.tsx`),
Finance routes pass `home={OVERVIEW_HOME}`, HR routes pass none (the legacy HR side uses inline retry
and has no "Overview"). Two things it depends on: (1) the categorisation is only as good as the message
handed to it, which is why `src/portal.ts`'s `call()` (#120) already normalises them — "Session
expired…" on a 401/unauthorized, "Network error…" on a fetch failure, "Request timed out…" on the 30s
abort — so `categorizeFailure()` keys on the legacy words and gets a clean signal; and (2) `retryReload()`
is a route reload, not a soft re-`load()`, because the ternary error state replaces the whole screen (no
form mounted, nothing typed to lose, so it never trips the `unsaved.ts` `beforeunload` guard) and only a
reload re-runs the perms gate too. Use it for any new route; the banner-form
`{err ? <Panel>…</Panel> : null}` sites that render the screen alongside are transient action errors,
not dead ends, and are left as-is.

## Hosting is `vercel.json`, and its whole job is ONE ORIGIN

The session is `localStorage['ctg_portal_token']`, which is scoped per ORIGIN. Two hosts would be two
logins on two live copies of the same data-entry UI — an employee clocks in on one and the other does not
reflect it. So the legacy single-file apps and the built React routes are served from one Vercel
deployment, and that is the only reason this file exists.

**It reproduces `tools/serve_both.ts`, deliberately.** `buildCommand` builds the export and then copies
the repo-root legacy files OVER `web/out`, so the legacy file wins the same collisions it wins locally:
`/` is `index.html`'s redirect to `app.html`, not the React landing page. **The copy must stay AFTER the
build** (the export wipes `web/out`) and **must stay a GLOB** — `*.html *.js *.png`, not a name list.
The name-list version is `ci.yml`'s `cp common.js`, which CLAUDE.md already calls a gap; nine root `.js`
files have been added since, and the tenth would 404 in production only. `tests/vercel_config_test.ts`
pins both, and reads every `src=`/`href=` out of the three legacy HTML files at run time so an asset
added to a page fails there rather than at cutover.

**Vercel's Root Directory must stay the REPO ROOT, not `web/`.** The Next build reads `../app.html` and
`../hros.html` (`scripts/sync-legacy-css.mjs`) and imports `../../payroll.js` and `../../hr-docs.js`;
`turbopack.root` in `next.config.mjs` already points up for that reason. Set the root to `web/` and the
build fails on the first import.

**Response headers live here because `next.config`'s `headers()` is inert under `output: 'export'`** —
`web/next.config.mjs`'s header says so. Five headers, and what each is for:

| header | why |
|---|---|
| `Content-Security-Policy: frame-ancestors 'none'` | app.html:14 declares this inside a `<meta http-equiv>` CSP, where **the spec says it is IGNORED** — verified in Chrome: a meta-only `app.html` frames fine, the header-served one is refused. hros.html and the React routes declare nothing at all. |
| `X-Content-Type-Options: nosniff` | the site is served by filename; nosniff stops a mistyped response being sniffed as HTML or script. |
| `Referrer-Policy: strict-origin-when-cross-origin` | app.html:7 sets it by meta and the other two set nothing. Sibling-page URLs carry `?id=`, which IS sent in `Referer`. |
| `X-Robots-Tag: noindex, nofollow` | `index.html` and the React root metadata declare noindex; `app.html` and `hros.html` never have. Invite-only, no SEO surface, and this also covers preview deployments. |
| `Cache-Control` | see below. |

**Deliberately NOT sent, and each absence is a decision.** app.html's FULL meta CSP — it is tuned to
app.html, and hros.html and the React app have never run under one, so shipping it to all three is a
cutover-day white screen on two of them. `Permissions-Policy` — the boilerplate copy omits `camera`,
which would break `DocScanner`. `X-Frame-Options` — superseded by `frame-ancestors`. `Strict-Transport-Security`
— Vercel sends its own; declaring a shorter `max-age` here would weaken it.

**Caching splits on whether the filename carries a content hash.** `app.html`, `hros.html`, `common.js`
and the vendored libraries keep their names across every deploy, so they are `max-age=0, must-revalidate`
— cache one immutably and staff keep running the previous copy with nothing to clear. `/_next/static/*`
is content-hashed, so a changed file is a changed URL and a year is correct. The two rules overlap on
`_next/static`; the arrangement is chosen so that if Vercel resolves the overlap the other way the
failure is **slow, not stale**.

**Do not re-declare the host here.** `SITE_URL` is the one constant (below), and `tests/site_url_test.ts`
now scans `vercel.json` too.

## The site's address is `SITE_URL`, declared three times because three runtimes hold it

`https://sscctgfinance-cmd.github.io/ctg-finance-portal` — the GitHub Pages origin, which is what
answers today. It briefly named `https://os.ctg4u.com` (PR #80) and that host has **no DNS record**,
so five staff emails carried dead links for three days; the value is back on Pages until the DNS
record exists and answers, which is the sign-in phase's job. Each declaration carries that condition
as a comment — do not move it back on the strength of the cutover docs alone.
It used to be written out longhand in seven places. It is now `SITE_URL` in
`common.js` (the browser half of both legacy apps), `SITE_URL` + `HROS_URL`/`APP_URL`/`CLOCK_URL` in
`supabase/functions/portal/hr.ts` (the five links that travel by EMAIL — leave approvals, claim
approvals, employee credentials, admin credentials, clock reminders), and `SITE_URL` in
`supabase/functions/ctg-sso/index.ts` (the sign-in redirect allow-list, which is an allow-list and not
a parameter precisely because an open redirect on a login callback steals credentials).

**Three, not one, and the reason is a boundary rather than taste.** Those three runtimes cannot import
from one another. A `supabase/functions/_shared/site.ts` would collapse the last two, and it is the
documented Supabase pattern — but it would sit outside `deploy-supabase-portal.yml`'s `paths:` trigger,
so a change to it would ship silently late. That is the same failure the `paths:` comment already warns
about, in the one file whose whole job is to be correct on cutover day.

**`tests/site_url_test.ts` is what makes "one constant" mean something.** It evaluates all three
declarations and requires them to agree, requires every derived URL to be absolute with its separator
intact, pins each of the five emails to the constant it must use, and **fails if a fourth hardcoded copy
of the host appears anywhere in the shipped source** — `web/` included. The ONE exception is
`cutover/old-origin/forward.html`, which is deployed by hand into the public deploy repo and must name both
hosts literally — it is served from the OLD origin and cannot import this constant from anywhere. It is
not in the scan list, and `tests/forwarding_page_test.ts` is what pins it instead. Adding a link to a new email
means adding a constant there, not a string.

**`ctg-sso` is not deployed by any workflow** (see "Things that are not covered by a push"), so its
`SITE_URL` takes effect only when a human deploys it. Deploying it before the new domain answers sends
every SSO sign-in to an address that is not there yet.
## The old address gets a forwarding page — `cutover/old-origin/`

At cutover (GitHub Pages → `https://os.ctg4u.com`) the old GitHub Pages address stays alive serving
`cutover/old-origin/forward.html`. Nothing in either app loads it; it is deployed BY HAND into the
public deploy repo as three copies — `index.html`, `app.html`, `hros.html`. `cutover/old-origin/README.md`
has the commands and the after-checks.

**Its redirect is the least important third of it.** `sw.js`'s `install` calls `skipWaiting()` and its
`activate` calls `clients.claim()` (`sw.js:6-7`), so the old service worker stays registered and stays
subscribed on every device that ever opened the Time Clock screen, visited again or not — and
`hr_push_subscriptions` has no `origin` column (`hr.ts:1822`), so the server cannot tell a stale row
from a live one. `registration.unregister()` **from a page on that origin** is the only thing that
clears it, which is why the old address stays alive at all. Deleting `sw.js` from the publish repo does
nothing for a device that already has the worker.

**It must be live BEFORE the DNS moves.** A device that enables reminders on the new origin first, then
visits the old one, ends up with two subscriptions and the duplicate is permanent and unidentifiable.

`tests/forwarding_page_test.ts` evaluates the page's own inline `<script>` through
`tools/extract.ts`, so the tests cannot drift from the file the captain deploys, and it asserts what
the cleanup CALLED rather than what the page rendered: an unregister that silently no-ops looks
exactly like success and is unobservable afterwards, because the affected devices never report back.
Its boot check blanks comments first — the first cut read raw source, so commenting the boot line out
still matched it and the whole suite stayed green on a page that did nothing.

## Publishing to the live site is a separate step

Merging a PR into `ctg/main` does **not** make anything live. After merging:

```bash
git switch main && git fetch ctg && git reset --hard ctg/main && git push origin main
```

That push is what rebuilds Pages and triggers the edge-function deploy.

**`reset --hard`, NOT `git pull` — and that is not a style preference.** PRs are squash-merged, so
the source-of-truth main gets ONE new commit while your local branch still holds the originals. `git pull` cannot
fast-forward past that, so it merges, and every deploy leaves behind an empty `Merge remote-tracking
branch` commit that exists nowhere on the remote. Nineteen of them accumulated before
anyone noticed: GitHub Desktop showed "19 commits to push" and then **"the repository does not seem to
exist anymore"** — which is what a client reports when it pushes to a private repo the signed-in account
cannot see. That is also why the remotes were swapped — see the table at the top. The content was identical the
whole time; only the shape of the history had diverged. Keep all three tips equal and the message never
appears.

**A merge is not a deploy, and a green CI is not one either — check the DEPLOY workflow.** Both repos
run `deploy-supabase-portal.yml`, so the function deploys twice per change and a failure in one can be
masked by the other. It has a source guard, and one of its checks is a **baseline** on the number of
`api === "..."` branches (`EXPECTED_ACTIONS` in that file): **update it in the same commit that adds or
removes a handler.** It was left at 209 when v224 retired the six Web Push actions, the real count went
to 204, and every deploy from that commit refused — in both repos, for two days, while merges kept
landing and the site kept serving the older function. Nothing said so; the workflow just went red where
nobody was looking. What is actually live is best confirmed by BEHAVIOUR, not by the `hint` string,
which is stale: `{"api":"hr_dashboard","tenant":{"a":1}}` answers `bad tenant` 400 only on v210+, and a
retired action answers `unknown action`. Do not probe `login` / `changepw` / `client_error` — lockout
counters and row inserts.

⚠️ `origin` is the **public** repo and unrelated projects sit in this folder — they have been published
by accident once already. Never `git add -A` here; stage named files only.

## Before you push

```bash
deno test --allow-read tests/          # 264 cases, incl. all 44 render goldens
cd web && npm test                     # only if you touched web/ — the React parity tests
```

The two suites are deliberately separate and share no step: the Deno one is the gate on the code that is
live for every user today, and it must not start needing npm to be reachable in order to report on
`hros.html`. Its command and its `--allow-read`-only permissions are unchanged by the React app.

CI additionally parses `hros.html`, `app.html` and `index.html` fail-closed (a syntax error in one of
those single-file apps is a white screen for every user), lints every module in
`supabase/functions/portal/`, and holds the `no-redeclare` baseline at 6.

### Money: round where it is STORED, not where it is printed

Seven modules carried the same defect and it is the one the operator finds, because it is the one that
shows: a figure rounded at the printer while another exit rounds differently, or not at all. `wht.js`
(subtotal vs rows), `gateway.js` (CSV vs summary cards), `salesrecon.js` (**three** answers — CSV, API
body, screen), `pnl.js` (CSV float residue), Quick Invoice's PDF (lines 50.00 ×3 over a total of
149.98), `sbi_save` (`gross − wht ≠ net` on a document carrying an LHDN declaration) and `hr_rc_save`
(mileage rounded, typed raw). Three rules came out of it:

- **`toFixed(2)` and `Math.round(x*100)/100` disagree at the half sen** — `(100.005).toFixed(2)` is
  `"100.00"`, `Math.round(100.005*100)/100` is `100.01`. Both idioms are in this codebase. Round ONCE,
  at the store; half-up, which is what the statutory payroll engine already uses.
- **Xero totals a document LINE BY LINE** — `LineAmount = round2(qty × unitAmount)`, total = Σ those. A
  preview that sums raw products disagrees with the invoice Xero issues.
- **`isNaN` is not a number check.** `isNaN(Infinity)` is false and `Number(Infinity)||0` is Infinity, so
  a spreadsheet cell of `1e400` walked through every coercion into a CSV bound for a ledger. Use
  `isFinite`.

`tests/money_rounding_test.ts`, `tests/hostile_input_test.ts` and `tests/payroll_properties_test.ts` are
the guards. The payroll engine itself **passed** a ~3,200-wage property sweep; its three apparent cliffs
are Malaysian law (the RM10 MTD floor, ITA s.6A's RM400 rebate at RM35,000, KWSP's 13%→12% step at
RM5,000) and are pinned as deliberate so nobody smooths a statutory rule out of it.

### If a `tests/golden/` test fails

All 44 rendered surfaces of the two apps are rendered offline and diffed against a committed baseline
(`tests/render_golden_test.ts`; `tests/COVERAGE.md` says what that does and does not hold). A failure
means you changed what an operator sees. If that was the point:

```bash
deno run -A tools/render_probe.ts tests/golden && git diff tests/golden/
```

Read that diff — it is the change to the UI, and anything in it you did not intend is the bug the
goldens exist to catch. Never regenerate to make a red build green without reading it.

## Things that are not covered by a push

- `supabase/functions/ctg-sso/` — the deploy workflow only deploys `portal`. `ctg-sso` must be deployed
  explicitly.
- Database migrations are applied directly, not by CI.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.

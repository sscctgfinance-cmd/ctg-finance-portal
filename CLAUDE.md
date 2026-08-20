# CTG Finance Portal — working agreement

## Repos

| remote | repo | role |
|---|---|---|
| `origin` | `CTG-Business/ctg-finance-portal` (private) | **source of truth.** All work lands here, **via PR only.** |
| `publish` | `sscctgfinance-cmd/ctg-finance-portal` (**public**) | deploy target only — serves GitHub Pages and runs the Supabase edge-function deploy. Not a development remote. |

`publish` still exists because the live site staff use is
`https://sscctgfinance-cmd.github.io/ctg-finance-portal/`. Pages is **not** enabled on CTG-Business, so
cutting that remote loose would freeze the live site while `origin` kept accepting merges — the failure
would be silent and would surface as "why is my fix not live?" days later.

## Never push to `origin/main`

A `pre-push` hook refuses it. After a fresh clone, install it:

```bash
cp .githooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
```

It is **copied into `.git/hooks/`, not activated via `core.hooksPath=.githooks`**. That was the first
attempt and it was wrong: `.githooks/` is version-controlled, so the hook only existed on branches that
contained it — and `main`, the branch it exists to protect, did not. The guard silently disappeared
exactly where it mattered, and a test push to `origin/main` sailed straight through.
`.git/hooks/` is outside version control, so the hook is active whatever is checked out.

Normal flow:

```bash
git switch -c fix/short-description
# ...work...
git push -u origin fix/short-description
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
| `lib.ts` | shared library both halves use: Supabase client, `j()`/CORS, auth + role + tenant guards, TOTP, Web Push, the Xero OAuth/REST client and cache, the P&L parser, OCR / Document AI, the AP inbound-email pipeline, cron internals. |
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
| `common.js` | the ~20 top-level helpers (PR #28) and `DocScanner`, the camera → edge-detect → PDF pipeline (v212) | both |
| `payroll.js` | the Malaysian statutory engine — EPF, SOCSO, EIS, LINDUNG 24, PCB, and the gazetted tables (v213) | `hros.html` |
| `hr-docs.js` | the statutory FILE layouts (KWSP/ASSIST/CP39/CP8D/bank) and the payslip / EA / Form E jsPDF drawers (v213) | `hros.html` |
| `wht.js` | the withholding-tax computation — s.109/s.109B, gross vs net basis, the s.26A service tax and the s.109(2) increase, plus the charging-section table (v215) | `app.html` |
| `o2o.js` | the O2O pharmacy-billing computation — the SKU/Package grouping, the date guard, the 19.2% commission and its master-record override, and the invoice numbering (v217) | `app.html` |
| `salesrecon.js` | the Sales Reconciliation computation — the content-based column/SO/date recognition, the four passes (order lookup → lines → YRDZ numbering → SO suffixing → tally), the Xero CSV and the post body (v219) | `app.html` |

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

**A new shared `.js` file is covered automatically — as long as the app loads it.** `tools/extract.ts`
reads each page's own `<script src=>` tags (skipping `*.min.js` vendored libs), so every test that
evaluates `inlineScript()` — the 40 goldens included — parses and runs your file too, and
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
backend is not moving: Xero webhooks, Supabase cron, inbound email and Web Push all hold the edge
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

**`whtDocHtml()` (`WHT.page==='doc'`) is NOT migrated.** It is a sibling PAGE `renderWht()` dispatches
to, not a branch of the list renderer. `onOpen`/`onNew` hand off to `app.html#tab=wht` — same origin,
same session. That handoff is the honest strangler edge for any Finance tab with a second page behind it.

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

**Two sub-flows hand off rather than lie.** The "add this pharmacy to the master" link goes to
`app.html#tab=pharm` (the Pharmacies LIST is migrated, its detail form is not) — the honest strangler edge `whtDocHtml()`
uses. Everything else, including the Xero-contact search/link and the JSZip PDF batch, is ported: an
operator who posts live from React would otherwise lose the invoice PDFs, and the batch only exists in
that page's memory.

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
is a sibling PAGE, not a branch, and hands off to `app.html#tab=pharm` exactly as `whtDocHtml()` does.

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
shipped `my_perms` fixture, whose feature list deliberately omits `users`. Only the `users` sub-view is
migrated: Roles, Sessions, Audit, Xero sync and `userForm()`'s modal hand off to `app.html#tab=users`,
while `🔑 Reset` is ported because it is `prompt()` plus one POST, with `resetBody()` split out and
pinned against `userReset()`'s own text — no golden sees a request that sets someone's password.

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
sibling PAGE the legacy renderer dispatches to and therefore hands off.

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

### The shell is `web/src/nav.ts` + one component per app, and the nav lists ALL 36 screens

The chrome landed after the first fifteen screens, not before them. `web/app/hr/layout.tsx` and
`web/app/finance/layout.tsx` are now `'use client'` and hold the session, the role, the companies and the
theme; `web/src/hr-shell.tsx` and `web/src/finance-shell.tsx` are pure components, same split as a screen.
**A route page therefore renders no `#app` and no `<main>`** — the shell owns both, once. A page that
needs to read its own DOM back keeps a plain `<div ref>`.

**`web/src/nav.ts` is the one list, and it names screens that are NOT migrated.** 36 entries — 14 HR views
and 22 Finance tabs — each with a `migrated` flag. `href()` turns that flag into either `/<app>/<id>/` or
the legacy file at `#tab=<id>`, which is what that fragment scheme (v213) is for. A nav listing only the
migrated screens would tell an operator two thirds of their app had vanished. Adding a screen is ONE line
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

**Four things could not be ported and hand off rather than lie:** Change password (HR and Finance),
Security/2FA, Alerts and Export are legacy modals and a legacy XLSX writer. Each keeps its label and its
position and links into the legacy app, the same treatment the 21 unmigrated tabs get. `web/public/ctg-logo.png`
is app.html's inlined base64 brand mark, decoded once.

**Still not done:** no toast, no confirm/credentials modal, and the saved theme is applied on mount rather
than before paint (the legacy apps use a blocking inline script in `<head>`, and the root layout cannot —
it does not know which of the two apps' keys, `hros_theme` or `ctg-theme`, to read), so a dark-mode
operator sees one light frame. Navigation is plain anchors, so every nav click is a full page load.

## Publishing to the live site is a separate step

Merging a PR into `origin/main` does **not** make anything live. After merging:

```bash
git switch main && git pull origin main && git push publish main
```

That push is what rebuilds Pages and triggers the edge-function deploy.

⚠️ `publish` is a **public** repo and unrelated projects sit in this folder — they have been published
by accident once already. Never `git add -A` here; stage named files only.

## Before you push

```bash
deno test --allow-read tests/          # 138 cases, incl. all 40 render goldens
cd web && npm test                     # only if you touched web/ — the React parity tests
```

The two suites are deliberately separate and share no step: the Deno one is the gate on the code that is
live for every user today, and it must not start needing npm to be reachable in order to report on
`hros.html`. Its command and its `--allow-read`-only permissions are unchanged by the React app.

CI additionally parses `hros.html`, `app.html` and `index.html` fail-closed (a syntax error in one of
those single-file apps is a white screen for every user), lints every module in
`supabase/functions/portal/`, and holds the `no-redeclare` baseline at 6.

### If a `tests/golden/` test fails

All 40 screens of the two apps are rendered offline and diffed against a committed baseline
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

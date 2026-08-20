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

## The React app lives in `web/` — the migrated screens are the list in `web/app/page.tsx`

`web/` is a Next.js 16 App Router app, added by the HR Access pilot (v214). It is **additive**: not one
byte of `app.html`, `hros.html`, `index.html`, `sw.js`, `manifest.json` or the five vendored libraries
moved or changed, and the legacy screen the pilot mirrors is still the one staff use.

| file | what it is |
|---|---|
| `web/src/<screen>.tsx` | the screen: a **pure function of its props**. No fetch, no `localStorage`, no `window`. |
| `web/app/<area>/<screen>/page.tsx` | the route: `'use client'`, holds state, loads data, wires handlers. |
| `web/tests/parity.ts` | the relaxation layer — why the two renderers may differ, and why each difference is safe. |
| `web/tests/<screen>.parity.test.tsx` | renders the pure component and diffs it against `tests/golden/<id>.html`. |

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

**`web/app/legacy.css` is generated** from `hros.html`'s own `<style>` blocks by
`web/scripts/sync-legacy-css.mjs` on every dev/build/test, and is gitignored. Never commit it and never
hand-copy CSS instead — CI fails if it appears.

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

**Not yet done, and known:** there is no shared chrome in `web/` — no sidebar (`hrSidebar`), no company
picker, no toast, no confirm/credentials modal. `report.md` §3.5 says to re-implement the chrome once in
the Next shell rather than share it; the pilot deliberately did not, because one screen does not tell you
what the shell needs.

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

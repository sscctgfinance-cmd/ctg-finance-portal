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
deno test --allow-read tests/
```

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

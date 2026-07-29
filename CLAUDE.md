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
those single-file apps is a white screen for every user) and holds the `no-redeclare` baseline at 6.

## Things that are not covered by a push

- `supabase/functions/ctg-sso/` — the deploy workflow only deploys `portal`. `ctg-sso` must be deployed
  explicitly.
- Database migrations are applied directly, not by CI.

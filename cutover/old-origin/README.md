# The forwarding page for the old address

`forward.html` is the page the **old** GitHub Pages address serves after the cutover to
`https://os.ctg4u.com`. It is not part of either app and nothing in this repo loads it.

## Why it exists

Not for the redirect. The redirect is the easy third of it.

`sw.js`'s `install` calls `skipWaiting()` and its `activate` calls `clients.claim()` (`sw.js:6-7`), so
the old service worker stays registered and stays subscribed to push on every device that ever opened
HR OS's Time Clock screen — whether or not anyone opens the site again. `hr_push_subscriptions` has no
`origin`, `scope` or `host` column (`supabase/functions/portal/hr.ts:1822`), so **nothing on the server
can tell a stale old-origin row from a live new-origin one.** Left alone, a subset of staff keep getting
notifications from a retired system, and nobody can identify which rows to delete.

This page is the only thing that can clean that up, because the cleanup has to run **on the old
origin**. That is the whole reason the old address stays alive.

It does not need cache-busting: `sw.js` has no `fetch` handler and no Cache Storage use, so it never
intercepts this navigation and this page loads normally
(`data/finance-portal-pwa-scout/report.md` §4).

## Deploy it BEFORE the domain moves

A device that enables reminders on the new origin *before* it ever hits this page ends up with two
subscriptions, and the duplicate is permanent and unidentifiable. Order matters and it is free to get
right.

The old address is served from the **`publish` remote** (`sscctgfinance-cmd/ctg-finance-portal`), which
is a different repository from this one. So this is a hand step, in a **separate clone of `publish`** —
not a `git push publish main` from here, which would overwrite it with the app again:

```bash
git clone git@github.com:sscctgfinance-cmd/ctg-finance-portal.git /tmp/ctg-publish
cd /tmp/ctg-publish

# Three copies of one file, because those are the three URLs bookmarks, emails, the SSO allow-list
# and manifest.json's start_url actually point at.
for f in index.html app.html hros.html; do
  cp /path/to/ctg-finance-portal/cutover/old-origin/forward.html "$f"
done

git add index.html app.html hros.html      # named files only — see CLAUDE.md on this remote
git commit -m "Cutover: forward the old address to os.ctg4u.com and clean up the old service worker"
git push origin main                        # `origin` here IS the publish repo
```

Leave `sw.js`, `manifest.json` and `logo.png` in place. Deleting `sw.js` does **not** unregister the
worker on a device that already has it — only `registration.unregister()` from a page on that origin
does, which is what this page runs.

Optional, one extra copy: `cp forward.html 404.html` catches stale deep links to anything else on the
old origin. `ctgTarget()` sends an unrecognised path to the new site's root rather than inventing a
file name over there.

## After it is live

1. Open an old URL with a fragment, e.g.
   `https://sscctgfinance-cmd.github.io/ctg-finance-portal/app.html#tab=wht` — it must land on
   `https://os.ctg4u.com/app.html#tab=wht`, on that screen, not on a front page.
2. In DevTools on the **old** origin, `navigator.serviceWorker.getRegistrations()` must return `[]`.
3. `select count(*) from hr_push_subscriptions` should fall toward the new-origin count over the first
   week as unsubscribed endpoints 410 and `lib.ts:230` prunes them. If it plateaus above it, devices
   are not reaching this page and the `created_at` sweep in the scout report §5 is the remedy.

## What this page does NOT do

- It does not remove an installed home-screen icon. Nothing can — `start_url` is baked in at install
  time. HR's announcement covers that (cutover decision 5).
- It does not clear `localStorage` on the old origin. The session token there is harmless once the
  origin is a forwarding page, and deleting somebody's session is not this page's call.
- It does not stop NEW subscriptions being created. That is the app-side push retirement
  (cutover decision 4), a separate change.

Its behaviour is pinned by `tests/forwarding_page_test.ts`, which evaluates this file's own inline
script — so the tests cannot drift from what the captain deploys.

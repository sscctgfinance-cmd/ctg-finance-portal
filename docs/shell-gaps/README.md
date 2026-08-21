# The shell-level gaps — what the React app was missing, and what it looks like now

Evidence for the chrome added in `web/src/toast.tsx`, `web/src/confirm.tsx`,
`web/src/password-modal.tsx`, `web/src/icons.tsx`, `web/src/theme.ts` and `web/src/spa-nav.ts`.

Same purpose as `docs/shell/` and `docs/pilot/`: nobody on this project can sign in to a deployment, so
a screenshot in the repo is how this gets reviewed.

Every React image was rendered from `tests/render_fixtures.ts` — the same fixtures the 40 goldens were
captured from — and every legacy image is `app.html` driven through its own function on the same server,
so the pairs are directly comparable rather than merely similar. **No production data is in these images;
the fixtures are shaped, not captured.**

| file | what it is |
|---|---|
| `confirm-react.jpg` | the ported `showConfirm()` on `/finance/approvals/` — the Reject-Bill question |
| `confirm-legacy.jpg` | `app.html`'s own `#cf-overlay`, same title, same sentence, same buttons |
| `confirm-hr-react.jpg` | the same dialog in HR OS, non-destructive variant (`okCls: 'p'`) |
| `toast-react.jpg` | an ERROR toast on `/finance/info/` — red border and red text, `isErr` |
| `toast-legacy.jpg` | `app.html`'s own `toast()`, a success |
| `password-react.jpg` | the ported credentials modal, opened from the top bar |
| `password-legacy.jpg` | `app.html`'s `openPwModal()` — the dialog it is a port of |
| `password-forced-react.jpg` | `must_change_pw`: no ×, no Cancel, and no app behind it |
| `theme-dark-react.jpg` | `/hr/dashboard/` with `hros_theme=dark`, applied before the first paint |

## What "before" was, for each of the five

Four of the five gaps had a "before" that is not page content, so it cannot be screenshotted:

* **The confirm dialog.** Before, every migrated route asked with `window.confirm()` — an OS/browser
  modal drawn outside the page, which a page screenshot cannot capture and which says
  `127.0.0.1:8765 says` above the question. `confirm-react.jpg` next to `confirm-legacy.jpg` is the
  comparison that matters: the ported dialog is the legacy dialog.
* **The toast.** Before, there was nothing at all — routes either used `window.alert()` (same problem)
  or wrote the message into their own panel. `toast-react.jpg` shows the error styling, which is the half
  a port most easily loses.
* **The credentials modal.** Before, both shells' "Change Password" was an `<a href="app.html">` that
  sent the operator back into the app this one replaces; the forced first-login change did not exist in
  React at all, so an operator on a one-time password could use every migrated screen and never be asked.
* **The theme flash.** A flash is a timing property: the end state was already correct, so no screenshot
  and no output assertion can tell the two apart. `theme-dark-react.jpg` shows the state; what changed is
  *when* it is decided (a blocking `<head>` script, as both legacy files do it, instead of a `useEffect`).
  `web/tests/shell-chrome.test.tsx` pins the implementation for exactly that reason — moving the script
  back into an effect fails there and nowhere else.

The fifth, **client-side navigation**, is also not a still image. It was checked in the browser instead:

```js
// on /hr/dashboard/
window.__spaMarker = 'alive';
// click "Leave" in the sidebar
location.pathname            // '/hr/leave/'
window.__spaMarker           // 'alive'   ← no document load
// then click a link to /finance/wht/
window.__spaMarker           // undefined ← a real page load, which is what we want across the boundary
```

## Reproduce

```bash
cd web && NEXT_PUBLIC_PORTAL_API=http://127.0.0.1:8765/__fixtures/portal npm run build && cd ..
deno run -A tools/serve_both.ts
```

Then set `localStorage['ctg_portal_token']` to any string on `127.0.0.1:8765` (the fixture endpoint
echoes back whatever token it is sent — it is not a backend) and open `/finance/approvals/`,
`/finance/info/` or `/hr/dashboard/`.

**The legacy pair were rendered the way `docs/shell/` did it**: open `app.html` on the same server,
un-hide `#app`, and call the dialog's own function (`showConfirm(...)`, `openPwModal(false)`, `toast(...)`).
Nothing in `app.html` or `hros.html` was modified.

**`password-forced-react.jpg` needed one override.** `tests/render_fixtures.ts`'s `me` has no
`must_change_pw`, and that file is shared with the golden suite, so it was not touched: the `me` reply was
temporarily given the flag in `tools/serve_both.ts`, the shot was taken, and the change reverted. Worth a
flag on that dev tool the next time a forced-credentials state needs a picture.

**One legacy quirk both halves share, noticed while taking these.** `.btn.d` — the destructive button —
is styled `color: var(--red-soft)` at app.html:88, but the light theme's own `.btn` rule wins, so the
Reject button in `confirm-legacy.jpg` is grey rather than red. The React port renders the identical
class and gets the identical result; it is a legacy stylesheet quirk, not a porting slip, and fixing it
would change both apps.

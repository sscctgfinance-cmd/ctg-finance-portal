# The React app shell — what it looks like, next to what it replaces

Evidence for the shell (`web/src/nav.ts`, `web/src/hr-shell.tsx`, `web/src/finance-shell.tsx`).
Same purpose as `docs/pilot/`: nobody on this project can sign in to a deployment, so a screenshot in
the repo is how the chrome gets reviewed.

Every image was rendered from `tests/render_fixtures.ts` — the same fixtures the 40 goldens were
captured from — so the React and legacy pairs are directly comparable rather than merely similar.
**No production data is in these images; the fixtures are shaped, not captured.**

| file | what it is |
|---|---|
| `hr-react.jpg` | the HR shell at `/hr/dashboard/`, Master Admin |
| `hr-legacy.jpg` | `hros.html`'s own chrome in the same state — the thing it is a port of |
| `hr-employee-react.jpg` | `HR_EMP_MODE`: five personal screens, no company picker, no Finance OS jump |
| `hr-employee-mobile.jpg` | the same at 420px — `body.hr-emp` swaps in the top bar and the bottom tab bar |
| `hr-collapsed-dark.jpg` | the collapse toggle and the theme toggle, both writing the legacy keys |
| `finance-react.jpg` | the Finance shell at `/finance/wht/` |
| `finance-legacy.jpg` | `app.html`'s own chrome in the same state |
| `landing.jpg` | `/` — the two-app launcher that replaced the developer link list |

## Reproduce

```bash
cd web && NEXT_PUBLIC_PORTAL_API=http://127.0.0.1:8765/__fixtures/portal npm run build && cd ..
deno run -A tools/serve_both.ts
```

Then set `localStorage['ctg_portal_token']` to any string on `127.0.0.1:8765` (the fixture endpoint
echoes back whatever token it is sent — it is not a backend) and open `/hr/dashboard/`, `/finance/wht/`
or `/`.

**Employee mode needs one override.** `tests/render_fixtures.ts`'s `me` is `role: "admin"`, and the HR
shell reads the role from `me` exactly as `enterApp()` does (hros.html:1361-1368), so a second fixture
would be needed to serve `role: "employee"`. The two employee images above were taken by returning
`employee` from that one field. Worth turning into a flag on `tools/serve_both.ts` the next time an
employee-mode screen is migrated; not done here because it is a change to a shared dev tool for one
screenshot.

**The legacy pair were rendered the same way `docs/pilot/` did it**: open `hros.html` / `app.html` on the
same server, un-hide `#app`, seed the globals a signed-in Master Admin would have, and call the chrome's
own renderer. Nothing in either file was modified.

# HR Access pilot — the two screens, side by side

Evidence for the React pilot (v214). Both were rendered from the SAME fixture,
`tests/render_fixtures.ts`'s `hr_users_list` — the one `tests/golden/hr.access.html`
was captured from — so they are directly comparable rather than merely similar.

| file | what it is |
|---|---|
| `hr-access-legacy.png` | `hrAccessRender()` in `hros.html`, still the screen staff use |
| `hr-access-react.png`  | `web/src/hr-access.tsx` at `/hr/access/`, same origin, same session |

The React one has no sidebar: that is `hrSidebar()`, chrome shared by all 18 HR views,
deliberately outside a screen-by-screen strangler (spec §3.5). The banner at the top is
part of the pilot page and says the legacy screen is still the live one.

No production data is in these images — the fixtures are shaped, not captured.

Reproduce:

```bash
cd web && NEXT_PUBLIC_PORTAL_API=http://127.0.0.1:8765/__fixtures/portal npm run build && cd ..
deno run -A tools/serve_both.ts
```

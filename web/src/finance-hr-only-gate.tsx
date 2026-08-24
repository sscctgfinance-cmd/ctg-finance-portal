// The "HR OS access only" full-screen gate — app.html:2653 (`showHrOnlyGate`), reached from `enterApp`
// at app.html:2671. HR-only logins (employee, view-only, HR Admin) have NO Finance Portal access; the
// legacy app hides `#app` entirely and shows a branded refusal with a jump to HR OS and Sign out.
//
// The C6 gap: without it, such a login gets the empty React shell (no tabs — `financeNavFor(null)`)
// plus each screen's own server refusal, instead of one clear "you're in the wrong app" page.
//
// Pure component, gated in app/finance/layout.tsx — chrome, same split as the shell.

import { BASE_PATH } from './portal';

// `HR_ONLY_ROLES_FE` — app.html:2652. Mirrored: `my_perms` returns an empty feature list for these,
// so the shell would render nothing useful anyway; this turns that into a deliberate refusal.
const HR_ONLY_ROLES = ['employee', 'viewer', 'hr_admin'];

export function isHrOnly(role: string | undefined): boolean {
  return !!role && HR_ONLY_ROLES.indexOf(role) >= 0;
}

/** `showHrOnlyGate()` — app.html:2653. The name is greeted; `esc()` there is JSX auto-escaping here. */
export default function HrOnlyGate({ name, onSignOut }: { name?: string; onSignOut: () => void }) {
  const who = name || 'there';
  return (
    <div id="hr-only-gate" style={{
      position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center',
      justifyContent: 'center', padding: '24px', background: 'var(--bg,#12100f)',
    }}>
      <div style={{
        maxWidth: '440px', width: '100%', textAlign: 'center', background: 'var(--card,#1b1817)',
        border: '1px solid rgba(232,93,60,.28)', borderRadius: '18px', padding: '38px 32px',
        boxShadow: '0 24px 60px rgba(0,0,0,.45)',
      }}>
        <div style={{ fontSize: '44px', lineHeight: 1, marginBottom: '14px' }}>🔒</div>
        <h2 style={{ margin: '0 0 8px', fontSize: '20px', color: 'var(--text,#f5f0ee)' }}>HR OS access only</h2>
        <p style={{ margin: '0 0 22px', fontSize: '14px', lineHeight: 1.6, color: 'var(--text-soft,#b7aca7)' }}>
          Hi {who}, your login is for the <b>HR OS</b> — it doesn’t include the Finance Portal. Head over
          to HR OS to manage leave, claims, payslips and your profile.
        </p>
        <a href={`${BASE_PATH}/hros.html`} style={{
          display: 'inline-block', background: 'linear-gradient(135deg,#e85d3c,#d24a2c)', color: '#fff',
          textDecoration: 'none', fontWeight: 700, fontSize: '14px', padding: '12px 26px', borderRadius: '12px',
        }}>👥 Go to HR OS →</a>
        <div style={{ marginTop: '18px' }}>
          <a href="#" onClick={(e) => { e.preventDefault(); onSignOut(); }} style={{
            color: 'var(--text-soft,#8a807b)', fontSize: '12.5px', textDecoration: 'underline',
          }}>Sign out</a>
        </div>
      </div>
    </div>
  );
}

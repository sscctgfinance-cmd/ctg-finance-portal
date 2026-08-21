// The React app's front door.
//
// It replaces a flat list of every migrated route — a developer's index, which was the honest thing to
// have while the app had no chrome and nowhere to land. Now each half has its own shell with its own
// nav, so this page's only job is to say which of the two apps you want; the nav for the screens inside
// them is in the shell, where an operator will look for it.
//
// Cross-boundary navigation is a plain <a href>, in both directions — that is all a strangler needs when
// both halves are on one origin (report.md §3.5). Legacy tabs are addressable as `#tab=<id>` (v213), so
// the shells' navs hand off to a specific screen rather than dumping the operator on a default view.

// The index borrows HR OS's stylesheet: `page-head` is defined in hros.html and nowhere else, and this
// page is not inside either route tree. The root layout imports no stylesheet — see app/hr/layout.tsx.
import './hr/legacy.css';
import '../src/shell.css';
import { ALL_SCREENS } from '../src/nav';
import { BASE_PATH } from '../src/portal';

const count = (app: 'hr' | 'finance') => {
  const all = ALL_SCREENS.filter((e) => e.app === app);
  return { done: all.filter((e) => e.migrated).length, total: all.length };
};

export default function Home() {
  const hr = count('hr');
  const fin = count('finance');
  return (
    <main style={{ padding: '28px 34px 64px' }}>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">CTG</div>
          <h2 className="page-title">Finance Portal · React</h2>
          <div className="page-sub">
            Both apps, in the shell they are being migrated into. Every screen is in the nav; the ones that
            have not moved yet open in the single-file app they still live in, unchanged.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
        <App href={`${BASE_PATH}/hr/`} mark="👥" name="HR OS" sub="CTG Payroll Suite"
          done={hr.done} total={hr.total}
          blurb="Payroll, leave, claims, attendance and the employee self-service screens." />
        <App href={`${BASE_PATH}/finance/`} mark="📊" name="Finance OS" sub="Live from Xero"
          done={fin.done} total={fin.total}
          blurb="Dashboards, approvals, invoicing, reconciliation, master data and admin." />
      </div>
      <div className="panel" style={{ marginTop: '16px' }}>
        <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
          <b>Nothing here has replaced anything.</b> The apps staff use are still{' '}
          <a href={`${BASE_PATH}/hros.html`}>hros.html</a> and <a href={`${BASE_PATH}/app.html`}>app.html</a>,
          byte for byte as they were. These pages read the same session and the same backend, and each
          migrated screen is diffed against a captured baseline of the page it mirrors.
        </div>
      </div>
    </main>
  );
}

function App(p: { href: string; mark: string; name: string; sub: string; done: number; total: number; blurb: string }) {
  return (
    <a className="panel" href={p.href}
      style={{ flex: '1 1 300px', textDecoration: 'none', display: 'block', color: 'inherit' }}>
      <div className="side-brand" style={{ border: 'none', padding: '0 0 12px' }}>
        <div className="side-brand-mark">{p.mark}</div>
        <div><div className="side-brand-name">{p.name}</div><div className="side-brand-sub">{p.sub}</div></div>
      </div>
      <div className="muted" style={{ fontSize: '12.5px', lineHeight: 1.55 }}>{p.blurb}</div>
      <div className="muted" style={{ fontSize: '11.5px', marginTop: '10px' }}>
        {`${p.done} of ${p.total} screens are React · the rest open in the legacy app`}
      </div>
    </a>
  );
}

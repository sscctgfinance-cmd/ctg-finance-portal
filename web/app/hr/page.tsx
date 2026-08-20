// HR OS's index — the page `/hr/` lands on, inside the HR shell.
//
// It belongs to no `HR_NAV` view (so the sidebar highlights nothing), and it exists because the shell
// needs an entry point that is not one of the screens: `hrRender()`'s landing view is decided per role
// (dashboard for an admin, clock or expenses for an employee — hros.html:1533), and hard-coding one here
// would send half the operators somewhere their role cannot reach. The nav is the sidebar; this says so.

import { ALL_SCREENS } from '../../src/nav';
import { BASE_PATH } from '../../src/portal';

const HR = ALL_SCREENS.filter((e) => e.app === 'hr');

export default function HrHome() {
  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">HR OS</div>
          <h2 className="page-title">HR OS</h2>
          <div className="page-sub">Pick a screen from the sidebar — what is listed there is what your role may reach.</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd"><h3>{HR.filter((e) => e.migrated).length} of {HR.length} HR screens are React</h3></div>
        <div className="muted" style={{ fontSize: '12.5px', lineHeight: 1.6 }}>
          They render from the same session and the same backend as{' '}
          <a href={`${BASE_PATH}/hros.html`}>hros.html</a>, which is unchanged and still the app staff use,
          and each is diffed against a captured baseline of the legacy screen it mirrors.
        </div>
      </div>
    </>
  );
}

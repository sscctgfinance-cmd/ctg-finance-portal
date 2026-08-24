// Finance OS's index — the page `/finance/` lands on, inside the Finance shell.
//
// It belongs to no tab (so the tab strip highlights nothing) and exists for the same reason the HR index
// does: `showApp()` picks the landing tab from this login's own feature list (app.html:1447), so
// hard-coding one here would land some operators on a tab they are not permitted to see. The tab bar
// above is the nav — every tab is migrated and renders here.

import { ALL_SCREENS } from '../../src/nav';
import { BASE_PATH } from '../../src/portal';

const FIN = ALL_SCREENS.filter((e) => e.app === 'finance');

export default function FinanceHome() {
  return (
    <div className="panel">
      <div className="panel-hd"><h3>{FIN.filter((e) => e.migrated).length} of {FIN.length} Finance tabs are React</h3></div>
      <div className="muted" style={{ fontSize: '12.5px', lineHeight: 1.6 }}>
        Pick a tab above. Every tab renders here from the same session and the same backend;{' '}
        <a href={`${BASE_PATH}/app.html`}>app.html</a> is still live and unchanged. What is listed is what
        your permissions allow — the server gates every one of them again regardless.
      </div>
    </div>
  );
}

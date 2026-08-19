'use client';

// The React app's index, for as long as there is one migrated screen. It exists so that opening the app
// lands somewhere that says what is and is not migrated, rather than a 404.
//
// Cross-boundary navigation is a plain <a href>, in both directions — that is all a strangler needs when
// both halves are on one origin (report.md §3.5). Legacy tabs are addressable as `#tab=<id>` (v213), so a
// link can hand off to a specific screen instead of dumping the operator on the default view.

import { legacyUrl } from '../src/portal';

export default function Home() {
  return (
    <main style={{ padding: '28px 34px 64px' }}>
      <div className="page-head">
        <div>
          <div className="page-eyebrow">CTG</div>
          <h2 className="page-title">Finance Portal · React</h2>
          <div className="page-sub">Migrated screens. Everything else is still the single-file apps, unchanged.</div>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd"><h3>Migrated</h3></div>
        <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 2 }}>
          <li><a href="hr/access/">HR OS · Access &amp; Roles</a></li>
          <li><a href="hr/clock/">HR OS · Time Clock</a></li>
          <li><a href="hr/approvals/">HR OS · Approvals</a></li>
          <li><a href="hr/attendance/">HR OS · Attendance</a></li>
          <li><a href="hr/yearend/">HR OS · Year-end</a></li>
        </ul>
      </div>
      <div className="panel">
        <div className="panel-hd"><h3>Not migrated</h3></div>
        <ul style={{ margin: 0, paddingLeft: '18px', lineHeight: 2 }}>
          <li><a href={legacyUrl('hros.html')}>HR OS</a> — the other 17 views</li>
          <li><a href={legacyUrl('app.html')}>Finance OS</a> — all 22 tabs</li>
        </ul>
      </div>
    </main>
  );
}

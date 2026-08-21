// HR OS · Claims — the React half of the thirteenth migrated screen.
//
// The legacy original is `hrClaims()` at hros.html:3699 (with `hrDecideClaim()` at :3706) and it is
// STILL THERE and still shipping; nothing was deleted. Both are reachable side by side
// (`hros.html#tab=claims` and `/hr/claims/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-claims.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.claims.html. The session, the `hr_bootstrap` load and the decide POST live in
// app/hr/claims/page.tsx, on the other side of that line.
//
// The markup mirrors the legacy string concatenation element for element, including the inline `style`
// strings and the single space between the two action buttons. It is not "better" — it is the SAME,
// because the golden is the contract.
//
// ── THIS IS NOT AN EMPLOYEE SCREEN, and that is the permission boundary ────────────────────────────
// Claims sits in `HR_NAV` under "People" (hros.html:1463) and NOT in `HR_EMP_NAV` (hros.html:1476-1482).
// `hrRender()` enforces that before it ever calls the renderer: hros.html:1531 forces `HR.view` to
// `clock`/`expenses` when `HR_EMP_MODE` is set, so an employee can never land here — which is why the
// golden was captured with `HR_EMP_MODE=false` and no extra setup (tests/render_surfaces.ts:55). It
// matters: every row on this screen is SOMEONE ELSE'S claim — their name, their category, their amount —
// and the Approve/Reject buttons decide another person's money. The employee-facing half of this module
// is `hr.expenses` (Reimbursement), which is scoped to the caller.
//
// The gate is therefore UPSTREAM of the renderer, so it is exported from here as `claimsReachable()`
// rather than hidden inside the route where no test could see it, and app/hr/claims/page.tsx refuses
// to load or render the screen when it returns false. `hr_bootstrap` is admin-only server-side too
// (hros.html:1375), so employee mode never even has `HR.data.claims` to draw.
//
// ── needs-decision (NOT fixed here) ────────────────────────────────────────────────────────────────
// `hrClaims()` does NOT wrap its Approve/Reject buttons in `hrRW()` (hros.html:1374), unlike every other
// admin screen in this file, so a `viewer` role sees live write controls here. That is a legacy finding,
// not something this migration may quietly change: the golden was captured with `HR_VIEWER=false` and
// holds no evidence either way, so adding a gate would be an invisible behaviour change riding along
// with a port. Mirrored as-is; raised in the PR.

/** One row of `hr_bootstrap.claims` — tests/render_fixtures.ts:353. */
export interface Claim {
  id: string;
  category: string;
  amount: number | string | null;
  claim_date: string;
  note?: string | null;
  /** 'Pending' | 'Approved' | 'Rejected' — only 'Pending' carries the action buttons. */
  status: string;
  employee?: { name?: string | null } | null;
}

export interface HrClaimsProps {
  claims: Claim[];
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /** `hrDecideClaim()` — hros.html:3706. */
  onDecide: (id: string, status: 'Approved' | 'Rejected') => void;
}

/** `M()` — hros.html:1268. */
function M(n: number | string | null | undefined): string {
  return 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * `hrEmpBoot()`'s trigger — hros.html:1368. Everything that is not admin / hr_admin / viewer is put into
 * employee self-service mode, where `HR_NAV` is replaced wholesale by `HR_EMP_NAV`.
 */
export function isEmpMode(role?: string | null): boolean {
  return !!role && role !== 'admin' && role !== 'hr_admin' && role !== 'viewer';
}

/** hros.html:1531 — `claims` is not one of the five views employee mode may hold. */
export function claimsReachable(role?: string | null): boolean {
  return !isEmpMode(role);
}

export default function HrClaims({ claims, companyName, onDecide }: HrClaimsProps) {
  return (
    <>
      {/* The page head is built by hrRender(), not hrClaims() — hros.html:1537. Shared chrome, and
          report.md §3.5 keeps chrome out of a screen-by-screen strangler, but it is inside the `#hr`
          element the golden holds, so leaving it out would mean diffing against an arbitrary slice.
          The `viewer-badge` hrRender() puts before the chip is absent for the same reason it is absent
          from the golden: HR_VIEWER is false there. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">People</div>
          <h2 className="page-title">Claims</h2>
          <div className="page-sub">Review and approve expense claims</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd"><h3>Claims</h3></div>
        <div className="tbl-wrap">
          <table className="bigtable">
            <thead>
              <tr>
                <th>Employee</th><th>Category</th><th className="amt">Amount</th>
                <th>Date</th><th>Note</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {claims.length ? claims.map((x) => <Row key={x.id} x={x} onDecide={onDecide} />) : (
                // NOT IN THE GOLDEN — the fixture has three claims, so the empty table is not covered by
                // the parity diff. Mirrored from hros.html:3703 anyway: leaving it out would render a
                // company with no claims as a headed table with nothing under it.
                <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '20px' }}>No claims</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** One `<tr>` of hros.html:3701-3703. */
function Row({ x, onDecide }: { x: Claim; onDecide: HrClaimsProps['onDecide'] }) {
  const st = x.status;
  const col = st === 'Approved' ? 'var(--green-soft)' : st === 'Rejected' ? 'var(--red-soft)' : 'var(--amber)';
  return (
    <tr>
      <td>{(x.employee && x.employee.name) || '—'}</td>
      <td>{x.category}</td>
      <td className="amt">{M(x.amount)}</td>
      <td className="muted">{x.claim_date}</td>
      <td className="muted" style={{ fontSize: '11px' }}>{x.note || ''}</td>
      <td><span className="pill" style={{ color: col, fontSize: '10px' }}>{st}</span></td>
      {/* hros.html:3702 — the action cell is EMPTY unless the claim is still Pending. A decided claim
          must not offer a second decision: hrDecideClaim() POSTs unconditionally, so a stray button on
          an Approved row is a silent reversal of someone's approved reimbursement. */}
      <td style={{ whiteSpace: 'nowrap' }}>
        {st === 'Pending' ? (
          <>
            <button className="btn xs" onClick={() => onDecide(x.id, 'Approved')}>Approve</button>{' '}
            <button className="btn xs" onClick={() => onDecide(x.id, 'Rejected')}>Reject</button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

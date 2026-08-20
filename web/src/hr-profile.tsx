// HR OS · My Profile — the React half of the strangler's thirteenth screen, and the FIRST one that writes
// the employee's own master record.
//
// The legacy original is `hrEmpProfile()` at hros.html:3243 (with `hrSigPanel()` at :3312 and the save at
// :3383) and it is STILL THERE and still shipping; nothing was deleted. Both are reachable side by side
// (`hros.html#tab=profile` and `/hr/profile/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. That is what lets
// tests/hr-profile.parity.test.tsx render it with `renderToStaticMarkup` and diff the result against
// tests/golden/hr.profile.html. The loading (`hr_rc_config`, `hr_banks_list`), the session and the POST
// live in app/hr/profile/page.tsx, on the other side of that line.
//
// ── The two things this screen has to get right, beyond matching the golden ─────────────────────────
//
// 1. THE READ SIDE IS A PERMISSION BOUNDARY. The component is handed the WHOLE `hr_employees` row —
//    `basic_salary`, `fixed_allowance`, `pay_type`, `status`, `manager_id`, `user_id` and the rest. The
//    legacy screen renders eight of those fields as READ-ONLY TEXT (the "Employment" card) and renders
//    the pay fields NOT AT ALL. Adding a field here is not a cosmetic change; it is a disclosure. The
//    parity test pins the whole document, and additionally asserts that no pay figure appears anywhere
//    in the markup and that the Employment card contains no editable control.
//
// 2. THE WRITE SIDE IS A WHITELIST. `hrEmpProfileSave()` (hros.html:3383) posts exactly seventeen keys
//    under `profile:` and NO employee id — the server derives the target from the token
//    (`rcMe(meFromToken(...))`, hr.ts:1362) and there is no parameter that could aim it elsewhere. Both
//    halves of that are load-bearing, so the body is built by `profileBody()` below — a pure function,
//    exported, and pinned key-for-key by the test. A key added there is a privilege escalation even if
//    the server happens to ignore it today.
//
// NOT reached by the golden, and therefore not covered by the parity diff — mirrored from the legacy
// source anyway, because leaving them out would wire a button to nothing:
//   • the "no employee record" empty state (`hrEmpty` — RC.me.employee is set in the fixture);
//   • the SAVED-SIGNATURE branch of the signature panel (the fixture employee has none);
//   • the signature PAD (`SIG.open` is false after every `hrNav()`).
// Each is asserted separately in the test instead.

import type { CSSProperties } from 'react';

/** One row of `hr_banks_list` — hros.html:3247. Only the active ones reach this component. */
export interface Bank {
  code: string;
  name: string;
}

/**
 * `RC.me.employee` — the caller's OWN `hr_employees` row.
 *
 * Deliberately typed as the fields this screen reads and nothing else. The route passes the whole row
 * through (it is what `hr_rc_config` returns), but anything absent from this interface is a field the
 * screen has no business showing, which is the point of item 1 in the header.
 */
export interface ProfileEmployee {
  emp_no?: string | null;
  name?: string | null;
  dept?: string | null;
  position?: string | null;
  employment_type?: string | null;
  join_date?: string | null;
  email?: string | null;
  ic_no?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  nationality?: string | null;
  marital_status?: string | null;
  num_children?: number | null;
  spouse_working?: boolean | null;
  phone?: string | null;
  emergency_name?: string | null;
  emergency_phone?: string | null;
  address?: string | null;
  bank_code?: string | null;
  bank_holder?: string | null;
  bank_account?: string | null;
  epf_no?: string | null;
  socso_no?: string | null;
  tax_no?: string | null;
  signature?: string | null;
  signature_updated_at?: string | null;
}

export interface HrProfileProps {
  /** `RC.me && RC.me.employee` — hros.html:3244. `null` renders the legacy empty state. */
  employee: ProfileEmployee | null;
  /** `hrCompanyName()` — hros.html:4445. Chrome, so it is passed in rather than resolved here. */
  companyName: string;
  /**
   * `EPRO.banks` — hros.html:3247. `null` means "still loading", and the legacy form renders the
   * picker with only its placeholder in that window. That distinction is not cosmetic: see
   * `profileBody()`'s `banksLoaded`.
   */
  banks: Bank[] | null;
  onSave: () => void;
  onSigStart: () => void;
  onSigClearSaved: () => void;
  onPwModal: () => void;
}

/** The legacy `S` control style — hros.html:3248. */
const S: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--panel-2)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '13px',
};

/** `g()` — hros.html:3249. A labelled form cell. */
function G({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="muted" style={{ fontSize: '11px', display: 'block', marginBottom: '3px' }}>{label}</label>
      {children}
    </div>
  );
}

/** `inp()` — hros.html:3250. Uncontrolled, exactly as the legacy input is: the ID is the contract,
    because `profileBody()` reads the value back out of the DOM by it, same as `hrEmpProfileSave()`. */
function Inp({ id, val, ph }: { id: string; val?: string | null; ph?: string }) {
  return <input id={id} defaultValue={val == null ? '' : String(val)} placeholder={ph || ''} style={S} />;
}

/** `ro()` — hros.html:3251. Read-only text. NOT an input, and that is the permission boundary. */
function Ro({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: '11px', marginBottom: '2px' }}>{label}</div>
      <div style={{ fontSize: '13px', fontWeight: '600' }}>{value == null || value === '' ? '—' : String(value)}</div>
    </div>
  );
}

const SECTION: CSSProperties = {
  fontSize: '10.5px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '8px',
};
const GRID: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '10px', marginBottom: '14px',
};

const MARITAL = ['single', 'married', 'divorced', 'widowed'];

/**
 * The keys `hrEmpProfileSave()` sends, in its order — hros.html:3392-3402.
 *
 * Exported so the test can pin the write whitelist against this list AND against the legacy source, and
 * so that a key added here without a matching legacy field fails rather than shipping. `bankCode` is not
 * in it: it is conditional, and `profileBody()` documents why.
 */
export const PROFILE_KEYS = [
  'ic', 'dob', 'gender', 'nationality', 'maritalStatus', 'numChildren', 'spouseWorking',
  'phone', 'address', 'emergencyName', 'emergencyPhone',
  'bankHolder', 'bankAccount', 'epfNo', 'socsoNo', 'taxNo',
] as const;

/** What `profileBody()` returns: either the POST body, or the one validation error the legacy has. */
export type ProfileBody =
  | { error: string }
  | { api: 'hr_my_profile_save'; profile: Record<string, unknown> };

/**
 * `hrEmpProfileSave()`'s body, as a pure function — hros.html:3383.
 *
 * Split out of the route for the same reason `bankFile()` was split out of hr-expenses: what leaves the
 * building has to be pinnable by a test, and no golden can see a POST body. The route keeps the fetch,
 * the button state and the toast.
 *
 * @param v            reads a form control's value by its legacy id, exactly as the legacy `v()` does.
 * @param spouseWorking `#pf_sw`'s checked state.
 * @param banksLoaded  whether `hr_banks_list` has resolved. NOT cosmetic — v159: the form renders before
 *                     the bank list does, so `#pf_bank` briefly holds only its placeholder, and saving in
 *                     that window sent `bankCode:''` and nulled a `bank_code` the employee never touched.
 *                     The bank NAME survived, so nothing looked wrong until a payment file came out with a
 *                     blank SWIFT/BIC. `hr_my_profile_save` treats an ABSENT key as "unchanged"
 *                     (hr.ts:1384), so the key is omitted rather than sent empty.
 *
 * There is no employee id here, and there must never be one: the server resolves the target from the
 * token (hr.ts:1362-1364). A caller-supplied id would turn a self-service form into an HR one.
 */
export function profileBody(v: (id: string) => string, spouseWorking: boolean, banksLoaded: boolean): ProfileBody {
  const acct = String(v('pf_acct') || '').replace(/\D/g, '');
  if (v('pf_acct') && !acct) return { error: 'Account number should be digits' };
  const profile: Record<string, unknown> = {
    ic: v('pf_ic'), dob: v('pf_dob'), gender: v('pf_gender'), nationality: v('pf_nat'),
    maritalStatus: v('pf_ms'), numChildren: v('pf_kids'), spouseWorking: !!spouseWorking,
    phone: v('pf_phone'), address: v('pf_addr'), emergencyName: v('pf_ename'), emergencyPhone: v('pf_ephone'),
    bankHolder: v('pf_holder'), bankAccount: acct,
    epfNo: v('pf_epf'), socsoNo: v('pf_socso'), taxNo: v('pf_tax'),
  };
  if (banksLoaded) profile.bankCode = v('pf_bank');
  return { api: 'hr_my_profile_save', profile };
}

export default function HrProfile(props: HrProfileProps) {
  const { employee: emp, companyName, banks, onSave, onSigStart, onSigClearSaved, onPwModal } = props;

  return (
    <>
      {/* The page head is built by hrRender(), not hrEmpProfile() — hros.html:1537. Shared chrome, and
          report.md §3.5 keeps chrome out of a screen-by-screen strangler, but it is inside the `#hr`
          element the golden holds, so leaving it out would mean diffing against an arbitrary slice.
          The sub-title is HR_NAV's (hros.html:1472), which is what the golden was captured under;
          HR_EMP_NAV words the same screen "View and update your personal details" (:1480). That is a
          chrome difference between two modes of the shell this app does not have yet — the screen body
          below is byte-identical in both, so the difference belongs to the shell that does not exist
          yet — not to this component. Hard-coded to the golden's wording; when the shell lands it can
          own the head, as report.md §3.5 says. */}
      <div className="page-head">
        <div>
          <div className="page-eyebrow">Me</div>
          <h2 className="page-title">My Profile</h2>
          <div className="page-sub">Your own details, password and signature</div>
        </div>
        <div className="page-meta">
          <span className="page-chip"><span className="dot"></span>{companyName}</span>
        </div>
      </div>

      {/* hros.html:3245. Not in the golden — RC.me.employee is set in the fixture — so the test asserts
          it separately. Without it, an unlinked login would get a blank screen instead of the sentence
          telling them to ask HR. */}
      {!emp ? (
        <div className="empty">
          <div className="empty-ico">{/* ic('user',34) is shared chrome; the icon sprite is not migrated */}</div>
          <div>Your login isn’t linked to an employee profile yet — ask HR to enable your access.</div>
        </div>
      ) : (
        <>
          <EmploymentCard emp={emp} companyName={companyName} />
          <DetailsForm emp={emp} banks={banks} onSave={onSave} />
          <SigPanel emp={emp} onSigStart={onSigStart} onSigClearSaved={onSigClearSaved} />
          <div className="panel" style={{ marginTop: '14px' }}>
            <div className="panel-hd"><h3>Security</h3></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={onPwModal}>🔑 Change password</button>
              <span className="muted" style={{ fontSize: '11.5px' }}>Your password signs you in to HR OS. Use at least 8 characters with letters and numbers.</span>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The read-only employment card — hros.html:3253.
 *
 * Every field here is HR-managed and appears as TEXT. There is no input, no select and no textarea in
 * this subtree, and the test asserts that: the difference between this card and the form below it is the
 * difference between "what HR maintains about you" and "what you may change about yourself".
 */
function EmploymentCard({ emp, companyName }: { emp: ProfileEmployee; companyName: string }) {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="panel-hd">
        <h3>Employment</h3>
        <span className="pill pill-neu" style={{ fontSize: '10px' }}>HR-managed</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px' }}>
        <Ro label="Employee no" value={emp.emp_no} />
        <Ro label="Name" value={emp.name} />
        <Ro label="Company" value={companyName} />
        <Ro label="Department" value={emp.dept} />
        <Ro label="Position" value={emp.position} />
        <Ro label="Employment type" value={emp.employment_type || 'Full-time'} />
        <Ro label="Join date" value={emp.join_date} />
        <Ro label="Login email" value={emp.email} />
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '10px' }}>These are maintained by HR — contact HR if anything here is wrong (including your login email).</div>
    </div>
  );
}

/** The editable form — hros.html:3260. Every control here is one the legacy screen let the employee write. */
function DetailsForm({ emp, banks, onSave }: { emp: ProfileEmployee; banks: Bank[] | null; onSave: () => void }) {
  const ms = String(emp.marital_status || 'single').toLowerCase();
  return (
    <div className="panel">
      <div className="panel-hd"><h3>My details</h3></div>
      <div className="muted" style={{ fontSize: '11px', marginBottom: '12px' }}>Updates save straight into your official HR record (the same master data HR and payroll use). Every change is logged.</div>

      <div className="muted" style={SECTION}>Personal</div>
      <div style={GRID}>
        <G label="IC number"><Inp id="pf_ic" val={emp.ic_no} ph="e.g. 901231-07-1234" /></G>
        <G label="Date of birth"><input type="date" id="pf_dob" defaultValue={emp.date_of_birth || ''} style={S} /></G>
        <G label="Gender">
          <select id="pf_gender" style={S} defaultValue={emp.gender || ''}>
            <option value="">—</option>
            <option>Male</option>
            <option>Female</option>
          </select>
        </G>
        <G label="Nationality"><Inp id="pf_nat" val={emp.nationality} ph="e.g. Malaysian" /></G>
        <G label="Marital status">
          <select id="pf_ms" style={S} defaultValue={ms}>
            {MARITAL.map((x) => <option key={x} value={x}>{x.charAt(0).toUpperCase() + x.slice(1)}</option>)}
          </select>
        </G>
        <G label="Children"><input type="number" id="pf_kids" min="0" max="20" defaultValue={String(Number(emp.num_children) || 0)} style={S} /></G>
        {/* The legacy writes the entity `&nbsp;` as this label's whole text (hros.html:3270) — a spacer
            that keeps the checkbox on the grid's baseline. Relaxation R2 canonicalises it on both sides. */}
        <G label={'\u00a0'}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', paddingTop: '8px' }}>
            <input type="checkbox" id="pf_sw" defaultChecked={!!emp.spouse_working} style={{ accentColor: 'var(--coral)' }} />{' '}Spouse is working
          </label>
        </G>
      </div>

      <div className="muted" style={SECTION}>Contact</div>
      <div style={GRID}>
        <G label="Phone"><Inp id="pf_phone" val={emp.phone} ph="e.g. 012-3456789" /></G>
        <G label="Emergency contact name"><Inp id="pf_ename" val={emp.emergency_name} /></G>
        <G label="Emergency contact phone"><Inp id="pf_ephone" val={emp.emergency_phone} /></G>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <G label="Home address">
          <textarea id="pf_addr" rows={2} defaultValue={emp.address || ''} style={{ ...S, resize: 'vertical' }} />
        </G>
      </div>

      <div className="muted" style={SECTION}>Bank &amp; statutory</div>
      <div style={GRID}>
        <G label="Bank">
          <select id="pf_bank" style={S} defaultValue={emp.bank_code || ''}>
            <option value="">— select bank —</option>
            {(banks || []).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </G>
        <G label="Account holder name"><Inp id="pf_holder" val={emp.bank_holder} /></G>
        <G label="Account number"><Inp id="pf_acct" val={emp.bank_account} ph="digits only" /></G>
        <G label="EPF (KWSP) no"><Inp id="pf_epf" val={emp.epf_no} /></G>
        <G label="SOCSO (PERKESO) no"><Inp id="pf_socso" val={emp.socso_no} /></G>
        <G label="Income tax (TIN) no"><Inp id="pf_tax" val={emp.tax_no} /></G>
      </div>

      <button className="btn p sm" id="pf_save" onClick={onSave}>Save my details</button>
      <span className="muted" style={{ fontSize: '11px', marginLeft: '10px' }}>Marital status &amp; children affect your monthly PCB (tax); your bank details are used for salary payment — please double-check them.</span>
    </div>
  );
}

/**
 * `hrSigPanel()` — hros.html:3312.
 *
 * The SAVED branch is not in the golden (the fixture employee has no signature) and the pad is not
 * either (`SIG.open` is false after every `hrNav()`), so neither is covered by the parity diff. Both are
 * mirrored from the legacy source anyway — dropping them would leave "Re-sign" and "Remove" wired to
 * nothing for anyone who has signed — and the test asserts the saved branch separately.
 *
 * The pad itself is NOT migrated: `hrSigBind()` (hros.html:3327) is a canvas drawing surface driven by
 * mouse/touch listeners and `hrSigSave()` reads `toDataURL()` back off it. That is imperative device
 * code, not markup, and it has no golden. `onSigStart` hands off; the legacy screen keeps the pad.
 */
function SigPanel({ emp, onSigStart, onSigClearSaved }: { emp: ProfileEmployee; onSigStart: () => void; onSigClearSaved: () => void }) {
  const cur = emp && emp.signature;
  return (
    <div className="panel" style={{ marginTop: '14px' }}>
      <div className="panel-hd"><h3>✍️ My signature</h3></div>
      <div className="muted" style={{ fontSize: '11px', marginBottom: '10px' }}>Printed above <b>Prepared by</b> on the reimbursement claim forms you submit. Only you can set your own signature.</div>
      {cur ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <img src={cur} alt="Your signature" style={{ height: '56px', maxWidth: '220px', background: '#fff', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px' }} />
          <span className="muted" style={{ fontSize: '11px' }}>Saved{emp.signature_updated_at ? ' ' + hrDT(emp.signature_updated_at) : ''}</span>
          <button className="btn xs" onClick={onSigStart}>Re-sign</button>{' '}
          <button className="btn xs d" onClick={onSigClearSaved}>Remove</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: '12px' }}>No signature saved — your claim forms print a blank line.</span>
          <button className="btn p xs" onClick={onSigStart}>✍️ Add my signature</button>
        </div>
      )}
    </div>
  );
}

/** `hrDT()` — hros.html:1246. Malaysia wall clock from a stored UTC instant, arithmetic not zone lookup,
    so it does not depend on the machine's timezone. */
export function hrDT(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  const m = new Date(d.getTime() + 8 * 3600000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m.getUTCMonth()];
  const hh = m.getUTCHours(), ap = hh < 12 ? 'am' : 'pm', h12 = ((hh + 11) % 12) + 1;
  const mm = String(m.getUTCMinutes()).padStart(2, '0');
  return m.getUTCDate() + ' ' + mon + ' ' + m.getUTCFullYear() + ', ' + h12 + ':' + mm + ap;
}

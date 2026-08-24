// HR OS · Reimbursement — the SUBMIT form, migrated.
//
// The legacy original is `hrRCForm()` at hros.html:2000, one of the five bodies `hrRC()` (hros.html:1783)
// dispatches over. It is STILL THERE and still shipping; nothing was deleted.
//
// ── Why this is its own file, and why it is a golden ────────────────────────────────────────────────
// CLAUDE.md's rule from `hr.leave`: when a mode is a WHOLE OTHER SCREEN behind one nav id, capture the
// golden. `RC.page` is exactly that — `hrRC()` switches `hrRCList()` / `hrRCForm()` / `hrRCDetail()` on
// one id, and `tests/golden/hr.expenses.html` only ever held the list. A golden cannot see a screen that
// is never mounted, and until v225 the React route sent every Submit click back to hros.html, so no
// employee could file a claim from React at all. `tests/golden/hr.expenses.form.html` is the 42nd
// surface and is what makes this renderer diffable.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, NO CLOCK. `hrRCForm()` reads
// `todayLocalISO()` twice (hros.html:2002, :2055); both are `today`, handed in, which is `hr.yearend`'s
// `taxYears(now)` rule: the derivation stays under test instead of moving somewhere the golden cannot
// see it.
//
// ── The form is UNCONTROLLED and its `rc_*` ids ARE the contract ────────────────────────────────────
// `hrRCSyncItems()` (hros.html:2062) reads this form back out of the DOM by element id — `rc_emp`,
// `rc_date`, `rc_it_<i>_amt` and twenty more. CLAUDE.md's `qi_*` / `wp_*` rule applies: keep the control
// uncontrolled, keep the id, and let the route read the same ids. A controlled port would add an
// `onChange` the golden does not carry AND emit `value=""` no golden has.
// `web/tests/hr-expenses-form.parity.test.tsx` extracts the id set out of hros.html at RUN TIME rather
// than retyping it: a field that loses its id saves as BLANK, which on this form is a dropped expense
// line or a wiped amount, with no error anywhere.
//
// ── NOT reachable from the golden, mirrored anyway ─────────────────────────────────────────────────
// The golden is captured with `RC.form` empty, so: the `⋯` per-line detail block (`it._open`), the
// mileage variant of the amount cell (no fixture line picks the Mileage type), the e-Inv pill, the
// pending-receipts list (`hrRCPendingHtml()`), the 📎 supporting-documents panel, and the "Edit
// reimbursement form" title (`f.id`) all render in no golden. Each is mirrored from the legacy source
// and asserted in the screen's own test.

import type { CSSProperties } from 'react';

/** `RC_SEL` — hros.html:1782. One string, reused; kept as one string so the golden matches byte for byte. */
const RC_SEL = 'width:100%;padding:8px 10px;background:var(--panel-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:13px';
/** `RC_TD` — hros.html:1991. */
const RC_TD = 'padding:6px 8px;background:var(--panel-2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12.5px';

/**
 * `st()` — the inline-style splitter every migrated screen with more than a handful of declarations
 * uses. React serialises a style OBJECT, and the legacy writes a STRING; parsing the legacy's own
 * string is what keeps the declaration order and the spelling identical instead of re-typing it.
 */
export function st(css: string): CSSProperties {
  const out: Record<string, string> = {};
  css.split(';').forEach((d) => {
    const i = d.indexOf(':');
    if (i < 0) return;
    const k = d.slice(0, i).trim();
    if (!k) return;
    out[k.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase())] = d.slice(i + 1).trim();
  });
  return out as CSSProperties;
}

/** `M()` — hros.html:1268. */
const M = (n: unknown) =>
  'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── The shapes ─────────────────────────────────────────────────────────────────────────────────────

export interface RcClaimType {
  id: string;
  name?: string | null;
  active?: boolean;
  is_mileage?: boolean;
  gl_account?: string | null;
  requires_receipt?: boolean;
}
export interface RcMileageRate { id?: string; rate: number | string; label?: string | null; active?: boolean; is_default?: boolean }
export interface RcCostCenter { id?: string; code: string; name: string; active?: boolean }
export interface RcEmployeeOpt { id: string; emp_no?: string | null; name?: string | null }

/** `RC.cfg` — whatever `hr_rc_config` returned (hr.ts:1914). Only what this form reads. */
export interface RcConfig {
  claim_types?: RcClaimType[];
  mileage_rates?: RcMileageRate[];
  cost_centers?: RcCostCenter[];
  employees?: RcEmployeeOpt[];
}

/** One row of `RC.form.items` — hros.html:2002. Every field is a STRING while it is in the form. */
export interface RcFormItem {
  claim_type_id?: string;
  item_date?: string;
  description?: string;
  amount?: string | number;
  total_km?: string | number;
  mileage_rate?: string | number;
  vendor_name?: string;
  receipt_no?: string;
  invoice_no?: string;
  tax_amount?: string | number;
  sst_amount?: string | number;
  supplier_tin?: string;
  einvoice_uuid?: string;
  einvoice_validation_url?: string;
  is_einvoice?: boolean;
  gl_account?: string;
  cost_center?: string;
  project?: string;
  remarks?: string;
  start_location?: string;
  end_location?: string;
  purpose?: string;
  parking_amount?: string | number;
  toll_amount?: string | number;
  /** `it._open` — the `⋯` detail block. UI only; never posted. */
  _open?: boolean;
}

/** An attachment already saved against the claim being EDITED — `f._existingAtts` (hros.html:2604). */
export interface RcSavedAtt { file_name?: string | null; url?: string | null }

/** `RC.form` — hros.html:2000. */
export interface RcForm {
  id?: string;
  employee_id?: string;
  claim_date?: string;
  claim_month?: string;
  cost_center?: string;
  department?: string;
  project?: string;
  remarks?: string;
  description?: string;
  items?: RcFormItem[];
  _existingAtts?: RcSavedAtt[];
}

/** What a queued file looks like to this component — the name and the size, nothing more. */
export interface PendingFile { name?: string; size?: number; type?: string }

export interface HrExpensesFormProps {
  form: RcForm;
  cfg: RcConfig;
  /** `RC.form.items`, already defaulted to one blank row by the route (hros.html:2002 does it inline). */
  items: RcFormItem[];
  /** `RC.form._files` — receipts picked with the plain file input, held in JS so a re-render cannot eat them. */
  pending: PendingFile[];
  /** `RC.form._scanFiles` — cropped scans queued by the camera / picker path. */
  scans: PendingFile[];
  /** `todayLocalISO()` (hros.html:2002, :2055) as a value. See the header. */
  today: string;
  /** `hrRCSave`'s `RC._saving` guard, surfaced so the two buttons can go disabled. */
  saving: boolean;
  /** `#rc_scan_status`'s text — the scanner writes into it imperatively in the legacy. */
  scanStatus: string;

  onClose: () => void;
  onItemType: (i: number) => void;
  onItemMore: (i: number) => void;
  onItemDel: (i: number) => void;
  onItemAdd: () => void;
  onItemCalc: () => void;
  onScanTrigger: () => void;
  onScanPickFile: () => void;
  onScanFile: (input: HTMLInputElement) => void;
  onScanPreview: (i: number) => void;
  onScanRemove: (i: number) => void;
  onPickReceipts: (input: HTMLInputElement) => void;
  onReceiptRemove: (i: number) => void;
  onSave: (submit: boolean) => void;
}

// ── The money ──────────────────────────────────────────────────────────────────────────────────────

/**
 * `hrRCItemAmt()` — hros.html:1998, character for character.
 *
 * DO NOT "TIDY" THIS. Its own comment in hros.html says it must stay identical to `hr_rc_save`'s `amt`
 * (hr.ts:2004), which is the same line on the other side of the wire — the server recomputes every line
 * and stores ITS answer, so a client that rounds differently prints one figure and files another.
 * `Math.round(x*100)/100` is half-up and is NOT `toFixed(2)` (CLAUDE.md: they disagree at the half sen).
 */
export function itemAmount(it: RcFormItem, mile: boolean | undefined): number {
  return mile
    ? Math.round(((Number(it.total_km) || 0) * (Number(it.mileage_rate) || 0) + (Number(it.parking_amount) || 0) + (Number(it.toll_amount) || 0)) * 100) / 100
    : Math.round((Number(it.amount) || 0) * 100) / 100;
}

/** Is this line's type a mileage type? `hrRCForm()`'s `mile`, hros.html:2013. */
export const isMileage = (cfg: RcConfig, id?: string): boolean =>
  !!(cfg.claim_types || []).find((x) => x.id === id)?.is_mileage;

/**
 * The header total — `hrRCItemCalc()`'s `total`, hros.html:2080. It is the SUM OF THE ROUNDED LINES,
 * never the rounding of the raw sum, which is `hr_rc_save`'s own order (hr.ts:2019 sums `amt` then
 * rounds once more) and CLAUDE.md's "round where it is STORED" rule. Do not reorder it.
 */
export function formTotal(items: RcFormItem[], cfg: RcConfig): number {
  return items.reduce((s, it) => s + itemAmount(it, isMileage(cfg, it.claim_type_id)), 0);
}

/** `hrRCDefRate()` — hros.html:1992. */
export const defaultRate = (cfg: RcConfig): string | number =>
  (cfg.mileage_rates || []).find((x) => x.is_default)?.rate ?? '';

/** A fresh blank line — `hrRCItemAdd()`, hros.html:2077. */
export const blankItem = (cfg: RcConfig, claimDate: string): RcFormItem =>
  ({ claim_type_id: '', item_date: claimDate, description: '', amount: '', total_km: '', mileage_rate: defaultRate(cfg) });

// ── What leaves the building ───────────────────────────────────────────────────────────────────────

/**
 * `hrRCSave()`'s three refusals — hros.html:2085-2089 — as a pure function, so the parity test can drive
 * each one. Order matters and is the legacy's: employee, then lines, then declarations. Returns the
 * legacy's own message, or null.
 *
 * `isEmp` is `RC.me.isAdmin===false`: an employee has no employee picker to fill in, and the SERVER
 * resolves them from the token (hr.ts:1978, `who.employee.id`), so the client must not demand one.
 */
export function saveRefusal(o: {
  isEmp: boolean;
  employeeId?: string;
  items: RcFormItem[];
  submit: boolean;
  declarations: RcDeclarations;
}): string | null {
  if (!o.isEmp && !o.employeeId) return 'Select an employee';
  if (!keptItems(o.items).length) return 'Add at least one expense line (type + amount)';
  const d = o.declarations;
  if (o.submit && !(d.business_purpose && d.not_claimed_before && d.receipts_valid && d.understand_disciplinary))
    return 'Please tick all four declaration statements before submitting.';
  return null;
}

/**
 * Which typed lines become claim lines — hros.html:2087. A line needs a TYPE and either an amount or a
 * distance; a blank trailing row is dropped rather than posted as RM 0.00.
 */
export const keptItems = (items: RcFormItem[]): RcFormItem[] =>
  items.filter((it) => it.claim_type_id && ((Number(it.amount) || 0) > 0 || (Number(it.total_km) || 0) > 0));

export interface RcDeclarations {
  business_purpose: boolean;
  not_claimed_before: boolean;
  receipts_valid: boolean;
  understand_disciplinary: boolean;
}

/** `hrRCDecs()` — hros.html:2081. The four ids, in the order the server reads them (hr.ts:2185). */
export const DECLARATIONS: [string, string][] = [
  ['dec1', 'I confirm this claim is for business purpose.'],
  ['dec2', 'I confirm this claim has not been claimed before.'],
  ['dec3', 'I confirm all receipts / invoices attached are valid.'],
  ['dec4', 'I understand false claims may result in disciplinary action.'],
];

/**
 * `hrRCSave()`'s `claim` object — hros.html:2092, field for field.
 *
 * Split out of the route for the same reason `profileBody()` and `bankFile()` were: NO GOLDEN SEES A
 * REQUEST BODY. The field SET is what the screen's test pins, out of hros.html's own text — a field
 * dropped here is a vendor, a receipt number or an e-invoice UUID that silently never reaches the row,
 * and a field ADDED is a value the employee never typed.
 *
 * `employee_id` is sent as the form holds it and the SERVER decides: `hr_rc_save` (hr.ts:1978) uses it
 * only when the caller is an admin and otherwise pins the claim to the caller's own employee record.
 * Do not re-implement that rule here — let the refusal surface as the legacy's does.
 */
export function claimBody(f: RcForm, items: RcFormItem[]): Record<string, unknown> {
  return {
    id: f.id || undefined,
    employee_id: f.employee_id,
    claim_date: f.claim_date,
    claim_month: f.claim_month,
    cost_center: f.cost_center,
    department: f.department,
    project: f.project,
    remarks: f.remarks,
    description: f.description,
    items: keptItems(items).map((it) => ({
      claim_type_id: it.claim_type_id,
      item_date: it.item_date || f.claim_date,
      description: it.description,
      amount: Number(it.amount) || 0,
      total_km: Number(it.total_km) || 0,
      mileage_rate: Number(it.mileage_rate) || 0,
      vendor_name: it.vendor_name || '',
      receipt_no: it.receipt_no || '',
      invoice_no: it.invoice_no || '',
      tax_amount: Number(it.tax_amount) || 0,
      sst_amount: Number(it.sst_amount) || 0,
      is_einvoice: !!it.is_einvoice,
      supplier_tin: it.supplier_tin || '',
      einvoice_uuid: it.einvoice_uuid || '',
      einvoice_validation_url: it.einvoice_validation_url || '',
      gl_account: it.gl_account || '',
      cost_center: it.cost_center || '',
      project: it.project || '',
      remarks: it.remarks || '',
      start_location: it.start_location || '',
      end_location: it.end_location || '',
      purpose: it.purpose || '',
      parking_amount: Number(it.parking_amount) || 0,
      toll_amount: Number(it.toll_amount) || 0,
    })),
  };
}

/**
 * `HR_RC_MAX_BYTES` — hros.html:2187. Storage's own ceiling is what really binds; this is the early,
 * clear "no", said BEFORE the employee fills in the whole form and ticks four declarations.
 */
export const HR_RC_MAX_BYTES = 45 * 1024 * 1024;

/**
 * `hrRCPickReceipts()`'s decision — hros.html:2143. Returns what to keep and what to refuse, with the
 * legacy's own de-dupe (re-picking the same file, or a re-render round trip, must not attach it twice)
 * and its size gate. The DOM read and the toast stay in the route.
 */
export function pickReceipts<T extends { name?: string; size?: number; lastModified?: number }>(
  existing: T[],
  picked: T[],
): { files: T[]; refused: string[] } {
  const files = existing.slice();
  const refused: string[] = [];
  picked.forEach((f) => {
    if ((f.size || 0) > HR_RC_MAX_BYTES) { refused.push((f.name || 'file') + ' (' + ((f.size || 0) / 1048576).toFixed(1) + ' MB)'); return; }
    const dup = files.some((x) => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified);
    if (!dup) files.push(f);
  });
  return { files, refused };
}

/** hros.html:2156 — the message the legacy raises for the refused ones. */
export const tooBigMessage = (names: string[]): string =>
  'Too large to attach: ' + names.join(', ') + '. Limit is ' + (HR_RC_MAX_BYTES / 1048576) + ' MB — split the PDF or scan at a lower resolution.';

/** `hrRCPendingHtml()`'s size label — hros.html:2170. */
export function sizeLabel(bytes?: number): string {
  if (!bytes) return '';
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
}

// ── The markup ─────────────────────────────────────────────────────────────────────────────────────

/** `g()` — hros.html:2008. */
function G({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="muted" style={{ fontSize: '11px' }}>{label}</label>{children}</div>;
}
/** `dg()` — hros.html:2010. */
function Dg({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="muted" style={{ fontSize: '10px' }}>{label}</label>{children}</div>;
}

/** `hrRCCcOpts()` — hros.html:1993. */
function CcOptions({ cfg }: { cfg: RcConfig }) {
  return (
    <>
      <option value="">— cost center —</option>
      {(cfg.cost_centers || []).filter((c) => c.active).map((c) => (
        <option key={c.code} value={c.code}>{c.code + ' — ' + c.name}</option>
      ))}
    </>
  );
}

export default function HrExpensesForm(p: HrExpensesFormProps) {
  const { cfg, form: f, items } = p;
  const total = formTotal(items, cfg);
  const claimDate = f.claim_date || p.today;

  return (
    <div className="panel" style={{ maxWidth: '940px' }}>
      <div className="panel-hd">
        <h3>{f.id ? 'Edit reimbursement form' : 'New reimbursement form'}</h3>
        <button className="btn sm" onClick={p.onClose}>✕ Close</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
        <G label="Employee *">
          <select id="rc_emp" defaultValue={f.employee_id || ''} style={st(RC_SEL)}>
            <option value="">— select —</option>
            {(cfg.employees || []).map((e) => <option key={e.id} value={e.id}>{e.emp_no + ' — ' + e.name}</option>)}
          </select>
        </G>
        <G label="Form date *"><input id="rc_date" placeholder="" defaultValue={claimDate} type="date" style={st(RC_SEL)} /></G>
        <G label="Claim month"><input id="rc_month" placeholder="" defaultValue={f.claim_month || String(claimDate).slice(0, 7)} type="month" style={st(RC_SEL)} /></G>
        <G label="Department"><input id="rc_dept" placeholder="" defaultValue={f.department ?? ''} style={st(RC_SEL)} /></G>
        <G label="Cost center"><select id="rc_cc" defaultValue={f.cost_center || ''} style={st(RC_SEL)}><CcOptions cfg={cfg} /></select></G>
        <G label="Project"><input id="rc_project" placeholder="" defaultValue={f.project ?? ''} style={st(RC_SEL)} /></G>
      </div>

      <G label="Purpose / title">
        <input id="rc_desc" placeholder="e.g. Client visit KL — Jun trip" defaultValue={f.description ?? ''} style={st(RC_SEL)} />
      </G>

      <div style={{ margin: '14px 0 6px', fontWeight: 700, fontSize: '13px' }}>
        Expense lines <span className="muted" style={{ fontWeight: 400, fontSize: '11px' }}>· click ⋯ on a line for vendor / receipt no. / tax / mileage details</span>
      </div>

      {/* `f.claim_date`, NOT `claimDate`: hros.html:2036 falls back to the FORM's own date and then to
          the empty string — it does not reach for today's date a second time. A line whose date box is
          silently pre-filled is a line dated to when the claim was typed, not when the money was spent. */}
      <div>{items.map((it, i) => <Line key={i} i={i} it={it} p={p} claimDate={f.claim_date || ''} />)}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn sm" onClick={p.onItemAdd}>+ Add expense line</button>
          <button className="btn sm" onClick={p.onScanTrigger} title="Point the camera at the receipt — edges are found and it shoots by itself, then Claude reads it and fills a line">📷 Scan receipt / e-invoice</button>
          <button className="btn sm" onClick={p.onScanPickFile} title="Attach a PDF e-invoice or an existing photo — Claude reads it and fills a line">📄 PDF / photo</button>
          <input type="file" id="rc_scan_fi" accept="image/*,.pdf" style={{ display: 'none' }} onChange={(e) => p.onScanFile(e.target as HTMLInputElement)} />
          <span id="rc_scan_status" className="muted" style={{ fontSize: '11px' }}>{p.scanStatus}</span>
        </div>
        <div style={{ fontSize: '15px', fontWeight: 750 }}>Total: <span id="rc_total" style={{ color: 'var(--green-soft)' }}>{M(total)}</span></div>
      </div>

      <div style={{ margin: '14px 0 4px' }}>
        <G label="Remarks"><input id="rc_remarks" placeholder="" defaultValue={f.remarks ?? ''} style={st(RC_SEL)} /></G>
      </div>

      <div style={{ margin: '12px 0' }}>
        <label className="muted" style={{ fontSize: '11px' }}>Receipts (attach one or more)</label>
        <input type="file" id="rc_file" multiple accept="image/*,.pdf" onChange={(e) => p.onPickReceipts(e.target as HTMLInputElement)} style={{ display: 'block', marginTop: '5px', fontSize: '12px', color: 'var(--text-soft)' }} />
        <PendingReceipts files={p.pending} onRemove={p.onReceiptRemove} />
      </div>

      <ScanPanel scans={p.scans} atts={f._existingAtts || []} onPreview={p.onScanPreview} onRemove={p.onScanRemove} />

      <div className="muted" style={{ fontSize: '11px', margin: '4px 0 0' }}>
        🧾 e-Invoice <b>buyer</b> = the claimer’s HR OS particulars (name / TIN / IC / address), attached automatically. No personal TIN → the IRBM general public TIN is used.
      </div>

      <div style={{ margin: '16px 0 4px', fontWeight: 700, fontSize: '13px' }}>Declaration</div>
      <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 12px' }}>
        {DECLARATIONS.map(([id, text]) => (
          <label key={id} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12.5px', padding: '3px 0', cursor: 'pointer' }}>
            <input type="checkbox" id={'rc_' + id} style={{ marginTop: '2px' }} />{text}
          </label>
        ))}
      </div>

      {/* THE DOUBLE-SUBMIT GUARD. `hrRCSave()` opens with `if(RC._saving) return;` (hros.html:2083) — a
          double-tap on a slow connection must not create two claims or double-upload the receipts. The
          legacy leaves the buttons live and refuses inside; React disables them too, which is PRs 108/109's
          pattern and strictly safer. `disabled={false}` renders no attribute, so no golden moves. */}
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
        <button className="btn sm" disabled={p.saving} onClick={() => p.onSave(false)}>Save draft</button>
        <button className="btn p sm" disabled={p.saving} onClick={() => p.onSave(true)}>Submit form →</button>
      </div>
      <div className="muted" style={{ fontSize: '11px', marginTop: '10px' }}>
        Submit requires all four declarations. Blocking checks: missing required receipt, duplicate receipt / invoice no. Warnings (limits, age, duplicates) go to the approver.
      </div>
    </div>
  );
}

/** One expense line — hros.html:2011-2044. */
function Line({ i, it, p, claimDate }: { i: number; it: RcFormItem; p: HrExpensesFormProps; claimDate: string }) {
  const { cfg } = p;
  const mile = isMileage(cfg, it.claim_type_id);
  const amt = itemAmount(it, mile);
  const di = (k: string, ph: string, val: unknown, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input id={'rc_it_' + i + '_' + k} placeholder={ph} defaultValue={val == null ? '' : String(val)} {...extra} style={{ width: '100%', ...st(RC_TD) }} />
  );

  return (
    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
      <select id={'rc_it_' + i + '_type'} defaultValue={it.claim_type_id || ''} onChange={() => p.onItemType(i)} style={{ width: '158px', ...st(RC_TD) }}>
        <option value="">— type —</option>
        {(cfg.claim_types || []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      <input id={'rc_it_' + i + '_date'} type="date" defaultValue={(it.item_date || claimDate || '').slice(0, 10)} style={{ width: '132px', ...st(RC_TD) }} />
      <input id={'rc_it_' + i + '_desc'} placeholder="Description" defaultValue={it.description || ''} style={{ flex: 1, minWidth: '130px', ...st(RC_TD) }} />
      {mile ? (
        <>
          <input id={'rc_it_' + i + '_km'} type="number" step="0.1" placeholder="km" defaultValue={String(it.total_km || '')} onInput={p.onItemCalc} style={{ width: '62px', ...st(RC_TD) }} />
          {' '}
          <select id={'rc_it_' + i + '_rate'} defaultValue={String(it.mileage_rate ?? '')} onChange={p.onItemCalc} style={{ width: '78px', ...st(RC_TD) }}>
            {(cfg.mileage_rates || []).filter((r) => r.active).map((r) => <option key={String(r.rate)} value={String(r.rate)}>{'RM' + r.rate}</option>)}
          </select>
          {' '}
          <b style={{ width: '82px', display: 'inline-block', textAlign: 'right' }} id={'rc_it_' + i + '_amtL'}>{M(amt)}</b>
        </>
      ) : (
        <input id={'rc_it_' + i + '_amt'} type="number" step="0.01" placeholder="0.00" defaultValue={String(it.amount || '')} onInput={p.onItemCalc} style={{ width: '100px', textAlign: 'right', ...st(RC_TD) }} />
      )}
      {it.is_einvoice ? (
        <span className="pill" title="MyInvois e-invoice captured" style={{ fontSize: '9px', color: 'var(--green-soft)', border: '1px solid var(--green-soft)', borderRadius: '5px', padding: '1px 5px' }}>e-Inv</span>
      ) : null}
      <button className={'btn xs' + (it._open ? ' p' : '')} title={mile ? 'trip / parking / toll / cost center' : 'vendor / receipt / e-invoice / tax / cost center'} onClick={() => p.onItemMore(i)}>⋯</button>
      <button className="btn xs d" title="remove" onClick={() => p.onItemDel(i)}>✕</button>
      {it._open ? (
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '7px', padding: '8px 0 4px 10px', borderLeft: '2px solid var(--border)', margin: '2px 0 4px' }}>
          {mile ? (
            <>
              <Dg label="From">{di('from', 'e.g. Office', it.start_location)}</Dg>
              <Dg label="To">{di('to', 'e.g. Client KL', it.end_location)}</Dg>
              <Dg label="Purpose">{di('pur', 'trip purpose', it.purpose)}</Dg>
              <Dg label="Parking (RM)">{di('park', '0.00', it.parking_amount, { type: 'number', step: '0.01', onInput: p.onItemCalc })}</Dg>
              <Dg label="Toll (RM)">{di('toll', '0.00', it.toll_amount, { type: 'number', step: '0.01', onInput: p.onItemCalc })}</Dg>
            </>
          ) : (
            <>
              <Dg label="Vendor">{di('ven', 'shop / supplier', it.vendor_name)}</Dg>
              <Dg label="Receipt no.">{di('rno', '', it.receipt_no)}</Dg>
              <Dg label="e-Invoice / Invoice no.">{di('ino', '', it.invoice_no)}</Dg>
              <Dg label="Tax (RM)">{di('tax', '0.00', it.tax_amount, { type: 'number', step: '0.01' })}</Dg>
              <Dg label="SST (RM)">{di('sst', '0.00', it.sst_amount, { type: 'number', step: '0.01' })}</Dg>
              <Dg label="Supplier TIN">{di('stin', 'MyInvois TIN', it.supplier_tin)}</Dg>
              <Dg label="e-Invoice UUID">{di('euuid', 'IRBM unique id', it.einvoice_uuid)}</Dg>
              <Dg label="MyInvois e-invoice?">
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', paddingTop: '7px', cursor: 'pointer' }}>
                  <input type="checkbox" id={'rc_it_' + i + '_einv'} defaultChecked={!!it.is_einvoice} style={{ accentColor: 'var(--green-soft)' }} /> validated e-invoice
                </label>
              </Dg>
            </>
          )}
          <Dg label="Cost center">
            <select id={'rc_it_' + i + '_cc'} defaultValue={it.cost_center || ''} style={{ width: '100%', ...st(RC_TD) }}><CcOptions cfg={cfg} /></select>
          </Dg>
          <Dg label="Line remarks">{di('rem', '', it.remarks)}</Dg>
        </div>
      ) : null}
    </div>
  );
}

/** `hrRCPendingHtml()` — hros.html:2164. Renders nothing when nothing is queued, exactly as it does. */
function PendingReceipts({ files, onRemove }: { files: PendingFile[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <div style={{ marginTop: '7px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {files.map((f, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11.5px', color: 'var(--text-soft)' }}>
          <span>{/pdf/i.test(f.type || f.name || '') ? '\u{1F4C4}' : '\u{1F4F7}'}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name || 'receipt'}</span>
          <span className="muted">{sizeLabel(f.size)}</span>
          <button className="btn sm" onClick={() => onRemove(i)} title="Remove">×</button>
        </div>
      ))}
      <div className="muted" style={{ fontSize: '10.5px' }}>Attached when you save or submit.</div>
    </div>
  );
}

/** 📎 Supporting documents — hros.html:2046-2054. Renders nothing when both lists are empty. */
function ScanPanel({ scans, atts, onPreview, onRemove }: {
  scans: PendingFile[]; atts: RcSavedAtt[]; onPreview: (i: number) => void; onRemove: (i: number) => void;
}) {
  if (!scans.length && !atts.length) return null;
  return (
    <div style={{ margin: '10px 0 2px' }}>
      <label className="muted" style={{ fontSize: '11px' }}>📎 Supporting documents ({scans.length + atts.length}) — saved with this reimbursement</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginTop: '5px' }}>
        {atts.map((a, i) => (
          <div key={'a' + i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '6px 10px', fontSize: '12px' }}>
            <span style={{ color: 'var(--sky-soft)' }}>📎</span>
            <span style={{ flex: 1 }}>{(a.file_name || 'receipt')} <span className="muted">· saved</span></span>
            {/* no `rel` — hros.html:2050 writes none; see hr-expenses-detail.tsx */}
            {a.url ? <a className="btn xs" href={a.url} target="_blank">View</a> : null}
          </div>
        ))}
        {scans.map((_sf, i) => (
          <div key={'s' + i} style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--panel-2)', border: '1px solid var(--green-soft)', borderRadius: '8px', padding: '6px 10px', fontSize: '12px' }}>
            <span style={{ color: 'var(--green-soft)' }}>📄</span>
            <span style={{ flex: 1 }}>{'Cropped receipt ' + (i + 1) + '.pdf'} <span className="muted">· clear scan — attaches on save</span></span>
            <button className="btn xs" onClick={() => onPreview(i)}>View</button>
            <button className="btn xs d" onClick={() => onRemove(i)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}

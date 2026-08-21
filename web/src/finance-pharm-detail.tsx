// Finance OS · Pharmacies — the PROFILE PAGE (`PHARM_ACTIVE !== null || PHARM_NEW`).
//
// A SIBLING PAGE, not a branch. `pharmRender()` (app.html:6611) dispatches on the selection:
// `pharmRenderDetail()` (app.html:6320) owns every byte of `#pharm` when a pharmacy is open or being
// created, and the list owns it otherwise. web/src/finance-pharm.tsx migrated the list and handed this
// page off to `app.html#tab=pharm`; this file closes that handoff.
//
// The legacy functions are STILL THERE and still shipping; nothing was deleted.
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The
// `pharmacy_list` / `pharmacy_save` / `pharmacy_delete` / `pharmacy_xero_contacts` /
// `pharmacy_link_xero` calls live in app/finance/pharm/detail/page.tsx.
//
// ── NO GOLDEN HOLDS THIS PAGE ─────────────────────────────────────────────────────────────────────
// `tests/golden/finance.pharm.html` was captured with nothing selected. So the tests for this file are
// structural: the `data-k` names `pharmCollect()` (app.html:6413) reads the form back out of the DOM
// by, extracted from `app.html` at run time; the disabled/enabled split; the POST body; and the
// refusal. Whether this page deserves a captured baseline of its own is answered in the PR.
//
// ── THE REFUSAL IS THE POINT, AND IT IS THE SAME REFUSAL ──────────────────────────────────────────
// Pharmacies is gated SERVER-SIDE (app.html:1425 shows the tab to everyone; `portal_pharmacy_list`
// decides). This page loads the same `pharmacy_list`, so it can be refused too — and a refusal here
// must not render as a BLANK FORM, which reads as "a pharmacy with no details" and offers a Save
// button. `Refused` / `Failed` are imported from the list screen rather than re-written, so the two
// pages cannot drift into disagreeing about what a refusal looks like.
//
// ── ARITHMETIC ────────────────────────────────────────────────────────────────────────────────────
// None. The only number is the commission rate, which is typed and stored; the figure that bills a
// pharmacy is computed in o2o.js and posted by `o2o_issue` (finance.ts:626). The DEFAULT for a NEW
// record is `O2O_DISCOUNT_RATE`, imported for the same reason the list screen imports it: a second
// literal here would create a record at a rate the biller does not use.

import { O2O_DISCOUNT_RATE } from '../../o2o.js';
import { Failed, pharmNormalize, Refused } from './finance-pharm';

export { Failed, Refused };

/** A pharmacy row as the detail form reads it — every `data-k` key, plus the id and the Xero link. */
export interface PharmacyDetail {
  id?: number;
  name?: string | null;
  registration_no?: string | null;
  pharmacy_license_no?: string | null;
  outlet_count?: number | string | null;
  onboarded_at?: string | null;
  address?: string | null;
  postcode?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  email?: string | null;
  whatsapp?: string | null;
  business_hours?: string | null;
  pic_name?: string | null;
  pic_role?: string | null;
  pic_phone?: string | null;
  pic_email?: string | null;
  pharmacist_name?: string | null;
  pharmacist_license?: string | null;
  commission_rate?: number | string | null;
  default_voucher_code?: string | null;
  xero_contact_id?: string | null;
  active?: boolean | null;
  notes?: string | null;
}

/** One row of `pharmacy_xero_contacts.contacts` — SKINDAE's Xero contact list. */
export interface XeroContact {
  contact_id: string;
  name?: string | null;
  email?: string | null;
}

/** `PHARM_STATES` — app.html:6593. The picker's only options, in its order. */
export const PHARM_STATES = ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pinang', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu'];

/**
 * `pharmNewStart()`'s blank record — app.html:6668, field for field.
 *
 * `commission_rate` is o2o.js's constant, not a literal: it is the rate the new pharmacy will be
 * billed at from its first invoice.
 */
export function blankPharmacy(): PharmacyDetail {
  return { name: '', commission_rate: O2O_DISCOUNT_RATE, active: true, outlet_count: 1 };
}

/** One control the form read back — what the route hands `pharmPatch()` per `[data-k]` element. */
export interface PharmField { k: string; type: string; value: string; checked: boolean }

/**
 * `pharmCollect()` — app.html:6413 — as a pure function of the controls read out of the form.
 *
 * The legacy walks `#pharm-form [data-k]` and takes `el.value`, EXCEPT a checkbox, which becomes the
 * STRING `'true'` / `'false'`. That string is what `pharmacy_save` stores, so a port that sent a real
 * boolean, or that sent `el.value` (`'on'`) for the checkbox, would change what lands in the master
 * record for the very flag O2O billing filters on — and an inactive pharmacy that reads as active is
 * billed.
 */
export function pharmPatch(fields: PharmField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.k] = f.type === 'checkbox' ? (f.checked ? 'true' : 'false') : f.value;
  return out;
}

/**
 * The `{api:'pharmacy_save', id, patch}` body — `pharmSave()`, app.html:6422.
 *
 * No golden sees a request body. Two things are proven only here: a blank name is REFUSED (the legacy
 * toasts and returns; this throws and the route turns it back into the same message), and a NEW record
 * posts `id: null` while an edit posts the id it was opened with — swapping those either overwrites
 * another pharmacy or creates a duplicate master record that O2O then bills twice.
 */
export function saveBody(patch: Record<string, string>, id: number | null): { id: number | null; patch: Record<string, string> } {
  if (!patch.name || !patch.name.trim()) throw new Error('Pharmacy name is required');
  return { id, patch };
}

/**
 * Every inline style is written as a STRING and split mechanically — the `st()` the WHT pilot
 * introduced. A style OBJECT hands React two chances to change a value silently.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

const LABEL = 'font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:3px';
const INPUT = 'width:100%;background:var(--panel-2);border:1px solid var(--panel-border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:13px';

export interface FinancePharmDetailProps {
  /** The record being shown. `null` with `isNew` false is "still loading". */
  pharmacy: PharmacyDetail | null;
  /** `PHARM_NEW` — app.html:6668. */
  isNew: boolean;
  /** `PHARM_MODE` — app.html:6588. */
  mode: 'view' | 'edit';
  /** `PHARM_EDITABLE` — `pharmacy_list.editable`. */
  editable: boolean;
  /** app.html:6603 — the server said `ok:false`. The SKINDAE refusal. */
  refused: string | null;
  /** app.html:6609 — a transport failure, not a refusal. */
  failed: string | null;
  /** The record was not in the master list — an id that does not exist. */
  notFound?: boolean;
  onBack: () => void;
  /** `pharmSetMode(mode)` — app.html:6674. */
  onSetMode: (mode: 'view' | 'edit') => void;
  /** `pharmSave()` — app.html:6422. */
  onSave: () => void;
  /** `pharmDelete()` — app.html:6443. */
  onDelete: () => void;
  /** `pharmOpenLinkModal()` — app.html:6683. */
  onLink: () => void;
  /** The `input` listener app.html:6404 wires onto `#pharm-form` for dirty tracking. */
  onDirty: () => void;
}

/** `fld(label,key,type,ph)` — app.html:6325. */
function Fld({ label, k, type, ph, value, disabled }: { label: string; k: string; type?: string; ph?: string; value: unknown; disabled: boolean }) {
  return (
    <div style={st('margin-bottom:8px')}>
      <label style={st(LABEL)}>{label}</label>
      <input type={type || 'text'} data-k={k} defaultValue={value == null ? '' : String(value)} placeholder={ph || ''} disabled={disabled} style={st(INPUT)} />
    </div>
  );
}

/** `section(title, body)` — app.html:6344. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:16px;margin-bottom:14px')}>
      <h3 style={st('margin:0 0 12px;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-soft);font-weight:660')}>{title}</h3>
      {children}
    </div>
  );
}

/** `row(...)` — app.html:6347. */
function Row({ children }: { children: React.ReactNode }) {
  return <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px')}>{children}</div>;
}

/**
 * `pharmRenderDetail()` — app.html:6320.
 *
 * UNCONTROLLED, with every legacy `data-k` name kept. That is the contract: `pharmCollect()` reads the
 * form back out of the DOM by exactly those names. A field that loses its `data-k` saves as ABSENT —
 * on this form that is a wiped SSM number, a lost pharmacist licence or a commission rate that reverts
 * to the default and re-prices every future invoice.
 */
export default function FinancePharmDetail(props: FinancePharmDetailProps) {
  if (props.refused !== null) return <Refused message={props.refused} />;
  if (props.failed !== null) return <Failed message={props.failed} />;

  // app.html:6321 — the EDIT gate is `(PHARM_NEW || PHARM_MODE==='edit') && PHARM_EDITABLE`. The
  // `&& PHARM_EDITABLE` is what stops a non-admin typing into the master record; dropping it would
  // leave every field enabled and a Save button that the server then refuses, after the operator has
  // retyped a page of details.
  const isEdit = (props.isNew || props.mode === 'edit') && props.editable;
  const disabled = !isEdit;
  // app.html:6322 — a NEW record is the blank; an id that is not in the list renders as `{}`, exactly
  // as the legacy's `|| {}` does.
  const p: PharmacyDetail = props.isNew ? blankPharmacy() : (props.pharmacy || {});

  if (!props.isNew && !props.pharmacy && !props.notFound) {
    return <div className="sk-row"></div>;
  }

  // app.html:6350 — the Xero link state. A pharmacy with no link is billed by NAME LOOKUP, which is
  // what the amber pill says; a NEW record shows neither, because it has no identity yet.
  const linkBadge = p.xero_contact_id
    ? <span className="pill pill-green" style={st('font-size:10px;margin-left:8px')}>✓ linked to Xero contact</span>
    : (p.id ? <span className="pill" style={st('background:rgba(255,165,89,.16);color:var(--coral-soft);font-size:10px;margin-left:8px')}>⚠ not linked — invoices use name lookup</span> : null);

  return (
    <>
      {/* `titleBar` — app.html:6354. */}
      <div style={st('display:flex;align-items:center;gap:10px;margin-bottom:14px')}>
        <button className="btn" onClick={props.onBack}>← Back</button>
        <h2 style={st('margin:0;flex:1;font-size:20px;letter-spacing:-.02em')}>
          {props.isNew ? 'New pharmacy' : <>{p.name || ''}{linkBadge}</>}
        </h2>
        {props.editable && !props.isNew
          ? (props.mode === 'edit'
            ? <>
                <button className="btn p" id="pharm-save-btn" onClick={props.onSave}>💾 Save</button>
                <button className="btn" onClick={() => props.onSetMode('view')}>Cancel</button>
              </>
            : <>
                <button className="btn" onClick={props.onLink}>🔗 Link to Xero</button>
                <button className="btn" onClick={() => props.onSetMode('edit')}>✎ Edit</button>
                <button className="btn d" onClick={props.onDelete}>🗑 Delete</button>
              </>)
          : null}
        {props.isNew ? <button className="btn p" id="pharm-save-btn" onClick={props.onSave}>💾 Create</button> : null}
      </div>

      <div id="pharm-form" onInput={isEdit ? props.onDirty : undefined}>
        <Section title="Pharmacy identity"><Row>
          <Fld label="Pharmacy name" k="name" ph="Brightway Pharmacy Sdn Bhd" value={p.name} disabled={disabled} />
          <Fld label="Registration No. (SSM)" k="registration_no" ph="123456-X" value={p.registration_no} disabled={disabled} />
          <Fld label="Pharmacy license no." k="pharmacy_license_no" ph="KKM/..." value={p.pharmacy_license_no} disabled={disabled} />
          <Fld label="Outlet count" k="outlet_count" type="number" ph="1" value={p.outlet_count} disabled={disabled} />
          <Fld label="Onboarded date" k="onboarded_at" type="date" ph="" value={p.onboarded_at} disabled={disabled} />
        </Row></Section>

        <Section title="Address"><Row>
          <Fld label="Street" k="address" ph="Lot 12, Jalan ..." value={p.address} disabled={disabled} />
          <Fld label="Postcode" k="postcode" ph="47301" value={p.postcode} disabled={disabled} />
          <Fld label="City" k="city" ph="Petaling Jaya" value={p.city} disabled={disabled} />
          {/* `selectState()` — app.html:6331. */}
          <div style={st('margin-bottom:8px')}>
            <label style={st(LABEL)}>State</label>
            <select data-k="state" defaultValue={p.state || ''} disabled={disabled} style={st(INPUT)}>
              <option value="">—</option>
              {PHARM_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </Row></Section>

        <Section title="Contact"><Row>
          <Fld label="Main phone" k="phone" type="tel" ph="+603-..." value={p.phone} disabled={disabled} />
          <Fld label="Email" k="email" type="email" ph="contact@pharmacy.com" value={p.email} disabled={disabled} />
          <Fld label="WhatsApp" k="whatsapp" type="tel" ph="+6012-..." value={p.whatsapp} disabled={disabled} />
          <Fld label="Business hours" k="business_hours" ph="Mon-Sun 9am-10pm" value={p.business_hours} disabled={disabled} />
        </Row></Section>

        <Section title="Person in charge (PIC)"><Row>
          <Fld label="Name" k="pic_name" ph="Lim Mei Ling" value={p.pic_name} disabled={disabled} />
          <Fld label="Role" k="pic_role" ph="Outlet Manager" value={p.pic_role} disabled={disabled} />
          <Fld label="Phone" k="pic_phone" type="tel" ph="+6012-..." value={p.pic_phone} disabled={disabled} />
          <Fld label="Email" k="pic_email" type="email" ph="pic@pharmacy.com" value={p.pic_email} disabled={disabled} />
        </Row></Section>

        <Section title="Pharmacist on record"><Row>
          <Fld label="Name" k="pharmacist_name" ph="Ms. Tan Pharm.D" value={p.pharmacist_name} disabled={disabled} />
          <Fld label="License no." k="pharmacist_license" ph="MPS-12345" value={p.pharmacist_license} disabled={disabled} />
        </Row></Section>

        <Section title="O2O billing configuration">
          <Row>
            <Fld label="Commission rate (%)" k="commission_rate" type="number" ph="19.2" value={p.commission_rate} disabled={disabled} />
            <Fld label="Default voucher code" k="default_voucher_code" ph="BRIGHTWAY10" value={p.default_voucher_code} disabled={disabled} />
            <Fld label="Xero Contact ID (auto)" k="xero_contact_id" ph="will be set on first invoice" value={p.xero_contact_id} disabled={disabled} />
          </Row>
          {/* `activeToggle()` — app.html:6340. `p.active !== false` — an undefined flag is CHECKED. */}
          <div style={st('margin-top:10px')}>
            <label style={st('display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--panel-2);border:1px solid var(--panel-border);border-radius:7px;cursor:' + (isEdit ? 'pointer' : 'default'))}>
              <input type="checkbox" data-k="active" defaultChecked={p.active !== false} disabled={disabled} style={st('width:auto')} />
              <span style={st('font-size:13px')}>Active (eligible for O2O billing)</span>
            </label>
          </div>
          <div className="muted" style={st('font-size:12px;margin-top:8px;line-height:1.6')}>Commission rate is applied per line in O2O Billing (invoice DiscountRate field). Default 19.2%; set differently if this pharmacy has negotiated terms. Voucher code is shown as a reminder during preview.</div>
        </Section>

        <Section title="Notes">
          {/* `textarea(label,key,rows)` — app.html:6336. */}
          <div style={st('margin-bottom:8px')}>
            <label style={st(LABEL)}>Free text</label>
            <textarea data-k="notes" rows={4} defaultValue={p.notes || ''} disabled={disabled}
              style={st(INPUT + ';resize:vertical;font-family:inherit')} />
          </div>
        </Section>
      </div>
    </>
  );
}

/**
 * `pharmRenderLinkModal()` — app.html:6698. The Xero-contact picker.
 *
 * Pure: the contact list, the search text and the current link are props, and `pharmDoLink()`'s POST
 * lives in the route. Two rules carried across verbatim, because both decide which Xero contact a
 * pharmacy's invoices land on:
 *  · `suggested` is matched against the WHOLE contact list by normalised name (app.html:6704), NOT
 *    against the filtered view — a suggestion that only appeared once you had typed would be a
 *    different suggestion.
 *  · the list is capped at 100 (app.html:6705) and the count says so. Dropping the cap is a 2,000-row
 *    render; dropping the SENTENCE leaves an operator believing the contact is not in Xero.
 */
export function pharmLinkFilter(contacts: XeroContact[], search: string): XeroContact[] {
  const q = String(search || '').toLowerCase().trim();
  if (!q) return contacts;
  return contacts.filter((c) => (c.name || '').toLowerCase().indexOf(q) >= 0 || (c.email || '').toLowerCase().indexOf(q) >= 0);
}

export interface PharmLinkModalProps {
  pharmacyName: string;
  /** `p.xero_contact_id` — the current link, if any. */
  currentId: string | null;
  contacts: XeroContact[];
  search: string;
  onSearch: (v: string) => void;
  /** `pharmDoLink(contactId)` — app.html:6721. `null` UNLINKS. */
  onPick: (contactId: string | null) => void;
  onClose: () => void;
}

export function PharmLinkModal(props: PharmLinkModalProps) {
  const filtered = pharmLinkFilter(props.contacts, props.search);
  const suggested = props.contacts.find((c) => pharmNormalize(c.name) === pharmNormalize(props.pharmacyName));
  const list = filtered.slice(0, 100);
  const count = filtered.length + ' contact' + (filtered.length === 1 ? '' : 's') + ' · showing first ' + Math.min(100, filtered.length);

  return (
    <div className="overlay" id="pharm-link-overlay"><div className="modal" style={st('width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column')}>
      <div className="modal-hd"><h3>{'🔗 Link "' + (props.pharmacyName || '') + '" to a Xero contact'}</h3>
        <button className="modal-close" aria-label="Close" onClick={props.onClose}>×</button></div>
      <p className="muted" style={st('font-size:12.5px;margin:0 0 10px;line-height:1.6')}>Pick the matching SKINDAE Xero contact. Once linked, O2O Billing posts invoices to this contact directly (no name-fuzzy matching).</p>
      <input id="pharm-link-search" defaultValue={props.search} onInput={(e) => props.onSearch((e.target as HTMLInputElement).value)}
        placeholder="🔍 Search Xero contacts by name or email" autoFocus
        style={st('width:100%;background:var(--panel-2);border:1px solid var(--panel-border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:13px;margin-bottom:10px')} />
      <div id="pharm-link-count" className="muted" style={st('font-size:11px;margin-bottom:6px')}>{count}</div>
      <div id="pharm-link-list" style={st('flex:1;overflow-y:auto;background:var(--panel-2);border:1px solid var(--panel-border);border-radius:8px')}>
        {list.length ? list.map((c) => {
          const isCurrent = props.currentId === c.contact_id;
          const isSuggested = !!suggested && suggested.contact_id === c.contact_id;
          return (
            <div key={c.contact_id} onClick={() => props.onPick(c.contact_id)}
              style={st('display:flex;align-items:center;gap:10px;padding:9px 12px;border-top:1px solid var(--panel-border);cursor:pointer;background:' + (isCurrent ? 'rgba(126,224,160,.08)' : 'transparent'))}>
              <div style={st('flex:1;min-width:0')}>
                <div style={st('font-size:13px;color:var(--text)')}>{c.name || ''}
                  {isSuggested ? <span className="pill pill-green" style={st('font-size:10px;margin-left:6px')}>suggested</span> : null}
                  {isCurrent ? <span className="pill" style={st('background:rgba(126,224,160,.16);color:var(--green-soft);font-size:10px;margin-left:6px')}>current link</span> : null}</div>
                {c.email ? <div className="muted" style={st('font-size:11px;margin-top:2px')}>{c.email}</div> : null}
              </div>
              <div className="muted" style={st('font-family:monospace;font-size:10.5px')}>{String(c.contact_id || '').slice(0, 8) + '…'}</div>
            </div>
          );
        }) : <div className="muted" style={st('padding:24px;text-align:center;font-size:13px')}>No contacts match.</div>}
      </div>
      <div className="modal-ft" style={st('justify-content:space-between')}>
        <button className="btn" disabled={!props.currentId} onClick={() => props.onPick(null)}>Unlink</button>
        <button className="btn" onClick={props.onClose}>Cancel</button>
      </div>
    </div></div>
  );
}

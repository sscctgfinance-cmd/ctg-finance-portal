// Finance OS · Pharmacies — the PROFILE PAGE, against the legacy source it replaces.
//
// ── THERE IS NO GOLDEN FOR THIS PAGE ──────────────────────────────────────────────────────────────
// `tests/golden/finance.pharm.html` was captured with nothing selected, so `pharmRenderDetail()`
// (app.html:6320) is in no baseline. Every claim below is either a STRUCTURAL assertion about this
// port or a claim about the legacy READ OUT OF `app.html` at run time.
//
// Nothing here regenerates or edits a golden, and nothing here touches tests/parity.ts,
// tests/handlers.ts or tests/render_surfaces.ts.
//
// ── WHAT IS WORTH GUARDING, IN ORDER ──────────────────────────────────────────────────────────────
// 1. THE REFUSAL. Pharmacies is gated SERVER-SIDE. A refusal rendered as a blank form reads as "a
//    pharmacy with no details" and offers a Save button that would overwrite the record.
// 2. WHICH FIELD READS WHICH VALUE. `finance.ap`'s finding: a "carries every data-* name" check is
//    half a guard. Swapping one field's SOURCE passes it and silently saves the wrong value. The
//    label→key→placeholder triples are read out of app.html's own `fld(...)` calls and each field is
//    rendered with a distinct sentinel.
// 3. THE EDIT GATE. `(PHARM_NEW || PHARM_MODE==='edit') && PHARM_EDITABLE` — dropping the second half
//    leaves every field typeable for a non-admin, with the server refusing after a page of retyping.
// 4. THE POST BODY. No golden sees a request. A NEW record must post `id: null`; an edit must post the
//    id it was opened with.
// 5. THE XERO LINK. Which contact a pharmacy's invoices land on.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FinancePharmDetail, {
  PHARM_STATES, PharmLinkModal, blankPharmacy, pharmLinkFilter, pharmPatch, saveBody,
  type PharmField, type PharmacyDetail, type XeroContact,
} from '../src/finance-pharm-detail';
import { REPO } from './parity';

const APP = readFileSync(join(REPO, 'app.html'), 'utf8');
/** `pharmRenderDetail()`'s own body, from its `function` line to `pharmCollect()`. */
const DETAIL = APP.slice(APP.indexOf('function pharmRenderDetail(){'), APP.indexOf('function pharmCollect(){'));
const COLLECT = APP.slice(APP.indexOf('function pharmCollect(){'), APP.indexOf('async function pharmSave(){'));

const P: PharmacyDetail = {
  id: 1, name: 'FARMASI SIHAT SDN BHD', registration_no: '199801012345 (123456-X)',
  pharmacy_license_no: 'KKM/PL/2026/001', outlet_count: 2, onboarded_at: '2025-11-03',
  address: 'No. 3, Jalan Kristal 1/2', postcode: '40000', city: 'Shah Alam', state: 'Selangor',
  phone: '03-5511 2233', email: 'sihat@x.test', whatsapp: '+6012-333 4444', business_hours: 'Mon-Sun 9am-10pm',
  pic_name: 'En. Rahim', pic_role: 'Outlet Manager', pic_phone: '+6019-222 1111', pic_email: 'rahim@x.test',
  pharmacist_name: 'Ms. Tan Pharm.D', pharmacist_license: 'MPS-12345',
  commission_rate: 17.5, default_voucher_code: 'SIHAT10', xero_contact_id: null,
  active: true, notes: 'Negotiated 17.5% from Jan 2026.',
};

const noop = () => {};
type Props = Parameters<typeof FinancePharmDetail>[0];

function screen(over: Partial<Props> = {}) {
  return (
    <FinancePharmDetail
      pharmacy={P} isNew={false} mode="view" editable={false} refused={null} failed={null}
      onBack={noop} onSetMode={noop} onSave={noop} onDelete={noop} onLink={noop} onDirty={noop}
      {...over}
    />
  );
}
const html = (over: Partial<Props> = {}) => renderToStaticMarkup(screen(over));

describe('the refusal — a refusal is not an empty form', () => {
  // The list screen's own test pins this for the LIST. It matters more here: an empty table reads as
  // "no pharmacies"; an empty FORM reads as "this pharmacy has no details" and comes with a Save button.
  const refusal = html({ pharmacy: null, refused: 'forbidden' });

  it('renders the legacy 🔒 panel naming SKINDAE, with the server\'s own message', () => {
    expect(refusal).toContain('🔒');
    expect(refusal).toContain('forbidden');
    expect(refusal).toContain('Pharmacies require SKINDAE access.');
  });

  it('renders NO form, NO field and NO save button', () => {
    expect(refusal).not.toContain('data-k=');
    expect(refusal).not.toContain('pharm-form');
    expect(refusal).not.toContain('pharm-save-btn');
    expect(refusal).not.toContain('🗑 Delete');
  });

  it('refuses even when a record is somehow already in hand', () => {
    // Order matters: the refusal is checked FIRST, so a record cached from an earlier load cannot leak.
    expect(html({ refused: 'forbidden' })).not.toContain('FARMASI SIHAT');
  });

  it('keeps a transport failure distinct — ⚠️, and no SKINDAE sentence', () => {
    const out = html({ pharmacy: null, failed: 'Network error' });
    expect(out).toContain('⚠️');
    expect(out).toContain('Network error');
    expect(out).not.toContain('SKINDAE');
  });

  it('shows a skeleton, not a blank form, while the record is in flight', () => {
    const out = html({ pharmacy: null });
    expect(out).not.toContain('data-k=');
    expect(out).toContain('sk-row');
  });

  it('renders the legacy\'s own `|| {}` for an id that is not in the master list', () => {
    // app.html:6322. A blank form, not a crash — but the id is gone, so the route marks it notFound and
    // the form is empty rather than silently showing another pharmacy's details.
    const out = html({ pharmacy: null, notFound: true });
    expect(out).toContain('data-k="name"');
    expect(out).not.toContain('FARMASI SIHAT');
  });
});

describe('the field contract — every data-k name, reading its OWN value', () => {
  /** app.html's own `fld('Label','key','type','placeholder')` calls, in order. */
  const flds = [...DETAIL.matchAll(/fld\('([^']*)','([a-z_]+)','([a-z]*)','([^']*)'\)/g)]
    .map((m) => ({ label: m[1], k: m[2], type: m[3], ph: m[4] }));

  it('found the legacy field list at all', () => {
    expect(flds.length).toBe(21);
    expect(flds.map((f) => f.k)).toContain('commission_rate');
  });

  it('renders every data-k the legacy declares — inputs, the state select, the notes textarea, the toggle', () => {
    const out = html({ editable: true, mode: 'edit' });
    for (const f of flds) expect(out, f.k).toContain(`data-k="${f.k}"`);
    expect(out).toContain('data-k="state"');
    expect(out).toContain('data-k="notes"');
    expect(out).toContain('data-k="active"');
  });

  it('renders NO data-k the legacy does not declare — an extra field posts a column nothing asked for', () => {
    const rendered = [...new Set([...html({ editable: true, mode: 'edit' }).matchAll(/data-k="([a-z_]+)"/g)].map((m) => m[1]))];
    const declared = new Set([...flds.map((f) => f.k), 'state', 'notes', 'active']);
    expect(rendered.filter((k) => !declared.has(k))).toEqual([]);
    expect(rendered.length).toBe(declared.size);
  });

  it('gives each field ITS OWN value and ITS OWN type — the finance.ap gap', () => {
    // A "carries every name" check passes with two fields' sources swapped. Rendering with one distinct
    // sentinel per key makes the swap fail: `data-k="city"` carrying the postcode's sentinel is a
    // pharmacy filed in the wrong town, and the form looks perfectly normal.
    //
    // The numeric fields carry numeric sentinels, because `type="number"` refuses to display a string.
    const NUMERIC = new Set(flds.filter((f) => f.type === 'number').map((f) => f.k));
    const rec: Record<string, string | number> = {};
    flds.forEach((f, i) => { rec[f.k] = NUMERIC.has(f.k) ? 1000 + i : 'SENTINEL-' + i; });
    const out = renderToStaticMarkup(screen({ pharmacy: rec as PharmacyDetail, editable: true, mode: 'edit' }));
    flds.forEach((f) => {
      const tag = out.match(new RegExp(`<[^>]*data-k="${f.k}"[^>]*>`))?.[0] || '';
      expect(tag, f.k).toContain(`value="${rec[f.k]}"`);
      expect(tag, f.k).toContain(`type="${f.type || 'text'}"`);
      expect(tag, f.k).toContain(`placeholder="${f.ph.replace(/&/g, '&amp;')}"`);
    });
  });

  it('offers every Malaysian state the legacy offers, in its order, and nothing else', () => {
    const decl = APP.slice(APP.indexOf('const PHARM_STATES='), APP.indexOf('\n', APP.indexOf('const PHARM_STATES=')));
    const want = [...decl.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(PHARM_STATES).toEqual(want);
    const out = html({ editable: true, mode: 'edit' });
    // React marks the current one `selected=""`, so the option is matched by shape, not byte for byte.
    for (const s of want) expect(out, s).toMatch(new RegExp(`<option value="${s}"[^>]*>${s}</option>`));
    expect([...out.matchAll(/<option value="([^"]*)"[^>]*>/g)].map((m) => m[1])).toEqual(['', ...want]);
    // The blank option, which is what "no state on file" is.
    expect(out).toContain('<option value="">—</option>');
  });

  it('selects the state on file, and none when there is none', () => {
    expect(html({ editable: true, mode: 'edit' })).toContain('<option value="Selangor" selected="">Selangor</option>');
    const none = html({ pharmacy: { ...P, state: null }, editable: true, mode: 'edit' });
    expect(none).toContain('<option value="" selected="">—</option>');
    expect(none).not.toContain('selected="">Selangor');
  });
});

describe('the edit gate — app.html:6321', () => {
  const disabledCount = (h: string) => (h.match(/\sdisabled=""/g) || []).length;

  it('is `(isNew || mode===edit) && editable`, verbatim in app.html', () => {
    expect(DETAIL).toContain("const isEdit = (PHARM_NEW || PHARM_MODE==='edit') && PHARM_EDITABLE;");
  });

  it('disables every control for a non-admin, even in edit mode', () => {
    // The half that is easy to drop. Without `&& editable` the form is typeable, the operator retypes a
    // page of details and the server refuses the save.
    expect(disabledCount(html({ mode: 'edit', editable: false }))).toBeGreaterThan(19);
    expect(disabledCount(html({ mode: 'view', editable: true }))).toBeGreaterThan(19);
  });

  it('enables them for an admin in edit mode, and for a new record', () => {
    expect(disabledCount(html({ mode: 'edit', editable: true }))).toBe(0);
    expect(disabledCount(html({ isNew: true, mode: 'view', editable: true }))).toBe(0);
    // ...but NOT for a new record a non-admin somehow reached.
    expect(disabledCount(html({ isNew: true, editable: false }))).toBeGreaterThan(19);
  });

  it('offers Edit / Delete / Link only to an admin, and only on a saved record', () => {
    const admin = html({ editable: true });
    expect(admin).toContain('✎ Edit');
    expect(admin).toContain('🗑 Delete');
    expect(admin).toContain('🔗 Link to Xero');
    const viewer = html({ editable: false });
    expect(viewer).not.toContain('✎ Edit');
    expect(viewer).not.toContain('🗑 Delete');
    expect(viewer).not.toContain('🔗 Link to Xero');
    // A NEW record offers Create and nothing else — there is no id to delete or link yet.
    const fresh = html({ isNew: true, editable: true });
    expect(fresh).toContain('💾 Create');
    expect(fresh).not.toContain('🗑 Delete');
    expect(fresh).not.toContain('🔗 Link to Xero');
  });

  it('swaps Save/Cancel in for Edit/Delete/Link while editing — app.html:6357', () => {
    const editing = html({ editable: true, mode: 'edit' });
    expect(editing).toContain('💾 Save');
    expect(editing).toContain('>Cancel<');
    expect(editing).not.toContain('🗑 Delete');
  });

  it('tracks dirty only while editable — a disabled form cannot become dirty', () => {
    expect(html({ editable: true, mode: 'edit' })).toContain('id="pharm-form"');
    // The handler is a prop, so it is checked by binding rather than by markup: see the wiring block.
  });
});

describe('the Xero link badge — how a pharmacy\'s invoices find their contact', () => {
  it('says LINKED when a contact id is on file', () => {
    expect(html({ pharmacy: { ...P, xero_contact_id: 'xc-1' } })).toContain('✓ linked to Xero contact');
  });

  it('WARNS when it is not — the name-lookup fallback, which is what mis-bills a rename', () => {
    expect(html()).toContain('⚠ not linked — invoices use name lookup');
  });

  it('says neither on a record with no identity yet', () => {
    const fresh = html({ isNew: true, editable: true });
    expect(fresh).not.toContain('linked to Xero contact');
    expect(fresh).not.toContain('not linked');
    expect(fresh).toContain('New pharmacy');
  });
});

describe('pharmCollect() / pharmPatch() — the checkbox is a STRING', () => {
  it('is what app.html does, verbatim', () => {
    expect(COLLECT).toContain("out[el.dataset.k] = el.checked ? 'true' : 'false'");
    expect(COLLECT).toContain("out[el.dataset.k] = el.value");
  });

  it('sends "true" / "false" for the active flag, never a boolean and never "on"', () => {
    const f = (checked: boolean): PharmField[] => [
      { k: 'name', type: 'text', value: 'X', checked: false },
      { k: 'active', type: 'checkbox', value: 'on', checked },
    ];
    expect(pharmPatch(f(true))).toEqual({ name: 'X', active: 'true' });
    expect(pharmPatch(f(false))).toEqual({ name: 'X', active: 'false' });
  });

  it('defaults an unknown flag to CHECKED, as app.html:6340 does', () => {
    // `p.active !== false` — a record whose column is null is eligible for O2O billing, not excluded.
    expect(DETAIL).toContain("(p.active!==false?'checked':'')");
    expect(html({ pharmacy: { ...P, active: null }, editable: true, mode: 'edit' })).toMatch(/data-k="active"[^>]*\schecked/);
    expect(html({ pharmacy: { ...P, active: false }, editable: true, mode: 'edit' })).not.toMatch(/data-k="active"[^>]*\schecked/);
  });
});

describe('saveBody() — the POST no golden can see', () => {
  it('refuses a blank or whitespace name, as pharmSave() does', () => {
    expect(DETAIL.length).toBeGreaterThan(0);
    expect(APP).toContain("if(!patch.name || !patch.name.trim()){ toast('Pharmacy name is required',true); return; }");
    expect(() => saveBody({ name: '' }, 1)).toThrow(/name is required/);
    expect(() => saveBody({ name: '   ' }, 1)).toThrow(/name is required/);
  });

  it('posts a NULL id for a new record and the opened id for an edit', () => {
    // app.html:6427 — `const id = PHARM_NEW ? null : PHARM_ACTIVE`. Getting this backwards either
    // overwrites another pharmacy or creates a duplicate master record that O2O then bills twice.
    expect(APP).toContain('const id = PHARM_NEW ? null : PHARM_ACTIVE;');
    expect(saveBody({ name: 'X' }, null).id).toBeNull();
    expect(saveBody({ name: 'X' }, 42).id).toBe(42);
  });

  it('passes the patch through untouched — the form is the source of truth', () => {
    const patch = { name: 'X', city: 'Ipoh', active: 'false' };
    expect(saveBody(patch, 1).patch).toEqual(patch);
  });
});

describe('the commission rate — imported from o2o.js, not a second literal', () => {
  it('gives a NEW pharmacy the same default rate the biller prices at', () => {
    const o2o = readFileSync(join(REPO, 'o2o.js'), 'utf8');
    expect(o2o).toContain('var O2O_DISCOUNT_RATE = 19.2;');
    expect(blankPharmacy().commission_rate).toBe(19.2);
    expect(APP).toContain('{ name:\'\', commission_rate:19.2, active:true, outlet_count:1 }');
    expect(html({ isNew: true, editable: true })).toMatch(/data-k="commission_rate"[^>]*value="19.2"/);
  });

  it('shows a negotiated rate as stored, and does not fall back to the default', () => {
    // The LIST screen falls back on a falsy rate (`||19.2`); the FORM does not (`val==null?'':val`),
    // because a stored 0 must be visible and editable rather than silently reading as 19.2.
    expect(html({ editable: true, mode: 'edit' })).toMatch(/data-k="commission_rate"[^>]*value="17.5"/);
    expect(html({ pharmacy: { ...P, commission_rate: 0 }, editable: true, mode: 'edit' })).toMatch(/data-k="commission_rate"[^>]*value="0"/);
    expect(DETAIL).toContain("value=\"'+esc(val==null?'':val)+'\"");
  });
});

describe('the Xero-contact link modal', () => {
  const CONTACTS: XeroContact[] = [
    { contact_id: 'c-aaaa1111', name: 'FARMASI SIHAT SDN BHD', email: 'sihat@x.test' },
    { contact_id: 'c-bbbb2222', name: 'PHARMACY ALPHA', email: 'alpha@x.test' },
    { contact_id: 'c-cccc3333', name: 'KLINIK & FARMASI DESA', email: null },
  ];
  const modal = (over: Partial<Parameters<typeof PharmLinkModal>[0]> = {}) => renderToStaticMarkup(
    <PharmLinkModal pharmacyName={P.name!} currentId={null} contacts={CONTACTS} search=""
      onSearch={noop} onPick={noop} onClose={noop} {...over} />,
  );

  it('suggests the NORMALISED name match, and marks only that row', () => {
    // The suggestion is the whole point of the modal: it is the operator's shortcut past a 2,000-row
    // list, and picking the wrong row sends this pharmacy's invoices to another company's contact.
    // `pharmNormalize()` (app.html:6595) is the same key O2O's own name lookup uses, so case and runs
    // of whitespace must not defeat it.
    const out = modal();
    expect(out).toContain('suggested');
    const marked = [...out.matchAll(/font-size:13px;color:var\(--text\)">([^<]*)<span class="pill pill-green"/g)].map((m) => m[1]);
    expect(marked).toEqual(['FARMASI SIHAT SDN BHD']);
    expect(modal({ contacts: [{ contact_id: 'c-x', name: '  farmasi   SIHAT sdn bhd ' }] })).toContain('suggested');
    expect(modal({ contacts: [{ contact_id: 'c-x', name: 'FARMASI SIHATT SDN BHD' }] })).not.toContain('>suggested<');
  });

  it('computes the suggestion over the WHOLE contact list — pinned in app.html, not by output', () => {
    // app.html:6704 uses `contacts`, not `filtered`. It happens to be UNOBSERVABLE in the rendered
    // markup — the badge can only appear on a row that survived the filter anyway — which is exactly
    // why it is pinned against the legacy source instead of asserted through a render. (Written as an
    // output assertion first; the defect passed it.)
    expect(APP).toContain('const suggested = contacts.find(c => pharmNormalize(c.name)===pharmNormalize(p.name));');
    const src = readFileSync(join(REPO, 'web', 'src', 'finance-pharm-detail.tsx'), 'utf8');
    expect(src).toContain('const suggested = props.contacts.find(');
    expect(src).not.toContain('const suggested = filtered.find(');
  });

  it('marks the current link and disables Unlink when there is none', () => {
    expect(modal()).toContain('disabled');
    const linked = modal({ currentId: 'c-bbbb2222' });
    expect(linked).toContain('current link');
    expect(linked).not.toMatch(/<button class="btn" disabled/);
  });

  it('filters on name AND email, case-insensitively — app.html:6702', () => {
    expect(pharmLinkFilter(CONTACTS, 'ALPHA').map((c) => c.contact_id)).toEqual(['c-bbbb2222']);
    expect(pharmLinkFilter(CONTACTS, 'alpha@x').map((c) => c.contact_id)).toEqual(['c-bbbb2222']);
    expect(pharmLinkFilter(CONTACTS, '')).toHaveLength(3);
    expect(pharmLinkFilter(CONTACTS, 'zzz')).toHaveLength(0);
  });

  it('caps the list at 100 and SAYS so — dropping the sentence hides a contact that exists', () => {
    const many: XeroContact[] = Array.from({ length: 250 }, (_v, i) => ({ contact_id: 'c-' + i, name: 'CONTACT ' + i }));
    const out = renderToStaticMarkup(
      <PharmLinkModal pharmacyName="X" currentId={null} contacts={many} search="" onSearch={noop} onPick={noop} onClose={noop} />,
    );
    expect(out).toContain('250 contacts · showing first 100');
    expect(out).toContain('>CONTACT 99<');
    expect(out).not.toContain('>CONTACT 100<');
  });

  it('says "1 contact" in the singular', () => {
    expect(modal({ search: 'alpha' })).toContain('1 contact · showing first 1');
  });

  it('says so when nothing matches, rather than showing an empty box', () => {
    expect(modal({ search: 'zzz' })).toContain('No contacts match.');
  });

  it('binds each row to ITS OWN contact id, and Unlink to null', () => {
    const picked: (string | null)[] = [];
    const node = <PharmLinkModal pharmacyName={P.name!} currentId={'c-bbbb2222'} contacts={CONTACTS} search=""
      onSearch={noop} onPick={(id) => picked.push(id)} onClose={noop} />;
    invokeAll(node, ['onClick']);
    // The three rows in order, then Unlink's null, then Cancel (which calls onClose, not onPick).
    expect(picked).toEqual(['c-aaaa1111', 'c-bbbb2222', 'c-cccc3333', null]);
  });
});

describe('the wiring — every button bound to the thing it sits next to', () => {
  it('binds Back, Edit, Cancel, Save, Delete and Link to their own actions', () => {
    const seen: string[] = [];
    const modes: string[] = [];
    const node = screen({
      editable: true,
      onBack: () => seen.push('back'), onSave: () => seen.push('save'),
      onDelete: () => seen.push('delete'), onLink: () => seen.push('link'),
      onSetMode: (m) => { seen.push('mode'); modes.push(m); },
    });
    invokeAll(node, ['onClick']);
    expect(seen).toEqual(['back', 'link', 'mode', 'delete']);
    expect(modes).toEqual(['edit']);

    const editing: string[] = [];
    const editModes: string[] = [];
    invokeAll(screen({
      editable: true, mode: 'edit',
      onBack: () => editing.push('back'), onSave: () => editing.push('save'),
      onDelete: () => editing.push('delete'), onLink: () => editing.push('link'),
      onSetMode: (m) => { editing.push('mode'); editModes.push(m); },
    }), ['onClick']);
    expect(editing).toEqual(['back', 'save', 'mode']);
    expect(editModes).toEqual(['view']);   // Cancel goes back to VIEW, it does not re-enter edit
  });

  it('wires dirty tracking only when the form is editable', () => {
    let dirty = 0;
    invokeAll(screen({ editable: true, mode: 'edit', onDirty: () => { dirty++; } }), ['onInput']);
    expect(dirty).toBe(1);
    dirty = 0;
    invokeAll(screen({ editable: false, mode: 'edit', onDirty: () => { dirty++; } }), ['onInput']);
    expect(dirty).toBe(0);
  });

  it('the list screen no longer hands this page off to app.html', () => {
    const list = readFileSync(join(REPO, 'web', 'app', 'finance', 'pharm', 'page.tsx'), 'utf8');
    expect(list).toContain('/finance/pharm/detail/');
    expect(list).not.toContain('const toLegacy');
  });
});

/** Invoke every handler of the named kinds in a rendered element tree, in document order. */
function invokeAll(node: unknown, kinds: string[]): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) invokeAll(n, kinds); return; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!el.props) return;
  if (typeof el.type === 'function') { invokeAll((el.type as (p: unknown) => unknown)(el.props), kinds); return; }
  for (const k of kinds) {
    const v = el.props[k];
    if (typeof v === 'function') (v as (e: unknown) => void)({ target: { value: 'V', checked: true } });
  }
  invokeAll(el.props.children, kinds);
}

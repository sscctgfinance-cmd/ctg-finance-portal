// Finance OS · Company Info — the LAST screen of the strangler, and the largest surface in either app.
//
// The legacy original is `renderInfo()` (app.html:5520) and its renderer `infoRender()` (app.html:5937),
// with `infoSecViewBody()` (:6030), `infoSecEditBody()` (:6063) and `infoSecDocsBody()` (:5562) under it.
// All of them are STILL THERE and still shipping; nothing was deleted, and both screens are reachable
// side by side (`app.html#tab=info` and `/finance/info/`).
//
// PURE FUNCTION OF ITS PROPS — no fetch, no localStorage, no window, no clock read. The three loads
// (`company_info_get`, `company_doc_list`, `company_folder_list`), the save, the uploads, the clipboard,
// the print window and the scroll all live in app/finance/info/page.tsx.
//
// ── THE GOLDEN IS TWO SECTIONS, AND NEITHER IS AN INTERMEDIATE STATE ──────────────────────────────
// Ask CLAUDE.md's two questions of the renderer. (1) WHICH IDS does it write? `renderInfo()` calls
// `spin('info')` and `infoRender()` then overwrites THE SAME id, so last-write-wins erases the skeleton
// — the `finance.approvals` case, not `finance.close`'s. `infoRender()` then calls `infoRenderSearch()`
// (app.html:6027), which writes `#info-search-results` — an element WITH an id NESTED INSIDE `#info`,
// so the harness keeps it as its own section, exactly as `finance.gateway`'s `#gw-ref` is kept.
// (2) What does it do AFTER each write? After `#info`: `setDirty('info',false)` (no DOM, app.html:1282)
// in view mode, one `addEventListener` in edit mode, and `infoRenderSearch()`. After
// `#info-search-results`: nothing. `renderInfo()` then sets `loaded.info=true`, a no-op.
//
// So `#info` IS the screen an operator sees on tab open, and `#info-search-results` is genuinely empty
// — `infoRenderSearch()` returns early on a blank query after writing `''` (app.html:5875). The one
// invisible mutation is `box.style.display`, which that same early return sets to `'none'` — the value
// the `#info` markup already carries inline, so unlike `finance.users`' `.className=` there is nothing
// for the golden to be missing. `searchOpen()` below is that derivation; the screen's test pins it.
//
// ── ARITHMETIC: NOT LIFTED, and the reason is the SERVER ──────────────────────────────────────────
// `company_info_save` (finance.ts:2473) forwards `p_patch` to `portal_company_info_save` and re-derives
// nothing — so the client owns what it POSTS. But nothing this screen COMPUTES is posted: the patch is
// the operator's own typing, read straight back out of the form. The numbers on screen — the `filled/
// total` badges, their `Math.round(pct)` colour, `infoDocBytes()` — are display echoes of fields the
// server sent, and no second computation anywhere could disagree and be noticed. That is Quick
// Invoice's case, not `wht.js`'s, and inventing an `info.js` for `n/1048576` would be a larger change
// than the migration. See `savePatch()` for the one part that IS lifted, because it does leave.
//
// ── DATES: TWO DERIVATIONS, AND THE LEGACY READS THEM IN DIFFERENT ZONES ──────────────────────────
// `infoSecDocsBody()` compares each document's `expiry_date` against `todayLocalISO()` (app.html:1263 —
// MYT by construction, `Date.now()+8h` read back with `getUTC*`) and `inDaysLocalISO(90)` (common.js:28
// — the MACHINE's zone, via `localISO()`'s `getFullYear/getMonth/getDate`). They are NOT the same clock,
// and that is the legacy's, mirrored not fixed. Both are pure functions of an instant they are HANDED
// here — `hr.yearend`'s rule — and the screen's test pins each one's SOURCE, because on this fleet (this
// machine and CI both sit at UTC+8) swapping either for the other is invisible to every output check.
// No document in the fixture carries an expiry_date, so all three badge branches are outside the golden.

import { Fragment, type ReactNode } from 'react';

import { mytISO } from '../../myt.js';

/* ══ Types ═════════════════════════════════════════════════════════════════════════════════════════ */

/** A folder id. The fixture's are strings; a live one is a bigint the legacy interpolates unquoted. */
export type FolderId = string | number;

/** One row of `company_info_get.companies` — tests/render_fixtures.ts:240. Free-form beyond the keys. */
export interface InfoCompany {
  tenant_id: string;
  tenant_name: string;
  updated_at?: string | null;
  updated_by_email?: string | null;
  [k: string]: unknown;
}

/** One row of `company_doc_list.documents` — tests/render_fixtures.ts:280. */
export interface InfoDoc {
  id: FolderId;
  tenant_id: string;
  folder_id?: FolderId | null;
  title?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  mime_type?: string | null;
  category?: string | null;
  description?: string | null;
  expiry_date?: string | null;
  uploaded_at?: string | null;
  uploaded_by_email?: string | null;
}

/** One row of `company_folder_list.folders` — tests/render_fixtures.ts:286. */
export interface InfoFolder {
  id: FolderId;
  tenant_id: string;
  parent_id?: FolderId | null;
  name: string;
}

/** One field of a `fields:` section — app.html:5399. */
export interface InfoField {
  k: string;
  l: string;
  ph?: string;
  type?: string;
  copy?: boolean;
  wide?: boolean;
  state?: boolean;
  money?: boolean;
  link?: string;
  textarea?: boolean;
  rows?: number;
}

/** One column of a `list:` section. */
export interface InfoCol { k: string; l: string; copy?: boolean }

/** One entry of `INFO_SECTIONS` — app.html:5399. Exactly one of fields / list / custom is set. */
export interface InfoSection {
  id: string;
  icon: string;
  title: string;
  fields?: InfoField[];
  list?: string;
  cols?: InfoCol[];
  custom?: 'docs';
}

/* ══ The schema ════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `MY_STATES` — app.html:5397. The state dropdown in edit mode.
 */
export const MY_STATES = ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pinang', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu'];

/**
 * `INFO_SECTIONS` — app.html:5399, section for section and field for field.
 *
 * NOT lifted into a shared `.js`. It is a schema, not a computation, and the reason a second copy is
 * safe here is that the screen's own test extracts every section id, title, icon and field key out of
 * `app.html`'s own text at run time and compares — the `profileBody()` FIELD-SET rule. A key that
 * drifts is a field the React edit form stops collecting, which saves as ABSENT on a real company
 * record, and it fails there rather than on someone's screen.
 */
export const INFO_SECTIONS: InfoSection[] = [
  { id: 'identity', icon: '🪪', title: 'Identity (SSM)',
    fields: [
      { k: 'legal_name', l: 'Legal name (as per SSM)', ph: 'CTG4U DRSMILE WHITENING SDN BHD' },
      { k: 'trade_name', l: 'Trade / brand name', ph: 'DrSmile' },
      { k: 'ssm_new', l: 'SSM new no. (12-digit)', ph: '199801012345', copy: true },
      { k: 'ssm_old', l: 'SSM old no.', ph: '123456-X', copy: true },
      { k: 'incorporation_date', l: 'Date of incorporation', type: 'date' },
      { k: 'business_type', l: 'Business type', ph: 'Wholesale of cosmetics' },
      { k: 'msic_code', l: 'MSIC code', ph: '46494' },
    ] },
  { id: 'reg', icon: '🏠', title: 'Registered office address',
    fields: [
      { k: 'reg_address', l: 'Address (street)', ph: 'No. 12, Jalan ...', wide: true },
      { k: 'reg_postcode', l: 'Postcode', ph: '47301' },
      { k: 'reg_city', l: 'City', ph: 'Petaling Jaya' },
      { k: 'reg_state', l: 'State', state: true },
    ] },
  { id: 'biz', icon: '🏪', title: 'Principal place of business',
    fields: [
      { k: 'biz_address', l: 'Address (street)', wide: true },
      { k: 'biz_postcode', l: 'Postcode' },
      { k: 'biz_city', l: 'City' },
      { k: 'biz_state', l: 'State', state: true },
    ] },
  { id: 'contact', icon: '📞', title: 'Contact',
    fields: [
      { k: 'phone', l: 'Phone', type: 'tel', copy: true },
      { k: 'email', l: 'Email', type: 'email', copy: true },
      { k: 'website', l: 'Website', type: 'url', link: 'web' },
    ] },
  { id: 'tax', icon: '💰', title: 'Tax & MyInvois',
    fields: [
      { k: 'income_tax_no', l: 'Income Tax No. (LHDN)', ph: 'C 12345678901', copy: true },
      { k: 'sst_no', l: 'SST registration no.', ph: 'B16-1808-12345678', copy: true },
      { k: 'myinvois_tin', l: 'MyInvois TIN', ph: 'C12345678910', copy: true },
    ] },
  { id: 'stat', icon: '📋', title: 'Statutory employer numbers',
    fields: [
      { k: 'epf_no', l: 'EPF / KWSP', ph: '12345678', copy: true },
      { k: 'socso_no', l: 'SOCSO / PERKESO', ph: 'C12345678', copy: true },
      { k: 'eis_no', l: 'EIS', copy: true },
      { k: 'hrdc_no', l: 'HRD Corp levy', copy: true },
    ] },
  { id: 'capital', icon: '💼', title: 'Capital & financial year',
    fields: [
      { k: 'authorised_capital', l: 'Authorised capital (RM)', type: 'number', ph: '400000', money: true },
      { k: 'paid_up_capital', l: 'Paid-up capital (RM)', type: 'number', ph: '100000', money: true },
      { k: 'financial_year_end', l: 'Financial year end (MM-DD)', ph: '12-31' },
    ] },
  { id: 'directors', icon: '👔', title: 'Directors',
    list: 'directors',
    cols: [{ k: 'name', l: 'Name' }, { k: 'ic', l: 'IC / Passport' }, { k: 'role', l: 'Role' }, { k: 'appointed_on', l: 'Appointed (YYYY-MM-DD)' }] },
  { id: 'sharehold', icon: '📊', title: 'Shareholders',
    list: 'shareholders',
    cols: [{ k: 'name', l: 'Name' }, { k: 'ic_or_no', l: 'IC / Reg no.' }, { k: 'shares', l: 'Shares' }, { k: 'percent', l: '%' }] },
  { id: 'secaud', icon: '🖋', title: 'Secretary / Auditor',
    fields: [
      { k: 'company_secretary', l: 'Company secretary (name)' },
      { k: 'secretary_firm', l: 'Secretarial firm' },
      { k: 'auditor', l: 'Auditor' },
    ] },
  { id: 'bank', icon: '🏦', title: 'Bank accounts',
    list: 'bank_accounts',
    cols: [{ k: 'bank', l: 'Bank' }, { k: 'account_no', l: 'Account no.', copy: true }, { k: 'account_name', l: 'Account name' }, { k: 'branch', l: 'Branch' }, { k: 'purpose', l: 'Purpose' }] },
  { id: 'licences', icon: '📜', title: 'Licences & permits',
    list: 'licences',
    cols: [{ k: 'name', l: 'Licence / permit' }, { k: 'authority', l: 'Issuing authority' }, { k: 'license_no', l: 'No.', copy: true }, { k: 'valid_from', l: 'Valid from' }, { k: 'valid_to', l: 'Valid to' }] },
  { id: 'contacts', icon: '👥', title: 'Key employees / contacts',
    list: 'key_contacts',
    cols: [{ k: 'name', l: 'Name' }, { k: 'position', l: 'Position' }, { k: 'phone', l: 'Phone', copy: true }, { k: 'email', l: 'Email', copy: true }] },
  { id: 'group', icon: '🏗', title: 'Group structure',
    list: 'group_structure',
    cols: [{ k: 'relationship', l: 'Relationship' }, { k: 'name', l: 'Company name' }, { k: 'shareholding_pct', l: 'Shareholding %' }, { k: 'notes', l: 'Notes' }] },
  { id: 'ins', icon: '🛡', title: 'Insurance policies',
    list: 'insurance_policies',
    cols: [{ k: 'insurer', l: 'Insurer' }, { k: 'policy_no', l: 'Policy no.', copy: true }, { k: 'type', l: 'Type' }, { k: 'sum_insured', l: 'Sum insured (RM)' }, { k: 'expiry', l: 'Expiry' }] },
  { id: 'lease', icon: '🔑', title: 'Lease / Property',
    list: 'leases',
    cols: [{ k: 'address', l: 'Address' }, { k: 'landlord', l: 'Landlord' }, { k: 'monthly_rent', l: 'Rent (RM)' }, { k: 'contract_start', l: 'Start' }, { k: 'expiry', l: 'Expiry' }] },
  { id: 'compl', icon: '📅', title: 'Compliance dates',
    fields: [
      { k: 'annual_return_due', l: 'Annual Return due', type: 'date' },
      { k: 'agm_date', l: 'AGM date', type: 'date' },
      { k: 'audit_submission_due', l: 'Audit submission due', type: 'date' },
      { k: 'tax_return_due', l: 'Tax Return (Form C) due', type: 'date' },
      { k: 'sst_return_period', l: 'SST return period', ph: 'Bi-monthly / Quarterly' },
    ] },
  { id: 'notes', icon: '📝', title: 'Notes', fields: [{ k: 'notes', l: 'Free text', textarea: true, rows: 4 }] },
  { id: 'docs', icon: '📎', title: 'Documents', custom: 'docs' },
];

/** `INFO_DOC_CATEGORIES` — app.html:5492. The upload form's Category dropdown. */
export const INFO_DOC_CATEGORIES = ['SSM / Registration', 'Tax', 'Contract', 'Licence / Permit', 'Insurance', 'Bank', 'Lease', 'Audit', 'Other'];

/** `INFO_SUMMARY_KEYS` — app.html:5498. The eight fields the Quick-view card shows on every company. */
export const INFO_SUMMARY_KEYS: InfoField[] = [
  { k: 'ssm_new', l: 'SSM No.', copy: true },
  { k: 'income_tax_no', l: 'Income Tax', copy: true },
  { k: 'sst_no', l: 'SST No.', copy: true },
  { k: 'myinvois_tin', l: 'MyInvois TIN', copy: true },
  { k: 'epf_no', l: 'EPF', copy: true },
  { k: 'financial_year_end', l: 'FY end' },
  { k: 'phone', l: 'Phone', copy: true },
  { k: 'email', l: 'Email', copy: true },
];

/**
 * The keys `infoCollect()` (app.html:6099) rewrites into arrays, in its own order.
 *
 * A list section that is not named here posts as a plain form value rather than as rows, so it is the
 * eight `list:` sections' contract with the save. The screen's test derives it from app.html.
 */
export const INFO_LIST_KEYS = ['directors', 'shareholders', 'bank_accounts', 'licences', 'key_contacts', 'group_structure', 'insurance_policies', 'leases'];

/* ══ Gate ══════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * app.html:1424 — `else if(t==='info') el.classList.remove('hide')`, with the comment "Company Info:
 * always visible (gated server-side)". No role, no feature flag, and it takes its own branch in
 * `showApp()`'s chain so it never reaches app.html:1439's feature-flag fall-through.
 *
 * Same shape as `pharmReachable()` and `calendarReachable()`. A predicate that always returns true is
 * still the rule: the day someone adds a client gate here, the screen's test is where it shows up. The
 * direction that carries the security meaning is the OTHER one — what the screen renders when
 * `portal_company_info_get` refuses. See `Refused` below.
 */
export function infoReachable(): boolean {
  return true;
}

/* ══ Filled-ness, progress, formatting ═════════════════════════════════════════════════════════════ */

/** `infoFilled()` — app.html:5509. Note `v!==0`: a numeric zero counts as EMPTY. */
export function infoFilled(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return v !== 0;
}

/** `infoSectionFilled()` — app.html:5510. `docs` counts the tenant's documents, not a field. */
export function infoSectionFilled(c: InfoCompany, sec: InfoSection, docs: Record<string, InfoDoc[]>): boolean {
  if (sec.custom === 'docs') return (docs[c.tenant_id] || []).length > 0;
  if (sec.list) return infoFilled(c[sec.list]);
  return (sec.fields || []).some((f) => infoFilled(c[f.k]));
}

/** `infoCompanyProgress()` — app.html:5515. The `n/19` badge on every company tab. */
export function infoCompanyProgress(c: InfoCompany, docs: Record<string, InfoDoc[]>): { filled: number; total: number } {
  let n = 0;
  INFO_SECTIONS.forEach((s) => { if (infoSectionFilled(c, s, docs)) n++; });
  return { filled: n, total: INFO_SECTIONS.length };
}

/**
 * The progress badge's colour — app.html:5960-5961.
 *
 * Two thresholds, and a threshold no test CROSSES is a threshold a port can move (CLAUDE.md, from the
 * CFO cockpit). Split out so the screen's test can drive it AT 40 and AT 80 rather than at whatever
 * percentage the fixture happens to land on.
 */
export function progressColour(filled: number, total: number): string {
  const pct = Math.round(filled / total * 100);
  return pct >= 80 ? 'var(--green-soft)' : pct >= 40 ? 'var(--amber)' : 'var(--red-soft)';
}

/** `infoDocBytes()` — app.html:5541. */
export function infoDocBytes(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

/** `infoDocIcon()` — app.html:5542, branch for branch and in the same order. */
export function infoDocIcon(mime: unknown): string {
  const m = String(mime || '').toLowerCase();
  if (m.indexOf('pdf') >= 0) return '📕';
  if (m.indexOf('image') >= 0) return '🖼';
  if (m.indexOf('word') >= 0 || m.indexOf('document') >= 0) return '📘';
  if (m.indexOf('spreadsheet') >= 0 || m.indexOf('excel') >= 0) return '📗';
  return '📄';
}

/** `M` — app.html:1258. Formatting, not arithmetic. */
const M = (n: unknown) => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ══ Dates ═════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * `todayLocalISO()` — app.html:1263, character for character, taking the instant as an argument.
 *
 * MALAYSIA time BY CONSTRUCTION: `now + 8h` read back with `getUTC*` needs no timezone database, so a
 * browser in any zone agrees on which day it is in Kuala Lumpur. Rewriting it with `getFullYear()` is
 * invisible on this fleet (this machine and CI both sit at UTC+8) and marks a document expired a day
 * early for an operator west of Greenwich. The screen's test pins this function's SOURCE, not its
 * output — `finance.calendar`'s finding, in its fourth form.
 */
export const todayLocalISO = (now: number): string => mytISO(now);

/**
 * `inDaysLocalISO()` + `localISO()` — common.js:27-28, MALAYSIAN since v224.
 *
 * THIS IS THE "TWO CLOCKS" FIX. It used to be the MACHINE's zone — `getFullYear/getMonth/getDate` —
 * while `todayLocalISO()` above was MYT, and `expiryBadge()` compares the two against each other in one
 * expression. One comparison, two definitions of "now": west of Greenwich the ⏳ window's far edge sat a
 * day off the ⚠ threshold, so a licence could be reported as expiring in 90 days and expired on the same
 * screen. Both halves now read Kuala Lumpur, in both apps, from myt.js.
 *
 * Neither is visible in any output on this fleet (UTC+8), so the screen's test pins both SOURCES.
 */
export const inDaysLocalISO = (days: number, now: number): string => mytISO(now + days * 86400000);

/* ══ Folders ═══════════════════════════════════════════════════════════════════════════════════════ */

const sameId = (a: FolderId | null | undefined, b: FolderId | null | undefined) => a === b;

/** `infoFolderById()` — app.html:5552. */
export function infoFolderById(folders: InfoFolder[], fid: FolderId | null): InfoFolder | undefined {
  return folders.find((f) => sameId(f.id, fid));
}

/**
 * `infoFolderPath()` — app.html:5554. "/ Parent / Child", the label the Move-to dropdown shows.
 *
 * The `guard++ < 20` is the legacy's cycle brake: a folder whose `parent_id` chain loops would hang the
 * browser, and it is kept because the data is user-editable.
 */
export function infoFolderPath(folders: InfoFolder[], fid: FolderId | null): string {
  if (!fid) return '/ (root)';
  const parts: string[] = [];
  let cur = folders.find((f) => sameId(f.id, fid));
  let guard = 0;
  while (cur && guard++ < 20) {
    parts.unshift(cur.name);
    const parent: FolderId | null | undefined = cur.parent_id;
    cur = parent ? folders.find((f) => sameId(f.id, parent)) : undefined;
  }
  return '/ ' + parts.join(' / ');
}

/* ══ Search ════════════════════════════════════════════════════════════════════════════════════════ */

/** One row of the search-results panel. */
export interface InfoHit {
  company: string;
  tenant_id: string;
  section: InfoSection;
  label: string;
  value: string;
}

/**
 * `infoSearchAll()` — app.html:5834, branch for branch.
 *
 * This decides what an operator can FIND across every company they may see: a field dropped from the
 * scan makes a company record unfindable by the thing they typed, and the screen looks perfectly normal
 * while saying "No matches". Note the three different match rules — a `fields` section matches on the
 * value, the field LABEL or the section TITLE; a `list` section on the flattened row or the section
 * title; a document on title/file name/category/description only.
 */
export function infoSearchAll(
  query: string,
  companies: InfoCompany[],
  docs: Record<string, InfoDoc[]>,
): InfoHit[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const hits: InfoHit[] = [];
  companies.forEach((c) => {
    INFO_SECTIONS.forEach((sec) => {
      if (sec.custom === 'docs') {
        (docs[c.tenant_id] || []).forEach((doc) => {
          const flat = ((doc.title || '') + ' ' + (doc.file_name || '') + ' ' + (doc.category || '') + ' ' + (doc.description || '')).toLowerCase();
          if (flat.indexOf(q) >= 0) {
            hits.push({
              company: c.tenant_name, tenant_id: c.tenant_id, section: sec,
              label: doc.category + ' · ' + (doc.title || doc.file_name),
              value: doc.file_name + ' (' + (doc.expiry_date ? 'expires ' + doc.expiry_date : infoDocBytes(doc.file_size || 0)) + ')',
            });
          }
        });
      } else if (sec.fields) {
        sec.fields.forEach((f) => {
          const v = c[f.k];
          if (v == null || v === '') return;
          const sv = String(v).toLowerCase();
          if (sv.indexOf(q) >= 0 || f.l.toLowerCase().indexOf(q) >= 0 || sec.title.toLowerCase().indexOf(q) >= 0) {
            hits.push({ company: c.tenant_name, tenant_id: c.tenant_id, section: sec, label: f.l, value: String(v) });
          }
        });
      } else if (sec.list) {
        const arr = (c[sec.list] as Record<string, unknown>[]) || [];
        if (!arr.length) return;
        arr.forEach((item, i) => {
          if (!item || typeof item !== 'object') return; // guard: legacy data could be a string/null
          const flat = Object.values(item).map((x) => String(x || '')).join(' ').toLowerCase();
          if (flat.indexOf(q) >= 0 || sec.title.toLowerCase().indexOf(q) >= 0) {
            const summary = (sec.cols || []).slice(0, 3).map((col) => item[col.k]).filter(Boolean).join(' · ');
            hits.push({ company: c.tenant_name, tenant_id: c.tenant_id, section: sec, label: sec.title + ' #' + (i + 1), value: summary });
          }
        });
      }
    });
  });
  return hits;
}

/**
 * `infoRenderSearch()`'s first branch — app.html:5875. `false` means the panel is `display:none` AND
 * its body is the empty string; `true` means `display:block`.
 *
 * The display flip is an imperative `box.style.display=` the golden harness cannot record, so this is
 * the derivation the `#info` section's inline style would otherwise be silently disconnected from —
 * `finance.users`' `active` prop, in the one shape where the golden's value and the live one agree.
 */
export function searchOpen(search: string): boolean {
  return search.trim() !== '';
}

/* ══ What leaves the building ══════════════════════════════════════════════════════════════════════ */

/**
 * `infoCollect()`'s LAST THREE STATEMENTS — app.html:6111-6114 — as a pure function.
 *
 * `infoCollect()` itself reads the DOM (`#info-form [data-k]`, `[data-list]`), so it is not liftable
 * as-is; that half stays in the route, reading the same `data-k` / `data-sk` / `data-list` attributes
 * this component writes, exactly as `qiCollect()`'s does. What IS split out is the part that decides
 * what reaches `portal_company_info_save`, because no golden sees a request body:
 *
 *   • a blank date or number is sent as NULL, not as '' — Postgres rejects ''::date outright, and the
 *     legacy form proved it: one untouched Compliance date failed the WHOLE save with
 *     `invalid input syntax for type date: ""`, naming no field.
 *   • a non-blank number is sent as a NUMBER, not the input's string.
 *
 * The fields are read from INFO_SECTIONS rather than named here, and that is the whole point. The legacy
 * guarded a hand-written list of one date (`incorporation_date`); the four Compliance dates were added to
 * the schema later and the second list was never updated. Two sources of truth, and the newer fields fell
 * through the gap. Deriving from the schema means a date added tomorrow is covered the day it is added.
 *
 * NULL rather than deleting the key: a deleted key cannot express "clear this", so a date entered by
 * mistake could never be removed. Everything else is passed through verbatim — a blanked TEXT field must
 * still reach the server as '' so that clearing it is a clear and not a silent no-op.
 */
export function savePatch(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  INFO_SECTIONS.forEach((sec) => {
    (sec.fields || []).forEach((f) => {
      if (!(f.k in out)) return;
      const blank = String(out[f.k] == null ? '' : out[f.k]).trim() === '';
      if (f.type === 'date') { if (blank) out[f.k] = null; }
      else if (f.type === 'number') out[f.k] = blank ? null : Number(out[f.k]);
    });
  });
  return out;
}

/**
 * The `{api:'company_info_save'}` body — app.html:6135.
 *
 * Throws on a blank tenant for the same reason `reconcileBody('')` does: `company_info_save`
 * (finance.ts:2473) takes the tenant from the REQUEST, so a patch posted without one either fails the
 * server's own `tenant required` check or, if that ever loosened, writes one company's SSM number,
 * bank accounts and directors over another's. Nothing on screen would say so.
 */
export function saveBody(tenant: string, patch: Record<string, unknown>): { api: string; tenant: string; patch: Record<string, unknown> } {
  if (!tenant) throw new Error('company_info_save needs a tenant');
  return { api: 'company_info_save', tenant, patch };
}

/**
 * `infoPrint()`'s document — app.html:5911, as a pure function returning the HTML string.
 *
 * A DOCUMENT that leaves the building: an operator prints this and hands it to a bank, an auditor or a
 * company secretary. So it gets `sbiInvoiceHTML()`'s treatment — the string here, the `window.open`,
 * the pop-up-blocked toast and the `w.print()` left in the route — precisely so the screen's test can
 * pin what is ON it. Distinguish it from `whtDocHtml()`, which is a sibling PAGE the legacy renderer
 * dispatches to and therefore hands off.
 *
 * `printedOn` is the legacy's `new Date().toISOString().slice(0,10)` — UTC, NOT `todayLocalISO()`, so
 * between midnight and 08:00 in Kuala Lumpur the report is dated the previous day. Mirrored, not fixed,
 * and handed in as an argument so the screen's test can drive that boundary.
 */
export function printDocHtml(
  c: InfoCompany,
  docs: Record<string, InfoDoc[]>,
  printedOn: string,
): string {
  const esc = (x: unknown) => (x == null ? '' : String(x)).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
  const val = (v: unknown) => (v == null || v === '' ? '—' : String(v));
  const fldRow = (f: InfoField, v: string) => '<div style="display:grid;grid-template-columns:200px 1fr;padding:6px 0;border-bottom:1px solid #eee"><div style="color:#666;font-size:12px">' + f.l + '</div><div>' + esc(v) + '</div></div>';
  let body = '<style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:30px auto;padding:0 40px;color:#222;line-height:1.5}h1{font-size:24px;margin:0 0 4px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.04em;color:#666;margin:28px 0 10px;padding-bottom:6px;border-bottom:2px solid #222}table{width:100%;border-collapse:collapse;font-size:13px;margin-top:4px}th,td{text-align:left;padding:6px 10px;border:1px solid #ddd}th{background:#f4f4f4;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#555}.meta{color:#888;font-size:12px;margin-bottom:24px}</style>';
  body += '<h1>' + esc(c.tenant_name) + '</h1><div class="meta">Company Information Report · printed ' + printedOn + (c.updated_at ? ' · last edit ' + esc(String(c.updated_at).slice(0, 10)) : '') + '</div>';
  INFO_SECTIONS.forEach((sec) => {
    if (!infoSectionFilled(c, sec, docs)) return;
    body += '<h2>' + sec.icon + ' ' + esc(sec.title) + '</h2>';
    if (sec.custom === 'docs') {
      const list = docs[c.tenant_id] || [];
      body += '<table><thead><tr><th>Category</th><th>Title</th><th>File</th><th>Size</th><th>Expiry</th></tr></thead>';
      body += '<tbody>' + list.map((d) => '<tr><td>' + esc(d.category || '') + '</td><td>' + esc(d.title || d.file_name) + '</td><td>' + esc(d.file_name) + '</td><td>' + esc(infoDocBytes(d.file_size || 0)) + '</td><td>' + esc(d.expiry_date || '—') + '</td></tr>').join('') + '</tbody></table>';
    } else if (sec.fields) {
      body += '<div>' + sec.fields.map((f) => fldRow(f, val(c[f.k]))).join('') + '</div>';
    } else if (sec.list) {
      const arr = (c[sec.list] as Record<string, unknown>[]) || [];
      body += '<table><thead><tr>' + (sec.cols || []).map((col) => '<th>' + esc(col.l) + '</th>').join('') + '</tr></thead>';
      body += '<tbody>' + arr.map((item) => '<tr>' + (sec.cols || []).map((col) => '<td>' + esc(val(item[col.k])) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    }
  });
  return '<!doctype html><html><head><title>' + esc(c.tenant_name) + ' — Company Info</title></head><body>' + body + '</body></html>';
}

/* ══ Markup ════════════════════════════════════════════════════════════════════════════════════════ */

/**
 * Every inline style is written as a STRING and split mechanically — the WHT pilot's `st()`, kept for
 * the same reason: nothing in parity.ts touches an attribute VALUE, so these are compared character for
 * character, and a style OBJECT hands React two chances to change one silently (it appends `px` to a
 * bare number and re-serialises `.03` as `0.03`).
 *
 * An EMPTY declaration is dropped here — `font-size:13px;;margin-top:2px` (which app.html:5985 writes
 * whenever a Quick-view field is filled) cannot be spelled in React at all, because its style
 * serialiser emits no declaration for an empty value. The screen's test collapses `;;` on BOTH sides
 * and says why; see `collapseEmptyDecl` there.
 */
function st(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of css.split(';')) {
    const at = part.indexOf(':');
    if (at < 0) continue;
    const name = part.slice(0, at).trim();
    const key = name.startsWith('--') ? name : name.replace(/-([a-z])/g, (_m, ch: string) => (ch as string).toUpperCase());
    out[key] = part.slice(at + 1).trim();
  }
  return out;
}

/** The shared handler walker invokes every handler with a bare `{target:{value}}` stub. */
type StubEvent = { preventDefault?: () => void; stopPropagation?: () => void; currentTarget?: { style?: { background: string } } };

/** `spin('info')` — app.html:1541, character for character. Overwritten in the golden; see the header. */
export function Loading() {
  return (
    <>
      <div className="cards">
        <div className="sk-card"></div><div className="sk-card"></div><div className="sk-card"></div><div className="sk-card"></div>
      </div>
      <div className="sk-row"></div>
      <div className="sk-row"></div>
      <div className="sk-row" style={{ width: '65%' }}></div>
    </>
  );
}

/** app.html:5523 — the server said `ok:false`. THE branch this screen's gate lives in; see the header. */
export function Refused({ message }: { message: string }) {
  return <div className="empty"><div className="empty-ico">🔒</div><div>{message}</div></div>;
}

/** app.html:5526 — signed in, allowed, but no company is shared with this login. */
export function NoCompanies() {
  return <div className="empty"><div className="empty-ico">🏢</div><div>No companies you can access yet.</div></div>;
}

/** app.html:5537 — `renderInfo()`'s catch: a transport failure, not a refusal. */
export function Failed({ message }: { message: string }) {
  return <div className="empty"><div className="empty-ico">⚠️</div><div>{message}</div></div>;
}

/* ── The documents section ─────────────────────────────────────────────────────────────────────── */

interface DocsProps {
  c: InfoCompany;
  docs: InfoDoc[];
  folders: InfoFolder[];
  activeFolderId: FolderId | null;
  editing: boolean;
  now: number;
  onFolderOpen: (fid: FolderId | null) => void;
  onFolderCreate: (parentId: FolderId | null) => void;
  onFolderDelete: (fid: FolderId) => void;
  onDocMove: (docId: FolderId, folderIdStr: string) => void;
  onDocDownload: (docId: FolderId) => void;
  onDocDelete: (docId: FolderId) => void;
  onDocUpload: () => void;
}

/** `infoSecDocsBody()`'s tree — app.html:5591, recursive, `depth?16:0` and all. */
function TreeNode({ parentId, depth, p }: { parentId: FolderId | null; depth: number; p: DocsProps }) {
  const kids = p.folders.filter((f) => sameId(f.parent_id || null, parentId));
  if (!kids.length) return null;
  const paint = (colour: string) => (e: StubEvent) => {
    if (e && e.currentTarget && e.currentTarget.style) e.currentTarget.style.background = colour;
  };
  return (
    <ul style={st('list-style:none;padding-left:' + (depth ? 16 : 0) + 'px;margin:0')}>
      {kids.map((f) => {
        const isActive = sameId(f.id, p.activeFolderId);
        const subCount = p.folders.filter((x) => sameId(x.parent_id || null, f.id)).length;
        const fileN = p.docs.filter((d) => sameId(d.folder_id || null, f.id)).length;
        const bg = isActive ? 'rgba(232,93,60,.10)' : 'transparent';
        const hoverBg = isActive ? 'rgba(232,93,60,.14)' : 'rgba(255,255,255,.04)';
        const countText = (fileN ? fileN + '📄' : '') + (subCount ? (fileN ? ' · ' : '') + subCount + '📁' : '');
        return (
          <li key={String(f.id)}>
            <div style={st('display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:5px;cursor:pointer;background:' + bg)}
                 onClick={() => p.onFolderOpen(f.id)}
                 onMouseOver={paint(hoverBg)}
                 onMouseOut={paint(bg)}>
              <span style={st('font-size:14px')}>{isActive ? '📂' : '📁'}</span>
              <span style={st('font-size:13px;color:var(--text);flex:1')}>{f.name}</span>
              {subCount + fileN > 0
                ? <span className="muted" style={st('font-size:10px')}>{countText}</span>
                : <span className="muted" style={st('font-size:10px;opacity:.4')}>empty</span>}
              {p.editing
                ? <button className="btn" style={st('padding:1px 6px;font-size:10px')}
                          onClick={(e: StubEvent) => { e.stopPropagation?.(); p.onFolderDelete(f.id); }}
                          title="Delete folder">🗑</button>
                : null}
            </div>
            <TreeNode parentId={f.id} depth={depth + 1} p={p} />
          </li>
        );
      })}
    </ul>
  );
}

/** The breadcrumb — app.html:5576. Root is a plain span; deeper is a chain of anchors. */
function Breadcrumb({ p }: { p: DocsProps }) {
  if (!p.activeFolderId) {
    return <>
      <span style={st('color:var(--text)')}>{'📂 / '}</span>
      <span className="muted">all documents</span>
    </>;
  }
  const chain: InfoFolder[] = [];
  let cur = infoFolderById(p.folders, p.activeFolderId);
  let guard = 0;
  while (cur && guard++ < 20) {
    chain.unshift(cur);
    const parent: FolderId | null | undefined = cur.parent_id;
    cur = parent ? infoFolderById(p.folders, parent) : undefined;
  }
  return (
    <>
      <a href="#" onClick={(e: StubEvent) => { e.preventDefault?.(); p.onFolderOpen(null); }}
         style={st('color:var(--text-soft);text-decoration:none')}>{'📂 /'}</a>
      {' '}
      {chain.map((f, i) => (
        <Fragment key={String(f.id)}>
          {i > 0 ? <>{' '}<span className="muted">/</span>{' '}</> : null}
          {i === chain.length - 1
            ? <span style={st('color:var(--text)')}>{f.name}</span>
            : <a href="#" onClick={(e: StubEvent) => { e.preventDefault?.(); p.onFolderOpen(f.id); }}
                 style={st('color:var(--text-soft);text-decoration:none')}>{f.name}</a>}
        </Fragment>
      ))}
    </>
  );
}

/**
 * One file row — app.html:5643.
 *
 * The expiry badge is the only place on this screen where a date DECIDES what an operator sees, and it
 * compares two clocks that are not the same one (see the header). No fixture document carries an
 * `expiry_date`, so none of its three branches is in the golden; the screen's test drives all three.
 */
function FileRow({ doc, p, todayISO, ninetyDaysOut }: { doc: InfoDoc; p: DocsProps; todayISO: string; ninetyDaysOut: string }) {
  let expiryBadge: ReactNode = null;
  if (doc.expiry_date) {
    if (doc.expiry_date < todayISO) {
      expiryBadge = <span className="pill pill-coral" style={st('font-size:10px;margin-left:6px')}>{'⚠ expired ' + doc.expiry_date}</span>;
    } else if (doc.expiry_date < ninetyDaysOut) {
      expiryBadge = <span className="pill" style={st('background:rgba(255,187,86,.16);color:var(--amber);font-size:10px;margin-left:6px')}>{'⏳ expires ' + doc.expiry_date}</span>;
    } else {
      expiryBadge = <span className="muted" style={st('font-size:10px;margin-left:6px')}>{'expires ' + doc.expiry_date}</span>;
    }
  }
  const meta = (doc.file_name == null ? '' : String(doc.file_name)) + ' · ' + infoDocBytes(doc.file_size || 0) +
    ' · uploaded ' + String(doc.uploaded_at || '').slice(0, 16).replace('T', ' ') +
    (doc.uploaded_by_email ? ' by ' + doc.uploaded_by_email : '');
  return (
    <div style={st('display:flex;align-items:center;gap:10px;padding:10px 12px;border-top:1px solid var(--panel-border)')}>
      <div style={st('font-size:20px')}>{infoDocIcon(doc.mime_type)}</div>
      <div style={st('flex:1;min-width:0')}>
        <div style={st('font-size:13px;color:var(--text);word-break:break-word')}>
          {doc.category
            ? <span className="pill" style={st('background:rgba(255,255,255,.06);color:var(--text-soft);font-size:10px;margin-right:6px')}>{doc.category}</span>
            : null}
          {doc.title || doc.file_name}
          {expiryBadge}
        </div>
        <div style={st('font-size:11px;color:var(--muted);margin-top:2px')}>{meta}</div>
      </div>
      {p.editing
        ? (
          <select onChange={(e) => p.onDocMove(doc.id, (e.target as HTMLSelectElement).value)}
                  title="Move to folder"
                  style={st('background:var(--panel);border:1px solid var(--panel-border);color:var(--text);padding:3px 6px;border-radius:5px;font-size:11px;max-width:140px')}>
            <option value="">{doc.folder_id ? 'Move…' : '/ (root)'}</option>
            {doc.folder_id ? <option value="">/ (root)</option> : null}
            {p.folders.filter((f) => !sameId(f.id, doc.folder_id)).map((f) =>
              <option key={String(f.id)} value={String(f.id)}>{'→ ' + infoFolderPath(p.folders, f.id)}</option>)}
          </select>
        )
        : null}
      <button className="btn" style={st('padding:4px 10px;font-size:11.5px')} onClick={() => p.onDocDownload(doc.id)}>⬇</button>
      {p.editing
        ? <button className="btn" style={st('padding:3px 7px;font-size:11px')} onClick={() => p.onDocDelete(doc.id)} title="Delete document">🗑</button>
        : null}
    </div>
  );
}

/** `infoSecDocsBody()` — app.html:5562. Also the EDIT-mode body of the Documents section (app.html:6064). */
function DocsBody(p: DocsProps) {
  const allDocs = p.docs;
  const allFolders = p.folders;
  const visible = allDocs.filter((d) => sameId(d.folder_id || null, p.activeFolderId));
  const subfolders = allFolders.filter((f) => sameId(f.parent_id || null, p.activeFolderId));
  const rootIsActive = !p.activeFolderId;
  const rootCount = allDocs.filter((d) => !d.folder_id).length;
  const todayISO = todayLocalISO(p.now);
  const ninetyDaysOut = inDaysLocalISO(90, p.now);

  const tree = (
    <div style={st('background:var(--panel-2);border:1px solid var(--panel-border);border-radius:10px;padding:10px;min-height:120px')}>
      <div style={st('display:flex;align-items:center;gap:8px;margin-bottom:8px')}>
        <div style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:660;flex:1')}>Folders</div>
        {p.editing
          ? <button className="btn" style={st('padding:3px 8px;font-size:11px')} onClick={() => p.onFolderCreate(p.activeFolderId)}>+ New folder</button>
          : null}
      </div>
      <div onClick={() => p.onFolderOpen(null)}
           style={st('display:flex;align-items:center;gap:6px;padding:6px 8px;border-radius:5px;cursor:pointer;background:' + (rootIsActive ? 'rgba(232,93,60,.10)' : 'transparent') + ';margin-bottom:4px')}>
        <span style={st('font-size:14px')}>{rootIsActive ? '📂' : '📁'}</span>
        <span style={st('font-size:13px;color:var(--text);flex:1')}>All documents</span>
        <span className="muted" style={st('font-size:10px')}>{allDocs.length + ' total · ' + rootCount + ' in root'}</span>
      </div>
      <TreeNode parentId={null} depth={1} p={p} />
      {allFolders.length === 0 && !p.editing
        ? <div className="muted" style={st('font-size:11.5px;text-align:center;padding:8px 0')}>No folders yet.</div>
        : null}
    </div>
  );

  const box = 'width:100%;background:var(--panel);border:1px solid var(--panel-border);color:var(--text);padding:7px 9px;border-radius:6px;font-size:12.5px';
  const uploadForm = !p.editing ? null : (
    <div style={st('background:var(--panel-2);border:1px dashed var(--panel-border);border-radius:10px;padding:14px;margin-bottom:14px')}>
      <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px;font-weight:660')}>Attach a document</div>
      <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:10px')}>
        <div>
          <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:4px')}>Folder</label>
          {/* UNCONTROLLED, keeping the legacy ids: `infoDocUpload()` (app.html:5766) reads every one of
              these five controls back out of the DOM by id. A controlled port would add attributes no
              golden carries and would still have to keep the ids. */}
          <select id="info-doc-folder" defaultValue={p.activeFolderId == null ? '' : String(p.activeFolderId)} style={st(box)}>
            <option value="">/ (root)</option>
            {allFolders.map((f) => <option key={String(f.id)} value={String(f.id)}>{infoFolderPath(allFolders, f.id)}</option>)}
          </select>
        </div>
        <div>
          <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:4px')}>Category</label>
          <select id="info-doc-category" style={st(box)}>
            {INFO_DOC_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        </div>
        <div>
          <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:4px')}>Title (optional)</label>
          <input id="info-doc-title" placeholder="e.g. SST Cert 2026" style={st(box)} />
        </div>
        <div>
          <label style={st('font-size:10px;color:var(--muted);display:block;margin-bottom:4px')}>Expiry (optional)</label>
          <input id="info-doc-expiry" type="date" style={st(box)} />
        </div>
      </div>
      <div style={st('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
        <input type="file" id="info-doc-file" accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.doc,.xlsx,.xls,.txt" style={st('flex:1;min-width:200px;font-size:12px;color:var(--text-soft)')} />
        <button className="btn p" id="info-doc-upload-btn" onClick={() => p.onDocUpload()}>⬆ Upload</button>
      </div>
      <div id="info-doc-status" style={st('font-size:11.5px;margin-top:8px;min-height:14px')}></div>
      <div className="muted" style={st('font-size:11px;margin-top:6px')}>Max 20 MB · PDF / image / Word / Excel / TXT</div>
    </div>
  );

  const filesPanel = (
    <div style={st('background:var(--panel-2);border:1px solid var(--panel-border);border-radius:10px;padding:12px')}>
      <div style={st('display:flex;align-items:center;gap:10px;margin-bottom:10px')}>
        <div style={st('font-size:13px;flex:1')}><Breadcrumb p={p} /></div>
        <span className="muted" style={st('font-size:11px')}>{visible.length + ' file' + (visible.length === 1 ? '' : 's')}</span>
      </div>
      {subfolders.length
        ? (
          <div style={st('display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px')}>
            {subfolders.map((f) => {
              const fileN = allDocs.filter((d) => sameId(d.folder_id || null, f.id)).length;
              return (
                <div key={String(f.id)} onClick={() => p.onFolderOpen(f.id)}
                     style={st('background:var(--panel-2);border:1px solid var(--panel-border);border-radius:8px;padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;min-width:140px')}>
                  <span style={st('font-size:18px')}>📁</span>
                  <div>
                    <div style={st('font-size:12.5px;color:var(--text)')}>{f.name}</div>
                    <div className="muted" style={st('font-size:10px')}>{fileN + ' file' + (fileN === 1 ? '' : 's')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )
        : null}
      {visible.length
        ? (
          <div style={st('border:1px solid var(--panel-border);border-radius:8px;overflow:hidden;background:var(--panel-2)')}>
            {visible.map((d) => <FileRow key={String(d.id)} doc={d} p={p} todayISO={todayISO} ninetyDaysOut={ninetyDaysOut} />)}
          </div>
        )
        : (
          <div className="muted" style={st('font-size:13px;text-align:center;padding:18px 0')}>
            {'No files' + (p.activeFolderId ? ' in this folder' : '') + (allDocs.length > 0 && p.activeFolderId ? '. The files are in subfolders.' : '.')}
          </div>
        )}
    </div>
  );

  return (
    <>
      {uploadForm}
      <div style={st('display:grid;grid-template-columns:240px 1fr;gap:12px;align-items:start')}>{tree}{filesPanel}</div>
      <style dangerouslySetInnerHTML={{ __html: '@media(max-width:680px){#info-sec-docs > div:last-child{grid-template-columns:1fr!important}}' }} />
    </>
  );
}

/* ── View mode ─────────────────────────────────────────────────────────────────────────────────── */

interface BodyProps {
  sec: InfoSection;
  c: InfoCompany;
  docs: DocsProps;
  onCopy: (text: string, btn: unknown) => void;
  onRowAdd: (key: string, colKeys: string[]) => void;
  onRowDel: (key: string, idx: number) => void;
}

/** The 📋 button — app.html:6043 / :6055 / :5985, three sizes of the same control. */
function CopyBtn({ value, css, onCopy }: { value: string; css: string; onCopy: (t: string, b: unknown) => void }) {
  return (
    <button className="btn" style={st(css)} title="Copy"
            onClick={(e: StubEvent) => onCopy(value, e && e.currentTarget)}>📋</button>
  );
}

/** `infoSecViewBody()` — app.html:6030. */
function ViewBody({ sec, c, docs, onCopy }: BodyProps) {
  if (sec.custom === 'docs') return <DocsBody {...docs} />;
  if (sec.fields) {
    return (
      <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px 18px')}>
        {sec.fields.map((f) => {
          const v = c[f.k];
          const filled = infoFilled(v);
          const display = !filled
            ? <span style={st('color:var(--muted);opacity:.5')}>—</span>
            : f.money ? M(v)
            : f.link === 'web'
              ? <a href={String(v).indexOf('http') === 0 ? String(v) : 'https://' + String(v)} target="_blank" style={st('color:var(--coral-soft);text-decoration:none')}>{String(v) + ' ↗'}</a>
              : String(v);
          return (
            <div key={f.k} style={f.textarea ? st('grid-column:1/-1') : undefined}>
              <div style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em')}>{f.l}</div>
              <div style={st('font-size:13.5px;margin-top:3px;display:flex;align-items:flex-start;gap:4px')}>
                <span style={st('flex:1;' + (f.textarea ? 'white-space:pre-wrap;line-height:1.55' : 'word-break:break-word'))}>{display}</span>
                {filled && f.copy ? <CopyBtn value={String(v)} css="padding:2px 6px;font-size:11px;margin-left:6px" onCopy={onCopy} /> : null}
              </div>
            </div>
          );
        })}
      </div>
    );
  }
  const arr = (c[sec.list as string] as Record<string, unknown>[]) || [];
  if (!arr.length) {
    return <div className="muted" style={st('font-size:13px;text-align:center;padding:18px 0')}>{'No ' + sec.title.toLowerCase() + ' recorded.'}</div>;
  }
  return (
    <div style={st('overflow-x:auto')}>
      <table style={st('width:100%;border-collapse:collapse;font-size:13px')}>
        <thead>
          <tr>
            {(sec.cols || []).map((col) =>
              <th key={col.k} style={st('text-align:left;padding:8px 10px;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);border-bottom:1px solid var(--panel-border)')}>{col.l}</th>)}
          </tr>
        </thead>
        <tbody>
          {arr.map((item, i) => (
            <tr key={i}>
              {(sec.cols || []).map((col) => {
                const v = item[col.k];
                const filled = v != null && String(v).trim() !== '';
                return (
                  <td key={col.k} style={st('padding:8px 10px;border-bottom:1px solid var(--panel-border);vertical-align:top')}>
                    {!filled ? <span style={st('color:var(--muted);opacity:.5')}>—</span> : String(v)}
                    {filled && col.copy ? <CopyBtn value={String(v)} css="padding:1px 5px;font-size:10px;margin-left:4px" onCopy={onCopy} /> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Edit mode ─────────────────────────────────────────────────────────────────────────────────── */

const EDIT_BOX = 'width:100%;background:var(--panel-2);border:1px solid var(--panel-border);color:var(--text);padding:8px 10px;border-radius:7px;font-size:13px';

/**
 * `infoSecEditBody()`'s `input()` — app.html:6065.
 *
 * UNCONTROLLED and keeping `data-k`: `infoCollect()` (app.html:6098) reads the whole form back out of
 * the DOM by `#info-form [data-k]`, so a field that loses that attribute saves as ABSENT — which on
 * this form is a wiped SSM number, tax number or bank account, with no error anywhere. Same contract
 * the WHT payee form's `wp_*` ids and Quick Invoice's `.qi-*` classes carry; the screen's test extracts
 * the attribute name out of `app.html` at run time so it cannot drift.
 */
function EditInput({ f, val }: { f: InfoField; val: unknown }) {
  if (f.textarea) {
    return <textarea data-k={f.k} rows={f.rows || 3} placeholder={f.ph || ''}
                     defaultValue={val == null ? '' : String(val)}
                     style={st(EDIT_BOX + ';resize:vertical;font-family:inherit')} />;
  }
  if (f.state) {
    return (
      <select data-k={f.k} defaultValue={val == null ? '' : String(val)} style={st(EDIT_BOX)}>
        <option value="">—</option>
        {MY_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  }
  return <input type={f.type || 'text'} data-k={f.k} defaultValue={val == null ? '' : String(val)} placeholder={f.ph || ''} style={st(EDIT_BOX)} />;
}

/** `infoSecEditBody()` — app.html:6063. */
function EditBody({ sec, c, docs, onRowAdd, onRowDel }: BodyProps) {
  if (sec.custom === 'docs') return <DocsBody {...docs} />;
  if (sec.fields) {
    return (
      <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px')}>
        {sec.fields.map((f) => (
          <div key={f.k} style={f.textarea ? st('grid-column:1/-1') : undefined}>
            <label style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px')}>{f.l}</label>
            <EditInput f={f} val={c[f.k]} />
          </div>
        ))}
      </div>
    );
  }
  const list = sec.list as string;
  const arr = (c[list] as Record<string, unknown>[]) || [];
  const colKeys = (sec.cols || []).map((col) => col.k);
  return (
    <>
      <div style={st('overflow-x:auto')}>
        <table style={st('width:100%;border-collapse:collapse')} data-list={list}>
          <thead>
            <tr>
              {(sec.cols || []).map((col) => <th key={col.k} style={st('text-align:left;font-size:11px;padding:6px;color:var(--muted)')}>{col.l}</th>)}
              <th style={st('width:38px')}></th>
            </tr>
          </thead>
          <tbody>
            {arr.map((it, i) => (
              <tr key={i} data-i={i}>
                {colKeys.map((k) => (
                  <td key={k} style={st('padding:4px')}>
                    <input type="text" data-sk={k} defaultValue={it[k] == null ? '' : String(it[k])}
                           style={st('width:100%;background:var(--panel-2);border:1px solid var(--panel-border);color:var(--text);padding:6px 8px;border-radius:5px;font-size:12.5px')} />
                  </td>
                ))}
                <td style={st('padding:4px;text-align:center')}>
                  <button className="btn" style={st('padding:4px 8px;font-size:11px')} onClick={() => onRowDel(list, i)}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn" style={st('margin-top:8px;font-size:12px')} onClick={() => onRowAdd(list, colKeys)}>+ Add row</button>
    </>
  );
}

/* ── The search-results panel — the golden's SECOND section ────────────────────────────────────── */

export interface SearchResultsProps {
  search: string;
  companies: InfoCompany[];
  docs: Record<string, InfoDoc[]>;
  onJumpHit: (tid: string, sectionId: string) => void;
}

/**
 * `infoRenderSearch()`'s BODY — app.html:5873. Everything written into `#info-search-results`.
 *
 * The golden's second section is this component with a blank query, which is why it is empty: the
 * legacy writes `''` and returns (app.html:5875). The populated states are pinned in the screen's test.
 * `hits.slice(0,30)` is a real CAP — a match beyond the thirtieth is not shown and nothing on screen
 * says so — and it is mirrored rather than "fixed".
 */
export function SearchResults({ search, companies, docs, onJumpHit }: SearchResultsProps) {
  if (!search.trim()) return null;
  const hits = infoSearchAll(search, companies, docs);
  if (!hits.length) {
    return <div className="muted" style={st('padding:10px 12px;font-size:13px')}>{'No matches for "' + search + '"'}</div>;
  }
  return (
    <>
      <div className="muted" style={st('padding:6px 12px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em')}>
        {hits.length + ' match' + (hits.length === 1 ? '' : 'es')}
      </div>
      {hits.slice(0, 30).map((h, i) => (
        <div key={i} style={st('padding:10px 12px;border-top:1px solid var(--panel-border);cursor:pointer;display:flex;gap:10px;align-items:center')}
             onClick={() => onJumpHit(h.tenant_id, h.section.id)}>
          <div style={st('font-size:18px')}>{h.section.icon}</div>
          <div style={st('flex:1;min-width:0')}>
            <div style={st('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em')}>{h.company + ' · ' + h.section.title}</div>
            <div style={st('font-size:13px;margin-top:2px')}><b>{h.label + ':'}</b> <span style={st('color:var(--text-soft)')}>{h.value}</span></div>
          </div>
          <div className="muted" style={st('font-size:11px')}>↪ open</div>
        </div>
      ))}
    </>
  );
}

/* ══ The screen ════════════════════════════════════════════════════════════════════════════════════ */

export interface FinanceInfoProps {
  /** `INFO_DATA` — null is the pre-response state (`spin('info')`), not "no companies". */
  companies: InfoCompany[] | null;
  /** `INFO_ACTIVE`. `infoRender()` falls back to `INFO_DATA[0]` when it does not resolve. */
  active: string | null;
  /** `INFO_EDITABLE` — `r.editable`, decided by `portal_company_info_get`. TRUE in the golden. */
  editable: boolean;
  /** `INFO_MODE`. `'edit'` only takes effect when `editable`, exactly as app.html:5939 does. */
  mode: 'view' | 'edit';
  /** `INFO_SEARCH`. */
  search: string;
  /** `INFO_DIRTY` — drives the save bar's "⚠ unsaved changes". */
  dirty: boolean;
  /** `INFO_DOCS` / `INFO_FOLDERS` / `INFO_FOLDER_ACTIVE`, keyed by tenant. */
  docs: Record<string, InfoDoc[]>;
  folders: Record<string, InfoFolder[]>;
  folderActive: Record<string, FolderId | null>;
  /** The instant `todayLocalISO()` and `inDaysLocalISO()` are read from. Never read the clock in here. */
  now: number;
  /** app.html:5523 — the server said `ok:false`. A REFUSAL; must never render as an empty screen. */
  refused: string | null;
  /** app.html:5537 — `renderInfo()`'s catch. A transport failure, not a refusal. */
  failed: string | null;

  onSearchInput: (v: string) => void;
  onSetMode: (mode: 'view' | 'edit') => void;
  onPrint: () => void;
  onSwitch: (tid: string) => void;
  onJump: (elementId: string) => void;
  onJumpHit: (tid: string, sectionId: string) => void;
  onCopy: (text: string, btn: unknown) => void;
  onFolderOpen: (fid: FolderId | null) => void;
  onFolderCreate: (parentId: FolderId | null) => void;
  onFolderDelete: (fid: FolderId) => void;
  onDocMove: (docId: FolderId, folderIdStr: string) => void;
  onDocDownload: (docId: FolderId) => void;
  onDocDelete: (docId: FolderId) => void;
  onDocUpload: () => void;
  onRowAdd: (key: string, colKeys: string[]) => void;
  onRowDel: (key: string, idx: number) => void;
  onSave: () => void;
}

/**
 * `infoRender()` — app.html:5937. Every byte written into the `#info` tab div.
 *
 * The four pre-render documents come first, in `renderInfo()`'s own order (app.html:5520-5537): a
 * refusal, a transport failure, the pre-response skeleton, and "no companies you can access yet". They
 * are four DIFFERENT documents and collapsing any pair of them turns one into another — a refusal
 * rendered as an empty screen reads as success, which is the whole point of this screen's gate.
 */
export default function FinanceInfo(p: FinanceInfoProps) {
  if (p.refused !== null) return <Refused message={p.refused} />;
  if (p.failed !== null) return <Failed message={p.failed} />;
  if (!p.companies) return <Loading />;
  if (!p.companies.length) return <NoCompanies />;

  const list = p.companies;
  const c = list.find((x) => x.tenant_id === p.active) || list[0];
  const isEdit = p.mode === 'edit' && p.editable;

  const docsProps: DocsProps = {
    c,
    docs: p.docs[c.tenant_id] || [],
    folders: p.folders[c.tenant_id] || [],
    activeFolderId: p.folderActive[c.tenant_id] || null,
    editing: isEdit,
    now: p.now,
    onFolderOpen: p.onFolderOpen,
    onFolderCreate: p.onFolderCreate,
    onFolderDelete: p.onFolderDelete,
    onDocMove: p.onDocMove,
    onDocDownload: p.onDocDownload,
    onDocDelete: p.onDocDelete,
    onDocUpload: p.onDocUpload,
  };

  return (
    <>
      {/* ── Toolbar ── app.html:5946 */}
      <div style={st('display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px')}>
        <div style={st('position:relative;flex:1;min-width:240px;max-width:520px')}>
          {/* UNCONTROLLED, keeping the legacy id: `infoSearchInput()` reads `#info-search`.value and
              `infoJump()` (app.html:5891) writes it back to ''. */}
          <input id="info-search" defaultValue={p.search}
                 onInput={(e) => p.onSearchInput((e.target as HTMLInputElement).value)}
                 placeholder="🔍 Search across all companies (e.g. EPF, SST, bank, director name)"
                 style={st('width:100%;background:var(--panel-2);border:1px solid var(--panel-border);color:var(--text);padding:9px 12px;border-radius:8px;font-size:13px')} />
        </div>
        {p.editable
          ? <button className={'btn' + (isEdit ? ' p' : '')} onClick={() => p.onSetMode(isEdit ? 'view' : 'edit')}>{isEdit ? '👁 View mode' : '✎ Edit mode'}</button>
          : null}
        <button className="btn" onClick={p.onPrint}>🖨 Print</button>
      </div>

      {/* The search-results panel. `display` mirrors `infoRenderSearch()`'s own `box.style.display`
          assignment (app.html:5875-5877), which the harness cannot record — see searchOpen(). */}
      <div id="info-search-results"
           style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:10px;margin-bottom:14px;max-height:340px;overflow-y:auto;display:' + (searchOpen(p.search) ? 'block' : 'none'))}>
        <SearchResults search={p.search} companies={list} docs={p.docs} onJumpHit={p.onJumpHit} />
      </div>

      {/* ── Company tabs ── app.html:5958 */}
      <div style={st('display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px')}>
        {list.map((x) => {
          const prog = infoCompanyProgress(x, p.docs);
          return (
            <button key={x.tenant_id} className={'btn' + (x.tenant_id === p.active ? ' p' : '')}
                    style={st('margin-right:6px;margin-bottom:6px;display:inline-flex;align-items:center;gap:8px')}
                    onClick={() => p.onSwitch(x.tenant_id)}>
              <span>{x.tenant_name}</span>
              <span style={st('font-size:10px;background:rgba(255,255,255,.08);padding:2px 6px;border-radius:6px;color:' + progressColour(prog.filled, prog.total))}>
                {prog.filled + '/' + prog.total}
              </span>
            </button>
          );
        })}
      </div>

      <div id="info-form" style={st('display:grid;grid-template-columns:240px 1fr;gap:18px;align-items:start')}>
        {/* ── Sidebar ── app.html:5972 */}
        <div id="info-nav" style={st('position:sticky;top:8px;align-self:start;background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:10px;max-height:calc(100vh - 100px);overflow-y:auto')}>
          <div style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;padding:6px 8px')}>Jump to section</div>
          {INFO_SECTIONS.map((sec) => {
            const filled = infoSectionFilled(c, sec, p.docs);
            return (
              <a key={sec.id} href={'#info-sec-' + sec.id}
                 onClick={(e: StubEvent) => { e.preventDefault?.(); p.onJump('info-sec-' + sec.id); }}
                 style={st('display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:6px;text-decoration:none;color:var(--text-soft);font-size:12.5px')}>
                <span style={st('font-size:13px;width:14px')}>{sec.icon}</span>
                <span style={st('flex:1')}>{sec.title}</span>
                {filled
                  ? <span style={st('color:var(--green-soft)')}>●</span>
                  : <span style={st('color:var(--muted);opacity:.4')}>○</span>}
              </a>
            );
          })}
        </div>

        <div>
          <h2 style={st('margin:0 0 4px;font-size:20px;letter-spacing:-.02em')}>{c.tenant_name}</h2>
          {c.updated_at
            ? <div className="muted" style={st('font-size:12px;margin-top:2px')}>
                {'Last edit: ' + String(c.updated_at).replace('T', ' ').slice(0, 16) + (c.updated_by_email ? ' · by ' + c.updated_by_email : '')}
              </div>
            : null}
          <div style={st('margin-top:14px')}>
            {/* ── Quick view ── app.html:5980 */}
            <div style={st('background:linear-gradient(135deg,rgba(255,165,89,.06),rgba(255,165,89,.02));border:1px solid rgba(255,165,89,.12);border-radius:12px;padding:14px 16px;margin-bottom:14px')}>
              <div style={st('font-size:10px;color:var(--coral-soft);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;font-weight:660')}>Quick view</div>
              <div style={st('display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px 16px')}>
                {INFO_SUMMARY_KEYS.map((k) => {
                  const v = c[k.k];
                  const filled = infoFilled(v);
                  return (
                    <div key={k.k}>
                      <div style={st('font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em')}>{k.l}</div>
                      <div style={st('font-size:13px;' + (filled ? '' : 'color:var(--muted);opacity:.5') + ';margin-top:2px;display:flex;align-items:center;gap:6px')}>
                        <span style={st('flex:1;word-break:break-all')}>{filled ? String(v) : '—'}</span>
                        {filled && k.copy ? <CopyBtn value={String(v)} css="padding:2px 6px;font-size:11px" onCopy={p.onCopy} /> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── The 19 section cards ── app.html:5996 */}
            {INFO_SECTIONS.map((sec) => {
              const filled = infoSectionFilled(c, sec, p.docs);
              const body: BodyProps = { sec, c, docs: docsProps, onCopy: p.onCopy, onRowAdd: p.onRowAdd, onRowDel: p.onRowDel };
              return (
                <div key={sec.id} id={'info-sec-' + sec.id}
                     style={st('background:var(--panel);border:1px solid var(--panel-border);border-radius:12px;padding:16px;margin-bottom:14px;scroll-margin-top:12px;transition:box-shadow .25s')}>
                  <div style={st('display:flex;align-items:center;gap:10px;margin-bottom:12px')}>
                    <div style={st('font-size:18px')}>{sec.icon}</div>
                    <h3 style={st('margin:0;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--text-soft);font-weight:660;flex:1')}>{sec.title}</h3>
                    {filled
                      ? <span className="pill pill-green" style={st('font-size:10px')}>filled</span>
                      : <span className="pill" style={st('font-size:10px;background:rgba(255,255,255,.05);color:var(--muted)')}>empty</span>}
                  </div>
                  {isEdit ? <EditBody {...body} /> : <ViewBody {...body} />}
                </div>
              );
            })}

            {/* ── Save bar ── app.html:6005 */}
            {isEdit
              ? (
                <div style={st('position:sticky;bottom:0;background:linear-gradient(180deg,transparent,var(--bg) 30%);padding:14px 0;margin-top:10px;display:flex;gap:10px;align-items:center;z-index:5')}>
                  <button className="btn p" onClick={p.onSave} id="info-save-btn">💾 Save changes</button>
                  <span className="muted" style={st('font-size:12px')} id="info-save-status">{p.dirty ? '⚠ unsaved changes' : ''}</span>
                </div>
              )
              : p.editable
                ? <div className="muted" style={st('font-size:12px;margin-top:10px')}>View mode — click <b>✎ Edit mode</b> to make changes.</div>
                : <div className="muted" style={st('font-size:12px;margin-top:10px')}>🔒 Read-only — only Admin role can edit.</div>}
          </div>
        </div>
      </div>
      <style dangerouslySetInnerHTML={{ __html: '@media(max-width:880px){#info-form{grid-template-columns:1fr!important}#info-nav{position:static!important;max-height:none!important}}' }} />
    </>
  );
}

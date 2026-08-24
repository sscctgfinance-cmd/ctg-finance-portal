// HR OS · Reimbursement — the claim FORM as a PDF, and the form+receipts merge.
//
// `hrRCBuildFormPdf()` (hros.html:1895) and `hrRCFormAndReceipts()` (hros.html:1957), ported.
//
// ── A KNOWN FORK, said out loud ─────────────────────────────────────────────────────────────────────
// Everywhere else in this repo a drawer that both halves need lives in a shared root `.js` file so it
// CANNOT fork — `hrDrawPayslip` / `hrDrawEA` / `hrDrawFormE` are all in `hr-docs.js` for exactly that
// reason, and CLAUDE.md says why. This one is not, because v225's brief forbids editing `hros.html`,
// and lifting a function means deleting it from there. So there are two copies of this drawer today.
// `web/tests/hr-expenses-pdf.test.ts` pins THIS copy against `hros.html`'s own source text — every
// coordinate, every font size, every literal — read at run time, so the two cannot drift silently.
// FOLDING IT INTO `hr-docs.js` IS THE RIGHT NEXT CHANGE and is one edit to hros.html plus one import.
//
// jsPDF and pdf-lib are INJECTED rather than imported: both are vendored classic scripts served from
// this origin (`jspdf.umd.min.js`, `pdf-lib.min.js`) and the route injects them on demand, exactly as
// `app/hr/payslip/page.tsx` injects jspdf and `app/finance/recon/page.tsx` injects xlsx. That also
// keeps this module testable without a browser.

import type { RcDetail } from './hr-expenses-detail';
import { hrDT } from './hr-profile';

/** The slice of jsPDF's document API this drawer uses. Loose on purpose — the library is untyped here. */
export interface JsPdfDoc {
  setFont(family: string, style: string): void;
  setFontSize(n: number): void;
  setTextColor(r: number, g?: number, b?: number): void;
  setDrawColor(r: number, g?: number, b?: number): void;
  text(t: string, x: number, y: number, opts?: { align?: string }): void;
  line(x1: number, y1: number, x2: number, y2: number): void;
  addPage(): void;
  addImage(data: any, fmt: string, x: number, y: number, w: number, h: number): void;
  getImageProperties(data: any): { width: number; height: number; fileType?: string };
  splitTextToSize(text: string, w: number): string[];
  output(kind: string): ArrayBuffer;
}
export type JsPdfCtor = new (o: { unit: string; format: string }) => JsPdfDoc;

/**
 * `hrRCBuildFormPdf()` — hros.html:1895, line for line.
 *
 * `companyName` is `hrCompanyName()`'s value, handed in (the legacy falls back to it when the response
 * carries no employer). Returns the PDF bytes; the download stays in the route.
 */
export function buildFormPdf(JsPDF: JsPdfCtor, d: RcDetail, companyName: string): Uint8Array {
  const c: any = d.claim || {};
  const emp: any = c.hr_employees || {};
  const items: any[] = d.items || [];
  const pay: any = d.payment || {};
  const steps: any[] = d.steps || [];
  const co: any = d.employer || {};
  const tname = co.name || companyName;

  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, m = 16;
  let y = 18;
  let hx = m;
  const hy = 15;
  if (co.logo) {
    try {
      const ip = doc.getImageProperties(co.logo);
      let lh = 15, lw = lh * (ip.width / ip.height);
      if (lw > 34) { lw = 34; lh = lw * (ip.height / ip.width); }
      doc.addImage(co.logo, /jpe?g/i.test(ip.fileType || '') ? 'JPEG' : 'PNG', hx, hy - 4, lw, lh);
      hx = m + lw + 6;
    } catch { /* the legacy swallows a bad logo too — the form still has to print */ }
  }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(String(tname || ''), hx, hy + 1);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(95, 95, 95);
  const hl: string[] = [], hm: string[] = [];
  if (co.reg_no) hm.push('Reg No: ' + co.reg_no);
  if (co.employer_no) hm.push('Employer No: ' + co.employer_no);
  if (hm.length) hl.push(hm.join('   ·   '));
  if (co.address) hl.push(String(co.address).replace(/\s*\n\s*/g, ', '));
  const hc: string[] = [];
  if (co.phone) hc.push('Tel: ' + co.phone);
  if (co.email) hc.push(co.email);
  if (hc.length) hl.push(hc.join('   ·   '));
  let hyy = hy + 5.4;
  hl.forEach((t) => {
    const ln = doc.splitTextToSize(String(t), W - hx - m);
    for (let i = 0; i < Math.min(ln.length, 2); i++) { doc.text(ln[i], hx, hyy); hyy += 3.5; }
  });
  const htop = Math.max(hyy + 1, hy + 13);
  doc.setDrawColor(185); doc.line(m, htop, W - m, htop);
  doc.setTextColor(20, 20, 20); y = htop + 8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Reimbursement Claim Form', m, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Claim No: ' + (c.claim_no || ''), W - m, y - 4, { align: 'right' });
  doc.text('Date: ' + String(c.claim_date || '').slice(0, 10), W - m, y + 1, { align: 'right' });
  y += 9;
  const row = (l: string, v: unknown) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(l, m, y);
    doc.setFont('helvetica', 'normal'); doc.text(String(v || '—'), m + 40, y); y += 6.2;
  };
  row('Employee', (emp.name || '') + '  (' + (emp.emp_no || '') + ')');
  row('Department', emp.dept || '—');
  row('Status', c.status || '');
  row('Bank', (emp.bank_name || '') + '  ' + (emp.bank_account || ''));
  y += 3;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text('Type', m, y); doc.text('Date', m + 52, y); doc.text('Description', m + 80, y);
  doc.text('Amount (RM)', W - m, y, { align: 'right' });
  y += 1.5; doc.setDrawColor(150); doc.line(m, y, W - m, y); y += 5; doc.setFont('helvetica', 'normal');
  const list = items.length
    ? items.map((it) => ({ type: (it.hr_claim_types && it.hr_claim_types.name) || '', date: String(it.item_date || '').slice(0, 10), desc: it.description || '', amt: Number(it.amount) || 0 }))
    : [{ type: '', date: String(c.claim_date || '').slice(0, 10), desc: c.description || '', amt: Number(c.amount) || 0 }];
  list.forEach((r) => {
    if (y > 270) { doc.addPage(); y = 20; }
    doc.text(String(r.type).slice(0, 24), m, y);
    doc.text(r.date, m + 52, y);
    const dsc = doc.splitTextToSize(String(r.desc || ''), 58);
    doc.text(dsc[0] || '', m + 80, y);
    doc.text(r.amt.toFixed(2), W - m, y, { align: 'right' });
    y += 6;
  });
  doc.setDrawColor(150); doc.line(m, y - 2, W - m, y - 2);
  doc.setFont('helvetica', 'bold'); doc.text('TOTAL', m + 80, y + 3);
  // The stored HEADER amount, never a re-sum of the rows — see hr-expenses-detail.tsx's ItemsPanel.
  doc.text((Number(c.amount) || 0).toFixed(2), W - m, y + 3, { align: 'right' });
  y += 12;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  if (pay && pay.paid_date) {
    doc.text('Paid on ' + pay.paid_date + ' · ' + (pay.payment_method || '') + (pay.payment_reference ? ' · ref ' + pay.payment_reference : ''), m, y);
    y += 6;
  }
  if (c.xero_bill_id) { doc.text('Posted to Xero · ref ' + (c.xero_reference || c.claim_no || ''), m, y); y += 6; }
  if (steps && steps.length) {
    y += 2; doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text('Approval', m, y);
    y += 5; doc.setFont('helvetica', 'normal'); doc.setFontSize(8.8);
    steps.forEach((s) => {
      if (y > 276) { doc.addPage(); y = 20; }
      let ln = (s.step_order) + '. ' + (s.name || s.approver_role || '');
      if (s.decision === 'approve') ln += ' — Approved' + (s.acted_by_name ? ' by ' + s.acted_by_name : '') + (s.acted_at ? ' on ' + hrDT(s.acted_at) : '');
      else if (s.decision === 'reject') ln += ' — Rejected' + (s.acted_by_name ? ' by ' + s.acted_by_name : '');
      else ln += ' — ' + (s.status || 'Pending') + (s.assignee_name ? ' (' + s.assignee_name + ')' : '');
      doc.text(doc.splitTextToSize(ln, W - 2 * m)[0], m, y);
      y += 5;
    });
  }
  // Signature block — hros.html:1938. Each column: the signature image (if saved) on the line, the
  // label, then who and when, so the form is an auditable record when nobody has uploaded one.
  if (y < 244) y = 254; else if (y > 268) { doc.addPage(); y = 254; }
  let appr: any = null;
  for (let si = steps.length - 1; si >= 0; si--) { if (steps[si].decision === 'approve') { appr = steps[si]; break; } }
  const paid = (pay && pay.paid_date) ? ('Paid ' + pay.paid_date + (pay.payment_method ? ' · ' + pay.payment_method : '')) : '';
  const cols: { lbl: string; sig: any; who: string; when: string; ref?: string }[] = [
    { lbl: 'Prepared by', sig: d.signer_sig || null, who: emp.name || '', when: (c.submitted_at || c.claim_date) ? ('Submitted ' + String(c.submitted_at || c.claim_date).slice(0, 10)) : '' },
    { lbl: 'Approved by', sig: (appr && appr.acted_by_name_sig) || null, who: (appr && appr.acted_by_name) || '', when: (appr && appr.acted_at) ? ('Approved ' + hrDT(appr.acted_at)) : '' },
    { lbl: 'Received by', sig: null, who: '', when: paid, ref: (pay && pay.payment_reference) ? ('ref ' + pay.payment_reference) : '' },
  ];
  const sx = [m, W / 2 - 12, W - m - 46];
  cols.forEach((col, i) => {
    if (col.sig) {
      try {
        const ip = doc.getImageProperties(col.sig);
        let sh = 13, sw = sh * (ip.width / ip.height);
        if (sw > 42) { sw = 42; sh = sw * (ip.height / ip.width); }
        doc.addImage(col.sig, /jpe?g/i.test(ip.fileType || '') ? 'JPEG' : 'PNG', sx[i], y - sh - 0.8, sw, sh);
      } catch { /* as the legacy does */ }
    }
    doc.setDrawColor(80); doc.line(sx[i], y, sx[i] + 44, y);
    doc.setTextColor(20, 20, 20); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.6); doc.text(col.lbl, sx[i], y + 4.4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.6); doc.setTextColor(95, 95, 95);
    let yy = y + 8.2;
    if (col.who) { doc.text(doc.splitTextToSize(String(col.who), 44)[0] || '', sx[i], yy); yy += 3.4; }
    if (col.when) { doc.text(doc.splitTextToSize(String(col.when), 44)[0] || '', sx[i], yy); yy += 3.4; }
    if (col.ref) { doc.text(doc.splitTextToSize(String(col.ref), 44)[0] || '', sx[i], yy); }
  });
  doc.setTextColor(20, 20, 20);
  return new Uint8Array(doc.output('arraybuffer'));
}

/** `link.download` — hros.html:1983. Slugged, because a claim number can hold a slash. */
export const mergedFileName = (claimNo?: string | null): string =>
  'Reimbursement_' + String(claimNo || 'claim').replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf';

/** `hrRCFormAndReceipts()`'s toast — hros.html:1985, the exact wording, as a pure function. */
export function mergeToast(added: number, failed: number): string {
  return added
    ? 'Form + ' + added + ' receipt' + (added === 1 ? '' : 's') + ' merged ✓' + (failed ? ' · ' + failed + ' couldn’t be read' : '')
    : 'Form generated ✓ (no receipts attached)';
}

/**
 * `hrRCFormAndReceipts()`'s merge — hros.html:1961-1982. The form's pages first, then EVERY attachment
 * in the order `hr_rc_get` returned them: a PDF's pages are copied, anything else is embedded as one
 * A4 page, centred and scaled DOWN only (`Math.min(..., 1)` — an upscaled receipt is unreadable).
 *
 * `fetchFn` and `PDFLib` are injected so this is drivable without a browser; the blob, the download and
 * the toast stay in the route.
 */
export async function mergeFormAndReceipts(o: {
  PDFLib: any;
  formPdf: Uint8Array;
  attachments: { url?: string | null; file_name?: string | null }[];
  fetchFn: typeof fetch;
}): Promise<{ bytes: Uint8Array; added: number; failed: number }> {
  const PDFLib = o.PDFLib;
  const merged = await PDFLib.PDFDocument.create();
  const formDoc = await PDFLib.PDFDocument.load(o.formPdf);
  (await merged.copyPages(formDoc, formDoc.getPageIndices())).forEach((p: any) => { merged.addPage(p); });
  const atts = o.attachments.filter((a) => a.url);
  let added = 0, failed = 0;
  for (const a of atts) {
    try {
      const resp = await o.fetchFn(a.url as string);
      const buf = new Uint8Array(await resp.arrayBuffer());
      const name = String(a.file_name || '').toLowerCase();
      const mime = (resp.headers.get('content-type') || '').toLowerCase();
      if (name.endsWith('.pdf') || mime.indexOf('pdf') >= 0) {
        const src = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
        (await merged.copyPages(src, src.getPageIndices())).forEach((p: any) => { merged.addPage(p); });
      } else {
        const img = (name.endsWith('.png') || mime.indexOf('png') >= 0) ? await merged.embedPng(buf) : await merged.embedJpg(buf);
        const pg = merged.addPage([595.28, 841.89]);
        const maxW = 595.28 - 40, maxH = 841.89 - 40;
        const sc = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * sc, h = img.height * sc;
        pg.drawImage(img, { x: (595.28 - w) / 2, y: (841.89 - h) / 2, width: w, height: h });
      }
      added++;
    } catch { failed++; }
  }
  return { bytes: await merged.save(), added, failed };
}

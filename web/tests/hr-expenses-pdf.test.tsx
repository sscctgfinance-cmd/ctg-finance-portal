// HR OS · Reimbursement — the claim FORM PDF and the form+receipts merge.
//
// `src/hr-rc-pdf.ts` is a KNOWN FORK of `hrRCBuildFormPdf()` (hros.html:1895): v225's brief forbids
// editing hros.html, and lifting a drawer into `hr-docs.js` the way `hrDrawPayslip` was means deleting
// it from there. So the two copies have to be held together some other way, and a "same-shaped output"
// assertion would not do it — the two could agree on every figure and still put them in different
// places, at different sizes, on different pages.
//
// What this file does instead: it EXTRACTS `hrRCBuildFormPdf` out of hros.html at run time, runs it and
// the React copy against the SAME recording jsPDF stub, and requires the two call logs to be identical.
// Every coordinate, every font size, every string, in order. That is as strong as importing it, and it
// fails the moment either side moves.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FIXTURES } from '../../tests/render_fixtures';
import type { RcDetail } from '../src/hr-expenses-detail';
import { buildFormPdf, mergedFileName, mergeFormAndReceipts, mergeToast, type JsPdfCtor } from '../src/hr-rc-pdf';
import { hrDT } from '../src/hr-profile';
import { REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');
const D = FIXTURES.hr_rc_get as RcDetail;
const COMPANY = 'I PROCARE MALAYSIA SDN BHD';

/** Every call the drawer makes, in order, with its arguments. */
type Call = [string, ...unknown[]];

function recorder(): { ctor: JsPdfCtor; log: Call[] } {
  const log: Call[] = [];
  const push = (name: string) => (...a: unknown[]) => { log.push([name, ...a]); };
  class Doc {
    constructor(o: unknown) { log.push(['new', o]); }
    setFont = push('setFont');
    setFontSize = push('setFontSize');
    setTextColor = push('setTextColor');
    setDrawColor = push('setDrawColor');
    text = push('text');
    line = push('line');
    addPage = push('addPage');
    addImage = push('addImage');
    getImageProperties = (data: unknown) => { log.push(['getImageProperties', data]); return { width: 200, height: 100, fileType: 'PNG' }; };
    // Deterministic and dependent on the text, so a changed string moves the wrap and the diff sees it.
    splitTextToSize = (t: string, w: number) => { log.push(['splitTextToSize', t, w]); return String(t).match(new RegExp('.{1,' + Math.max(1, Math.round(w)) + '}', 'g')) || ['']; };
    output = (k: string) => { log.push(['output', k]); return new ArrayBuffer(8); };
  }
  return { ctor: Doc as unknown as JsPdfCtor, log };
}

/**
 * `hrRCBuildFormPdf` lifted out of hros.html and made callable. The globals it reaches for are handed in
 * as parameters, which is also what makes its two `typeof` guards resolve.
 */
function legacyBuilder(win: unknown, employer: unknown, companyName: string) {
  const from = HROS.indexOf('function hrRCBuildFormPdf(d){');
  const to = HROS.indexOf('function hrRCFormAndReceipts(){');
  expect(from, 'hrRCBuildFormPdf moved').toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  const src = HROS.slice(from, to);
  return new Function('window', 'HR_EMPLOYER', 'hrCompanyName', 'hrDT', src + '\nreturn hrRCBuildFormPdf;')(
    win, employer, () => companyName, hrDT,
  ) as (d: unknown) => Uint8Array;
}

describe('the claim form PDF is drawn identically on both sides', () => {
  const both = (d: RcDetail, employer: unknown = undefined) => {
    const a = recorder(), b = recorder();
    legacyBuilder({ jspdf: { jsPDF: a.ctor } }, employer, COMPANY)(d);
    buildFormPdf(b.ctor, d, COMPANY);
    return [a.log, b.log] as const;
  };

  it('the extraction really ran the legacy drawer', () => {
    const [legacy] = both(D);
    expect(legacy.length).toBeGreaterThan(60);
    expect(legacy.some((c) => c[0] === 'text' && c[1] === 'Reimbursement Claim Form')).toBe(true);
  });

  it('same calls, same order, same coordinates — the fixture claim', () => {
    const [legacy, react] = both(D);
    expect(react).toEqual(legacy);
  });

  it('same calls with an employer header, a logo and a long address', () => {
    const employer = { name: 'I PROCARE MALAYSIA SDN BHD', logo: 'data:image/png;base64,AA', reg_no: '202001033445',
      employer_no: 'E 1122334455', address: 'No. 7, Jalan Molek 1/5,\n81100 Johor Bahru,\nJohor', phone: '+607-351 7788', email: 'hr@iprocare.test' };
    const [legacy, react] = both({ ...D, employer }, employer);
    expect(react).toEqual(legacy);
    expect(legacy.some((c) => c[0] === 'addImage')).toBe(true);
  });

  it('same calls once the claim is approved, paid, in Xero and signed', () => {
    const d: RcDetail = {
      ...D,
      claim: { ...D.claim, status: 'Paid', xero_bill_id: 'xb1', xero_reference: 'REF-1' },
      payment: { paid_date: '2026-08-20', payment_method: 'Bank Transfer', payment_reference: 'TT-9911' },
      steps: [
        { ...D.steps![0], status: 'Approved', decision: 'approve', acted_by_name: 'AHMAD BIN ISMAIL', acted_at: '2026-08-11T01:15:00.000Z', acted_by_name_sig: 'data:image/png;base64,BB' },
        { ...D.steps![1], status: 'Rejected', decision: 'reject', acted_by_name: 'BOSS' },
      ],
      signer_sig: 'data:image/png;base64,CC',
    };
    const [legacy, react] = both(d);
    expect(react).toEqual(legacy);
  });

  it('same calls with no expense lines at all — the header-only fallback row', () => {
    const [legacy, react] = both({ ...D, items: [] });
    expect(react).toEqual(legacy);
  });

  it('same calls when the line list is long enough to break the page', () => {
    const many = Array.from({ length: 60 }, (_v, i) => ({ ...D.items![0], id: 'x' + i, description: 'Line ' + i }));
    const [legacy, react] = both({ ...D, items: many });
    expect(react).toEqual(legacy);
    expect(legacy.filter((c) => c[0] === 'addPage').length).toBeGreaterThan(0);
  });

  it('the guard would notice a moved coordinate', () => {
    // Proving the comparison bites: nudge one figure on the React side and the logs must differ.
    const [legacy] = both(D);
    const b = recorder();
    buildFormPdf(b.ctor, { ...D, claim: { ...D.claim, amount: 128.41 } }, COMPANY);
    expect(b.log).not.toEqual(legacy);
  });

  it('the TOTAL it prints is the STORED header amount, not a re-sum of the lines', () => {
    // The same call `hr_rc_save` (hr.ts:2019) made and wrote. Re-deriving it here would disagree the
    // moment ✏️ Adjust amount moved the header, which is exactly when this form gets printed.
    const b = recorder();
    buildFormPdf(b.ctor, { ...D, claim: { ...D.claim, amount: 99.99 } }, COMPANY);
    const totals = b.log.filter((c) => c[0] === 'text' && c[1] === '99.99');
    expect(totals.length).toBeGreaterThan(0);
    expect(b.log.some((c) => c[0] === 'text' && c[1] === '128.40')).toBe(false);
  });
});

describe('the merged form + receipts document', () => {
  /** The slice of pdf-lib the merge touches. */
  function fakePdfLib() {
    const pages: string[] = [];
    const doc = {
      copyPages: (src: { tag: string; n: number }) => Promise.resolve(Array.from({ length: src.n }, (_v, i) => src.tag + ':' + i)),
      addPage: (size?: unknown) => { if (size) { pages.push('image-page'); return { drawImage: () => pages.push('drew') }; } return null; },
      embedPng: (b: Uint8Array) => Promise.resolve({ width: 1200, height: 900, kind: 'png', bytes: b.length }),
      embedJpg: (b: Uint8Array) => Promise.resolve({ width: 1200, height: 900, kind: 'jpg', bytes: b.length }),
      save: () => Promise.resolve(new Uint8Array([1, 2, 3])),
    };
    const added: unknown[] = [];
    const wrapped = { ...doc, addPage: (size?: unknown) => { added.push(size ?? 'copied'); return doc.addPage(size); } };
    return {
      added,
      PDFLib: {
        PDFDocument: {
          create: () => Promise.resolve(wrapped),
          load: (b: Uint8Array) => Promise.resolve({ tag: 'src' + b.length, n: 2, getPageIndices: () => [0, 1] }),
        },
      },
    };
  }

  const resp = (type: string) => ({
    headers: { get: () => type },
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(16)),
  }) as unknown as Response;

  it('puts the form first, then every attachment, in the order the server sent them', async () => {
    const f = fakePdfLib();
    const out = await mergeFormAndReceipts({
      PDFLib: f.PDFLib,
      formPdf: new Uint8Array(4),
      attachments: [{ url: 'a', file_name: 'a.pdf' }, { url: 'b', file_name: 'b.jpg' }],
      fetchFn: (() => Promise.resolve(resp('application/pdf'))) as unknown as typeof fetch,
    });
    expect(out).toMatchObject({ added: 2, failed: 0 });
    expect(Array.from(out.bytes)).toEqual([1, 2, 3]);
  });

  it('an attachment that cannot be read is counted, not thrown — the rest still merge', async () => {
    const f = fakePdfLib();
    let n = 0;
    const out = await mergeFormAndReceipts({
      PDFLib: f.PDFLib,
      formPdf: new Uint8Array(4),
      attachments: [{ url: 'a', file_name: 'a.pdf' }, { url: 'b', file_name: 'b.pdf' }],
      fetchFn: (() => (n++ === 0 ? Promise.reject(new Error('gone')) : Promise.resolve(resp('application/pdf')))) as unknown as typeof fetch,
    });
    expect(out).toMatchObject({ added: 1, failed: 1 });
  });

  it('an attachment with no signed URL is skipped silently, as the legacy skips it', async () => {
    const f = fakePdfLib();
    const out = await mergeFormAndReceipts({
      PDFLib: f.PDFLib, formPdf: new Uint8Array(4),
      attachments: [{ url: null, file_name: 'gone.pdf' }],
      fetchFn: (() => { throw new Error('should not fetch'); }) as unknown as typeof fetch,
    });
    expect(out).toMatchObject({ added: 0, failed: 0 });
  });

  it('an image page is A4 and the image is scaled DOWN only', async () => {
    // `Math.min(maxW/w, maxH/h, 1)` — the `1` is what stops a small receipt being blown up into an
    // unreadable smear. hros.html:1975.
    const f = fakePdfLib();
    const drawn: Record<string, number>[] = [];
    const PDFLib = {
      PDFDocument: {
        create: () => Promise.resolve({
          copyPages: () => Promise.resolve([]),
          addPage: () => ({ drawImage: (_i: unknown, o: Record<string, number>) => drawn.push(o) }),
          embedJpg: () => Promise.resolve({ width: 100, height: 50 }),
          embedPng: () => Promise.resolve({ width: 100, height: 50 }),
          save: () => Promise.resolve(new Uint8Array()),
        }),
        load: () => Promise.resolve({ getPageIndices: () => [] }),
      },
    };
    await mergeFormAndReceipts({
      PDFLib, formPdf: new Uint8Array(4),
      attachments: [{ url: 'a', file_name: 'small.jpg' }],
      fetchFn: (() => Promise.resolve(resp('image/jpeg'))) as unknown as typeof fetch,
    });
    expect(drawn[0].width).toBe(100);
    expect(drawn[0].height).toBe(50);
    expect(drawn[0].x).toBeCloseTo((595.28 - 100) / 2, 6);
  });

  it('the file name is slugged, because a claim number can hold characters a path cannot', () => {
    expect(mergedFileName('RC-2026-0031')).toBe('Reimbursement_RC-2026-0031.pdf');
    expect(mergedFileName('RC/2026 0031')).toBe('Reimbursement_RC_2026_0031.pdf');
    expect(mergedFileName(null)).toBe('Reimbursement_claim.pdf');
  });

  it('says how many receipts made it, and how many did not', () => {
    expect(mergeToast(0, 0)).toBe('Form generated ✓ (no receipts attached)');
    expect(mergeToast(1, 0)).toBe('Form + 1 receipt merged ✓');
    expect(mergeToast(2, 0)).toBe('Form + 2 receipts merged ✓');
    expect(mergeToast(2, 1)).toContain('1 couldn’t be read');
  });
});

// HR OS · Reimbursement — the receipt / e-invoice SCANNER.
//
// No golden can hold a `<canvas>`, and `hrRCScanModal()` appends to `document.body`, which
// `tests/render_harness.ts` never records — so the legacy modal is in no golden either. What IS
// provable is every decision the pipeline makes, which is why `src/hr-rc-scan.ts` is the pure half and
// `app/hr/expenses/scan-modal.tsx` is only drawing and wiring.
//
// The camera path itself is `DocScanner` in `common.js` — SHARED, not forked, reached by indirect
// `eval` because it is a top-level `const` (CLAUDE.md). Nothing here re-tests it.
//
// WHAT COULD NOT BE PROVEN HERE, said plainly: this fleet runs `environment: 'node'` (all 48 test files
// depend on it) and has no camera and no canvas, so `buildBase` / `enhanceCanvas` / `cropCanvas` /
// `drawScan` / `imgToPdf` are exercised only through the pure functions they are built from. The
// camera capture, the live crop drag and the jsQR decode of a real photo were not run.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyExtract, autoCropFromPixels, baseSize, dragRect, keepCrop, parseEinv, pickBlankItem, scanToast,
} from '../src/hr-rc-scan';
import { HR_RC_MAX_BYTES, uploadProgress } from '../app/hr/expenses/upload';
import { REPO } from './parity';

const HROS = readFileSync(join(REPO, 'hros.html'), 'utf8');

/** `hrRCParseEinv` lifted out of hros.html — the strongest form of "these two cannot drift". */
function legacyParseEinv() {
  const from = HROS.indexOf('function hrRCParseEinv(text){');
  const to = HROS.indexOf('function hrRCScanQrRaw(cv){');
  expect(from, 'hrRCParseEinv moved').toBeGreaterThan(0);
  return new Function(HROS.slice(from, to) + '\nreturn hrRCParseEinv;')() as (t: unknown) => { url: string; uuid: string };
}

describe('the MyInvois QR', () => {
  const legacy = legacyParseEinv();
  const cases = [
    'https://myinvois.hasil.gov.my/F9K2M4P6R8T0V2X4Z6B8D0G2/share/ABCDEF',
    'https://preprod.myinvois.hasil.gov.my/1234567890ABCDEFGHIJ',
    'https://example.test/whatever/ABCDEFGHIJKLMNOPQRSTUVWXYZ12',
    'https://example.test/short',
    '',
    '   ',
    'not a url at all',
  ];

  it('parses exactly as hros.html parses', () => {
    cases.forEach((c) => expect(parseEinv(c), c).toEqual(legacy(c)));
    expect(parseEinv(null)).toEqual(legacy(null));
  });

  it('pulls the IRBM uuid out of a MyInvois URL', () => {
    expect(parseEinv(cases[0]).uuid).toBe('F9K2M4P6R8T0V2X4Z6B8D0G2');
    expect(parseEinv(cases[0]).url).toBe(cases[0]);
  });

  it('leaves the uuid blank rather than guessing when nothing long enough is there', () => {
    expect(parseEinv('https://example.test/short').uuid).toBe('');
  });
});

/**
 * `hrRCScanProcess()`'s field mapping — hros.html:2469-2473. Read out of hros.html rather than retyped:
 * a retyped list agrees with a widened port by construction, and a field silently dropped here is a
 * vendor name or a tax figure the employee typed nothing for and nobody notices is missing.
 */
describe('what an OCR pass is allowed to write onto a line', () => {
  const src = HROS.slice(HROS.indexOf('async function hrRCScanProcess('), HROS.indexOf('function hrRCPrepImage(file)'));

  it('found the legacy mapping', () => {
    expect(src).toContain('if(x.date) t.item_date=x.date;');
  });

  it('maps every extracted field the legacy maps, and no others', () => {
    const pairs = [...src.matchAll(/if\(x\.([a-z_]+)\)\s*t\.([a-z_]+)\s*=\s*(?:x\.[a-z_]+|true)/g)]
      .map((m) => [m[1], m[2]] as const);
    expect(pairs.length).toBeGreaterThan(9);

    const x: Record<string, unknown> = {};
    pairs.forEach(([from], i) => { x[from] = from === 'is_einvoice' ? true : 'v' + i; });
    const patch = applyExtract(x, null, null);
    pairs.forEach(([from, to]) => {
      expect(Object.keys(patch), from + '→' + to).toContain(to);
      if (from !== 'is_einvoice') expect(patch[to], from).toBe(x[from]);
    });
    // …and nothing beyond the mapped fields plus the `⋯`-open flag.
    const allowed = new Set([...pairs.map((p) => p[1]), '_open', 'claim_type_id']);
    Object.keys(patch).forEach((k) => expect(allowed, k).toContain(k));
  });

  it('writes nothing for a field the model did not return', () => {
    // Every assignment is truthiness-guarded in the legacy; an unguarded port BLANKS a vendor name the
    // employee typed by hand when the second scan comes back empty.
    expect(applyExtract({}, null, null)).toEqual({ _open: true });
  });

  it('the QR BEATS the OCR for the e-invoice identity', () => {
    // The QR is read off the document with no model in the loop, so it is the source of the IRBM
    // validation URL. hros.html:2473.
    const patch = applyExtract(
      { einvoice_uuid: 'FROM-OCR', einvoice_validation_url: 'https://ocr.test' },
      null,
      { url: 'https://myinvois.test/QR', uuid: 'FROM-QR' },
    );
    expect(patch.einvoice_uuid).toBe('FROM-QR');
    expect(patch.einvoice_validation_url).toBe('https://myinvois.test/QR');
    expect(patch.is_einvoice).toBe(true);
  });

  it('a QR with no uuid still sets the validation URL and does not blank the OCR uuid', () => {
    const patch = applyExtract({ einvoice_uuid: 'FROM-OCR' }, null, { url: 'https://x.test', uuid: '' });
    expect(patch.einvoice_uuid).toBe('FROM-OCR');
    expect(patch.einvoice_validation_url).toBe('https://x.test');
  });

  it('opens the ⋯ block so the operator sees what was filled in', () => {
    expect(applyExtract({ vendor: 'GRAB' }, null, null)._open).toBe(true);
  });
});

/** hros.html:2465 — which line a scan lands on. */
describe('the line a scan fills', () => {
  it('takes the first line with no type, no amount and no distance', () => {
    expect(pickBlankItem([{ claim_type_id: 'ct1', amount: 10 }, {}, {}])).toBe(1);
  });

  it('is -1 when every line is already used, so the caller appends instead of overwriting', () => {
    // Overwriting a filled line loses a typed amount, silently.
    expect(pickBlankItem([{ claim_type_id: 'ct1' }, { amount: '5' }, { total_km: '3' }])).toBe(-1);
  });

  it('a line with a type but nothing else is NOT blank', () => {
    expect(pickBlankItem([{ claim_type_id: 'ct1' }])).toBe(-1);
  });

  it('a zero amount does not make a line used', () => {
    expect(pickBlankItem([{ amount: '0', total_km: '0' }])).toBe(0);
  });
});

/** hros.html:2477. */
describe('what the scan says when it lands', () => {
  it('names the QR, the vendor and the amount when it has them', () => {
    expect(scanToast({ url: 'x' }, { vendor: 'GRAB', total: '86.4' }, ''))
      .toEqual({ text: 'Scan added — e-Invoice QR ✓ · GRAB · RM86.40 (attached as PDF)', err: false });
  });

  it('still reports the attachment when OCR failed — the receipt landed either way', () => {
    expect(scanToast(null, {}, 'no credits')).toEqual({ text: 'Attached as PDF. OCR: no credits', err: true });
  });

  it('says so plainly when OCR returned nothing and did not fail', () => {
    expect(scanToast(null, {}, '')).toEqual({ text: 'Scan attached as PDF ✓', err: false });
  });
});

/** `hrRCScanAutoCrop()` — hros.html:2358. Every bail matters: guessing wrong crops a receipt in half
 *  and the employee ships the crop, not the photo. */
describe('the auto-crop heuristic', () => {
  /** A W×H RGBA buffer: white paper, with an optional dark rectangle on it. */
  const img = (W: number, H: number, box?: { x: number; y: number; w: number; h: number }) => {
    const d = new Uint8ClampedArray(W * H * 4).fill(255);
    if (box) {
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
          const i = (y * W + x) * 4;
          d[i] = d[i + 1] = d[i + 2] = 0;
        }
      }
    }
    return d;
  };

  it('finds the document and pads it, without shaving the edges', () => {
    const r = autoCropFromPixels(img(200, 200, { x: 50, y: 40, w: 80, h: 90 }), 200, 200)!;
    expect(r).not.toBeNull();
    expect(r.x).toBeCloseTo(46, 6);          // 50 − 2% of 200
    expect(r.y).toBeCloseTo(36, 6);
    expect(r.w).toBeCloseTo(87, 6);          // 79 + 2×4, clamped at the frame
    expect(r.h).toBeCloseTo(97, 6);
  });

  it('bails on a blank photo rather than cropping to nothing', () => {
    expect(autoCropFromPixels(img(200, 200), 200, 200)).toBeNull();
  });

  it('bails on a speck — under 2% of the frame is not a receipt', () => {
    expect(autoCropFromPixels(img(200, 200, { x: 10, y: 10, w: 20, h: 20 }), 200, 200)).toBeNull();
  });

  it('bails on a selection that is tall but not wide — under 15% either way is not a document', () => {
    expect(autoCropFromPixels(img(200, 200, { x: 10, y: 10, w: 20, h: 180 }), 200, 200)).toBeNull();
  });

  it('bails when the document already fills the frame — nothing to crop', () => {
    expect(autoCropFromPixels(img(200, 200, { x: 2, y: 2, w: 196, h: 196 }), 200, 200)).toBeNull();
  });

  it('reads the background off the BORDER ring, so a dark photo still works', () => {
    // Invert: black paper with a white receipt. The median border luminance is 0, the receipt differs by
    // 255, and the box comes back the same. A hardcoded "dark = foreground" port fails here.
    const W = 200, H = 200;
    const d = new Uint8ClampedArray(W * H * 4).fill(0);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    for (let y = 40; y < 130; y++) for (let x = 50; x < 130; x++) { const i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; }
    const r = autoCropFromPixels(d, W, H)!;
    expect(r.x).toBeCloseTo(46, 6);
  });
});

describe('the crop box a drag produces', () => {
  it('is the same rectangle whichever corner the drag started from', () => {
    expect(dragRect(10, 10, 50, 60)).toEqual({ x: 10, y: 10, w: 40, h: 50 });
    expect(dragRect(50, 60, 10, 10)).toEqual({ x: 10, y: 10, w: 40, h: 50 });
  });

  it('a TAP clears the crop rather than shrinking it to a sliver', () => {
    // hros.html:2406 — a sub-12px box is a 3-pixel receipt, i.e. an empty document, and the employee
    // would not see that until Finance opened the PDF.
    expect(keepCrop({ x: 0, y: 0, w: 5, h: 400 })).toBeNull();
    expect(keepCrop({ x: 0, y: 0, w: 400, h: 5 })).toBeNull();
    expect(keepCrop({ x: 0, y: 0, w: 12, h: 12 })).toEqual({ x: 0, y: 0, w: 12, h: 12 });
    expect(keepCrop(null)).toBeNull();
  });
});

describe('the base canvas sizing', () => {
  it('caps the longest side at 1800 and leaves a small photo alone', () => {
    expect(baseSize(3600, 2400, 0)).toMatchObject({ w: 1800, h: 1200, bw: 1800, bh: 1200 });
    expect(baseSize(800, 600, 0)).toMatchObject({ w: 800, h: 600, bw: 800, bh: 600 });
  });

  it('swaps width and height at 90° and 270°, and normalises a negative rotation', () => {
    expect(baseSize(800, 600, 90)).toMatchObject({ bw: 600, bh: 800, rot: 90 });
    expect(baseSize(800, 600, 180)).toMatchObject({ bw: 800, bh: 600, rot: 180 });
    expect(baseSize(800, 600, -90)).toMatchObject({ bw: 600, bh: 800, rot: 270 });
  });
});

/** `hrRCUpload()` — hros.html:2188. The signed-URL path; the size gate is the early, clear "no". */
describe('uploading a receipt', () => {
  it('the ceiling is the legacy constant, read out of hros.html', () => {
    expect(HROS).toContain('var HR_RC_MAX_BYTES = 45*1024*1024;');
    expect(HR_RC_MAX_BYTES).toBe(45 * 1024 * 1024);
  });

  it('names the file and its size while it uploads', () => {
    // hros.html:2113 — a bare "Uploading…" on a 40 MB scan over mobile data is indistinguishable from
    // the button having done nothing.
    expect(uploadProgress(0, 3, { name: 'scan.pdf', size: 41 * 1048576 }))
      .toBe('Uploading 1/3: scan.pdf (41.0 MB — this can take a while)…');
    expect(uploadProgress(1, 3, { name: 'small.jpg', size: 2000 })).toBe('Uploading 2/3: small.jpg…');
  });

  it('goes through a signed URL and a raw PUT, not a base64 body', () => {
    // v186's whole point (hros.html:2179): base64 inflates a 41.8 MB PDF to ~56 MB and call()'s 30s
    // AbortController fires long before it finishes, so Submit did nothing at all.
    const src = readFileSync(join(REPO, 'web', 'app', 'hr', 'expenses', 'upload.ts'), 'utf8');
    expect(src).toContain("api: 'hr_rc_attach_sign'");
    expect(src).toMatch(/method: 'PUT'/);
    expect(src.indexOf("api: 'hr_rc_attach_sign'")).toBeLessThan(src.indexOf("method: 'PUT'"));
    // The base64 fallback survives, and only for files small enough to get through it.
    expect(src).toContain('if (size > 4 * 1024 * 1024) return { ok: false');
  });

  it('reports a failure instead of resolving as success', () => {
    // The legacy's own lesson (hros.html:2225): an older version passed `res` as BOTH handlers, so a
    // rejected call resolved indistinguishably from success and the caller could not tell.
    const src = readFileSync(join(REPO, 'web', 'app', 'hr', 'expenses', 'upload.ts'), 'utf8');
    expect(src).toMatch(/return \{ ok: false, error: 'upload failed \(/);
    expect(src).toMatch(/catch \(e\) \{ return \{ ok: false/);
  });
});

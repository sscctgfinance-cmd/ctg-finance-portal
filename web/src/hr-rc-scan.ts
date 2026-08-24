// HR OS · Reimbursement — the receipt / e-invoice SCANNER, ported.
//
// `hrRCScan*` (hros.html:2246-2506), split the way `hr.profile`'s signature pad was: the parts that are
// not device code are pure functions here, and the canvas wiring lives in the route
// (`app/hr/expenses/scan-modal.tsx`). No golden can hold a `<canvas>`'s pixels, so what IS provable is
// the geometry, the QR parse and the field mapping — and each of those is where a defect would silently
// attach the wrong document or file the wrong figure.
//
// Two paths, both of them the legacy's:
//   📷 Scan receipt  → `DocScanner` (common.js), the camera pipeline. Already shared, so it cannot fork.
//                      Reached by indirect `eval` because `DocScanner` is a top-level `const` and NOT on
//                      `window` — CLAUDE.md's rule, and `app/finance/upload/page.tsx`'s precedent.
//   📄 PDF / photo   → a PDF goes straight to OCR + attach; an IMAGE opens the crop modal below.
//
// jsQR and jsPDF are injected (vendored classic scripts on this origin), never imported.

/** `hrRCParseEinv()` — hros.html:2416. MyInvois QR encodes a validation URL; pull the long id out. */
export function parseEinv(text: unknown): { url: string; uuid: string } {
  const url = String(text || '').trim();
  let uuid = '';
  const m = url.match(/myinvois[^\s]*?\/([A-Za-z0-9]{20,})/i);
  if (m) uuid = m[1];
  else { const m2 = url.match(/([A-Za-z0-9]{26,})/); if (m2) uuid = m2[1]; }
  return { url, uuid };
}

/** What `hr_rc_ocr` (hr.ts:2129) puts in `extracted`. Only the fields the legacy actually reads. */
export interface OcrExtract {
  date?: string; total?: string | number; description?: string; vendor?: string; invoice_no?: string;
  tax?: string | number; sst?: string | number; is_einvoice?: boolean; supplier_tin?: string;
  einvoice_uuid?: string; einvoice_validation_url?: string;
}

/**
 * `hrRCScanProcess()`'s line pick — hros.html:2465. The FIRST line with no type, no amount and no
 * distance; a new one is appended when every line is already filled. Returns the index.
 */
export function pickBlankItem(items: { claim_type_id?: string; amount?: unknown; total_km?: unknown }[]): number {
  for (let i = 0; i < items.length; i++) {
    const iu = items[i];
    if (!iu.claim_type_id && !(Number(iu.amount) || 0) && !(Number(iu.total_km) || 0)) return i;
  }
  return -1;
}

/**
 * `hrRCScanProcess()`'s field mapping — hros.html:2469-2473, exactly. Returns the PATCH, so the caller
 * merges rather than replaces (a line the operator half-filled must keep what they typed).
 *
 * `qr` BEATS OCR for the e-invoice identity, and that is the load-bearing line: the QR is read off the
 * document itself with no model in the loop, so it is the one the IRBM validation URL comes from.
 * Every assignment is guarded by truthiness exactly as the legacy's are — an OCR pass that returned
 * nothing must not blank a field.
 */
export function applyExtract(
  x: OcrExtract,
  claimTypeId: string | null | undefined,
  qr: { url?: string; uuid?: string } | null,
): Record<string, unknown> {
  const t: Record<string, unknown> = {};
  if (claimTypeId) t.claim_type_id = claimTypeId;
  if (x.date) t.item_date = x.date;
  if (x.total) t.amount = x.total;
  if (x.description) t.description = x.description;
  if (x.vendor) t.vendor_name = x.vendor;
  if (x.invoice_no) t.invoice_no = x.invoice_no;
  if (x.tax) t.tax_amount = x.tax;
  if (x.sst) t.sst_amount = x.sst;
  if (x.is_einvoice) t.is_einvoice = true;
  if (x.supplier_tin) t.supplier_tin = x.supplier_tin;
  if (x.einvoice_uuid) t.einvoice_uuid = x.einvoice_uuid;
  if (x.einvoice_validation_url) t.einvoice_validation_url = x.einvoice_validation_url;
  if (qr && qr.url) {
    t.is_einvoice = true;
    t.einvoice_validation_url = qr.url;
    if (qr.uuid) t.einvoice_uuid = qr.uuid;
  }
  t._open = true;
  return t;
}

/** `hrRCScanProcess()`'s closing toast — hros.html:2477-2480. */
export function scanToast(qr: { url?: string } | null, x: OcrExtract, ocrErr: string): { text: string; err: boolean } {
  const parts: string[] = [];
  if (qr && qr.url) parts.push('e-Invoice QR ✓');
  if (x.vendor) parts.push(x.vendor);
  if (x.total) parts.push('RM' + (Number(x.total) || 0).toFixed(2));
  if (parts.length) return { text: 'Scan added — ' + parts.join(' · ') + ' (attached as PDF)', err: false };
  if (ocrErr) return { text: 'Attached as PDF. OCR: ' + ocrErr, err: true };
  return { text: 'Scan attached as PDF ✓', err: false };
}

// ── The crop modal's geometry ──────────────────────────────────────────────────────────────────────

export interface CropRect { x: number; y: number; w: number; h: number }

/**
 * `hrRCScanAutoCrop()` — hros.html:2358, with the canvas read lifted out so the HEURISTIC is drivable.
 * Background = median luminance of the border ring; the receipt is the bounding box of pixels that
 * differ from it by more than 28. Returns null on every bail the legacy takes — barely any foreground,
 * a suspiciously tiny selection, or one that already fills the frame — because guessing wrong crops a
 * receipt in half and the employee ships the crop, not the photo.
 *
 * Coordinates come back in the DOWNSCALED analysis space; `autoCropRect` scales them for you.
 */
export function autoCropFromPixels(d: Uint8ClampedArray | number[], AW: number, AH: number): CropRect | null {
  const lum = (i: number) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  const bord: number[] = [];
  for (let x = 0; x < AW; x++) { bord.push(lum(x * 4)); bord.push(lum(((AH - 1) * AW + x) * 4)); }
  for (let y = 0; y < AH; y++) { bord.push(lum((y * AW) * 4)); bord.push(lum((y * AW + AW - 1) * 4)); }
  bord.sort((a, b) => a - b);
  const bg = bord[bord.length >> 1];
  const T = 28;
  let minX = AW, minY = AH, maxX = 0, maxY = 0, cnt = 0;
  for (let yy = 0; yy < AH; yy++) {
    for (let xx = 0; xx < AW; xx++) {
      const i = (yy * AW + xx) * 4;
      if (Math.abs(lum(i) - bg) > T) {
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (yy < minY) minY = yy;
        if (yy > maxY) maxY = yy;
        cnt++;
      }
    }
  }
  if (cnt < AW * AH * 0.02) return null;               // barely any foreground → don't guess
  const w = maxX - minX, h = maxY - minY;
  if (w < AW * 0.15 || h < AH * 0.15) return null;     // suspiciously tiny selection → skip
  if (w > AW * 0.96 && h > AH * 0.96) return null;     // already fills the frame → no crop needed
  const px = AW * 0.02, py = AH * 0.02;                // small padding so we don't shave the edges
  minX = Math.max(0, minX - px); minY = Math.max(0, minY - py);
  maxX = Math.min(AW, maxX + px); maxY = Math.min(AH, maxY + py);
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * `hrRCScanUp()`'s discard rule — hros.html:2406. A drag under 12 base-pixels either way is a TAP, not
 * a crop, and must clear the box rather than shrink it to nothing: a 3px crop is an empty receipt.
 */
export const keepCrop = (c: CropRect | null): CropRect | null => (c && (c.w < 12 || c.h < 12) ? null : c);

/** `hrRCScanMove()` — hros.html:2404. A drag is a rectangle between two points, either direction. */
export const dragRect = (sx: number, sy: number, x: number, y: number): CropRect =>
  ({ x: Math.min(sx, x), y: Math.min(sy, y), w: Math.abs(x - sx), h: Math.abs(y - sy) });

/** `hrRCScanBuildBase()`'s sizing — hros.html:2347. Longest side capped at 1800; 90°/270° swap w/h. */
export function baseSize(iw: number, ih: number, rot: number): { w: number; h: number; bw: number; bh: number; rot: number } {
  const mx = 1800, sc = Math.min(1, mx / Math.max(iw, ih));
  const w = Math.round(iw * sc), h = Math.round(ih * sc);
  const r = ((rot % 360) + 360) % 360;
  return { w, h, bw: (r === 90 || r === 270) ? h : w, bh: (r === 90 || r === 270) ? w : h, rot: r };
}

// ── Canvas work. Browser-only, but every decision above is already out of it. ───────────────────────

/** `hrRCScanBuildBase()` — hros.html:2347. */
export function buildBase(img: HTMLImageElement, rot: number): { canvas: HTMLCanvasElement; bw: number; bh: number } {
  const iw = img.naturalWidth || img.width || 1, ih = img.naturalHeight || img.height || 1;
  const s = baseSize(iw, ih, rot);
  const cv = document.createElement('canvas');
  cv.width = s.bw; cv.height = s.bh;
  const ctx = cv.getContext('2d')!;
  ctx.save();
  ctx.translate(s.bw / 2, s.bh / 2);
  ctx.rotate(s.rot * Math.PI / 180);
  ctx.drawImage(img, -s.w / 2, -s.h / 2, s.w, s.h);
  ctx.restore();
  return { canvas: cv, bw: s.bw, bh: s.bh };
}

/** `hrRCScanAutoCrop()`'s canvas half — hros.html:2358. */
export function autoCropRect(base: HTMLCanvasElement, bw: number, bh: number): CropRect | null {
  try {
    const AW = Math.min(240, bw), sc = AW / bw, AH = Math.max(1, Math.round(bh * sc));
    const ac = document.createElement('canvas');
    ac.width = AW; ac.height = AH;
    const actx = ac.getContext('2d')!;
    actx.drawImage(base, 0, 0, AW, AH);
    const r = autoCropFromPixels(actx.getImageData(0, 0, AW, AH).data, AW, AH);
    return r ? { x: r.x / sc, y: r.y / sc, w: r.w / sc, h: r.h / sc } : null;
  } catch { return null; }
}

/**
 * `hrRCScanEnhance()` — hros.html:2329. Percentile contrast stretch (2%–98% luma): whiter paper, darker
 * text, like a proper scanner. Pure canvas math, runs locally, and bails on an already-flat image
 * rather than over-processing it.
 */
export function enhanceCanvas(cv: HTMLCanvasElement): HTMLCanvasElement {
  try {
    const ctx = cv.getContext('2d')!;
    const id = ctx.getImageData(0, 0, cv.width, cv.height);
    const d = id.data;
    const hist = new Array<number>(256).fill(0);
    const step = Math.max(4, Math.floor(d.length / 4 / 120000) * 4);
    let n = 0;
    for (let p = 0; p < d.length; p += step * 4) { const lu = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000 | 0; hist[lu]++; n++; }
    let lo = 0, hi = 255, acc = 0;
    for (let a = 0; a < 256; a++) { acc += hist[a]; if (acc >= n * 0.02) { lo = a; break; } }
    acc = 0;
    for (let b2 = 255; b2 >= 0; b2--) { acc += hist[b2]; if (acc >= n * 0.02) { hi = b2; break; } }
    if (hi - lo < 30) return cv;
    const sc = 235 / Math.max(1, hi - lo);
    for (let q = 0; q < d.length; q += 4) {
      const r = (d[q] - lo) * sc + 15, g = (d[q + 1] - lo) * sc + 15, bl = (d[q + 2] - lo) * sc + 15;
      d[q] = r < 0 ? 0 : r > 255 ? 255 : r;
      d[q + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[q + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
    }
    const out = document.createElement('canvas');
    out.width = cv.width; out.height = cv.height;
    out.getContext('2d')!.putImageData(id, 0, 0);
    return out;
  } catch { return cv; }
}

/** `hrRCScanCropCanvas()` — hros.html:2411. The PDF gets the ENHANCED page, as the legacy's does. */
export function cropCanvas(base: HTMLCanvasElement, crop: CropRect | null, enhanced: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = crop || { x: 0, y: 0, w: base.width, h: base.height };
  const src = enhanced || base;
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(c.w));
  out.height = Math.max(1, Math.round(c.h));
  out.getContext('2d')!.drawImage(src, c.x, c.y, c.w, c.h, 0, 0, out.width, out.height);
  return out;
}

/** `hrRCScanQrRaw()` / `hrRCScanQrOn()` — hros.html:2419-2420. */
export function qrRaw(jsQR: any, cv: HTMLCanvasElement | null): any {
  if (!jsQR || !cv) return null;
  try {
    const id = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
    return jsQR(id.data, cv.width, cv.height) || null;
  } catch { return null; }
}
export function qrOn(jsQR: any, cv: HTMLCanvasElement | null): { url: string; uuid: string } | null {
  const f = qrRaw(jsQR, cv);
  return (f && f.data) ? parseEinv(f.data) : null;
}

/** `hrRCScanDraw()` — hros.html:2382. The mask, the crop outline and the green QR box. */
export function drawScan(cv: HTMLCanvasElement, o: {
  src: HTMLCanvasElement; baseW: number; baseH: number; maxW: number; crop: CropRect | null; qrLoc: any;
}): number {
  const scale = Math.min(1, o.maxW / o.baseW);
  const dw = Math.max(1, Math.round(o.baseW * scale)), dh = Math.max(1, Math.round(o.baseH * scale));
  cv.width = dw; cv.height = dh;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(o.src, 0, 0, dw, dh);
  if (o.qrLoc) {
    try {
      const L = o.qrLoc;
      ctx.save();
      ctx.strokeStyle = '#3ddc97'; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(L.topLeftCorner.x * scale, L.topLeftCorner.y * scale);
      ctx.lineTo(L.topRightCorner.x * scale, L.topRightCorner.y * scale);
      ctx.lineTo(L.bottomRightCorner.x * scale, L.bottomRightCorner.y * scale);
      ctx.lineTo(L.bottomLeftCorner.x * scale, L.bottomLeftCorner.y * scale);
      ctx.closePath(); ctx.stroke();
      ctx.fillStyle = '#3ddc97'; ctx.font = 'bold 11px sans-serif';
      ctx.fillText('e-Invoice QR ✓', Math.max(2, L.topLeftCorner.x * scale), Math.max(12, L.topLeftCorner.y * scale - 6));
      ctx.restore();
    } catch { /* a malformed location must not stop the crop from being drawn */ }
  }
  if (o.crop) {
    const c = o.crop;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, dw, c.y * scale);
    ctx.fillRect(0, c.y * scale, c.x * scale, c.h * scale);
    ctx.fillRect((c.x + c.w) * scale, c.y * scale, dw - (c.x + c.w) * scale, c.h * scale);
    ctx.fillRect(0, (c.y + c.h) * scale, dw, dh - (c.y + c.h) * scale);
    ctx.strokeStyle = '#e85d3c'; ctx.lineWidth = 2;
    ctx.strokeRect(c.x * scale, c.y * scale, c.w * scale, c.h * scale);
    ctx.restore();
  }
  return scale;
}

/** `hrRCImgToPdf()` — hros.html:2435. One A4 page, the crop centred, JPEG q0.85, 8mm margin. */
export function imgToPdf(JsPDF: any, cv: HTMLCanvasElement): File | Blob | null {
  try {
    const jpeg = cv.toDataURL('image/jpeg', 0.85);
    const pw = 210, ph = 297, m = 8, iw = cv.width, ih = cv.height, aw = pw - 2 * m, ah = ph - 2 * m;
    const sc = Math.min(aw / iw, ah / ih), w = iw * sc, h = ih * sc;
    const doc = new JsPDF({ unit: 'mm', format: 'a4' });
    doc.addImage(jpeg, 'JPEG', (pw - w) / 2, (ph - h) / 2, w, h);
    const ab = doc.output('arraybuffer');
    try { return new File([ab], 'receipt.pdf', { type: 'application/pdf' }); }
    catch { return new Blob([ab], { type: 'application/pdf' }); }
  } catch { return null; }
}

/**
 * `hrRCPrepImage()` — hros.html:2484. Shrink a phone photo before upload: images → 1600px longest side,
 * JPEG q0.82; PDFs and already-small files pass through untouched. ALWAYS resolves — never rejects — so
 * an upload is never lost to a decode failure.
 */
export function prepImage(file: File | Blob | null): Promise<File | Blob | null> {
  return new Promise((res) => {
    const f = file as File | null;
    if (!f || !/^image\//.test(f.type || '')) { res(file); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const mx = 1600, sc = Math.min(1, mx / Math.max(img.width || 1, img.height || 1));
        if (sc >= 1 && f.size < 900000) { res(f); return; }
        try {
          const cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(img.width * sc));
          cv.height = Math.max(1, Math.round(img.height * sc));
          cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
          cv.toBlob((blob) => {
            if (!blob) { res(f); return; }
            const nm = (f.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg';
            try { res(new File([blob], nm, { type: 'image/jpeg' })); } catch { res(blob); }
          }, 'image/jpeg', 0.82);
        } catch { res(f); }
      };
      img.onerror = () => res(f);
      img.src = String(rd.result || '');
    };
    rd.onerror = () => res(f);
    rd.readAsDataURL(f);
  });
}

/** `hrRCFileB64()` — hros.html:2231. */
export function fileB64(file: Blob): Promise<string> {
  return new Promise((res) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result || ''));
    rd.onerror = () => res('');
    rd.readAsDataURL(file);
  });
}

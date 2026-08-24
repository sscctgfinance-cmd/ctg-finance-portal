'use client';

// The crop / QR modal — `hrRCScanModal()` and its dozen `hrRCScan*` helpers (hros.html:2288-2440).
//
// It lives in `app/` and not `src/` on purpose: it is a `<canvas>` driven by pointer events and a lazy
// jsQR load, i.e. exactly the impure half the pure/route split puts on this side of the line
// (`app/hr/profile/page.tsx`'s signature pad is the precedent). Every DECISION it makes — the auto-crop
// heuristic, the 12px tap discard, the rotate sizing, the QR parse — is a pure function in
// `src/hr-rc-scan.ts` with its own test; what is left here is drawing and wiring.
//
// No golden holds it. `hrRCScanModal()` appends to `document.body`, which `tests/render_harness.ts`
// never records, so the legacy modal is in no golden either.

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  autoCropRect, buildBase, cropCanvas, dragRect, drawScan, enhanceCanvas, imgToPdf, keepCrop, parseEinv,
  qrRaw, type CropRect,
} from '../../../src/hr-rc-scan';
import { loadJsPDF, loadJsQR } from './libs';

export interface ScanModalProps {
  img: HTMLImageElement;
  /** `hrRCScanUse()` — hros.html:2441. The clean PDF (or a JPEG if the PDF engine is missing), the JPEG
   *  for OCR, and whatever QR was decoded. */
  onUse: (attach: File | Blob, ocrB64Source: HTMLCanvasElement, qr: { url: string; uuid: string } | null) => void;
  onCancel: () => void;
}

interface Base { canvas: HTMLCanvasElement; bw: number; bh: number }

export default function ScanModal(p: ScanModalProps) {
  const cvRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const base = useRef<Base | null>(null);
  const enhanced = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ sx: number; sy: number } | null>(null);
  const disp = useRef(1);

  const [rot, setRot] = useState(0);
  const [enhance, setEnhance] = useState(true);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [qr, setQr] = useState<{ url: string; uuid: string } | null>(null);
  const [qrLoc, setQrLoc] = useState<any>(null);
  const [status, setStatus] = useState<{ text: string; warn: boolean }>({ text: '', warn: false });
  /** Synchronous, for the reason `page.tsx`'s `savingRef` spells out: a state flag read from one closure
   *  does not stop a burst of taps, and each one here queues another PDF build and another attachment. */
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  /** `hrRCScanDraw()` — hros.html:2382. */
  const draw = useCallback(() => {
    const cv = cvRef.current, b = base.current;
    if (!cv || !b) return;
    if (enhance && !enhanced.current) enhanced.current = enhanceCanvas(b.canvas);
    const maxW = Math.max(160, Math.min(520, (boxRef.current ? boxRef.current.clientWidth : 520) - 48));
    disp.current = drawScan(cv, {
      src: enhance ? (enhanced.current || b.canvas) : b.canvas,
      baseW: b.bw, baseH: b.bh, maxW, crop, qrLoc,
    });
  }, [crop, enhance, qrLoc]);

  /** `hrRCScanBuildBase()` + `hrRCScanAutoCrop()` + `hrRCScanAutoQR()` — hros.html:2306, and again on
   *  every Rotate (:2407), which is why `rot` is the dependency rather than a one-shot mount effect. */
  useEffect(() => {
    const b = buildBase(p.img, rot);
    base.current = b;
    enhanced.current = null;                       // the enhance cache dies with the base
    setCrop(autoCropRect(b.canvas, b.bw, b.bh));
    setQr(null); setQrLoc(null);
    setStatus({ text: '🔍 Looking for e-invoice QR…', warn: false });
    let live = true;
    void loadJsQR().then((jsQR) => {
      if (!live || !base.current) return;
      if (!jsQR) { setStatus({ text: '', warn: false }); return; }
      const raw = qrRaw(jsQR, base.current.canvas);
      if (raw && raw.data) {
        const parsed = parseEinv(raw.data);
        setQr(parsed); setQrLoc(raw.location || null);
        setStatus({ text: '✓ e-invoice QR detected' + (parsed.uuid ? ' · ' + parsed.uuid.slice(0, 20) + '…' : ''), warn: false });
      } else {
        setStatus({ text: 'No e-invoice QR on this image — that’s fine for a normal receipt.', warn: false });
      }
    });
    return () => { live = false; };
  }, [p.img, rot]);

  useEffect(() => { draw(); }, [draw]);

  /** `hrRCScanPt()` — hros.html:2401. Clamped to the base, so a drag off the edge is still a rectangle. */
  const pt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = cvRef.current!, b = base.current!;
    const r = cv.getBoundingClientRect(), d = disp.current || 1;
    return {
      x: Math.max(0, Math.min(b.bw, (e.clientX - r.left) / d)),
      y: Math.max(0, Math.min(b.bh, (e.clientY - r.top) / d)),
    };
  };

  /** `hrRCScanDetectQR()` — hros.html:2421. Try the CROP first; a hit there is in crop space and its
   *  corners are offset back to base coordinates, or the green box lands in the wrong place. */
  const detectQr = useCallback(() => {
    setStatus({ text: 'Scanning for QR…', warn: false });
    void loadJsQR().then((jsQR) => {
      const b = base.current;
      if (!b) return;
      if (!jsQR) { setStatus({ text: 'QR reader unavailable.', warn: true }); return; }
      let raw: any = null, off: CropRect | null = null;
      if (crop) {
        raw = qrRaw(jsQR, cropCanvas(b.canvas, crop, enhance ? enhanced.current : null));
        if (raw && raw.data) off = crop; else raw = null;
      }
      if (!raw) { raw = qrRaw(jsQR, b.canvas); off = null; }
      if (raw && raw.data) {
        const parsed = parseEinv(raw.data);
        let L = raw.location || null;
        if (L && off) {
          try {
            L = JSON.parse(JSON.stringify(L));
            (['topLeftCorner', 'topRightCorner', 'bottomRightCorner', 'bottomLeftCorner'] as const).forEach((k) => {
              if (L[k]) { L[k].x += off!.x; L[k].y += off!.y; }
            });
          } catch { L = null; }
        }
        setQr(parsed); setQrLoc(L);
        setStatus({ text: '✓ e-invoice QR found' + (parsed.uuid ? ' · UUID ' + parsed.uuid.slice(0, 24) : ''), warn: false });
      } else {
        setQr(null); setQrLoc(null);
        setStatus({ text: 'No QR detected — crop tighter around the QR, or Rotate, and try again.', warn: true });
      }
    });
  }, [crop, enhance]);

  /** `hrRCScanUse()` — hros.html:2441. One press, one document; guarded so a double-tap cannot queue two. */
  const use = useCallback(() => {
    if (busyRef.current) return;
    const b = base.current;
    if (!b) return;
    busyRef.current = true;
    setBusy(true);
    setStatus({ text: 'Processing…', warn: false });
    void (async () => {
      try {
        if (enhance && !enhanced.current) enhanced.current = enhanceCanvas(b.canvas);
        const cc = cropCanvas(b.canvas, crop, enhance ? enhanced.current : null);
        let found = qr;
        if (!found) {
          const jsQR = await loadJsQR();
          const raw = qrRaw(jsQR, cc) || qrRaw(jsQR, b.canvas);
          found = (raw && raw.data) ? parseEinv(raw.data) : null;
        }
        const JsPDF = await loadJsPDF();
        const pdf = JsPDF ? imgToPdf(JsPDF, cc) : null;
        const attach = pdf || await new Promise<Blob>((res) => cc.toBlob((bl) => res(bl!), 'image/jpeg', 0.85));
        p.onUse(attach, cc, found);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  }, [crop, enhance, p, qr]);

  return (
    <div
      id="rc-scan-ov"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px' }}
    >
      <div ref={boxRef} style={{ background: 'var(--panel,#1b1817)', border: '1px solid var(--border)', borderRadius: '14px', maxWidth: '560px', width: '100%', maxHeight: '94vh', overflow: 'auto', padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <b style={{ fontSize: '15px' }}>📷 Crop receipt / e-invoice</b>
          <button className="btn xs" onClick={p.onCancel}>✕</button>
        </div>
        <div className="muted" style={{ fontSize: '11.5px', marginBottom: '8px' }}>
          Auto-cropped to the receipt (drag to adjust, ↺ Reset for the full photo). The e-invoice QR is detected automatically (green box). “Use” saves a clean, enhanced PDF, then reads it.
        </div>
        <div style={{ textAlign: 'center', background: 'var(--panel-2)', borderRadius: '8px', padding: '6px' }}>
          <canvas
            id="rc-scan-cv"
            ref={cvRef}
            style={{ maxWidth: '100%', touchAction: 'none', cursor: 'crosshair', borderRadius: '4px' }}
            onPointerDown={(e) => { e.preventDefault(); const q = pt(e); drag.current = { sx: q.x, sy: q.y }; }}
            onPointerMove={(e) => { if (!drag.current) return; e.preventDefault(); const q = pt(e); setCrop(dragRect(drag.current.sx, drag.current.sy, q.x, q.y)); }}
            onPointerUp={() => { if (drag.current) { setCrop((c) => keepCrop(c)); drag.current = null; } }}
            onPointerLeave={() => { if (drag.current) { setCrop((c) => keepCrop(c)); drag.current = null; } }}
          ></canvas>
        </div>
        <div id="rc-scan-mstatus" className="muted" style={{ fontSize: '11.5px', minHeight: '16px', marginTop: '6px', color: status.warn ? 'var(--amber)' : 'var(--green-soft)' }}>{status.text}</div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px', alignItems: 'center' }}>
          <button className="btn xs" onClick={() => setRot((r) => (r + 90) % 360)}>⟳ Rotate</button>
          <button className="btn xs" onClick={() => { setCrop(null); setQr(null); setStatus({ text: '', warn: false }); }}>↺ Reset crop</button>
          <button className={'btn xs' + (enhance ? ' p' : '')} id="rc-scan-enh" onClick={() => { setEnhance((v) => !v); }}>{'✨ Enhance: ' + (enhance ? 'ON' : 'OFF')}</button>
          <button className="btn xs" onClick={detectQr}>🔍 Re-scan QR</button>
          <div style={{ flex: 1 }}></div>
          <button className="btn xs" onClick={p.onCancel}>Cancel</button>
          <button className="btn p sm" disabled={busy} onClick={use}>✓ Use (save PDF)</button>
        </div>
      </div>
    </div>
  );
}

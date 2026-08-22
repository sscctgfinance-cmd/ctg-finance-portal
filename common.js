// Shared by app.html (Finance OS) and hros.html (HR OS).
//
// Every function below was byte-identical in both files; a fix to one had to be repeated in the other or
// the two silently drifted. Moved here verbatim — no behaviour change.
//
// This MUST stay a classic script (<script src="common.js">, never type="module"), loaded BEFORE each
// file's inline <script>. The apps wire ~450 inline onclick="..." handlers, which resolve names as
// globals at click time; a module's top-level declarations are not global and every one of these would
// be undefined.
//
// Several of these read per-app state that stays in each file's inline script — API, CTG_SSO, TOKEN,
// STORAGE_OK, ME, COMPANIES, TFA_TOKEN, _toastQueue/_toastPlaying, SESSION_EXPIRED_SHOWN — and call
// per-app functions that legitimately differ (enterApp, show2faPrompt, handleSessionExpired). That is
// safe because nothing here runs at load time: a classic script's top-level const/let live in the shared
// global lexical environment, so each name is resolved when the function is CALLED, by which point the
// inline script has run. Do not add load-time code to this file.
//
// The one thing that DOES evaluate at load is the DocScanner IIFE at the bottom. That is deliberate and
// stays safe for the same reason: it only declares closures and returns `{ open }` — it reads no per-app
// state and touches no DOM until `DocScanner.open()` is called. Keep it that way; a load-time read of
// API/TOKEN/ME from this file would be undefined for both apps.

// The site's public address — the ONE place it is written for the browser half of this repo. Anything
// needing an absolute URL for this app (the credential hand-out sheet, anything printed or copied out)
// references this name instead of spelling the host again. It is a bare string literal, so it does not
// break the "nothing here runs at load time" rule above: it reads no per-app state and touches no DOM.
//
// Three runtimes hold this address and none can import from another, so three declarations is the floor:
// this one, `SITE_URL` in supabase/functions/portal/hr.ts (the five emails), and `SITE_URL` in
// supabase/functions/ctg-sso/index.ts (the sign-in allow-list). tests/site_url_test.ts fails if they
// stop agreeing, and fails if a fourth hardcoded copy appears anywhere in the shipped source.
const SITE_URL = 'https://os.ctg4u.com';

function ctgSsoSignIn(app){ location.href = CTG_SSO + "/start?app=" + encodeURIComponent(app); }
function storageGet(k){ try { return STORAGE_OK ? localStorage.getItem(k) : null; } catch(_e){ return null; } }
function storageSet(k,v){ try { if(STORAGE_OK) localStorage.setItem(k,v); } catch(_e){} }
function storageRemove(k){ try { if(STORAGE_OK) localStorage.removeItem(k); } catch(_e){} }
// v224: both of these were the MACHINE's zone, and `inDaysLocalISO(90)` is compared against
// app.html's `todayLocalISO()` (MYT) in ONE expression — the document-expiry badge at app.html:5651.
// Two clocks, one comparison: west of Greenwich the "expires soon" window was off by a day at its
// far edge. Both now read Malaysian time, through the single definition in myt.js.
// `localISO(d)` keeps its name because it is a global both apps expose; its ANSWER changed.
function localISO(d){ return mytISO(d); }
function inDaysLocalISO(days){ return mytISOPlusDays(days); }
function toast(msg,isErr){ _toastQueue.push({msg,isErr}); if(!_toastPlaying) _playNextToast(); }
function _playNextToast(){
  const next=_toastQueue.shift();
  if(!next){ _toastPlaying=false; return; }
  _toastPlaying=true;
  const e=document.getElementById('toast');
  e.textContent=next.msg;
  e.style.borderColor=next.isErr?'rgba(239,68,68,.45)':'';
  e.style.color=next.isErr?'var(--red-soft)':'';
  e.classList.add('show');
  setTimeout(()=>{ e.classList.remove('show'); setTimeout(_playNextToast, 240); }, 2400);
}
async function call(body){
  const reqToken = body && body.token !== undefined ? body.token : TOKEN;
  // Don't make calls after we already know the session is dead — except for login/me probes.
  const isAuthExempt = body && (body.api==='login' || body.api==='login_2fa');
  for(let attempt=0; attempt<2; attempt++){
    const ctrl=new AbortController();
    const tm=setTimeout(()=>ctrl.abort(),30000);
    try{
      const r=await fetch(API,{method:'POST',body:JSON.stringify(Object.assign({token:TOKEN},body)),signal:ctrl.signal});
      // Retry once on 503 ONLY — and the two statuses NOT in this list are the point.
      //
      //   503 Service Unavailable  the request was refused before it ran. Nothing happened, so a retry
      //                            repeats nothing.
      //   502 Bad Gateway          the function answered with something the gateway could not use. It
      //                            may already have run.
      //   504 Gateway Timeout      the function did not answer in time. It is most likely STILL RUNNING.
      //
      // Retrying either of the last two repeats a POST that may have completed — and the actions most
      // likely to hit a gateway timeout are exactly the slow ones, because they are waiting on Xero:
      // o2o_issue, sr_post_invoices, sbi_post_xero, ap_post, hr_payroll_finalise, hr_rc_mark_paid. A
      // duplicated invoice or a twice-posted payroll is far worse than an error message, and the
      // message this falls through to already says "please retry".
      //
      // web/src/portal.ts has never retried at all and nothing has been reported against it, so this
      // moves the legacy client toward the behaviour the React one already ships.
      if(r.status===503 && attempt===0){
        clearTimeout(tm);
        await new Promise(rs=>setTimeout(rs, 1000));
        continue;
      }
      let data; try{ data=await r.json(); }catch(_e){
        if(r.status>=500) throw new Error('Server returned an unexpected response — please retry');
        throw new Error('Server returned an unexpected response');
      }
      // Session-expired detection: if we had a token and the server says unauthorized → token died.
      const isUnauth = (r.status===401) || (data && data.ok===false && data.error==='unauthorized');
      if(isUnauth && reqToken && !isAuthExempt){
        handleSessionExpired();
        // Throw so callers don't try to render data; the modal will guide the user.
        throw new Error('Session expired — please sign in again');
      }
      if(!r.ok && data && data.error) throw new Error(data.error);
      return data;
    }catch(e){
      if(e && e.name==='AbortError') throw new Error('Request timed out — server or Xero is slow, please retry');
      if(e instanceof TypeError) throw new Error('Network error — check your connection and retry');
      throw e;
    }finally{clearTimeout(tm);}
  }
}
async function doLogin(e){
  e.preventDefault();
  const email=document.getElementById('email').value.trim();
  const pass=document.getElementById('pass').value;
  const b=document.getElementById('lbtn'),er=document.getElementById('lerr');
  er.classList.add('hide');b.disabled=true;b.textContent='Signing in…';
  try{
    const r=await call({api:'login',email,pass,token:''});
    if(r&&r.ok){TOKEN=r.token;storageSet('ctg_portal_token',TOKEN);ME=r.user;COMPANIES=r.companies||[];enterApp();return;}
    if(r&&r.need_2fa){ show2faPrompt(r.login_token); b.disabled=false; b.textContent='Sign In'; return; }
    if(r&&r.locked){er.textContent='🔒 Account locked after too many failed attempts. Try again in '+(r.retry_minutes||15)+' min.';}
    else er.textContent='Incorrect email or password';
    er.classList.remove('hide');
  }catch(x){er.textContent='Connection failed, please retry';er.classList.remove('hide');}
  b.disabled=false;b.textContent='Sign In';
}
function cancel2fa(){ TFA_TOKEN=null; var o=document.getElementById('tfa_overlay'); if(o) o.remove(); document.getElementById('login').classList.remove('hide'); }
async function submit2fa(){
  var er=document.getElementById('tfa_err'); var btn=document.getElementById('tfa_btn');
  var code=(document.getElementById('tfa_code').value||'').replace(/\s|-/g,'');
  er.classList.add('hide');
  if(!/^\d{6}$/.test(code)){ er.textContent='Enter the 6-digit code from your authenticator app'; er.classList.remove('hide'); return; }
  btn.disabled=true; btn.textContent='Verifying…';
  try{
    var r=await call({api:'login_2fa', login_token:TFA_TOKEN, code:code, token:''});
    if(r&&r.ok){
      TOKEN=r.token; storageSet('ctg_portal_token',TOKEN); ME=r.user; COMPANIES=r.companies||[];
      var o=document.getElementById('tfa_overlay'); if(o) o.remove();
      enterApp(); return;
    }
    er.textContent=(r&&r.error)||'Incorrect code'; er.classList.remove('hide');
  }catch(x){ er.textContent='Network error, please retry'; er.classList.remove('hide'); }
  btn.disabled=false; btn.textContent='Verify';
}

/* ═══ 📷 DocScanner — CamScanner-style capture → auto edge-detect → perspective
   correct → enhance → multi-page PDF. Self-contained; only jsPDF lazy-loaded.
   Public: DocScanner.open({ multi, title, onDone })
     onDone({ pageCount, jpegDataUrl, jpegB64, pdfBlob, pageCanvases, rawCanvases })

   Was duplicated verbatim in app.html and hros.html — 412 vs 413 lines, 15 lines apart, and the HR copy
   was a strict superset (it also tracks the un-enhanced `pagesRaw` and returns `pageCanvases` /
   `rawCanvases`, which HR OS reads to scan an e-invoice QR before B&W thresholding can eat it). The HR
   superset is what lives here; Finance OS reads only the original four keys and is unaffected.

   `DocScanner` is a top-level `const`, so it is lexically scoped and NOT on `window` — see the note at
   hrRCScanTrigger() in hros.html, where assuming otherwise silently fell back to the file picker. That
   still holds: classic scripts share one global lexical environment, so both apps' inline scripts see
   this binding by name because common.js loads before them. `window.DocScanner` is still undefined. ═══ */
const DocScanner = (function () {
  'use strict';
  let stream = null, pages = [], pagesRaw = [], srcCanvas = null, corners = null, warpedRaw = null,
      mode = 'bw', onDoneCb = null, wantMulti = false, dragIdx = -1, dispScale = 1;

  // ---- geometry helpers ----
  function orderCorners(pts) {
    let tl = pts[0], br = pts[0], tr = pts[0], bl = pts[0];
    let sMin = Infinity, sMax = -Infinity, dMin = Infinity, dMax = -Infinity;
    for (const p of pts) { const s = p.x + p.y, d = p.y - p.x;
      if (s < sMin) { sMin = s; tl = p; } if (s > sMax) { sMax = s; br = p; }
      if (d < dMin) { dMin = d; tr = p; } if (d > dMax) { dMax = d; bl = p; } }
    return [tl, tr, br, bl];
  }
  function fullFrame(W, H, m) { m = m || 0.015;
    return [{ x: W * m, y: H * m }, { x: W * (1 - m), y: H * m }, { x: W * (1 - m), y: H * (1 - m) }, { x: W * m, y: H * (1 - m) }]; }

  // ---- auto page-corner detection (background-difference + Otsu) ----
  function detectCorners(cv) { return detectCornersEx(cv).corners; }
  // Returns { corners, found } — `found` is false when we fell back to the full
  // frame (no confident document boundary). The live auto-shutter only fires on found.
  function detectCornersEx(cv) {
    const W = cv.width, H = cv.height, scale = 340 / Math.max(W, H);
    const w = Math.max(8, Math.round(W * scale)), h = Math.max(8, Math.round(H * scale));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(cv, 0, 0, w, h);
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const ring = Math.max(2, Math.round(Math.min(w, h) * 0.05)), rs = [[], [], []];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < ring || y < ring || x >= w - ring || y >= h - ring) {
      const i = (y * w + x) * 4; rs[0].push(d[i]); rs[1].push(d[i + 1]); rs[2].push(d[i + 2]); }
    const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1] || 0; };
    const bg = [med(rs[0]), med(rs[1]), med(rs[2])];
    const raw = new Float32Array(w * h); let dmax = 1;
    for (let i = 0; i < w * h; i++) { const r = d[i * 4] - bg[0], gg = d[i * 4 + 1] - bg[1], bb = d[i * 4 + 2] - bg[2];
      const v = Math.sqrt(r * r + gg * gg + bb * bb); raw[i] = v; if (v > dmax) dmax = v; }
    const dist = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) dist[i] = Math.min(255, (raw[i] / dmax) * 255) | 0;
    const hist = new Int32Array(256); for (let i = 0; i < dist.length; i++) hist[dist[i]]++;
    const N = dist.length; let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, thr = 0;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = N - wB; if (!wF) break;
      sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF; const bt = wB * wF * (mB - mF) * (mB - mF);
      if (bt > best) { best = bt; thr = t; } }
    const mask = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) mask[i] = dist[i] > thr ? 1 : 0;
    const fg = new Uint8Array(w * h); let fgCount = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!mask[i]) continue;
      let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += mask[i + dy * w + dx];
      if (n >= 6) { fg[i] = 1; fgCount++; } }
    if (fgCount < w * h * 0.03 || fgCount > w * h * 0.92) return { corners: fullFrame(W, H), found: false };
    const pts = []; for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (fg[y * w + x]) pts.push({ x, y });
    const [tl, tr, br, bl] = orderCorners(pts), up = (p) => ({ x: p.x / scale, y: p.y / scale });
    const cxp = (tl.x + tr.x + br.x + bl.x) / 4, cyp = (tl.y + tr.y + br.y + bl.y) / 4;
    const pad = (p) => ({ x: p.x + (p.x - cxp) * 0.015, y: p.y + (p.y - cyp) * 0.015 });
    const out = [tl, tr, br, bl].map(pad).map(up).map((p) => ({ x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) }));
    // sanity: a real page is a convex-ish quad covering a sensible slice of frame
    const area = Math.abs((out[0].x*out[1].y-out[1].x*out[0].y)+(out[1].x*out[2].y-out[2].x*out[1].y)+
                          (out[2].x*out[3].y-out[3].x*out[2].y)+(out[3].x*out[0].y-out[0].x*out[3].y))/2;
    const frac = area / (W * H);
    return { corners: out, found: frac > 0.10 && frac < 0.97 };
  }

  // ---- perspective warp (Heckbert unit-square → quad) ----
  function warp(cv, cor, maxSide) {
    const [tl, tr, br, bl] = cor, dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let Wout = Math.max(16, Math.round(Math.max(dist(tl, tr), dist(bl, br))));
    let Hout = Math.max(16, Math.round(Math.max(dist(tl, bl), dist(tr, br))));
    const cap = maxSide || 1700, lng = Math.max(Wout, Hout);
    if (lng > cap) { const s = cap / lng; Wout = Math.round(Wout * s); Hout = Math.round(Hout * s); }
    const x0 = tl.x, y0 = tl.y, x1 = tr.x, y1 = tr.y, x2 = br.x, y2 = br.y, x3 = bl.x, y3 = bl.y;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    let a, b, cc, dd, e, f, gg, hh; const den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(den) < 1e-9) { a = x1 - x0; b = x3 - x0; cc = x0; dd = y1 - y0; e = y3 - y0; f = y0; gg = 0; hh = 0; }
    else { gg = (dx3 * dy2 - dx2 * dy3) / den; hh = (dx1 * dy3 - dy1 * dx3) / den;
      a = x1 - x0 + gg * x1; b = x3 - x0 + hh * x3; cc = x0; dd = y1 - y0 + gg * y1; e = y3 - y0 + hh * y3; f = y0; }
    const sc = document.createElement('canvas'); sc.width = cv.width; sc.height = cv.height; sc.getContext('2d').drawImage(cv, 0, 0);
    const sd = sc.getContext('2d').getImageData(0, 0, sc.width, sc.height).data, SW = sc.width, SH = sc.height;
    const out = document.createElement('canvas'); out.width = Wout; out.height = Hout;
    const octx = out.getContext('2d'), oimg = octx.createImageData(Wout, Hout), od = oimg.data;
    for (let oy = 0; oy < Hout; oy++) { const v = (oy + 0.5) / Hout;
      for (let ox = 0; ox < Wout; ox++) { const u = (ox + 0.5) / Wout, wsum = gg * u + hh * v + 1;
        const sx = (a * u + b * v + cc) / wsum, sy = (dd * u + e * v + f) / wsum, oi = (oy * Wout + ox) * 4;
        if (sx < 0 || sy < 0 || sx > SW - 1 || sy > SH - 1) { od[oi] = od[oi + 1] = od[oi + 2] = 255; od[oi + 3] = 255; continue; }
        const x1i = sx | 0, y1i = sy | 0, x2i = Math.min(SW - 1, x1i + 1), y2i = Math.min(SH - 1, y1i + 1), fx = sx - x1i, fy = sy - y1i;
        const i00 = (y1i * SW + x1i) * 4, i10 = (y1i * SW + x2i) * 4, i01 = (y2i * SW + x1i) * 4, i11 = (y2i * SW + x2i) * 4;
        for (let k = 0; k < 3; k++) { const tp = sd[i00 + k] * (1 - fx) + sd[i10 + k] * fx, bt = sd[i01 + k] * (1 - fx) + sd[i11 + k] * fx;
          od[oi + k] = (tp * (1 - fy) + bt * fy) | 0; } od[oi + 3] = 255; } }
    octx.putImageData(oimg, 0, 0); return out;
  }

  // ---- enhancement ----
  function enhance(canvas, m) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext('2d'), img = ctx.getImageData(0, 0, w, h), d = img.data;
    if (m === 'original') return canvas;
    if (m === 'gray' || m === 'bw') {
      const gray = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      if (m === 'gray') { for (let i = 0; i < w * h; i++) { const v = gray[i] | 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; } }
      else {
        const integ = new Float64Array((w + 1) * (h + 1));
        for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += gray[y * w + x]; integ[(y + 1) * (w + 1) + (x + 1)] = integ[y * (w + 1) + (x + 1)] + row; } }
        const rad = Math.max(8, Math.round(Math.min(w, h) / 22)), C = 10;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const x1 = Math.max(0, x - rad), y1 = Math.max(0, y - rad), x2 = Math.min(w - 1, x + rad), y2 = Math.min(h - 1, y + rad);
          const cnt = (x2 - x1 + 1) * (y2 - y1 + 1);
          const sum = integ[(y2 + 1) * (w + 1) + (x2 + 1)] - integ[(y1) * (w + 1) + (x2 + 1)] - integ[(y2 + 1) * (w + 1) + (x1)] + integ[(y1) * (w + 1) + (x1)];
          const v = gray[y * w + x] > (sum / cnt - C) ? 255 : 0, i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v;
        }
      }
    } else if (m === 'color') {
      for (let k = 0; k < 3; k++) {
        const hist = new Int32Array(256); for (let i = 0; i < w * h; i++) hist[d[i * 4 + k]]++;
        const tot = w * h, loT = tot * 0.02, hiT = tot * 0.98; let acc = 0, lo = 0, hi = 255;
        for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loT) { lo = v; break; } }
        acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiT) { hi = v; break; } }
        const rng = Math.max(1, hi - lo);
        for (let i = 0; i < w * h; i++) { let v = (d[i * 4 + k] - lo) * 255 / rng; d[i * 4 + k] = v < 0 ? 0 : v > 255 ? 255 : v | 0; }
      }
    }
    ctx.putImageData(img, 0, 0); return canvas;
  }

  // ---- PDF (lazy jsPDF) ----
  let jspdfLoading = null;
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    if (jspdfLoading) return jspdfLoading;
    jspdfLoading = new Promise((res, rej) => { const s = document.createElement('script');
      s.src = './jspdf.umd.min.js';   // vendored in the repo — no CDN, works offline
      s.onload = res; s.onerror = () => rej(new Error('Could not load PDF library')); document.head.appendChild(s); });
    return jspdfLoading;
  }
  async function buildPdf(pageCanvases, q) {
    await loadJsPDF(); const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight(), M = 18;
    pageCanvases.forEach((cv, i) => { if (i > 0) pdf.addPage();
      const maxW = PW - M * 2, maxH = PH - M * 2; let dw = maxW, dh = dw * cv.height / cv.width;
      if (dh > maxH) { dh = maxH; dw = dh * cv.width / cv.height; }
      pdf.addImage(cv.toDataURL('image/jpeg', q || 0.82), 'JPEG', (PW - dw) / 2, (PH - dh) / 2, dw, dh); });
    return pdf.output('blob');
  }

  // ═══════════════════════ UI ═══════════════════════
  function injectCss() {
    if (document.getElementById('ds-css')) return;
    const s = document.createElement('style'); s.id = 'ds-css'; s.textContent =
      '.ds-ov{position:fixed;inset:0;z-index:99999;background:#0d0f12;display:flex;flex-direction:column;color:#fff;font-family:inherit;overscroll-behavior:contain}' +
      '.ds-top{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#14171c;border-bottom:1px solid #232830;flex:none}' +
      '.ds-top h4{margin:0;font-size:15px;font-weight:700;letter-spacing:.2px}' +
      '.ds-x{background:none;border:none;color:#9aa4af;font-size:26px;line-height:1;cursor:pointer;padding:0 4px}' +
      '.ds-stage{flex:1;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0}' +
      '.ds-stage video{max-width:100%;max-height:100%;object-fit:contain;background:#000}' +
      '.ds-guide{position:absolute;inset:7%;border:2px dashed rgba(255,255,255,.35);border-radius:14px;pointer-events:none}' +
      '.ds-camwrap{position:relative;line-height:0;max-width:100%;max-height:100%}' +
      '.ds-liveov{position:absolute;left:0;top:0;pointer-events:none}' +
      '.ds-status{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;background:rgba(0,0,0,.62);color:#fff;font-size:12.5px;font-weight:600;padding:7px 15px;border-radius:20px;white-space:nowrap;line-height:1.3;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
      '.ds-status.near{background:rgba(255,214,10,.95);color:#1a1a1a}' +
      '.ds-status.ok{background:#22c55e;color:#fff}' +
      '.ds-flash{position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none}' +
      '.ds-flash.go{animation:dsflash .26s ease-out}' +
      '@keyframes dsflash{0%{opacity:.85}100%{opacity:0}}' +
      '.ds-ico.on{background:#e2604b;color:#fff}' +
      '.ds-hint{position:absolute;bottom:14px;left:0;right:0;text-align:center;font-size:12.5px;color:#c7ced6;text-shadow:0 1px 3px #000;pointer-events:none;padding:0 20px}' +
      '.ds-editwrap{position:relative;touch-action:none;line-height:0}' +
      '.ds-editwrap canvas{display:block;max-width:100%;height:auto}' +
      '.ds-svg{position:absolute;inset:0;width:100%;height:100%;touch-action:none}' +
      '.ds-poly{fill:rgba(226,96,75,.14);stroke:#f0785f;stroke-width:2.5;vector-effect:non-scaling-stroke}' +
      '.ds-h{fill:#fff;stroke:#e2604b;stroke-width:3;vector-effect:non-scaling-stroke;cursor:grab}' +
      '.ds-bot{flex:none;background:#14171c;border-top:1px solid #232830;padding:12px 16px calc(12px + env(safe-area-inset-bottom))}' +
      '.ds-modes{display:flex;gap:8px;justify-content:center;margin-bottom:12px;flex-wrap:wrap}' +
      '.ds-mode{background:#1d222a;border:1px solid #2b323c;color:#c7ced6;border-radius:20px;padding:7px 15px;font-size:13px;cursor:pointer;font-weight:600}' +
      '.ds-mode.on{background:#e2604b;border-color:#e2604b;color:#fff}' +
      '.ds-row{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}' +
      '.ds-btn{border:none;border-radius:11px;padding:13px 20px;font-size:14.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:7px}' +
      '.ds-btn.p{background:#e2604b;color:#fff}.ds-btn.g{background:#232830;color:#e6ebf1}.ds-btn:disabled{opacity:.5;cursor:default}' +
      '.ds-shutter{width:70px;height:70px;border-radius:50%;background:#fff;border:5px solid #e2604b;cursor:pointer;flex:none;box-shadow:0 3px 14px rgba(0,0,0,.5)}' +
      '.ds-ico{background:#232830;color:#e6ebf1;border:none;width:52px;height:52px;border-radius:14px;font-size:22px;cursor:pointer;flex:none}' +
      '.ds-thumbs{display:flex;gap:8px;overflow-x:auto;padding:4px 0 2px}' +
      '.ds-thumb{position:relative;flex:none;height:56px;border-radius:6px;border:1px solid #2b323c}' +
      '.ds-thumb img{height:100%;border-radius:5px;display:block}' +
      '.ds-thumb b{position:absolute;top:-6px;right:-6px;background:#e2604b;color:#fff;border-radius:50%;width:18px;height:18px;font-size:11px;display:grid;place-items:center;cursor:pointer}' +
      '.ds-spin{width:34px;height:34px;border:3px solid #2b323c;border-top-color:#e2604b;border-radius:50%;animation:dsspin .8s linear infinite}' +
      '@keyframes dsspin{to{transform:rotate(360deg)}}' +
      '.ds-center{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;color:#c7ced6;font-size:13.5px;text-align:center;padding:24px}';
    document.head.appendChild(s);
  }
  let ov = null;
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function stopCam() { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } }
  function close() { stopLoop(); stopCam(); if (ov) { ov.remove(); ov = null; } pages = []; pagesRaw = []; srcCanvas = corners = warpedRaw = null; }

  function shell(title) {
    stopLoop();                       // never leave a rAF pointing at a removed <video>
    injectCss(); if (ov) ov.remove();
    ov = el('div', 'ds-ov');
    const top = el('div', 'ds-top');
    top.appendChild(el('h4', null, title || '📷 Scan document'));
    const x = el('button', 'ds-x', '&times;'); x.onclick = close; top.appendChild(x);
    const stage = el('div', 'ds-stage'); stage.id = 'ds-stage';
    const bot = el('div', 'ds-bot'); bot.id = 'ds-bot';
    ov.appendChild(top); ov.appendChild(stage); ov.appendChild(bot);
    document.body.appendChild(ov);
    return { stage, bot };
  }

  // ---- CAPTURE stage — Apple-Notes-style live edge tracking + auto shutter ----
  let rafId = null, liveHist = [], capturing = false, autoOn = true;
  // setInterval (not rAF): rAF is paused/throttled whenever the tab isn't the
  // foreground one, which silently kills live detection. 10 fps is plenty here.
  function stopLoop() { if (rafId) clearInterval(rafId); rafId = null; liveHist = []; capturing = false; }
  function drawQuad(octx, ovc, pts, found) {
    octx.clearRect(0, 0, ovc.width, ovc.height);
    octx.save();
    octx.fillStyle = 'rgba(0,0,0,.42)'; octx.fillRect(0, 0, ovc.width, ovc.height);
    if (pts) {   // punch a spotlight through the mask
      octx.globalCompositeOperation = 'destination-out';
      octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y); pts.forEach(p => octx.lineTo(p.x, p.y)); octx.closePath(); octx.fill();
      octx.globalCompositeOperation = 'source-over';
      octx.beginPath(); octx.moveTo(pts[0].x, pts[0].y); pts.forEach(p => octx.lineTo(p.x, p.y)); octx.closePath();
      octx.strokeStyle = found ? '#ffd60a' : 'rgba(255,255,255,.5)';
      octx.lineWidth = found ? 3.5 : 2; octx.setLineDash(found ? [] : [8, 7]); octx.stroke();
      if (found) { octx.fillStyle = '#ffd60a'; pts.forEach(p => { octx.beginPath(); octx.arc(p.x, p.y, 5.5, 0, 7); octx.fill(); }); }
    }
    octx.restore();
  }
  async function showCapture() {
    stopLoop();
    const { stage, bot } = shell(wantMulti && pages.length ? '📷 Scan · page ' + (pages.length + 1) : '📷 Scan document');
    stage.innerHTML = ''; bot.innerHTML = '';
    let usingCam = false;
    try {
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false });
      }
      const wrap = el('div', 'ds-camwrap');
      const video = el('video'); video.setAttribute('playsinline', ''); video.muted = true; video.srcObject = stream;
      const ovc = el('canvas', 'ds-liveov');
      const flash = el('div', 'ds-flash');
      wrap.append(video, ovc, flash); stage.appendChild(wrap);
      await video.play(); usingCam = true;
      const fit = () => {
        const aw = stage.clientWidth || ov.clientWidth || window.innerWidth || 360;
        const ah = stage.clientHeight || Math.round((window.innerHeight || 640) * .6);
        const vw = video.videoWidth || 4, vh = video.videoHeight || 3;
        const s = Math.min(aw / vw, ah / vh) || 1;
        const w = Math.max(1, Math.round(vw * s)), h = Math.max(1, Math.round(vh * s));
        wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
        video.style.width = w + 'px'; video.style.height = h + 'px';
        ovc.width = w; ovc.height = h; ovc.style.width = w + 'px'; ovc.style.height = h + 'px'; };
      if (video.readyState >= 1) fit(); else video.onloadedmetadata = fit;
      video.addEventListener('loadedmetadata', fit);
      window.addEventListener('resize', fit);                        // rotation / keyboard
      const status = el('div', 'ds-status', 'Point the camera at the document');
      wrap.appendChild(status);
      // bottom controls
      const gal = el('button', 'ds-ico', '🖼'); gal.title = 'Choose from gallery'; gal.onclick = () => pickFile();
      const shutter = el('button', 'ds-shutter'); shutter.setAttribute('aria-label', 'Capture');
      shutter.onclick = () => { if (!capturing) { capturing = true; doCapture(video, flash); } };
      const autoBtn = el('button', 'ds-ico' + (autoOn ? ' on' : ''), 'A'); autoBtn.title = 'Auto-capture';
      autoBtn.onclick = () => { autoOn = !autoOn; autoBtn.classList.toggle('on', autoOn); liveHist = []; };
      const row = el('div', 'ds-row'); row.append(gal, shutter, autoBtn); bot.appendChild(row);
      if (pages.length) {
        const save = el('button', 'ds-btn p', '✓ Save (' + pages.length + ')'); save.style.marginTop = '10px';
        save.onclick = () => { stopLoop(); finish(); };
        const r2 = el('div', 'ds-row'); r2.appendChild(save); bot.appendChild(r2);
        bot.appendChild(thumbStrip());
      }
      // ---- live detection loop ----
      const work = el('canvas'), octx = ovc.getContext('2d');
      const tick = () => {
        const ts = performance.now();
        if (capturing || !video.videoWidth) return;
        // Detection runs purely off the video frame. Overlay drawing is best-effort:
        // if layout hasn't settled (0-size canvas) we still detect and auto-capture.
        const PW = 300, s = PW / video.videoWidth;
        work.width = PW; work.height = Math.max(4, Math.round(video.videoHeight * s));
        work.getContext('2d').drawImage(video, 0, 0, work.width, work.height);
        let r; try { r = detectCornersEx(work); } catch (_e) { return; }
        if (ovc.width && ovc.height) {
          const sx = ovc.width / work.width, sy = ovc.height / work.height;
          drawQuad(octx, ovc, r.found ? r.corners.map(p => ({ x: p.x * sx, y: p.y * sy })) : null, r.found);
        } else { fit(); }
        const pts = r.corners;                                    // stability judged in work space
        if (!autoOn) { status.textContent = r.found ? 'Document detected — tap the shutter' : 'Point the camera at the document'; status.className = 'ds-status' + (r.found ? ' near' : ''); return; }
        if (!r.found) { liveHist = []; status.textContent = 'Looking for the document…'; status.className = 'ds-status'; return; }
        // Steadiness is judged on sample COUNT + elapsed SPAN — never on an assumed
        // tick rate. Background tabs and low-power mode stretch timers to ~1 Hz, and
        // a fixed-age window would then discard every sample and never fire.
        if (liveHist.length && ts - liveHist[liveHist.length - 1].t > 2500) liveHist = [];   // long gap → restart
        liveHist.push({ t: ts, pts });
        if (liveHist.length > 12) liveHist.shift();
        const span = ts - liveHist[0].t;
        if (liveHist.length < 3 || span < 600) { status.textContent = 'Hold steady…'; status.className = 'ds-status near'; return; }
        const diag = Math.hypot(work.width, work.height); let maxd = 0;
        for (const hst of liveHist) for (let i = 0; i < 4; i++) maxd = Math.max(maxd, Math.hypot(pts[i].x - hst.pts[i].x, pts[i].y - hst.pts[i].y));
        if (maxd < diag * 0.035) {
          capturing = true; status.textContent = '✓ Captured'; status.className = 'ds-status ok';
          doCapture(video, flash);
        } else { status.textContent = 'Hold steady…'; status.className = 'ds-status near'; }
      };
      rafId = setInterval(tick, 100);
    } catch (e) { /* no camera → file fallback */ }
    if (!usingCam) {
      stage.appendChild(el('div', 'ds-center', '<div style="font-size:34px">📷</div><div>Camera not available here.<br>Choose a photo of the document instead.</div>'));
      const b = el('button', 'ds-btn p', '🖼 Choose photo'); b.onclick = () => pickFile();
      const row = el('div', 'ds-row'); row.appendChild(b); bot.appendChild(row);
      if (pages.length) { const save = el('button', 'ds-btn p', '✓ Save (' + pages.length + ')'); save.onclick = () => finish(); row.appendChild(save); }
    }
  }
  function doCapture(video, flash) {
    if (flash) { flash.classList.add('go'); setTimeout(() => flash.classList.remove('go'), 260); }
    const cv = el('canvas'); cv.width = video.videoWidth; cv.height = video.videoHeight;
    cv.getContext('2d').drawImage(video, 0, 0);
    stopLoop();
    loadSource(cv);
  }
  function thumbStrip() {
    const th = el('div', 'ds-thumbs');
    pages.forEach((p, i) => { const t = el('div', 'ds-thumb'); const im = el('img'); im.src = p.toDataURL('image/jpeg', 0.5); t.appendChild(im);
      const del = el('b', null, '×'); del.onclick = () => { pages.splice(i, 1); pagesRaw.splice(i, 1); showCapture(); }; t.appendChild(del); th.appendChild(t); });
    return th;
  }
  function pickFile() {
    const inp = el('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.setAttribute('capture', 'environment');
    inp.onchange = () => { const f = inp.files[0]; if (!f) return;
      const img = new Image(); img.onload = () => { let W = img.naturalWidth, H = img.naturalHeight; const cap = 2600, l = Math.max(W, H);
        if (l > cap) { const s = cap / l; W = Math.round(W * s); H = Math.round(H * s); }
        const cv = el('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').drawImage(img, 0, 0, W, H); URL.revokeObjectURL(img.src); loadSource(cv); };
      img.onerror = () => toast('Could not read that image', true); img.src = URL.createObjectURL(f); };
    inp.click();
  }
  function loadSource(cv) { srcCanvas = cv; corners = detectCorners(cv); warpedRaw = warp(srcCanvas, corners, 1700); showReview(); }

  // ---- EDIT (crop) stage ----
  function showEdit() {
    const { stage, bot } = shell('Adjust edges'); stage.innerHTML = ''; bot.innerHTML = '';
    const availW = stage.clientWidth || window.innerWidth, availH = stage.clientHeight || (window.innerHeight * 0.6);
    dispScale = Math.min(availW / srcCanvas.width, availH / srcCanvas.height, 1);
    const dw = Math.round(srcCanvas.width * dispScale), dh = Math.round(srcCanvas.height * dispScale);
    const wrap = el('div', 'ds-editwrap'); wrap.style.width = dw + 'px'; wrap.style.height = dh + 'px';
    const disp = el('canvas'); disp.width = dw; disp.height = dh; disp.getContext('2d').drawImage(srcCanvas, 0, 0, dw, dh); wrap.appendChild(disp);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ds-svg'); svg.setAttribute('viewBox', '0 0 ' + dw + ' ' + dh);
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); poly.setAttribute('class', 'ds-poly'); svg.appendChild(poly);
    const handles = corners.map((_, i) => { const h = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); h.setAttribute('class', 'ds-h'); h.setAttribute('r', 11); h.dataset.i = i; svg.appendChild(h); return h; });
    wrap.appendChild(svg); stage.appendChild(wrap);
    function redraw() { poly.setAttribute('points', corners.map(p => (p.x * dispScale) + ',' + (p.y * dispScale)).join(' '));
      handles.forEach((h, i) => { h.setAttribute('cx', corners[i].x * dispScale); h.setAttribute('cy', corners[i].y * dispScale); }); }
    redraw();
    function pt(ev) { const r = svg.getBoundingClientRect(), t = ev.touches ? ev.touches[0] : ev;
      return { x: Math.max(0, Math.min(srcCanvas.width, (t.clientX - r.left) / dispScale)), y: Math.max(0, Math.min(srcCanvas.height, (t.clientY - r.top) / dispScale)) }; }
    svg.addEventListener('pointerdown', (ev) => { const i = ev.target.dataset && ev.target.dataset.i; if (i == null) return; dragIdx = +i; ev.target.setPointerCapture(ev.pointerId); ev.preventDefault(); });
    svg.addEventListener('pointermove', (ev) => { if (dragIdx < 0) return; corners[dragIdx] = pt(ev); redraw(); ev.preventDefault(); });
    svg.addEventListener('pointerup', () => { dragIdx = -1; });
    svg.addEventListener('pointercancel', () => { dragIdx = -1; });
    // buttons
    const retake = el('button', 'ds-btn g', '↻ Retake'); retake.onclick = () => showCapture();
    const rot = el('button', 'ds-btn g', '⟳ Rotate'); rot.onclick = () => { const r = el('canvas'); r.width = srcCanvas.height; r.height = srcCanvas.width;
      const rc = r.getContext('2d'); rc.translate(r.width, 0); rc.rotate(Math.PI / 2); rc.drawImage(srcCanvas, 0, 0); srcCanvas = r; corners = detectCorners(srcCanvas); showEdit(); };
    const auto = el('button', 'ds-btn g', '✨ Auto'); auto.onclick = () => { corners = detectCorners(srcCanvas); redraw(); };
    const next = el('button', 'ds-btn p', 'Done ▸'); next.onclick = () => { warpedRaw = warp(srcCanvas, corners, 1700); showReview(); };
    const r1 = el('div', 'ds-row'); r1.append(retake, rot, auto);
    const r2 = el('div', 'ds-row'); r2.style.marginTop = '10px'; r2.appendChild(next);
    bot.append(r1, r2);
  }

  // ---- REVIEW stage — "Keep Scan / Retake", like Apple Notes ----
  function showReview() {
    stopLoop();
    const { stage, bot } = shell('Scan ' + (pages.length + 1)); stage.innerHTML = ''; bot.innerHTML = '';
    const preview = el('canvas'); const availW = stage.clientWidth || window.innerWidth, availH = stage.clientHeight || (window.innerHeight * 0.6);
    const applyPreview = () => { const work = el('canvas'); work.width = warpedRaw.width; work.height = warpedRaw.height; work.getContext('2d').drawImage(warpedRaw, 0, 0); enhance(work, mode);
      const sc = Math.min(availW / work.width, availH / work.height, 1); preview.width = Math.round(work.width * sc); preview.height = Math.round(work.height * sc);
      preview.getContext('2d').drawImage(work, 0, 0, preview.width, preview.height); };
    preview.style.maxWidth = '100%'; preview.style.maxHeight = '100%'; stage.appendChild(preview); applyPreview();
    const modes = [['bw', '📄 B&W'], ['color', '✨ Color'], ['gray', 'Gray'], ['original', 'Original']];
    const mrow = el('div', 'ds-modes'); modes.forEach(([k, lbl]) => { const b = el('button', 'ds-mode' + (mode === k ? ' on' : ''), lbl);
      b.onclick = () => { mode = k; mrow.querySelectorAll('.ds-mode').forEach(x => x.classList.remove('on')); b.classList.add('on'); applyPreview(); }; mrow.appendChild(b); });
    bot.appendChild(mrow);
    const retake = el('button', 'ds-btn g', '↻ Retake'); retake.onclick = () => showCapture();
    const edges = el('button', 'ds-btn g', '✎ Edges'); edges.onclick = () => showEdit();
    const keep = el('button', 'ds-btn p', wantMulti ? '✓ Keep Scan' : '✓ Use this scan');
    keep.onclick = () => { commitPage(); if (wantMulti) showCapture(); else finish(); };
    const row = el('div', 'ds-row'); row.append(retake, edges, keep); bot.appendChild(row);
    if (wantMulti && pages.length) {
      const save = el('button', 'ds-btn g', '✓ Save now (' + pages.length + ')'); save.style.marginTop = '10px';
      save.onclick = () => finish();
      const r2 = el('div', 'ds-row'); r2.appendChild(save); bot.appendChild(r2);
      bot.appendChild(thumbStrip());
    }
  }
  function commitPage() { const work = el('canvas'); work.width = warpedRaw.width; work.height = warpedRaw.height; work.getContext('2d').drawImage(warpedRaw, 0, 0); enhance(work, mode); pages.push(work); pagesRaw.push(warpedRaw); }

  async function finish() {
    const { stage, bot } = shell('Processing'); stage.innerHTML = '<div class="ds-center"><div class="ds-spin"></div><div>Building your document…</div></div>'; bot.innerHTML = '';
    try {
      const first = pages[0], jpegDataUrl = first.toDataURL('image/jpeg', 0.9), jpegB64 = jpegDataUrl.split(',').pop();
      const pdfBlob = await buildPdf(pages, 0.82);
      const res = { pageCount: pages.length, jpegDataUrl, jpegB64, pdfBlob,
        pageCanvases: pages.slice(), rawCanvases: pagesRaw.slice() };
      const cb = onDoneCb; close(); if (cb) cb(res);
    } catch (e) { toast(e.message || 'Failed to build document', true); close(); }
  }

  return {
    open: function (opts) { opts = opts || {}; wantMulti = opts.multi !== false; onDoneCb = opts.onDone || null;
      stopLoop(); autoOn = true; pages = []; pagesRaw = []; srcCanvas = corners = warpedRaw = null; mode = 'bw';
      if (!navigator.mediaDevices && !window.FileReader) { toast('Scanning not supported on this device', true); return; }
      showCapture(); }
  };
})();

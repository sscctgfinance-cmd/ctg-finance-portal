// The AP Inbox's one piece of client-owned logic — deriving the GL-coding keyword a reviewed bill
// teaches the rule engine.
//
// Moved here verbatim from app.html (`apDeriveKeyword()`, which sat immediately after `apPostBill()`
// before this migration). Not a rewrite: the stop-word set, the length floor, the digit and ordinal
// filters and the longest-word tie-break are the same source text.
//
// WHY IT LIVES IN ITS OWN FILE: the standard question — does the server re-derive this? — comes back
// NO. `apPostBill()` sends the derived word to `{api:'ap_rule_save', keywords:[kw], …}` and
// finance.ts:1899 stores exactly what it was handed. Everything else on the AP Inbox screen is the
// opposite case (the stat banner is a display echo of the loaded list, and `ap_post` at
// finance.ts:1838 rebuilds the whole Xero payload itself), so this ten-line function is the ONLY thing
// on the screen whose answer nothing else checks. A second copy in the React port could drift by one
// stop word and quietly start auto-coding a different Chart-of-Account for every future bill matching
// it — with nothing on screen saying so. `web/src/finance-ap.tsx` imports it, through ap.d.ts.
//
// ── The two rules this file lives by (common.js:1-20) ────────────────────────────────────────────
// 1. Classic script (<script src="ap.js">, never type="module"), loaded before app.html's inline
//    <script> — the apps wire ~450 inline onclick= handlers that resolve names as globals at click time.
// 2. Nothing here runs at load time and nothing here reads app state. It is a pure function of one
//    string; it touches neither the DOM nor any AP_* global.
//
// Dependencies: none.

// Derive a reusable keyword from a line-item description (longest significant word).
// Skips digit-containing tokens, dates, months and filler — returns '' if nothing clean,
// so the teach feature never saves a junk rule (operator can add one manually instead).
function apDeriveKeyword(desc){
  if(!desc) return '';
  const STOP = new Set(['the','and','for','with','fee','cost','from','this','that','bill','month','year','jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec','january','february','march','april','june','july','august','september','october','november','december','statement','service','payment','charge','invoice','total','subtotal','amount']);
  const words = String(desc).toLowerCase()
    .replace(/[^a-z0-9 ]/g,' ').split(/\s+/)
    .filter(w => w.length>=4 && !/\d/.test(w) && !/^\d*(st|nd|rd|th)$/.test(w) && !STOP.has(w));
  words.sort((a,b)=>b.length-a.length);
  return words[0]||'';
}

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler reads it and hands the React app the same function app.html calls.
if (typeof module !== 'undefined' && module.exports) module.exports = { apDeriveKeyword };

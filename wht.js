// The Malaysian withholding-tax computation — ITA 1967 s.109 / s.109B, and the s.26A service tax that
// travels with it.
//
// Moved here verbatim from app.html (the WHT block that sat at app.html:3389-3424). Not a rewrite:
// every rounding step is the same source text, because this is the code that decides what a real
// company remits to LHDN. It replaces Malaysia_WHT_Summary.xlsx, and tests/wht_test.ts pins the four
// defects that workbook shipped with — the SST leaking into the withholding base, a subtotal that
// dropped the last two rows, a penalty label with no formula, and a net-of-tax contract that was
// under-withheld. That test is the gate.
//
// WHY IT LIVES IN ITS OWN FILE: same reason payroll.js does (read its header). It is the part of the
// WHT screen that has nothing to do with the DOM, so it is the part a React rewrite must NOT
// re-express — it should import it. `web/src/finance-wht.tsx` does, through wht.d.ts, so the browser
// and the migrated screen cannot fork the arithmetic. A second copy of a tax computation is a wrong
// filing waiting for the day the two stop agreeing.
//
// ── The two rules this file lives by ─────────────────────────────────────────────────────────────
//
// 1. It MUST stay a classic script (<script src="wht.js">, never type="module"), loaded before
//    app.html's inline <script>. See common.js:1-20 — the apps wire ~450 inline onclick= handlers that
//    resolve names as globals at click time, and a module's top-level declarations are not global.
// 2. Nothing here runs at load time and nothing here reads app state. Every function takes what it
//    needs as an argument (doc, lines, amount, rate). That is what makes it equally valid for a
//    bundler to import: `const { whtCompute } = require('./wht.js')` gets the same function, with no
//    window, no DOM and no globals to stand up first.
//
// Dependencies: none. It calls nothing outside this file.
//
// ── The computation, and why it is what it is ────────────────────────────────────────────────────
//   fee            each line, EXCLUDING Malaysian service tax
//   SST            fee × 8% — service tax on imported taxable services, self-accounted by the PAYER
//                  under s.26A Service Tax Act 2018. Shown for cash-planning; it is NOT part of the
//                  WHT base and never has been. Charging WHT on fee+SST over-withholds every month.
//   gross basis    the fee IS the gross. WHT = fee × rate, and the payee receives fee − WHT.
//   net basis      the contract says the payee gets the fee clean, so the payer bears the tax:
//                  gross = fee ÷ (1 − rate);  WHT = gross − fee.  The workbook's note described this
//                  but the sheet never implemented it, so a net-of-tax contract was under-withheld.
//   penalty        s.109(2)/s.109B(2): a 10% increase on tax not remitted within one month of paying
//                  or crediting the non-resident. Computed here, not typed — the spreadsheet left the
//                  cell blank under a label that says "10% of WHT".
//   due date       one month after the LAST payment date on the computation.

function whtMoney(n){ n=Number(n)||0; return n.toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}); }
// isFinite, not `||0`: `Number(Infinity)||0` is Infinity, and every figure below is derived from this
// one. A rate or an amount that arrives non-finite must land on 0, not carry through to the printed
// computation and the LHDN remittance figure.
function whtRound2(n){ n=Number(n); return isFinite(n)?Math.round(n*100)/100:0; }
/* The two derived cells on a payment line. Defined once so the row casts across, the column casts
   down, and the on-screen table, the printable form and the subtotal can never disagree. */
function whtLineSst(a, rate){ return whtRound2((Number(a)||0)*(Number(rate)||0)); }
function whtLineTotal(a, rate){ return whtRound2((Number(a)||0)+whtLineSst(a, rate)); }
/* The whole calculation in one place, so the screen, the printable form and any test all agree. */
function whtCompute(doc, lines){
  // Clamped to the range both SAVE paths already enforce (wht_payee_save and wht_save each require
  // 0 <= rate < 1, and the DB carries the same CHECK), so the calculator cannot render a computation the
  // database would refuse to store — a negative rate produced a negative service tax and a negative
  // amount payable to the payee, and a rate of 1 or more withholds the whole fee or more.
  var fin=function(x,max){ x=Number(x); if(!isFinite(x)||x<0) return 0; return (max!=null&&x>max)?max:x; };
  var rate=fin(doc.wht_rate,0.999999), sst=fin(doc.sst_rate), pen=fin(doc.penalty_pct);
  // Total each column the way the column is PRINTED — line by line, each already rounded to the sen.
  // Applying the rate to the aggregate instead leaves a subtotal the visible rows do not add up to:
  // 11 ManyChat lines footed to 4,024.95 on screen under a printed total of 4,024.97. A tax document
  // whose column does not cast is indefensible, and each payment is a separate acquisition of an
  // imported taxable service anyway — the service tax is accounted per acquisition, not on the batch.
  var fee=0, sstAmt=0;
  (lines||[]).forEach(function(l){ var a=whtRound2(l.amount); fee+=a; sstAmt+=whtLineSst(a,sst); });
  fee=whtRound2(fee); sstAmt=whtRound2(sstAmt);
  // Net basis: the fee is what the payee keeps, so it has to be grossed up before the rate is applied.
  // Guarded against rate>=1 at both ends, but belt-and-braces here — a divide by zero would render NaN
  // across the whole panel and look like a blank form rather than an error.
  var gross = (doc.basis==='net' && rate<1) ? whtRound2(fee/(1-rate)) : fee;
  var wht   = (doc.basis==='net' && rate<1) ? whtRound2(gross-fee)    : whtRound2(fee*rate);
  var penalty = doc.penalty_on ? whtRound2(wht*pen) : 0;
  return { fee:fee, sst:sstAmt, feeInclSst:whtRound2(fee+sstAmt), gross:gross, wht:wht,
           penalty:penalty, total:whtRound2(wht+penalty),
           netToPayee: whtRound2((doc.basis==='net'?fee:whtRound2(fee-wht))) };
}
/* One month after the last payment date — that is the statutory remittance deadline. */
function whtDueDate(lines){
  var last=null; (lines||[]).forEach(function(l){ if(l.payment_date && (!last || l.payment_date>last)) last=l.payment_date; });
  if(!last) return null;
  var d=new Date(last+'T00:00:00Z'); if(isNaN(d)) return null;
  var m=d.getUTCMonth()+1, y=d.getUTCFullYear(); if(m>11){ m=0; y++; }
  var t=new Date(Date.UTC(y, m, d.getUTCDate()));
  if(t.getUTCMonth()!==((m)%12)) t=new Date(Date.UTC(y, m+1, 0));   // 31 Jan + 1 month → 28/29 Feb
  return t.toISOString().slice(0,10);
}

/* The charging sections a payment can fall under, and the label each one prints as. LHDN's own form
   numbers — a payee filed under the wrong section is remitted on the wrong return, so this table is
   shared rather than retyped anywhere. */
var WHT_TYPES=[['royalty','Royalty — s.109 (CP37)'],['s4a_special','Special classes s.4A — s.109B (CP37D)'],
               ['interest','Interest — s.109 (CP37)'],['contract','Contract payment — s.107A (CP37A/CP37F)'],['other','Other']];
function whtTypeLabel(t){ var f=WHT_TYPES.find(function(x){return x[0]===t;}); return f?f[1]:t; }

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler (webpack/Next, Vite via its commonjs plugin) reads it and hands the
// React app the same functions app.html is calling.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  whtMoney, whtRound2, whtLineSst, whtLineTotal, whtCompute, whtDueDate, WHT_TYPES, whtTypeLabel,
};

// The Sales Reconciliation computation — which payment belongs to which order, what each Xero Sales
// Invoice is NUMBERED, what it is dated, which revenue account it lands in, and how much it is for.
//
// Moved here verbatim from app.html (the Sales Recon block that sat at app.html:3559-3892). Not a
// rewrite: every scoring rule, every date repair, every suffix rule and every rounding step is the same
// source text, because this is the code that decides what a real company's ledger says.
//
// WHY IT LIVES IN ITS OWN FILE: o2o.js's reason, and for the same measured reason rather than by
// analogy. `sr_post_invoices` (supabase/functions/portal/finance.ts:853) recomputes NOTHING — it
// forwards `it.number`, `it.date`, `it.due`, `it.desc`, `it.qty`, `it.amount` and `it.account` straight
// into the Xero `Invoices` payload (finance.ts:870-875), only reformatting DD-MM-YYYY to ISO and
// resolving the org's exempt tax rate. So the figures and the invoice numbers this file produces ARE the
// Xero draft invoices; there is no server-side authority to fall back on the day two copies disagree,
// the way Quick Invoice has in Xero's own `iv.Total`. A React port that re-expressed this arithmetic
// would be a second copy of an accounting engine with nothing checking that the copies agree.
// `web/src/finance-salesrecon.tsx` imports it, through salesrecon.d.ts.
//
// ── The two rules this file lives by (common.js:1-20) ────────────────────────────────────────────
//
// 1. It MUST stay a classic script (<script src="salesrecon.js">, never type="module"), loaded before
//    app.html's inline <script>. The apps wire ~450 inline onclick= handlers that resolve names as
//    globals at click time, and a module's top-level declarations are not global.
// 2. Nothing here runs at load time and nothing here reads app state. In particular `srBuildLines`
//    takes ALREADY-DECODED sheets (`[{name, rows}]`) rather than a workbook, so it needs neither XLSX
//    nor `SR` to exist. The XLSX decode stays in app.html's `srSheetRows()` and in the React route —
//    the same split `bankLines()` has on Bank Rec and `o2oParseRows()` has on O2O.
//
// Dependencies: none. It calls nothing outside this file.
//
// ── The four passes, and why they are separate functions ─────────────────────────────────────────
// `srBuild()` interleaves this arithmetic with three awaits (`sr_yrdz_next`, `sr_so_suffix`), a
// `confirm()` and a stack of `toast()`s. Those are I/O and live in the caller; what is here is the pure
// half of each pass, in the legacy's own order:
//
//   1  srOrderLookup + srBuildLines   SO -> order; then one line per payment row. Matched rows take the
//                                     order's channel account and package; unmatched ones get their
//                                     month period and account 500-1000, numbering deferred.
//   2  srYrdzPeriods + srApplyYrdz    YRDZ_MM'YYYY_#### numbering, CONTINUING from the highest number
//                                     already in Xero for that month (`base`, from sr_yrdz_next). A
//                                     restart at 0001 duplicates a month that was already imported.
//   3  srSoBases + srApplySoSuffix    repeat payments on one SO become SO-XXXXX_1, _2 …, continuing past
//                                     whatever already exists in Xero (`soInfo`, from sr_so_suffix).
//   4  srTally                        Order Form Grand Total vs money received (this file + already in
//                                     Xero). Reports, changes no invoice.
//
// Passes 2 and 3 MUTATE `l.inv` in place, exactly as the legacy loops do; the caller then reads the same
// array. Keep it that way — a copy would mean two arrays that can disagree about an invoice number.
//
// ── The money ────────────────────────────────────────────────────────────────────────────────────
//   Basis          Actual cash received: the line amount is the payment row's own amount, never the
//                  order's Grand Total. A short-paid SO invoices what was paid and is REPORTED short by
//                  srTally, which is the whole point of pass 4.
//   InvoiceDate    the payment-gateway TRANSACTION date, DD-MM-YYYY (`srDmy`). Only when a matched row
//                  has no parseable payment date does it fall back to the Order Date.
//   Date repair    per sheet, from the sheet's own content: `srDetectSwap` de-swaps Excel-corrupted
//                  DD/MM serials, `srDetectTextOrder` decides text order. Neither is applied on a hunch
//                  — a serial day >12 proves the sheet is already correct and disables the repair.
//   Rounding       srTally rounds every figure it compares with Math.round(x*100)/100, and calls a
//                  difference within one sen a tally. The invoice lines themselves are NOT rounded here:
//                  the amount posted is the payment row's own figure, and `srXeroRow` formats it to two
//                  decimals only for the CSV.
//

var SR_CHAN2ACC={ 'WHATSAPP':'500-0600','FACEBOOK':'500-0600','INSTA':'500-0600','COMMUNITY':'500-0600','FB LIVE':'500-0800','WEBSTORE':'500-0200','SHOPEE':'500-0400','EXPO':'500-0900','ILADY O2O':'500-0100','YRDZ':'500-1000' };
var SR_ACCNAME={ '500-0100':'Retail Sales (O2O)','500-0200':'WebStore Sales (Shopify)','500-0300':'COD','500-0400':'Shopee Sales','500-0500':'Lazada Sales','500-0600':'Meta Platform Sales (FB/IG/WhatsApp)','500-0700':'TikTok Sales','500-0800':'Live Streaming Sales','500-0900':'Exhibition Event','500-1000':'One-Day Shop Manager Event' };
var SR_CFG={ 'ATOME':{id:'PIC Name',date:'Transaction Date',amt:'Transaction Amount'},'PAYEX':{id:'PIC Name',date:'Date & Time',amt:'Amount'},'PINE LABS':{id:'PIC Name',date:'Date & Time',amt:'Amount'},'AHAPAY':{id:'PIC Name',date:'Transaction Date & Time',amt:'Transaction Amount'},'UOB BANK':{id:'Databees Order ID',date:'Date',amt:'Deposit'} };
function srAcc(ch){ return SR_CHAN2ACC[String(ch||'').trim().toUpperCase()]||'500-1000'; }
// ── Content-based recognition: the converter reads the DATA (keywords/shapes), never trusts fixed formats. ──
// SO numbers are recognised by pattern anywhere in a cell (any casing/spacing), normalised to SO-IP#####.
function srCanonSO(v){ var m=String(v==null?'':v).match(/SO[\s_-]*IP[\s_-]*(\d{3,})/i); return m?('SO-IP'+m[1]):null; }
// Pick the id/date/amount columns of a sheet by scoring each column's VALUES; header words are only a tiebreaker.
function srSmartCols(rows){
  if(!rows||!rows.length) return null;
  var keys=Object.keys(rows[0]||{}); var best={id:null,date:null,amt:null}, sc={id:0,date:0,amt:0};
  var kw=function(h,words){ h=String(h).toLowerCase(); for(var i=0;i<words.length;i++){ if(h.indexOf(words[i])>=0) return 1; } return 0; };
  keys.forEach(function(k){
    var vals=[]; rows.forEach(function(o){ var v=o[k]; if(v!==''&&v!=null)vals.push(v); });
    if(!vals.length) return; var n=vals.length;
    var so=0,dt=0,num=0;
    vals.forEach(function(v){
      if(srCanonSO(v))so++;
      if((v instanceof Date&&!isNaN(v)) || /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(String(v).trim()))dt++;
      if(!(v instanceof Date) && srNum(v)>0)num++;
    });
    so/=n; dt/=n; num/=n;
    var soS=so+0.2*kw(k,['pic','order id','order no','so no','so number','reference']);
    // Sales date rule: the bank/gateway TRANSACTION date is the sales date — prefer transaction-named
    // date columns, avoid settlement-style ones (Value Date / Posting Date) when both parse as dates.
    var dtS=dt+0.2*kw(k,['date','time'])+0.3*kw(k,['transaction','txn'])-0.25*kw(k,['value','posting','settle']);
    var amS=(dt>0.5?0:num)+0.25*kw(k,['amount','deposit','total','amt','paid','nett','net']);
    if(so>0.02&&soS>sc.id){sc.id=soS;best.id=k;}
    if(dt>0.5&&dtS>sc.date){sc.date=dtS;best.date=k;}
    if(num>0.5&&amS>sc.amt){sc.amt=amS;best.amt=k;}
  });
  if(best.amt===best.date||best.amt===best.id) return null;   // ambiguous sheet — refuse rather than guess
  return (best.date&&best.amt)?best:null;
}
// Text-date order per sheet from CONTENT: first part >12 ⇒ day-first (DD/MM), second part >12 ⇒ month-first (MM/DD).
function srDetectTextOrder(rows,col){
  var dmy=0,mdy=0;
  rows.forEach(function(o){ var v=o[col]; if(v instanceof Date)return; var s=String(v==null?'':v).split(/[ T]/)[0].trim(); var p=s.split(/[\/.\-]/); if(p.length!==3)return; var a=+p[0],b=+p[1]; if(a>12&&b<=12)dmy++; else if(b>12&&a<=12)mdy++; });
  if(mdy>dmy) return 'mdy'; if(dmy>0) return 'dmy'; return null;
}
// Xero can't import Chinese/emoji/weird symbols — translate known CN terms, strip everything non-ASCII.
var SR_ZH=[['普通长期','Standard Long-term'],['回购配套','Repurchase Package'],['普通优惠','Standard Offer'],['线下专属','Offline Exclusive'],['新品','New Item'],['回购','Repurchase'],['优惠','Offer'],['配套','Package'],['12月','December'],['11月','November'],['10月','October'],['1月','January'],['2月','February'],['3月','March'],['4月','April'],['5月','May'],['6月','June'],['7月','July'],['8月','August'],['9月','September']];
function srClean(s){
  if(s==null) return s; s=String(s);
  for(var i=0;i<SR_ZH.length;i++){ s=s.split(SR_ZH[i][0]).join(SR_ZH[i][1]); }
  s=s.split('【').join(' ').split('】').join(' ');
  var out=''; for(var j=0;j<s.length;j++){ out += (s.charCodeAt(j)<128 ? s.charAt(j) : ' '); }
  return out.replace(/\s+/g,' ').trim().replace(/\s+,/g,',').replace(/,\s*,/g,', ');
}
// isFinite, not !isNaN — `isNaN(Infinity)` is false, and these amounts become invoices in Xero.
function srNum(v){ if(v==null||v==='')return 0; var n=Number(String(v).replace(/[, ]/g,'')); return isFinite(n)?n:0; }
function srAnyDate(v){ // clean sources (ISO string or JS Date)
  if(v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(),v.getMonth(),v.getDate());
  var s=String(v==null?'':v).split(/[ T]/)[0].trim(); if(!s)return null;
  var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(m)return new Date(+m[1],+m[2]-1,+m[3]);
  var p=s.split(/[\/.]/); if(p.length===3){ var a=+p[0],b=+p[1],c=+p[2]; if(a>12)return new Date(c,b-1,a); return new Date(c,b-1,a); } return null;
}
// Detect per sheet whether Excel corrupted the date serials by swapping DD/MM -> MM/DD.
// In a SWAPPED sheet the serial day-field is the true MONTH (near-constant, always <=12) while the
// month-field varies (= true days 1-12; true days >12 stay as text). In a CORRECT sheet the month is
// near-constant and days vary — and any serial with day>12 is impossible when swapped.
function srDetectSwap(rows,col){
  var ds={}, ms={}, gt12=0, n=0;
  rows.forEach(function(o){ var v=o[col]; if(v instanceof Date && !isNaN(v)){ n++; var d=v.getDate(), m=v.getMonth()+1; if(d>12)gt12++; ds[d]=1; ms[m]=1; } });
  if(!n) return false;
  if(gt12>0) return false;                                        // a real day >12 exists → serials are already correct
  return Object.keys(ms).length > Object.keys(ds).length;         // months vary more than days → sheet is swapped
}
function srFixDate(v,sheet,swap,ord){ // serials de-swapped ONLY when srDetectSwap flagged the sheet; text order from srDetectTextOrder content evidence (UOB legacy = MM/DD fallback)
  if(v instanceof Date && !isNaN(v)){ var mo=v.getMonth()+1, dy=v.getDate(); if(swap && dy<=12) return new Date(v.getFullYear(), dy-1, mo); return new Date(v.getFullYear(),v.getMonth(),v.getDate()); }
  var s=String(v==null?'':v).split(/[ T]/)[0].trim(); if(!s)return null;
  var iso=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(iso)return new Date(+iso[1],+iso[2]-1,+iso[3]);
  var p=s.split(/[\/.\-]/); if(p.length!==3)return null; var a=+p[0],b=+p[1],c=+p[2];
  var mdy = (ord==='mdy') || (!ord && String(sheet).toUpperCase()==='UOB BANK');
  return mdy ? new Date(c,a-1,b) : new Date(c,b-1,a);
}
function srDmy(d){ if(!(d instanceof Date)||isNaN(d))return ''; return ('0'+d.getDate()).slice(-2)+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+d.getFullYear(); }
function srPer(d){ if(!(d instanceof Date)||isNaN(d))d=new Date(); return ('0'+(d.getMonth()+1)).slice(-2)+"'"+d.getFullYear(); }

// The Xero tenant this import goes into. Lifted with the arithmetic because it is not a preference: the
// YRDZ numbering below only avoids duplicates because sr_yrdz_next was asked about THIS company's Xero.
var SR_TENANT='99911869-9e91-4572-b7dc-4db51b45b6a9'; // I PROCARE — the company this import goes into; YRDZ numbering continues from what already exists in its Xero

// ── PASS 1 ──────────────────────────────────────────────────────────────────────────────────────
// Order Form lookup: SO -> {ch,pkg,odate,gt}. `aoa` is the sheet as
// XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''}) hands it over — the decode stays in the
// caller. `hasGrandTotal` is what decides whether pass 4 runs at all (no column, no tally).
function srOrderLookup(aoa){
  var H=((aoa||[])[0]||[]).map(function(c){return String(c).trim();});
  var iNo=H.indexOf('Order No'), iCh=H.indexOf('Channel'), iPkg=H.indexOf('Package'), iOd=H.indexOf('Order Date'), iGt=H.indexOf('Grand Total');
  var LK={};
  for(var i=1;i<(aoa||[]).length;i++){ var r=aoa[i]||[]; var so=r[iNo]; if(so===''||so==null)continue; so=String(so).trim();
    var cso=srCanonSO(so)||so; // keyword-normalised key (case/spacing tolerant)
    LK[cso]={ch:r[iCh], pkg:(r[iPkg]===''||r[iPkg]==null)?'(no package)':srClean(String(r[iPkg]).trim()), odate:srAnyDate(r[iOd]), gt:(iGt>=0?srNum(r[iGt]):0)}; }
  return { lookup:LK, hasGrandTotal:(iGt>=0) };
}

// One line per payment row of the Sales file. `sheets` is [{name, rows}], where `rows` is srSheetRows()'s
// output for that sheet — the XLSX decode is the caller's, so nothing here needs the vendored library.
// Unmatched rows get their month PERIOD and no number; pass 2 numbers them.
function srBuildLines(LK, sheets){
  LK = LK || {};
  var lines=[];
  var swapNote=[], skipped=[], smartNote=[];
  (sheets||[]).forEach(function(sh){
    var sn=sh.name, rows=sh.rows||[];
    if(!rows.length){ skipped.push(sn+' (empty)'); return; }
    // known layout is only a FAST PATH — and only when its columns actually exist; otherwise recognise by content.
    var cfg=SR_CFG[String(sn).toUpperCase().trim()], cols=null;
    if(cfg && rows[0] && (cfg.date in rows[0]) && (cfg.amt in rows[0])) cols={id:cfg.id,date:cfg.date,amt:cfg.amt};
    else { cols=srSmartCols(rows); if(cols) smartNote.push(sn+' → id:'+(cols.id||'(scan rows)')+' · date:'+cols.date+' · amt:'+cols.amt); }
    if(!cols){ skipped.push(sn+' (no date/amount columns recognised)'); return; }
    var swap=srDetectSwap(rows, cols.date);
    if(swap) swapNote.push(sn);
    var ord=srDetectTextOrder(rows, cols.date);
    rows.forEach(function(o){
      // To the sen, HERE, before the figure is stored on the line.
      //
      // It used to be rounded only by srXeroRow's `toFixed(2)`, i.e. only on the CSV path — so the SAME
      // batch of invoices carried three different answers depending on how it left: the CSV import said
      // RM 350.00, srPostChunks' API body sent RM 350.014 raw, and srSummary/srTally showed RM 350.014
      // and reported a one-sen "discrepancy" against the order that the CSV would not have created.
      // Rounding at construction makes the file, the API body, the on-screen total and the tally the
      // same number by construction. The truthiness guard stays on the RAW value so a sub-half-sen row
      // is still a line (writing 0.00, as it always has) rather than silently vanishing.
      var amtRaw=srNum(o[cols.amt]); if(!amtRaw)return;
      var amt=Math.round(amtRaw*100)/100;
      // SO = keyword pattern, from the id column first, else scanned across the whole row
      var so=cols.id?srCanonSO(o[cols.id]):null;
      if(!so){ for(var kk in o){ if(kk===cols.amt||kk===cols.date)continue; so=srCanonSO(o[kk]); if(so)break; } }
      var pdate=srFixDate(o[cols.date], sn, swap, ord);
      var inv,acc,pkg,ch,idate,matched,per=null;
      if(so && LK[so]){ var od=LK[so]; inv=so; acc=srAcc(od.ch); pkg=od.pkg; ch=srClean(String(od.ch||'').trim()); idate=pdate||od.odate; matched=true; }
      else { per=srPer(pdate); inv=null; acc='500-1000'; pkg='YRDZ_Package_'+amt.toFixed(2); ch='YRDZ (unmatched)'; idate=pdate; matched=false; }
      var ds=srDmy(idate);
      lines.push({contact:'DATABEES',inv:inv,so:(matched?so:null),per:per,date:ds,due:ds,desc:pkg,qty:1,amt:amt,acc:acc,tax:'Tax Exempt',ch:ch,gw:sn,matched:matched});
    });
  });
  return { lines:lines, swapNote:swapNote, skipped:skipped, smartNote:smartNote };
}

// ── PASS 2 ──────────────────────────────────────────────────────────────────────────────────────
// The month prefixes sr_yrdz_next must be asked about. Empty → no unmatched rows, so no call.
function srYrdzPeriods(lines){ var pers=[]; (lines||[]).forEach(function(l){ if(!l.matched && l.per && pers.indexOf(l.per)<0) pers.push(l.per); }); return pers; }

// Number the unmatched rows YRDZ_MM'YYYY_####, CONTINUING from `base` — sr_yrdz_next's `max` map, keyed
// by the same 'YRDZ_'+per+'_' prefix. An empty/absent base restarts at 0001, which is what the legacy
// falls back to only after the operator confirms the duplicate risk. Mutates `l.inv`; returns the
// human-readable "continues from" notes the caller toasts.
function srApplyYrdz(lines, base){
  base = base || {};
  var seq={};
  (lines||[]).forEach(function(l){ if(!l.matched && l.per!=null){ var pfx='YRDZ_'+l.per+'_'; if(seq[l.per]==null) seq[l.per]=Number(base[pfx])||0; seq[l.per]++; l.inv=pfx+('000'+seq[l.per]).slice(-4); } });
  return srYrdzPeriods(lines).filter(function(p){return (Number(base['YRDZ_'+p+'_'])||0)>0;}).map(function(p){return p+' continues from '+('000'+(Number(base['YRDZ_'+p+'_'])+1)).slice(-4);});
}

// ── PASS 3 ──────────────────────────────────────────────────────────────────────────────────────
// The SO numbers sr_so_suffix must be asked about, deduplicated, in first-seen order.
function srSoBases(lines){ var soList=[]; (lines||[]).forEach(function(l){ if(l.matched && soList.indexOf(l.inv)<0) soList.push(l.inv); }); return soList; }

// Repeat payments on one SO become SO-XXXXX_1, _2 …, continuing past whatever already exists in Xero
// (e.g. a deposit imported last month as SO-IP40466 → this month's balance payment becomes
// SO-IP40466_1). `soInfo` is sr_so_suffix's `existing` map: {taken, max, prev_total} per base. Mutates
// `l.inv`; returns how many were suffixed.
function srApplySoSuffix(lines, soInfo){
  soInfo = soInfo || {};
  var soSeq={}, soDup=0;
  (lines||[]).forEach(function(l){ if(!l.matched) return; var so=l.inv; var info=soInfo[so]||{taken:false,max:0}; var mx=Number(info.max)||0;
    var k=(soSeq[so]==null)?0:(soSeq[so]+1); soSeq[so]=k;
    var idx;
    if(info.taken) idx=mx+1+k;                 // base already in Xero → every payment here gets the next suffix
    else if(mx>0) idx=(k===0)?0:(mx+k);        // base free but _N exist → base first, then continue past _N
    else idx=k;                                // fresh SO → base, then _1, _2 …
    if(idx>0){ l.inv=so+'_'+idx; soDup++; }
  });
  return soDup;
}

// ── PASS 4 ──────────────────────────────────────────────────────────────────────────────────────
// SO amount tally: Order Form Grand Total vs money received (this file + already invoiced in Xero).
// Reports only — it changes no invoice. Sorted by the size of the difference, worst first.
function srTally(lines, LK, soInfo){
  LK = LK || {}; soInfo = soInfo || {};
  var paidFile={}; (lines||[]).forEach(function(l){ if(l.matched&&l.so){ paidFile[l.so]=Math.round(((paidFile[l.so]||0)+l.amt)*100)/100; } });
  return Object.keys(paidFile).map(function(s){
    var od=LK[s]||{}; var order=Math.round((Number(od.gt)||0)*100)/100;
    var prev=(soInfo[s]&&Number(soInfo[s].prev_total))||0;
    var fileAmt=paidFile[s]; var total=Math.round((prev+fileAmt)*100)/100;
    var diff=Math.round((total-order)*100)/100;
    var st=(order<=0)?'no-total':(Math.abs(diff)<=0.01?'tally':(diff<0?'short':'over'));
    return { so:s, ch:srClean(String(od.ch||'').trim()), order:order, prev:prev, file:fileAmt, total:total, diff:diff, st:st };
  }).sort(function(a,b){ return Math.abs(b.diff)-Math.abs(a.diff); });
}

// ── WHAT THE RESULT SCREEN AND THE REPORT ADD UP ────────────────────────────────────────────────
// The four cards and the "Revenue by Account" table, from the lines and nothing else. Lifted with the
// rest because a total that stops summing is the same class of defect as a wrong invoice number: the
// operator reads these before pressing "Create in Xero", and the same byAcc figures are the xlsx
// report's "Xero Summary" sheet.
function srSummary(lines){
  var tot=0, mt=0, um=0, umAmt=0, byAcc={};
  (lines||[]).forEach(function(l){ tot+=l.amt; if(l.matched)mt++; else {um++; umAmt+=l.amt;} var a=byAcc[l.acc]||(byAcc[l.acc]={n:0,amt:0,ch:{}}); a.n++; a.amt+=l.amt; a.ch[l.ch]=1; });
  return { tot:tot, matched:mt, unmatched:um, unmatchedAmt:umAmt, byAcc:byAcc };
}

var SR_COLS=['*ContactName','*InvoiceNumber','*InvoiceDate','*DueDate','*Description','*Quantity','*UnitAmount','*AccountCode','*TaxType'];
function srRowArr(l){ return [l.contact,l.inv,l.date,l.due,l.desc,l.qty,l.amt,l.acc,l.tax]; }
function srTag(lines){ var ds=(lines||[]).map(function(l){return l.date;}).filter(Boolean).sort(); return ds.length?(ds[0].replace(/\//g,'')+'_'+ds[ds.length-1].replace(/\//g,'')):'export'; }
// Exact Xero "Sales Invoices" import template (29 columns, order matters).
var SR_XERO_COLS=['*ContactName','EmailAddress','POAddressLine1','POAddressLine2','POAddressLine3','POAddressLine4','POCity','PORegion','POPostalCode','POCountry','*InvoiceNumber','Reference','*InvoiceDate','*DueDate','Total','InventoryItemCode','*Description','*Quantity','*UnitAmount','Discount','*AccountCode','*TaxType','TaxAmount','TrackingName1','TrackingOption1','TrackingName2','TrackingOption2','Currency','BrandingTheme'];
function srXeroRow(l){
  var m={'*ContactName':l.contact,'*InvoiceNumber':l.inv,'Reference':l.inv,'*InvoiceDate':l.date,'*DueDate':l.due,'*Description':l.desc,'*Quantity':'1','*UnitAmount':l.amt.toFixed(2),'*AccountCode':l.acc,'*TaxType':l.tax,'Currency':'MYR'};
  return SR_XERO_COLS.map(function(h){ return (m[h]!=null?m[h]:''); });
}

// ── WHAT LEAVES THE BUILDING ────────────────────────────────────────────────────────────────────
// The CSV is the Xero "Sales Invoices" import file; the POST body is the same invoices going in over the
// API. Both are pinned by assertion in web/tests/finance-salesrecon.parity.test.tsx — no golden sees a
// file or a request body, so this is the only place either is provable.

// The Xero Sales CSV, whole. `q` is the legacy's own quoting rule and the '﻿' BOM is the legacy's
// too — Excel reads the file as Latin-1 without it. CRLF, as the legacy writes.
function srCsv(lines){
  var q=function(x){ x=String(x==null?'':x); return /[",\n\r]/.test(x)?('"'+x.replace(/"/g,'""')+'"'):x; };
  var out=[SR_XERO_COLS.join(',')];
  (lines||[]).forEach(function(l){ out.push(srXeroRow(l).map(q).join(',')); });
  return '﻿'+out.join('\r\n');
}

// srPostXero() posts in batches of 150. The chunk size is part of the contract, not a preference: the
// legacy reports progress and BREAKS on the first failed batch, leaving the earlier batches created.
var SR_POST_CHUNK=150;
function srPostChunks(lines){
  var out=[];
  for(var i=0;i<(lines||[]).length;i+=SR_POST_CHUNK){
    out.push(lines.slice(i,i+SR_POST_CHUNK).map(function(l){ return { number:l.inv, date:l.date, due:l.due, desc:l.desc, qty:1, amount:l.amt, account:l.acc, contact:l.contact||'DATABEES' }; }));
  }
  return out;
}
function srPostBody(tenant, chunk){
  if(!tenant) throw new Error('tenant required');
  return { api:'sr_post_invoices', tenant:tenant, invoices:chunk };
}

// The three (or four) sheets of the xlsx report, as arrays of arrays. The caller turns them into a
// workbook; the column headings and the row order are here so the React route cannot fork them.
function srReportSheets(lines, tally){
  lines = lines || [];
  var imp=[SR_COLS.concat(['Channel','Gateway'])]; lines.forEach(function(l){ imp.push(srRowArr(l).concat([l.ch,l.gw])); });
  var byAcc={}; lines.forEach(function(l){ var a=byAcc[l.acc]||(byAcc[l.acc]={n:0,amt:0}); a.n++; a.amt+=l.amt; });
  var sm=[['Account Code','Account Name','Lines','Amount (MYR)']]; Object.keys(byAcc).sort().forEach(function(c){ sm.push([c,SR_ACCNAME[c]||'',byAcc[c].n,Math.round(byAcc[c].amt*100)/100]); });
  var un=[SR_COLS.concat(['Gateway'])]; lines.filter(function(l){return !l.matched;}).forEach(function(l){ un.push(srRowArr(l).concat([l.gw])); });
  var out=[{ name:'Sales Import', rows:imp }, { name:'Xero Summary', rows:sm }, { name:'Unmatched (YRDZ)', rows:un }];
  if(tally){
    var ty=[['SO','Channel','Order Form Grand Total','Already in Xero','This file','Total paid','Diff','Status']];
    tally.forEach(function(x){ ty.push([x.so,x.ch,x.order,x.prev,x.file,x.total,x.diff,x.st]); });
    out.push({ name:'SO Tally', rows:ty });
  }
  return out;
}

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler (webpack/Next, Vite via its commonjs plugin) reads it and hands the
// React app the same functions app.html is calling.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  SR_CHAN2ACC, SR_ACCNAME, SR_CFG, SR_ZH, SR_COLS, SR_XERO_COLS, SR_TENANT, SR_POST_CHUNK,
  srAcc, srCanonSO, srSmartCols, srDetectTextOrder, srClean, srNum, srAnyDate, srDetectSwap,
  srFixDate, srDmy, srPer, srOrderLookup, srBuildLines, srYrdzPeriods, srApplyYrdz, srSoBases,
  srApplySoSuffix, srTally, srSummary, srRowArr, srTag, srXeroRow, srCsv, srPostChunks, srPostBody,
  srReportSheets,
};

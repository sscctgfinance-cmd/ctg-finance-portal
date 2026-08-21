// The P&L Analysis computation — what a month of Xero account rows becomes on the P&L grid.
//
// Moved here verbatim from app.html (the P&L block that sat at app.html:4359-4470 before this
// migration). Not a rewrite: every subtotal, every sign, every rounding-free sum and every ordering
// rule is the same source text, because these numbers ARE the profit-and-loss statement an operator
// reads and exports.
//
// WHY IT LIVES IN ITS OWN FILE: gateway.js's reason, and it applies here for the same reason it applied
// there. `pnl_analysis` (finance.ts:2034) is a pass-through to the `portal_pnl_analysis` RPC, which
// sends per-account `rows[].by_month[m].amount/.pct` and per-month `totals[m]` — and NOTHING else. Every
// figure this screen adds up is derived in the browser: the section subtotals, Gross Profit, the cost
// blocks and their subtotals, Total Operating Expenses, the row totals, the % basis. The screen posts
// none of them back (`export_log` carries a row COUNT, not a number), so there is no second computation
// anywhere that could disagree and be noticed. A React port that re-expressed pnlBuild() would be a
// second P&L engine with nothing checking the copies agree, and the failure mode is a cost line that
// stops rolling into its subtotal on one screen and not the other.
// `web/src/finance-pnl.tsx` imports it, through pnl.d.ts.
//
// NOT here, deliberately: Net Profit. It is Xero's own authoritative figure, taken straight from
// `totals[m].net_profit` and never recomputed as revenue − expenses — see pnlBuild()'s own comment.
//
// ── The two rules this file lives by (common.js:1-20) ────────────────────────────────────────────
// 1. Classic script (<script src="pnl.js">, never type="module"), loaded before app.html's inline
//    <script> — the apps wire ~450 inline onclick= handlers that resolve names as globals at click time.
// 2. Nothing here runs at load time and nothing here reads app state. `pnlBuild` takes the response,
//    the month count and the show-zero flag as ARGUMENTS rather than reading the PNL_DATA / PNL_MONTHS /
//    PNL_SHOW_ZERO globals it used to, and `pnlSecRows` takes the response. Nothing here touches the
//    DOM, `M()`, `esc()` or a clock — the rendering, the download and the toast stay in app.html's
//    pnlRender()/pnlExportCsv() and in the React route, the same split bankLines() uses on Bank Rec.
//
// Dependencies: none. It calls nothing outside this file.
//
// ── The order of the grid, which is part of the statement ────────────────────────────────────────
//   Trading Income → accounts → Total Trading Income
//   Cost of Sales  → accounts → Total Cost of Sales
//   Gross Profit   = Total Trading Income − Total Cost of Sales
//   Other Income   → accounts → Total Other Income      (only when there are Other Income rows)
//   Operating Expenses → one block per CTG cost block (PNL_BLOCK_ORDER first, then whatever else the
//                        backend sends) → accounts → Total <BLOCK> Cost
//                     → Total Operating Expenses
//   Net Profit     = totals[m].net_profit, from Xero.
//
// A missing month for an account is null, never 0: a subtotal of only-nulls stays null so the grid
// prints "—" rather than a confident RM 0.00 for a month nobody has closed.

var PNL_BLOCK_ORDER=['STAFF','CTG','BD&M','G&A','FIN','OTHER'];
var PNL_BLOCK_COLORS={'STAFF':'#5b9bd5','CTG':'#0E9D67','BD&M':'#E0714E','G&A':'#f5a623','FIN':'#a479e2','OTHER':'#8892a6'};

// ── Cell accessors: an account may be missing from a month entirely → null, never NaN/0. ──
function pnlAmt(row,m){ var c=(row&&row.by_month)?row.by_month[m]:null; if(!c||c.amount==null) return null; var v=Number(c.amount); return isFinite(v)?v:null; }
function pnlPct(row,m){ var c=(row&&row.by_month)?row.by_month[m]:null; if(!c||c.pct==null) return null; var v=Number(c.pct); return isFinite(v)?v:null; }
function pnlSecRows(d,section){ return (((d||{}).rows)||[]).filter(function(r){ return r.section===section; }); }
function pnlSumAt(rows,m){ var any=false,s=0; (rows||[]).forEach(function(r){ var v=pnlAmt(r,m); if(v!==null){ any=true; s+=v; } }); return any?s:null; }
function pnlRowTotal(row,months){ var any=false,s=0; months.forEach(function(m){ var v=pnlAmt(row,m); if(v!==null){ any=true; s+=v; } }); return any?s:null; }

// Builds the display model once — the grid and the CSV both render from it, so the export
// matches the screen exactly (raw numbers, so Excel can sum the cells).
function pnlBuild(data,monthsN,showZero){
  var d=data||{}, totals=d.totals||{};
  var months=(d.months||[]).slice(0,monthsN);
  var ti=pnlSecRows(d,'Trading Income'), cs=pnlSecRows(d,'Cost of Sales'),
      oi=pnlSecRows(d,'Other Income'), oe=pnlSecRows(d,'Operating Expenses');
  var hasRows=!!(d.rows&&d.rows.length);
  // % of revenue basis = Total Trading Income for that month (from rows; totals as fallback).
  var rev={}; months.forEach(function(m){
    var v=hasRows?pnlSumAt(ti,m):null;
    if(v===null){ var t=totals[m]; v=t?Number(t.revenue!=null?t.revenue:t.income):null; }
    rev[m]=(v===null||!isFinite(v))?null:v;
  });
  var pctOf=function(v,m){ return (v!==null&&rev[m])?(v/rev[m]):null; };
  var band=function(label){ return {kind:'band',label:label,vals:months.map(function(){return {amt:null,pct:null};}),total:null}; };
  var acctRows=function(rows){
    return rows.filter(function(r){
      if(showZero) return true;
      return months.some(function(m){ var v=pnlAmt(r,m); return v!==null && Math.abs(v)>0.005; });
    }).map(function(r){
      return {kind:'acct',label:r.account||'—',
        vals:months.map(function(m){ return {amt:pnlAmt(r,m),pct:pnlPct(r,m)}; }),
        total:pnlRowTotal(r,months)};
    });
  };
  var totRow=function(kind,label,rows){
    var vals=months.map(function(m){ var v=pnlSumAt(rows,m); return {amt:v,pct:pctOf(v,m)}; });
    var any=vals.some(function(c){ return c.amt!==null; });
    return {kind:kind,label:label,vals:vals,total:any?vals.reduce(function(s,c){return c.amt===null?s:s+c.amt;},0):null};
  };
  var out=[];
  out.push(band('Trading Income'));
  out=out.concat(acctRows(ti));
  var tiRow=totRow('sub','Total Trading Income',ti); out.push(tiRow);
  out.push(band('Cost of Sales'));
  out=out.concat(acctRows(cs));
  var csRow=totRow('sub','Total Cost of Sales',cs); out.push(csRow);
  // Gross Profit = Total Trading Income − Total Cost of Sales.
  var gpVals=months.map(function(m,i){
    var a=tiRow.vals[i].amt, b=csRow.vals[i].amt;
    if(a===null&&b===null) return {amt:null,pct:null};
    var v=(a||0)-(b||0); return {amt:v,pct:pctOf(v,m)};
  });
  var gpAny=gpVals.some(function(c){return c.amt!==null;});
  out.push({kind:'key',label:'Gross Profit',vals:gpVals,total:gpAny?gpVals.reduce(function(s,c){return c.amt===null?s:s+c.amt;},0):null});
  if(oi.length){
    out.push(band('Other Income'));
    out=out.concat(acctRows(oi));
    out.push(totRow('sub','Total Other Income',oi));
  }
  out.push(band('Operating Expenses'));
  // Group opex by CTG cost block, known blocks first, then anything else the backend sends.
  var seen={}, order=[];
  PNL_BLOCK_ORDER.forEach(function(b){ if(oe.some(function(r){return (r.block||'OTHER')===b;})){ order.push(b); seen[b]=1; } });
  oe.forEach(function(r){ var b=r.block||'OTHER'; if(!seen[b]){ seen[b]=1; order.push(b); } });
  order.forEach(function(b){
    var brows=oe.filter(function(r){ return (r.block||'OTHER')===b; });
    var accts=acctRows(brows);
    if(!accts.length && !showZero) return;
    out.push({kind:'blk',label:b,vals:months.map(function(){return {amt:null,pct:null};}),total:null});
    out=out.concat(accts);
    out.push(totRow('sub','Total '+b+' Cost',brows));
  });
  out.push(totRow('sub','Total Operating Expenses',oe));
  // Net Profit is Xero's own authoritative figure — never recomputed as revenue − expenses.
  var npVals=months.map(function(m){
    var t=totals[m]; var v=(t&&t.net_profit!=null)?Number(t.net_profit):null;
    if(v!==null&&!isFinite(v)) v=null;
    return {amt:v,pct:pctOf(v,m)};
  });
  var npAny=npVals.some(function(c){return c.amt!==null;});
  out.push({kind:'key',label:'Net Profit',vals:npVals,total:npAny?npVals.reduce(function(s,c){return c.amt===null?s:s+c.amt;},0):null});
  return {months:months,rows:out,rev:rev,hasRows:hasRows,
          tiRow:tiRow,csRow:csRow,gpVals:gpVals,npVals:npVals,
          opexRow:out.filter(function(r){return r.label==='Total Operating Expenses';})[0]};
}

/**
 * The CSV of the grid exactly as displayed — RAW numbers, so the cells stay summable in Excel.
 * app.html's pnlExportCsv() body, minus the Blob, the anchor and the toast.
 *
 * `mdl` is a pnlBuild() result and `totals` is the response's own totals map (only the !hasRows branch
 * reads it). Band and block rows are a bare label line, exactly as the legacy wrote them.
 */
function pnlCsvLines(mdl,totals){
  var months=mdl.months;
  var q=function(s){ s=String(s==null?'':s); return /[",\n]/.test(s)?('"'+s.replace(/"/g,'""')+'"'):s; };
  var lines=[['Account'].concat(months).concat(['Total']).map(q).join(',')];
  if(!mdl.hasRows){
    lines=[['Month','Income','Expenses','Net profit'].map(q).join(',')];
    months.forEach(function(m){ var t=(totals||{})[m]||{};
      lines.push([q(m),(t.income==null?'':t.income),(t.expenses==null?'':t.expenses),(t.net_profit==null?'':t.net_profit)].join(',')); });
  } else {
    mdl.rows.forEach(function(r){
      if(r.kind==='band'||r.kind==='blk'){ lines.push(q(r.label)); return; }
      lines.push([q(r.label)].concat(r.vals.map(function(c){ return (c&&c.amt!==null&&c.amt!==undefined)?c.amt:''; }))
        .concat([(r.total===null||r.total===undefined)?'':r.total]).join(','));
    });
  }
  return lines;
}

/**
 * The download's file name — `CTG_PnL[_<Company>]_<n>mo_<YYYY-MM-DD>.csv` (app.html's pnlExportCsv).
 *
 * `coName` is the company picker's RAW option text; the [^A-Za-z0-9]→'_' sanitisation is the legacy's
 * own and stays with the name so both callers get the same file. `today` is handed in as an
 * already-formatted MYT date string (app.html and the route both pass
 * todayLocalISO()), so nothing in this file reads a clock — a date derived here would be derived under
 * the machine's zone, and this filename is what an operator finds the export by six months later.
 */
function pnlCsvName(coName,monthsLen,today){
  var co=String(coName==null?'':coName).replace(/[^A-Za-z0-9]/g,'_');
  return 'CTG_PnL'+((co&&co.indexOf('All')<0)?('_'+co):'')+'_'+monthsLen+'mo_'+today+'.csv';
}

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler reads it and hands the React app the same functions app.html calls.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  PNL_BLOCK_ORDER, PNL_BLOCK_COLORS,
  pnlAmt, pnlPct, pnlSecRows, pnlSumAt, pnlRowTotal, pnlBuild, pnlCsvLines, pnlCsvName,
};

// The Gateway → Xero conversion — what a payment-gateway export becomes when it lands in Xero.
//
// Moved here verbatim from app.html (the Gateway block that sat at app.html:3900-4236 before this migration). Not a rewrite:
// every column name, every date parse, every rounding step and every consolidation key is the same
// source text, because these numbers ARE the bank statement an operator imports into a real ledger.
//
// WHY IT LIVES IN ITS OWN FILE: o2o.js's reason, and here it is sharper still. O2O at least POSTS
// through `o2o_issue`; this screen talks to no server at all. The CSV it writes is downloaded from the
// browser and imported straight into Xero, so there is no second computation anywhere — not on the
// server, not at Xero — that could disagree and be noticed. A React port that re-expressed these four
// per-gateway parsers would be a second copy of a bank-statement engine with nothing checking that the
// copies agree, and the failure mode is a fee booked as gross or a payout dated on the wrong day.
// `web/src/finance-gateway.tsx` imports it, through gateway.d.ts.
//
// ── The two rules this file lives by (common.js:1-20) ────────────────────────────────────────────
// 1. Classic script (<script src="gateway.js">, never type="module"), loaded before app.html's inline
//    <script> — the apps wire ~450 inline onclick= handlers that resolve names as globals at click time.
// 2. Nothing here runs at load time and nothing here reads app state. The converters take the loaded
//    FILES and the audit accumulator as ARGUMENTS rather than reading the `GW` global they used to, and
//    they take already-decoded rows rather than an ArrayBuffer — so they need neither `GW`, nor `XLSX`,
//    nor the DOM. The XLSX decode and the file detection wiring stay in app.html's `gwHandleFiles()`
//    and in the React route, the same split `bankLines()` uses on the Bank Rec screen.
//
// Dependencies: none. It calls nothing outside this file.
//
// ── The four gateways, and what each one's money means ───────────────────────────────────────────
//   Payex     Two files. Money-in is Amount − RefundAmount per transaction. Settlement consolidates per
//             SettlementDate but keeps NetPayex and NetOthers as SEPARATE payout AND fee lines — a row's
//             stream is Payex when NetPayex is non-zero, else Others, and MDR follows the stream.
//   Atome     Two files. Money-in is Transaction Amount. One payout line (−total) + one fee line
//             (payout − Total Sales, i.e. MDR + SST + rebates) per Payout Date.
//   HitPay    Two files, and the only DERIVED rate: the settlement report has no fee column, so the
//             effective rate (fee ÷ gross, from the transaction report; 1.5% if there is no transaction
//             file) grosses each net payout up and the difference is the MDR fee.
//   NTT Data  ONE file. Payout and MDR are derived from the same transaction rows and consolidated per
//             TRANSACTION date — a proxy for the real deposit date, which the screen says out loud.
//
// Rounding: every figure that leaves this file is rounded to the sen with Math.round(x*100)/100, at the
// same points the legacy rounded. Rounding earlier or later changes the statement.

var GW_REFOPTS={
  payex:[['TransactionId','TransactionId (unique per sale)'],['ReferenceNumber','ReferenceNumber'],['CollectionReferenceNumber','CollectionReferenceNumber'],['CollectionId','CollectionId']],
  atome:[['Atome Order ID','Atome Order ID'],['Transaction ID','Transaction ID'],['E-commerce Platform Order ID','E-commerce Platform Order ID']],
  hitpay:[['ID','Payment ID (unique per sale)'],['Order ID','Order ID'],['Additional Reference','Additional Reference']],
  nttdata:[['gateway_tx_id','Gateway Txn ID (unique per sale)'],['mah_ref','Merchant Ref (mah_ref)']]
};
function gwMoney(n){ n=Number(n)||0; return (n<0?'-':'')+'RM '+Math.abs(n).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function gwNum(v){ if(v==null||v==='')return 0; var n=Number(String(v).replace(/[, ]/g,'')); return isNaN(n)?0:n; }
/**
 * To the sen. Every AMOUNT on every row goes through this before it is stored on the row.
 *
 * It has to happen here and not at the CSV writer, which is where it used to happen (`toFixed(2)`):
 * the row objects are ALSO what gwTotals() sums for the four summary cards, so an unrounded row made
 * the card and the file disagree — RM 256.79 on screen over a CSV that adds to RM 256.78. HitPay is
 * where it bites hardest (it charges in SGD and settles in MYR, so "Converted Amount in MYR" genuinely
 * carries sub-sen digits), but a plain `Amount − RefundAmount` in binary floating point is enough.
 */
function gwRnd(n){ return Math.round((Number(n)||0)*100)/100; }
function gwPick(row,name){ if(row[name]!=null&&row[name]!=='')return row[name]; var t=name.toLowerCase(); for(var k in row){ if(k.toLowerCase()===t) return row[k]; } return ''; }
function gwParseDate(v){
  if(v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(),v.getMonth(),v.getDate());
  var s=String(v==null?'':v).trim(); if(!s) return null; s=s.split(/[ T]/)[0];
  var m=s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if(m){ var d=+m[1],mo=+m[2],y=+m[3]; if(y<100)y+=2000; return new Date(y,mo-1,d); }
  var m2=s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/); if(m2) return new Date(+m2[1],+m2[2]-1,+m2[3]);
  var d2=new Date(s); return isNaN(d2)?null:d2;
}
function gwFmtDate(d,fmt){ if(!d)return ''; var dd=('0'+d.getDate()).slice(-2),mm=('0'+(d.getMonth()+1)).slice(-2),yy=d.getFullYear(); return fmt==='ymd'?(yy+'-'+mm+'-'+dd):(dd+'/'+mm+'/'+yy); }

function gwProvLabel(p){ return p==='payex'?'Payex':p==='atome'?'Atome':p==='hitpay'?'HitPay':'NTT Data'; }

function gwDetect(keys){
  // NTT Data: single transaction-level statement — very distinctive columns (no separate payout file).
  if(keys.indexOf('merchant_mdr_amount')>=0 && keys.indexOf('net_amount')>=0 && (keys.indexOf('gateway_tx_id')>=0||keys.indexOf('tx_amount')>=0)) return ['nttdata','txn'];
  // HitPay: payout file has "Payout ID" + "Net Payout Amount"; txn file has "Net/Converted Amount in MYR"
  if(keys.indexOf('payout id')>=0 && keys.indexOf('net payout amount')>=0) return ['hitpay','payout'];
  if(keys.indexOf('net amount in myr')>=0 || keys.indexOf('converted amount in myr')>=0 || keys.indexOf('all inclusive fee amount in myr')>=0) return ['hitpay','txn'];
  if(keys.indexOf('payout id')>=0 && keys.indexOf('payout amount')>=0) return ['atome','payout'];
  if(keys.indexOf('atome order id')>=0 || (keys.indexOf('amount receivable')>=0 && keys.indexOf('transaction amount')>=0)) return ['atome','txn'];
  if(keys.indexOf('settlementdate')>=0 && keys.indexOf('mdr')>=0) return ['payex','set'];
  if(keys.indexOf('customername')>=0 || (keys.indexOf('transactionid')>=0 && keys.indexOf('merchant')>=0)) return ['payex','txn'];
  return null;
}

// ── The four converters ─────────────────────────────────────────────────────────────────────────
// Signature change from the app.html original, and the ONLY change: each takes `f` (that provider's
// loaded files, `{txn,set}` / `{txn,payout}`) and `A` (the audit accumulator) as arguments, where the
// legacy read them off the `GW` global. Everything below that line is the legacy source text.
// HitPay: charges in SGD, settled in MYR. Money-in = Converted Amount in MYR (gross);
// fees are per-transaction (All Inclusive Fee, incl. Stripe) — aggregated to one line per day;
// payouts = Net Payout Amount from the payout file.
function gwConvertHitpay(f,A,fmt,refField,wantPayout,wantFee){
  var rows=[];
  // Money-in: one line per transaction (gross MYR). Also accumulate the effective HitPay fee rate
  // (fee ÷ gross) from the transaction report — the settlement report has no fee column, so the MDR
  // fee must be derived by grossing-up each net payout, then dated on the settlement (Payout) date.
  var grossSum=0, feeSum=0;
  if(f.txn) f.txn.rows.forEach(function(r){
    A.txnRead++;
    var d=gwParseDate(gwPick(r,'Completed Date')); if(!d){A.txnNoDate++; return;}
    var gross=gwNum(gwPick(r,'Converted Amount in MYR'))-gwNum(gwPick(r,'Refunded Amount'));
    if(gross===0){A.txnZero++; return;}
    // The RATE stays on the raw figures — that is what HitPay actually charged on what they actually
    // processed, and rounding the denominator would put a small error into a rate applied to every
    // payout. Only the ROW is rounded, and only after the zero test: a row of 0.004 still counts as
    // converted and still writes a 0.00 line, which is what it has always done.
    grossSum+=gross; feeSum+=gwNum(gwPick(r,'All Inclusive Fee Amount in MYR'));
    gross=gwRnd(gross);
    A.txnConv++;
    var id=String(gwPick(r,'ID')||'').trim(), oid=String(gwPick(r,'Order ID')||'').trim();
    var method=String(gwPick(r,'Payment Details')||gwPick(r,'Method')||'PayNow').trim();
    var ref=String(gwPick(r,refField)||gwPick(r,'ID')||gwPick(r,'Order ID')||'').trim();
    rows.push({d:d,date:gwFmtDate(d,fmt),amount:gross,payee:'HitPay',desc:method+(oid?(' '+oid):(id?(' '+id):'')),ref:ref,kind:gross<0?'out':'in'});
  });
  var feeRate = grossSum>0 ? (feeSum/grossSum) : 0.015;   // effective HitPay rate; fallback 1.5% if no txn file
  A.hpFeeRate=feeRate;
  // Payout + MDR fee, BOTH consolidated per Payout Date and dated on the settlement date. Payout net
  // comes straight from the settlement report; the fee = grossed-up net − net (what HitPay deducted).
  if(f.payout){
    var poByDate={};
    f.payout.rows.forEach(function(r){ A.poRead++;
      var d=gwParseDate(gwPick(r,'Payout Date')); if(!d){A.poNoDate++; return;}
      var k=gwFmtDate(d,'ymd');
      if(!poByDate[k]) poByDate[k]={d:d,net:0,n:0};
      poByDate[k].net+=gwNum(gwPick(r,'Net Payout Amount')); poByDate[k].n++;
    });
    Object.keys(poByDate).forEach(function(k){ var b=poByDate[k], net=Math.round(b.net*100)/100;
      if(wantPayout && net){ A.poConv++; rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-net,payee:'HitPay',desc:'HitPay settlement payout to bank'+(b.n>1?(' ('+b.n+' payouts)'):''),ref:'HITPAY-PAYOUT-'+k,kind:'out'}); }
      if(wantFee){ var gross=(feeRate<1)? net/(1-feeRate) : net; var fee=Math.round((gross-net)*100)/100;
        if(fee) rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-fee,payee:'HitPay',desc:'HitPay MDR fee ('+(feeRate*100).toFixed(2)+'% of settled gross)',ref:'HITPAY-MDR-'+k,kind:'fee'}); }
    });
  }
  return rows;
}
function gwConvertPayex(f,A,fmt,refField,wantPayout,wantFee){
  var rows=[];
  // Money-in: one line per transaction (gross the customer paid into the clearing account).
  if(f.txn) f.txn.rows.forEach(function(r){
    A.txnRead++;
    var d=gwParseDate(gwPick(r,'Date')); if(!d){A.txnNoDate++; return;}
    var net=gwRnd(gwNum(gwPick(r,'Amount'))-gwNum(gwPick(r,'RefundAmount')));
    if(net===0){A.txnZero++; return;}
    A.txnConv++;
    if(String(gwPick(r,'SettlementDate')||'').trim()) A.pxSettled++; else { A.pxUnsettled++; A.pxUnsettledAmt+=net; }
    var ref=String(gwPick(r,refField)||gwPick(r,'TransactionId')||gwPick(r,'ReferenceNumber')||'').trim();
    var cust=String(gwPick(r,'CustomerName')||'').trim()||'Payex customer';
    var method=String(gwPick(r,'TransactionType')||'payment').trim();
    rows.push({d:d,date:gwFmtDate(d,fmt),amount:net,payee:cust,desc:'Payex '+method,ref:ref,kind:net<0?'out':'in'});
  });
  // Settlement: consolidate per SettlementDate, but keep NetPayex and NetOthers as SEPARATE lines — for
  // both the payout and the MDR fee. A row's stream is Payex when NetPayex is non-zero, else Others
  // (SettledBy=Payex ⟺ NetPayex>0, verified); MDR is attributed to whichever stream the row settled under.
  if(f.set){
    var byDate={}, rnd=function(x){return Math.round(x*100)/100;};
    f.set.rows.forEach(function(r){ A.poRead++; var d=gwParseDate(gwPick(r,'SettlementDate')); if(!d){A.poNoDate++; return;} var k=gwFmtDate(d,'ymd');
      if(!byDate[k]) byDate[k]={d:d,npx:0,noth:0,mdrPx:0,mdrOth:0};
      var npx=gwNum(gwPick(r,'NetPayex')), noth=gwNum(gwPick(r,'NetOthers')), mdr=gwNum(gwPick(r,'MDR'));
      var isPayex = npx!==0 ? true : (noth!==0 ? false : String(gwPick(r,'SettledBy')||'').trim()==='Payex');
      byDate[k].npx+=npx; byDate[k].noth+=noth;
      if(isPayex) byDate[k].mdrPx+=mdr; else byDate[k].mdrOth+=mdr;
    });
    Object.keys(byDate).forEach(function(k){ var b=byDate[k];
      if(wantPayout && rnd(b.npx)){  A.poConv++; rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-rnd(b.npx), payee:'Payex',desc:'Payex settlement payout - NetPayex',  ref:'PAYOUT-PAYEX-'+k,  kind:'out'}); }
      if(wantPayout && rnd(b.noth)){ A.poConv++; rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-rnd(b.noth),payee:'Payex',desc:'Payex settlement payout - NetOthers', ref:'PAYOUT-OTHERS-'+k, kind:'out'}); }
      if(wantFee && rnd(b.mdrPx))    rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-rnd(b.mdrPx), payee:'Payex',desc:'Payex MDR fee - NetPayex',  ref:'MDR-PAYEX-'+k,  kind:'fee'});
      if(wantFee && rnd(b.mdrOth))   rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-rnd(b.mdrOth),payee:'Payex',desc:'Payex MDR fee - NetOthers', ref:'MDR-OTHERS-'+k, kind:'fee'});
    });
  }
  return rows;
}
function gwConvertAtome(f,A,fmt,refField,wantPayout,wantFee){
  var rows=[];
  // Money-in: one line per transaction (gross the customer purchased via Atome BNPL).
  if(f.txn) f.txn.rows.forEach(function(r){
    A.txnRead++;
    var d=gwParseDate(gwPick(r,'Transaction Time')); if(!d){A.txnNoDate++; return;}
    var amt=gwRnd(gwNum(gwPick(r,'Transaction Amount')));
    if(amt===0){A.txnZero++; return;}
    A.txnConv++;
    var ref=String(gwPick(r,refField)||gwPick(r,'Atome Order ID')||gwPick(r,'Transaction ID')||'').trim();
    var plan=String(gwPick(r,"Customer's Payment Plan")||gwPick(r,'Transaction Type')||'').trim();
    rows.push({d:d,date:gwFmtDate(d,fmt),amount:amt,payee:'Atome',desc:('Atome'+(plan?(' '+plan):'')),ref:ref,kind:amt<0?'out':'in'});
  });
  // Settlement: consolidate per Payout Date — ONE payout line (−total net) + ONE fee line (all Atome
  // fees summed) per date. Multiple payout batches on the same day merge into a single line each.
  if(f.payout){
    var byDate={}, rnd=function(x){return Math.round(x*100)/100;};
    f.payout.rows.forEach(function(r){ A.poRead++;
      var d=gwParseDate(gwPick(r,'Payout Date')); if(!d){A.poNoDate++; return;}
      var payoutAmt=gwNum(gwPick(r,'Payout Amount')), totalSales=gwNum(gwPick(r,'Total Sales'));
      // per-row self-check: Total Sales + all fees/SST/rebates should equal Payout Amount
      var expect=totalSales+gwNum(gwPick(r,'All Atome Fees'))+gwNum(gwPick(r,'All Atome Fees SST'))+gwNum(gwPick(r,'All Rebates'))+gwNum(gwPick(r,'All Rebates SST'));
      A.reconTot++; var diff=Math.abs(expect-payoutAmt); if(diff>A.reconMax)A.reconMax=diff; if(diff<=0.02)A.reconOk++;
      var k=gwFmtDate(d,'ymd');
      if(!byDate[k]) byDate[k]={d:d,payout:0,fee:0};
      byDate[k].payout+=payoutAmt;
      byDate[k].fee+=(payoutAmt-totalSales);   // negative = the Atome fee (MDR + SST + rebates) for that payout
    });
    Object.keys(byDate).forEach(function(k){ var b=byDate[k];
      if(wantPayout && rnd(b.payout)){ A.poConv++; rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-rnd(b.payout),payee:'Atome',desc:'Atome settlement payout to bank',ref:'ATOME-PAYOUT-'+k,kind:'out'}); }
      if(wantFee && rnd(b.fee)) rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:rnd(b.fee),payee:'Atome',desc:'Atome MDR & fees (MDR + SST + rebates)',ref:'ATOME-MDR-'+k,kind:'fee'});
    });
  }
  return rows;
}
// NTT Data Payment Gateway — a SINGLE transaction-level statement (EDC: DuitNow QR / MyDebit / Visa /
// Master). There is no separate settlement/payout file, so payout + MDR are DERIVED from the same file and
// consolidated per transaction date: money-in = tx_amount (gross the customer paid), fee = merchant_mdr_amount
// (already negative), payout = net_amount. Mirrors the Atome model (no NetPayex/NetOthers split). With no
// settlement report, the payout line is dated on the transaction date (a proxy) — match it to the actual NTT
// Data bank deposit when reconciling in Xero.
function gwConvertNttData(f,A,fmt,refField,wantPayout,wantFee){
  var rows=[];
  var byDate={}, rnd=function(x){return Math.round(x*100)/100;};
  if(f.txn) f.txn.rows.forEach(function(r){
    A.txnRead++;
    var d=gwParseDate(gwPick(r,'tx_create_date')); if(!d){A.txnNoDate++; return;}
    var gross=gwRnd(gwNum(gwPick(r,'tx_amount')));
    if(gross===0){A.txnZero++; return;}
    var mdr=gwNum(gwPick(r,'merchant_mdr_amount'));   // already negative in the export
    var net=gwNum(gwPick(r,'net_amount'));
    // per-row self-check: gross + MDR + commission + VAT should equal net_amount
    var expect=gross+mdr+gwNum(gwPick(r,'product_commission_amount'))+gwNum(gwPick(r,'vat_amount'));
    A.reconTot++; var diff=Math.abs(expect-net); if(diff>A.reconMax)A.reconMax=diff; if(diff<=0.02)A.reconOk++;
    A.txnConv++;
    var ref=String(gwPick(r,refField)||gwPick(r,'gateway_tx_id')||gwPick(r,'mah_ref')||'').replace(/^'/,'').trim();
    var method=String(gwPick(r,'product_itemname')||'').split('/')[0].trim()||'payment';
    rows.push({d:d,date:gwFmtDate(d,fmt),amount:gross,payee:'NTT Data',desc:('NTT Data '+method),ref:ref,kind:gross<0?'out':'in'});
    var k=gwFmtDate(d,'ymd');
    if(!byDate[k]) byDate[k]={d:d,net:0,fee:0,n:0};
    byDate[k].net+=net; byDate[k].fee+=mdr; byDate[k].n++;
  });
  // Payout (−net) + MDR fee, both consolidated per transaction date.
  Object.keys(byDate).forEach(function(k){ var b=byDate[k];
    if(wantPayout && rnd(b.net)){ A.poConv++; rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:-rnd(b.net),payee:'NTT Data',desc:'NTT Data settlement payout to bank'+(b.n>1?(' ('+b.n+' txns)'):''),ref:'NTT-PAYOUT-'+k,kind:'out'}); }
    if(wantFee && rnd(b.fee)) rows.push({d:b.d,date:gwFmtDate(b.d,fmt),amount:rnd(b.fee),payee:'NTT Data',desc:'NTT Data MDR fee',ref:'NTT-MDR-'+k,kind:'fee'});
  });
  return rows;
}

// ── The dispatcher, the totals and the audit ────────────────────────────────────────────────────
// `gwConvert()` in app.html now reads the four form controls and calls this; the React route does the
// same. The sort is part of the answer, not presentation: the CSV rows are written in this order.

/** A fresh audit accumulator — every counter the converters increment, at zero. */
function gwNewAudit(){ return {txnRead:0,txnConv:0,txnNoDate:0,txnZero:0,poRead:0,poConv:0,poNoDate:0,reconOk:0,reconTot:0,reconMax:0,pxSettled:0,pxUnsettled:0,pxUnsettledAmt:0}; }

function gwConvertRows(provider,f,A,fmt,refField,wantPayout,wantFee){
  var rows=provider==='payex'?gwConvertPayex(f,A,fmt,refField,wantPayout,wantFee):provider==='atome'?gwConvertAtome(f,A,fmt,refField,wantPayout,wantFee):provider==='nttdata'?gwConvertNttData(f,A,fmt,refField,wantPayout,wantFee):gwConvertHitpay(f,A,fmt,refField,wantPayout,wantFee);
  rows.sort(function(a,b){return a.d-b.d;});
  return rows;
}

/** The four summary cards' figures. `fee` is signed as the rows are; `net` is the account movement. */
function gwTotals(rows){
  var sIn=0,sOut=0,sFee=0,cIn=0,cOut=0;
  rows.forEach(function(r){ if(r.kind==='in'){sIn+=r.amount;cIn++;} else if(r.kind==='fee'){sFee+=r.amount;} else {sOut+=r.amount;cOut++;} });
  // Rounded, because a card is a figure somebody reads and reconciles: summing sen figures in binary
  // floating point gives 256.78999999999996, and `net` compounds three of those.
  sIn=gwRnd(sIn); sOut=gwRnd(sOut); sFee=gwRnd(sFee);
  return {sIn:sIn,sOut:sOut,sFee:sFee,cIn:cIn,cOut:cOut,net:gwRnd(sIn+sOut+sFee)};
}

/**
 * The "only one file is loaded" warning — what the operator is NOT getting in the CSV. Takes the
 * provider's loaded files rather than reading `GW`; returns '' when both halves are present.
 */
function gwWarning(provider,f){
  var hasTxn=f.txn, hasOut=(provider==='payex')?f.set:(provider==='nttdata')?f.txn:f.payout, warn='';
  if(!hasTxn) warn='Only the settlement/payout file is loaded — money-in'+(provider==='hitpay'?' + fee':'')+' lines need the Transaction file.';
  else if(!hasOut) warn='Only the Transaction file is loaded — '+(provider==='hitpay'?'payout lines':'payout + fee lines')+' need the '+(provider==='payex'?'settlement':'payout')+' file.';
  return warn;
}

/**
 * The data-check block: one line per thing that was read and what became of it, plus whether every
 * input row is accounted for. It is the only thing on the screen that tells an operator the CSV is
 * complete, so it is arithmetic over the audit, not decoration.
 */
function gwAuditLines(provider,A){
  A=A||{};
  var chk=[], txnSkip=(A.txnNoDate||0)+(A.txnZero||0);
  chk.push('Transactions: read '+(A.txnRead||0)+' → converted '+(A.txnConv||0)+(txnSkip?(' · skipped '+txnSkip+' ('+(A.txnNoDate||0)+' no date, '+(A.txnZero||0)+' zero amount)'):' · none skipped'));
  if(A.poRead) chk.push((provider==='payex'?'Settlement rows':'Payout rows')+': read '+A.poRead+' → '+(A.poConv||0)+' payout line(s)'+(A.poNoDate?(' · '+A.poNoDate+' skipped (no date)'):''));
  if(A.reconTot) chk.push((provider==='nttdata'?'NTT Data row self-check (gross + MDR = net): ':'Atome payout self-check (Total Sales + fees = Payout): ')+(A.reconOk||0)+'/'+A.reconTot+(A.reconOk===A.reconTot?' reconcile ✓':(' — worst gap RM'+(A.reconMax||0).toFixed(2))));
  if(provider==='payex' && (A.pxSettled||A.pxUnsettled)) chk.push('Settlement status: '+(A.pxSettled||0)+' settled + '+(A.pxUnsettled||0)+' not yet settled (RM'+(A.pxUnsettledAmt||0).toFixed(2)+' unsettled float — normal for Payex; clears in a later export)');
  var allOk = txnSkip===0 && !A.poNoDate && (A.reconTot? A.reconOk===A.reconTot : true);
  return {lines:chk, allOk:allOk};
}
function gwCSV(rows){
  var q=function(x){ x=String(x==null?'':x); return /[",\n\r]/.test(x)?('"'+x.replace(/"/g,'""')+'"'):x; };
  var out=['Date,Amount,Payee,Description,Reference'];
  rows.forEach(function(r){ out.push([r.date,r.amount.toFixed(2),q(r.payee),q(r.desc),q(r.ref)].join(',')); });
  return out.join('\r\n');
}

/** The download's file name — `Xero_<Provider>_<Slice>_<first>_<last>.csv` (app.html's gwDownload). */
function gwOutName(provider,which,rows){
  var ds=rows.map(function(r){return r.d;}).sort(function(a,b){return a-b;});
  var tag=gwFmtDate(ds[0],'ymd')+'_'+gwFmtDate(ds[ds.length-1],'ymd');
  var prov=provider.charAt(0).toUpperCase()+provider.slice(1);
  return 'Xero_'+prov+'_'+(which==='in'?'MoneyIn':which==='out'?'Settlements':'Clearing')+'_'+tag+'.csv';
}

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler reads it and hands the React app the same functions app.html calls.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  GW_REFOPTS, gwProvLabel, gwMoney, gwNum, gwPick, gwParseDate, gwFmtDate, gwDetect,
  gwConvertPayex, gwConvertAtome, gwConvertHitpay, gwConvertNttData,
  gwNewAudit, gwConvertRows, gwTotals, gwWarning, gwAuditLines, gwCSV, gwOutName, gwRnd,
};

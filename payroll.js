// The Malaysian statutory payroll engine — EPF/KWSP, SOCSO/PERKESO, EIS, LINDUNG 24, and PCB/MTD.
//
// Moved here verbatim from hros.html (v213). Not a rewrite: every table and every rounding step is the
// same source text, because this is the code that decides what is deducted from a real employee's pay.
// A wrong table over-deducts from everybody at once, silently, and the only reason it is safe to move at
// all is that tests/statutory_test.ts pins the gazetted anchors and tests/engine_parity_test.ts diffs it
// against the server engine in supabase/functions/portal/hr.ts row by row. Those two are the gate.
//
// WHY IT LIVES IN ITS OWN FILE: it is the largest block of code in either app that has nothing to do
// with the DOM, so it is the code a React rewrite must NOT re-express — it should import it. Splitting it
// out now means the migration cannot accidentally fork the maths.
//
// ── The two rules this file lives by ─────────────────────────────────────────────────────────────
//
// 1. It MUST stay a classic script (<script src="payroll.js">, never type="module"), loaded before
//    hros.html's inline <script>. See common.js:1-20 — the apps wire ~450 inline onclick= handlers that
//    resolve names as globals at click time, and a module's top-level declarations are not global.
// 2. Nothing here runs at load time and nothing here reads app state. Every function takes what it needs
//    as an argument (emp, cfg, adj, period, ytd) and the tables are constants. That is what makes it
//    equally valid for a bundler to import: `const { hrCompute } = require('./payroll.js')` gets the
//    same function, with no window, no DOM and no globals to stand up first.
//
// Dependencies: none. It calls nothing outside this file.

var HR_TAX_BANDS=[[5000,0],[20000,0.01],[35000,0.03],[50000,0.06],[70000,0.11],[100000,0.19],[400000,0.25],[600000,0.26],[2000000,0.28],[Infinity,0.30]];
/* v155: Official PERKESO Second Schedule (Cat1 <60, Cat2 60+) + EIS tables, RM6,000 ceiling (eff. 1 Oct
   2024). Row = [wageUpperBound, employeeAmt, employerAmt]. MUST stay byte-identical to the server engine
   (portal_current.ts) — the finalise step recomputes and rejects on any >1-sen difference. */
var MY_SOCSO_CAT1=[[30,0.10,0.40],[50,0.20,0.70],[70,0.30,1.10],[100,0.40,1.50],[140,0.60,2.10],[200,0.85,2.95],[300,1.25,4.35],[400,1.75,6.15],[500,2.25,7.85],[600,2.75,9.65],[700,3.25,11.35],[800,3.75,13.15],[900,4.25,14.85],[1000,4.75,16.65],[1100,5.25,18.35],[1200,5.75,20.15],[1300,6.25,21.85],[1400,6.75,23.65],[1500,7.25,25.35],[1600,7.75,27.15],[1700,8.25,28.85],[1800,8.75,30.65],[1900,9.25,32.35],[2000,9.75,34.15],[2100,10.25,35.85],[2200,10.75,37.65],[2300,11.25,39.35],[2400,11.75,41.15],[2500,12.25,42.85],[2600,12.75,44.65],[2700,13.25,46.35],[2800,13.75,48.15],[2900,14.25,49.85],[3000,14.75,51.65],[3100,15.25,53.35],[3200,15.75,55.15],[3300,16.25,56.85],[3400,16.75,58.65],[3500,17.25,60.35],[3600,17.75,62.15],[3700,18.25,63.85],[3800,18.75,65.65],[3900,19.25,67.35],[4000,19.75,69.15],[4100,20.25,70.85],[4200,20.75,72.65],[4300,21.25,74.35],[4400,21.75,76.15],[4500,22.25,77.85],[4600,22.75,79.65],[4700,23.25,81.35],[4800,23.75,83.15],[4900,24.25,84.85],[5000,24.75,86.65],[5100,25.25,88.35],[5200,25.75,90.15],[5300,26.25,91.85],[5400,26.75,93.65],[5500,27.25,95.35],[5600,27.75,97.15],[5700,28.25,98.85],[5800,28.75,100.65],[5900,29.25,102.35],[6000,29.75,104.15]];
var MY_SOCSO_CAT2=[[30,0,0.30],[50,0,0.50],[70,0,0.80],[100,0,1.05],[140,0,1.50],[200,0,2.10],[300,0,3.10],[400,0,4.40],[500,0,5.60],[600,0,6.90],[700,0,8.10],[800,0,9.40],[900,0,10.60],[1000,0,11.90],[1100,0,13.10],[1200,0,14.40],[1300,0,15.60],[1400,0,16.90],[1500,0,18.10],[1600,0,19.40],[1700,0,20.60],[1800,0,21.90],[1900,0,23.10],[2000,0,24.40],[2100,0,25.60],[2200,0,26.90],[2300,0,28.10],[2400,0,29.40],[2500,0,30.60],[2600,0,31.90],[2700,0,33.10],[2800,0,34.40],[2900,0,35.60],[3000,0,36.90],[3100,0,38.10],[3200,0,39.40],[3300,0,40.60],[3400,0,41.90],[3500,0,43.10],[3600,0,44.40],[3700,0,45.60],[3800,0,46.90],[3900,0,48.10],[4000,0,49.40],[4100,0,50.60],[4200,0,51.90],[4300,0,53.10],[4400,0,54.40],[4500,0,55.60],[4600,0,56.90],[4700,0,58.10],[4800,0,59.40],[4900,0,60.60],[5000,0,61.90],[5100,0,63.10],[5200,0,64.40],[5300,0,65.60],[5400,0,66.90],[5500,0,68.10],[5600,0,69.40],[5700,0,70.60],[5800,0,71.90],[5900,0,73.10],[6000,0,74.40]];
var MY_EIS=[[30,0.05,0.05],[50,0.10,0.10],[70,0.10,0.10],[100,0.15,0.15],[140,0.25,0.25],[200,0.35,0.35],[300,0.50,0.50],[400,0.70,0.70],[500,0.90,0.90],[600,1.10,1.10],[700,1.30,1.30],[800,1.50,1.50],[900,1.70,1.70],[1000,1.90,1.90],[1100,2.10,2.10],[1200,2.30,2.30],[1300,2.50,2.50],[1400,2.70,2.70],[1500,2.90,2.90],[1600,3.10,3.10],[1700,3.30,3.30],[1800,3.50,3.50],[1900,3.70,3.70],[2000,3.90,3.90],[2100,4.10,4.10],[2200,4.30,4.30],[2300,4.50,4.50],[2400,4.70,4.70],[2500,4.90,4.90],[2600,5.10,5.10],[2700,5.30,5.30],[2800,5.50,5.50],[2900,5.70,5.70],[3000,5.90,5.90],[3100,6.10,6.10],[3200,6.30,6.30],[3300,6.50,6.50],[3400,6.70,6.70],[3500,6.90,6.90],[3600,7.10,7.10],[3700,7.30,7.30],[3800,7.50,7.50],[3900,7.70,7.70],[4000,7.90,7.90],[4100,8.10,8.10],[4200,8.30,8.30],[4300,8.50,8.50],[4400,8.70,8.70],[4500,8.90,8.90],[4600,9.10,9.10],[4700,9.30,9.30],[4800,9.50,9.50],[4900,9.70,9.70],[5000,9.90,9.90],[5100,10.10,10.10],[5200,10.30,10.30],[5300,10.50,10.50],[5400,10.70,10.70],[5500,10.90,10.90],[5600,11.10,11.10],[5700,11.30,11.30],[5800,11.50,11.50],[5900,11.70,11.70],[6000,11.90,11.90]];
function myStatLookup(tbl,wage){ if(!(wage>0)) return {ee:0,er:0}; for(var i=0;i<tbl.length;i++){ if(wage<=tbl[i][0]) return {ee:tbl[i][1],er:tbl[i][2]}; } var L=tbl[tbl.length-1]; return {ee:L[1],er:L[2]}; }
// ── PERKESO LINDUNG 24 Jam (SKBBK) — Act A1788, in force 1 June 2026 ────────────────────────────────
// Employee-only, banded like the rest of Act 4, RM6,000 ceiling. Phase 1 (1 Jun 2026 – 31 May 2028) is
// 0.75%; it rises to 1.00% and then 1.25% later.
//
// DERIVED, not transcribed — PERKESO publishes this only as a scanned table, and v155 was exactly a
// hand-entered contribution table that was wrong for weeks. Phase-1 TOTAL employee contribution is 1.25%
// (0.5% invalidity + 0.75% SKBBK), and HR OS already holds the gazetted 1.25% column (Cat 2 employer) and
// the 0.5% column (Cat 1 employee), so SKBBK = Cat2_employer − Cat1_employee. Hits both published anchors
// (RM44.65 at the ceiling, RM22.85 in the RM3,000.01–3,100 band); a naive midpoint×0.75% would be wrong on
// 32 of 64 bands. Must mirror computePayrollMY exactly.
function myLindung24(wage){
  var a=myStatLookup(MY_SOCSO_CAT2,wage).er, b=myStatLookup(MY_SOCSO_CAT1,wage).ee;
  return Math.round((a-b)*100)/100;
}
function myLindungActive(period){
  var now=new Date();
  var y=Number(period&&period.year)||now.getUTCFullYear();
  var m=Number(period&&period.month)||(now.getUTCMonth()+1);
  return (y>2026) || (y===2026 && m>=6);
}
function myPcbRoundUp5(n){ n=Math.floor((Number(n)||0)*100)/100; return Math.round(Math.ceil(n/0.05-1e-9)*0.05*100)/100; }
function myServiceMonths(emp,period){ if(!period||!period.year) return 12; var y=Number(period.year),start=1,end=12;
  if(emp.join_date){ var d=new Date(emp.join_date); if(!isNaN(d.getTime())){ if(d.getUTCFullYear()>y) return 0; if(d.getUTCFullYear()===y) start=d.getUTCMonth()+1; } }
  if(emp.resign_date){ var d2=new Date(emp.resign_date); if(!isNaN(d2.getTime())){ if(d2.getUTCFullYear()<y) return 0; if(d2.getUTCFullYear()===y) end=d2.getUTCMonth()+1; } }
  return Math.max(1,end-start+1); }
function hrRoundUp(n){ return Math.ceil(n-1e-9); }
function hrRound2(n){ return Math.round((Number(n)||0)*100)/100; }
function hrRound5(n){ return Math.round((Number(n)||0)*20)/20; }          // nearest 5 sen (SOCSO/EIS table)
function hrBandMid(w){ if(w<=0) return 0; var upper=Math.ceil((w-1e-9)/100)*100; return upper-50; } // RM100 contribution-band midpoint
// v157: must mirror payAge() in portal_current.ts EXACTLY — age as at the end of the payroll period, and
// UTC getters throughout (the old local getters also disagreed with the server on a birthday off-MYT,
// which produced a 409 recompute_mismatch).
function hrAge(dob,period){ if(!dob) return null; var d=new Date(dob); if(isNaN(d)) return null;
  var t=(period&&period.year&&period.month) ? new Date(Date.UTC(Number(period.year),Number(period.month),0)) : new Date(Date.now()+8*3600*1000);
  var a=t.getUTCFullYear()-d.getUTCFullYear(); var m=t.getUTCMonth()-d.getUTCMonth(); if(m<0||(m===0&&t.getUTCDate()<d.getUTCDate())) a--; return a; }
// EPF — KWSP Third Schedule behaviour: wages <=20k use RM20 wage bands; each side rounded UP to next ringgit.
function hrEpfParts(wage,eeRate,erRate){ var w=wage<=20000?Math.ceil(wage/20)*20:wage; return { ee:eeRate>0?hrRoundUp(w*eeRate):0, er:erRate>0?hrRoundUp(w*erRate):0 }; }
// SOCSO / EIS — contribution table: midpoint of the RM100 wage band × rate, rounded to nearest 5 sen; wage capped at ceiling.
function hrTableParts(wage,ceiling,eeRate,erRate){ var w=Math.min(Math.max(wage,0),ceiling); if(w<=0) return {ee:0,er:0}; var mid=hrBandMid(w); return { ee:eeRate>0?hrRound5(mid*eeRate):0, er:erRate>0?hrRound5(mid*erRate):0 }; }
function hrProgTax(chargeable){ var tax=0,prev=0; for(var i=0;i<HR_TAX_BANDS.length;i++){ var cap=HR_TAX_BANDS[i][0],rate=HR_TAX_BANDS[i][1]; if(chargeable>prev) tax+=(Math.min(chargeable,cap)-prev)*rate; prev=cap; if(chargeable<=cap) break; } return tax; }
// cfg = hr_statutory_rates.rates. emp carries eligibility flags + date_of_birth + epf_ee_rate + socso_category + marital_status/spouse_working/num_children + resident.
function hrCompute(emp,cfg,adj,period,ytd){ adj=adj||[];
  var earn=adj.filter(function(a){return ['allowance','bonus','ot'].indexOf(a.kind)>=0;});
  var addEarn=earn.reduce(function(s,a){return s+Number(a.amount||0);},0);
  var addEarnStat=earn.filter(function(a){return a.epf_subject!==false;}).reduce(function(s,a){return s+Number(a.amount||0);},0);
  var unpaid=adj.filter(function(a){return a.kind==='unpaid_leave';}).reduce(function(s,a){return s+Number(a.amount||0);},0);
  var otherDed=adj.filter(function(a){return a.kind==='deduction';}).reduce(function(s,a){return s+Number(a.amount||0);},0);
  var base=Number(emp.basic_salary||0)+Number(emp.fixed_allowance||0);
  var gross=hrRound2(base+addEarn-unpaid);
  var statWage=Math.max(0, base+addEarnStat-unpaid);   // unpaid leave lowers the statutory wage too
  var bonusStat=earn.filter(function(a){return a.kind==='bonus' && a.epf_subject!==false;}).reduce(function(s,a){return s+Number(a.amount||0);},0);
  // v180: SOCSO and EIS were computed on statWage, which INCLUDES bonus — so a bonus month over-deducted
  // from the employee and over-contributed for the company. The Employees' Social Security Act 1969
  // definition of wages excludes bonus, and EIS (Act 800) uses the same definition. EPF is the opposite:
  // bonus IS EPF wages, so EPF keeps using statWage.
  // Cross-checked against payroll.my on 3,500 + 369 bonus: it charges SOCSO/EIS on 3,500 (EIS 6.90) while
  // charging EPF on 3,869 (EPF ee 427.00) — EPF already agreed to the sen; SOCSO/EIS did not.
  // Must mirror computePayrollMY exactly or hr_payroll_finalise rejects with 409 recompute_mismatch.
  var statWageExBonus=Math.max(0, statWage - bonusStat);
  var age=hrAge(emp.date_of_birth, period), senior=(age!=null&&age>=60);
  // ---- EPF (KWSP) ----
  // v166: citizenship, which is NOT the same question as `resident` (that is tax residency, for PCB).
  // Permanent Residents follow the Malaysian rates; only a non-PR foreigner is on the 2% schedule.
  // Must mirror computePayrollMY exactly.
  var nonCitizen=String(emp.citizen_status||'citizen')==='non_citizen';
  var over75=(age!=null && age>=75);          // EPF liability ceases at 75 for everyone
  var epfOn=emp.epf_eligible!==false && !over75;
  var ncEe=cfg.epf.nonCitizenEe!=null?cfg.epf.nonCitizenEe:0.02;
  var ncEr=cfg.epf.nonCitizenEr!=null?cfg.epf.nonCitizenEr:0.02;
  var eeRate=(emp.epf_ee_rate!=null&&emp.epf_ee_rate!=='') ? Number(emp.epf_ee_rate)
           : nonCitizen ? ncEe : (senior ? (cfg.epf.eeSenior!=null?cfg.epf.eeSenior:0) : cfg.epf.eeRate);
  // v183: employer rate override (above-statutory contribution). Must mirror computePayrollMY exactly.
  var erRate=(emp.epf_er_rate!=null&&emp.epf_er_rate!=='') ? Number(emp.epf_er_rate)
           : nonCitizen ? ncEr
           : (senior ? (cfg.epf.erSenior!=null?cfg.epf.erSenior:0.04) : (statWage<=cfg.epf.threshold?cfg.epf.erRateLow:cfg.epf.erRateHigh));
  var ep=epfOn?hrEpfParts(statWage,eeRate,erRate):{ee:0,er:0}; var epfEe=ep.ee, epfEr=ep.er;
  // ---- SOCSO (PERKESO) — Cat 1 (below 60) or Cat 2 (60+/registered late: employer-only) ----
  var socsoOn=emp.socso_eligible!==false;
  var scat=(emp.socso_category!=null&&emp.socso_category!=='') ? Number(emp.socso_category) : (senior?2:1);
  var sp=socsoOn?myStatLookup(scat===2?MY_SOCSO_CAT2:MY_SOCSO_CAT1, statWageExBonus):{ee:0,er:0}; var socsoEe=sp.ee, socsoEr=sp.er;   // v155: exact PERKESO table / v180: ex-bonus
  // ---- EIS (SIP) — 18 to 60 only ----
  // v166: EIS (Act 800) covers Malaysian citizens and Permanent Residents ONLY. A foreign worker
  // contributes nothing and is entitled to nothing — they are covered by Act 4 instead.
  var eisOn=emp.eis_eligible!==false && !senior && !nonCitizen;
  var ip=eisOn?myStatLookup(MY_EIS, statWageExBonus):{ee:0,er:0}; var eisEe=ip.ee, eisEr=ip.er;   // v155: exact EIS table / v180: ex-bonus
  // ---- LINDUNG 24 Jam (SKBBK) — employee-only, no employer share. Must mirror computePayrollMY. ----
  var lindungOn = myLindungActive(period) && (nonCitizen ? true : emp.lindung24!==false) && socsoOn;
  var lindung = lindungOn ? myLindung24(statWageExBonus) : 0;
  // ---- PCB / MTD (annualised chargeable-income estimate) ----
  // Bonus = ADDITIONAL remuneration (LHDN method): annualising it ×12 massively over-deducts in bonus
  // months (RM4k salary + RM4k Dec bonus was taxed as RM96k/yr instead of RM52k + bonus-once).
  // Normal remuneration is annualised; the bonus's tax = tax(normal + bonus) − tax(normal), added once.
  var statWageNormal=statWageExBonus;   // same quantity — one definition only
  // v155/v156: LHDN MTD — annualise over ACTUAL service months, reconcile against income & PCB already
  // paid earlier this year (ytd), LHDN rounding (truncate 2dp → up to 5 sen), MTD < RM10 = nil.
  var N=myServiceMonths(emp, period);
  var yg=Number(ytd&&ytd.gross)||0, ye=Number(ytd&&ytd.epf)||0, yp=Number(ytd&&ytd.pcb)||0, ym=Number(ytd&&ytd.months)||0;
  var remain=Math.max(1, N - ym);
  var pcb, pcbCat=1;
  if(emp.resident===false){ pcb=myPcbRoundUp5(statWage*0.30); pcbCat=0; }
  else {
    var ms=String(emp.marital_status||'single').toLowerCase();
    var cat2=(ms==='married' && emp.spouse_working===false);   // married, spouse not working -> spouse relief + rebate
    pcbCat=cat2?2:( ms==='married'?3:1 );
    var rPers=cfg.reliefPersonal!=null?cfg.reliefPersonal:9000, rSp=cfg.reliefSpouse!=null?cfg.reliefSpouse:4000, rCh=cfg.reliefChild!=null?cfg.reliefChild:2000, rEpf=cfg.reliefEpfMax!=null?cfg.reliefEpfMax:4000;
    var kids=Number(emp.num_children||0);
    var projGross=yg + statWageNormal*remain, projEpf=ye + epfEe*remain;
    // v165: SOCSO + EIS employee contributions are an allowable MTD relief, capped at RM350 a year.
    // Must mirror computePayrollMY exactly. Leaving it out over-deducted PCB from every employee.
    // v184: SKBBK is an Act 4 contribution, so it shares the RM350 SOCSO/EIS MTD relief.
    var projSocsoEis=Number((ytd&&ytd.socsoEis)||0) + (socsoEe+eisEe+lindung)*remain;
    var rSocsoEis=cfg.reliefSocsoEisMax!=null?cfg.reliefSocsoEisMax:350;
    // v167: TP1 declared reliefs. Must mirror computePayrollMY exactly.
    var tp1=Math.max(0, Number((ytd&&ytd.tp1))||0);
    // v185: PCB method (cfg.pcbMethod). Must mirror computePayrollMY exactly.
    //   "payroll_my" (default, operator's choice) — no SOCSO/EIS relief, and the bonus is charged the
    //   residual annual tax minus the normal MTD that will ACTUALLY be deducted (nil under RM10).
    //   "lhdn" — the prescribed method HR OS used through v184.
    var pcbMy = String(cfg.pcbMethod||'payroll_my')==='payroll_my';
    var reliefs=rPers + (cat2?rSp:0) + kids*rCh + Math.min(projEpf, rEpf)
              + (pcbMy ? 0 : Math.min(projSocsoEis, rSocsoEis)) + tp1;
    var chargeable=Math.max(0, projGross - reliefs);
    var tax=hrProgTax(chargeable);
    var rebate=chargeable<=35000 ? (400 + (cat2?400:0)) : 0;   // individual (+spouse) rebate, s.6A
    var monthlyBase=Math.max(0, ((tax-rebate) - yp) / remain);
    var bonusAnnual=function(){
      var chargeableB=Math.max(0, projGross + bonusStat - reliefs);
      var taxB=hrProgTax(chargeableB);
      var rebateB=chargeableB<=35000 ? (400 + (cat2?400:0)) : 0;
      return (taxB-rebateB);
    };
    if(pcbMy){
      var norm=myPcbRoundUp5(monthlyBase); if(norm<10) norm=0;
      var addl = bonusStat>0 ? Math.max(0, (bonusAnnual() - yp) - norm*remain) : 0;
      pcb = hrRound2(norm + (addl>0 ? myPcbRoundUp5(addl) : 0));
    } else {
      var addlTax = bonusStat>0 ? Math.max(0, bonusAnnual()-(tax-rebate)) : 0;
      var pcbR=myPcbRoundUp5(monthlyBase + addlTax);
      pcb = pcbR < 10 ? 0 : pcbR;   // LHDN: monthly MTD of less than RM10 is nil
    }
  }
  // v165: zakat reduces tax RINGGIT-FOR-RINGGIT (net MTD = MTD − zakat for the month), it is not an
  // ordinary deduction. Must mirror computePayrollMY exactly. HR OS offered "Zakat" as a payroll
  // deduction but charged the employee zakat AND the full PCB on top.
  var zakatMonth=adj.filter(function(a){ return a.kind==='deduction' && /^zakat/i.test(String(a.label||'')); })
                    .reduce(function(s,a){ return s+Number(a.amount||0); },0);
  if(zakatMonth>0) pcb = Math.max(0, hrRound2(pcb - zakatMonth));
  // v195: explicit PCB for this period wins over everything above. Must mirror computePayrollMY exactly,
  // including being applied AFTER zakat — otherwise finalise 409s the whole run.
  var pcbSetRows=adj.filter(function(a){return a.kind==='pcb_set';});
  if(pcbSetRows.length){ pcb=Math.max(0, hrRound2(Number(pcbSetRows[pcbSetRows.length-1].amount)||0)); }
  // LINDUNG 24 has no employer share, so it reduces net pay without changing employer cost.
  var net=hrRound2(gross-epfEe-socsoEe-eisEe-lindung-pcb-otherDed);
  var employerCost=hrRound2(gross+epfEr+socsoEr+eisEr);
  return { gross:gross, epfEe:epfEe, epfEr:epfEr, socsoEe:socsoEe, socsoEr:socsoEr, eisEe:eisEe, eisEr:eisEr, lindung:lindung, pcb:pcb, net:net, employerCost:employerCost, _meta:{age:age,epfEeRate:eeRate,epfErRate:erRate,socsoCat:scat,pcbCat:pcbCat,senior:senior,lindungOn:lindungOn} };
}

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler (webpack/Next, Vite via its commonjs plugin) reads it and hands the
// React app the same functions the legacy app is calling.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  MY_SOCSO_CAT1, MY_SOCSO_CAT2, MY_EIS, HR_TAX_BANDS,
  myStatLookup, myLindung24, myLindungActive, myPcbRoundUp5, myServiceMonths,
  hrRoundUp, hrRound2, hrRound5, hrBandMid, hrAge, hrEpfParts, hrTableParts, hrProgTax, hrCompute,
};

// The files and documents HR OS emits: the fixed-width statutory layouts (KWSP, PERKESO ASSIST, LHDN
// CP39, CP8D, bank salary/GIRO) and the jsPDF drawers behind the payslip, Borang EA and Form E.
//
// Moved here verbatim from hros.html (v213), for the same reason as payroll.js: none of it is UI. It
// turns payroll numbers into bytes that leave the building, and the layouts are dictated by KWSP,
// PERKESO, LHDN and the banks — not by whatever renders the screen. A React rewrite should import this,
// never re-express it. tests/statutory_files_test.ts reads the emitted bytes and is the gate on the move.
//
// ── What is here and what deliberately is not ────────────────────────────────────────────────────
//
// Here: the format primitives (hrAscii/hrPadL/hrPadR/hrCents/hrCsv and the hrFit* overflow guard), the
// data mappers (hrEmpView, hrCp8dCategory, hrIntNoSen, hrDec2, hrFmtDMY), the bank BIC table with
// hrBankCode/hrSwift, the PDF palette, and the three page drawers (hrDrawPayslip, hrDrawEA,
// hrDrawFormE) — each of which takes a jsPDF `doc` plus its data and draws.
//
// NOT here, on purpose: the hrExp* export actions that call these. hrExpCp39 and its siblings read
// HR.pay through hrCurRows()/hrPeriod(), raise toasts and trigger a download — they are the button, not
// the format. In React they become event handlers, and dragging them in would have brought the whole app
// state with them. hrRCBuildFormPdf stays in hros.html for the same reason: it reaches HR.data through
// hrCompanyName().
//
// ── The two rules this file lives by ─────────────────────────────────────────────────────────────
//
// 1. It MUST stay a classic script (<script src="hr-docs.js">, never type="module"), loaded before
//    hros.html's inline <script>. See common.js:1-20 for the whole constraint.
// 2. Nothing here runs at load time. Everything is a declaration; the first thing that executes is
//    whatever the app calls.
//
// ── The one exception, written down so it is not a surprise ──────────────────────────────────────
//
// hrDrawPayslip reads two app values that stay in hros.html: HR_EMPLOYER and HR_COMPANY, the employer
// header printed at the top of a payslip. Under the classic-script arrangement that resolves as a global
// at call time and is safe (nothing here reads them at load time). Under a bundler it does not: the
// import has no globals, so the React caller must either set them on globalThis or — better — pass the
// employer in, which is a 6th argument on hrDrawPayslip and a one-line change at its two callers
// (hrExpPayslips, hrCalcPayslip). Deliberately not done here, because this change is behaviour-preserving
// and a signature change is not. It is the only app-state read in this file.
//
// Dependencies besides those two: jsPDF, which the caller has already loaded (hrLoadJsPDF) and hands in
// as `doc`.

function hrEmpView(e){ return { empNo:e.emp_no, name:e.name, ic:e.ic_no, position:e.position, dept:e.dept, basic:Number(e.basic_salary||0), allowance:Number(e.fixed_allowance||0), bankName:e.bank_name, bankCode:e.bank_code, bankHolder:e.bank_holder, bankAccount:e.bank_account, bank:e.bank_name?(e.bank_name+' •'+(e.bank_account||'')):'', epfNo:e.epf_no, socsoNo:e.socso_no, taxNo:e.tax_no, email:e.email, maritalStatus:e.marital_status, spouseWorking:e.spouse_working, numChildren:e.num_children, resignDate:e.resign_date }; }
var HR_money2=function(n){ return Number(n).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}); };
var HR_INK=[18,33,27],HR_GREEN=[11,107,79],HR_MUTED=[94,110,103],HR_LINE=[227,232,228],HR_RED=[176,69,59],HR_NETBG=[231,241,236],HR_GREEN2=[77,191,148];
function hrDrawPayslip(doc,e,p,period,d){
  d=d||{}; var W=210,m=18;
  doc.setFillColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.rect(0,0,W,32,'F');
  var _emp=HR_EMPLOYER||{}; var tx=m;
  if(_emp.logo){ try{ var ip=doc.getImageProperties(_emp.logo); var lh=15, lw=lh*(ip.width/ip.height); if(lw>34){ lw=34; lh=lw*(ip.height/ip.width); } var ly=(32-lh)/2; doc.setFillColor(255,255,255); doc.roundedRect(m-2,ly-2,lw+4,lh+4,1.8,1.8,'F'); doc.addImage(_emp.logo, /jpe?g/i.test(ip.fileType||'')?'JPEG':'PNG', m, ly, lw, lh); tx=m+lw+7; }catch(_e){} }
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(_emp.logo?13:15); doc.text(HR_COMPANY,tx,13);
  doc.setFont('helvetica','normal'); doc.setTextColor(184,204,194); doc.setFontSize(7.4);
  var _meta=[]; if(_emp.reg_no)_meta.push('Reg '+_emp.reg_no); if(_emp.employer_no)_meta.push('E '+_emp.employer_no);
  var _yy=17.5; if(_meta.length){ doc.text(_meta.join('    '),tx,_yy); _yy+=3.6; }
  if(_emp.address){ doc.text((doc.splitTextToSize(String(_emp.address).replace(/\s*\n\s*/g,', '),115)[0]||''),tx,_yy); _yy+=3.6; }
  doc.setFontSize(8); doc.text('Payslip · Confidential',tx,Math.min(_yy+0.5,28));
  doc.setTextColor(HR_GREEN2[0],HR_GREEN2[1],HR_GREEN2[2]); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(period.label,W-m,15,{align:'right'});
  var lastDay=new Date(period.year, period.month, 0).getDate(); // real month end — "31 February" was printed on short months
  doc.setTextColor(184,204,194); doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.text('Pay date: '+lastDay+' '+period.label,W-m,21,{align:'right'});
  var y=44;
  doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.setFont('helvetica','bold'); doc.setFontSize(12); doc.text(e.name,m,y);
  doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.setFont('helvetica','normal'); doc.setFontSize(9);
  y+=5.5; doc.text((e.empNo||'')+'  ·  '+(e.position||'—')+'  ·  '+(e.dept||'—'),m,y);
  y+=5; doc.text('IC: '+(e.ic||'—')+'    Bank: '+(e.bank||'—'),m,y); y+=9;
  var section=function(t){ doc.setTextColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.text(t.toUpperCase(),m,y); doc.setDrawColor(HR_LINE[0],HR_LINE[1],HR_LINE[2]); doc.setLineWidth(0.3); doc.line(m,y+2,W-m,y+2); y+=7; };
  var row=function(label,val,o){ o=o||{}; doc.setFont('helvetica',o.bold?'bold':'normal'); doc.setFontSize(o.bold?9.5:9); var c1=o.color||(o.bold?HR_INK:HR_MUTED); doc.setTextColor(c1[0],c1[1],c1[2]); doc.text(label,m,y); var c2=o.color||HR_INK; doc.setTextColor(c2[0],c2[1],c2[2]); doc.text((o.neg?'-':'')+'RM '+HR_money2(val),W-m,y,{align:'right'}); y+=6; };
  var mt=p._meta||{};
  var pctLbl=function(base,r){ return base+((r!=null)?(' '+(Math.round(r*1000)/10)+'%'):''); };
  section('Earnings');
  row('Basic salary',e.basic);
  if(e.allowance) row('Fixed allowance',e.allowance);
  if(d.bonus) row('Bonus',d.bonus);
  if(d.ot) row('Overtime',d.ot);
  if(d.allowance) row('Additional allowance',d.allowance);
  if(d.unpaid) row('Unpaid leave',d.unpaid,{neg:true,color:HR_RED});
  row('Gross pay',p.gross,{bold:true}); y+=3;
  section('Deductions (employee)');
  row(pctLbl('EPF (KWSP)',mt.epfEeRate),p.epfEe,{neg:true,color:HR_RED});
  row('SOCSO (PERKESO)'+(mt.socsoCat?(' · Cat '+mt.socsoCat):''),p.socsoEe,{neg:true,color:HR_RED});
  // v196: LINDUNG 24 Jam was deducted from net but never printed, so the listed deductions did not add up
  // to the net pay shown right below them — an unexplained gap on every payslip since 1 Jun 2026.
  if(Number(p.lindung)) row('LINDUNG 24 Jam (SKBBK)',p.lindung,{neg:true,color:HR_RED});
  row('EIS (SIP)',p.eisEe,{neg:true,color:HR_RED});
  row('PCB / MTD (estimate)'+(mt.pcbCat===0?' · non-resident':''),p.pcb,{neg:true,color:HR_RED});
  if(d.deductions&&d.deductions.length){ d.deductions.forEach(function(x){ if(Number(x.amount)) row(x.label||'Other deduction',x.amount,{neg:true,color:HR_RED}); }); }
  else if(d.deduction) row('Other deductions',d.deduction,{neg:true,color:HR_RED});
  y+=2;
  doc.setFillColor(HR_NETBG[0],HR_NETBG[1],HR_NETBG[2]); doc.roundedRect(m,y-5,W-2*m,11,2,2,'F');
  doc.setTextColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text('NET PAY',m+4,y+1.5); doc.setFontSize(14); doc.text('RM '+HR_money2(p.net),W-m-4,y+2,{align:'right'}); y+=16;
  section('Employer contributions'); row(pctLbl('EPF (KWSP)',mt.epfErRate),p.epfEr); row('SOCSO (PERKESO)',p.socsoEr); row('EIS (SIP)',p.eisEr); row('Total employer cost',p.employerCost,{bold:true});
  // Leave balances (remaining) — shown in days, not RM.
  if(e.leaveBal && e.leaveBal.length && y<250){ y+=3; section('Leave balances '+period.year);
    var textRow=function(label,val){ doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.text(label,m,y); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.text(val,W-m,y,{align:'right'}); y+=5.6; };
    e.leaveBal.forEach(function(b){ textRow(b.type, (Math.round(b.remaining*10)/10)+' of '+(Math.round(b.entitled*10)/10)+' days left  ·  taken '+(Math.round(b.taken*10)/10)); });
  }
  doc.setDrawColor(HR_LINE[0],HR_LINE[1],HR_LINE[2]); doc.line(m,275,W-m,275);
  doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
  doc.text('This is a computer-generated payslip and does not require a signature.',m,280);
  doc.text('PCB shown is an estimate - verify against the LHDN MTD schedule before filing.',m,284);
}
// v159: CRLF + a terminating newline. KWSP/CP39 already use CRLF deliberately, but every CSV (PERKESO
// ASSIST and both bank files) went out with bare LF and no EOF newline — several Malaysian bank and
// government uploaders drop or reject the final record without one. Also quote a bare CR.
function hrCsv(arr){ return arr.map(function(r){ return r.map(function(c){ return /[",\r\n]/.test(String(c))?('"'+String(c).replace(/"/g,'""')+'"'):c; }).join(','); }).join('\r\n')+'\r\n'; }
// v157: these files are FIXED-WIDTH and written as UTF-8, but padding counted UTF-16 code units. One
// accented/curly/CJK character made the emitted record longer in BYTES than the layout, so the portal's
// positional parser read every following field off by that many bytes. Fold to ASCII before padding.
function hrAscii(s){ return String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[‐-―]/g,'-').replace(/[^\x20-\x7E]/g,''); }
// v157: a required statutory identifier that is blank must BLOCK the file, not be padded into a
// plausible-looking zero. hrPadL('',12) emitted 000000000000 as an EPF/SOCSO member number and blanks as a
// TIN — a syntactically valid record that can never be allocated to the member, discovered as a rejected
// filing or a penalty weeks later. Returns a human list of who is missing what, or ''.
function hrMissingIds(rows, need){
  var bad=[];
  rows.forEach(function(x){ var e=x.e, miss=[];
    need.forEach(function(f){ if(!String((e[f.k]==null?'':e[f.k])).trim()) miss.push(f.label); });
    if(miss.length) bad.push((e.name||e.empNo||'?')+' — '+miss.join(', '));
  });
  if(!bad.length) return '';
  return bad.slice(0,6).join(' · ')+(bad.length>6?(' · +'+(bad.length-6)+' more'):'');
}
// A name legitimately gets clipped to the layout width — that is normal and harmless. An identifier is not:
// pass `what` for those and the file is blocked instead. See hrPadL (v199).
function hrPadR(s,n,what){ s=String(s==null?'':s); if(s.length>n){ if(what) hrFitNote(what,s,n); return s.slice(0,n); } return s+new Array(n-s.length+1).join(' '); }
// v199: a fixed-width statutory record must never be silently trimmed to fit. hrPadR truncated with
// slice(0,n) and hrPadL with slice(-n), so an over-long value produced a syntactically perfect record
// carrying a number that belongs to nobody — the CP39 file was shipping every employee's TIN two
// characters short. Overflows are now recorded and the builders refuse to emit the file.
var HR_FIT_ERR=[];
function hrFitReset(){ HR_FIT_ERR=[]; }
function hrFitNote(what,val,n){ HR_FIT_ERR.push(what+' "'+val+'" is '+String(val).length+' chars, the layout allows '+n); }
function hrPadL(s,n,c,what){ s=String(s==null?'':s); c=c||'0'; if(s.length>n){ if(what) hrFitNote(what,s,n); return s.slice(-n); } return new Array(n-s.length+1).join(c)+s; }
function hrCents(n){ return String(Math.round((Number(n)||0)*100)); }
var HR_BANK_CODE={'maybank islamic':'MBISMYKL','ambank islamic':'AISLMYKL','cimb islamic':'CTBBMYKL','rhb islamic':'RHBAMYKL','hong leong islamic':'HLIBMYKL','public islamic':'PIBEMYKL',maybank:'MBBEMYKL','malayan banking':'MBBEMYKL',cimb:'CIBBMYKL','public bank':'PBBEMYKL',pbb:'PBBEMYKL',rhb:'RHBBMYKL','hong leong':'HLBBMYKL',ambank:'ARBKMYKL','bank islam':'BIMBMYKL','bank rakyat':'BKRMMYKL',ocbc:'OCBCMYKL',hsbc:'HBMBMYKL','standard chartered':'SCBLMYKX',uob:'UOVBMYKL',affin:'PHBMMYKL',alliance:'MFBBMYKL','bank muamalat':'BMMBMYKL',agrobank:'BPMBMYKL','bank simpanan nasional':'BSNAMYK1',bsn:'BSNAMYK1','kuwait finance house':'KFHOMYKL','al rajhi':'RJHIMYKL','bank of china':'BKCHMYKL',citibank:'CITIMYKL','united overseas':'UOVBMYKL'};
function hrBankCode(name){ var k=String(name||'').toLowerCase().trim(); for(var key in HR_BANK_CODE){ if(k.indexOf(key)>=0) return HR_BANK_CODE[key]; } return ''; }
// v199: the salary files wrote `e.bankCode || hrBankCode(e.bankName)` into a column labelled SWIFT/BIC.
// Since the bank master list landed, bank_code is ALWAYS set — to HR OS's own code ("MAYBANK",
// "HONG_LEONG_BANK") — so the fallback never ran and every file carried an identifier no bank recognises.
// Resolve the real BIC from the bank name, then from the code read as words, and leave it BLANK rather
// than emit something wrong: a blank field gets rejected at upload, a plausible wrong one gets routed.
function hrSwift(e){
  return hrBankCode(e&&e.bankName) || hrBankCode(String((e&&e.bankCode)||'').replace(/_/g,' ')) || '';
}
function hrDrawEA(doc,e,t,year,emp){
  var W=210,H=297,m=16; var amt=function(n){return 'RM '+HR_money2(n);};
  doc.setFillColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.rect(0,0,W,26,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text('BORANG EA',m,12);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(184,204,194); doc.text('C.P.8A - Pin. 2023  ·  Income Tax Act 1967',m,17.5);
  doc.setTextColor(HR_GREEN2[0],HR_GREEN2[1],HR_GREEN2[2]); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text('Y/A '+year,W-m,12,{align:'right'});
  doc.setTextColor(184,204,194); doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.text('Statement of Remuneration from Employment',W-m,17.5,{align:'right'});
  var y=33;
  doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.text('FOR THE YEAR ENDED 31 DECEMBER '+year,m,y); y+=6;
  var head=function(t2){ doc.setTextColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(t2.toUpperCase(),m,y); doc.setDrawColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setLineWidth(0.4); doc.line(m,y+1.5,W-m,y+1.5); y+=6; };
  var kv=function(k,v,x,w){ x=x||m; doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.text(k,x,y); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.setFont('helvetica','bold'); doc.text(String(v||'—'),x+34,y); };
  var money2=function(label,val,o){ o=o||{}; doc.setFont('helvetica',o.bold?'bold':'normal'); doc.setFontSize(8.5); var c=o.bold?HR_INK:HR_MUTED; doc.setTextColor(c[0],c[1],c[2]); doc.text(label,m+2,y); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.text(amt(val),W-m,y,{align:'right'}); y+=5.5; };
  head("Employer's particulars");
  doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.text(emp.name||'',m,y); y+=5;
  kv("Employer's No.",emp.employer_no||'(to be filled — LHDN E number)'); y+=5;
  if(emp.address){ doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.text(String(emp.address),m,y); y+=5; }
  y+=1;
  head('A.  Particulars of employee'); var col2=m+95;
  kv('Name',e.name); kv('Staff No.',e.empNo,col2); y+=5;
  kv('Designation',e.position); kv('IC / Passport',e.ic,col2); y+=5;
  kv('Income Tax No.',e.taxNo||''); kv('EPF No.',e.epfNo||'',col2); y+=5;
  kv('SOCSO No.',e.socsoNo||''); kv('Months paid',t.months||0,col2); y+=6;
  head('B.  Gross income from employment');
  money2('1(a)  Gross salary, wages, leave pay, overtime, allowances',t.gross);
  money2("1(b)  Fees, commissions, bonus, director's fees, ESOS",0);
  money2('2.     Benefits-in-kind (BIK)',0);
  money2('3.     Value of living accommodation (VOLA)',0);
  money2('Total gross remuneration (B)',t.gross,{bold:true}); y+=2;
  head('C.  Total tax-exempt allowances / perquisites / gifts / benefits');
  money2('Total exempt (see note)',0); y+=2;
  head('D.  Deductions');
  money2('1.  Monthly Tax Deduction (MTD / PCB)',t.pcb);
  money2('2.  Deduction under CP38',0);
  money2('3.  Zakat paid via salary deduction',0); y+=2;
  head('E.  Contributions to approved fund & SOCSO');
  money2("EPF (KWSP) — employee's contribution",t.epfEe);
  money2("SOCSO (PERKESO) — employee's contribution",(Number(t.socsoEe)||0)+(Number(t.lindung)||0));   // v196: includes LINDUNG 24 Jam — same employee, same PERKESO account, and it counts toward the RM350 relief
  money2('EIS (SIP) — employee\'s contribution',t.eisEe); y+=3;
  doc.setDrawColor(HR_LINE[0],HR_LINE[1],HR_LINE[2]); doc.line(m,H-28,W-m,H-28);
  doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.setFont('helvetica','normal'); doc.setFontSize(7);
  doc.text('This statement must be rendered to the employee on or before 28 February '+(year+1)+' (Income Tax Act 1967, s.83(1A)).',m,H-23);
  doc.text('PCB shown is an estimate. BIK / VOLA / gratuity / bonus must be added manually where applicable.',m,H-19.5);
  doc.text('Verify against the current C.P.8A on hasil.gov.my before issuing.',m,H-16);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]);
  doc.text('Authorised signature: ______________________________',m,H-8);
  doc.text('Date: ____________',W-m-42,H-8);
}
function hrDrawFormE(doc,employer,stats,year){
  var W=210,H=297,m=16;
  doc.setFillColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.rect(0,0,W,26,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text('BORANG E',m,12);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(184,204,194); doc.text('C.P.8 - Return Form of Employer  ·  Income Tax Act 1967',m,17.5);
  doc.setTextColor(HR_GREEN2[0],HR_GREEN2[1],HR_GREEN2[2]); doc.setFont('helvetica','bold'); doc.setFontSize(10); doc.text('Y/A '+year,W-m,12,{align:'right'});
  doc.setTextColor(184,204,194); doc.setFont('helvetica','normal'); doc.setFontSize(7.5); doc.text('Submit via e-E on MyTax by 31 March',W-m,17.5,{align:'right'});
  var y=34;
  var head=function(t){ doc.setTextColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(t.toUpperCase(),m,y); doc.setDrawColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setLineWidth(0.4); doc.line(m,y+1.5,W-m,y+1.5); y+=7; };
  var kv=function(k,v){ doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.text(k,m+2,y); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.setFont('helvetica','bold'); doc.text(String(v),W-m,y,{align:'right'}); y+=6.5; };
  var mn=function(n){ return 'RM '+HR_money2(n); };
  head("Employer's particulars");
  doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]); doc.text(employer.name||'',m,y); y+=6;
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.text("Employer's No. (E)",m+2,y); doc.setFont('helvetica','bold'); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]);
  doc.text(employer.employer_no||'(to be filled)',W-m,y,{align:'right'}); y+=10;
  head('Number of employees for the year '+year);
  kv('1.  Total employees as at 31 December',stats.total);
  kv('2.  New employees during the year',stats.newHires);
  kv('3.  Employees who ceased employment',stats.ceased);
  kv('4.  Employees subject to MTD/PCB',stats.subjectPcb); y+=4;
  head('Remuneration & tax deducted');
  kv('Total gross remuneration paid',mn(stats.totalGross));
  kv('Total Monthly Tax Deduction (MTD/PCB)',mn(stats.totalPcb));
  kv('Total CP38 deductions',mn(0)); y+=8;
  doc.setFillColor(231,241,236); doc.roundedRect(m,y-4,W-2*m,20,3,3,'F');
  doc.setTextColor(HR_GREEN[0],HR_GREEN[1],HR_GREEN[2]); doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.text('C.P.8D ATTACHED',m+4,y+2);
  doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.setFont('helvetica','normal'); doc.setFontSize(8);
  doc.text('Per-employee detail for all '+stats.total+' employees is provided in the C.P.8D file (P{E-no}_'+year+'.txt).',m+4,y+8);
  doc.text('EA and CP8D figures must reconcile. Employers who filed via e-Data Praisi/e-CP8D need not re-furnish CP8D.',m+4,y+13); y+=26;
  doc.setDrawColor(HR_LINE[0],HR_LINE[1],HR_LINE[2]); doc.line(m,H-34,W-m,H-34);
  doc.setTextColor(HR_MUTED[0],HR_MUTED[1],HR_MUTED[2]); doc.setFont('helvetica','normal'); doc.setFontSize(7);
  doc.text('Failure to furnish Form e-E by 31 March is an offence under s.120(1)(b), Income Tax Act 1967.',m,H-29);
  doc.text('This is a working summary — file the official Form e-E on https://mytax.hasil.gov.my.',m,H-25.5);
  doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.setTextColor(HR_INK[0],HR_INK[1],HR_INK[2]);
  doc.text('Declaration by employer — Name: __________________________  Signature: __________________  Date: __________',m,H-12);
}
function hrCp8dCategory(e){ var ms=String(e.maritalStatus||'single').toLowerCase(); if(ms==='married') return e.spouseWorking?3:2; if(ms==='divorced'||ms==='widowed') return 3; return (e.numChildren||0)>0?3:1; }
function hrIntNoSen(n){ return String(Math.trunc(Number(n)||0)); }
function hrDec2(n){ return (Number(n)||0).toFixed(2); }
function hrFmtDMY(d){ if(!d)return ''; var x=new Date(d); if(isNaN(x))return ''; var p=function(v){return ('0'+v).slice(-2);}; return p(x.getDate())+'-'+p(x.getMonth()+1)+'-'+x.getFullYear(); }

// ===== Year-end: the FIGURES that go to LHDN =====
//
// v222: lifted verbatim out of hros.html's hrExpEA / hrExpFormE / hrExpCp8d for the same reason the
// drawers above were lifted — they are the FILING, not the button. hrDrawEA and hrDrawFormE were already
// here, so the PDFs could not fork; the numbers those two forms and the CP8D file are built FROM were
// still assembled inside the legacy screen, so a React port had to either re-express them or hand off.
// A second copy of a statutory figure is a filing that eventually disagrees with itself.
//
// What stayed in hros.html: choosing the employee, loading jsPDF, saving the file, the toast. Those are
// the button. Everything below is a pure function of its arguments.

/** The totals row for an employee with no finalised payslip in the year — hros.html's HR_EA_ZERO. */
var HR_EA_ZERO={ gross:0,epfEe:0,epfEr:0,socsoEe:0,socsoEr:0,eisEe:0,eisEr:0,lindung:0,pcb:0,net:0,months:0 };

// Who gets filed. "Paid in the year" is months>0, NOT merely having an employee row: an employee with
// no finalised payslip has nothing to put on an EA form and must not appear in CP8D either, or the
// employer declares remuneration of zero for a person LHDN will then chase. The EA population, the CP8D
// population and the count on the screen are this one predicate, so they cannot drift apart.
function hrYePaid(employees, annual){
  var ann=annual||{};
  return (employees||[]).filter(function(e){ return ann[e.id]&&ann[e.id].months>0; });
}

// Form E (C.P.8) part B — the six declared figures. `total`/`newHires`/`ceased` count EVERY employee
// row, not just the paid ones (Form E declares the workforce; CP8D declares the remuneration), which is
// why this walks `employees` and not hrYePaid().
//
// KNOWN, MIRRORED, NOT FIXED: `new Date(e.join_date).getFullYear()` parses a bare YYYY-MM-DD as midnight
// UTC, so west of Greenwich a 1 January hire reads as the PREVIOUS year and drops out of `newHires`.
// This machine and CI both sit at UTC+8, where it cannot be observed. Changing it changes a declared
// figure, so it is lifted exactly as hros.html has always computed it; tests pin the source so a port
// cannot quietly "fix" or worsen it either.
function hrFormEStats(employees, annual, year){
  var emps=employees||[], ann=annual||{};
  var totalGross=0,totalPcb=0,subjectPcb=0;
  emps.forEach(function(e){ var t=ann[e.id]; if(t){ totalGross+=t.gross; totalPcb+=t.pcb; if(t.pcb>0)subjectPcb++; } });
  var newHires=emps.filter(function(e){ return e.join_date&&new Date(e.join_date).getFullYear()===year; }).length;
  var ceased=emps.filter(function(e){ return e.resign_date&&new Date(e.resign_date).getFullYear()===year; }).length;
  return { total:emps.length, newHires:newHires, ceased:ceased, subjectPcb:subjectPcb, totalGross:totalGross, totalPcb:totalPcb };
}

// CP8D — the per-employee remuneration schedule that accompanies Form E. `list` is
// [{emp:hrEmpView(e), tot:annual[e.id]}, ...] for hrYePaid()'s population; `fmt` is 'txt' (the
// pipe-delimited file MyTax ingests) or 'csv' (the same records, for a human to check before uploading).
// Returns {name, text} — the caller downloads it.
//
// The two layouts carry the SAME 23 values in the same order and must stay that way: the CSV is what an
// operator reviews and signs off, and if it can disagree with the TXT then the review proves nothing.
// v196: the SOCSO field is the Second-Schedule contribution PLUS LINDUNG 24 — see
// tests/lindung_reporting_test.ts for what happened when it was not.
//
// The one deliberate difference from the two copies this replaces: a NULL name reached the CSV as the
// four characters `null` (hrCsv stringifies whatever it is handed) and the TXT as the empty string. Both
// now take the TXT's reading. That is the point of one builder — a review copy that can disagree with
// the uploaded file is not a review.
//
// NO TOTAL ROW, in either format, deliberately: CP8D is a record-per-employee schedule and a trailing
// "TOTAL" line is read by the uploader as one more employee — the same class of defect as the TOTAL
// trailer that was removed from the bank payment file in v157 (hros.html:1849).
function hrCp8dFile(list, employerNo, year, fmt){
  var rows=(list||[]).map(function(o){
    var e=o.emp, t=o.tot||HR_EA_ZERO;
    return {
      name:String(e.name||''),
      tin:e.taxNo?String(e.taxNo).replace(/\D/g,''):'',
      ic:(String(e.ic||'').replace(/[\s-]/g,''))||'000000000000',
      cat:hrCp8dCategory(e),
      ceased:e.resignDate?hrFmtDMY(e.resignDate):'',
      children:e.numChildren||0,
      gross:t.gross, epfEe:t.epfEe, pcb:t.pcb,
      socso:(Number(t.socsoEe)||0)+(Number(t.lindung)||0)
    };
  });
  if(fmt==='txt'){
    var eno=(String(employerNo||'').replace(/\D/g,''))||'0000000000';
    var lines=rows.map(function(r){
      return [ r.name.slice(0,60), r.tin, r.ic.slice(0,12), r.cat, 2, r.ceased, 2, r.children,
        hrIntNoSen(r.children*2000), hrIntNoSen(r.gross), 0, 0, 0, 0, 0, hrDec2(0), hrIntNoSen(r.epfEe),
        hrDec2(0), hrDec2(r.pcb), '', 0, hrIntNoSen(r.socso) ].join('|');
    });
    return { name:'P'+eno+'_'+year+'.txt', text:lines.join('\r\n')+'\r\n' };
  }
  var head=['No','Name','TIN','IC/Passport','Category','Status','End date','Tax borne','Children','Child relief','Gross remuneration','BIK','VOLA','ESOS','Exempt','TP1','Zakat (TP1)','EPF','Zakat (salary)','MTD','CP38','Medical ins.','SOCSO'];
  var body=rows.map(function(r,i){
    return [ i+1, r.name, r.tin, r.ic, r.cat, 2, r.ceased, 2, r.children,
      hrIntNoSen(r.children*2000), hrIntNoSen(r.gross), 0,0,0,0,0, hrDec2(0), hrIntNoSen(r.epfEe),
      hrDec2(0), hrDec2(r.pcb), '', 0, hrIntNoSen(r.socso) ];
  });
  return { name:'CP8D_YA'+year+'.csv', text:hrCsv([head].concat(body)) };
}

// Consumable by a bundler without touching this file again — see the note in payroll.js. The one thing
// that does not survive the trip untouched is hrDrawPayslip's HR_EMPLOYER/HR_COMPANY read, described
// above; every other export here is a pure function of its arguments.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  hrEmpView, HR_money2, hrCsv, hrAscii, hrMissingIds, hrPadR, hrPadL, hrCents,
  hrFitReset, hrFitNote, HR_BANK_CODE, hrBankCode, hrSwift,
  hrDrawPayslip, hrDrawEA, hrDrawFormE, hrCp8dCategory, hrIntNoSen, hrDec2, hrFmtDMY,
  HR_EA_ZERO, hrYePaid, hrFormEStats, hrCp8dFile,
};

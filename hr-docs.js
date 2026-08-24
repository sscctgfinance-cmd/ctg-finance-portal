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

// ── The statutory / bank FILE builders (v226) ──────────────────────────────────────────────────────
// Lifted verbatim out of hros.html's hrExpStatutory / hrExpKwsp / hrExpAssist / hrExpCp39 / hrExpGiro /
// hrExpBank so React (web/) builds the same bytes rather than a second copy — the "seam still open"
// CLAUDE.md names. Each is a pure function of (rows, period, …) and returns the file, an { error }
// message, or null (nothing to file this period). The I/O — hrCurRows/hrPeriod/hrUobCfg, the download and
// the toast — stays in the caller (hros.html's thin wrapper, or web's route). `rows` is hrCurRows()'s
// shape: [{ e: hrEmpView(emp), p: computed quote, d: grid cell }]. tests/statutory_files_test.ts drives
// these directly; the file contents leave the building, so getting a digit wrong is a real filing error.

// EPF / SOCSO / EIS / PCB raw reconciliation CSVs (with a TOTAL row — these are review copies, not uploads).
function hrBuildStatutory(rows, period, kind){
  var tag=period.label.replace(' ',''); var f2=function(n){return Number(n).toFixed(2);};
  var head,body=[],totals,name;
  if(kind==='epf'){ name='EPF_KWSP_'+tag+'.csv'; head=['No','EPF Member No','IC (New)','Name','EPF Wages (RM)','Employee 11% (RM)','Employer 12-13% (RM)','Total (RM)']; var a1=0,a2=0,a3=0; rows.forEach(function(x,i){ var e=x.e,p=x.p,t=p.epfEe+p.epfEr; a1+=p.epfEe;a2+=p.epfEr;a3+=t; body.push([i+1,e.epfNo||'',e.ic||'',e.name,f2(p.gross),f2(p.epfEe),f2(p.epfEr),f2(t)]); }); totals=['','','','TOTAL','',f2(a1),f2(a2),f2(a3)]; }
  // v196: LINDUNG 24 Jam (SKBBK) gets its own column so the file reconciles line by line against ASSIST.
  else if(kind==='socso'){ name='SOCSO_PERKESO_'+tag+'.csv'; head=['No','SOCSO No','IC (New)','Name','Wages (RM)','Employee 0.5% (RM)','LINDUNG 24 (RM)','Employee total (RM)','Employer 1.75% (RM)','Total (RM)']; var b1=0,b1l=0,b2=0,b3=0; rows.forEach(function(x,i){ var e=x.e,p=x.p,li=Number(p.lindung)||0,ee=p.socsoEe+li,t=ee+p.socsoEr; b1+=p.socsoEe;b1l+=li;b2+=p.socsoEr;b3+=t; body.push([i+1,e.socsoNo||'',e.ic||'',e.name,f2(p.gross),f2(p.socsoEe),f2(li),f2(ee),f2(p.socsoEr),f2(t)]); }); totals=['','','','TOTAL','',f2(b1),f2(b1l),f2(b1+b1l),f2(b2),f2(b3)]; }
  else if(kind==='eis'){ name='EIS_SIP_'+tag+'.csv'; head=['No','SOCSO No','IC (New)','Name','Wages (RM)','Employee 0.2% (RM)','Employer 0.2% (RM)','Total (RM)']; var c1=0,c2=0,c3=0; rows.forEach(function(x,i){ var e=x.e,p=x.p,t=p.eisEe+p.eisEr; c1+=p.eisEe;c2+=p.eisEr;c3+=t; body.push([i+1,e.socsoNo||'',e.ic||'',e.name,f2(p.gross),f2(p.eisEe),f2(p.eisEr),f2(t)]); }); totals=['','','','TOTAL','',f2(c1),f2(c2),f2(c3)]; }
  else { name='PCB_CP39_'+tag+'.csv'; head=['No','IC (New)','TIN (Income Tax No)','Name','Country','Remuneration (RM)','PCB/MTD (RM)','CP38 (RM)']; var d1=0; rows.forEach(function(x,i){ var e=x.e,p=x.p; d1+=p.pcb; body.push([i+1,e.ic||'',e.taxNo||'',e.name,'MY',f2(p.gross),f2(p.pcb),'0.00']); }); totals=['','','','TOTAL','','',f2(d1),'0.00']; }
  return { name:name, text:hrCsv([head].concat(body,[totals])), mime:'text/csv;charset=utf-8;' };
}
// EPF → KWSP i-Akaun bulk contribution text file (fixed-width; amounts in cents, no decimal point)
function hrBuildKwsp(rows, period){
  rows=rows.filter(function(x){ return x.p.epfEe||x.p.epfEr; });
  if(!rows.length) return null;
  var miss=hrMissingIds(rows,[{k:'epfNo',label:'EPF member no'},{k:'ic',label:'IC'}]);
  if(miss) return { error:'KWSP file blocked — missing EPF member no / IC: '+miss+'. Fill them in Employees, then export again.' };
  hrFitReset();   // v199: refuse to emit a record whose member number or amount had to be trimmed to fit
  var total=0;
  var lines=rows.map(function(x){ var e=x.e,p=x.p; total+=p.epfEe+p.epfEr;
    return hrPadL(String(e.epfNo||'').replace(/\D/g,''),12,'0','EPF member no for '+e.name)
         + hrPadL(String(e.ic||'').replace(/\D/g,''),12,'0','IC for '+e.name)
         + hrPadR(hrAscii(e.name).toUpperCase(),40)               // name (40) — clipping a name is fine
         + hrPadL(hrCents(p.gross),11,'0','EPF wages for '+e.name)
         + hrPadL(hrCents(p.epfEe),9,'0','EPF employee share for '+e.name)
         + hrPadL(hrCents(p.epfEr),9,'0','EPF employer share for '+e.name);
  });
  if(HR_FIT_ERR.length) return { error:'KWSP file blocked — a value does not fit the layout, and a trimmed one would be credited to the wrong member: '+HR_FIT_ERR.join(' · ') };
  return { name:'KWSP_iAkaun_'+period.label.replace(' ','')+'.txt', text:lines.join('\r\n')+'\r\n', mime:'text/plain;charset=utf-8;', count:lines.length, total:total };
}
// SOCSO + EIS → PERKESO ASSIST combined contribution file (CSV)
function hrBuildAssist(rows, period){
  // v157: only contributing staff belong in an ASSIST submission.
  rows=rows.filter(function(x){ return x.p.socsoEe||x.p.socsoEr||x.p.eisEe||x.p.eisEr; });
  if(!rows.length) return null;
  var miss=hrMissingIds(rows,[{k:'socsoNo',label:'SOCSO no'},{k:'ic',label:'IC'}]);
  if(miss) return { error:'PERKESO ASSIST blocked — missing SOCSO no / IC: '+miss+'. Fill them in Employees, then export again.' };
  var f2=function(n){ return Number(n).toFixed(2); };
  // v196: LINDUNG 24 Jam (SKBBK) gets its own column — an employee-borne PERKESO contribution.
  var head=['No','No. KP Baru (New IC)','Nama Pekerja','No. Pekerja (SOCSO)','Gaji/Upah (RM)','Caruman SOCSO Pekerja','Caruman LINDUNG 24 (SKBBK)','Caruman SOCSO Majikan','Caruman SIP/EIS Pekerja','Caruman SIP/EIS Majikan'];
  var body=rows.map(function(x,i){ var e=x.e,p=x.p; return [i+1,e.ic||'',e.name,e.socsoNo||'',f2(p.gross),f2(p.socsoEe),f2(Number(p.lindung)||0),f2(p.socsoEr),f2(p.eisEe),f2(p.eisEr)]; });
  var t=rows.reduce(function(a,x){ a.a+=x.p.socsoEe;a.l+=(Number(x.p.lindung)||0);a.b+=x.p.socsoEr;a.c+=x.p.eisEe;a.d+=x.p.eisEr; return a; },{a:0,l:0,b:0,c:0,d:0});
  // v157: no TOTAL trailer — ASSIST parses it as one more employee.
  return { name:'PERKESO_ASSIST_'+period.label.replace(' ','')+'.csv', text:hrCsv([head].concat(body)), mime:'text/csv;charset=utf-8;', count:rows.length, total:(t.a+t.l+t.b+t.c+t.d) };
}
// PCB → LHDN CP39 / e-PCB text file (fixed-width; amounts in cents)
function hrBuildCp39(rows, period){
  rows=rows.filter(function(x){ return x.p.pcb>0; });
  if(!rows.length) return null;
  var miss=hrMissingIds(rows,[{k:'taxNo',label:'tax no (TIN)'},{k:'ic',label:'IC'}]);
  if(miss) return { error:'CP39 blocked — missing TIN / IC: '+miss+'. Fill them in Employees, then export again.' };
  // v199: the TIN field is the 11-digit income-tax NUMBER, not the printed reference — truncating one files
  // against the wrong taxpayer, so an over-long TIN blocks the file rather than being clipped.
  var badTin=rows.filter(function(x){ return String(x.e.taxNo||'').replace(/\D/g,'').length>11; })
                 .map(function(x){ return x.e.name+' ('+x.e.taxNo+')'; });
  if(badTin.length) return { error:'CP39 blocked — these income-tax numbers are longer than the 11 digits the layout allows, and truncating one would file the payment against the wrong taxpayer: '+badTin.join(' · ')+'. Correct them in Employees.' };
  hrFitReset();
  var total=0;
  var lines=rows.map(function(x){ var e=x.e,p=x.p; total+=p.pcb;
    // v157: report CP38 that was actually deducted, not a hard-coded zero.
    var cp38=(x.d&&x.d.deductions?x.d.deductions:[]).filter(function(dd){ return /^CP38/i.test(String(dd.label||'')); })
              .reduce(function(s,dd){ return s+(Number(dd.amount)||0); },0);
    return hrPadL(String(e.taxNo||'').replace(/\D/g,''),11,' ','TIN for '+e.name)  // income-tax no, digits only (11)
         + hrPadL(String(e.ic||'').replace(/\D/g,''),12,'0','IC for '+e.name)      // new IC (12)
         + hrPadR(hrAscii(e.name).toUpperCase(),60)                                // name (60) — clipping a name is fine
         + hrPadL(hrCents(p.pcb),8,'0','PCB for '+e.name)                          // PCB/MTD cents (8)
         + hrPadL(hrCents(cp38),8,'0','CP38 for '+e.name);                         // CP38 cents (8)
  });
  if(HR_FIT_ERR.length) return { error:'CP39 blocked — a value does not fit the layout, and a trimmed one would be filed against the wrong person: '+HR_FIT_ERR.join(' · ') };
  return { name:'LHDN_CP39_'+period.label.replace(' ','')+'.txt', text:lines.join('\r\n')+'\r\n', mime:'text/plain;charset=utf-8;', count:lines.length, total:total };
}
// Generic IBG salary CSV (net pay). No blockers/error mode — the caller checks for empty rows.
function hrBuildGiro(rows, period){
  var tag=period.label.replace(' ',''); var ref='SALARY '+tag.toUpperCase(); var f2=function(n){return Number(n).toFixed(2);};
  var head=['No','Payee Name','Bank','Bank Code (BIC)','Account No','IC (New)','Amount (RM)','Payment Ref','Email'];
  var body=rows.map(function(x,i){ var e=x.e,p=x.p; return [i+1,(e.bankHolder||e.name),e.bankName||'',hrSwift(e),e.bankAccount||'',e.ic||'',f2(p.net),ref+' '+e.empNo,e.email||'']; });
  // v157 CRITICAL: never append a "TOTAL" trailer to a BANK file — the trailer becomes a real credit line.
  var total=rows.reduce(function(s,x){return s+x.p.net;},0);
  return { name:'Bank_Giro_'+tag+'.csv', text:hrCsv([head].concat(body)), mime:'text/csv;charset=utf-8;', count:rows.length, total:total };
}
// Bank-specific salary bulk-payment file (net pay). `tips` are non-blocking UOB reminders the caller toasts.
function hrBuildBank(rows, period, bank, uobCfg){
  if(!rows.length) return null;
  var tag=period.label.replace(' ',''); var f2=function(n){return Number(n).toFixed(2);};
  var refBase=('SAL'+period.label.replace(/[^A-Za-z0-9]/g,'').toUpperCase()).slice(0,14);
  var pay=rows.filter(function(x){ return x.p.net>0; });
  if(!pay.length) return null;
  var noAcct=pay.filter(function(x){ return !x.e.bankAccount; }).length;
  var total=pay.reduce(function(s,x){ return s+x.p.net; },0);
  // v157: real blockers — a salary file with a blank beneficiary account silently leaves that person unpaid.
  var blockers=[], tips=[];
  if(noAcct){ var whoNo=pay.filter(function(x){ return !x.e.bankAccount; }).map(function(x){ return x.e.name; }).slice(0,5).join(', ');
    blockers.push(noAcct+' staff have no bank account ('+whoNo+(noAcct>5?', …':'')+')'); }
  var head,body,name;
  if(bank==='maybank'){
    name='Maybank_M2E_Salary_'+tag+'.csv';
    head=['Payment Mode','Beneficiary Name','Beneficiary Account No','Beneficiary Bank','SWIFT/BIC','Amount (RM)','Recipient Reference','Payment Description','Beneficiary ID (New IC)','Beneficiary Email'];
    body=pay.map(function(x){ var e=x.e; var own=/maybank|malayan banking/i.test(e.bankName||''); return [own?'IBFT':'IBG',(e.bankHolder||e.name),e.bankAccount||'',e.bankName||'',hrSwift(e),f2(x.p.net),(refBase+(e.empNo||'')).slice(0,20),'Salary '+period.label,e.ic||'',e.email||'']; });
  } else {
    // UOB Infinity — Pay & Transfer → Bulk Transactions → "IBG Payroll with Payment Advice (Employee)"
    var u=uobCfg||{};
    if(!u.acct) tips.push('Tip: set the UOB debit account (Payment Hub → Save) so the file carries it.');
    var cd=u.cd ? u.cd.split('-').reverse().join('/') : '';   // yyyy-mm-dd → dd/mm/yyyy
    if(!cd) tips.push('Tip: pick a Crediting date in the Payment Hub — UOB needs the date salaries reach staff.');
    name='UOB_Infinity_IBG_Payroll_'+tag+'.csv';
    head=['Crediting Date','Debit Account','Beneficiary Name','Beneficiary Bank','SWIFT/BIC','Beneficiary Account No','Amount (RM)','Payment Reference','Beneficiary ID (New IC)','Payment Advice Email','Payment Type'];
    body=pay.map(function(x){ var e=x.e; var own=/uob|united overseas/i.test(e.bankName||''); return [cd,u.acct||'',(e.bankHolder||e.name),e.bankName||'',hrSwift(e),e.bankAccount||'',f2(x.p.net),('SALARY '+period.label+' '+(e.empNo||'')).toUpperCase().slice(0,30),e.ic||'',e.email||'',own?'Internal':'IBG']; });
  }
  return { name:name, text:hrCsv([head].concat(body)), mime:'text/csv;charset=utf-8;', count:pay.length, total:total, noAcct:noAcct, blockers:blockers, tips:tips };
}
// ── Dependency-free STORE-method ZIP for the one-click submission pack (no compression needed for text) ──
var HR_CRC_TBL=(function(){ var t=[],c,n,k; for(n=0;n<256;n++){ c=n; for(k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
function hrCrc32(bytes){ var crc=0xFFFFFFFF; for(var i=0;i<bytes.length;i++) crc=(crc>>>8)^HR_CRC_TBL[(crc^bytes[i])&0xFF]; return (crc^0xFFFFFFFF)>>>0; }
function hrZip(files){
  var enc=new TextEncoder(), parts=[], central=[], offset=0;
  var u16=function(n){return [n&255,(n>>8)&255];}, u32=function(n){n>>>=0;return [n&255,(n>>8)&255,(n>>16)&255,(n>>24)&255];};
  files.forEach(function(f){
    var nameB=enc.encode(f.name), dataB=enc.encode(f.text), crc=hrCrc32(dataB);
    var lh=[].concat(u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(dataB.length),u32(dataB.length),u16(nameB.length),u16(0));
    parts.push(new Uint8Array(lh),nameB,dataB);
    var ch=[].concat(u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc),u32(dataB.length),u32(dataB.length),u16(nameB.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset));
    central.push(new Uint8Array(ch),nameB);
    offset+=lh.length+nameB.length+dataB.length;
  });
  var cdSize=central.reduce(function(s,p){return s+p.length;},0);
  var end=[].concat(u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(cdSize),u32(offset),u16(0));
  return new Blob(parts.concat(central,[new Uint8Array(end)]),{type:'application/zip'});
}
// The one-click "Submit all" pack: build every statutory + salary file and report what succeeded/failed.
// v157: a builder that BLOCKS returns { error }; a null file is nothing-to-file this period (neither got
// nor failed). The company prefix stops five Sdn Bhd packs for the same month overwriting on extract.
function hrSubmissionSpecs(rows, period, companyName, uobCfg){
  var co=(companyName||'CTG').replace(/[^A-Za-z0-9]+/g,'_');
  // v157: an unusable salary file must FAIL the pack rather than ship silently. hrBuildBank returns the
  // file with a `blockers` list (a blank beneficiary account leaves that person unpaid); in the ZIP that
  // is an error, not a warning — the one-click pack must never call itself complete while a file is broken.
  var bank=hrBuildBank(rows,period,'uob',uobCfg);
  var salary=(bank&&bank.blockers&&bank.blockers.length)?{ error:'Salary file: '+bank.blockers.join('; ') }:bank;
  var specs=[
    { key:'salary',  label:'Salaries (UOB Infinity)', file:salary },
    { key:'epf',     label:'EPF — KWSP i-Akaun',      file:hrBuildKwsp(rows,period) },
    { key:'perkeso', label:'SOCSO + EIS — PERKESO',   file:hrBuildAssist(rows,period) },
    { key:'pcb',     label:'PCB — LHDN CP39',         file:hrBuildCp39(rows,period) }
  ];
  var failed=specs.filter(function(s){ return s.file && s.file.error; });
  var got   =specs.filter(function(s){ return s.file && !s.file.error; });
  var files=got.map(function(s){ return { name:co+'_'+s.file.name, text:s.file.text }; });
  return { co:co, specs:specs, got:got, failed:failed, files:files,
    zipName:'CTG_Payroll_Submissions_'+co+'_'+period.label.replace(' ','')+'.zip' };
}

// ── Payroll Summary (Excel), payslip email helpers (v226) ───────────────────────────────────────────
// Same lift as the file builders above. `hrEsc` is hros.html's `esc` — it CANNOT be named `esc` here
// because hros.html declares `const esc` and hr-docs.js loads first, so a same-name global is a
// redeclare SyntaxError that white-screens the app; a local name is byte-identical and safe.
function hrEsc(x){ return (x==null?'':String(x)).replace(/[&<>"']/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
var HR_HRDF_RATE=0.01; // HRD Corp levy = 1% of basic (only for HRDF-registered employers) — rate under finance review.
// Payroll Summary — a styled .xls that opens formatted in Excel. Also the ONLY place HRDF is computed.
function hrBuildSummary(rows, period, companyName){
  var numCell=function(v,dir){ v=Number(v)||0; var st='border:1px solid #B8C4D9;padding:4px 8px;text-align:right;'+(dir?'font-weight:bold;':''); if(!v) return '<td style="'+st+'">-</td>'; return '<td style="'+st+'mso-number-format:\'#,##0.00\'">'+v.toFixed(2)+'</td>'; };
  var txtCell=function(v,dir){ return '<td style="border:1px solid #B8C4D9;padding:4px 8px;text-align:left;'+(dir?'font-weight:bold;':'')+'">'+hrEsc(String(v==null?'':v))+'</td>'; };
  var cols=['Employee','Role','Basic','Additional / Allowance','Gross Pay','EPF (Employee)','SOCSO (Employee)','LINDUNG 24','EIS (Employee)','PCB (Tax)','Advance / Other Ded.','Total Deductions','Net Pay','EPF (Employer)','SOCSO (Employer)','EIS (Employer)','HRDF','Notes'];
  var tot={basic:0,add:0,gross:0,ee_epf:0,ee_soc:0,ee_lin:0,ee_eis:0,pcb:0,oded:0,tded:0,net:0,er_epf:0,er_soc:0,er_eis:0,hrdf:0};
  var trs=rows.map(function(r){
    var e=r.e,p=r.p,d=r.d||{};
    var basic=Number(d.basic!=null?d.basic:e.basic)||0;
    var add=(Number(d.allow)||0)+(Number(d.bonus)||0)+(Number(d.ot)||0)+(Number(d.allowance)||0);
    var oded=(d.deductions||[]).reduce(function(s,x){return s+(Number(x.amount)||0);},0);
    var lin=Number(p.lindung)||0;
    var tded=p.epfEe+p.socsoEe+lin+p.eisEe+p.pcb+oded;   // v196: lindung was missing, so Gross - Total Deductions did not equal Net Pay
    var hrdf=Math.round(basic*HR_HRDF_RATE*100)/100;
    var isDir=/director/i.test(e.position||'');
    var notes=[];
    if(d.bonus) notes.push('Bonus '+Number(d.bonus).toFixed(2));
    if(d.ot) notes.push('OT '+Number(d.ot).toFixed(2));
    if(d.allowance) notes.push('Allowance '+Number(d.allowance).toFixed(2));
    (d.deductions||[]).forEach(function(x){ if(Number(x.amount)) notes.push('Less '+(x.label||'Deduction')+' '+Number(x.amount).toFixed(2)); });
    if(d.unpaid) notes.push('Unpaid leave '+Number(d.unpaid).toFixed(2));
    tot.basic+=basic; tot.add+=add; tot.gross+=p.gross; tot.ee_epf+=p.epfEe; tot.ee_soc+=p.socsoEe; tot.ee_lin+=lin; tot.ee_eis+=p.eisEe; tot.pcb+=p.pcb; tot.oded+=oded; tot.tded+=tded; tot.net+=p.net; tot.er_epf+=p.epfEr; tot.er_soc+=p.socsoEr; tot.er_eis+=p.eisEr; tot.hrdf+=hrdf;
    return '<tr'+(isDir?' style="background:#FFF7E6"':'')+'>'+txtCell(e.name,isDir)+txtCell(e.position||'',isDir)+numCell(basic,isDir)+numCell(add,isDir)+numCell(p.gross,isDir)+numCell(p.epfEe,isDir)+numCell(p.socsoEe,isDir)+numCell(lin,isDir)+numCell(p.eisEe,isDir)+numCell(p.pcb,isDir)+numCell(oded,isDir)+numCell(tded,isDir)+numCell(p.net,isDir)+numCell(p.epfEr,isDir)+numCell(p.socsoEr,isDir)+numCell(p.eisEr,isDir)+numCell(hrdf,isDir)+'<td style="border:1px solid #B8C4D9;padding:4px 8px;font-style:italic;color:#555">'+hrEsc(notes.join('; '))+'</td></tr>';
  }).join('');
  var totRow='<tr style="background:#DCE6F1">'+'<td style="border:1px solid #B8C4D9;padding:4px 8px;font-weight:bold">TOTAL</td><td style="border:1px solid #B8C4D9"></td>'+
    numCell(tot.basic,1)+numCell(tot.add,1)+numCell(tot.gross,1)+numCell(tot.ee_epf,1)+numCell(tot.ee_soc,1)+numCell(tot.ee_lin,1)+numCell(tot.ee_eis,1)+numCell(tot.pcb,1)+numCell(tot.oded,1)+numCell(tot.tded,1)+numCell(tot.net,1)+numCell(tot.er_epf,1)+numCell(tot.er_soc,1)+numCell(tot.er_eis,1)+numCell(tot.hrdf,1)+'<td style="border:1px solid #B8C4D9"></td></tr>';
  var thead='<tr>'+cols.map(function(c){ var left=(['Employee','Role','Notes'].indexOf(c)>=0); return '<th style="background:#1F4E79;color:#ffffff;border:1px solid #163A5C;padding:6px 8px;font-weight:bold;text-align:'+(left?'left':'center')+';vertical-align:middle">'+hrEsc(c)+'</th>'; }).join('')+'</tr>';
  var html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">'+
    '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>'+hrEsc(period.label)+'</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->'+
    '</head><body><table style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11px">'+
    '<tr><td colspan="17" style="font-size:16px;font-weight:bold;padding:4px 2px">'+hrEsc(period.label)+' Payroll</td></tr>'+
    '<tr><td colspan="17" style="font-weight:bold;padding:0 2px 2px">'+hrEsc(companyName)+'</td></tr>'+
    '<tr><td colspan="17" style="color:#666;font-style:italic;padding:0 2px 10px">Payroll Summary — '+hrEsc(period.label)+'. All amounts in RM. Headcount: '+rows.length+' employees.</td></tr>'+
    '<thead>'+thead+'</thead><tbody>'+trs+totRow+'</tbody></table></body></html>';
  return { name:'Payroll_Summary_'+period.label.replace(' ','')+'.xls', text:html, mime:'application/vnd.ms-excel' };
}
// Payslip email (Wave 3b): password-protected PDF via the send-payslip-email edge fn. The PDF DRAWING is
// hrDrawPayslip (already shared); these are the pure helpers around it. `companyName` was the HR_COMPANY
// global — passed in for the same reason hrBuildSummary takes it.
function hrAbToB64(ab){ var bytes=new Uint8Array(ab),bin='',chunk=0x8000; for(var i=0;i<bytes.length;i+=chunk){ bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk)); } return btoa(bin); }
function hrIcPassword(e){ return (String(e.ic||'').replace(/\D/g,''))||e.empNo; }
function hrPayslipEmailHtml(e,period,companyName){ return '<div style="font-family:Arial,sans-serif;color:#17231f;max-width:520px"><p>Hi '+hrEsc(String(e.name||'').split(' ')[0])+',</p><p>Your payslip for <b>'+hrEsc(period.label)+'</b> is attached as a PDF.</p><p>For your privacy the file is <b>password-protected</b> — open it with your <b>IC number</b> (digits only, no dashes).</p><p>If anything looks wrong, please contact Finance.</p><p style="color:#5e6e67;font-size:13px;margin-top:22px">'+hrEsc(companyName)+' · Finance<br>This is an automated message from ProCare·HR.</p></div>'; }

// Consumable by a bundler without touching this file again — see the note in payroll.js. The one thing
// that does not survive the trip untouched is hrDrawPayslip's HR_EMPLOYER/HR_COMPANY read, described
// above; every other export here is a pure function of its arguments.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  hrEmpView, HR_money2, hrCsv, hrAscii, hrMissingIds, hrPadR, hrPadL, hrCents,
  hrFitReset, hrFitNote, HR_BANK_CODE, hrBankCode, hrSwift,
  hrDrawPayslip, hrDrawEA, hrDrawFormE, hrCp8dCategory, hrIntNoSen, hrDec2, hrFmtDMY,
  HR_EA_ZERO, hrYePaid, hrFormEStats, hrCp8dFile,
  hrBuildStatutory, hrBuildKwsp, hrBuildAssist, hrBuildCp39, hrBuildGiro, hrBuildBank,
  hrCrc32, hrZip, hrSubmissionSpecs,
  hrEsc, HR_HRDF_RATE, hrBuildSummary, hrAbToB64, hrIcPassword, hrPayslipEmailHtml,
};

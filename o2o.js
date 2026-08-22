// The O2O pharmacy-billing computation — what each pharmacy is invoiced for, and what the invoice is
// numbered.
//
// Moved here verbatim from app.html (the O2O block that sat at app.html:2769-3043). Not a rewrite:
// every grouping rule, every guard and every rounding step is the same source text, because this is the
// code that decides what a real pharmacy is billed.
//
// WHY IT LIVES IN ITS OWN FILE: the same reason wht.js and payroll.js do (read their headers), and here
// the reason is sharper than on either of them. `o2o_issue` (supabase/functions/portal/finance.ts:626)
// does NOT recompute anything: it forwards `Quantity`, `UnitAmount` and `DiscountRate` straight into the
// Xero invoice payload. So the numbers this file produces ARE the invoice — there is no server-side
// authority to fall back on the day two copies disagree, the way Quick Invoice has in `iv.Total`. A
// React port that re-expressed this arithmetic would be a second copy of a billing engine with nothing
// checking that the copies agree. `web/src/finance-o2o.tsx` imports it, through o2o.d.ts.
//
// ── The two rules this file lives by ─────────────────────────────────────────────────────────────
//
// 1. It MUST stay a classic script (<script src="o2o.js">, never type="module"), loaded before
//    app.html's inline <script>. See common.js:1-20 — the apps wire ~450 inline onclick= handlers that
//    resolve names as globals at click time, and a module's top-level declarations are not global.
// 2. Nothing here runs at load time and nothing here reads app state. In particular `o2oParseRows` takes
//    `useSkuMode` as an ARGUMENT rather than calling `o2oIsSkindae()`, and takes already-decoded sheets
//    rather than an ArrayBuffer, so it needs neither COMPANIES, nor O2O_TENANT, nor XLSX to exist. The
//    XLSX decode stays in app.html's `o2oParse()` and in the React route — same split as `bankLines()`
//    on the Bank Rec screen.
//
// Dependencies: none. It calls nothing outside this file.
//
// ── The money, and why it is what it is ──────────────────────────────────────────────────────────
//   SKU mode        Skindae only. Rows are grouped by the SKU their Package text matches, Quantity is
//                   the row COUNT, UnitAmount is the row Price (last write wins), and the line Amount is
//                   the summed gross less the commission rate.
//   Package mode    Every other tenant. Skindae's SKU codes are Skindae-only inventory items in that
//                   Xero org, so rows group by the Package text + unit price instead and the Package
//                   text becomes the invoice description.
//   Unmatched rows  In SKU mode a row whose Package matches no SKU is BILLED at its raw Excel price, not
//                   dropped. Dropping it under-billed the pharmacy for everything it actually sold.
//   The date guard  Both branches require a real Date in the Date column — a JS Date, or an Excel serial
//                   above 10000 (~1927). The summary block under the data (Total Sales / Commission /
//                   Insurans / Billing) also carries a package-ish label and a number; without the guard
//                   those become invoice lines and OVER-bill. While unmatched rows were dropped the
//                   guard was harmless; now that they are billed it is load-bearing.
//   Fallback mode   A sheet with no Date/Package/Price section falls back to a single Total-Sales line
//                   plus a negative commission line, from the sheet's own summary figures.
//   Rounding        Every figure that leaves this file is rounded to the sen with Math.round(x*100)/100,
//                   at the same points the legacy rounded. Rounding earlier or later changes the invoice.

// v28: per-SKU O2O parser — INV-1183 style. Group rows by package suffix → one line per SKU
// (Quantity = row count, UnitAmount = Price, DiscountRate = 19.2% applied per line).
var O2O_SKU_MAP = [
  { match: /basic[\s\-]*a[\s\-]*3/i, code: 'SKO2OB3', desc: 'SKINDAE CELL LIFT, NMN AMPOULE 30ML - BASIC A-3', label: 'Basic A-3' },
  { match: /basic[\s\-]*b[\s\-]*1/i, code: 'SKO2OB1', desc: 'SKINDAE CELL LIFT, NMN AMPOULE 30ML - BASIC B-1', label: 'Basic B-1' },
  { match: /promo[\s\-]*b\b/i,        code: 'SKO2OPB', desc: 'SKINDAE CELL LIFT, NMN AMPOULE 30ML - PROMO B',   label: 'Promo B' },
  { match: /promo[\s\-]*c\b/i,        code: 'SKO2OPC', desc: 'SKINDAE CELL LIFT, NMN AMPOULE 30ML - PROMO C',   label: 'Promo C' },
  { match: /promo[\s\-]*d\b/i,        code: 'SKO2OPD', desc: 'SKINDAE CELL LIFT, NMN AMPOULE 30ML - PROMO D',   label: 'Promo D' }
];

/** The default commission the pharmacy's gross is discounted by. A master record may override it. */
var O2O_DISCOUNT_RATE = 19.2;

function o2oMatchSku(pkgName) {
  var s = String(pkgName || '');
  for (var i = 0; i < O2O_SKU_MAP.length; i++) { if (O2O_SKU_MAP[i].match.test(s)) return O2O_SKU_MAP[i]; }
  return null;
}

// "21 Apr-20 May 2026" → "O2O Sales 21/04/2026 - 20/05/2026". This string is the Xero invoice
// Reference, so it is what the pharmacy reads to know which month it is being billed for.
function o2oFormatReference(periodRaw) {
  var per = String(periodRaw || '').replace(/^Skindae\s+Overall\s+Billing\s*/i, '').trim();
  var mo = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
  // accept "21 Apr-20 May 2026" or "21 Apr 2026-20 May 2026" or "21/04/2026-20/05/2026"
  var m = per.match(/(\d{1,2})\s*([A-Za-z]{3,})\.?\s*(\d{4})?\s*[-–]\s*(\d{1,2})\s*([A-Za-z]{3,})\.?\s*(\d{4})/);
  if (m) {
    var y2 = m[6], y1 = m[3] || y2;
    var m1 = mo[m[2].slice(0, 3).toLowerCase()] || '01';
    var m2 = mo[m[5].slice(0, 3).toLowerCase()] || '01';
    var d1 = ('0' + m[1]).slice(-2), d2 = ('0' + m[4]).slice(-2);
    return 'O2O Sales ' + d1 + '/' + m1 + '/' + y1 + ' - ' + d2 + '/' + m2 + '/' + y2;
  }
  return 'O2O Sales ' + per; // fallback — keep raw if unparsable
}

/**
 * The whole parse, with the XLSX decode left to the caller.
 *
 * `sheets` is [{name, rows}] where `rows` is exactly what
 * `XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:null})` produces — `raw:true` matters, because
 * the date guard below distinguishes a real Date object / Excel serial from a formatted string.
 *
 * `useSkuMode` is app.html's `o2oIsSkindae()`, passed in rather than read: switching the target company
 * changes how the SAME workbook parses, and a function that resolved that itself could not be tested or
 * imported.
 */
function o2oParseRows(sheets, useSkuMode) {
  var period = null, pharmacies = [], grand = 0;
  function findVal(rows, label) {
    for (var r = 0; r < rows.length; r++) { var row = rows[r] || [];
      for (var c = 0; c < 5; c++) { var v = row[c];
        if (v && typeof v === 'string' && v.trim().toLowerCase().indexOf(label) >= 0) {
          for (var i = 1; i <= 3; i++) { var rv = row[c + i]; if (typeof rv === 'number') return rv; }
        }
      }
    }
    return null;
  }
  function findHeaderRow(rows) {
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      var row = rows[r] || [];
      var hasDate = false, hasPkg = false, hasPrice = false;
      for (var c = 0; c < row.length; c++) {
        var v = String(row[c] || '').toLowerCase();
        if (v === 'date') hasDate = true;
        if (v === 'package') hasPkg = true;
        if (v === 'price') hasPrice = true;
      }
      if (hasDate && hasPkg && hasPrice) return r;
    }
    return -1;
  }
  function colIdx(row, name) { for (var c = 0; c < row.length; c++) if (String(row[c] || '').toLowerCase() === name) return c; return -1; }
  (sheets || []).forEach(function (sheet) {
    var sn = sheet.name;
    if (String(sn).trim().toLowerCase() === 'sample') return;
    var rows = sheet.rows || [];
    var name = (rows[0] && rows[0][0]) ? String(rows[0][0]).trim() : sn;
    if (!period && rows[1]) period = rows[1][0];
    // Find the data-section header row (Date | Package | Price | ...)
    var hdrRow = findHeaderRow(rows);
    var grouped = {}, unmatched = [];
    if (hdrRow >= 0) {
      var hdr = rows[hdrRow];
      var cDate = colIdx(hdr, 'date'), cPkg = colIdx(hdr, 'package'), cPrice = colIdx(hdr, 'price');
      for (var r = hdrRow + 1; r < rows.length; r++) {
        var row = rows[r] || [];
        var pkg = row[cPkg], price = row[cPrice];
        if (!pkg || typeof price !== 'number' || price <= 0) continue;
        if (useSkuMode) {
          var hit = o2oMatchSku(pkg);
          if (!hit) {
            // A row we cannot map to a Skindae SKU used to be DROPPED here — its price never reached
            // `grouped`, so the pharmacy was invoiced less than it actually sold. Bill it instead, at
            // its raw price, with the Excel Package text as the description.
            //
            // The date guard below is essential and is the same one the non-Skindae branch uses: the
            // summary rows under the data (Total Sales / Commission / Insurans / Billing) also carry a
            // package-ish label and a number. While unmatched rows were dropped they were harmlessly
            // dropped too — now that unmatched rows are billed, without this guard they would become
            // invoice lines and OVER-bill. Real data rows always carry a Date: a JS Date, or an Excel
            // serial well above 10000 (~1927).
            if (cDate < 0) continue;
            var dvU = row[cDate];
            if (!((dvU instanceof Date) || (typeof dvU === 'number' && dvU > 10000))) continue;
            var descU = String(pkg).trim();
            var keyU = 'RAW|' + descU + '|' + price;
            if (!grouped[keyU]) grouped[keyU] = { code: null, description: descU, label: descU, unit_price: price, quantity: 0, gross: 0, unmapped: true };
            grouped[keyU].quantity++;
            grouped[keyU].gross += price;
            unmatched.push({ pkg: String(pkg), price: price });   // still surfaced — billed, but unmapped
            continue;
          }
          var key = hit.code;
          if (!grouped[key]) grouped[key] = { code: hit.code, description: hit.desc, label: hit.label, unit_price: price, quantity: 0, gross: 0 };
          grouped[key].quantity++;
          grouped[key].gross += price;
          // last-write-wins for unit_price (in case of slight rounding diffs in source)
          grouped[key].unit_price = price;
        } else {
          // Non-Skindae: description IS the Package column value. Group rows with the same
          // Package + unit price into one line item so the invoice stays tidy.
          // Guard against summary rows below the data section (Total Sales / Commission /
          // Insurans / Billing / etc.) — those either have no Date, or hold a rate (0.192)
          // in the Date column. Data rows carry a real Date value: either a JS Date object
          // or an Excel-serial number well above the 10000 threshold (~1927).
          if (cDate < 0) continue;
          var dv = row[cDate];
          var isRealDate = (dv instanceof Date) || (typeof dv === 'number' && dv > 10000);
          if (!isRealDate) continue;
          var desc = String(pkg).trim();
          var keyNs = desc + '|' + price;
          if (!grouped[keyNs]) grouped[keyNs] = { code: null, description: desc, label: desc, unit_price: price, quantity: 0, gross: 0 };
          grouped[keyNs].quantity++;
          grouped[keyNs].gross += price;
        }
      }
    }
    var lines = [];
    Object.keys(grouped).forEach(function (k) {
      var g = grouped[k];
      lines.push({
        item_code: g.code,
        package: g.description,        // shown in invoice description column
        quantity: g.quantity,
        unit_price: g.unit_price,
        discount_rate: O2O_DISCOUNT_RATE,
        amount: Math.round(g.gross * (1 - O2O_DISCOUNT_RATE / 100) * 100) / 100
      });
    });
    // Fallback to old behaviour if no data-row breakdown found (single-line invoice).
    var ts = findVal(rows, 'total sales');
    var billed = findVal(rows, 'billed amount'); if (billed === null) billed = findVal(rows, 'billing');
    if (!lines.length) {
      if (!ts || ts <= 0) return;
      ts = Math.round(ts * 100) / 100; billed = (billed !== null && billed > 0) ? Math.round(billed * 100) / 100 : ts;
      var per = o2oFormatReference(period).replace(/^O2O Sales\s*/, '');
      lines = [{ package: 'Skindae products (' + per + ')', unit_price: ts, quantity: 1, amount: ts }];
      var commission = Math.round((ts - billed) * 100) / 100;
      if (commission > 0) lines.push({ package: 'Commission -19.2%', unit_price: -commission, quantity: 1, amount: -commission });
      pharmacies.push({ pharmacy: name, line_count: lines.length, total: billed, total_sales: ts, commission: commission, lines: lines, unmatched: unmatched, fallback: true });
      grand += billed; return;
    }
    // Per-SKU mode: total_sales = sum of gross before discount; billed = sum after 19.2% discount.
    var totalSales = lines.reduce(function (s, x) { return s + (x.unit_price * x.quantity); }, 0);
    var totalBilled = lines.reduce(function (s, x) { return s + (x.amount || 0); }, 0);
    totalSales = Math.round(totalSales * 100) / 100; totalBilled = Math.round(totalBilled * 100) / 100;
    var commission2 = Math.round((totalSales - totalBilled) * 100) / 100;
    pharmacies.push({ pharmacy: name, line_count: lines.length, total: totalBilled, total_sales: totalSales, commission: commission2, lines: lines, unmatched: unmatched, fallback: false });
    grand += totalBilled;
  });
  return { period: String(period || ''), reference: o2oFormatReference(period), pharmacy_count: pharmacies.length, grand_total: Math.round(grand * 100) / 100, pharmacies: pharmacies };
}

/**
 * Re-price one pharmacy at a commission rate its master record overrides the default with.
 *
 * Returns true when the override applied. `rawRate` is the master's `commission_rate` VERBATIM — the
 * validation is here on purpose: a blank/null master rate must fall back to the default 19.2%, and
 * `Number('') === 0` would otherwise zero the discount and invoice the pharmacy at full gross price.
 *
 * Every line is re-priced, not just the header. Previously only `discount_rate` was relabelled while
 * `l.amount` stayed at the 19.2% figure, so the invoice showed one rate and billed another.
 */
function o2oApplyMasterRate(p, rawRate) {
  var mRate = (rawRate != null && rawRate !== '') ? Number(rawRate) : NaN;
  // Bounded ABOVE as well as below, and 100 is excluded, not merely capped.
  //
  //   · a commission of 100% or more bills the pharmacy nothing or less than nothing. `19.2` typed as
  //     `192` — a decimal point away — produced a line of MINUS RM18,200 on a RM1,000 sale, and
  //     `o2o_issue` (finance.ts:626) forwards UnitAmount into Xero without recomputing it, so that is
  //     the invoice.
  //   · exactly 100 also sets `l.discount_rate = 100`, and the gross recovery below divides by
  //     `1 - discount_rate/100`. A second call on the same lines then divides by zero and every amount
  //     becomes NaN — a line item written into a bill as the literal text "NaN".
  //
  // An out-of-range master rate falls back to the default 19.2%, exactly as a blank or non-numeric one
  // already does. That is silent, and it is the safe direction: a normal invoice rather than a negative
  // one. The caller does not read the return value (app.html:2975, web/app/finance/o2o/page.tsx:126).
  if (!(isFinite(mRate) && mRate > 0 && mRate < 100 && mRate != O2O_DISCOUNT_RATE)) return false;
  p.commission = Math.round((p.total_sales * mRate / 100) * 100) / 100;
  p.total = Math.round((p.total_sales - p.commission) * 100) / 100;
  p.lines.forEach(function (l) {
    if (l.discount_rate != null && l.amount != null) {
      var gross = l.amount / (1 - (l.discount_rate || 0) / 100); // recover gross from the current (default-rate) amount
      l.discount_rate = mRate;
      l.amount = Math.round(gross * (1 - mRate / 100) * 100) / 100;
    } else if (/commission/i.test(l.package || '')) {
      l.unit_price = -p.commission; l.amount = -p.commission; l.package = 'Commission -' + (Math.round(mRate * 10) / 10) + '%'; // fallback single-line model
    }
  });
  return true;
}

/** Sum of what each pharmacy is billed, to the sen. Recomputed after any master rate applied. */
function o2oGrandTotal(pharmacies) {
  return Math.round((pharmacies || []).reduce(function (s, p) { return s + p.total; }, 0) * 100) / 100;
}

// v66: generate invoice numbers for the current preview.
// Returns [] if the operator left the numbering fields empty (fall back to Xero auto-gen)
// or NULL if the start value is not a plain digit run. Zero-padding follows the literal width
// of the entered start value, so typing "001" gives 001/002/003 and typing "1183" gives 1183/1184/1185.
//
// The three states are distinct and the caller must keep them distinct: [] means "let Xero number
// these", null means "the operator typed something invalid, do not post", and a filled array is the
// numbers themselves. Collapsing null into [] posts an unnumbered batch the operator meant to number.
function o2oInvoiceNumbers(count, prefix, startRaw) {
  prefix = String(prefix == null ? '' : prefix).trim();
  startRaw = String(startRaw == null ? '' : startRaw).trim();
  if (!prefix && !startRaw) return [];
  if (!startRaw || !/^\d+$/.test(startRaw)) return null; // invalid
  var pad = startRaw.length;
  var start = parseInt(startRaw, 10);
  var nums = [];
  for (var i = 0; i < count; i++) {
    var s = String(start + i);
    while (s.length < pad) s = '0' + s;
    nums.push(prefix + s);
  }
  return nums;
}

// Consumable by a bundler without touching this file again: everything above is a declaration, so
// importing it is side-effect free. `module` is undefined in a classic <script>, so the browser skips
// this; a CommonJS-aware bundler (webpack/Next, Vite via its commonjs plugin) reads it and hands the
// React app the same functions app.html is calling.
if (typeof module !== 'undefined' && module.exports) module.exports = {
  O2O_SKU_MAP, O2O_DISCOUNT_RATE, o2oMatchSku, o2oFormatReference, o2oParseRows,
  o2oApplyMasterRate, o2oGrandTotal, o2oInvoiceNumbers,
};

// Malaysian time, in ONE place — loaded by app.html and hros.html, imported by web/.
//
// The portal is Malaysian. Every date it derives from a clock — the day an invoice is dated, the month
// payroll opens on, the wall time an admin sees on a punch — means "in Malaysia", not "wherever this
// browser happens to be". Before v224 that was true in Finance (app.html:1264 shifted by +8h) and false
// in HR (hros.html:1271 read the machine), and false again in every LOCAL derivation the timezone audit
// (web/tests/timezone-audit.test.tsx) inventoried. This file is the single answer.
//
// HOW: Malaysia is UTC+8 with no DST and no scheduled change. Shift the instant by +8h and read it back
// with getUTC* — Malaysian wall-clock parts in every browser, with no timezone database and no Intl
// call, so an old browser, a locked-down kiosk and Node all agree. app.html has been written this way
// since H6; this is that idiom, once.
//
// WHY NO OUTPUT ASSERTION ON THIS FLEET CAN CHECK IT: this machine and CI both sit at UTC+8, where MYT
// and the machine's zone are the same answer. Every function here has a LOCAL twin that is right here
// and wrong in London — which is exactly how the Calendar port shipped zone-blind with 29 green tests.
// Pin the SOURCE, or run the suite under TZ=America/New_York. Both are done; see the audit.
//
// NOT covered by "always Malaysian time", deliberately:
//   · a date TYPED into a spreadsheet cell (salesrecon.js, gateway.js) — wall-clock, no zone to fix.
//   · a duration (elapsed ms, relative "3d ago") — zone-free by construction.
//   · hrFormEStats() in hr-docs.js — it changes a figure filed with LHDN. Its own comment says so.

/**
 * The instant, shifted so its getUTC* accessors read Malaysian wall-clock parts. null if unusable.
 *
 * NO ARGUMENT means "now". `null` and `''` do NOT — they mean "there is no instant", and they must come
 * back null. Every caller here is fed a nullable column: an OPEN punch has `clock_out === null`, and
 * `hrDtLocal(null)` filling the box with the current time is an admin one keystroke away from clocking
 * somebody out at whatever time they happened to open the form.
 */
function mytDate(t){
  if (arguments.length === 0 || t === undefined) return new Date(Date.now() + 8*3600000);
  if (t === null || t === '') return null;
  var ms = t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : new Date(t).getTime());
  return isNaN(ms) ? null : new Date(ms + 8*3600000);
}

function mytPad(n){ return String(n).padStart(2,'0'); }

/** YYYY-MM-DD in Malaysia. `mytISO()` is "today in KL" — the default for every date input in the portal. */
function mytISO(t){
  var d = mytDate(t); if(!d) return '';
  return d.getUTCFullYear()+'-'+mytPad(d.getUTCMonth()+1)+'-'+mytPad(d.getUTCDate());
}

/** `days` from now, in Malaysia. Exact ms arithmetic — a fixed-offset zone has no DST day to be short. */
function mytISOPlusDays(days){ return mytISO(Date.now() + Number(days||0)*86400000); }

/** {year, month (1-12), day} in Malaysia — for the pickers that open on "this month". */
function mytYMD(t){
  var d = mytDate(t); if(!d) return null;
  return { year:d.getUTCFullYear(), month:d.getUTCMonth()+1, day:d.getUTCDate() };
}

// The two halves of a <input type="datetime-local">, which carries wall time and NO zone. They are a
// pair: whatever mytDtLocal() puts in the box, mytFromDtLocal() must turn back into the same instant.
// Filling the box with machine wall time and reading it back with `new Date(value)` also round-trips —
// but it SHOWS an admin outside Malaysia an hour the punch was never at, and any correction they make
// to a different field re-posts that hour. That is someone's paid hours. (hros.html:3038 was that.)

/** The value the box must carry to show `t` as Malaysian wall time. */
function mytDtLocal(t){
  var d = mytDate(t); if(!d) return '';
  return d.getUTCFullYear()+'-'+mytPad(d.getUTCMonth()+1)+'-'+mytPad(d.getUTCDate())+
    'T'+mytPad(d.getUTCHours())+':'+mytPad(d.getUTCMinutes());
}

/** The inverse: the operator's typed wall time, read AS Malaysian time. Date, or null. */
function mytFromDtLocal(s){
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s||''));
  if(!m) return null;
  return new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5]) - 8*3600000);
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
  mytDate, mytISO, mytISOPlusDays, mytYMD, mytDtLocal, mytFromDtLocal
};

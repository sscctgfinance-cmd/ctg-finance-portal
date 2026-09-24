/* ══════════════════════════════════════════════════════════════════════════
   CTG SHELL — sidebar navigation for app.html (Finance Portal)
   Load AFTER the page body, e.g. just before </body>:
       <link rel="stylesheet" href="ctg-shell.css">
       <script src="ctg-shell.js"></script>

   What it does
   ------------
   Moves the two nav rows (.tab-cats + #sub-tabs) into a left sidebar built
   from the SAME .tab elements. It never replaces tab() / tabCat() — sidebar
   links call tab(id), and a MutationObserver mirrors .tab.active/.tab.hide
   onto the sidebar, so permission gating and #tab= deep links keep working.

   No-ops on hros.html (which already has .side), or if run twice.
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // This file is a shared root .js, so tests/render_harness.ts CONCATENATES and evaluates it with no
  // browser attached — CLAUDE.md's rule for these files is that nothing may run at load time which
  // reads per-app state. Deno also dispatches a real `load` event, so the listener at the bottom fired
  // OUTSIDE any browser, after the harness had torn its stub document down, and threw
  // "Cannot read properties of undefined (reading 'getElementById')". That crashed
  // tools/render_probe.ts AFTER it had already printed "wrote 42/42 goldens" — a non-zero exit under a
  // success message, which is the shape of failure nobody reads.
  function hasDom() {
    return typeof document !== 'undefined' && !!document &&
           typeof document.getElementById === 'function' &&
           typeof document.createElement === 'function';
  }

  function splitIcon(text) {
    var t = (text || '').trim();
    var sp = t.indexOf(' ');
    // Labels are "<emoji> Name"; if there is no leading glyph, fall back to no icon.
    if (sp > 0 && sp <= 3) return { ic: t.slice(0, sp), lbl: t.slice(sp + 1) };
    return { ic: '', lbl: t };
  }

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function build() {
    if (!hasDom()) return;
    var app = document.getElementById('app');
    if (!app || document.querySelector('.ctg-side')) return;

    var wrap = app.querySelector('.wrap');
    var cats = document.querySelector('.tab-cats');
    var tabs = document.getElementById('sub-tabs');
    if (!wrap || !cats || !tabs) return; // hros.html and the login view fall through here.

    /* ── frame ─────────────────────────────────────────────────────────── */
    var frame = el('div', 'ctg-app');
    var side = el('aside', 'ctg-side');
    side.setAttribute('aria-label', 'Primary navigation');
    app.insertBefore(frame, wrap);
    frame.appendChild(side);
    frame.appendChild(wrap);
    document.body.classList.add('ctg-shell');

    /* ── brand ─────────────────────────────────────────────────────────── */
    var brand = el('div', 'ctg-side-brand');
    var srcLogo = wrap.querySelector('.brand-logo');
    if (srcLogo) {
      var img = document.createElement('img');
      img.src = srcLogo.src;
      img.alt = 'CTG';
      brand.appendChild(img);
    }
    var bt = el('div');
    bt.appendChild(el('div', 'ctg-side-brand-name', 'CTG Finance'));
    bt.appendChild(el('div', 'ctg-side-brand-sub', 'Live from Xero'));
    brand.appendChild(bt);
    var rail = el('button', 'ctg-side-rail', '⟨');
    rail.type = 'button';
    // The label has to track the STATE, not the initial one: this same control expands once the rail
    // is collapsed, and it used to go on announcing itself as "Collapse navigation" either way.
    var railLabel = function (on) {
      var t = on ? 'Expand navigation' : 'Collapse navigation';
      rail.title = t;
      rail.setAttribute('aria-label', t);
      rail.setAttribute('aria-expanded', on ? 'false' : 'true');
    };
    railLabel(false);
    rail.onclick = function () {
      var on = side.classList.toggle('collapsed');
      rail.textContent = on ? '⟩' : '⟨';
      railLabel(on);
      try { localStorage.setItem('ctg_rail', on ? '1' : '0'); } catch (e) {}
    };
    brand.appendChild(rail);
    side.appendChild(brand);

    /* ── company tile, visible ONLY while collapsed ──────────────────────
       Collapsing used to hide `.ctg-side-company` outright, and that wrapper holds the REAL company
       <select> — so the rail removed both the answer to "which company am I in" and the only way to
       change it. With seven companies and actions that post into a live Xero ledger, that is the
       expensive thing to lose. This is the org tile the Xero benchmark in the design notes describes:
       two or three letters, the full name on hover, and clicking it opens the rail back up. */
    var coTile = el('button', 'ctg-side-cotile');
    coTile.type = 'button';
    coTile.onclick = function () { if (side.classList.contains('collapsed')) rail.onclick(); };
    side.appendChild(coTile);
    try { if (localStorage.getItem('ctg_rail') === '1') rail.onclick(); } catch (e) {}

    /* ── company switcher (moved, not cloned — keeps its inline onchange) ── */
    var sel = document.getElementById('company');
    if (sel) {
      var co = el('div', 'ctg-side-company');
      co.appendChild(el('label', null, 'Company'));
      co.appendChild(sel);
      sel.style.maxWidth = 'none';
      sel.style.flex = 'none';
      var scope = document.getElementById('co_scope');
      if (scope) co.appendChild(scope);
      side.appendChild(co);
      var label = document.querySelector('#cobar .co-label');
      if (label) label.remove();
    }

    /* ── keep the collapsed company tile in step with the real <select> ──
       The option list is filled asynchronously once the companies load, so a one-shot read would
       leave the tile blank on every cold start; watch the select's children as well as its value. */
    if (sel) {
      var paintTile = function () {
        var opt = sel.options[sel.selectedIndex];
        var full = (opt && opt.textContent || '').trim();
        coTile.textContent = ctgCoInitials(full);
        // The all-companies option is itself written with decorative dashes, so appending another
        // separator reads as "- All Companies - - click to ...". Trim them off the name first.
        var clean = full.replace(/^[\s—–-]+|[\s—–-]+$/g, '');
        coTile.title = clean ? clean + ' · click to open the navigation' : 'Pick a company';
        coTile.setAttribute('aria-label', coTile.title);
      };
      paintTile();
      sel.addEventListener('change', paintTile);
      try { new MutationObserver(paintTile).observe(sel, { childList: true }); } catch (e) {}
    }

    /* ── nav, grouped by the existing categories ───────────────────────── */
    var nav = el('nav', 'ctg-side-nav');
    var links = {};
    Array.prototype.forEach.call(cats.querySelectorAll('.tab-cat'), function (cat) {
      var key = cat.dataset.cat;
      if (!key) return; // #cat-hros is a cross-app link, handled in the footer.
      var items = tabs.querySelectorAll('.tab[data-cat="' + key + '"]');
      if (!items.length) return;
      nav.appendChild(el('div', 'ctg-side-group', splitIcon(cat.textContent).lbl));
      Array.prototype.forEach.call(items, function (tabEl) {
        var id = tabEl.dataset.t;
        var parts = splitIcon(tabEl.textContent);
        var b = el('button', 'ctg-side-link');
        b.type = 'button';
        b.dataset.t = id;
        b.innerHTML = '<span class="ic" aria-hidden="true"></span><span class="lbl"></span>';
        b.querySelector('.ic').textContent = parts.ic;
        b.querySelector('.lbl').textContent = parts.lbl;
        // Collapsed, `.lbl` is display:none and `.ic` is aria-hidden, which left the button with NO
        // accessible name and no tooltip — eighteen icons a mouse could not identify and a screen
        // reader read as "button". Set both here so they hold in either state.
        b.title = parts.lbl;
        b.setAttribute('aria-label', parts.lbl);
        b.onclick = function () { if (typeof window.tab === 'function') window.tab(id); };
        nav.appendChild(b);
        links[id] = b;
      });
    });
    side.appendChild(nav);

    /* ── footer: identity + the account actions from the header ────────── */
    var foot = el('div', 'ctg-side-foot');
    var who = el('div', 'ctg-side-who');
    who.innerHTML = '<span class="chip">CTG</span>';
    var whoTxt = el('div');
    var whoName = document.getElementById('who-name');
    var whoRole = document.getElementById('who-role');
    if (whoName) whoTxt.appendChild(whoName);
    if (whoRole) whoTxt.appendChild(whoRole);
    who.appendChild(whoTxt);
    foot.appendChild(who);

    var hros = document.getElementById('cat-hros');
    if (hros) {
      hros.classList.add('btn');
      hros.style.marginLeft = '0';
      foot.appendChild(hros);
    }
    Array.prototype.forEach.call(document.querySelectorAll('.top .btn'), function (b) {
      var t = (b.textContent || '').trim();
      if (/Security|Change Password|Sign Out/i.test(t)) foot.appendChild(b);
    });
    side.appendChild(foot);

    /* ── header keeps a page title where the brand used to sit ─────────── */
    var top = wrap.querySelector('.top');
    if (top) {
      var title = el('div', 'ctg-page-title');
      title.innerHTML = '<span class="t"></span><small></small>';
      top.insertBefore(title, top.firstChild);
      var sync = function () {
        var active = tabs.querySelector('.tab.active');
        var parts = splitIcon(active ? active.textContent : 'CTG Finance Portal');
        title.querySelector('.t').textContent = parts.lbl;
        title.querySelector('small').textContent = 'Live from Xero · shown by your permissions';
      };
      sync();
      links.__sync = sync;
    }

    /* ── mirror state: .tab.active → .on, .tab.hide → hidden ───────────── */
    function mirror() {
      Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (tabEl) {
        var b = links[tabEl.dataset.t];
        if (!b) return;
        b.classList.toggle('on', tabEl.classList.contains('active'));
        b.hidden = tabEl.classList.contains('hide');
      });
      // Group headings disappear when every item under them is gated away.
      var head = null, any = false;
      Array.prototype.forEach.call(nav.children, function (n) {
        if (n.classList.contains('ctg-side-group')) {
          if (head) head.hidden = !any;
          head = n; any = false;
        } else if (!n.hidden) { any = true; }
      });
      if (head) head.hidden = !any;
      if (links.__sync) links.__sync();
    }
    mirror();
    new MutationObserver(mirror).observe(tabs, {
      subtree: true, attributes: true, attributeFilter: ['class']
    });
  }

  if (hasDom()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
    // showApp() reveals #app after login; re-run in case the nav was gated then. Registered only when
    // a real document exists, so a non-browser host never schedules it at all.
    if (typeof window !== 'undefined' && window && typeof window.addEventListener === 'function') {
      window.addEventListener('load', build);
    }
  }
})();

/* The 2-3 letter org tile shown while the rail is collapsed.
   Drops the "SDN BHD"/"BHD" suffix and a leading group prefix ("CTG4U"), then takes the first three
   letters of what actually distinguishes the company — DRSMILE -> DRS, ZEERO -> ZEE, WELLNESS -> WEL.
   The all-companies option becomes ALL rather than an empty tile. Exported for tests. */
function ctgCoInitials(name) {
  var s = String(name == null ? '' : name).replace(/[\u2014\u2013-]/g, ' ').trim();
  if (!s) return '';
  if (/^all\b|\ball companies\b/i.test(s)) return 'ALL';
  s = s.replace(/\b(sdn|bhd|berhad)\b/gi, ' ').trim();
  var words = s.split(/\s+/).filter(Boolean);
  if (words.length > 1 && /^ctg4u$/i.test(words[0])) words = words.slice(1);
  var w = words[0] || '';
  return w.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
}
if (typeof module !== 'undefined' && module.exports) { module.exports.ctgCoInitials = ctgCoInitials; }

// Ergonomics probe — run inside a rendered screen. Measures what a user FEELS, not what the markup says.
window.__ergo = function () {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const main = document.querySelector('#hr, main, #app') || document.body;
  const scope = [...main.querySelectorAll('*')].filter(vis);
  const name = (el) => (el.id ? '#' + el.id : '') + (el.getAttribute('onclick') ? '[' + el.getAttribute('onclick').slice(0, 40) + ']' : '') +
    ' "' + (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || '').trim().slice(0, 24) + '"';
  const out = { smallTap: [], smallFont: [], noLabel: [], numKeyboard: [], dateAsText: [], overflowX: 0, wideTables: [] };
  for (const el of scope) {
    const tag = el.tagName;
    const clickable = tag === 'BUTTON' || (tag === 'A' && (el.getAttribute('href') || el.getAttribute('onclick'))) ||
      (tag === 'INPUT' && ['checkbox', 'radio'].includes(el.type)) || tag === 'SELECT' || el.getAttribute('onclick');
    const r = el.getBoundingClientRect();
    if (clickable && (r.height < 36 || r.width < 36)) out.smallTap.push(`${tag}${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if ((tag === 'INPUT' && !['checkbox', 'radio', 'hidden', 'file', 'button'].includes(el.type)) || tag === 'SELECT' || tag === 'TEXTAREA') {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 16) out.smallFont.push(`${tag}${name(el)} ${fs}px`);
      const lbl = (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.getAttribute('aria-label') || el.getAttribute('title');
      // A visible caption right before the field counts as a label for a sighted user.
      const prev = el.previousElementSibling; const parentText = el.parentElement && el.parentElement.firstChild && el.parentElement.firstChild.nodeType === 3 && el.parentElement.firstChild.textContent.trim();
      const cap = lbl || (prev && /LABEL|DIV|SPAN|B|SMALL/.test(prev.tagName) && prev.innerText.trim()) || parentText;
      if (!cap) out.noLabel.push(`${tag}${name(el)}`);
      if (tag === 'INPUT' && el.type === 'number' && !el.getAttribute('inputmode')) out.numKeyboard.push(`${name(el)}`);
      if (tag === 'INPUT' && el.type === 'text' && /date|dob|day/i.test((el.id || '') + (el.placeholder || '')) ) out.dateAsText.push(name(el));
    }
    if (tag === 'TABLE' && r.width > innerWidth + 2) {
      const sc = el.parentElement && getComputedStyle(el.parentElement).overflowX;
      if (!/auto|scroll/.test(sc)) out.wideTables.push(`${Math.round(r.width)}px, parent overflow-x=${sc}`);
    }
  }
  out.overflowX = document.documentElement.scrollWidth - innerWidth;
  for (const k of Object.keys(out)) if (Array.isArray(out[k])) out[k] = { n: out[k].length, eg: out[k].slice(0, 6) };
  return out;
};
window.__ergo();

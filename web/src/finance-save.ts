// Ctrl/Cmd+S — app.html:1299-1311.
//
// The legacy handler reads the active tab's `data-t` and dispatches BY NAME: Company Info in edit mode
// calls `infoSave()`, Quick Invoice calls `qiPreview()` (its comment says "safer than Create"), and
// every other tab falls through to the browser's own Save Page dialog. React registers no keydown
// beyond two Escape handlers, so today the shortcut always reaches that dialog.
//
// The chrome cannot reach a screen's model, so this is `registerScreenExport()`'s arrangement
// (src/finance-export.ts) for the other chrome-level control: the screen registers what Ctrl/Cmd+S
// means on it, the Finance layout's one listener calls whatever is registered. Keeping the CONDITION in
// the screen is the point — "Company Info, but only in edit mode" is state the layout cannot see, and
// a screen that registers nothing keeps the browser's own dialog, exactly as the legacy does.

let screenSaver: (() => void) | null = null;

/** Called from a screen's route on mount; the returned function unregisters it. */
export function registerScreenSave(fn: () => void): () => void {
  screenSaver = fn;
  return () => { if (screenSaver === fn) screenSaver = null; };
}

export function screenSave(): (() => void) | null {
  return screenSaver;
}

/** app.html:1301 — `(e.ctrlKey||e.metaKey) && e.key==='s'`, and nothing else. */
export function isSaveKey(e: { ctrlKey?: boolean; metaKey?: boolean; key?: string }): boolean {
  return !!(e.ctrlKey || e.metaKey) && e.key === 's';
}

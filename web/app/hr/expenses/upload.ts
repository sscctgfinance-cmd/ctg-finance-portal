'use client';

// `hrRCUpload()` — hros.html:2188, ported whole. A receipt goes STRAIGHT to storage through a one-shot
// signed URL; the base64 path is only a fallback and only for files small enough to survive it.
//
// Why that matters, in the legacy's own words (hros.html:2180): a 41.8 MB PDF becomes ~56 MB of base64
// and ~110 MB of UTF-16 string in the phone's memory, and `call()`'s 30-second AbortController fires
// long before any of it finishes — so Submit did nothing at all, with no toast and no error.
//
// `src/portal.ts`'s `call()` THROWS where common.js's returns `{ok:false}`, so every step here is
// caught and turned back into the legacy's `{ok, error}` shape: the caller (`hrRCSave`) reads `ur.ok`
// and MUST NOT SUBMIT a claim whose receipt did not land. A rethrown error there would abort the loop
// and lose the per-file reporting.

import { call } from '../../../src/portal';

/** hros.html:2187. Storage's own ceiling is what really binds; this is the early, clear "no". */
export const HR_RC_MAX_BYTES = 45 * 1024 * 1024;

export interface UploadResult { ok: boolean; error?: string }

/** `rcHash()` — hros.html:1780. Only the base64 fallback uses it. */
function rcHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 101) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return 'h' + (h >>> 0).toString(16) + '_' + s.length;
}

export async function uploadReceipt(claimId: string, file: File | Blob): Promise<UploadResult> {
  const f = file as File;
  const name = (f && f.name) || 'receipt.jpg';
  const type = (f && f.type) || 'application/octet-stream';
  const size = (f && f.size) || 0;
  if (size > HR_RC_MAX_BYTES) {
    return { ok: false, error: name + ' is ' + (size / 1048576).toFixed(1) + ' MB — the limit is ' + (HR_RC_MAX_BYTES / 1048576) + ' MB. Split the PDF or scan at a lower resolution.' };
  }

  // 1) a one-shot signed URL — a small JSON call, well inside the request budget
  let sg: { url?: string; path?: string; error?: string } | null = null;
  try { sg = await call<{ url?: string; path?: string }>({ api: 'hr_rc_attach_sign', claim_id: claimId, file_name: name }); }
  catch (e) { sg = { error: e instanceof Error ? e.message : String(e) }; }

  if (sg && sg.url) {
    try {
      // 2) PUT the bytes directly. No AbortController on purpose — a 40 MB upload over mobile data
      // legitimately takes minutes, and cutting it off at 30s is exactly the bug this path fixed.
      const put = await fetch(sg.url, { method: 'PUT', headers: { 'Content-Type': type, 'x-upsert': 'true' }, body: file });
      if (!put.ok) {
        let txt = '';
        try { txt = (await put.text()).slice(0, 200); } catch { /* the status alone is still worth reporting */ }
        return { ok: false, error: 'upload failed (' + put.status + (txt ? ' ' + txt : '') + ')' };
      }
      // 3) record the row, now that the bytes are definitely there
      await call({ api: 'hr_rc_attach', claim_id: claimId, file_name: name, file_type: type, file_size: size, file_path: sg.path, receipt_hash: 'sz_' + size });
      return { ok: true };
    } catch (e) { return { ok: false, error: (e instanceof Error && e.message) || 'network error during upload' }; }
  }

  // Fallback: the old base64 path, but only for files small enough to survive it.
  if (size > 4 * 1024 * 1024) return { ok: false, error: (sg && sg.error) || 'could not start the upload — please try again' };
  const b64 = await new Promise<string | null>((res) => {
    const rd = new FileReader();
    rd.onload = () => res(String(rd.result || ''));
    rd.onerror = () => res(null);
    rd.readAsDataURL(file);
  });
  if (b64 == null) return { ok: false, error: 'could not read the file' };
  try {
    await call({ api: 'hr_rc_attach', claim_id: claimId, file_name: name, file_type: type, file_size: size, file_b64: b64, receipt_hash: rcHash(b64) });
    return { ok: true };
  } catch (e) { return { ok: false, error: (e instanceof Error && e.message) || 'network error' }; }
}

/** hros.html:2113 — the per-file progress line. Names the file and its size: a bare "Uploading…" on a
 *  40 MB scan over mobile data is indistinguishable from the button having done nothing. */
export function uploadProgress(i: number, total: number, file: { name?: string; size?: number }): string {
  const mb = (file.size || 0) / 1048576;
  return 'Uploading ' + (i + 1) + '/' + total + ': ' + (file.name || 'receipt')
    + (mb >= 1 ? ' (' + mb.toFixed(1) + ' MB — this can take a while)' : '') + '…';
}

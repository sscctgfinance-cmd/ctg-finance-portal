'use client';

// The route. Everything impure lives here — the session, the five loads, the six POSTs, the DOM reads,
// the two confirms, the prompt, the clipboard and the preview overlay — so that src/finance-ap.tsx stays
// a pure function of its props and can be diffed against the legacy golden. Same split as
// app/finance/ocr/page.tsx; the Finance route convention is documented in app/finance/wht/page.tsx.
//
// `ap` IS on `render(t)`'s `asyncTabs` list (app.html:1504): `renderAp()` fetches `ap_settings_get` and
// `ap_inbox_list` (and `ap_rules_list` when the rules panel is open) before it can paint. So this route
// has a load step in front of the screen, and re-runs it on every filter change exactly as
// `AP_FILTER_TENANT=this.value;renderAp()` does.
//
// THE GATE IS CLOSED FOR EVERYONE — app.html:1428, the same Claude-vision credit exhaustion that hides
// Smart OCR. `apReachable()` returns false for every login. The screen is migrated in full anyway: the
// credits come back, the tab comes back, and a half-ported screen would come back with it.
//
// THE FORMS ARE READ OUT OF THE DOM, exactly as `apCollectBill()` (app.html:7049), `apSaveSettings()`
// (:7024), `apSendReply()` (:7043) and `apAddRule()` (:7167) do, by the same ids and the same
// `[data-bk]` / `[data-li-i]` / `[data-li-k]` / `[data-ten]` / `[data-k]` attributes. Those names ARE the
// contract — the screen's test pins them against app.html at run time.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceAp, {
  ApPreviewModal, apDeriveKeyword, apReachable, collectLines, parseKeywords, postBody, postConfirmText,
  previewBody, rejectBody, replyBody, replyConfirmText, ruleSaveBody, settingsBody,
  type ApDecision, type ApDetail, type ApItem, type ApLine, type ApPreview, type ApRule, type ApSetting,
  type Company, type Perms,
} from '../../../src/finance-ap';
import { call, legacyUrl, token } from '../../../src/portal';

export default function FinanceApPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // `AP_SETTINGS` / `AP_INBOX` / `AP_RULES` / `AP_DETAIL` / `AP_DECISIONS` — app.html:6730.
  const [settings, setSettings] = useState<ApSetting[]>([]);
  const [inbox, setInbox] = useState<ApItem[]>([]);
  const [rules, setRules] = useState<ApRule[]>([]);
  const [detail, setDetail] = useState<ApDetail | null>(null);
  const [decisions, setDecisions] = useState<ApDecision[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [filterTenant, setFilterTenant] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [rulesTenant, setRulesTenant] = useState('');
  const [showRules, setShowRules] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ApPreview | null>(null);

  const root = useRef<HTMLDivElement>(null);
  /** `apOpen()`'s stale-response guard — app.html:7018: a slower A must not paint under B's id. */
  const wanted = useRef<number | null>(null);

  useEffect(() => {
    const t = !!token();
    setSignedIn(t);
    if (!t) { setLoading(false); return; }
    void call<Perms>({ api: 'my_perms' }).then(setPerms).catch((e) => setErr(msg(e)));
    void call<{ companies?: Company[] }>({ api: 'me' }).then((r) => setCompanies(r.companies || [])).catch((e) => setErr(msg(e)));
  }, []);

  /** `renderAp()` — app.html:6753. The same three calls, the same optional third. */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sR, iR] = await Promise.all([
        call<{ settings?: ApSetting[] }>({ api: 'ap_settings_get' }),
        call<{ ok?: boolean; items?: ApItem[] }>({ api: 'ap_inbox_list', tenant: filterTenant || undefined, status: filterStatus || undefined, limit: 100 }),
      ]);
      setSettings(sR.settings || []);
      setInbox(iR.items || []);
      if (showRules) {
        const rR = await call<{ rules?: ApRule[] }>({ api: 'ap_rules_list', tenant: rulesTenant || undefined });
        setRules(rR.rules || []);
      }
      setErr(null);
    } catch (e) {
      setErr(msg(e));
    } finally {
      setLoading(false);
    }
  }, [filterTenant, filterStatus, showRules, rulesTenant]);

  useEffect(() => {
    if (!signedIn || !apReachable(perms)) return;
    void load();
  }, [signedIn, perms, load]);

  /** `apOpen(id)` — app.html:7015, including the stale-response guard its comment explains. */
  const onOpen = useCallback((id: number) => {
    wanted.current = id;
    setActiveId(id);
    setDecisions([]);
    setDetail(null);
    void (async () => {
      try {
        const [r, dR] = await Promise.all([
          call<{ item?: ApDetail }>({ api: 'ap_inbox_get', id }),
          call<{ decisions?: ApDecision[] }>({ api: 'ap_decision_log', id }),
        ]);
        if (wanted.current !== id) return;   // the operator already clicked another email
        setDetail(r.item || null);
        setDecisions(dR.decisions || []);
      } catch (e) {
        setErr(msg(e));
      }
    })();
  }, []);

  /** `apCollectBill()` — app.html:7049. Reads the live DOM, exactly as the legacy does. */
  const collectBill = useCallback((): Record<string, unknown> => {
    const scope = root.current;
    const bill: Record<string, unknown> = {};
    if (!scope) return bill;
    scope.querySelectorAll<HTMLInputElement>('[data-bk]').forEach((el) => {
      bill[el.dataset.bk as string] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
    });
    const rows: Record<string, ApLine> = {};
    scope.querySelectorAll<HTMLInputElement>('#ap_lines [data-li-i]').forEach((el) => {
      const i = el.dataset.liI as string;
      (rows[i] ||= {} as ApLine)[el.dataset.liK as keyof ApLine] = el.value as never;
    });
    bill.line_items = collectLines(Object.keys(rows).map((k) => rows[k]));
    return bill;
  }, []);

  /** `apPostBill()` — app.html:7129, including the teach loop and its `apDeriveKeyword()` skip. */
  const doPost = useCallback(() => {
    const bill = collectBill();
    const teach = !!(root.current?.querySelector<HTMLInputElement>('#ap_teach')?.checked);
    if (!confirm(postConfirmText(bill))) return;
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await call(postBody(activeId, bill));
        if (teach && detail && detail.tenant_id) {
          for (const l of bill.line_items as { description: string; account_code: string }[]) {
            const kw = apDeriveKeyword(l.description);
            // A blank keyword is skipped, not saved: ap.js's `''` means "nothing clean here".
            if (kw && l.account_code) {
              try { await call(ruleSaveBody(detail.tenant_id, [kw], l.account_code, 200, 'taught from bill review')); } catch { /* best-effort, as the legacy is */ }
            }
          }
        }
        await load();
        if (activeId) onOpen(activeId);
      } catch (e) {
        setErr(msg(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [activeId, busy, collectBill, detail, load, onOpen]);

  /** `apPreviewPayload()` — app.html:7059. A dry run: nothing reaches Xero. */
  const onPreview = useCallback(() => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        setPreview(await call<ApPreview>(previewBody(activeId, collectBill())));
      } catch (e) {
        setErr(msg(e));
      } finally {
        setBusy(false);
      }
    })();
  }, [activeId, busy, collectBill]);

  /** `apSendReply()` — app.html:7042. This one emails the sender, so it keeps the legacy's confirm. */
  const onSendReply = useCallback(() => {
    const scope = root.current;
    const subject = scope?.querySelector<HTMLInputElement>('#ap_reply_subject')?.value || '';
    const body = scope?.querySelector<HTMLTextAreaElement>('#ap_reply_body')?.value || '';
    let req: Record<string, unknown>;
    try { req = replyBody(activeId, subject, body); } catch (e) { setErr(msg(e)); return; }
    if (!confirm(replyConfirmText(detail && detail.from_email))) return;
    void run(async () => { await call(req); await load(); if (activeId) onOpen(activeId); });
  }, [activeId, detail, load, onOpen]);

  /** `apRerun()` — app.html:7034. */
  const onRerun = useCallback(() => {
    if (!activeId) return;
    void run(async () => { await call({ api: 'ap_process', id: activeId }); onOpen(activeId); });
  }, [activeId, onOpen]);

  /**
   * `apReject()` — app.html:7156. The legacy asks with a `prompt()` whose CANCEL means "do not reject";
   * an empty string means "reject with the default reason". Those are different answers and the
   * browser's own prompt is the only control that returns both, so it is kept rather than dropped —
   * the same call `app/finance/approvals/page.tsx` made about `confirm()`.
   */
  const onReject = useCallback(() => {
    if (!activeId) return;
    const reason = prompt('Reason for rejecting? (optional)', 'manually rejected');
    if (reason === null) return;
    void run(async () => {
      await call(rejectBody(activeId, reason));
      setActiveId(null);
      setDetail(null);
      wanted.current = null;
      await load();
    });
  }, [activeId, load]);

  /** `apSaveSettings(tid)` — app.html:7023. Checkboxes go as 'true'/'false' strings, as the legacy sends. */
  const onSaveSettings = useCallback((tid: string) => {
    const scope = root.current;
    if (!scope) return;
    const patch: Record<string, string> = {};
    scope.querySelectorAll<HTMLInputElement>(`[data-ten="${CSS.escape(tid)}"]`).forEach((el) => {
      patch[el.dataset.k as string] = el.type === 'checkbox' ? (el.checked ? 'true' : 'false') : el.value;
    });
    void run(async () => { await call(settingsBody(tid, patch)); await load(); });
  }, [load]);

  /** `apAddRule()` — app.html:7167. */
  const onAddRule = useCallback(() => {
    const scope = root.current;
    const tid = scope?.querySelector<HTMLSelectElement>('#ap_rule_tenant')?.value || '';
    const kws = parseKeywords(scope?.querySelector<HTMLInputElement>('#ap_rule_keywords')?.value || '');
    const code = (scope?.querySelector<HTMLInputElement>('#ap_rule_code')?.value || '').trim();
    const prio = Number(scope?.querySelector<HTMLInputElement>('#ap_rule_prio')?.value) || 200;
    let req: Record<string, unknown>;
    try { req = ruleSaveBody(tid, kws, code, prio); } catch (e) { setErr(msg(e)); return; }
    void run(async () => { await call(req); await load(); });
  }, [load]);

  /** `apDeleteRule(id)` — app.html:7178. */
  const onDeleteRule = useCallback((id: number) => {
    if (!confirm('Delete this coding rule?')) return;
    void run(async () => { await call({ api: 'ap_rule_delete', id }); await load(); });
  }, [load]);

  /** One in-flight write at a time — the React equivalent of `runOnce()` (app.html:1290). */
  const run = useCallback(async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  }, [busy]);

  return (
    <div ref={root}>
      <Banner />
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        // THE PERMISSION GATE — app.html:1428. The AP Inbox is hidden from EVERYONE, not admin-gated and
        // not feature-gated: the Anthropic vision credits ran out on 2026-07-09. Re-enabling is one edit
        // in app.html (`true` → `!canManage`) and one in src/finance-ap.tsx, and it is a decision, not a
        // migration detail.
        : !apReachable(perms)
          ? <Panel>
              The AP Inbox is switched off. The Claude vision credits its Auto-Bookkeeping agent runs on
              were exhausted on 2026&#8209;07&#8209;09; the screen is intact and comes back with a top-up.
              Ask an administrator.
            </Panel>
        : err ? <Panel>⚠️ {err}</Panel>
        : loading ? <Panel><span className="spin"></span> Loading…</Panel>
        : <>
            <FinanceAp
              companies={companies}
              inbox={inbox}
              settings={settings}
              rules={rules}
              detail={detail}
              decisions={decisions}
              activeId={activeId}
              filterTenant={filterTenant}
              filterStatus={filterStatus}
              rulesTenant={rulesTenant}
              showRules={showRules}
              showSettings={showSettings}
              onFilterTenant={setFilterTenant}
              onFilterStatus={setFilterStatus}
              onOpen={onOpen}
              onRefresh={() => void load()}
              onToggleRules={() => setShowRules((v) => !v)}
              onToggleSettings={() => setShowSettings((v) => !v)}
              onRulesTenant={setRulesTenant}
              onDeleteRule={onDeleteRule}
              onAddRule={onAddRule}
              onSaveSettings={onSaveSettings}
              onCopyEmail={(e) => { void navigator.clipboard.writeText(e); }}
              onSendReply={onSendReply}
              onRerun={onRerun}
              onReject={onReject}
              onPreview={onPreview}
              onPostBill={doPost}
            />
            {preview
              ? <ApPreviewModal
                  r={preview}
                  onClose={() => setPreview(null)}
                  onPostAnyway={() => { setPreview(null); doPost(); }}
                />
              : null}
          </>}
    </div>
  );
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=ap`}>app.html · AP Inbox</a>, unchanged — and hidden
        there too. This page renders the same queue from the same session and is diffed against the same golden.
      </div>
    </div>
  );
}

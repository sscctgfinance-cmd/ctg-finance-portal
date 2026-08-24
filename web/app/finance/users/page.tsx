'use client';

// The route. Everything impure lives here — the session, the loads each sub-view makes, the sub-view the
// operator is on, the two modals, the `prompt()` a password reset asks for, the `confirm()`s a revoke and
// a role delete ask for, and every POST — so that the five `src/finance-users*.tsx` files stay pure
// functions of their props. Same split as app/finance/approvals/page.tsx.
//
// `users` IS on `render(t)`'s `asyncTabs` list (app.html:1505), so the legacy paints `spin('users')`
// before it can show anything. That skeleton belongs to `tab()`, not to the screen — here each
// sub-view's OWN spinner fills the same gap.
//
// ── ALL FIVE SUB-VIEWS ARE NOW HERE ──────────────────────────────────────────────────────────────
// `usersView()` (app.html:4680) dispatches over five; the first migration shipped only `users` and sent
// the other four back to app.html mid-screen. Roles & permissions, Active sessions, Audit log and the
// webhook-activity half of Xero sync now render here, and so do the two modals (`userForm()`,
// `roleForm()`) the list opens. All six advanced Xero tools now render here too.
//
// The `confirm()`s named above go through the shell's ported dialog (src/confirm.tsx), not the browser's.
// The `prompt()` does NOT: a text prompt is not one of the two controls that shell ported, and the
// legacy uses the native one here too.

import { useCallback, useEffect, useRef, useState } from 'react';

import FinanceUsersTable, {
  MIN_PASSWORD, UsersPanel, UsersSubnav, resetBody, usersReachable,
  type Company, type Perms, type User, type UserCompany, type UsersView,
} from '../../../src/finance-users';
import { showConfirm } from '../../../src/confirm';
import AuditTable, { AuditEmpty, AuditPanel, type AuditEvent } from '../../../src/finance-users-audit';
import { UserModal, ufTenants, userSaveBody, type CompRow, type UserFormUser } from '../../../src/finance-users-form';
import RolesTable, {
  RoleModal, RolesPanel, roleDeleteBody, roleDeleteConfirm, roleKey, roleSaveBody, type RoleRow,
} from '../../../src/finance-users-roles';
import SessionsTable, {
  SessionsPanel, revokeBody, revokeConfirm, whoSafe, type Session,
} from '../../../src/finance-users-sessions';
import XeroOut, {
  XeroPanel, webhookKeyBody, xeroActionBody, type WebhookResponse, type XeroAction,
} from '../../../src/finance-users-xero';
import {
  ArAgingPanel, CompanyNamesPanel, InvoiceResyncPanel, LiveAuditPanel, RebuildPanel, SyncHealthPanel,
  arAgingBody, arBucketBody, driftCheckBody, invoiceResyncBody, syncAuditBody, syncHealthBody,
  tenantRebuildBody, tenantsRefreshBody,
  type ArAgingResponse, type ArBucketResponse, type AuditResponse, type DriftResponse,
  type InvoiceResyncResponse, type SyncHealthResponse, type TenantRebuildResponse, type TenantsRefreshResponse,
} from '../../../src/finance-users-xero-tools';
import { toast } from '../../../src/toast';
import { API, call, legacyUrl, token } from '../../../src/portal';

interface UsersResponse { ok?: boolean; error?: string; users?: User[]; user_companies?: UserCompany[] }

export default function FinanceUsersPage() {
  const [perms, setPerms] = useState<Perms | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  // `USERS_VIEW` — app.html:4972, and `renderUsers()` opens on it.
  const [view, setView] = useState<UsersView>('users');

  // ── users ───────────────────────────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<User[] | null>(null);
  const [userCompanies, setUserCompanies] = useState<UserCompany[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [usersErr, setUsersErr] = useState<string | null>(null);

  // ── roles / sessions / audit / xero ─────────────────────────────────────────────────────────────
  const [roleRows, setRoleRows] = useState<RoleRow[] | null>(null);
  const [rolesErr, setRolesErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [sessErr, setSessErr] = useState<string | null>(null);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const [xero, setXero] = useState<WebhookResponse | null>(null);
  const [xeroErr, setXeroErr] = useState<string | null>(null);
  const [xeroBusy, setXeroBusy] = useState<XeroAction | null>(null);
  const [keyPanelOpen, setKeyPanelOpen] = useState(false);

  // ── the six advanced Xero tools ─────────────────────────────────────────────────────────────────
  const [tRefreshBusy, setTRefreshBusy] = useState(false);
  const [tRefreshResult, setTRefreshResult] = useState<TenantsRefreshResponse | null>(null);
  const [tRefreshErr, setTRefreshErr] = useState<string | null>(null);
  const [health, setHealth] = useState<SyncHealthResponse | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [driftBusy, setDriftBusy] = useState(false);
  const [driftResult, setDriftResult] = useState<DriftResponse | null>(null);
  const [driftErr, setDriftErr] = useState<string | null>(null);
  const [auditXBusy, setAuditXBusy] = useState(false);
  const [auditXResult, setAuditXResult] = useState<AuditResponse | null>(null);
  const [auditXErr, setAuditXErr] = useState<string | null>(null);
  const [rsyncBusy, setRsyncBusy] = useState(false);
  const [rsyncResult, setRsyncResult] = useState<InvoiceResyncResponse | null>(null);
  const [rsyncErr, setRsyncErr] = useState<string | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildResult, setRebuildResult] = useState<TenantRebuildResponse | null>(null);
  const [rebuildErr, setRebuildErr] = useState<string | null>(null);
  const [rebuildConfirm, setRebuildConfirm] = useState('');
  const [rebuildTenant, setRebuildTenant] = useState('');
  const [arData, setArData] = useState<ArAgingResponse | null>(null);
  const [arErr, setArErr] = useState<string | null>(null);
  const [arDrillBusy, setArDrillBusy] = useState(false);
  const [arDrillLabel, setArDrillLabel] = useState<string | null>(null);
  const [arDrillData, setArDrillData] = useState<ArBucketResponse | null>(null);
  const [arDrillErr, setArDrillErr] = useState<string | null>(null);
  const rebuildingRef = useRef(false);
  const rsyncingRef = useRef(false);

  // ── the two modals ──────────────────────────────────────────────────────────────────────────────
  const [userModal, setUserModal] = useState<UserFormUser | null | undefined>(undefined);
  const [ufErr, setUfErr] = useState<string | null>(null);
  const [ufSaving, setUfSaving] = useState(false);
  const [roleModal, setRoleModal] = useState<RoleRow | null | undefined>(undefined);
  const [rfErr, setRfErr] = useState<string | null>(null);
  const [rfSaving, setRfSaving] = useState(false);
  // `#uf_*` / `#rf_*` are read back out of the DOM, exactly as `userSave()` / `roleSave()` do. The shell
  // owns `#app` and `<main>`, so a page that needs its own DOM back keeps a plain ref (CLAUDE.md).
  const modalHost = useRef<HTMLDivElement>(null);

  const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));

  /** `usersLoad()` — app.html:4725. Three calls, in the legacy's order: roles, companies, then users. */
  const loadUsers = useCallback(() => {
    setUsersErr(null);
    void (async () => {
      try {
        const rs = await call<{ roles?: RoleRow[] }>({ api: 'roles_list' });
        setRoles((rs && rs.roles) || []);
        const co = await call<{ companies?: Company[] }>({ api: 'companies_list' });
        const coList = (co && co.companies) || [];
        setCompanies(coList);
        if (coList.length) setRebuildTenant((prev) => prev || coList[0].tenant_id);
        const r = await call<UsersResponse>({ api: 'users_list' });
        if (!r || r.ok === false) { setUsersErr((r && r.error) || 'failed'); return; }
        setUsers(r.users || []);
        setUserCompanies(r.user_companies || []);
      } catch (e) { setUsersErr(fail(e)); }
    })();
  }, []);

  /** `rolesLoad()` — app.html:4855. */
  const loadRoles = useCallback(() => {
    setRolesErr(null); setRoleRows(null);
    void call<{ ok?: boolean; error?: string; roles?: RoleRow[] }>({ api: 'roles_list' })
      .then((r) => {
        if (!r || r.ok === false) { setRolesErr((r && r.error) || 'failed'); return; }
        setRoleRows(r.roles || []);
        setRoles(r.roles || []);
      })
      .catch((e) => setRolesErr(fail(e)));
  }, []);

  /** `sessionsLoad()` — app.html:4689. */
  const loadSessions = useCallback(() => {
    setSessErr(null); setSessions(null);
    void call<{ ok?: boolean; error?: string; sessions?: Session[] }>({ api: 'sessions_list' })
      .then((r) => {
        if (!r || r.ok === false) { setSessErr((r && r.error) || 'failed'); return; }
        setSessions(r.sessions || []);
      })
      .catch((e) => setSessErr(fail(e)));
  }, []);

  /** `auditLoad()` — app.html:4910. The limit is the legacy's own. */
  const loadAudit = useCallback(() => {
    setAuditErr(null); setEvents(null);
    void call<{ ok?: boolean; error?: string; events?: AuditEvent[] }>({ api: 'audit_list', limit: 150 })
      .then((r) => {
        if (!r || r.ok === false) { setAuditErr((r && r.error) || 'failed'); return; }
        setEvents(r.events || []);
      })
      .catch((e) => setAuditErr(fail(e)));
  }, []);

  /** `xeroSyncLoad()`'s own fetch — app.html:4966. */
  const loadXero = useCallback(() => {
    setXeroErr(null); setXero(null);
    void call<WebhookResponse & { ok?: boolean; error?: string }>({ api: 'webhook_events', limit: 80 })
      .then((r) => {
        if (!r || r.ok === false) { setXeroErr((r && r.error) || 'failed'); return; }
        setXero(r);
      })
      .catch((e) => setXeroErr(fail(e)));
  }, []);

  const loadSyncHealth = useCallback(() => {
    setHealthErr(null);
    void call<SyncHealthResponse>(syncHealthBody())
      .then((r) => { if (!r || r.ok === false) { setHealthErr((r && r.error) || 'failed'); return; } setHealth(r); })
      .catch((e) => setHealthErr(fail(e)));
  }, []);

  const loadArAging = useCallback(() => {
    setArErr(null); setArData(null);
    void call<ArAgingResponse>(arAgingBody())
      .then((r) => { if (!r || r.ok === false) { setArErr((r && r.error) || 'failed'); return; } setArData(r); })
      .catch((e) => setArErr(fail(e)));
  }, []);

  const loadFor = useCallback((v: UsersView) => {
    if (v === 'users') loadUsers();
    else if (v === 'roles') loadRoles();
    else if (v === 'sessions') loadSessions();
    else if (v === 'xero') { loadXero(); loadSyncHealth(); loadArAging(); }
    else loadAudit();
  }, [loadAudit, loadArAging, loadRoles, loadSessions, loadSyncHealth, loadUsers, loadXero]);

  useEffect(() => {
    // localStorage is not readable during prerender, so the session check runs on mount, not on render.
    const t = !!token();
    setSignedIn(t);
    if (!t) return;
    // THE PERMISSION GATE. app.html:1422 LOOKS like `!canManage` and is overwritten by the chain's final
    // `else` two lines later — see usersReachable(). The server checks the role on every handler behind
    // this screen, so this is tab visibility rather than the boundary.
    void call<Perms>({ api: 'my_perms' })
      .then((p) => { setPerms(p); if (usersReachable(p)) loadFor('users'); })
      .catch((e) => setErr(fail(e)));
  }, [loadFor]);

  /** `usersView(v)` — app.html:4680. Sets the view, marks the button, and loads. */
  const onView = useCallback((v: UsersView) => { setView(v); loadFor(v); }, [loadFor]);

  // ── users sub-view actions ──────────────────────────────────────────────────────────────────────

  /** `userForm(null)` / `userEdit(i)` — app.html:4780, :4763. */
  const openUserForm = useCallback((i?: number) => {
    setUfErr(null); setUfSaving(false);
    if (i === undefined) { setUserModal(null); return; }
    const u = (users || [])[i];
    if (!u) return;
    const rows = userCompanies.filter((x) => x.user_id === u.id);
    setUserModal({
      id: u.id, name: u.name, email: u.email, role: u.role, active: u.active,
      tenants: rows.map((x) => ({ tenant_id: x.tenant_id, role: x.role || '' })),
    });
  }, [userCompanies, users]);

  /** `ufToggleRow(this)` — app.html:4807. The two DOM writes, kept where the DOM is. */
  const onCompToggle = useCallback((e: { currentTarget?: HTMLInputElement }) => {
    const cb = e && e.currentTarget;
    if (!cb || !cb.closest) return;   // the shared handler walker invokes with a bare stub event
    const row = cb.closest('.uf-comp-row');
    const sel = row && row.querySelector<HTMLSelectElement>('.uf-comp-role');
    if (!sel) return;
    sel.disabled = !cb.checked;
    if (!cb.checked) sel.value = '';
  }, []);

  /** `userSave()` — app.html:4815. The DOM read stays here; the body is `userSaveBody()`. */
  const onUserSave = useCallback(() => {
    const host = modalHost.current;
    if (!host) return;
    const val = (id: string) => (host.querySelector<HTMLInputElement | HTMLSelectElement>('#' + id)?.value ?? '');
    const rows: CompRow[] = [...host.querySelectorAll<HTMLInputElement>('.uf-comp')].map((cb) => ({
      tenant_id: cb.getAttribute('data-tid') || '',
      checked: cb.checked,
      role: host.querySelector<HTMLSelectElement>('.uf-comp-role[data-tid="' + cb.getAttribute('data-tid') + '"]')?.value || '',
    }));
    const activeEl = host.querySelector<HTMLInputElement>('#uf_active');
    let body: Record<string, unknown>;
    try {
      body = userSaveBody({
        editId: userModal ? (userModal.id || null) : null,
        name: val('uf_name').trim(),
        role: val('uf_role'),
        tenants: ufTenants(rows),
        active: activeEl ? activeEl.checked : undefined,
        email: val('uf_email'),
        pass: val('uf_pass'),
      });
    } catch (e) { setUfErr(fail(e)); return; }
    setUfErr(null); setUfSaving(true);
    void call<{ ok?: boolean; error?: string }>(body)
      .then((r) => {
        if (r && r.ok === false) { setUfErr(r.error || 'Save failed'); return; }
        setUserModal(undefined); setErr('User saved'); loadUsers();
      })
      .catch((e) => setUfErr(fail(e)))
      .finally(() => setUfSaving(false));
  }, [loadUsers, userModal]);

  /** `userReset(i)` — app.html:4770, wording and rules included. */
  const onReset = useCallback((i: number) => {
    const u = (users || [])[i];
    if (!u) return;
    const pw = window.prompt('Set a new password for ' + (u.name || u.email) +
      ' (min ' + MIN_PASSWORD + ' chars). The user can change it after signing in.');
    if (pw == null) return;
    if (pw.length < MIN_PASSWORD) { setErr('Password must be at least ' + MIN_PASSWORD + ' characters'); return; }
    void call(resetBody(u.id, pw))
      .then(() => setErr('Password reset for ' + (u.name || u.email)))
      .catch((e) => setErr('Reset failed: ' + fail(e)));
  }, [users]);

  // ── roles sub-view actions ──────────────────────────────────────────────────────────────────────

  /** `roleForm(i)` — app.html:4872. `undefined` closes; `null` is "+ New role". */
  const openRoleForm = useCallback((i?: number) => {
    setRfErr(null); setRfSaving(false);
    if (i === undefined) { setRoleModal(null); return; }
    const ro = (roleRows || [])[i];
    if (!ro) return;
    setRoleModal(ro);
  }, [roleRows]);

  /** `roleSave()` — app.html:4887. `RF_NAME` is what stops an edit renaming the role. */
  const onRoleSave = useCallback(() => {
    const host = modalHost.current;
    if (!host) return;
    const existing = roleModal ? roleModal.name : null;
    const name = roleKey(existing, host.querySelector<HTMLInputElement>('#rf_name')?.value || '');
    const label = (host.querySelector<HTMLInputElement>('#rf_label')?.value || '').trim();
    const features = [...host.querySelectorAll<HTMLInputElement>('.rf-feat')].filter((x) => x.checked).map((x) => x.value);
    const manage_users = !!host.querySelector<HTMLInputElement>('#rf_manage')?.checked;
    let body: Record<string, unknown>;
    try { body = roleSaveBody(name, label, features, manage_users); }
    catch { setRfErr('Role key is required'); return; }
    setRfErr(null); setRfSaving(true);
    void call<{ ok?: boolean; error?: string }>(body)
      .then((r) => {
        if (r && r.ok === false) { setRfErr(r.error || 'Save failed'); return; }
        setRoleModal(undefined); setErr('Role saved'); loadRoles();
      })
      .catch((e) => setRfErr(fail(e)))
      .finally(() => setRfSaving(false));
  }, [loadRoles, roleModal]);

  /** `roleDelete(i)` — app.html:4902. The confirm is ported, not dropped. */
  const onRoleDelete = useCallback((i: number) => {
    const ro = (roleRows || [])[i];
    if (!ro) return;
    void (async () => {
      if (!await showConfirm('Delete role', roleDeleteConfirm(ro), 'Delete')) return;
      void call<{ ok?: boolean; error?: string }>(roleDeleteBody(ro.name))
        .then((r) => {
          if (r && r.ok === false) { setErr(r.error || 'Delete failed'); return; }
          setErr('Role deleted'); loadRoles();
        })
        .catch((e) => setErr(fail(e)));
    })();
  }, [loadRoles, roleRows]);

  // ── sessions sub-view actions ───────────────────────────────────────────────────────────────────

  /** `sessionRevoke()` — app.html:4717. */
  const onRevoke = useCallback((s: Session) => {
    void (async () => {
      if (!await showConfirm('Revoke session', revokeConfirm(whoSafe(s)), 'Revoke')) return;
      let body: Record<string, unknown>;
      try { body = revokeBody(s.sid || ''); } catch (e) { setErr(fail(e)); return; }
      void call<{ ok?: boolean; error?: string }>(body)
        .then((r) => {
          if (r && r.ok === false) { setErr(r.error || 'Failed'); return; }
          setErr('Session revoked'); loadSessions();
        })
        .catch((e) => setErr(fail(e)));
    })();
  }, [loadSessions]);

  // ── xero sub-view actions ───────────────────────────────────────────────────────────────────────

  /**
   * The three sync actions. The legacy disables ONLY the clicked button, so a second, different sync can
   * be started while the first is still running against a live Xero connection — `finance.approvals`'
   * case, and closed the same way: the markup mirrors the legacy, the ROUTE refuses the repeat.
   */
  const onXeroAction = useCallback((a: XeroAction) => {
    if (xeroBusy) return;
    setXeroBusy(a);
    void call<{ ok?: boolean; error?: string; upserted?: number; processed?: number; remaining?: number; tenants?: number }>(xeroActionBody(a))
      .then((r) => {
        if (r && r.ok === false) { setErr(r.error || 'Sync failed'); return; }
        if (a === 'backfill') setErr('Full sync done · ' + ((r && r.upserted) || 0) + ' invoices cached across ' + ((r && r.tenants) || 0) + ' companies');
        else if (a === 'delta') setErr('Delta sync done · ' + ((r && r.upserted) || 0) + ' invoices updated');
        else setErr('Synced ' + ((r && r.processed) || 0) + ' event(s)' + ((r && r.remaining) ? ' · ' + r.remaining + ' still queued' : ''));
      })
      .catch((e) => setErr(fail(e)))
      .finally(() => { setXeroBusy(null); loadXero(); });
  }, [loadXero, xeroBusy]);

  /** `saveWebhookKey()` — app.html:5245. `#wk_input` is read out of the DOM, as the legacy does. */
  const onSaveKey = useCallback(() => {
    const v = document.getElementById('wk_input') as HTMLInputElement | null;
    let body: Record<string, unknown>;
    try { body = webhookKeyBody(v ? v.value : ''); } catch (e) { setErr(fail(e)); return; }
    void call<{ ok?: boolean; error?: string }>(body)
      .then((r) => {
        if (r && r.ok === false) { setErr(r.error || 'Save failed'); return; }
        setErr('Webhook key saved — Xero can now push events'); loadXero();
      })
      .catch((e) => setErr(fail(e)));
  }, [loadXero]);

  const onToggleKeyPanel = useCallback((e: { preventDefault?: () => void }) => {
    if (e && e.preventDefault) e.preventDefault();
    setKeyPanelOpen((v) => !v);
  }, []);

  // ── the six advanced Xero tools (handlers) ──────────────────────────────────────────────────────

  const onTenantsRefresh = useCallback(() => {
    setTRefreshBusy(true); setTRefreshErr(null); setTRefreshResult(null);
    void call<TenantsRefreshResponse>(tenantsRefreshBody())
      .then((r) => {
        if (!r || r.ok === false) { setTRefreshErr((r && r.error) || 'Failed'); return; }
        setTRefreshResult(r);
        if (r.companies) { setCompanies(r.companies); if (r.companies.length) setRebuildTenant((prev) => prev || r.companies![0].tenant_id); }
        toast('Refreshed ' + r.total + ' companies · ' + (r.renamed || []).length + ' renamed');
      })
      .catch((e) => setTRefreshErr(fail(e)))
      .finally(() => setTRefreshBusy(false));
  }, []);

  const onDriftCheck = useCallback(() => {
    setDriftBusy(true); setDriftErr(null); setDriftResult(null);
    void call<DriftResponse>(driftCheckBody())
      .then((r) => {
        if (!r || r.ok === false) { setDriftErr((r && r.error) || 'Reconcile failed'); return; }
        setDriftResult(r);
        const res = r.results || [];
        const checked = res.filter((x) => !x.error && !x.skipped).length;
        const allOk = checked > 0 && res.every((x) => x.skipped || (!x.error && Math.abs(x.drift || 0) === 0 && (x.missing || 0) === 0 && (x.extra || 0) === 0));
        toast(allOk ? '✓ All companies match Xero · data accurate' : 'Drift auto-repaired — please reconcile again');
      })
      .catch((e) => setDriftErr(fail(e)))
      .finally(() => { setDriftBusy(false); loadSyncHealth(); });
  }, [loadSyncHealth]);

  const onSyncAudit = useCallback(() => {
    setAuditXBusy(true); setAuditXErr(null); setAuditXResult(null);
    void call<AuditResponse>(syncAuditBody())
      .then((r) => { if (!r || r.ok === false) { setAuditXErr((r && r.error) || 'Failed'); return; } setAuditXResult(r); })
      .catch((e) => setAuditXErr(fail(e)))
      .finally(() => setAuditXBusy(false));
  }, []);

  const onInvoiceResync = useCallback(() => {
    if (rsyncingRef.current) return;
    const tenant = (document.getElementById('rsync_tenant') as HTMLSelectElement | null)?.value || '';
    const key = (document.getElementById('rsync_key') as HTMLInputElement | null)?.value || '';
    let body: Record<string, unknown>;
    try { body = invoiceResyncBody(tenant, key); } catch (e) { setRsyncErr(fail(e)); return; }
    rsyncingRef.current = true;
    setRsyncBusy(true); setRsyncErr(null); setRsyncResult(null);
    void call<InvoiceResyncResponse>(body)
      .then((r) => {
        if (r && r.ok) { setRsyncResult(r); toast('✓ Invoice resynced'); loadSyncHealth(); }
        else { setRsyncErr((r && r.error) || 'Failed'); }
      })
      .catch((e) => setRsyncErr(fail(e)))
      .finally(() => { rsyncingRef.current = false; setRsyncBusy(false); });
  }, [loadSyncHealth]);

  const onTenantRebuild = useCallback(() => {
    if (rebuildingRef.current) return;
    const tenant = rebuildTenant;
    const co = companies.find((c) => c.tenant_id === tenant);
    const tenantName = co ? co.tenant_name : '';
    if (!tenant || !tenantName) { setRebuildErr('Pick a company'); return; }
    if (rebuildConfirm !== tenantName) { setRebuildErr('Name did not match — rebuild cancelled'); return; }
    let body: Record<string, unknown>;
    try { body = tenantRebuildBody(tenant); } catch (e) { setRebuildErr(fail(e)); return; }
    rebuildingRef.current = true;
    setRebuildBusy(true); setRebuildErr(null); setRebuildResult(null);
    void call<TenantRebuildResponse>(body)
      .then((r) => {
        if (r && r.ok) { setRebuildResult(r); toast('✓ Rebuild started for ' + tenantName); setRebuildConfirm(''); setTimeout(loadSyncHealth, 3000); }
        else { setRebuildErr((r && r.error) || 'Failed'); }
      })
      .catch((e) => setRebuildErr(fail(e)))
      .finally(() => { rebuildingRef.current = false; setRebuildBusy(false); });
  }, [companies, loadSyncHealth, rebuildConfirm, rebuildTenant]);

  const onArBucket = useCallback((key: string, label: string) => {
    setArDrillBusy(true); setArDrillErr(null); setArDrillData(null); setArDrillLabel(label);
    void call<ArBucketResponse>(arBucketBody(key))
      .then((r) => { if (!r || r.ok === false) { setArDrillErr((r && r.error) || 'failed'); return; } setArDrillData(r); })
      .catch((e) => setArDrillErr(fail(e)))
      .finally(() => setArDrillBusy(false));
  }, []);

  // ── the body of #uv_body, one branch per sub-view ───────────────────────────────────────────────

  const errBox = (m: string) => <div style={{ color: 'var(--red-soft)' }}>{m}</div>;

  const uvBody = () => {
    if (view === 'roles') {
      return (
        <RolesPanel onNew={() => openRoleForm()}>
          {rolesErr !== null ? errBox(rolesErr)
            : roleRows ? <RolesTable roles={roleRows} onEdit={openRoleForm} onDelete={onRoleDelete} />
            : undefined}
        </RolesPanel>
      );
    }
    if (view === 'sessions') {
      return (
        <SessionsPanel onRefresh={loadSessions}>
          {sessErr !== null ? errBox(sessErr)
            : sessions ? <SessionsTable sessions={sessions} now={Date.now()} onRevoke={onRevoke} />
            : undefined}
        </SessionsPanel>
      );
    }
    if (view === 'audit') {
      return (
        <AuditPanel onRefresh={loadAudit}>
          {auditErr !== null ? errBox(auditErr)
            : events ? (events.length ? <AuditTable events={events} /> : <AuditEmpty />)
            : undefined}
        </AuditPanel>
      );
    }
    if (view === 'xero') {
      return (
        <>
          <XeroPanel busy={xeroBusy} onAction={onXeroAction} onRefresh={loadXero}>
            {xeroErr !== null ? errBox(xeroErr)
              : xero ? <XeroOut r={xero} apiUrl={API} keyPanelOpen={keyPanelOpen}
                                onToggleKeyPanel={onToggleKeyPanel} onSaveKey={onSaveKey} />
              : undefined}
          </XeroPanel>
          <CompanyNamesPanel companies={companies} busy={tRefreshBusy} result={tRefreshResult} error={tRefreshErr} onRefresh={onTenantsRefresh} />
          <SyncHealthPanel health={health} healthErr={healthErr} driftBusy={driftBusy} driftResult={driftResult} driftErr={driftErr} onDriftCheck={onDriftCheck} />
          <LiveAuditPanel busy={auditXBusy} result={auditXResult} error={auditXErr} onRun={onSyncAudit} />
          <InvoiceResyncPanel companies={companies} busy={rsyncBusy} result={rsyncResult} error={rsyncErr} onResync={onInvoiceResync} />
          <RebuildPanel companies={companies} busy={rebuildBusy} result={rebuildResult} error={rebuildErr}
                        confirmText={rebuildConfirm} selectedTenant={rebuildTenant}
                        onTenantChange={setRebuildTenant} onConfirmChange={setRebuildConfirm} onRebuild={onTenantRebuild} />
          <ArAgingPanel data={arData} error={arErr} drillBusy={arDrillBusy} drillLabel={arDrillLabel}
                        drillData={arDrillData} drillErr={arDrillErr} onBucket={onArBucket} onCloseDrill={() => { setArDrillData(null); setArDrillLabel(null); }} />
        </>
      );
    }
    return (
      <UsersPanel onAdd={() => openUserForm()}>
        {usersErr !== null ? errBox(usersErr)
          : users ? (
            <FinanceUsersTable
              users={users} userCompanies={userCompanies} companies={companies} roles={roles}
              now={Date.now()} onEdit={openUserForm} onReset={onReset}
            />
          ) : undefined}
      </UsersPanel>
    );
  };

  return (
    <>
      <Banner />
      {err ? <Panel>{err}</Panel> : null}
      {signedIn === false
        ? <Panel>
            Not signed in on this origin. <a href={legacyUrl('app.html')}>Sign in to Finance OS</a>, then come back —
            the session is the same <code>localStorage[&apos;ctg_portal_token&apos;]</code> key, so this page will
            already be signed in.
          </Panel>
        : perms !== null && !usersReachable(perms)
          ? <Panel>
              Users is not on your feature list — it lists every login, its role and its company access, decides what
              every role can open, shows who is signed in and records who changed what. Ask an administrator if you
              need access.
            </Panel>
        : perms === null ? <Panel><span className="spin"></span> Loading…</Panel>
        : <div ref={modalHost}>
            <UsersSubnav active={view} onView={onView}>{uvBody()}</UsersSubnav>
            {userModal !== undefined
              ? <UserModal user={userModal} companies={companies} roles={roles}
                           onClose={() => setUserModal(undefined)} onSave={onUserSave}
                           onCompToggle={onCompToggle} error={ufErr} saving={ufSaving} />
              : null}
            {roleModal !== undefined
              ? <RoleModal role={roleModal} onClose={() => setRoleModal(undefined)} onSave={onRoleSave}
                           error={rfErr} saving={rfSaving} />
              : null}
          </div>}
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="panel"><div className="muted" style={{ padding: '18px' }}>{children}</div></div>;
}

function Banner() {
  return (
    <div className="panel" style={{ marginBottom: '14px' }}>
      <div className="muted" style={{ padding: '12px 14px', fontSize: '11.5px' }}>
        <b>React.</b> The screen staff use is still{' '}
        <a href={`${legacyUrl('app.html')}#tab=users`}>app.html · Users</a>, unchanged.
        All five sub-views and all six advanced Xero tools render here from the same session; the Users list is
        diffed against the same golden and the other four are pinned against the legacy renderers&apos; own source.
      </div>
    </div>
  );
}
